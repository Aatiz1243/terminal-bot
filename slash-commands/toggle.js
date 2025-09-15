// toggle.js
// Toggle module that manages where $ commands are allowed.
// Exports initializer function and also `module.exports.command` (SlashCommandBuilder).
//
// Behavior:
//  - /toggle enable <channel>  -> enables $ commands in that channel (removes from disabled list).
//  - /toggle disable <channel> -> disables $ commands in that channel (adds to disabled list).
//  - /toggle list              -> ephemeral list showing disabled channels and whitelist (legacy).
//  - Only users with Manage Server (or Administrator) may run the command.
//  - Replies are ephemeral so only the invoker sees them.
//
// Usage:
//   const toggleModule = require('./toggle')(client, { /*opts*/ });
//   toggleModule.isChannelEnabled(guildId, channelId);

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = function initToggleModule(client, opts = {}) {
  // legacy optional whitelist map (guildId => Set(channelId))
  const enabledChannels = opts.enabledChannels || new Map();
  // primary blacklist store (guildId => Set(channelId))
  const disabledChannels = new Map();

  function ensureDisabledSet(guildId) {
    if (!disabledChannels.has(guildId)) disabledChannels.set(guildId, new Set());
    return disabledChannels.get(guildId);
  }

  function ensureEnabledSet(guildId) {
    if (!enabledChannels.has(guildId)) enabledChannels.set(guildId, new Set());
    return enabledChannels.get(guildId);
  }

  /**
   * Returns true if $ commands are allowed in the provided channel.
   * Logic:
   *  - If channel is present in disabledChannels => false
   *  - Else if enabledChannels (whitelist) has entries => channel must be present there
   *  - Else => true (default allow)
   */
  function isChannelEnabled(guildId, channelId) {
    if (!guildId || !channelId) return true;
    const ds = disabledChannels.get(guildId);
    if (ds && ds.has(channelId)) return false;
    const es = enabledChannels.get(guildId);
    if (es && es.size > 0) return es.has(channelId);
    return true;
  }

  // Interaction handler for /toggle
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isChatInputCommand?.()) return;
      if (interaction.commandName !== 'toggle') return;

      // Permission: require ManageGuild or Administrator
      const perms = interaction.memberPermissions || (interaction.member && interaction.member.permissions);
      if (!perms || typeof perms.has !== 'function' || (!perms.has(PermissionsBitField.Flags.ManageGuild) && !perms.has(PermissionsBitField.Flags.Administrator))) {
        await interaction.reply({ content: 'You need Manage Server or Administrator permission to use /toggle.', ephemeral: true });
        return;
      }

      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        return;
      }

      // enable / disable expect exactly one channel
      if (sub === 'enable' || sub === 'disable') {
        const channel = interaction.options.getChannel('channel', true);
        if (!channel) {
          await interaction.reply({ content: 'You must provide a channel to enable/disable.', ephemeral: true });
          return;
        }

        // Determine if channel is text-based (compatible with multiple discord.js versions)
        const isText = (typeof channel.isTextBased === 'function') ? channel.isTextBased() : !!channel.isTextBased;
        if (!isText) {
          // Non-text channels can't host $ commands; respond ephemerally and stop.
          await interaction.reply({ content: `That channel (${channel}) is not a text channel. Please pick a text channel.`, ephemeral: true });
          return;
        }

        const ds = ensureDisabledSet(guildId);

        if (sub === 'disable') {
          if (ds.has(channel.id)) {
            await interaction.reply({ content: `⛔ Commands are already disabled in ${channel}.`, ephemeral: true });
            return;
          }
          ds.add(channel.id);
          await interaction.reply({ content: `⛔ Commands have been disabled in ${channel}.`, ephemeral: true });
          return;
        } else { // enable
          if (!ds.has(channel.id)) {
            await interaction.reply({ content: `✅ Commands are already enabled in ${channel}.`, ephemeral: true });
            return;
          }
          ds.delete(channel.id);
          await interaction.reply({ content: `✅ Commands have been enabled in ${channel}.`, ephemeral: true });
          return;
        }
      }

      // list subcommand: show disabled channels and whitelist if any (ephemeral)
      if (sub === 'list') {
        const ds = disabledChannels.get(guildId);
        const es = enabledChannels.get(guildId);
        const lines = [];

        if (ds && ds.size > 0) {
          lines.push('**Disabled channels (commands blocked):**');
          for (const id of ds) {
            const ch = interaction.guild?.channels?.cache?.get(id);
            lines.push(ch ? `• ${ch} (${id})` : `• ${id}`);
          }
        } else {
          lines.push('**Disabled channels (commands blocked):** (none)');
        }

        if (es && es.size > 0) {
          lines.push('\n**Whitelist (explicitly enabled) channels:**');
          for (const id of es) {
            const ch = interaction.guild?.channels?.cache?.get(id);
            lines.push(ch ? `• ${ch} (${id})` : `• ${id}`);
          }
        } else {
          lines.push('\n**Whitelist (explicitly enabled) channels:** (none)');
        }

        await interaction.reply({ content: lines.join('\n'), ephemeral: true });
        return;
      }

      // fallback
      await interaction.reply({ content: 'Unknown subcommand. Use `/toggle enable|disable <channel>` or `/toggle list`.', ephemeral: true });
    } catch (err) {
      console.error('[toggle] interaction handler error:', err);
      try {
        if (!interaction.replied) await interaction.reply({ content: 'Error handling /toggle command.', ephemeral: true });
      } catch (_) {}
    }
  });

  // return module API
  return {
    disabledChannels,
    enabledChannels,
    ensureDisabledSet,
    ensureEnabledSet,
    isChannelEnabled
  };
};

// Provide SlashCommandBuilder for deploy script to register
module.exports.command = new SlashCommandBuilder()
  .setName('toggle')
  .setDescription('Enable/disable $ commands in a single channel, or list current toggles for this server.')
  .addSubcommand(sub => sub
    .setName('enable')
    .setDescription('Enable $ commands in a channel')
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to enable').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('disable')
    .setDescription('Disable $ commands in a channel')
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to disable').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('List disabled/enabled channels for this server'));
