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
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const ROBLOX_OVERRIDES_PATH = path.join(__dirname, 'roblox-overrides.json');
let robloxOverrides = {};
try {
    const raw = JSON.parse(fs.readFileSync(ROBLOX_OVERRIDES_PATH, 'utf8'));
    delete raw._comment;
    robloxOverrides = raw;
} catch (error) {
    console.error('Error loading roblox-overrides.json:', error);
}

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
const BEDWARS_PLACE_ID = 6872265039;

function getRobloxUsername(member) {
    if (robloxOverrides[member.id]) return robloxOverrides[member.id];

    const match = member.displayName.match(ROBLOX_NAME_PATTERN);
    return match ? match[1] : null;
}

function formatMemberLabel(member) {
    const robloxUsername = getRobloxUsername(member);
    return robloxUsername ? `${member.user.tag} (@${robloxUsername})` : member.user.tag;
}

async function fetchRobloxUserIds(usernames) {
    const userIds = new Map();
    if (usernames.length === 0) return userIds;

    const response = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames, excludeBannedUsers: true })
    });
    const data = await response.json();

    for (const entry of data.data ?? []) {
        userIds.set(entry.requestedUsername.toLowerCase(), entry.id);
    }
    return userIds;
}

async function fetchRobloxPresence(userIds) {
    const presences = new Map();
    if (userIds.length === 0) return presences;

    const response = await fetch('https://presence.roblox.com/v1/presence/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds })
    });
    const data = await response.json();

    for (const presence of data.userPresences ?? []) {
        presences.set(presence.userId, presence);
    }
    return presences;
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
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.roles.everyone, { Connect: false });
            await voiceChannel.permissionOverwrites.edit(VERIFIED_ROLE_ID, { Connect: false });
            await voiceChannel.permissionOverwrites.edit(MEMBER_ROLE_ID, { Connect: false });

            const membersToKick = [...voiceChannel.members.values()];
            await Promise.all(membersToKick.map(vcMember =>
                vcMember.voice.disconnect('Voice channel locked').catch(error =>
                    console.error(`Error disconnecting ${vcMember.user.tag}:`, error)
                )
            ));

            const lockMessage = `🔒 **${voiceChannel.name}** ${occupancy} is now locked.` +
                (membersToKick.length ? ` Kicked ${membersToKick.length} member(s).` : '');
            await interaction.reply({ content: lockMessage });
            if (voiceChannel.id !== interaction.channelId) {
                await voiceChannel.send(lockMessage).catch(error =>
                    console.error('Error sending lock notice in voice chat:', error)
                );
            }
        }

        else if (commandName === 'unlock') {
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.roles.everyone, { Connect: null });
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

            await interaction.deferReply();

            const membersList = [...voiceChannel.members.values()];
            const robloxUsernames = membersList.map(getRobloxUsername);
            const invokerRobloxUsername = getRobloxUsername(member);

            const uniqueUsernames = [...new Set(
                [...robloxUsernames, invokerRobloxUsername].filter(Boolean)
            )];

            const userIds = await fetchRobloxUserIds(uniqueUsernames);
            const presences = await fetchRobloxPresence([...userIds.values()]);

            const invokerUserId = invokerRobloxUsername ? userIds.get(invokerRobloxUsername.toLowerCase()) : null;
            const invokerPresence = invokerUserId ? presences.get(invokerUserId) : null;
            const invokerGameId = invokerPresence?.rootPlaceId === BEDWARS_PLACE_ID ? invokerPresence.gameId : null;

            const lines = membersList.map((vcMember, i) => {
                const robloxUsername = robloxUsernames[i];
                if (!robloxUsername) {
                    return `no roblox user found for @${vcMember.user.username}`;
                }

                const userId = userIds.get(robloxUsername.toLowerCase());
                if (!userId) {
                    return `🔴 @${robloxUsername} (Roblox account not found)`;
                }

                const sameLobby = invokerGameId !== null && presences.get(userId)?.gameId === invokerGameId;
                const dot = sameLobby ? '🟢' : '🔴';
                return `${dot} @${robloxUsername}`;
            });

            const header = invokerGameId
                ? `**${voiceChannel.name}** ${occupancy} — matched against your Bedwars lobby`
                : `**${voiceChannel.name}** ${occupancy} — ⚠️ you're not currently in a Bedwars server, so no one can be matched`;

            await interaction.editReply({
                content: `${header}\n${lines.join('\n')}`
            });
        }
    } catch (error) {
        console.error(`Error handling /${commandName}:`, error);
        const errorMessage = {
            content: 'Something went wrong running that command. Check my role position and permissions!',
            ephemeral: true
        };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMessage).catch(() => {});
        } else {
            await interaction.reply(errorMessage).catch(() => {});
        }
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!LOG_CHANNEL_ID) return;

    const logChannel = newState.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const member = newState.member ?? oldState.member;
    if (!member) return;

    const memberLabel = formatMemberLabel(member);

    let message = null;
    if (!oldState.channel && newState.channel) {
        message = `🟢 ${memberLabel} joined ${newState.channel.name}`;

        const { userLimit, members } = newState.channel;
        if (userLimit > 0 && members.size > userLimit) {
            message += ` ⚠️ (bypassed limit, ${members.size}/${userLimit})`;
        }
    } else if (oldState.channel && !newState.channel) {
        message = `🔴 ${memberLabel} left ${oldState.channel.name}`;
    } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        message = `🔀 **${memberLabel}** moved from **${oldState.channel.name}** to **${newState.channel.name}**`;
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

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(TOKEN).catch(error => {
    console.error('Failed to log in to Discord:', error);
    process.exit(1);
});