const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function getAgyExecutable() {
  if (process.env.AGY_PATH && fs.existsSync(process.env.AGY_PATH)) {
    return process.env.AGY_PATH;
  }
  if (process.env.LOCALAPPDATA) {
    const defaultWinAgy = path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(defaultWinAgy)) return defaultWinAgy;
  }
  return 'agy';
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch (_) {}
}

const AGY_PATH = getAgyExecutable();

class AgyRunner {
  static runPrompt({ prompt, cwd, model, conversationId, notes, onInit, onToolStart, onToolDone, onTextDelta, onResult, onError }) {
    const notesBlock = notes ? `\n[Project Scratchpad / Notes untuk Channel ini:
${notes}
]\n` : '';

    const discordPrompt = `[Instruksi Format Tampilan Discord:
- Format jawaban dengan Discord Markdown yang sangat rapi dan estetik untuk layar HP.
- Gunakan \`nama_file\` atau **nama_file**, JANGAN PERNAH gunakan link [nama](file:///...) karena Discord tidak mendukung link file lokal.
- Untuk kode, perintah terminal, atau struktur direktori, SELALU gunakan blok kode \`\`\`bahasa ... \`\`\` yang jelas.
- Gunakan blockquote (>) untuk penjelasan detail dan bullet point yang rapi.
- ATURAN PENTING PERINTAH TERMINAL / DAEMON:
  DILARANG menjalankan command server/tunnel yang berjalan terus menerus (misal: cloudflared, npm run dev, npm start, python app.py) secara synchronous foreground di terminal karena akan memblokir proses CLI selamanya!
  Jika perlu menjalankan dev server atau tunnel, bot Discord sudah memiliki slash command otomatis: \`/preview <port>\` untuk Cloudflare Tunnel, dan \`/watch-server <cmd>\` untuk dev server dengan auto-restart.
- FITUR KIRIM FILE KE DISCORD:
  Jika pengguna meminta kamu mengirimkan file, gambar, laporan, dokumen, PDF, source code, artefak, atau jika kamu membuat/mengedit file yang ingin kamu perlihatkan ke pengguna di Discord, sertakan tag berikut di bagian akhir jawabanmu:
  [ATTACH_FILE: <path_file_di_laptop>]
  Contoh:
  [ATTACH_FILE: ./src/index.js]
  [ATTACH_FILE: ./README.md]
  Sistem bridge akan otomatis membaca file tersebut dari laptop dan mengunggahnya ke chat Discord sebagai lampiran (attachment)!
]${notesBlock}

${prompt}`;

    const args = [
      '--print', discordPrompt,
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json'
    ];

    if (model) {
      args.push('--model', model);
    }

    if (conversationId) {
      args.push('--conversation', conversationId);
    }

    const defaultDir = process.env.DEFAULT_DIR || process.cwd();
    const workingDir = path.resolve(cwd || defaultDir);
    if (!fs.existsSync(workingDir)) {
      throw new Error(`Directory does not exist: ${workingDir}`);
    }

    const child = spawn(AGY_PATH, args, {
      cwd: workingDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Pasang method killTree agar seluruh rantai child process mati total
    child.killTree = () => {
      child.killed = true;
      if (child.pid) {
        killProcessTree(child.pid);
      }
    };

    // Close stdin so agy doesn't wait for interactive input
    child.stdin.end();

    let stdoutBuffer = '';
    let finalResult = null;
    let resultDispatched = false;

    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line.trim());
          const event = data.event;

          if (event === 'init') {
            if (onInit) onInit(data);
          } else if (event === 'step_update' && data.step_update) {
            const step = data.step_update;
            if (step.step_type === 'tool') {
              if (step.state === 'ACTIVE' && onToolStart) {
                onToolStart(step);
              } else if (step.state === 'DONE' && onToolDone) {
                onToolDone(step);
              }
            } else if (step.step_type === 'agent_response' && step.text_delta) {
              if (onTextDelta) onTextDelta(step.text_delta);
            }
          } else if (event === 'result' && data.result) {
            finalResult = data.result;
            resultDispatched = true;
            if (onResult) onResult(data.result);
          }
        } catch (e) {
          // ignore malformed JSON chunk
        }
      }
    });

    child.stderr.on('data', chunk => {
      console.warn('[AGY STDERR]:', chunk.toString());
    });

    child.on('error', err => {
      if (!resultDispatched && onError) {
        resultDispatched = true;
        onError(err);
      }
    });

    child.on('close', (code, signal) => {
      // Jika proses sengaja dibatalkan via killTree (/stop atau timeout)
      if (child.killed) {
        return;
      }

      // Pastikan selalu dispatch result atau error agar channel tidak terkunci
      if (!resultDispatched) {
        resultDispatched = true;
        if (finalResult) {
          if (onResult) onResult(finalResult);
        } else if (stdoutBuffer && stdoutBuffer.trim()) {
          // Output berupa plain text tanpa wrapper result
          if (onResult) {
            onResult({
              response: stdoutBuffer.trim(),
              status: code === 0 ? 'SUCCESS' : 'ERROR'
            });
          }
        } else {
          const exitReason = code !== null ? `kode ${code}` : (signal ? `sinyal ${signal}` : 'dihentikan paksa');
          if (onError) onError(new Error(`Antigravity CLI selesai tanpa respon (${exitReason})`));
        }
      }
    });

    return child;
  }
}

module.exports = { AgyRunner, killProcessTree };
