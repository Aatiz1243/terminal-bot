// storage/api.js
// Internal storage API: per-user directories, quota enforcement, file saving, simple VirusTotal scan stub (optional).
// Exports a factory: module.exports = (baseDir, { quotaBytes, enableVirusCheck }) => apiObject

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_QUOTA = 800 * 1024 * 1024; // 800 MB

function human(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(2)} KB`;
  if (n < 1024*1024*1024) return `${(n/1024/1024).toFixed(2)} MB`;
  return `${(n/1024/1024/1024).toFixed(2)} GB`;
}

module.exports = function createApi(baseDir, { quotaBytes = DEFAULT_QUOTA, enableVirusCheck = true } = {}) {
  // compute per-user base
  function userDir(userId) {
    return path.join(baseDir, String(userId));
  }

  async function ensureUserDir(userId) {
    const dir = userDir(userId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  // get size used by a user's dir (recursive)
  async function _dirSize(dir) {
    let total = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isFile()) {
          const st = await fs.stat(full);
          total += st.size;
        } else if (e.isDirectory()) {
          total += await _dirSize(full);
        }
      }
    } catch (e) {
      if (e.code === 'ENOENT') return 0;
      throw e;
    }
    return total;
  }

  async function usedBytes(userId) {
    const dir = userDir(userId);
    return await _dirSize(dir);
  }

  async function quotaRemaining(userId) {
    const used = await usedBytes(userId);
    const remain = Math.max(0, quotaBytes - used);
    return { used, remain, quota: quotaBytes };
  }

  // sanitize filename (prevent path traversal)
  function safeFilename(name) {
    return name.replace(/[\x00<>:"\/\\|?*\x00-\x1F]/g, '_').slice(0, 200);
  }

  // write buffer/stream to a file in user's dir at optional relativePath
  async function saveFileFromBuffer(userId, filename, bufferOrUint8Array) {
    const safe = safeFilename(filename || `file-${Date.now()}`);
    const dir = await ensureUserDir(userId);
    const dest = path.join(dir, safe);
    // check quota
    const currentUsed = await usedBytes(userId);
    const newSize = bufferOrUint8Array.length;
    if (currentUsed + newSize > quotaBytes) {
      const allowed = Math.max(0, quotaBytes - currentUsed);
      throw new Error(`QuotaExceeded: file would exceed quota. allowed: ${human(allowed)}`);
    }

    await fs.writeFile(dest, bufferOrUint8Array);
    return { path: dest, name: safe, size: newSize };
  }

  // save a readable stream (if you use fetch.body)
  async function saveFileFromStream(userId, filename, stream) {
    const safe = safeFilename(filename || `file-${Date.now()}`);
    const dir = await ensureUserDir(userId);
    const dest = path.join(dir, safe);

    // create temporary file and stream into it, counting bytes
    const tmp = dest + '.tmp-' + crypto.randomBytes(6).toString('hex');
    const w = require('node:fs').createWriteStream(tmp);
    return new Promise((resolve, reject) => {
      let written = 0;
      stream.on('data', (chunk) => {
        written += chunk.length;
        // optimistic check: if written > quota, we can abort
        // but precise check uses actual disk usage
      });
      stream.pipe(w);
      w.on('finish', async () => {
        try {
          // ensure quota after full write
          const currentUsed = await usedBytes(userId);
          if (currentUsed + written > quotaBytes) {
            await fs.unlink(tmp).catch(()=>{});
            const allowed = Math.max(0, quotaBytes - currentUsed);
            return reject(new Error(`QuotaExceeded: file would exceed quota. allowed: ${human(allowed)}`));
          }
          await fs.rename(tmp, dest);
          resolve({ path: dest, name: safe, size: written });
        } catch (e) {
          await fs.unlink(tmp).catch(()=>{});
          reject(e);
        }
      });
      w.on('error', (err) => {
        fs.unlink(tmp).catch(()=>{});
        reject(err);
      });
      stream.on('error', (err) => {
        w.destroy();
        fs.unlink(tmp).catch(()=>{});
        reject(err);
      });
    });
  }

  // remove a file relative to user's dir
  async function removeFile(userId, filename) {
    const dir = userDir(userId);
    const full = path.join(dir, filename);
    // prevent path traversal
    if (!full.startsWith(path.resolve(dir))) throw new Error('Invalid filename');
    try {
      await fs.unlink(full);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  }

  async function listFiles(userId, relPath = '.') {
    const dir = path.join(userDir(userId), relPath);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile()
      }));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  // VirusTotal scan stub. If VIRUSTOTAL_KEY is present, attempt to upload file for scanning.
  // NOTE: This uses global fetch (Node 18+). If you plan to use VT, set VIRUSTOTAL_KEY in env.
  async function virusScan(filePath) {
    if (!enableVirusCheck) return { status: 'skipped', reason: 'virus checks disabled in config' };
    const key = process.env.VIRUSTOTAL_KEY || process.env.VT_API_KEY;
    if (!key) return { status: 'skipped', reason: 'no VIRUSTOTAL_KEY provided' };

    // Best-effort: upload file and request analysis. This is a best-effort implementation;
    // for production you'd want better error handling, rate-limit handling, etc.
    try {
      const form = new (require('form-data'))();
      const st = await fs.stat(filePath);
      const rs = require('node:fs').createReadStream(filePath);
      form.append('file', rs, { knownLength: st.size, filename: path.basename(filePath) });

      const res = await fetch('https://www.virustotal.com/api/v3/files', {
        method: 'POST',
        headers: {
          'x-apikey': key
        },
        body: form
      });

      if (!res.ok) {
        const txt = await res.text().catch(()=>null);
        return { status: 'error', http: res.status, text: txt || 'upload failed' };
      }
      const json = await res.json();
      // return the analysis id / meta. Consumer can poll
      return { status: 'uploaded', id: json.data?.id || null, meta: json.data || null };
    } catch (e) {
      return { status: 'error', error: String(e) };
    }
  }

  return {
    // low-level ops
    ensureUserDir,
    usedBytes,
    quotaRemaining,
    saveFileFromBuffer,
    saveFileFromStream,
    removeFile,
    listFiles,
    virusScan,
    // metadata
    baseDir,
    quotaBytes,
    human
  };
};
