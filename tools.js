const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class ToolManager {
  constructor(initialDir) {
    this.cwd = path.resolve(initialDir || process.cwd());
  }

  getCwd() {
    return this.cwd;
  }

  setCwd(newPath) {
    const resolved = path.isAbsolute(newPath) ? path.resolve(newPath) : path.resolve(this.cwd, newPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved}`);
    }
    this.cwd = resolved;
    return this.cwd;
  }

  async executeCommand(command) {
    return new Promise((resolve) => {
      const options = {
        cwd: this.cwd,
        shell: 'powershell.exe',
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 5
      };

      exec(command, options, (error, stdout, stderr) => {
        let out = stdout ? stdout.toString() : '';
        let err = stderr ? stderr.toString() : '';

        const MAX_LEN = 8000;
        if (out.length > MAX_LEN) {
          out = out.slice(0, MAX_LEN) + `\n... [Output truncated, ${out.length - MAX_LEN} characters remaining]`;
        }
        if (err.length > MAX_LEN) {
          err = err.slice(0, MAX_LEN) + `\n... [Stderr truncated, ${err.length - MAX_LEN} characters remaining]`;
        }

        resolve({
          exitCode: error ? (error.code || 1) : 0,
          stdout: out.trim(),
          stderr: err.trim(),
          cwd: this.cwd
        });
      });
    });
  }

  readFile(filepath, startLine = 1, endLine = null) {
    const resolved = path.isAbsolute(filepath) ? path.resolve(filepath) : path.resolve(this.cwd, filepath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: ${resolved}`);
    }
    const content = fs.readFileSync(resolved, 'utf8');
    const lines = content.split('\n');
    const start = Math.max(1, startLine) - 1;
    const end = endLine ? Math.min(lines.length, endLine) : lines.length;
    const sliced = lines.slice(start, end).map((l, idx) => `${start + idx + 1}: ${l}`).join('\n');
    return {
      filepath: resolved,
      totalLines: lines.length,
      startLine: start + 1,
      endLine: end,
      content: sliced
    };
  }

  writeFile(filepath, content) {
    const resolved = path.isAbsolute(filepath) ? path.resolve(filepath) : path.resolve(this.cwd, filepath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, 'utf8');
    return {
      success: true,
      filepath: resolved,
      bytesWritten: Buffer.byteLength(content, 'utf8')
    };
  }

  listDirectory(targetPath = '.') {
    const resolved = path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(this.cwd, targetPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Path does not exist: ${resolved}`);
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const items = entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile()
    }));
    return {
      cwd: resolved,
      totalItems: items.length,
      items: items.slice(0, 100)
    };
  }
}

module.exports = { ToolManager };
