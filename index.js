// Import required libraries
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder, ButtonStyle, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const { exec } = require('child_process');
const config = require('./config.json');

// Initialize Discord client with necessary intents
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ] 
});

// Path to whitelist file (adjust as needed)
const WHITELIST_PATH = config.minecraftWhitelistPath || './whitelist.json';

// Store pending applications
const pendingApplications = new Map();

// Bot startup
client.once('ready', () => {
  console.log(`Bot is online as ${client.user.tag}!`);
});

// Register slash commands when bot starts
client.on('ready', async () => {
  try {
    const commands = [
      {
        name: 'setup-whitelist',
        description: 'Set up the whitelist application system',
        defaultMemberPermissions: PermissionFlagsBits.Administrator
      },
      {
        name: 'apply',
        description: 'Apply for the Minecraft server whitelist'
      }
    ];
    
    await client.application.commands.set(commands);
    console.log('Slash commands registered');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'setup-whitelist') {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'You need administrator permissions to use this command.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor('#00AA00')
      .setTitle('Minecraft Server Whitelist Application')
      .setDescription('Click the button below to apply for our Minecraft server whitelist.')
      .setFooter({ text: 'Your application will be reviewed by an administrator.' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('open_application')
          .setLabel('Apply for Whitelist')
          .setStyle(ButtonStyle.Primary)
      );

    await interaction.reply({ embeds: [embed], components: [row] });
  }
  
  else if (commandName === 'apply') {
    showApplicationModal(interaction);
  }
});

// Handle button interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const { customId } = interaction;

  if (customId === 'open_application') {
    showApplicationModal(interaction);
  }
  
  else if (customId.startsWith('approve_')) {
    // Check if user has the staff role
    const staffRoleId = config.staffRoleId;
    const hasStaffRole = interaction.member.roles.cache.has(staffRoleId);
    
    if (!hasStaffRole) {
      return interaction.reply({ 
        content: 'You need the staff role to approve whitelist applications.', 
        ephemeral: true 
      });
    }
    
    const userId = customId.replace('approve_', '');
    const applicationData = pendingApplications.get(userId);
    
    if (!applicationData) {
      return interaction.reply({ 
        content: 'This application no longer exists or has already been processed.', 
        ephemeral: true 
      });
    }

    try {
      // First acknowledge the interaction to prevent timeout
      await interaction.deferUpdate();
      
      const guild = interaction.guild;
      const member = await guild.members.fetch(userId).catch(err => {
        console.error('Could not fetch member:', err);
        return null;
      });
      
      if (!member) {
        return interaction.editReply({ content: 'Error: Could not find this user in the server anymore.', components: [] });
      }
      
      // Find existing role or create a new one
      let whitelistRole = guild.roles.cache.find(role => role.name === config.whitelistRoleName);
      
      if (!whitelistRole) {
        try {
          whitelistRole = await guild.roles.create({
            name: config.whitelistRoleName,
            color: 'GREEN',
            reason: 'Created for Minecraft whitelist system'
          });
          console.log(`Created new role: ${config.whitelistRoleName}`);
        } catch (roleError) {
          console.error('Failed to create role:', roleError);
          return interaction.editReply({ 
            content: `Error: Could not create the whitelist role. Make sure the bot has the "Manage Roles" permission.`,
            components: [] 
          });
        }
      }
      
      // Add role to member with improved error handling
      try {
        await member.roles.add(whitelistRole);
        console.log(`Added role ${whitelistRole.name} to user ${member.user.tag}`);
      } catch (roleError) {
        console.error('Error adding role:', roleError);
        return interaction.editReply({ 
          content: `Error adding role: ${roleError.message}. This might be due to role hierarchy - make sure the bot's role is higher than the whitelist role.`,
          components: [] 
        });
      }
      
      // Add to Minecraft whitelist
      addToMinecraftWhitelist(applicationData.minecraftUsername);
      
      // Try to DM the user but don't fail if it doesn't work
      try {
        await member.send({
          embeds: [
            new EmbedBuilder()
              .setColor('#00AA00')
              .setTitle('Whitelist Application Approved')
              .setDescription(`Your application for our Minecraft server has been approved by ${interaction.user.tag}!\nYou can now connect to the server: \`${config.serverIp}\``)
          ]
        });
      } catch (dmError) {
        console.log(`Could not DM user ${member.user.tag}, they may have DMs disabled`);
        // Continue with the process even if DM fails
      }
      
      // Update the original message
      const approvalEmbed = new EmbedBuilder()
        .setColor('#00AA00')
        .setTitle('Application Approved')
        .setDescription(`Application from <@${userId}> has been approved by <@${interaction.user.id}>.`)
        .addFields(
          { name: 'Minecraft Username', value: applicationData.minecraftUsername },
          { name: 'Discord User', value: `<@${userId}>` }
        );
      
      await interaction.editReply({ embeds: [approvalEmbed], components: [] });
      pendingApplications.delete(userId);
      
    } catch (error) {
      console.error('General error handling approval:', error);
      // If we've already acknowledged the interaction, edit the reply
      if (interaction.deferred) {
        return interaction.editReply({ 
          content: `An error occurred: ${error.message}. Please check bot permissions and role hierarchy.`,
          components: [] 
        });
      } else {
        // Otherwise send an ephemeral reply
        return interaction.reply({ 
          content: `An error occurred: ${error.message}. Please check bot permissions and role hierarchy.`,
          ephemeral: true 
        });
      }
    }
  }
  
  else if (customId.startsWith('reject_')) {
    // Check if user has the staff role
    const staffRoleId = config.staffRoleId;
    const hasStaffRole = interaction.member.roles.cache.has(staffRoleId);
    
    if (!hasStaffRole) {
      return interaction.reply({ 
        content: 'You need the staff role to reject whitelist applications.', 
        ephemeral: true 
      });
    }
    
    const userId = customId.replace('reject_', '');
    const applicationData = pendingApplications.get(userId);
    
    if (!applicationData) {
      return interaction.reply({ content: 'This application no longer exists or has already been processed.', ephemeral: true });
    }

    // Show rejection reason modal
    const modal = new ModalBuilder()
      .setCustomId(`rejection_reason_${userId}`)
      .setTitle('Application Rejection');
    
    const reasonInput = new TextInputBuilder()
      .setCustomId('rejection_reason')
      .setLabel('Reason for rejection')
      .setPlaceholder('Please provide a reason for rejecting this application')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    
    const row = new ActionRowBuilder().addComponents(reasonInput);
    modal.addComponents(row);
    
    await interaction.showModal(modal);
  }
});

