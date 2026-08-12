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
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

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

            await interaction.reply({
                content: `🔒 **${voiceChannel.name}** ${occupancy} is now locked.`
            });
        }

        else if (commandName === 'unlock') {
            await voiceChannel.permissionOverwrites.edit(VERIFIED_ROLE_ID, { Connect: null });
            await voiceChannel.permissionOverwrites.edit(MEMBER_ROLE_ID, { Connect: null });

            await interaction.reply({
                content: `🔓 **${voiceChannel.name}** ${occupancy} is now unlocked.`
            });
        }
    } catch (error) {
        console.error('Error modifying permissions:', error);
        await interaction.reply({
            content: 'Failed to edit channel permissions. Check my role position and permissions!',
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
});

client.login(TOKEN);