# storage/ - local per-user storage for Terminal bot

Overview
--------
This folder provides a simple per-user storage system:
- Each user has a directory at `<baseDir>/<userId>/`
- Default baseDir is `./data/users` (relative to project root)
- Default quota: 800 MB per user

Files
-----
- head.js  - initializer: `initStorage(client, opts)` (returns {api, cmds, shutdown})
- api.js   - low-level filesystem API + optional VirusTotal upload stub
- cmds.js  - message-based commands handlers ($upload, $ls, $cd, $pwd, $rm, $storageinfo)

How to use
----------
In your `index.js`:
```js
const initStorage = require('./storage/head');
(async () => {
  const storage = await initStorage(client, { prefix: '$', baseDir: './data/users', quotaBytes: 800*1024*1024 });
  // storage.api and storage.cmds are available for programmatic use
})();
