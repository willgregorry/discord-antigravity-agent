const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');
const { getAgyExecutable } = require('../core/agy-runner');

class EnhancementService {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, 'enhancements_data');
    this.dataFile = path.join(this.dataDir, 'enhancements.json');
    this.tempDir = path.join(rootDir, 'temp_downloads', 'enhance');
    this.initDirs();
  }

  initDirs() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
    if (!fs.existsSync(this.dataFile)) {
      fs.writeFileSync(this.dataFile, JSON.stringify({ enhancements: [] }, null, 2), 'utf8');
    }
  }

  getFfmpegPath() {
    try {
      const ffmpegStatic = require('ffmpeg-static');
      if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
    } catch (_) {}
    return null;
  }

  async downloadMedia(url) {
    const videoId = `vid_${Date.now()}`;
    const outputTemplate = path.join(this.tempDir, `${videoId}.%(ext)s`);
    const ffmpegPath = this.getFfmpegPath();

    const args = [
      '-m', 'yt_dlp',
      '--no-playlist',
      '--write-info-json',
      '--write-auto-sub',
      '--sub-lang', 'en,id',
      '-f', 'b[filesize<40M]/w/best',
      '-o', outputTemplate,
      url
    ];

    if (ffmpegPath) {
      args.splice(2, 0, '--ffmpeg-location', ffmpegPath);
    }

    return new Promise((resolve, reject) => {
      execFile('python', args, { timeout: 60000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Gagal mengunduh video: ${stderr || err.message}`));
        }

        try {
          const files = fs.readdirSync(this.tempDir);
          const matchingFiles = files.filter(f => f.startsWith(videoId));

          let infoFile = matchingFiles.find(f => f.endsWith('.info.json'));
          let mediaFile = matchingFiles.find(f => !f.endsWith('.json') && !f.endsWith('.vtt') && !f.endsWith('.srt'));
          let subFile = matchingFiles.find(f => f.endsWith('.vtt') || f.endsWith('.srt'));

          let metadata = {};
          if (infoFile) {
            try {
              metadata = JSON.parse(fs.readFileSync(path.join(this.tempDir, infoFile), 'utf8'));
            } catch (_) {}
          }

          let subtitlesText = '';
          if (subFile) {
            try {
              const rawSub = fs.readFileSync(path.join(this.tempDir, subFile), 'utf8');
              // Bersihkan timestamps VTT/SRT sederhana
              subtitlesText = rawSub
                .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}.*/g, '')
                .replace(/<[^>]+>/g, '')
                .replace(/WEBVTT/g, '')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && !/^\d+$/.test(l))
                .join(' ');
            } catch (_) {}
          }

          resolve({
            id: videoId,
            mediaPath: mediaFile ? path.join(this.tempDir, mediaFile) : null,
            title: metadata.title || 'Video AI Tips',
            description: metadata.description || '',
            uploader: metadata.uploader || metadata.channel || 'Kreator',
            subtitles: subtitlesText,
            url
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async analyzeWithGeminiApi(mediaData) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.startsWith('YOUR_')) return null;

    try {
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      let contents = [];
      let fileUpload = null;

      if (mediaData.mediaPath && fs.existsSync(mediaData.mediaPath)) {
        const ext = path.extname(mediaData.mediaPath).toLowerCase();
        let mimeType = 'video/mp4';
        if (ext === '.mp3' || ext === '.m4a' || ext === '.wav') mimeType = 'audio/mp3';
        else if (ext === '.webm') mimeType = 'video/webm';

        fileUpload = await ai.files.upload({
          file: mediaData.mediaPath,
          mimeType
        });
        contents.push(fileUpload);
      }

      const prompt = `Analisis konten video Instagram/TikTok tentang AI/coding ini.
Judul: ${mediaData.title}
Deskripsi/Caption: ${mediaData.description}
Transkrip Suara: ${mediaData.subtitles || '(dari file video)'}

Tugas kamu: Ekstrak teknik, mindset, atau aturan koding/prompting terbaik dari video ini agar Antigravity AI bisa mematuhinya secara konsisten di semua tugas koding berikutnya.
Kembalikan HANYA format JSON valid berikut tanpa markdown formatting tambahan:
{
  "title": "Judul singkat skill/kaidah (bahasa Indonesia/Inggris)",
  "category": "Clean Code | Architecture | Prompting | Debugging | Workflow",
  "summary": "1-2 kalimat ringkasan inti ilmu yang diajarkan",
  "rules": [
    "Poin aturan konkret 1",
    "Poin aturan konkret 2"
  ],
  "systemPromptInstruction": "Instruksi formal dan tegas untuk disisipkan ke system prompt AI agar selalu menerapkan teknik ini."
}`;

      contents.push(prompt);

      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents
      });

      if (fileUpload && fileUpload.name) {
        try { await ai.files.delete({ name: fileUpload.name }); } catch (_) {}
      }

      let text = res.text || '';
      text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    } catch (err) {
      console.warn('Gemini API analysis fallback:', err.message);
      return null;
    }
  }

  async analyzeWithAgyCli(mediaData) {
    return new Promise((resolve, reject) => {
      const prompt = `Analisis materi video tips koding/AI dari media sosial ini:
Judul: ${mediaData.title}
Caption/Deskripsi: ${mediaData.description}
Transkrip: ${mediaData.subtitles || 'Tidak ada subtitle, analisa dari deskripsi & judul.'}

Ekstrak tips/teknik ini agar AI coding assistant bisa belajar dan mematuhinya ke depan.
Balas HANYA dengan blok JSON valid persis seperti ini:
{
  "title": "Nama skill/tips yang dipelajari",
  "category": "Clean Code | Architecture | Prompting | Debugging | Workflow",
  "summary": "Ringkasan manfaat dan inti tekniknya",
  "rules": [
    "Aturan praktis 1",
    "Aturan praktis 2"
  ],
  "systemPromptInstruction": "Petunjuk direktif tegas untuk system prompt AI."
}`;

      const agyBin = getAgyExecutable();
      execFile(agyBin, ['-p', prompt, '--output-format', 'json'], { timeout: 45000, windowsHide: true }, (err, stdout) => {
        if (err) return reject(new Error(`Gagal menganalisis via agy CLI: ${err.message}`));
        try {
          const jsonOut = JSON.parse(stdout);
          let rawResp = jsonOut.response || '';
          rawResp = rawResp.replace(/```json/gi, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(rawResp);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Gagal parse hasil analisa: ${e.message}`));
        }
      });
    });
  }

  async analyzeMedia(mediaData) {
    // 1. Coba lewat Gemini API SDK jika ada kunci valid
    const apiResult = await this.analyzeWithGeminiApi(mediaData);
    if (apiResult && apiResult.title) return apiResult;

    // 2. Fallback via Antigravity CLI langsung di laptop
    return await this.analyzeWithAgyCli(mediaData);
  }

  cleanTempMedia(videoId) {
    try {
      const files = fs.readdirSync(this.tempDir);
      for (const f of files) {
        if (f.startsWith(videoId)) {
          fs.unlinkSync(path.join(this.tempDir, f));
        }
      }
    } catch (_) {}
  }

  getData() {
    this.initDirs();
    try {
      return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
    } catch (_) {
      return { enhancements: [] };
    }
  }

  saveData(data) {
    this.initDirs();
    fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2), 'utf8');
  }

  getEnhancements() {
    return this.getData().enhancements || [];
  }

  addEnhancement(data) {
    const store = this.getData();
    const id = `enh_${Date.now()}`;
    const newEnhancement = {
      id,
      title: data.title || 'Untitled Skill',
      category: data.category || 'General',
      summary: data.summary || '',
      rules: Array.isArray(data.rules) ? data.rules : [data.rules].filter(Boolean),
      systemPromptInstruction: data.systemPromptInstruction || data.summary || '',
      sourceUrl: data.sourceUrl || '',
      enabled: true,
      createdAt: new Date().toISOString()
    };
    store.enhancements.unshift(newEnhancement);
    this.saveData(store);
    return newEnhancement;
  }

  toggleEnhancement(id) {
    const store = this.getData();
    const item = store.enhancements.find(e => e.id === id);
    if (!item) throw new Error('Skill/Enhancement tidak ditemukan.');
    item.enabled = !item.enabled;
    this.saveData(store);
    return item;
  }

  deleteEnhancement(id) {
    const store = this.getData();
    const index = store.enhancements.findIndex(e => e.id === id);
    if (index === -1) throw new Error('Skill/Enhancement tidak ditemukan.');
    const removed = store.enhancements.splice(index, 1)[0];
    this.saveData(store);
    return removed;
  }

  getFormattedPromptBlock() {
    const active = this.getEnhancements().filter(e => e.enabled);
    if (active.length === 0) return '';

    const lines = [];
    lines.push('[GLOBAL LEARNED SKILLS & ENHANCED BEST PRACTICES:');
    lines.push('Sebagai agent cerdas, patuhi seluruh kaidah dan teknik berikut yang telah dipelajari secara global:');
    for (const e of active) {
      lines.push(`• [${e.title}] (${e.category}): ${e.systemPromptInstruction}`);
      if (e.rules && e.rules.length > 0) {
        for (const r of e.rules) {
          lines.push(`  - ${r}`);
        }
      }
    }
    lines.push(']');
    return '\n' + lines.join('\n') + '\n';
  }
}

module.exports = { EnhancementService };
