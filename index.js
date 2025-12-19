const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder,
    REST,
    Routes
} = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    VoiceConnectionStatus, 
    entersState,
    getVoiceConnection
} = require('@discordjs/voice');
const play = require('play-dl');
const config = require('./config');
const fs = require('fs');

// สร้าง Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// เก็บข้อมูลคิวเพลงและห้องควบคุมของแต่ละเซิร์ฟเวอร์
const queues = new Map();
const musicChannels = new Map(); // เก็บ channel ID ที่ setup ไว้

// โหลดข้อมูลห้องควบคุมจากไฟล์
const dataFile = './music_channels.json';
function loadMusicChannels() {
    try {
        if (fs.existsSync(dataFile)) {
            const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            for (const [guildId, channelId] of Object.entries(data)) {
                musicChannels.set(guildId, channelId);
            }
            console.log('📁 โหลดข้อมูลห้องควบคุมเพลงเรียบร้อย');
        }
    } catch (error) {
        console.error('Error loading music channels:', error);
    }
}

function saveMusicChannels() {
    try {
        const data = Object.fromEntries(musicChannels);
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving music channels:', error);
    }
}

// สร้างคิวใหม่สำหรับเซิร์ฟเวอร์
function createQueue(guildId) {
    return {
        songs: [],
        player: createAudioPlayer(),
        connection: null,
        volume: config.defaultVolume,
        playing: false,
        loop: false,
        loopQueue: false,
        textChannel: null,
        controlMessage: null,
    };
}

// ฟังก์ชันแปลงเวลา
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDurationMs(ms) {
    return formatDuration(ms / 1000);
}

// สร้าง Embed สำหรับแสดงเพลงที่กำลังเล่น
function createNowPlayingEmbed(song, queue) {
    const embed = new EmbedBuilder()
        .setColor(config.colors.playing)
        .setAuthor({ name: '🎵 กำลังเล่น', iconURL: client.user.displayAvatarURL() })
        .setTitle(song.title)
        .setURL(song.url)
        .setThumbnail(song.thumbnail || client.user.displayAvatarURL())
        .addFields(
            { name: '⏱️ ความยาว', value: song.duration || 'ไม่ทราบ', inline: true },
            { name: '👤 ขอโดย', value: `<@${song.requestedBy}>`, inline: true },
            { name: '🎵 แหล่งที่มา', value: song.source || 'YouTube', inline: true },
            { name: '📊 คิว', value: `${queue.songs.length} เพลง`, inline: true },
            { name: '🔊 ระดับเสียง', value: `${queue.volume}%`, inline: true },
            { name: '🔁 Loop', value: queue.loop ? '✅ เปิด' : '❌ ปิด', inline: true }
        )
        .setFooter({ text: `🎶 พิมพ์ชื่อเพลงในห้องนี้เพื่อเพิ่มเพลง` })
        .setTimestamp();
    
    return embed;
}

// สร้าง Embed สำหรับห้องว่าง (ไม่มีเพลงเล่น)
function createIdleEmbed() {
    return new EmbedBuilder()
        .setColor(config.colors.info)
        .setAuthor({ name: '🎵 Music Player', iconURL: client.user.displayAvatarURL() })
        .setTitle('พร้อมเล่นเพลง!')
        .setDescription('```\n🎶 พิมพ์ชื่อเพลงหรือ URL ในห้องนี้เพื่อเริ่มเล่นเพลง\n\nรองรับ:\n• YouTube (ชื่อเพลง, URL, Playlist)\n• SoundCloud\n• และอื่นๆ\n```')
        .setImage('https://i.imgur.com/3bQm3qJ.gif')
        .setFooter({ text: '🎵 Music Bot | พิมพ์ชื่อเพลงเพื่อเริ่มต้น' })
        .setTimestamp();
}

