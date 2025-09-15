# Terminal — A Multipurpose Discord Bot

Terminal is a terminal-styled, multipurpose Discord bot implemented in Node.js using discord.js.  
It provides a simulated command-line experience inside Discord, a set of slash commands, per-user sandboxed storage features, and playful utilities intended for community servers.

---

## Project overview

Terminal combines retro terminal aesthetics with modern Discord interactions. It offers:

- Console-style `$` commands that simulate shell utilities.
- Discord-native slash commands for discoverability and privacy-aware operations.
- A playful `sudo` subsystem including a simulated "hack" experience (non-destructive).
- A personal firewall mechanism to opt into protection against simulated attacks.
- An experimental user-scoped storage system (per-user virtual directories, upload handling).
- Toggle controls to enable or disable console commands on a per-channel basis.

This project is designed for servers that want a fun, interactive bot with a strong privacy posture and configurable behavior.

---

## Key features

### Terminal simulation
- `$ls`, `$cd`, `$pwd`, `$cat`, `$touch`, `$mkdir`, `$rm` and more that simulate file-system interactions per user.
- Console-style prompt rendering and progressive text/typing animations to mimic a terminal console.

### Slash commands
- `/help` — concise embed with command summary (ephemeral reply).
- `/toggle` — enable/disable console commands in a single channel; list toggles (ephemeral).
- `/firewall` — per-user, privacy-preserving firewall toggle (ephemeral). Users may only toggle protection for themselves.

### Fun utilities
- `$sudo` subcommands: `fortune`, `joke`, `coffee`, `random`, `install`, `update`, `passwd`, and the playful `hack` simulator.
- `$roll`, `$flip`, `$choose`, `$banner`, `$calc` and more.

### Privacy & safety
- Personal firewall: each user can opt in to prevent playful simulations targeting them. This is enforced server-side by the bot.
- All slash command responses for privacy-sensitive actions are ephemeral (visible only to the invoker).
- Storage is per-user and isolated; files and directories are only accessible to their owner.
- Upload handling is designed to integrate with scanning services (VirusTotal or similar) before allowing execution.

### Storage subsystem (experimental)
- Virtual per-user workspace where users can upload files, list their directory, and run safe, sandboxed actions.
- Per-user quotas (configurable), for example limited to an 800 MB maximum per user.
- Commands like `$storage`, `$ls`, `$cd`, `$upload` (conceptual) map to personal storage management.
- Files uploaded as images/videos can be rendered as ASCII art (optional feature) for display in the terminal UI.

---

## Commands reference

The bot provides both slash commands and a set of `$` console commands. Slash commands are intentionally minimal and privacy-aware; most interactive functionality is exposed via `$` commands for the terminal experience.

### Slash commands (ephemeral responses for privacy)
- `/help` — Show bot description and available commands (ephemeral).
- `/toggle enable <channel>` — Enable `$` commands in a channel (requires Manage Server). Ephemeral confirmation.
- `/toggle disable <channel>` — Disable `$` commands in a channel (requires Manage Server). Ephemeral confirmation.
- `/toggle list` — List disabled and explicitly enabled channels (ephemeral).
- `/firewall on` — Turn on your personal firewall for the server (ephemeral).
- `/firewall off` — Turn off your personal firewall for the server (ephemeral).

### `$` console commands (displayed as terminal blocks in chat)
- `$help` — Show console-style help (non-ephemeral).
- `$ls` — List files in your current virtual directory.
- `$pwd` — Show current virtual working directory.
- `$cd <path>` — Change current virtual working directory.
- `$cat <file>` — Show file contents (simulated / user-scoped).
- `$touch <file>` — Create an empty file in your workspace (simulated).
- `$mkdir <folder>` — Create a new folder in your workspace (simulated).
- `$rm <file>` — Remove a file from your workspace (simulated; destructive ops are limited/blocked for safety).
- `$tree` — Show a directory tree (simulated).
- `$history` — Show recent commands executed by you (user-scoped).
- `$ping` — Show latency and API ping.
- `$uptime` — Show bot uptime.
- `$whoami` — Show your username.
- `$roll NdM` — Roll dice, e.g., `2d6`.
- `$flip` — Coin flip.
- `$choose a | b | c` — Randomly pick one.
- `$calc <expr>` — Evaluate a safe arithmetic expression.
- `$sudo <subcommand>` — Run playful sudo-like actions; includes `hack <target>` which is a simulated, non-destructive flow.

> Note: The `hack` simulation is non-destructive, always safe, respects firewall protection and role hierarchy, and performs only cosmetic nickname changes when permitted by permissions. The bot never attempts harmful or unauthorized actions.

---

## Architecture & components

This repository follows a modular architecture:

