// index.js (merged, improved, fully fixed)
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder
} = require('discord.js');

const path = require('node:path');

const PREFIX = '$';
const BOT_NAME = 'Terminal';
const VERSION = '1.4.2';
const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error('Set BOT_TOKEN in .env');
  process.exit(1);
}

// Client with guild members & presence (for find/fetch)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  partials: ['CHANNEL']
});

// Modules
const status = safeRequire('./status');

// STORAGE: robustly load initStorage from multiple export shapes
let initStorage = null;
try {
  const storageMod = require('./storage/head');
  if (typeof storageMod === 'function') initStorage = storageMod;
  else if (storageMod && typeof storageMod.initStorage === 'function') initStorage = storageMod.initStorage;
  else if (storageMod && typeof storageMod.default === 'function') initStorage = storageMod.default;
  else initStorage = null;
} catch (e) {
  initStorage = null;
  console.warn('[storage] storage module not found or failed to load (./storage/head). Storage will be disabled.', e && e.message ? e.message : '');
}

// initialize storage (async) — keep reference on client
(async () => {
  if (!initStorage) {
    client.storage = null;
    return;
  }

  try {
    const storage = await initStorage(client, { prefix: PREFIX, baseDir: path.resolve(process.cwd(), './data/users'), quotaBytes: 800 * 1024 * 1024 });
    client.storage = storage;
    try { console.log('[storage] initialized. baseDir=', storage.api && storage.api.baseDir ? storage.api.baseDir : '(unknown)'); } catch { console.log('[storage] initialized.'); }
  } catch (err) {
    client.storage = null;
    console.error('Failed to initialize storage subsystem:', err);
  }
})();

// tolerant toggle loader: prefer new location but fallback to old path
let toggleModule;
try {
  const t = require('./slash-commands/files/toggle');
  toggleModule = typeof t === 'function' ? t(client, { token: TOKEN }) : (t && typeof t.default === 'function' ? t.default(client, { token: TOKEN }) : (t && t.command ? t(client, { token: TOKEN }) : t));
} catch (e) {
  try {
    const t2 = require('./slash-commands/toggle');
    toggleModule = typeof t2 === 'function' ? t2(client, { token: TOKEN }) : (t2 && typeof t2.default === 'function' ? t2.default(client, { token: TOKEN }) : t2);
  } catch (e2) {
    console.warn('[toggle] Could not load toggle module from expected locations. Disabling channel checks.');
    toggleModule = {
      disabledChannels: new Map(),
      enabledChannels: new Map(),
      ensureGuildSet: () => new Set(),
      ensureDisabledSet: () => new Set(),
      isChannelEnabled: () => true
    };
  }
}

// firewall loader (module returns initializer)
let firewall;
try {
  const fw = require('./commands/firewall');
  firewall = (typeof fw === 'function') ? fw() : (fw && fw.default ? fw.default() : fw);
  // ensure minimal API
  if (!firewall || typeof firewall.isProtected !== 'function') {
    firewall = {
      protect: () => {},
      unprotect: () => {},
      isProtected: () => false,
      _map: new Map()
    };
  }
} catch (e) {
  firewall = {
    protect: () => {},
    unprotect: () => {},
    isProtected: () => false,
    _map: new Map()
  };
  console.warn('[firewall] firewall module not found — protection disabled.');
}

// Legacy / convenience
const { enabledChannels } = toggleModule; // may be empty map
const { isChannelEnabled } = toggleModule;

// Timing/pacing
const HACK_DELAY_MS = 120;
const DEFAULT_DELAY_MS = 140;
const TYPING_CHAR_MS = 8;
const TYPING_BETWEEN_FIELDS_MS = 180;
const TYPING_CURSOR = '▌';

// State stores
const sudoState = {};
const COOLDOWN = 600;
const lastUsed = new Map();

const cwdPerUser = {};
const historyPerUser = {};
const filesPerUser = {};

