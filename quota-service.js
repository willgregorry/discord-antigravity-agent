const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');

class QuotaService {
  constructor() {
    this.cachedPort = null;
    this.cachedCsrfToken = null;
    this.cachedCa = null;
    this.certPath = 'd:/Antigravity IDE/resources/app/extensions/antigravity/dist/languageServer/cert.pem';
    if (fs.existsSync(this.certPath)) {
      this.cachedCa = fs.readFileSync(this.certPath);
    }
  }

  async discoverConnection() {
    try {
      const psOut = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server*' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"`,
        { encoding: 'utf8', timeout: 5000 }
      );
      if (!psOut || !psOut.trim()) return null;

      const procs = JSON.parse(psOut);
      const procList = Array.isArray(procs) ? procs : [procs];
      const proc = procList.find(p => p.CommandLine && p.CommandLine.includes('cloudcode')) || procList[0];
      if (!proc) return null;

      const csrfMatch = proc.CommandLine.match(/--csrf_token\s+([a-zA-Z0-9_-]+)/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;
      if (!csrfToken) return null;

      const netOut = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection | Where-Object { $_.OwningProcess -eq ${proc.ProcessId} -and $_.State -eq 'Listen' } | Select-Object LocalPort | ConvertTo-Json"`,
        { encoding: 'utf8', timeout: 5000 }
      );
      const netPorts = JSON.parse(netOut);
      const ports = (Array.isArray(netPorts) ? netPorts : [netPorts]).map(p => p.LocalPort);

      for (const port of ports) {
        const ok = await this.pingPort(port, csrfToken);
        if (ok) {
          this.cachedPort = port;
          this.cachedCsrfToken = csrfToken;
          return { port, csrfToken };
        }
      }
    } catch (err) {
      console.error('Failed to discover language server connection:', err.message);
    }
    return null;
  }

  pingPort(port, csrfToken) {
    return new Promise(resolve => {
      const req = https.request(`https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`, {
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
      const ok = await this.pingPort(this.cachedPort, this.cachedCsrfToken);
      if (ok) {
        conn = { port: this.cachedPort, csrfToken: this.cachedCsrfToken };
      }
    }

    if (!conn) {
      conn = await this.discoverConnection();
    }

    if (!conn) {
      throw new Error('Antigravity Language Server tidak terdeteksi. Pastikan Antigravity IDE sedang aktif.');
    }

    const [quotaSummary, userStatus] = await Promise.all([
      this.callRpc(conn.port, conn.csrfToken, 'RetrieveUserQuotaSummary', { forceRefresh: true }),
      this.callRpc(conn.port, conn.csrfToken, 'GetUserStatus', {})
    ]);

    return {
      quotaSummary: quotaSummary?.response || null,
      userStatus: userStatus?.userStatus || null
    };
  }

  callRpc(port, csrfToken, method, body = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request(`https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/${method}`, {
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