- `index.js` — Primary entry: bot client instantiation, command registry, message and interaction routing.
- `status.js` — Presence updater; rotates the bot's status.
- `slash-commands/` — Slash command definitions and deploy helpers (e.g., `toggle.js`, `help.js`).
- `commands/` — Per-feature command modules, including `sudo/` subcommands and `firewall`.
- `storage/` — Experimental per-user storage system:
  - `head.js` — initializer and public API for storage subsystem.
  - `api.js` — internal file handling, potential integration with scanning services.
  - `cmds.js` — example console commands wired to storage (upload/list/run in sandbox).
  - `README.md` — storage usage notes.
- `deploy-commands.js` / `remove-commands.js` — utilities to (re)deploy or remove global slash commands in a merge-friendly manner.

---

## Configuration & customization

The core of Terminal is configurable through a central configuration file or environment variables. Typical configurable items include:

- Storage options:
  - `baseDir` — Base path for user data storage.
  - `quotaBytes` — Per-user storage quota (default example: 800 MB).
- Timing/pacing constants for the simulated typing/hack flows:
  - `HACK_DELAY_MS`, `DEFAULT_DELAY_MS`, `TYPING_CHAR_MS`, `TYPING_BETWEEN_FIELDS_MS`.

The project exposes initializers and modules so integrators can override behavior (for example, plugging in a storage backend, changing animation timing, or swapping VirusTotal for another scanner).

---

## Security, safety, and privacy design

Terminal was designed with the following principles:

1. **User isolation**: Storage and file listings are per-user only; no other user can see or access another user’s files.
2. **Ephemeral replies for privacy-sensitive actions**: Slash commands that change state or control privacy (like `/firewall` and `/toggle`) reply ephemerally so only the invoking user sees confirmation.
3. **Opt-in protection**: Personal firewall is strictly opt-in and only togglable by the user themselves.
4. **Permission checks**: Management operations such as changing nicknames or toggling server-wide settings require appropriate server permissions and will gracefully refuse when not possible.
5. **Scan-before-execute policy (recommended)**: For any feature that would execute or open uploaded files on the host, the system should scan uploads via VirusTotal (or similar) and refuse files flagged as unsafe. Execution of uploaded code must be sandboxed and disabled by default.
6. **Quota enforcement**: Per-user disk quotas to prevent abuse and to keep resource usage predictable.

---

## Storage subsystem (design notes)

The storage subsystem aims to provide a safe, per-user virtual workspace:

- Each user gets a root workspace isolated by user ID.
- File metadata is tracked in a lightweight manifest; uploads are stored under the bot's `baseDir`.
- The subsystem exposes an API for:
  - Uploading files (with optional pre-scan).
  - Listing directories.
  - Reading file contents (subject to permissions and safety checks).
  - Enforcing per-user quotas.
- Recommended workflow for uploaded executables or scripts:
  1. Immediately scan with an external malware scanning API.
  2. If the file is clean, store it and register metadata.
  3. Disallow direct execution by default; provide a safe, restricted sandbox for optional execution with strict resource/time limits and clear admins-only controls.

---

## Contributing policy

Contributions are welcome, with the following rules:

- Provide clear PR descriptions and targeted changes.
- Respect the project license and attribution requirements (see License).
- Do not add code that performs destructive actions or bypasses Discord policy.
- Tests and documentation updates are strongly encouraged for substantial changes.

---

## Issue reporting and support

When reporting an issue or requesting a feature, include:

- A short description of expected vs. actual behavior.
- Steps to reproduce (where applicable).
- Relevant logs and environment details (Node.js version, discord.js version).
- Any configuration snippets relevant to the problem.

---

## License summary

This repository is distributed under the Apache License, Version 2.0.  
Key points:

- You may use, modify, and redistribute the code.
- You must include the LICENSE file and preserve any existing copyright notices.
- Modifications are permitted, but others must also receive the same license terms when distributing derivative works (see the full license for details).

Refer to the `LICENSE` file in this repository for the complete legal text.

---

## Roadmap and future ideas

Planned and suggested improvements include:

- Full VirusTotal (or comparable) integration for automatic scanning of uploaded files.
- A safe sandbox runtime for optionally executing user-submitted scripts with strict limits.
- ASCII rendering and playback for uploaded images and short videos.
- An extensible plugin/extension system so communities can register custom terminal commands that run in sandboxed contexts.
- Per-user encryption for stored files to enhance privacy.
- Web dashboard for users to browse their virtual workspace outside Discord (optional, auth-protected).

---

## Attribution

Primary development: Aatiz (project owner).  
Contributors should be listed in the repository's CONTRIBUTORS file or in individual commit histories.

---

## Notes

- Slash command registration across Discord is subject to global propagation delays; changes to global command definitions may take time to appear.
- The bot intentionally keeps privacy-sensitive interactions ephemeral and user-scoped to minimize accidental information disclosure.

