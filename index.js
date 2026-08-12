const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    PermissionFlagsBits,
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const commands = [
    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Locks your current voice channel for verified users.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlocks your current voice channel for verified users.')
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
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply({
            content: 'You must join a voice channel first to lock or unlock it',
            ephemeral: true
        });
    }

    try {
        if (commandName === 'lock') {
            await voiceChannel.permissionOverwrites.edit(VERIFIED_ROLE_ID, { Connect: false });
            await voiceChannel.permissionOverwrites.edit(MEMBER_ROLE_ID, { Connect: false });

            await interaction.reply({
                content: `🔒 **${voiceChannel.name}** is now locked.`
            });
        } 
        
        else if (commandName === 'unlock') {
            await voiceChannel.permissionOverwrites.edit(VERIFIED_ROLE_ID, { Connect: null });
            await voiceChannel.permissionOverwrites.edit(MEMBER_ROLE_ID, { Connect: null });

            await interaction.reply({
                content: `🔓 **${voiceChannel.name}** is now unlocked.`
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

client.login(TOKEN);