// สร้างปุ่มควบคุม
function createControlButtons(queue) {
    const isPaused = queue?.player?.state?.status === AudioPlayerStatus.Paused;
    
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_shuffle')
                .setEmoji('🔀')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_previous')
                .setEmoji('⏮️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_playpause')
                .setEmoji(isPaused ? '▶️' : '⏸️')
                .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_stop')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_voldown')
                .setEmoji('🔉')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_volup')
                .setEmoji('🔊')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_loop')
                .setEmoji('🔁')
                .setStyle(queue?.loop ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_queue')
                .setEmoji('📋')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_lyrics')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Secondary)
        );

    return [row1, row2];
}

// อัพเดทข้อความควบคุม
async function updateControlMessage(guildId) {
    const queue = queues.get(guildId);
    if (!queue || !queue.textChannel) return;

    try {
        const embed = queue.songs.length > 0 
            ? createNowPlayingEmbed(queue.songs[0], queue)
            : createIdleEmbed();
        
        const buttons = createControlButtons(queue);

        if (queue.controlMessage) {
            await queue.controlMessage.edit({ embeds: [embed], components: buttons });
        } else {
            queue.controlMessage = await queue.textChannel.send({ embeds: [embed], components: buttons });
        }
    } catch (error) {
        console.error('Error updating control message:', error);
    }
}

// ฟังก์ชันเล่นเพลง
async function playSong(guildId, song) {
    const queue = queues.get(guildId);
    if (!song) {
        queue.playing = false;
        await updateControlMessage(guildId);
        return;
    }

    try {
        let stream;
        
        if (song.source === 'YouTube' || song.source === 'SoundCloud') {
            stream = await play.stream(song.url);
        } else {
            stream = await play.stream(song.url);
        }

        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true,
        });
        
        resource.volume?.setVolume(queue.volume / 100);
        
        queue.player.play(resource);
        queue.playing = true;
        queue.currentResource = resource;

        await updateControlMessage(guildId);

    } catch (error) {
        console.error('Error playing song:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(config.colors.error)
            .setDescription(`❌ ไม่สามารถเล่นเพลง **${song.title}** ได้\n\`${error.message}\``)
            .setTimestamp();
        
        queue.textChannel?.send({ embeds: [errorEmbed] }).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
        
        queue.songs.shift();
        if (queue.songs.length > 0) {
            playSong(guildId, queue.songs[0]);
        } else {
            await updateControlMessage(guildId);
        }
    }
}

