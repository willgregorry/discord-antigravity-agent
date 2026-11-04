const { execSync } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');

class QuotaService {
  constructor() {
    this.cachedPort = null;
    this.cachedCsrfToken = null;
    this.cachedProtocol = 'http';
    this.cachedCa = null;
    this.certPath = process.env.ANTIGRAVITY_CERT_PATH || null;
    if (this.certPath && fs.existsSync(this.certPath)) {
      try {
        this.cachedCa = fs.readFileSync(this.certPath);
      } catch (_) {}
    }
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

  async fetchQuotaAndStatus() {
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
      throw new Error('Antigravity Language Server / Hub tidak terdeteksi. Pastikan Antigravity IDE sedang aktif dan proses download backend (di pojok kiri bawah IDE) sudah selesai.');
    }

    const [quotaSummary, userStatus] = await Promise.all([
      this.callRpc(conn.port, conn.csrfToken, 'RetrieveUserQuotaSummary', { forceRefresh: true }, conn.protocol),
      this.callRpc(conn.port, conn.csrfToken, 'GetUserStatus', {}, conn.protocol)
    ]);

    return {
      quotaSummary: quotaSummary?.response || null,
      userStatus: userStatus?.userStatus || null
    };
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