// Helpers
const now = () => Date.now();
const isOnCooldown = (id) => lastUsed.has(id) && (now() - lastUsed.get(id) < COOLDOWN);
const setCooldown = (id) => lastUsed.set(id, now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const random = (arr) => arr[Math.floor(Math.random() * arr.length)];

function ensureUser(id) {
  if (!cwdPerUser[id]) cwdPerUser[id] = '~/workspace';
  if (!historyPerUser[id]) historyPerUser[id] = [];
  if (!filesPerUser[id]) filesPerUser[id] = new Set(['README.md', 'notes.txt']);
}

const jokes = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "There are only two hard things in Computer Science: cache invalidation, naming things and off-by-one errors.",
  "I told my computer I needed a break, and it said: \"No problem — I'll go to sleep.\""
];

const fortunes = [
  'You will find a bug in your code right after deployment.',
  'Good news will arrive in the form of a subtle console.log.',
  'You will refactor something and instantly regret it.'
];

// Command registry
const commands = new Map();
function register(name, fn, helpText = '') {
  commands.set(name.toLowerCase(), { fn, helpText });
}

// ---------------- Terminal renderer (complete) ----------------
async function sendTerminalResponse(channel, promptLine, output, { animate = true, delay = DEFAULT_DELAY_MS } = {}) {
  try {
    if (output instanceof EmbedBuilder) {
      const header = new EmbedBuilder()
        .setColor(0x000000)
        .setDescription('```text\n' + promptLine + '\n```')
        .setFooter({ text: `Terminal v${VERSION}` });
      await channel.send({ embeds: [header] });
      return channel.send({ embeds: [output] });
    }

    // Hack flow: object { hack: true, progress: [...], result: {...}, error?: string }
    if (output && typeof output === 'object' && output.hack === true) {
      const progressLines = Array.isArray(output.progress) ? output.progress : [];
      const final = output.result || null;
      const error = output.error || null;

      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setDescription('```text\n' + promptLine + '\n\n' + '```')
        .setFooter({ text: `Terminal v${VERSION}` });

      const msg = await channel.send({ embeds: [embed] });

      for (const line of progressLines) {
        embed.setDescription('```text\n' + promptLine + '\n\n' + line + '\n```');
        try { await msg.edit({ embeds: [embed] }); } catch (_) {}
        await sleep(delay);
      }

      if (error) {
        const failEmbed = new EmbedBuilder()
          .setTitle('Hack failed')
          .setDescription(error)
          .setColor(0xAA1111)
          .setFooter({ text: `Terminal v${VERSION}` });
        return channel.send({ embeds: [failEmbed] });
      }

      if (final) {
        // attempt final rename now for authoritative status
        try {
          if (final._guildId && final._targetMemberId) {
            const guild = client.guilds.cache.get(final._guildId) || channel.guild;
            if (guild) {
              try {
                const member = await guild.members.fetch(final._targetMemberId).catch(() => null);
                if (member) {
                  try {
                    await member.setNickname('Hacked');
                    final.renamed = true;
                  } catch (_) {
                    final.renamed = false;
                  }
                } else {
                  final.renamed = false;
                }
              } catch (_) {
                final.renamed = false;
              }
            } else {
              final.renamed = false;
            }
          } else {
            final.renamed = final.renamed === true;
          }
        } catch (_) {
          final.renamed = final.renamed === true;
        }

        const resultEmbed = new EmbedBuilder()
          .setTitle('Hack result')
          .setColor(0x222222)
          .setFooter({ text: `Terminal v${VERSION}` });

        if (final.avatar) resultEmbed.setThumbnail(final.avatar);

        const typedFields = Array.isArray(final.typedFields) ? final.typedFields : [];

        if (typedFields.length === 0) {
          if (final.name) resultEmbed.addFields({ name: 'Name', value: final.name, inline: true });
          if (final.tag) resultEmbed.addFields({ name: 'Tag', value: final.tag, inline: true });
          if (final.id) resultEmbed.addFields({ name: 'ID', value: final.id, inline: true });
          if (final.createdAt) resultEmbed.addFields({ name: 'Account created', value: final.createdAt, inline: false });
          if (final.joinedAt) resultEmbed.addFields({ name: 'Server joined', value: final.joinedAt, inline: false });
          resultEmbed.addFields({ name: 'Rename', value: final.renamed ? "Member renamed to 'Hacked' (applied)" : 'Rename not applied', inline: false });
          return channel.send({ embeds: [resultEmbed] });
        }

        // placeholders
        for (const f of typedFields) {
          resultEmbed.addFields({ name: f.name, value: '‎', inline: !!f.inline });
        }
        resultEmbed.addFields({ name: 'Rename', value: final.renamed ? "Applying..." : 'Rename not applied', inline: false });

        const outMsg = await channel.send({ embeds: [resultEmbed] });

        for (let fi = 0; fi < typedFields.length; fi++) {
          const f = typedFields[fi];
          const label = f.name;
          const value = (typeof f.value === 'string') ? f.value : String(f.value);
          const maxLen = 1024;
          const chars = value.slice(0, maxLen).split('');
          let current = '';
          for (let c = 0; c < chars.length; c++) {
            current += chars[c];
            const newFields = [];
            for (let j = 0; j < fi; j++) {
              const done = typedFields[j];
              newFields.push({ name: done.name, value: (typeof done.value === 'string') ? done.value.slice(0, maxLen) : String(done.value).slice(0, maxLen), inline: !!done.inline });
            }
            const cursor = (c % 2 === 0) ? TYPING_CURSOR : '';
            newFields.push({ name: label, value: current + cursor, inline: !!f.inline });

            for (let j = fi + 1; j < typedFields.length; j++) {
              const later = typedFields[j];
              newFields.push({ name: later.name, value: '‎', inline: !!later.inline });
            }
            newFields.push({ name: 'Rename', value: final.renamed ? "Applying..." : 'Rename not applied', inline: false });

            try {
              resultEmbed.spliceFields(0, resultEmbed.data.fields ? resultEmbed.data.fields.length : 0, ...newFields);
              await outMsg.edit({ embeds: [resultEmbed] });
            } catch (_) {}
            await sleep(TYPING_CHAR_MS);
          }

          // finalize field
          const finishedFields = [];
          for (let j = 0; j < fi; j++) {
            const done = typedFields[j];
            finishedFields.push({ name: done.name, value: (typeof done.value === 'string') ? done.value.slice(0, maxLen) : String(done.value).slice(0, maxLen), inline: !!done.inline });
          }
          finishedFields.push({ name: label, value: value.slice(0, maxLen), inline: !!f.inline });
          for (let j = fi + 1; j < typedFields.length; j++) {
            const later = typedFields[j];
            finishedFields.push({ name: later.name, value: '‎', inline: !!later.inline });
          }
          finishedFields.push({ name: 'Rename', value: final.renamed ? "Applying..." : 'Rename not applied', inline: false });

          try {
            resultEmbed.spliceFields(0, resultEmbed.data.fields ? resultEmbed.data.fields.length : 0, ...finishedFields);
            await outMsg.edit({ embeds: [resultEmbed] });
          } catch (_) {}

          await sleep(TYPING_BETWEEN_FIELDS_MS);
        }

        // finalize rename + extras
        const finalFields = resultEmbed.data.fields ? resultEmbed.data.fields.slice() : [];
        const lastIndex = finalFields.findIndex(f => String(f.name).toLowerCase() === 'rename');
        if (lastIndex !== -1) {
          finalFields[lastIndex] = { name: 'Rename', value: final.renamed ? "Member renamed to 'Hacked' (applied)" : 'Rename not applied', inline: false };
        } else {
          finalFields.push({ name: 'Rename', value: final.renamed ? "Member renamed to 'Hacked' (applied)" : 'Rename not applied', inline: false });
        }

        if (typeof final.mutualServersCached === 'number') {
          finalFields.push({ name: 'Mutual servers (cached)', value: String(final.mutualServersCached), inline: true });
        }
        if (final.activity) {
          finalFields.push({ name: 'Activity (raw)', value: final.activity || 'None', inline: true });
        }

        try {
          resultEmbed.spliceFields(0, resultEmbed.data.fields ? resultEmbed.data.fields.length : 0, ...finalFields);
          await outMsg.edit({ embeds: [resultEmbed] });
        } catch (_) {}

        return outMsg;
      }
    }

    // Normal (non-hack) output
    let lines = [];
    if (Array.isArray(output)) lines = output.flatMap((l) => (typeof l === 'string' ? l.split('\n') : ['']));
    else if (typeof output === 'string') lines = output.split('\n');
    else if (output == null) lines = [''];
    else lines = [String(output)];

    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setDescription('```text\n' + promptLine + '\n\n' + '```')
      .setFooter({ text: `Terminal v${VERSION}` });

    const msg = await channel.send({ embeds: [embed] });
    if (!animate) {
      const full = '```text\n' + promptLine + '\n\n' + lines.join('\n') + '\n```';
      embed.setDescription(full);
      await msg.edit({ embeds: [embed] });
      return msg;
    }

    const chunk = [];
    for (const line of lines) {
      chunk.push(line);
      embed.setDescription('```text\n' + promptLine + '\n\n' + chunk.join('\n') + '\n```');
      await sleep(delay);
      try { await msg.edit({ embeds: [embed] }); } catch (e) {}
    }
    return msg;
  } catch (err) {
    console.error('sendTerminalResponse error:', err);
    try { return channel.send(typeof output === 'string' ? output : JSON.stringify(output)); } catch (_) {}
  }
}

