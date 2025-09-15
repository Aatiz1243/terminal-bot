// storage/cmds.js
// Example message-command handlers for the storage subsystem.
// Commands implemented:
//   $storageinfo       - show usage and quota
//   $ls                - list files in user root (or path if provided)
//   $cd <path>         - update virtual cwd (stored in memory; persisted optional)
//   $pwd               - show current cwd
//   $upload             - save attachments in message to user's storage
//   $rm <filename>     - remove file
//
// This module exports handleMessageCommand({client, message, api, args, opts})

const path = require('node:path');
const fs = require('node:fs/promises');

const USER_STATE = new Map(); // ephemeral: userId => { cwd: '.' }

function ensureState(userId) {
  if (!USER_STATE.has(userId)) USER_STATE.set(userId, { cwd: '.' });
  return USER_STATE.get(userId);
}

function slashEscape(s) {
  return String(s).replace(/`/g, '\\`');
}

async function handleMessageCommand({ client, message, api, args, opts }) {
  const sub = (args[0] || '').toLowerCase();
  const cmd = sub ? sub : (message.content.slice((opts.prefix||'$').length).trim().split(/\s+/)[0] || '').toLowerCase();
  const userId = message.author.id;

  // helper to reply privately (ephemeral-like): reply with ephemeral-like DM fallback
  async function replyPrivate(text) {
    try {
      // attempt ephemeral: in message context we can't do ephemeral, so DM the user
      await message.author.send(text).catch(()=>{});
      // also react to original message to show we handled it
      try { await message.react('✅'); } catch(_) {}
    } catch (e) {
      try { await message.channel.send(text); } catch (_) {}
    }
  }

  // switch by command
  const rootCmd = message.content.slice((opts.prefix||'$').length).trim().split(/\s+/)[0].toLowerCase();

  if (rootCmd === 'storage' || rootCmd === 'storageinfo') {
    // show storage summary
    const q = await api.quotaRemaining(userId);
    const used = q.used;
    const remain = q.remain;
    const quota = q.quota;
    const lines = [
      `Storage info for <@${userId}>:`,
      `• Quota: ${api.human(quota)}`,
      `• Used: ${api.human(used)}`,
      `• Remaining: ${api.human(remain)}`,
      `Files are stored under: ${api.baseDir}/${userId}`
    ];
    return replyPrivate('```text\n' + lines.join('\n') + '\n```');
  }

  if (rootCmd === 'pwd') {
    const st = ensureState(userId);
    return replyPrivate('`' + slashEscape(st.cwd) + '`');
  }

  if (rootCmd === 'cd') {
    const p = args.slice(1).join(' ').trim() || '.';
    const st = ensureState(userId);
    // basic normalization; do not permit absolute paths outside user dir
    const normalized = path.normalize(p);
    if (normalized.startsWith('..')) {
      return replyPrivate('Permission denied: cannot cd above your storage root.');
    }
    st.cwd = normalized;
    return replyPrivate(`cwd set to \`${slashEscape(st.cwd)}\``);
  }

  if (rootCmd === 'ls') {
    const st = ensureState(userId);
    const maybePath = args.slice(1).join(' ').trim() || st.cwd || '.';
    try {
      const items = await api.listFiles(userId, maybePath);
      if (!items || items.length === 0) {
        return replyPrivate('No files found.');
      }
      const lines = items.map(it => `${it.isDirectory ? '[DIR] ' : '[FILE]'} ${it.name}`);
      return replyPrivate('```text\n' + lines.join('\n') + '\n```');
    } catch (e) {
      console.error('[storage ls] error', e);
      return replyPrivate('Error listing files: ' + String(e));
    }
  }

  if (rootCmd === 'rm') {
    const filename = args.slice(1).join(' ').trim();
    if (!filename) return replyPrivate('Usage: $rm <filename>');
    try {
      const ok = await api.removeFile(userId, filename);
      return replyPrivate(ok ? `Removed ${filename}` : `${filename}: not found`);
    } catch (e) {
      console.error('[storage rm] error', e);
      return replyPrivate('Error deleting file: ' + String(e));
    }
  }

  if (rootCmd === 'upload') {
    // save all attachments on the message
    if (!message.attachments || message.attachments.size === 0) {
      return replyPrivate('No attachments found on your message. Attach files and use $upload to save them.');
    }

    const saved = [];
    for (const [id, att] of message.attachments) {
      try {
        // download via fetch
        const url = att.url || att.proxyURL || att.attachment;
        if (!url) {
          continue;
        }
        // prefer streaming save
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to download attachment: ${res.status}`);
        }
        const contentType = res.headers.get('content-type') || '';
        // try to stream into file (api.saveFileFromStream)
        const stream = res.body;
        const result = await api.saveFileFromStream(userId, att.name || `attachment-${id}`, stream);
        // optionally run virus scan
        const scan = await api.virusScan(result.path).catch(e=>({ status: 'error', error: String(e) }));
        saved.push({ name: result.name, size: result.size, scan });
      } catch (e) {
        saved.push({ name: att.name || 'unknown', error: String(e) });
      }
    }

    // build reply
    const ok = saved.filter(s => !s.error);
    const bad = saved.filter(s => s.error);
    const lines = [];
    if (ok.length) {
      for (const s of ok) {
        lines.push(`Saved ${s.name} (${api.human(s.size)}) — scan: ${s.scan && s.scan.status ? s.scan.status : 'skipped'}`);
      }
    }
    if (bad.length) {
      for (const s of bad) {
        lines.push(`Failed ${s.name}: ${s.error}`);
      }
    }
    await replyPrivate('```text\n' + lines.join('\n') + '\n```');
    return;
  }

  // not a storage-rooted command; ignore
  return;
}

module.exports = {
  handleMessageCommand
};