// Handle modal submissions
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  
  const { customId } = interaction;

  // Handle whitelist application form submission
  if (customId === 'whitelist_application') {
    const minecraftUsername = interaction.fields.getTextInputValue('minecraft_username');
    const age = interaction.fields.getTextInputValue('age');
    const experience = interaction.fields.getTextInputValue('experience');
    const reasonToJoin = interaction.fields.getTextInputValue('reason_to_join');
    
    // Store application data
    pendingApplications.set(interaction.user.id, {
      minecraftUsername,
      age,
      experience,
      reasonToJoin,
      timestamp: new Date()
    });
    
    // Acknowledge submission
    await interaction.reply({ 
      content: 'Your application has been submitted and is pending review by administrators.',
      ephemeral: true 
    });
    
    // Create embed for administrators
    const adminEmbed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('New Whitelist Application')
      .setDescription(`A new whitelist application from <@${interaction.user.id}>`)
      .addFields(
        { name: 'Minecraft Username', value: minecraftUsername },
        { name: 'Age', value: age },
        { name: 'Minecraft Experience', value: experience },
        { name: 'Reason to Join', value: reasonToJoin }
      )
      .setTimestamp();
    
    // Create approve/reject buttons
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${interaction.user.id}`)
          .setLabel('Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_${interaction.user.id}`)
          .setLabel('Reject')
          .setStyle(ButtonStyle.Danger)
      );
    
    // Send to admin channel
    const adminChannel = client.channels.cache.get(config.adminChannelId);
    if (adminChannel) {
      adminChannel.send({ embeds: [adminEmbed], components: [row] });
    } else {
      console.error('Admin channel not found');
      interaction.followUp({
        content: 'Error: Admin channel not configured properly. Please contact the server administrator.',
        ephemeral: true
      });
    }
  }
  
  // Handle rejection reason submission
  else if (customId.startsWith('rejection_reason_')) {
    const userId = customId.replace('rejection_reason_', '');
    const applicationData = pendingApplications.get(userId);
    
    if (!applicationData) {
      return interaction.reply({ content: 'This application no longer exists or has already been processed.', ephemeral: true });
    }
    
    const reason = interaction.fields.getTextInputValue('rejection_reason');
    
    // Notify the applicant
    try {
      await interaction.deferUpdate();
      
      const guild = interaction.guild;
      const member = await guild.members.fetch(userId).catch(err => {
        console.error('Could not fetch member:', err);
        return null;
      });
      
      if (member) {
        try {
          await member.send({
            embeds: [
              new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Whitelist Application Rejected')
                .setDescription(`Your application for our Minecraft server has been rejected by ${interaction.user.tag}.`)
                .addFields({ name: 'Reason', value: reason })
            ]
          });
        } catch (err) {
          console.error('Could not DM the user:', err);
        }
      }
      
      // Update the original message
      const rejectionEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Application Rejected')
        .setDescription(`Application from <@${userId}> has been rejected by <@${interaction.user.id}>.`)
        .addFields(
          { name: 'Minecraft Username', value: applicationData.minecraftUsername },
          { name: 'Reason for Rejection', value: reason }
        );
      
      await interaction.editReply({ embeds: [rejectionEmbed], components: [] });
      pendingApplications.delete(userId);
    } catch (error) {
      console.error('Error handling rejection:', error);
      if (interaction.deferred) {
        return interaction.editReply({ 
          content: `An error occurred: ${error.message}.`,
          components: [] 
        });
      } else {
        return interaction.reply({ 
          content: `An error occurred: ${error.message}.`, 
          ephemeral: true 
        });
      }
    }
  }
});