// ---------------- Helper: findMemberByString ----------------
async function findMemberByString(message, str) {
  if (!message.guild || !str) return null;

  const mention = message.mentions.members?.first();
  if (mention) return mention;

  const idMatch = str.match(/^<@!?(\d+)>$|^(\d{6,21})$/);
  if (idMatch) {
    const id = idMatch[1] || idMatch[2];
    try {
      const fetched = await message.guild.members.fetch(id).catch(() => null);
      if (fetched) return fetched;
    } catch (_) {}
  }

  const lower = str.toLowerCase();

  const inCache = message.guild.members.cache.find(m =>
    (m.user.username && m.user.username.toLowerCase() === lower) ||
    (m.displayName && m.displayName.toLowerCase() === lower) ||
    (m.user.username && m.user.username.toLowerCase().includes(lower)) ||
    (m.displayName && m.displayName.toLowerCase().includes(lower))
  );
  if (inCache) return inCache;

  try {
    const fetchedList = await message.guild.members.fetch({ query: str, limit: 5 }).catch(() => null);
    if (fetchedList && fetchedList.size > 0) {
      const exact = fetchedList.find(m =>
        (m.user.username && m.user.username.toLowerCase() === lower) ||
        (m.displayName && m.displayName.toLowerCase() === lower)
      );
      if (exact) return exact;
      return fetchedList.first();
    }
  } catch (e) {
    // ignore
  }

  return null;
}

