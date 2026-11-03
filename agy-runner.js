const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const AGY_PATH = 'C:\\Users\\Willy\\AppData\\Local\\agy\\bin\\agy.exe';

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
- FITUR KIRIM FILE KE DISCORD:
  Jika pengguna meminta kamu mengirimkan file, gambar, laporan, dokumen, PDF, source code, artefak, atau jika kamu membuat/mengedit file yang ingin kamu perlihatkan ke pengguna di Discord, sertakan tag berikut di bagian akhir jawabanmu:
  [ATTACH_FILE: <path_file_di_laptop>]
  Contoh:
  [ATTACH_FILE: ./src/index.js]
  [ATTACH_FILE: D:\\UB\\laboratorium mgm\\wfc2gether\\wfc2gether\\README.md]
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

    const workingDir = path.resolve(cwd || 'D:\\UB');
    if (!fs.existsSync(workingDir)) {
      throw new Error(`Directory does not exist: ${workingDir}`);
    }

    const child = spawn(AGY_PATH, args, {
      cwd: workingDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Close stdin so agy doesn't wait for interactive input
    child.stdin.end();

    let stdoutBuffer = '';
    let finalResult = null;

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
      if (onError) onError(err);
    });

    child.on('close', code => {
      if (code !== 0 && !finalResult) {
        if (onError) onError(new Error(`Antigravity CLI exited with code ${code}`));
      }
    });

    return child;
  }
}

module.exports = { AgyRunner };
