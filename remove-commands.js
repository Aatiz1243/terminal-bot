// remove-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // your bot's application ID

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing BOT_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Fetching all global application commands...');
    const commands = await rest.get(Routes.applicationCommands(CLIENT_ID));

    if (!commands || commands.length === 0) {
      console.log('⚠️ No global commands found.');
      return;
    }

    // Filter only the toggle command
    const toggleCommands = commands.filter(cmd => cmd.name === 'toggle');

    if (toggleCommands.length === 0) {
      console.log('✅ No /toggle command found to remove.');
      return;
    }

    for (const cmd of toggleCommands) {
      console.log(`Deleting global command: /${cmd.name} (id: ${cmd.id})`);
      await rest.delete(Routes.applicationCommand(CLIENT_ID, cmd.id));
    }

    console.log('🗑️ Successfully removed old /toggle commands.');
  } catch (error) {
    console.error('❌ Failed to remove commands:', error);
  }
})();
