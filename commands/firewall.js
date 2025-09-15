// commands/firewall.js
// Private per-user firewall protection (self-only).
// Usage:
//
// const initFirewall = require('./commands/firewall');
// const fw = initFirewall();
// fw.protect(guildId, userId);
// fw.unprotect(guildId, userId);
// fw.isProtected(guildId, userId);
//
// The module also exports:
//   .command  -> SlashCommandBuilder for /firewall (on/off) (self-only)
//   .handleInteraction(interaction, fwInstance) -> helper to handle slash interaction (ephemeral)

const { SlashCommandBuilder } = require('discord.js');

function initFirewall() {
  // Map<guildId, Set<userId>>
  const map = new Map();

  function ensure(guildId) {
    if (!map.has(guildId)) map.set(guildId, new Set());
    return map.get(guildId);
  }

  function protect(guildId, userId) {
    if (!guildId || !userId) return;
    const s = ensure(guildId);
    s.add(userId);
  }

  function unprotect(guildId, userId) {
    if (!guildId || !userId) return;
    const s = ensure(guildId);
    s.delete(userId);
  }

  function isProtected(guildId, userId) {
    if (!guildId || !userId) return false;
    const s = map.get(guildId);
    return s ? s.has(userId) : false;
  }

  // Expose internals for debug or admin inspection if needed
  return {
    protect,
    unprotect,
    isProtected,
    _map: map
  };
}

module.exports = initFirewall;

// === Slash command builder (self-only /firewall on|off) ===
module.exports.command = new SlashCommandBuilder()
  .setName('firewall')
  .setDescription('Toggle your personal firewall protection (protect/unprotect yourself from playful hacks)')
  .addSubcommand(sub =>
    sub
      .setName('on')
      .setDescription('Turn ON your firewall (protect yourself)')
  )
  .addSubcommand(sub =>
    sub
      .setName('off')
      .setDescription('Turn OFF your firewall (remove your protection)')
  );

// === Helper to handle the interaction in your interactionCreate handler ===
// Accepts (interaction, fwInstance).
// fwInstance should be the object returned by initFirewall().
// This helper replies EPHEMERALLY so others can't see the action.
module.exports.handleInteraction = async function handleFirewallInteraction(interaction, fwInstance) {
  try {
    if (!interaction || !interaction.isChatInputCommand || !interaction.isChatInputCommand()) return false;
    if (interaction.commandName !== 'firewall') return false;

    // Must be used in a guild
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
      return true;
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    if (!fwInstance || typeof fwInstance.protect !== 'function' || typeof fwInstance.unprotect !== 'function') {
      await interaction.reply({ content: 'Firewall backend not available.', ephemeral: true });
      return true;
    }

    if (sub === 'on') {
      fwInstance.protect(guildId, userId);
      await interaction.reply({ content: '🔒 Your firewall is now **ON** — you are protected from playful hacks in this server. (Only you can control this.)', ephemeral: true });
      return true;
    } else if (sub === 'off') {
      fwInstance.unprotect(guildId, userId);
      await interaction.reply({ content: '🔓 Your firewall is now **OFF** — you can be targeted by playful hacks again if others try. (Only you can control this.)', ephemeral: true });
      return true;
    } else {
      await interaction.reply({ content: 'Unknown subcommand. Use `/firewall on` or `/firewall off`.', ephemeral: true });
      return true;
    }
  } catch (err) {
    console.error('[firewall] interaction handler error:', err);
    try { if (!interaction.replied) await interaction.reply({ content: 'Error handling /firewall command', ephemeral: true }); } catch (_) {}
    return true;
  }
};