// ---------------- Load hack handler ----------------
const hackHandler = safeRequire('./commands/sudo/hack') ? require('./commands/sudo/hack')(client, {
  HACK_DELAY_MS,
  sleep,
  findMemberByString,
  isProtected: firewall.isProtected
}) : (() => async () => 'Hack module unavailable.');

// ---------------- Register commands ----------------
// (keeps your existing registrations)
register('help', async ({ message }) => {
  const lines = [
    `${BOT_NAME} v${VERSION}`,
    'Available commands:',
    '',
    '/help — show slash help (embed)',
    '/firewall on — protect yourself (ephemeral)',
    '/firewall off — unprotect yourself (ephemeral)',
    '$help — show console-style help',
    '$ls — list files (fake)',
    '$pwd — print working directory (fake)',
    '$cd <path> — change directory (simulated)',
    '$cat <file> — show file (simulated)',
    '$echo <text> — echo text',
    '$ping — check latency',
    '$uptime — bot uptime',
    '$whoami — who you are',
    '$roll <NdM or M> — roll dice (e.g. 2d6, d20, 6)',
    '$flip — coin flip',
    '$choose a | b | c — pick one option',
    '$calc <expression> — basic math',
    '$sudo <...> — sudo subcommands (fortune, joke, coffee, random, install, update, passwd, hack <target>)',
    '$banner <text> — small ASCII banner',
    '$userinfo [@user] — info about a user',
    '$serverinfo — guild info (server only)'
  ];
  return lines.join('\n');
}, 'show help (console)');

