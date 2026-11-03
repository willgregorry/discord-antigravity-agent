# 🤖 Antigravity Discord Agent

> **Bridge bot Discord untuk Google Antigravity CLI di komputer lokal.**  
> Kontrol coding agent, jalankan eksekusi tugas, navigasi proyek, dan kelola berkas langsung dari Discord (termasuk dari smartphone kamu).

---

## ✨ Fitur Utama

- 💬 **Kontrol Antigravity Jarak Jauh**: Chatting dengan Antigravity coding agent langsung via Discord thread/channel.
- 📂 **Channel-to-Directory Mapping**: Otomatis mengarahkan sesi kerja ke folder proyek lokal sesuai nama channel (misal: channel `#devsecops` otomatis membuka folder mata kuliah/proyek DevSecOps).
- 📎 **Two-Way File Attachment**:
  - Kirim file/dokumen di Discord ➡️ otomatis disimpan di folder kerja lokal laptop.
  - Minta agen kirim file ➡️ agen menyertakan tag `[ATTACH_FILE: <path>]` dan bot otomatis mengunggahnya ke Discord sebagai attachment.
- 🧠 **Session Continuity**: Menyimpan `conversationId` per channel sehingga konteks percakapan tidak hilang.
- 🛡️ **Whitelist Keamanan**: Opsi `ALLOWED_USER_IDS` untuk memastikan hanya pemilik laptop yang dapat memberikan perintah ke agent.
- ⚙️ **Model Switcher**: Pilihan model AI yang fleksibel (Gemini Flash, Sonnet, Opus, dll).
- 📊 **Monitoring & Watchdog**: Dilengkapi pemantau resource, kuota token, git status, dan tunnel monitoring.

---

## 📋 Prasyarat

Sebelum memulai, pastikan komputer/laptop kamu memiliki:

1. **Node.js** versi 18 atau lebih baru ([Download Node.js](https://nodejs.org/)).
2. **Google Antigravity CLI (`agy`)** sudah terinstal dan dapat dijalankan via terminal.
3. **Bot Discord**:
   - Buat aplikasi baru di [Discord Developer Portal](https://discord.com/developers/applications).
   - Buat **Bot** dan simpan **Bot Token**.
   - Di tab **Bot** ➡️ **Privileged Gateway Intents**, aktifkan:
     - ✅ **Presence Intent**
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent**
   - Invite bot ke server Discord kamu melalui menu **OAuth2 URL Generator** dengan izin `bot` & `applications.commands` (Administrator atau izin Send Messages, Attach Files, Embed Links).

---

## 🚀 Panduan Instalasi Cepat

### 1. Clone Repository
```bash
git clone https://github.com/willgregorry/discord-antigravity-agent.git
cd discord-antigravity-agent
```

### 2. Jalankan Setup Wizard
Jalankan wizard otomatis untuk menginstal dependensi dan mengonfigurasi kredensial:

**Di Windows (1-Klik):**
> Cukup double-click file `scripts/setup.bat`

**Atau via Terminal:**
```bash
npm install
npm run setup
```

Wizard interaktif akan menanyakan:
- **Discord Bot Token**
- **Discord User ID** (Opsional, untuk membatasi kontrol hanya ke akun Discord kamu)
- **Direktori kerja default**

### 3. Konfigurasi Channel (`config.json`)
Buka berkas `config.json` untuk memetakan nama channel Discord ke folder proyek di laptop kamu:

```json
{
  "default_model": "gemini-3.8-flash-medium",
  "channel_directories": {
    "general": "C:\\Users\\Username\\Projects",
    "project-web": "C:\\Users\\Username\\Projects\\web-app",
    "skripsi": "D:\\Kuliah\\Skripsi"
  }
}
```

---

## ▶️ Menjalankan Bot

Jalankan perintah berikut:
```bash
npm start
```
*Di Windows, kamu juga bisa langsung double-click `scripts/start.bat`.*

Setelah bot online di Discord, kirim pesan di channel atau gunakan slash command seperti:
- `/cwd` - Cek direktori kerja saat ini
- `/model` - Ganti model AI untuk channel tersebut
- `/notes` - Catatan cepat per sesi

---

## 📁 Struktur Direktori Proyek

```text
├── scripts/                  # Skrip otomasi & launcher (.bat, .vbs)
│   ├── start.bat
│   ├── stop.bat
│   ├── restart.bat
│   ├── setup.bat
│   └── start-hidden.vbs
├── src/                      # Source code utama
│   ├── bot.js                # Discord client & handler slash command
│   ├── core/                 # Core engine Antigravity CLI & agent
│   │   ├── agy-runner.js
│   │   ├── agent.js
│   │   └── tools.js
│   └── services/             # Modular background services
│       ├── git-service.js
│       ├── notes-service.js
│       ├── quota-service.js
│       ├── system-service.js
│       ├── tree-service.js
│       ├── tunnel-service.js
│       ├── voice-service.js
│       └── watchdog-service.js
├── tests/                    # Pengujian modul
├── index.js                  # Entry point aplikasi
├── setup.js                  # CLI setup wizard interaktif
├── config.example.json
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 🔒 Keamanan (PENTING!)

- **JANGAN PERNAH** membagikan atau meng-*commit* file `.env` kamu ke GitHub publik. File `.env` sudah dimasukkan ke dalam `.gitignore`.
- Selalu isi `ALLOWED_USER_IDS` di file `.env` jika bot kamu berada di server Discord yang memiliki anggota lain, agar orang lain tidak bisa mengeksekusi perintah di laptop kamu.

---

## 📄 Lisensi
ISC License. Bebas dimodifikasi untuk kebutuhan pribadi atau tim.
