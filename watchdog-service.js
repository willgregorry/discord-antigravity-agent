const { spawn, exec } = require('child_process');

class WatchdogService {
  constructor() {
    this.activeServers = new Map(); // channelId -> { child, command, cwd, logs: [], startTime, crashReported }
  }

  startWatch(channelId, command, cwd, onCrash, onLog) {
    if (this.activeServers.has(channelId)) {
      this.stopWatch(channelId);
    }

    const child = spawn(command, {
      shell: true,
      cwd: cwd || process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const serverEntry = {
      child,
      command,
      cwd,
      logs: [],
      startTime: Date.now(),
      crashReported: false,
      crashTimer: null
    };

    const crashPatterns = [
      /UnhandledPromiseRejection/i,
      /fatal error/i,
      /panic:/i,
      /Traceback \(most recent call last\):/i,
      /uncaughtException/i,
      /SyntaxError:/i,
      /TypeError:/i,
      /ReferenceError:/i,
      /Error: listen EADDRINUSE/i,
      /npm ERR!/i,
      /node:internal\//i,
      /System\.Exception/i
    ];

    const handleLogLine = (line, isError) => {
      const cleanLine = line.trimEnd();
      if (!cleanLine) return;
      serverEntry.logs.push(`[${new Date().toLocaleTimeString()}] ${cleanLine}`);
      if (serverEntry.logs.length > 100) serverEntry.logs.shift();

      if (onLog) onLog(cleanLine);

      // Check crash pattern
      const isCrashMatch = crashPatterns.some(p => p.test(cleanLine));
      if (isCrashMatch && !serverEntry.crashReported) {
        if (!serverEntry.crashTimer) {
          serverEntry.crashTimer = setTimeout(() => {
            if (!serverEntry.crashReported) {
              serverEntry.crashReported = true;
              const tail = serverEntry.logs.slice(-25).join('\n');
              if (onCrash) {
                onCrash({
                  channelId,
                  command,
                  cwd,
                  errorSnippet: cleanLine,
                  fullTail: tail,
                  exitCode: null
                });
              }
            }
          }, 800);
        }
      }
    };

    let stdoutBuffer = '';
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();
      for (const line of lines) handleLogLine(line, false);
    });

    let stderrBuffer = '';
    child.stderr.on('data', chunk => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();
      for (const line of lines) handleLogLine(line, true);
    });

    child.on('exit', (code, signal) => {
      // If exited abnormally and crash not yet reported
      if (code !== 0 && code !== null && !serverEntry.crashReported) {
        serverEntry.crashReported = true;
        const tail = serverEntry.logs.slice(-25).join('\n');
        if (onCrash) {
          onCrash({
            channelId,
            command,
            cwd,
            errorSnippet: `Process exited with code ${code} (${signal || 'NONE'})`,
            fullTail: tail,
            exitCode: code
          });
        }
      }
      this.activeServers.delete(channelId);
    });

    child.on('error', (err) => {
      if (!serverEntry.crashReported) {
        serverEntry.crashReported = true;
        if (onCrash) {
          onCrash({
            channelId,
            command,
            cwd,
            errorSnippet: err.message,
            fullTail: err.stack || err.message,
            exitCode: -1
          });
        }
      }
      this.activeServers.delete(channelId);
    });

    this.activeServers.set(channelId, serverEntry);
    return serverEntry;
  }

  stopWatch(channelId) {
    const entry = this.activeServers.get(channelId);
    if (!entry) return false;

    try {
      if (entry.crashTimer) clearTimeout(entry.crashTimer);
      // Windows taskkill to terminate entire process tree
      if (entry.child && entry.child.pid) {
        exec(`taskkill /F /T /PID ${entry.child.pid}`, () => {});
      }
    } catch (_) {}

    this.activeServers.delete(channelId);
    return true;
  }

  isWatching(channelId) {
    return this.activeServers.has(channelId);
  }

  getServerInfo(channelId) {
    return this.activeServers.get(channelId) || null;
  }

  getRecentLogs(channelId, maxLines = 25) {
    const entry = this.activeServers.get(channelId);
    if (!entry) return null;
    return entry.logs.slice(-maxLines).join('\n');
  }
}

module.exports = { WatchdogService };