register('ping', async ({ message }) => {
  const latency = Date.now() - message.createdTimestamp;
  return `Pong! Latency: ${latency}ms | API: ${Math.round(client.ws.ping)}ms`;
}, 'check latency');

// ... (rest of your command registrations remain unchanged; omitted here for brevity in this snippet)
// For completeness you will paste your previous command registration block here (ls, pwd, cd, etc.)
// In your actual file, keep every register(...) block you had.


// ---------------- SUDO (includes hack) ----------------
register('sudo', async ({ message, rest }) => {
  const userId = message.author.id;
  if (!rest) return '[sudo] what do you want to run?';

  const parts = rest.split(' ').filter(Boolean);
  const main = (parts[0] || '').toLowerCase();
  const arg = parts.slice(1).join(' ').trim();

  if (rest === 'rm -rf /' || rest.toLowerCase().includes('rm -rf')) return 'Warning: Command blocked for safety.';

  if (main === 'hack') {
    return hackHandler(message, arg);
  }

  if (/^hack\b/i.test(rest)) {
    return `Attempting to hack ${rest.slice(5).trim()}... Access denied.`;
  }

  switch (main) {
    case 'fortune': return random(fortunes);
    case 'joke': return random(jokes);
    case 'coffee': return 'Your coffee is served (imaginary).';
    case 'dance': return 'Executing dance routine... (invisible)';
    case 'party': return 'Party mode: ON';
    case 'random': return `random: ${Math.floor(Math.random() * 1_000_000)}`;
    case 'reboot': return 'System reboot scheduled... (not really)';
    case 'shutdown': return 'Powering off... (just kidding)';
    case 'install': if (!arg) return 'Specify a package to install'; return `Installing ${arg}... Done.`;
    case 'update': return 'Updating packages... (simulated)';
    case 'passwd': sudoState[userId] = !sudoState[userId]; return sudoState[userId] ? 'Password set (simulated)' : 'Password removed (simulated)';
    default: return `sudo: ${rest}: command not found`;
  }
}, 'sudo subcommands (includes hack)');


// ---------------- Ready (handle both ready & clientReady to avoid deprecation noise) ----------------
let _didReadyRun = false;
async function onReadyOnce() {
  if (_didReadyRun) return;
  _didReadyRun = true;

  console.log(`${BOT_NAME} is online — v${VERSION}`);
  try { if (typeof status === 'function') status(client, BOT_NAME, VERSION); } catch (e) { /* ignore status errors */ }

  try {
    if (client.user && client.user.username !== BOT_NAME) {
      await client.user.setUsername(BOT_NAME).catch(() => {});
    }
  } catch (e) {
    // ignore rate-limit errors
  }

  console.log('Ready. Ensure slash commands are registered (deploy-commands.js).');
}
client.once('ready', onReadyOnce);
client.once('clientReady', onReadyOnce); // future-proof for v15 rename