// ฟังก์ชันค้นหาและเพิ่มเพลง
async function searchAndAddSong(query, guildId, userId, textChannel, voiceChannel) {
    let queue = queues.get(guildId);

    if (!queue) {
        queue = createQueue(guildId);
        queues.set(guildId, queue);
    }

    queue.textChannel = textChannel;

    try {
        let songInfo;
        let addedSongs = [];

        // ตรวจสอบว่าเป็น URL หรือไม่
        if (play.yt_validate(query) === 'video') {
            const info = await play.video_info(query);
            songInfo = {
                title: info.video_details.title,
                url: info.video_details.url,
                duration: info.video_details.durationRaw,
                durationSec: info.video_details.durationInSec,
                thumbnail: info.video_details.thumbnails[0]?.url || '',
                source: 'YouTube',
                requestedBy: userId,
            };
            addedSongs.push(songInfo);
        } else if (play.yt_validate(query) === 'playlist') {
            const playlist = await play.playlist_info(query, { incomplete: true });
            const videos = await playlist.all_videos();
            
            for (const video of videos.slice(0, 50)) { // จำกัด 50 เพลง
                addedSongs.push({
                    title: video.title,
                    url: video.url,
                    duration: video.durationRaw,
                    durationSec: video.durationInSec,
                    thumbnail: video.thumbnails[0]?.url || '',
                    source: 'YouTube',
                    requestedBy: userId,
                });
            }
            
            const playlistEmbed = new EmbedBuilder()
                .setColor(config.colors.success)
                .setDescription(`📋 เพิ่ม **${addedSongs.length}** เพลงจาก playlist เข้าคิวแล้ว!`)
                .setTimestamp();
            
            textChannel.send({ embeds: [playlistEmbed] }).then(msg => {
                setTimeout(() => msg.delete().catch(() => {}), 5000);
            });
            
        } else if (play.so_validate(query)) {
            // SoundCloud - ต้องการ authorization แต่เราจะข้ามไปค้นหาจาก YouTube แทน
            try {
                const info = await play.soundcloud(query);
                songInfo = {
                    title: info.name,
                    url: info.url,
                    duration: formatDurationMs(info.durationInMs),
                    durationSec: info.durationInMs / 1000,
                    thumbnail: info.thumbnail,
                    source: 'SoundCloud',
                    requestedBy: userId,
                };
                addedSongs.push(songInfo);
            } catch (scError) {
                // ถ้า SoundCloud ไม่ทำงาน ให้ค้นหาจาก YouTube แทน
                console.log('SoundCloud error, searching YouTube instead:', scError.message);
                const searched = await play.search(query, { limit: 1 });
                if (searched.length > 0) {
                    const video = searched[0];
                    songInfo = {
                        title: video.title,
                        url: video.url,
                        duration: video.durationRaw,
                        durationSec: video.durationInSec,
                        thumbnail: video.thumbnails[0]?.url || '',
                        source: 'YouTube',
                        requestedBy: userId,
                    };
                    addedSongs.push(songInfo);
                } else {
                    const errorEmbed = new EmbedBuilder()
                        .setColor(config.colors.error)
                        .setDescription('❌ ไม่สามารถเล่นจาก SoundCloud ได้ และไม่พบเพลงใน YouTube')
                        .setTimestamp();
                    
                    return textChannel.send({ embeds: [errorEmbed] }).then(msg => {
                        setTimeout(() => msg.delete().catch(() => {}), 5000);
                    });
                }
            }
        } else {
            // ค้นหาจาก YouTube
            const searched = await play.search(query, { limit: 1 });
            if (searched.length === 0) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(config.colors.error)
                    .setDescription('❌ ไม่พบเพลงที่ค้นหา')
                    .setTimestamp();
                
                return textChannel.send({ embeds: [errorEmbed] }).then(msg => {
                    setTimeout(() => msg.delete().catch(() => {}), 5000);
                });
            }
            
            const video = searched[0];
            songInfo = {
                title: video.title,
                url: video.url,
                duration: video.durationRaw,
                durationSec: video.durationInSec,
                thumbnail: video.thumbnails[0]?.url || '',
                source: 'YouTube',
                requestedBy: userId,
            };
            addedSongs.push(songInfo);
        }

        // เพิ่มเพลงเข้าคิว
        for (const song of addedSongs) {
            queue.songs.push(song);
        }

        // เชื่อมต่อช่องเสียงถ้ายังไม่ได้เชื่อมต่อ
        if (!queue.connection && voiceChannel) {
            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guildId,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });

                queue.connection = connection;
                connection.subscribe(queue.player);

                // จัดการ event ของ player
                queue.player.on(AudioPlayerStatus.Idle, () => {
                    if (queue.loop && queue.songs.length > 0) {
                        playSong(guildId, queue.songs[0]);
                    } else {
                        queue.songs.shift();
                        if (queue.songs.length > 0) {
                            playSong(guildId, queue.songs[0]);
                        } else {
                            queue.playing = false;
                            updateControlMessage(guildId);
                        }
                    }
                });

                queue.player.on('error', (error) => {
                    console.error('Player error:', error);
                });

                connection.on(VoiceConnectionStatus.Disconnected, async () => {
                    try {
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                        ]);
                    } catch (error) {
                        connection.destroy();
                        queue.connection = null;
                        queue.songs = [];
                        queue.playing = false;
                        updateControlMessage(guildId);
                    }
                });

            } catch (error) {
                console.error('Connection error:', error);
                const errorEmbed = new EmbedBuilder()
                    .setColor(config.colors.error)
                    .setDescription('❌ ไม่สามารถเข้าร่วมช่องเสียงได้')
                    .setTimestamp();
                
                return textChannel.send({ embeds: [errorEmbed] }).then(msg => {
                    setTimeout(() => msg.delete().catch(() => {}), 5000);
                });
            }
        }

        // ถ้าเป็นเพลงเดียวและไม่ใช่ playlist แสดงข้อความเพิ่มเข้าคิว
        if (addedSongs.length === 1 && queue.songs.length > 1) {
            const queueEmbed = new EmbedBuilder()
                .setColor(config.colors.queued)
                .setDescription(`✅ เพิ่ม **${addedSongs[0].title}** เข้าคิว (ตำแหน่ง #${queue.songs.length})`)
                .setThumbnail(addedSongs[0].thumbnail)
                .setTimestamp();
            
            textChannel.send({ embeds: [queueEmbed] }).then(msg => {
                setTimeout(() => msg.delete().catch(() => {}), 5000);
            });
        }

        // เริ่มเล่นถ้ายังไม่ได้เล่น
        if (!queue.playing && queue.connection) {
            playSong(guildId, queue.songs[0]);
        } else {
            await updateControlMessage(guildId);
        }

    } catch (error) {
        console.error('Search error:', error);
        const errorEmbed = new EmbedBuilder()
            .setColor(config.colors.error)
            .setDescription(`❌ เกิดข้อผิดพลาด: ${error.message}`)
            .setTimestamp();
        
        textChannel.send({ embeds: [errorEmbed] }).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
    }
}

