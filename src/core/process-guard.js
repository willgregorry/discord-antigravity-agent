const { execSync } = require('child_process');

/**
 * Queries Windows WMI for matching process IDs and force-terminates their trees.
 * Kept isolated from startup logic so non-Windows environments remain unaffected.
 */
function killMatchingWindowsProcesses(whereClause, logPrefix = '') {
  if (process.platform !== 'win32') return;
  try {
    const psCmd = `Get-CimInstance Win32_Process | Where-Object { ${whereClause} } | Select-Object -ExpandProperty ProcessId`;
    const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8', timeout: 6000 });
    if (!out || !out.trim()) return;

    const pids = out.trim().split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    for (const pid of pids) {
      if (logPrefix) console.log(`${logPrefix} (PID: ${pid})`);
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Ensures only a single bot instance runs at a time and cleans up any orphaned
 * `agy` CLI or MCP subprocesses left behind by an unclean previous shutdown.
 */
function ensureCleanStartup() {
  const currentPid = process.pid;

  killMatchingWindowsProcesses(
    `$_.ProcessId -ne ${currentPid} -and $_.Name -eq 'node.exe' -and $_.CommandLine -like '*index.js*' -and $_.CommandLine -like '*Antigravity-Agent*'`,
    '⚠️ Menutup instance lama Antigravity Discord Agent yang masih berjalan'
  );

  killMatchingWindowsProcesses(
    `$_.Name -like '*agy*' -and $_.CommandLine -like '*Instruksi Format Tampilan Discord*'`,
    '🧹 Membersihkan proses agy yang menggantung dari sesi sebelumnya'
  );

  killMatchingWindowsProcesses(
    `$_.CommandLine -like '*mcp-remote*' -or $_.CommandLine -like '*google-drive-mcp*'`
  );
}

module.exports = { ensureCleanStartup };
