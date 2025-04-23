// deploy-commands.js
const { REST, Routes } = require('discord.js');
const config = require('./config.json');

const commands = [
  {
    name: 'setup-whitelist',
    description: 'Set up the whitelist application system',
    default_member_permissions: '8' // Administrator permission
  },
  {
    name: 'apply',
    description: 'Apply for the Minecraft server whitelist'
  }
];

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    // For global commands
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commands },
    );

    // For guild-specific commands
    // await rest.put(
    //   Routes.applicationGuildCommands(config.clientId, config.guildId),
    //   { body: commands },
    // );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();