// ---------------- Slash interactions (/help, /firewall) ----------------
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'help') {
      const commandsList = [
        '/help — show this message (embed)',
        '/firewall on — protect yourself (ephemeral)',
        '/firewall off — unprotect yourself (ephemeral)',
        '$help — show console-style help',
        '$sudo hack <user> [type] — playful hack simulator (types: ip, bank, email, account, full)',
        '$sudo <fortune|joke|coffee|random|install|update|passwd>'
      ].join('\n');

      const files = [];
      try {
        const logo = new AttachmentBuilder('./logo.png', { name: 'logo.png' });
        files.push(logo);
      } catch (e) {}

      const embed = new EmbedBuilder()
        .setTitle(`Terminal v${VERSION}`)
        .setColor(0x111111)
        .setDescription('A terminal-styled multipurpose bot.\n\n' + commandsList)
        .setFooter({ text: `Powered by Terminal • ${BOT_NAME} v${VERSION}` });

      if (files.length) embed.setThumbnail('attachment://logo.png');

      await interaction.reply({ embeds: [embed], files, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'firewall') {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
        return;
      }

      const sub = interaction.options.getSubcommand();
      // privacy rule — a user may only toggle protection for THEMSELVES.
      const requestedUser = interaction.options.getUser('member') || interaction.user;
      if (requestedUser.id !== interaction.user.id) {
        return interaction.reply({ content: 'You may only change your own firewall protection (private).', ephemeral: true });
      }

      const guildId = interaction.guild.id;
      const userId = interaction.user.id;

      if (sub === 'on') {
        try { firewall.protect(guildId, userId); } catch (e) {}
        return interaction.reply({ content: `🔒 You are now protected by the firewall in this server. Hacking attempts blocked.`, ephemeral: true });
      } else if (sub === 'off') {
        try { firewall.unprotect(guildId, userId); } catch (e) {}
        return interaction.reply({ content: `🔓 You are no longer protected by the firewall in this server.`, ephemeral: true });
      } else {
        return interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
      }
    }
  } catch (err) {
    console.error('Interaction handler error', err);
    try { if (!interaction.replied) await interaction.reply({ content: 'Error handling command', ephemeral: true }); } catch {}
  }
});

// ---------------- Message handling ($ commands) ----------------
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    // If disabled in this channel (toggle module), ignore
    if (message.guild) {
      if (!isChannelEnabled(message.guild.id, message.channel.id)) {
        return;
      }
    }

    if (isOnCooldown(message.author.id)) {
      return message.channel.send('You are doing commands too fast — slow down.');
    }
    setCooldown(message.author.id);

    const cmdString = message.content.slice(PREFIX.length).trim();
    if (!cmdString) return;
    const args = cmdString.split(/\s+/);
    const cmd = args[0].toLowerCase();
    const rest = args.slice(1).join(' ');

    ensureUser(message.author.id);
    historyPerUser[message.author.id].push(message.content);

    const user = message.author.username || 'discord';
    const host = 'terminal';
    const pathStr = cwdPerUser[message.author.id] || '~/workspace';
    const promptLine = `${user}@${host}:${pathStr}$ ${message.content.replace(/`/g, '\\`')}`;

    const entry = commands.get(cmd);
    if (entry && typeof entry.fn === 'function') {
      let animate = (cmd === 'help') ? false : true;
      let delay = (cmd === 'help') ? 0 : DEFAULT_DELAY_MS;

      if (cmd === 'sudo' && rest.trim().toLowerCase().startsWith('hack')) {
        delay = HACK_DELAY_MS;
        animate = true;
      }

      const out = await entry.fn({ message, args: args.slice(1), rest });

      await sendTerminalResponse(message.channel, promptLine, out, { animate, delay });
      return;
    }

    // unknown command
    await message.channel.send(`\`\`\`text\n${cmd}: command not found\n\`\`\``);

  } catch (err) {
    console.error('Command handler error', err);
  }
});

client.login(TOKEN);

// ----------------- Utility: safeRequire -----------------
function safeRequire(p) {
  try {
    return require(p);
  } catch (e) {
    return null;
  }
}
