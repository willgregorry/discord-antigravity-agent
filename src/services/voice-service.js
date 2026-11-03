const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');

class VoiceService {
  constructor() {
    this.connections = new Map(); // guildId -> { connection, player, channelId, queue, isPlaying }
    this.tts = new MsEdgeTTS();
    this.defaultVoice = 'id-ID-ArdiNeural'; // Suara AI Pria Bahasa Indonesia yang natural
    this.ttsReady = false;
    this.initTts();
  }

  async initTts() {
    try {
      await this.tts.setMetadata(this.defaultVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      this.ttsReady = true;
    } catch (err) {
      console.warn('VoiceService: Inisialisasi TTS ditunda:', err.message);
    }
  }

  join(channel) {
    const guildId = channel.guild.id;

    // Jika sudah terhubung di channel yang sama, gunakan yang ada
    if (this.connections.has(guildId)) {
      const current = this.connections.get(guildId);
      if (current.channelId === channel.id) {
        return current;
      }
      this.leave(guildId);
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    const guildVoice = {
      connection,
      player,
      channelId: channel.id,
      guildId,
      queue: [],
      isPlaying: false
    };

    player.on(AudioPlayerStatus.Idle, () => {
      guildVoice.isPlaying = false;
      this.playNext(guildId);
    });

    player.on('error', err => {
      console.error('VoicePlayer error:', err.message);
      guildVoice.isPlaying = false;
      this.playNext(guildId);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch (_) {
        this.leave(guildId);
      }
    });

    this.connections.set(guildId, guildVoice);
    return guildVoice;
  }

  leave(guildId) {
    const guildVoice = this.connections.get(guildId);
    if (guildVoice) {
      try {
        guildVoice.player.stop();
        guildVoice.connection.destroy();
      } catch (_) {}
      this.connections.delete(guildId);
      return true;
    }
    return false;
  }

  isConnected(guildId) {
    return this.connections.has(guildId);
  }

  getChannelId(guildId) {
    return this.connections.get(guildId)?.channelId || null;
  }

  async speak(guildId, text, voice = null) {
    const guildVoice = this.connections.get(guildId);
    if (!guildVoice) return false;

    // Bersihkan teks dari markdown, URL, code block, dan tag
    let cleanText = text
      .replace(/\[ATTACH_FILE:\s*[^\]]+\]/gi, '')
      .replace(/```[\s\S]*?```/g, 'kode program')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/https?:\/\/\S+/g, 'link')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_~>#-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return false;

    // Batasi panjang audio agar tidak terlalu panjang berbicara di VC
    const spokenText = cleanText.length > 250 ? cleanText.slice(0, 250) + '... dan tugas telah selesai.' : cleanText;

    guildVoice.queue.push({ text: spokenText, voice });
    if (!guildVoice.isPlaying) {
      this.playNext(guildId);
    }
    return true;
  }

  async playNext(guildId) {
    const guildVoice = this.connections.get(guildId);
    if (!guildVoice || guildVoice.queue.length === 0) {
      if (guildVoice) guildVoice.isPlaying = false;
      return;
    }

    guildVoice.isPlaying = true;
    const item = guildVoice.queue.shift();

    try {
      const voiceName = item.voice || this.defaultVoice;
      await this.tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const rootDir = path.resolve(__dirname, '..', '..');
      const voiceTempDir = path.join(rootDir, 'temp_downloads', 'voice');
      if (!fs.existsSync(voiceTempDir)) fs.mkdirSync(voiceTempDir, { recursive: true });

      const res = await this.tts.toFile(voiceTempDir, item.text);
      if (res && res.audioFilePath) {
        const generatedPath = path.resolve(voiceTempDir, path.basename(res.audioFilePath));
        const uniquePath = path.join(voiceTempDir, `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
        fs.renameSync(generatedPath, uniquePath);

        const resource = createAudioResource(uniquePath);
        guildVoice.player.play(resource);

        guildVoice.player.once(AudioPlayerStatus.Idle, () => {
          try {
            if (fs.existsSync(uniquePath)) fs.unlinkSync(uniquePath);
          } catch (_) {}
        });
      } else {
        guildVoice.isPlaying = false;
        this.playNext(guildId);
      }
    } catch (err) {
      console.error('Gagal memproses suara TTS:', err);
      guildVoice.isPlaying = false;
      this.playNext(guildId);
    }
  }

  announceToAll(text) {
    for (const guildId of this.connections.keys()) {
      this.speak(guildId, text);
    }
  }
}

module.exports = { VoiceService };
