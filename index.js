const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    REST,
    Routes
} = require('discord.js');
const http = require('http');

require('dotenv').config();

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running.');
}).listen(PORT, () => console.log(`Health check server listening on port ${PORT}`));

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const commands = [
    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Locks a voice channel for verified users.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The voice channel to lock (defaults to your current channel)')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlocks a voice channel for verified users.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The voice channel to unlock (defaults to your current channel)')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('users')
        .setDescription('Lists the Roblox accounts of everyone in a voice channel.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The voice channel to list (defaults to your current channel)')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

const ROBLOX_NAME_PATTERN = /\(@([^)]+)\)/;

function getRobloxUsername(member) {
    const match = member.displayName.match(ROBLOX_NAME_PATTERN);
    return match ? match[1] : null;
}

const EMPTY_VC_CLEAR_DELAY_MS = 60 * 60 * 1000;
let emptyVcTimer = null;

function isGuildVoiceEmpty(guild) {
    return guild.channels.cache
        .filter(channel => channel.type === ChannelType.GuildVoice)
        .every(channel => channel.members.size === 0);
}

function isVoiceLogMessage(message) {
    return message.author.id === client.user.id &&
        (message.content.startsWith('🟢') || message.content.startsWith('🔴') || message.content.startsWith('🔀'));
}

async function clearLogChannel(guild) {
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    try {
        let fetchedCount;
        do {
            const messages = await logChannel.messages.fetch({ limit: 100 });
            fetchedCount = messages.size;
            if (fetchedCount === 0) break;

            const voiceLogMessages = messages.filter(isVoiceLogMessage);
            if (voiceLogMessages.size > 0) {
                await logChannel.bulkDelete(voiceLogMessages, true);
            }
        } while (fetchedCount === 100);

        console.log('Cleared voice join/leave log messages after 60 minutes of no voice activity.');
    } catch (error) {
        console.error('Error clearing log channel:', error);
    }
}

function refreshEmptyVcTimer(guild) {
    if (!LOG_CHANNEL_ID) return;

    if (isGuildVoiceEmpty(guild)) {
        if (!emptyVcTimer) {
            emptyVcTimer = setTimeout(() => {
                emptyVcTimer = null;
                clearLogChannel(guild);
            }, EMPTY_VC_CLEAR_DELAY_MS);
        }
    } else if (emptyVcTimer) {
        clearTimeout(emptyVcTimer);
        emptyVcTimer = null;
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log('Slash commands successfully registered!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) refreshEmptyVcTimer(guild);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member } = interaction;
    const voiceChannel = interaction.options.getChannel('channel') ?? member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply({
            content: 'You must join a voice channel first or specify one with the `channel` option.',
            ephemeral: true
        });
    }

    const occupancy = `(${voiceChannel.members.size}/${voiceChannel.userLimit || '∞'})`;

    try {
        if (commandName === 'lock') {
            await voiceChannel.permissionOverwrites.edit(VERIFIED_ROLE_ID, { Connect: false });
            await voiceChannel.permissionOverwrites.edit(MEMBER_ROLE_ID, { Connect: false });

            const lockMessage = `🔒 **${voiceChannel.name}** ${occupancy} is now locked.`;
            await interaction.reply({ content: lockMessage });
            if (voiceChannel.id !== interaction.channelId) {
                await voiceChannel.send(lockMessage).catch(error =>
                    console.error('Error sending lock notice in voice chat:', error)
                );
            }
        }

        else if (commandName === 'unlock') {
            await voiceChannel.permissionOverwrites.edit(VERIFIED_ROLE_ID, { Connect: null });
            await voiceChannel.permissionOverwrites.edit(MEMBER_ROLE_ID, { Connect: null });

            const unlockMessage = `🔓 **${voiceChannel.name}** ${occupancy} is now unlocked.`;
            await interaction.reply({ content: unlockMessage });
            if (voiceChannel.id !== interaction.channelId) {
                await voiceChannel.send(unlockMessage).catch(error =>
                    console.error('Error sending unlock notice in voice chat:', error)
                );
            }
        }
        else if (commandName === 'users') {
            if (voiceChannel.members.size === 0) {
                return interaction.reply({
                    content: `**${voiceChannel.name}** is empty.`
                });
            }

            const lines = voiceChannel.members.map(vcMember => {
                const robloxUsername = getRobloxUsername(vcMember);
                return robloxUsername
                    ? `✅ ${vcMember.user.tag} → @${robloxUsername}`
                    : `no roblox user found for @${vcMember.user.username}`;
            });

            await interaction.reply({
                content: `**${voiceChannel.name}** ${occupancy}\n${lines.join('\n')}`
            });
        }
    } catch (error) {
        console.error(`Error handling /${commandName}:`, error);
        await interaction.reply({
            content: 'Something went wrong running that command. Check my role position and permissions!',
            ephemeral: true
        });
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!LOG_CHANNEL_ID) return;

    const logChannel = newState.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const member = newState.member ?? oldState.member;
    if (!member) return;

    let message = null;
    if (!oldState.channel && newState.channel) {
        message = `🟢 ${member.user.tag} joined ${newState.channel.name}`;

        const { userLimit, members } = newState.channel;
        if (userLimit > 0 && members.size > userLimit) {
            message += ` ⚠️ (bypassed limit, ${members.size}/${userLimit})`;
        }
    } else if (oldState.channel && !newState.channel) {
        message = `🔴 ${member.user.tag} left ${oldState.channel.name}`;
    } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        message = `🔀 **${member.user.tag}** moved from **${oldState.channel.name}** to **${newState.channel.name}**`;
    }

    if (message) {
        try {
            await logChannel.send(message);
        } catch (error) {
            console.error('Error sending voice log message:', error);
        }
    }

    refreshEmptyVcTimer(newState.guild);
});

client.login(TOKEN);