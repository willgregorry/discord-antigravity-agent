const { exec } = require('child_process');

class GitService {
  execGit(cmd, cwd) {
    return new Promise((resolve, reject) => {
      exec(`git ${cmd}`, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 2 }, (err, stdout, stderr) => {
        if (err) {
          return resolve({ ok: false, output: (stderr || stdout || err.message).trim() });
        }
        resolve({ ok: true, output: (stdout || '').trim() });
      });
    });
  }

  async getStatus(cwd) {
    const branchRes = await this.execGit('rev-parse --abbrev-ref HEAD', cwd);
    if (!branchRes.ok) {
      return { isRepo: false, error: branchRes.output };
    }
    const branch = branchRes.output;

    const statusRes = await this.execGit('status -s', cwd);
    const logRes = await this.execGit('log -1 --oneline', cwd);

    const lines = statusRes.output ? statusRes.output.split('\n') : [];
    const modified = lines.filter(l => l.trim().startsWith('M')).length;
    const untracked = lines.filter(l => l.trim().startsWith('??')).length;
    const staged = lines.filter(l => /^[MADRC]/.test(l.trim())).length;

    return {
      isRepo: true,
      branch,
      lastCommit: logRes.output || '(Belum ada commit)',
      modified,
      untracked,
      staged,
      rawStatus: statusRes.output || 'Working tree clean (tidak ada perubahan).'
    };
  }

  async getDiff(cwd) {
    const res = await this.execGit('diff HEAD', cwd);
    if (!res.ok || !res.output) {
      // fallback to standard diff
      const res2 = await this.execGit('diff', cwd);
      return res2.output || 'Tidak ada perubahan terdeteksi pada git diff.';
    }
    return res.output;
  }

  async commit(cwd, message) {
    const addRes = await this.execGit('add -A', cwd);
    if (!addRes.ok) return addRes;
    const msg = message.replace(/"/g, '\\"');
    return await this.execGit(`commit -m "${msg}"`, cwd);
  }

  async push(cwd) {
    return await this.execGit('push', cwd);
  }

  async pull(cwd) {
    return await this.execGit('pull', cwd);
  }
}

module.exports = { GitService };
