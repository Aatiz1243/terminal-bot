// help.js
// Standalone file to register and handle the /help slash command and $help message command.
// - Registers /help safely (merges with existing global commands, keeps others intact).
// - Responds to /help with an embed (attaches ./logo.png if present).
// - Responds to $help in chat with a console-style code block.
// - Listens for both 'ready' and 'clientReady' to avoid deprecation warnings across discord.js versions.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder
} = require('discord.js');

const BOT_NAME = 'Terminal';
const VERSION = '1.4.2';
const TOKEN = process.env.BOT_TOKEN;
const PREFIX = '$';

if (!TOKEN) {
  console.error('Set BOT_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Build the /help command
const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show Terminal help (commands, version, powered by)');

// Friendly list of commands to show in embed and $help
const commandsListLines = [
  '$help — show console help (same as /help)',
  '$ls — list files (fake)',
  '$pwd — print working directory (fake)',
  '$cd <path> — change directory (simulated)',
  '$cat <file> — show file (simulated)',
  '$echo <text> — echo text',
  '$ping — check latency',
  '$uptime — bot uptime',
  '$whoami — who you are',
  '$roll <NdM> — roll dice',
  '$flip — coin flip',
  '$choose a | b | c — pick one option',
  '$calc <expr> — basic math',
  '$sudo <fortune|joke|coffee|random|install|update|passwd>',
  '$banner <text> — small ASCII banner',
  '$userinfo [@user] — info about a user',
  '$serverinfo — guild info (server only)'
];

const commandsList = commandsListLines.join('\n');

// Registers /help while preserving other existing global commands (merges instead of replacing)
async function registerHelpCommand() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    // Get application id and existing global commands
    const appInfo = await rest.get(Routes.oauth2CurrentApplication());
    const appId = appInfo && appInfo.id;
    if (!appId) throw new Error('Unable to determine application id from token');

    // Fetch existing global commands (array)
    const existing = await rest.get(Routes.applicationCommands(appId));
    const existingArray = Array.isArray(existing) ? existing : [];

    // Remove any existing /help entry and add our builder
    const filtered = existingArray.filter(c => c.name !== 'help');
    filtered.push(helpCommand.toJSON());

    // Put the merged list back (global registration)
    await rest.put(Routes.applicationCommands(appId), { body: filtered });
    console.log('Registered/updated global /help (may take up to an hour to appear globally).');
  } catch (err) {
    console.error('Failed to register /help command:', err);
  }
}

// unified ready handler (supports both 'ready' and 'clientReady' event names)
async function onClientReady() {
  console.log(`${BOT_NAME} is online — v${VERSION}`);

  // Register slash command (merge-friendly)
  await registerHelpCommand();
}

// Attach both event names so the deprecation warning is satisfied in v15+ and still works in v14.
client.once('ready', onClientReady);
client.once('clientReady', onClientReady);

// Interaction handler for /help
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'help') return;

    // Try to attach logo.png (if it exists)
    const logoPath = path.resolve('./logo.png');
    const files = [];
    let thumbnail = null;
    if (fs.existsSync(logoPath)) {
      try {
        const logo = new AttachmentBuilder(logoPath, { name: 'logo.png' });
        files.push(logo);
        thumbnail = 'attachment://logo.png';
      } catch (e) {
        // ignore attachment errors
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`${BOT_NAME} v${VERSION}`)
      .setColor(0x111111)
      .setDescription('A terminal-styled multipurpose bot.\n\n**Available commands:**\n\n' + commandsList)
      .setFooter({ text: `Powered by Terminal • ${BOT_NAME} v${VERSION}` });

    if (thumbnail) embed.setThumbnail(thumbnail);

    await interaction.reply({ embeds: [embed], files, ephemeral: true });
  } catch (err) {
    console.error('Interaction handler error (help):', err);
    try {
      if (!interaction.replied) {
        await interaction.reply({ content: 'Error handling /help', ephemeral: true });
      }
    } catch (_) {}
  }
});

// Message handler for $help
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    if (cmd === 'help') {
      await message.channel.send(
        '```text\n' +
        `${BOT_NAME} v${VERSION}\n` +
        'Available commands:\n\n' +
        commandsList +
        '\n```'
      );
    }
  } catch (err) {
    console.error('Message handler error (help):', err);
  }
});

client.login(TOKEN).catch(err => {
  console.error('Failed to login client (help.js):', err);
});