// Function to show the application modal
async function showApplicationModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('whitelist_application')
    .setTitle('Minecraft Server Whitelist Application');
  
  // Create inputs
  const minecraftUsernameInput = new TextInputBuilder()
    .setCustomId('minecraft_username')
    .setLabel('Minecraft Username')
    .setPlaceholder('Enter your Minecraft username')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  
  const ageInput = new TextInputBuilder()
    .setCustomId('age')
    .setLabel('Age')
    .setPlaceholder('How old are you?')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  
  const experienceInput = new TextInputBuilder()
    .setCustomId('experience')
    .setLabel('Minecraft Experience')
    .setPlaceholder('Tell us about your Minecraft experience')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);
  
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason_to_join')
    .setLabel('Reason to Join')
    .setPlaceholder('Why do you want to join our server?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);
  
  // Add inputs to the modal
  modal.addComponents(
    new ActionRowBuilder().addComponents(minecraftUsernameInput),
    new ActionRowBuilder().addComponents(ageInput),
    new ActionRowBuilder().addComponents(experienceInput),
    new ActionRowBuilder().addComponents(reasonInput)
  );
  
  // Show the modal
  await interaction.showModal(modal);
}

// Function to add player to Minecraft whitelist
function addToMinecraftWhitelist(username) {
  try {
    // Read current whitelist
    let whitelist = [];
    if (fs.existsSync(WHITELIST_PATH)) {
      const data = fs.readFileSync(WHITELIST_PATH);
      whitelist = JSON.parse(data);
    }
    
    // Check if player is already in whitelist
    const playerExists = whitelist.some(player => player.name.toLowerCase() === username.toLowerCase());
    
    if (!playerExists) {
      // Add player to whitelist
      whitelist.push({
        uuid: "placeholder", // In a real scenario, you'd fetch the UUID from Mojang API
        name: username
      });
      
      // Write updated whitelist
      fs.writeFileSync(WHITELIST_PATH, JSON.stringify(whitelist, null, 2));
      
      // Use server console to reload whitelist (if running on same machine)
      if (config.useMinecraftCommand) {
        exec(`screen -S ${config.minecraftScreenName} -X stuff "whitelist reload\n"`);
      }
      
      console.log(`Added ${username} to whitelist`);
    } else {
      console.log(`${username} is already on the whitelist`);
    }
  } catch (error) {
    console.error('Error adding player to whitelist:', error);
  }
}

// Function to fetch UUID from Mojang API (optional improvement)
async function fetchMinecraftUUID(username) {
  try {
    const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (response.ok) {
      const data = await response.json();
      return data.id;
    }
    return null;
  } catch (error) {
    console.error('Error fetching UUID:', error);
    return null;
  }
}

// Login to Discord with the bot token
client.login(config.token);