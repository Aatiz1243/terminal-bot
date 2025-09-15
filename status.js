// status.js
// Start a compact rotating presence for the bot with safe compatibility handling.
// - Uses ActivityType constants from discord.js
// - Starts immediately if client is ready, otherwise listens for `clientReady`
// - Does NOT attach to `ready` by default (avoids deprecation warning); set env ALLOW_LEGACY_READY=1 to attach to `ready` as well.
// - Returns an object with stop() and isRunning() for control if needed.

const { ActivityType } = require('discord.js');

module.exports = (client, BOT_NAME = 'Terminal', VERSION = '1.0.0', opts = {}) => {
  const intervalMs = typeof opts.intervalMs === 'number' ? opts.intervalMs : 5000;
  let intervalId = null;

  // Build dynamic statuses. Each entry uses a getName() for dynamic values.
  function makeStatuses() {
    return [
      { getName: () => `v${VERSION} by Windows`, type: ActivityType.Custom },
      { getName: () => `Use /help for commands`, type: ActivityType.Custom },
      { getName: () => `Terminal Shell`, type: ActivityType.Watching },
      { getName: () => `Now in ${client?.guilds?.cache?.size ?? 0} Servers`, type: ActivityType.Custom }
    ];
  }

  const statuses = makeStatuses();

  function safeSetPresence(name, type) {
    if (!client || !client.user) return;
    try {
      // Keep best-effort: swallow promise rejections and errors
      client.user.setPresence({
        activities: [{ name: String(name).slice(0, 128), type }],
        status: 'online'
      }).catch(() => { /* ignore */ });
    } catch (e) {
      // ignore
    }
  }

  function tickRotation(indexRef) {
    // update dynamic server-count entry each tick
    try {
      statuses[3].getName = () => `Now in ${client.guilds.cache.size} Servers`;
    } catch (_) { /* ignore */ }

    const s = statuses[indexRef.value % statuses.length];
    safeSetPresence(typeof s.getName === 'function' ? s.getName() : s.name, s.type);
    indexRef.value = (indexRef.value + 1) % statuses.length;
  }

  function startRotation() {
    if (intervalId) return; // already running
    const indexRef = { value: 0 };

    // run immediately once
    tickRotation(indexRef);

    intervalId = setInterval(() => {
      tickRotation(indexRef);
    }, intervalMs);

    // store for external access / debugging if desired
    try { client.__statusInterval = intervalId; } catch (_) {}
    console.log(`✅ ${BOT_NAME} status rotation started.`);
  }

  function stopRotation() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      try { client.__statusInterval = null; } catch (_) {}
      console.log(`ℹ️ ${BOT_NAME} status rotation stopped.`);
    }
  }

  // Start now if client is ready
  try {
    const isReady = typeof client.isReady === 'function' ? client.isReady() : !!client.readyAt || !!client.user;
    if (isReady && client.user) {
      startRotation();
    } else {
      // Prefer the modern event name 'clientReady' (avoid 'ready' to prevent deprecation warnings).
      // If the runtime sets ALLOW_LEGACY_READY=1 in the environment, we'll also listen to 'ready' for older discord.js versions.
      const startOnce = () => {
        // remove both listeners to be safe
        try {
          client.removeListener('clientReady', startOnce);
        } catch (_) {}
        try {
          client.removeListener('ready', startOnce);
        } catch (_) {}
        // small nextTick so other ready handlers finish
        process.nextTick(() => startRotation());
      };

      client.once('clientReady', startOnce);

      if (process.env.ALLOW_LEGACY_READY === '1') {
        // optional legacy fallback (not recommended unless you must support older versions
        client.once('ready', startOnce);
      }
    }
  } catch (err) {
    // fail-safe: try to start anyway
    try { startRotation(); } catch (_) {}
  }

  return {
    stop: stopRotation,
    isRunning: () => !!intervalId
  };
};
