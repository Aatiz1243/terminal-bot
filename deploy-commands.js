// deploy-commands.js
// Robust deploy script: registers /help plus optional toggle and firewall builders
// Usage: BOT_TOKEN in .env required. Optionally set GUILD_ID in .env to register to a single guild (faster testing).

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID || null;

if (!TOKEN) {
  console.error('✖️  Missing BOT_TOKEN in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

// Try to require multiple paths and normalize to a SlashCommandBuilder or an object with .toJSON()
function tryLoadBuilder(paths = []) {
  for (const p of paths) {
    try {
      // prefer if file exists (prevent accidental resolution errors)
      if (!fs.existsSync(path.resolve(p + '.js')) && !fs.existsSync(path.resolve(p))) {
        continue;
      }
    } catch (_) {
      // continue anyway
    }

    try {
      const mod = require(p);
      if (!mod) continue;

      // case: module.command is a builder
      if (mod.command && typeof mod.command.toJSON === 'function') {
        return mod.command;
      }

      // case: module itself is a SlashCommandBuilder-like (has toJSON)
      if (typeof mod.toJSON === 'function') {
        return mod;
      }

      // case: default export
      if (mod.default && typeof mod.default.toJSON === 'function') {
        return mod.default;
      }

      // case: module exported an object with `.command` returned by a function (rare)
      if (typeof mod === 'function') {
        try {
          const maybe = mod();
          if (maybe && typeof maybe.command === 'object' && typeof maybe.command.toJSON === 'function') return maybe.command;
          if (maybe && typeof maybe.toJSON === 'function') return maybe;
        } catch (_) {
          // can't safely call with args; skip
        }
      }
    } catch (err) {
      // ignore load errors for this path, but log at debug level
      // console.warn(`Could not load ${p}: ${err.message}`);
    }
  }
  return null;
}

(async function main() {
  try {
    // Preferred search locations for builders
    const helpPaths = [
      './slash-commands/files/help',
      './slash-commands/help',
      './help',
      './slash-commands/files/help.js',
      './help.js'
    ];
    const togglePaths = [
      './slash-commands/files/toggle',
      './slash-commands/toggle',
      './slash-commands/files/toggle.js',
      './slash-commands/toggle.js'
    ];
    const firewallPaths = [
      './commands/firewall',
      './commands/firewall.js'
    ];

    // Attempt to load builders
    let helpBuilder = tryLoadBuilder(helpPaths);
    let toggleBuilder = tryLoadBuilder(togglePaths);
    let firewallBuilder = tryLoadBuilder(firewallPaths);

    // If help builder not found, create a simple fallback
    if (!helpBuilder) {
      console.warn('⚠️  Help builder not found in project paths. Using fallback /help builder.');
      helpBuilder = new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show Terminal help (commands, version, powered by)');
    } else {
      console.log('ℹ️  Loaded help command builder from project.');
    }

    if (toggleBuilder) console.log('ℹ️  Loaded toggle command builder from project.');
    else console.warn('⚠️  toggle builder not found; /toggle will not be registered.');

    if (firewallBuilder) console.log('ℹ️  Loaded firewall command builder from project.');
    else console.warn('⚠️  firewall builder not found; /firewall will not be registered.');

    // Build unique command set (prevent duplicate names)
    const toRegisterMap = new Map();

    const pushBuilder = (b) => {
      if (!b || typeof b.toJSON !== 'function') return;
      const json = b.toJSON();
      if (!json || !json.name) return;
      toRegisterMap.set(json.name, json);
    };

    pushBuilder(helpBuilder);
    if (toggleBuilder) pushBuilder(toggleBuilder);
    if (firewallBuilder) pushBuilder(firewallBuilder);

    const toRegister = Array.from(toRegisterMap.values());
    if (toRegister.length === 0) {
      console.error('✖️  No commands to register.');
      process.exit(1);
    }

    // Determine application id (from token)
    const appInfo = await rest.get(Routes.oauth2CurrentApplication());
    const appId = appInfo && appInfo.id;
    if (!appId) throw new Error('Unable to determine application id from token');

    if (GUILD_ID) {
      console.log(`Registering ${toRegister.length} command(s) to guild ${GUILD_ID} (fast register for testing)...`);
      const res = await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: toRegister });
      console.log(`✅ Registered ${res.length} guild command(s).`);
    } else {
      console.log(`Registering ${toRegister.length} command(s) globally (may take up to an hour to propagate)...`);
      const res = await rest.put(Routes.applicationCommands(appId), { body: toRegister });
      console.log(`✅ Registered ${res.length} global command(s).`);
    }

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to deploy commands:', err);
    process.exit(1);
  }
})();
