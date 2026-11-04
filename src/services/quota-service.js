const { execSync, execFile } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function getAgyBinary() {
  const localApp = process.env.LOCALAPPDATA || '';
  if (localApp) {
    const candidate = path.join(localApp, 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'agy';
}

class QuotaService {
  constructor() {
    this.cachedPort = null;
    this.cachedCsrfToken = null;
    this.cachedProtocol = 'http';
    this.cachedCa = null;
    this.lastQuotaResult = null;
    this.lastFetchTime = 0;
    this.certPath = process.env.ANTIGRAVITY_CERT_PATH || null;
    if (this.certPath && fs.existsSync(this.certPath)) {
      try {
        this.cachedCa = fs.readFileSync(this.certPath);
      } catch (_) {}
    }
  }

  clearCache() {
    this.lastQuotaResult = null;
    this.lastFetchTime = 0;
  }

  async fetchQuotaFromCli() {
    return new Promise((resolve, reject) => {
      const agyBin = getAgyBinary();
      execFile(agyBin, ['-p', '/quota', '--output-format', 'json'], { timeout: 12000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          return reject(err);
        }
        try {
          const json = JSON.parse(stdout);
          const data = json.command?.data;
          if (data && Array.isArray(data.groups)) {
            const groups = data.groups.map(g => ({
              name: g.name,
              description: g.description || '',
              buckets: (g.buckets || []).map(b => ({
                id: b.id,
                name: b.name,
                description: b.description || '',
                window: b.window,
                remainingFraction: b.remaining_fraction !== undefined ? b.remaining_fraction : 1,
                resetTime: b.reset_time || null
              }))
            }));
            return resolve({
              source: 'cli',
              description: data.description,
              groups
            });
          }
          reject(new Error('Invalid JSON structure from agy quota command'));
        } catch (e) {
          reject(new Error(`Failed to parse agy output: ${e.message}`));
        }
      });
    });
  }

  async discoverConnection() {
    try {
      const psCmd = `Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*--hub*' -or $_.Name -like '*language_server*') -and $_.CommandLine -like '*--csrf_token*' } | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Depth 2`;
      const psOut = execSync(
        `powershell -NoProfile -Command "${psCmd}"`,
        { encoding: 'utf8', timeout: 5000 }
      );
      if (!psOut || !psOut.trim()) return null;

      const procs = JSON.parse(psOut);
      const procList = Array.isArray(procs) ? procs : [procs];

      for (const proc of procList) {
        const cmd = proc.CommandLine || '';
        const csrfMatch = cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9_-]+)/);
        const csrfToken = csrfMatch ? csrfMatch[1] : null;
        if (!csrfToken) continue;

        // 1. Antigravity IDE 2.0 Hub (HTTP via --hub-port)
        const hubMatch = cmd.match(/--hub-port[=\s]+(\d+)/);
        if (hubMatch) {
          const port = parseInt(hubMatch[1], 10);
          const ok = await this.pingPort(port, csrfToken, 'http');
          if (ok) {
            this.cachedPort = port;
            this.cachedCsrfToken = csrfToken;
            this.cachedProtocol = 'http';
            return { port, csrfToken, protocol: 'http' };
          }
        }

        // 2. Fallback to NetTCPConnection listening ports
        try {
          const netOut = execSync(
            `powershell -NoProfile -Command "Get-NetTCPConnection | Where-Object { $_.OwningProcess -eq ${proc.ProcessId} -and $_.State -eq 'Listen' } | Select-Object LocalPort | ConvertTo-Json"`,
            { encoding: 'utf8', timeout: 5000 }
          );
          const netPorts = JSON.parse(netOut);
          const ports = (Array.isArray(netPorts) ? netPorts : [netPorts]).map(p => p.LocalPort);

          for (const port of ports) {
            for (const proto of ['http', 'https']) {
              const ok = await this.pingPort(port, csrfToken, proto);
              if (ok) {
                this.cachedPort = port;
                this.cachedCsrfToken = csrfToken;
                this.cachedProtocol = proto;
                return { port, csrfToken, protocol: proto };
              }
            }
          }
        } catch (_) {}
      }
    } catch (err) {
      console.error('Failed to discover language server connection:', err.message);
    }
    return null;
  }

  pingPort(port, csrfToken, protocol = 'http') {
    return new Promise(resolve => {
      const mod = protocol === 'http' ? http : https;
      const req = mod.request({
        hostname: '127.0.0.1',
        port,
        path: '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrfToken
        },
        rejectUnauthorized: false,
        ca: this.cachedCa,
        timeout: 1500
      }, res => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.write(JSON.stringify({ forceRefresh: false }));
      req.end();
    });
  }

  async fetchQuotaAndStatus(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.lastQuotaResult && (now - this.lastFetchTime < 15000)) {
      return this.lastQuotaResult;
    }

    // 1. Prioritaskan Antigravity CLI langsung (sesuai akun aktif di terminal/token CLI)
    try {
      const cliResult = await this.fetchQuotaFromCli();
      if (cliResult && cliResult.groups && cliResult.groups.length > 0) {
        this.lastQuotaResult = cliResult;
        this.lastFetchTime = now;
        return cliResult;
      }
    } catch (cliErr) {
      console.warn('CLI quota fetch failed, falling back to Language Server:', cliErr.message);
    }

    // 2. Fallback ke Language Server IDE jika agy print mode tidak tersedia
    let conn = null;
    if (this.cachedPort && this.cachedCsrfToken) {
      const ok = await this.pingPort(this.cachedPort, this.cachedCsrfToken, this.cachedProtocol || 'http');
      if (ok) {
        conn = { port: this.cachedPort, csrfToken: this.cachedCsrfToken, protocol: this.cachedProtocol || 'http' };
      }
    }

    if (!conn) {
      conn = await this.discoverConnection();
    }

    if (!conn) {
      throw new Error('Antigravity CLI maupun Language Server tidak terdeteksi. Pastikan perintah agy dapat dijalankan.');
    }

    const [quotaSummary, userStatus] = await Promise.all([
      this.callRpc(conn.port, conn.csrfToken, 'RetrieveUserQuotaSummary', { forceRefresh: true }, conn.protocol),
      this.callRpc(conn.port, conn.csrfToken, 'GetUserStatus', {}, conn.protocol)
    ]);

    const groups = (quotaSummary?.response?.groups || []).map(g => ({
      name: g.displayName || g.name,
      description: g.description || '',
      buckets: (g.buckets || []).map(b => ({
        id: b.id,
        name: b.displayName || b.name,
        description: b.description || '',
        window: b.window,
        remainingFraction: b.remainingFraction !== undefined ? b.remainingFraction : (b.remaining_fraction ?? 1),
        resetTime: b.resetTime || b.reset_time || null
      }))
    }));

    const result = {
      source: 'ide',
      groups,
      userStatus: userStatus?.userStatus || null
    };

    this.lastQuotaResult = result;
    this.lastFetchTime = now;
    return result;
  }

  formatCliUsageScreen(quotaData, accountEmail) {
    const lines = [];
    lines.push('\u001b[1;37m└ Models & Quota\u001b[0m');
    lines.push('');
    lines.push(`  \u001b[1;34mAccount:\u001b[0m \u001b[1;36m${accountEmail || 'Active CLI Account'}\u001b[0m`);
    lines.push('');

    const groups = quotaData?.groups || [];
    for (const group of groups) {
      const groupNameUpper = (group.name || '').toUpperCase();
      lines.push(`\u001b[1;33m${groupNameUpper}\u001b[0m`);
      if (group.description) {
        lines.push(`  \u001b[0;37m${group.description}\u001b[0m`);
      }
      lines.push('');

      for (const bucket of group.buckets || []) {
        lines.push(`  ${bucket.name}`);
        const frac = Math.max(0, Math.min(1, bucket.remainingFraction ?? 1));
        const pctNum = (frac * 100).toFixed(2);

        // Progress bar 30 karakter agar sangat pas di HP tanpa wrap
        const totalWidth = 30;
        const filledWidth = Math.round(frac * totalWidth);
        const unfilledWidth = Math.max(0, totalWidth - filledWidth);
        const barStr = '█'.repeat(filledWidth) + '░'.repeat(unfilledWidth);

        // Warna ANSI berdasarkan sisa kuota
        let colorCode = '\u001b[1;32m'; // Hijau jika > 50%
        if (frac < 0.2) colorCode = '\u001b[1;31m'; // Merah jika kritis
        else if (frac < 0.5) colorCode = '\u001b[1;33m'; // Kuning jika menipis

        lines.push(`  ${colorCode}[${barStr}] ${pctNum}%\u001b[0m`);

        // Hanya tampilkan reset time jika ada pemakaian (< 100%) dan resetTime tersedia
        if (bucket.resetTime && frac < 1.0) {
          const resetDate = new Date(bucket.resetTime);
          const diffMs = resetDate.getTime() - Date.now();
          if (diffMs > 0) {
            const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
            const totalMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            lines.push(`  \u001b[0;32mRefreshes in ${totalHours}h ${totalMins}m\u001b[0m`);
          }
        }
        lines.push('');
      }
    }

    return '```ansi\n' + lines.join('\n') + '```';
  }

  callRpc(port, csrfToken, method, body = {}, protocol = 'http') {
    return new Promise((resolve, reject) => {
      const mod = protocol === 'http' ? http : https;
      const req = mod.request({
        hostname: '127.0.0.1',
        port,
        path: `/exa.language_server_pb.LanguageServerService/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrfToken
        },
        rejectUnauthorized: false,
        ca: this.cachedCa,
        timeout: 4000
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Failed to parse response: ${e.message}`));
            }
          } else {
            reject(new Error(`RPC ${method} returned HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', err => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`RPC ${method} timeout`));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }
}

module.exports = { QuotaService };