// ลงทะเบียน Slash Commands
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('สร้างห้องควบคุมเพลง')
            .addStringOption(option =>
                option.setName('channel_name')
                    .setDescription('ชื่อห้องที่ต้องการสร้าง')
                    .setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder()
            .setName('play')
            .setDescription('เล่นเพลง')
            .addStringOption(option =>
                option.setName('query')
                    .setDescription('ชื่อเพลงหรือ URL')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('skip')
            .setDescription('ข้ามเพลงปัจจุบัน'),
        new SlashCommandBuilder()
            .setName('stop')
            .setDescription('หยุดเล่นและล้างคิว'),
        new SlashCommandBuilder()
            .setName('queue')
            .setDescription('ดูคิวเพลง'),
        new SlashCommandBuilder()
            .setName('volume')
            .setDescription('ปรับระดับเสียง')
            .addIntegerOption(option =>
                option.setName('level')
                    .setDescription('ระดับเสียง (0-100)')
                    .setRequired(true)
                    .setMinValue(0)
                    .setMaxValue(100)),
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('แสดงวิธีใช้งานบอท'),
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log('🔄 กำลังลงทะเบียน Slash Commands...');
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commands },
        );
        console.log('✅ ลงทะเบียน Slash Commands เรียบร้อย!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Event: Bot พร้อมใช้งาน
client.once('ready', async () => {
    console.log(`✅ บอทออนไลน์แล้ว! เข้าสู่ระบบในชื่อ ${client.user.tag}`);
    client.user.setActivity('🎵 /setup เพื่อเริ่มต้น', { type: 2 }); // Type 2 = Listening
    
    loadMusicChannels();
    await registerCommands();
});

// Event: Slash Commands
client.on('interactionCreate', async (interaction) => {
    // จัดการ Button Interactions
    if (interaction.isButton()) {
        const guildId = interaction.guild.id;
        const queue = queues.get(guildId);
        
        if (!queue) {
            return interaction.reply({ content: '❌ ไม่มีเพลงในคิว', ephemeral: true });
        }

        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        switch (interaction.customId) {
            case 'music_playpause':
                if (queue.player.state.status === AudioPlayerStatus.Paused) {
                    queue.player.unpause();
                    await interaction.reply({ content: '▶️ เล่นต่อ', ephemeral: true });
                } else {
                    queue.player.pause();
                    await interaction.reply({ content: '⏸️ หยุดชั่วคราว', ephemeral: true });
                }
                await updateControlMessage(guildId);
                break;

            case 'music_skip':
                if (queue.songs.length === 0) {
                    return interaction.reply({ content: '❌ ไม่มีเพลงในคิว', ephemeral: true });
                }
                queue.player.stop();
                await interaction.reply({ content: '⏭️ ข้ามเพลง', ephemeral: true });
                break;

            case 'music_stop':
                queue.songs = [];
                queue.player.stop();
                if (queue.connection) {
                    queue.connection.destroy();
                    queue.connection = null;
                }
                queue.playing = false;
                await updateControlMessage(guildId);
                await interaction.reply({ content: '⏹️ หยุดเล่นแล้ว', ephemeral: true });
                break;

            case 'music_shuffle':
                if (queue.songs.length <= 1) {
                    return interaction.reply({ content: '❌ ต้องมีเพลงมากกว่า 1 เพลง', ephemeral: true });
                }
                const current = queue.songs.shift();
                for (let i = queue.songs.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
                }
                queue.songs.unshift(current);
                await updateControlMessage(guildId);
                await interaction.reply({ content: '🔀 สับเปลี่ยนคิวแล้ว', ephemeral: true });
                break;

            case 'music_loop':
                queue.loop = !queue.loop;
                await updateControlMessage(guildId);
                await interaction.reply({ content: queue.loop ? '🔁 เปิด Loop' : '🔁 ปิด Loop', ephemeral: true });
                break;

            case 'music_volup':
                queue.volume = Math.min(100, queue.volume + 10);
                if (queue.currentResource?.volume) {
                    queue.currentResource.volume.setVolume(queue.volume / 100);
                }
                await updateControlMessage(guildId);
                await interaction.reply({ content: `🔊 ระดับเสียง: ${queue.volume}%`, ephemeral: true });
                break;

            case 'music_voldown':
                queue.volume = Math.max(0, queue.volume - 10);
                if (queue.currentResource?.volume) {
                    queue.currentResource.volume.setVolume(queue.volume / 100);
                }
                await updateControlMessage(guildId);
                await interaction.reply({ content: `🔉 ระดับเสียง: ${queue.volume}%`, ephemeral: true });
                break;

            case 'music_queue':
                if (queue.songs.length === 0) {
                    return interaction.reply({ content: '📭 คิวว่างเปล่า', ephemeral: true });
                }
                const queueList = queue.songs.slice(0, 10).map((song, index) => {
                    const prefix = index === 0 ? '🎵 กำลังเล่น:' : `${index}.`;
                    return `${prefix} **${song.title}** - ${song.duration}`;
                }).join('\n');
                
                const queueEmbed = new EmbedBuilder()
                    .setColor(config.colors.info)
                    .setTitle('📋 คิวเพลง')
                    .setDescription(queueList)
                    .setFooter({ text: `ทั้งหมด ${queue.songs.length} เพลง` });
                
                await interaction.reply({ embeds: [queueEmbed], ephemeral: true });
                break;

            case 'music_lyrics':
                await interaction.reply({ content: '📝 ฟีเจอร์เนื้อเพลงยังไม่พร้อมใช้งาน', ephemeral: true });
                break;

            case 'music_previous':
                await interaction.reply({ content: '⏮️ ฟีเจอร์ย้อนกลับยังไม่พร้อมใช้งาน', ephemeral: true });
                break;

            default:
                await interaction.reply({ content: '❓ คำสั่งไม่รู้จัก', ephemeral: true });
        }
        return;
    }

    // จัดการ Slash Commands
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, guild, member, channel } = interaction;

    switch (commandName) {
        case 'setup': {
            const channelName = options.getString('channel_name') || '🎵・music-request';
            
            try {
                // สร้างห้องใหม่
                const newChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    topic: '🎶 พิมพ์ชื่อเพลงหรือ URL เพื่อเล่นเพลง | Music Request Channel',
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                        },
                        {
                            id: client.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ManageMessages,
                                PermissionFlagsBits.EmbedLinks,
                                PermissionFlagsBits.AttachFiles,
                            ],
                        },
                    ],
                });

                // บันทึกห้องควบคุม
                musicChannels.set(guild.id, newChannel.id);
                saveMusicChannels();

                // สร้างข้อความแนะนำ
                const welcomeEmbed = new EmbedBuilder()
                    .setColor(config.embedColor)
                    .setAuthor({ name: '🎵 Music Bot - ห้องควบคุมเพลง', iconURL: client.user.displayAvatarURL() })
                    .setTitle('ยินดีต้อนรับสู่ห้องเพลง!')
                    .setDescription('```\n📌 วิธีใช้งาน:\n\n1. เข้าช่องเสียง (Voice Channel) ก่อน\n2. พิมพ์ชื่อเพลงหรือ URL ในห้องนี้\n3. ใช้ปุ่มด้านล่างเพื่อควบคุมเพลง\n\n🎵 รองรับ: YouTube, SoundCloud, Playlist\n```')
                    .addFields(
                        { name: '🔀 Shuffle', value: 'สับเปลี่ยนคิว', inline: true },
                        { name: '⏮️ Previous', value: 'เพลงก่อนหน้า', inline: true },
                        { name: '⏸️ Pause/Play', value: 'หยุด/เล่นต่อ', inline: true },
                        { name: '⏭️ Skip', value: 'ข้ามเพลง', inline: true },
                        { name: '⏹️ Stop', value: 'หยุดเล่น', inline: true },
                        { name: '🔉🔊 Volume', value: 'ปรับเสียง', inline: true },
                        { name: '🔁 Loop', value: 'เล่นซ้ำ', inline: true },
                        { name: '📋 Queue', value: 'ดูคิว', inline: true },
                        { name: '📝 Lyrics', value: 'เนื้อเพลง', inline: true }
                    )
                    .setImage('https://i.imgur.com/3bQm3qJ.gif')
                    .setFooter({ text: '🎶 เริ่มต้นโดยการพิมพ์ชื่อเพลง!' })
                    .setTimestamp();

                // สร้างคิวสำหรับเซิร์ฟเวอร์นี้
                let queue = queues.get(guild.id);
                if (!queue) {
                    queue = createQueue(guild.id);
                    queues.set(guild.id, queue);
                }
                queue.textChannel = newChannel;

                const buttons = createControlButtons(queue);
                queue.controlMessage = await newChannel.send({ embeds: [welcomeEmbed], components: buttons });

                await interaction.reply({ 
                    content: `✅ สร้างห้องควบคุมเพลง <#${newChannel.id}> เรียบร้อยแล้ว!`, 
                    ephemeral: true 
                });

            } catch (error) {
                console.error('Setup error:', error);
                await interaction.reply({ 
                    content: `❌ เกิดข้อผิดพลาด: ${error.message}`, 
                    ephemeral: true 
                });
            }
            break;
        }

        case 'play': {
            const query = options.getString('query');
            const voiceChannel = member.voice.channel;

            if (!voiceChannel) {
                return interaction.reply({ content: '❌ คุณต้องอยู่ในช่องเสียงก่อน!', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            await searchAndAddSong(query, guild.id, member.id, channel, voiceChannel);
            await interaction.editReply({ content: '✅ กำลังประมวลผล...' });
            break;
        }

        case 'skip': {
            const queue = queues.get(guild.id);
            if (!queue || queue.songs.length === 0) {
                return interaction.reply({ content: '❌ ไม่มีเพลงในคิว', ephemeral: true });
            }
            queue.player.stop();
            await interaction.reply({ content: '⏭️ ข้ามเพลงแล้ว', ephemeral: true });
            break;
        }

        case 'stop': {
            const queue = queues.get(guild.id);
            if (!queue) {
                return interaction.reply({ content: '❌ ไม่มีเพลงในคิว', ephemeral: true });
            }
            queue.songs = [];
            queue.player.stop();
            if (queue.connection) {
                queue.connection.destroy();
                queue.connection = null;
            }
            queue.playing = false;
            await updateControlMessage(guild.id);
            await interaction.reply({ content: '⏹️ หยุดเล่นและล้างคิวแล้ว', ephemeral: true });
            break;
        }

        case 'queue': {
            const queue = queues.get(guild.id);
            if (!queue || queue.songs.length === 0) {
                return interaction.reply({ content: '📭 คิวว่างเปล่า', ephemeral: true });
            }
            
            const queueList = queue.songs.slice(0, 15).map((song, index) => {
                const prefix = index === 0 ? '🎵' : `${index}.`;
                return `${prefix} **${song.title}** - ${song.duration}`;
            }).join('\n');
            
            const queueEmbed = new EmbedBuilder()
                .setColor(config.colors.info)
                .setTitle('📋 คิวเพลง')
                .setDescription(queueList)
                .setFooter({ text: `ทั้งหมด ${queue.songs.length} เพลง | Loop: ${queue.loop ? 'เปิด' : 'ปิด'}` });
            
            await interaction.reply({ embeds: [queueEmbed], ephemeral: true });
            break;
        }

        case 'volume': {
            const queue = queues.get(guild.id);
            if (!queue) {
                return interaction.reply({ content: '❌ ไม่มีเพลงในคิว', ephemeral: true });
            }
            
            const level = options.getInteger('level');
            queue.volume = level;
            if (queue.currentResource?.volume) {
                queue.currentResource.volume.setVolume(level / 100);
            }
            await updateControlMessage(guild.id);
            await interaction.reply({ content: `🔊 ปรับระดับเสียงเป็น ${level}%`, ephemeral: true });
            break;
        }

        case 'help': {
            const helpEmbed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setAuthor({ name: '🎵 Music Bot - วิธีใช้งาน', iconURL: client.user.displayAvatarURL() })
                .setDescription('บอทเพลงสำหรับ Discord รองรับหลายแพลตฟอร์ม')
                .addFields(
                    { name: '📌 เริ่มต้นใช้งาน', value: '`/setup [ชื่อห้อง]` - สร้างห้องควบคุมเพลง\nจากนั้นพิมพ์ชื่อเพลงในห้องนั้นได้เลย!', inline: false },
                    { name: '🎵 คำสั่งเพลง', value: '`/play <ชื่อ/URL>` - เล่นเพลง\n`/skip` - ข้ามเพลง\n`/stop` - หยุดเล่น\n`/queue` - ดูคิว\n`/volume <0-100>` - ปรับเสียง', inline: false },
                    { name: '🎹 ปุ่มควบคุม', value: 'ใช้ปุ่มในห้องควบคุมเพลงเพื่อควบคุมการเล่น', inline: false },
                    { name: '🎶 รองรับ', value: 'YouTube, SoundCloud, Playlist', inline: false }
                )
                .setFooter({ text: '🎵 Music Bot' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
            break;
        }
    }
});

// Event: รับข้อความในห้องควบคุมเพลง
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const guildId = message.guild?.id;
    if (!guildId) return;

    // ตรวจสอบว่าเป็นห้องควบคุมเพลงหรือไม่
    const musicChannelId = musicChannels.get(guildId);
    if (message.channel.id !== musicChannelId) return;

    // ลบข้อความของผู้ใช้
    try {
        await message.delete();
    } catch (error) {
        // ไม่สามารถลบได้ ไม่ต้องทำอะไร
    }

    const query = message.content.trim();
    if (!query) return;

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.colors.error)
            .setDescription('❌ คุณต้องอยู่ในช่องเสียงก่อน!')
            .setTimestamp();
        
        return message.channel.send({ embeds: [errorEmbed] }).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
    }

    await searchAndAddSong(query, guildId, message.author.id, message.channel, voiceChannel);
});

// เข้าสู่ระบบ
client.login(config.token);
