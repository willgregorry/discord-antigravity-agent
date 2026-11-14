const { exec } = require('child_process');

/**
 * Executes a shell command in PowerShell within `cwd` and returns combined stdout/stderr.
 */
function execPowerShell(command, cwd) {
  return new Promise((resolve) => {
    exec(command, { cwd, shell: 'powershell.exe', maxBuffer: 1024 * 1024 * 2 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '') || (err ? err.message : '(Command executed with no output)');
      resolve(output.trim());
    });
  });
}

module.exports = { execPowerShell };
