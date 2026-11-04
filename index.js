require('dotenv').config();
const path = require('path');
const { execSync } = require('child_process');
const { DiscordAntigravityBot } = require('./src/bot');

// 1. Single-Instance Guard: Matikan instance lama bot jika ada yang dobel jalan
function ensureSingleInstance() {
  const currentPid = process.pid;
  try {
    if (process.platform === 'win32') {
      const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${currentPid} -and $_.Name -eq 'node.exe' -and $_.CommandLine -like '*index.js*' -and $_.CommandLine -like '*Antigravity-Agent*' } | Select-Object -ExpandProperty ProcessId`;
      const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8', timeout: 6000 });
      if (out && out.trim()) {
        const pids = out.trim().split(/\r?\n/).map(p => p.trim()).filter(Boolean);
        for (const p of pids) {
          console.log(`⚠️ Menutup instance lama Antigravity Discord Agent yang masih berjalan (PID: ${p})...`);
          try {
            execSync(`taskkill /pid ${p} /T /F`, { stdio: 'ignore' });
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    // Abaikan jika tidak ada proses lain
  }
}

// 2. Bersihkan sisa proses agy yang mungkin macet sebelumnya
function cleanupOrphanedAgy() {
  try {
    if (process.platform === 'win32') {
      const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*agy*' -and $_.CommandLine -like '*Instruksi Format Tampilan Discord*' } | Select-Object -ExpandProperty ProcessId`;
      const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8', timeout: 6000 });
      if (out && out.trim()) {
        const pids = out.trim().split(/\r?\n/).map(p => p.trim()).filter(Boolean);
        for (const p of pids) {
          console.log(`🧹 Membersihkan proses agy yang menggantung dari sesi sebelumnya (PID: ${p})...`);
          try {
            execSync(`taskkill /pid ${p} /T /F`, { stdio: 'ignore' });
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

ensureSingleInstance();
cleanupOrphanedAgy();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ Error: DISCORD_TOKEN is missing in .env');
  process.exit(1);
}

const configPath = path.join(__dirname, 'config.json');
const bot = new DiscordAntigravityBot(token, configPath);
bot.start();
