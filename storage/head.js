// storage/head.js
// Public initializer for per-user storage subsystem.
// Exports: module.exports = initStorage; and also .initStorage and .default for compat.

const path = require('node:path');
const fs = require('node:fs/promises');

const api = require('./api');
const cmds = require('./cmds');

async function ensureBaseDir(baseDir) {
  try {
    await fs.mkdir(baseDir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function defaultOpts() {
  return {
    prefix: '$',
    baseDir: path.resolve(process.cwd(), './data/users'),
    quotaBytes: 800 * 1024 * 1024, // 800 MB
    enableVirusCheck: true
  };
}

/**
 * initStorage(client, opts)
 * - wires a message listener for storage-related $ commands and returns an object:
 *   { api, cmds, shutdown }
 */
async function initStorage(client, userOpts = {}) {
  if (!client) throw new Error('initStorage requires a discord client as the first arg');

  const opts = Object.assign({}, defaultOpts(), userOpts);
  await ensureBaseDir(opts.baseDir);

  // initialize API with baseDir + quota
  const storageApi = api(opts.baseDir, { quotaBytes: opts.quotaBytes, enableVirusCheck: opts.enableVirusCheck });

  // bind simple message-based handlers (safe, DM replies for privacy)
  const messageHandler = async (message) => {
    try {
      if (!message || !message.content) return;
      if (message.author?.bot) return;
      const p = opts.prefix || '$';
      if (!message.content.startsWith(p)) return;

      const raw = message.content.slice(p.length).trim();
      const parts = raw.split(/\s+/);
      const cmd = parts.shift().toLowerCase();
      const handled = ['storage', 'ls', 'cd', 'pwd', 'upload', 'rm', 'storageinfo'];
      if (!handled.includes(cmd)) return;

      await cmds.handleMessageCommand({ client, message, api: storageApi, args: parts, opts });
    } catch (err) {
      console.error('[storage] message handler error:', err);
      try { await message.channel.send('Storage subsystem error (see bot logs).'); } catch (_) {}
    }
  };

  client.on('messageCreate', messageHandler);

  function shutdown() {
    try { client.removeListener('messageCreate', messageHandler); } catch (_) {}
  }

  return {
    api: storageApi,
    cmds,
    shutdown
  };
}

// export the function and attach compat properties to avoid import interop problems
module.exports = initStorage;
module.exports.initStorage = initStorage;
module.exports.default = initStorage;
