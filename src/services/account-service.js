const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

class AccountService {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, 'accounts_data');
    this.tokensDir = path.join(this.dataDir, 'tokens');
    this.profilesPath = path.join(this.dataDir, 'profiles.json');
    this.initDirs();
  }

  initDirs() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.tokensDir)) fs.mkdirSync(this.tokensDir, { recursive: true });
    if (!fs.existsSync(this.profilesPath)) {
      fs.writeFileSync(this.profilesPath, JSON.stringify({ activeAccountId: null, accounts: [] }, null, 2), 'utf8');
    }
    this.ensureCredHelperExe();
  }

  ensureCredHelperExe() {
    if (process.platform !== 'win32') return null;
    const binDir = path.join(this.rootDir, 'bin');
    const exePath = path.join(binDir, 'cred_helper.exe');
    const csPath = path.join(this.rootDir, 'scripts', 'cred_helper.cs');
    if (fs.existsSync(exePath)) return exePath;
    if (!fs.existsSync(csPath)) return null;

    try {
      if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
      const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
      if (fs.existsSync(cscPath)) {
        execFileSync(cscPath, ['/nologo', '/optimize', `/out:${exePath}`, csPath], {
          timeout: 10000,
          windowsHide: true
        });
        if (fs.existsSync(exePath)) return exePath;
      }
    } catch (_) {}
    return null;
  }

  getLiveTokenPaths() {
    const paths = [];
    if (process.env.ANTIGRAVITY_TOKEN_PATH) {
      paths.push(process.env.ANTIGRAVITY_TOKEN_PATH);
    }
    const roots = [os.homedir(), process.env.USERPROFILE].filter(Boolean);
    for (const r of roots) {
      paths.push(path.join(r, '.gemini', 'antigravity', 'antigravity-oauth-token'));
      paths.push(path.join(r, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'));
    }
    return [...new Set(paths)];
  }

  getLiveTokenPath() {
    const all = this.getLiveTokenPaths();
    for (const p of all) {
      if (fs.existsSync(p)) return p;
    }
    return all[0] || path.join(os.homedir(), '.gemini', 'antigravity', 'antigravity-oauth-token');
  }

  writeLiveToken(rawJsonString) {
    let minified = rawJsonString;
    let pretty = rawJsonString;
    try {
      const parsed = JSON.parse(rawJsonString);
      minified = JSON.stringify(parsed);
      pretty = JSON.stringify(parsed, null, 2);
    } catch (_) {}

    const all = this.getLiveTokenPaths();
    for (const p of all) {
      try {
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(p, pretty, 'utf8');
      } catch (_) {}
    }
    return this.writeCredToWinCred(minified);
  }

  readCredFromWinCred() {
    if (process.platform !== 'win32') return null;
    try {
      const exePath = this.ensureCredHelperExe();
      if (exePath && fs.existsSync(exePath)) {
        const out = execFileSync(exePath, ['read'], {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true
        });
        if (out && out.trim()) {
          return JSON.parse(out.trim());
        }
      }
    } catch (_) {}

    try {
      const scriptPath = path.join(this.rootDir, 'scripts', 'cred_helper.ps1');
      if (!fs.existsSync(scriptPath)) return null;
      const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', 'read'], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true
      });
      if (out && out.trim()) {
        return JSON.parse(out.trim());
      }
    } catch (_) {}
    return null;
  }

  writeCredToWinCred(tokenJsonString) {
    if (process.platform !== 'win32') return false;
    let payload = tokenJsonString;
    try {
      payload = JSON.stringify(JSON.parse(tokenJsonString));
    } catch (_) {}

    try {
      const exePath = this.ensureCredHelperExe();
      if (exePath && fs.existsSync(exePath)) {
        const tmpFile = path.join(this.dataDir, `.tmp_cred_${Date.now()}.json`);
        fs.writeFileSync(tmpFile, payload, 'utf8');
        try {
          const out = execFileSync(exePath, ['write', tmpFile], {
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true
          });
          if (out && out.trim() === 'OK') return true;
        } finally {
          try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
        }
      }
    } catch (_) {}

    try {
      const scriptPath = path.join(this.rootDir, 'scripts', 'cred_helper.ps1');
      if (!fs.existsSync(scriptPath)) return false;
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', 'write'], {
        input: payload,
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true
      });
      return true;
    } catch (_) {}
    return false;
  }

  readLiveToken() {
    // 1. Try Windows Credential Manager first on Windows
    const winCred = this.readCredFromWinCred();
    if (winCred) {
      try {
        const pretty = JSON.stringify(winCred, null, 2);
        const diskPaths = this.getLiveTokenPaths();
        for (const p of diskPaths) {
          const dir = path.dirname(p);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(p, pretty, 'utf8');
        }
        // Keep matching saved profile token fresh if agy refreshed access_token
        const liveEmail = (winCred.id_token_email || winCred.email || '').toLowerCase();
        if (liveEmail && winCred.refresh_token) {
          const data = this.getProfilesData();
          const matched = (data.accounts || []).find(a => (a.email || '').toLowerCase() === liveEmail);
          if (matched) {
            const savedPath = path.join(this.tokensDir, `${matched.id}.json`);
            fs.writeFileSync(savedPath, pretty, 'utf8');
          }
        }
      } catch (_) {}
      return winCred;
    }

    // 2. Fallback to live token files on disk
    const paths = this.getLiveTokenPaths();
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch (_) {}
      }
    }
    return null;
  }

  maskEmail(email) {
    if (!email || !email.includes('@')) return email || '(Tanpa Email)';
    const [name, domain] = email.split('@');
    if (name.length <= 2) return `${name}***@${domain}`;
    return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
  }

  getProfilesData() {
    this.initDirs();
    try {
      return JSON.parse(fs.readFileSync(this.profilesPath, 'utf8'));
    } catch (_) {
      return { activeAccountId: null, accounts: [] };
    }
  }

  saveProfilesData(data) {
    this.initDirs();
    fs.writeFileSync(this.profilesPath, JSON.stringify(data, null, 2), 'utf8');
  }

  getAccounts() {
    const data = this.getProfilesData();
    const liveToken = this.readLiveToken();
    const liveEmail = liveToken ? (liveToken.id_token_email || liveToken.email || null) : null;

    if (liveEmail) {
      const matched = (data.accounts || []).find(a => (a.email || '').toLowerCase() === liveEmail.toLowerCase());
      if (matched && data.activeAccountId !== matched.id) {
        data.activeAccountId = matched.id;
        this.saveProfilesData(data);
      } else if (!matched && data.activeAccountId) {
        data.activeAccountId = null;
        this.saveProfilesData(data);
      }
    }

    return {
      activeAccountId: data.activeAccountId,
      accounts: data.accounts || [],
      liveToken: liveToken ? {
        email: liveEmail,
        maskedEmail: this.maskEmail(liveEmail),
        authMethod: liveToken.auth_method || 'oauth'
      } : null
    };
  }

  saveCurrentLiveAccount(label) {
    const liveToken = this.readLiveToken();
    if (!liveToken) {
      throw new Error('Tidak ditemukan token aktif di laptop (Windows Credential Manager / file). Pastikan kamu sudah pernah login di agy.');
    }

    const email = liveToken.id_token_email || liveToken.email || 'unknown@google.com';
    const accountId = `acc_${Date.now()}`;
    const tokenFilePath = path.join(this.tokensDir, `${accountId}.json`);

    fs.writeFileSync(tokenFilePath, JSON.stringify(liveToken, null, 2), 'utf8');

    const data = this.getProfilesData();
    const cleanLabel = (label || `Akun ${email.split('@')[0]}`).trim();

    data.accounts.push({
      id: accountId,
      label: cleanLabel,
      email: email,
      maskedEmail: this.maskEmail(email),
      addedAt: new Date().toISOString()
    });
    data.activeAccountId = accountId;

    this.saveProfilesData(data);
    return { id: accountId, label: cleanLabel, email };
  }

  saveDirectToken(label, tokenJsonString) {
    let parsed;
    try {
      parsed = typeof tokenJsonString === 'object' ? tokenJsonString : JSON.parse(tokenJsonString.trim());
    } catch (err) {
      throw new Error(`Format JSON token tidak valid: ${err.message}`);
    }

    if (!parsed || (typeof parsed !== 'object')) {
      throw new Error('Token harus berupa objek JSON yang valid.');
    }

    const email = parsed.id_token_email || parsed.email || 'custom@google.com';
    const accountId = `acc_${Date.now()}`;
    const tokenFilePath = path.join(this.tokensDir, `${accountId}.json`);

    fs.writeFileSync(tokenFilePath, JSON.stringify(parsed, null, 2), 'utf8');

    const data = this.getProfilesData();
    const cleanLabel = (label || `Akun ${email.split('@')[0]}`).trim();

    data.accounts.push({
      id: accountId,
      label: cleanLabel,
      email: email,
      maskedEmail: this.maskEmail(email),
      addedAt: new Date().toISOString()
    });

    this.saveProfilesData(data);
    return { id: accountId, label: cleanLabel, email };
  }

  switchAccount(accountId) {
    const data = this.getProfilesData();
    const target = data.accounts.find(a => a.id === accountId);
    if (!target) {
      throw new Error(`Akun dengan ID '${accountId}' tidak ditemukan.`);
    }

    const tokenFilePath = path.join(this.tokensDir, `${accountId}.json`);
    if (!fs.existsSync(tokenFilePath)) {
      throw new Error(`File token untuk '${target.label}' tidak ditemukan di disk.`);
    }

    const raw = fs.readFileSync(tokenFilePath, 'utf8');
    
    // Write to ALL live token paths and Windows Credential Manager
    const wroteCred = this.writeLiveToken(raw);
    if (process.platform === 'win32') {
      const verifyCred = this.readCredFromWinCred();
      const verifyEmail = (verifyCred?.id_token_email || verifyCred?.email || '').toLowerCase();
      if (!wroteCred || (target.email && verifyEmail !== target.email.toLowerCase())) {
        throw new Error(`Gagal menyinkronkan kredensial Windows Credential Manager untuk ${target.label}.`);
      }
    }

    data.activeAccountId = accountId;
    this.saveProfilesData(data);

    return target;
  }

  deleteAccount(accountId) {
    const data = this.getProfilesData();
    const index = data.accounts.findIndex(a => a.id === accountId);
    if (index === -1) {
      throw new Error('Akun tidak ditemukan.');
    }

    const removed = data.accounts.splice(index, 1)[0];
    const tokenFilePath = path.join(this.tokensDir, `${accountId}.json`);
    if (fs.existsSync(tokenFilePath)) {
      try { fs.unlinkSync(tokenFilePath); } catch (_) {}
    }

    if (data.activeAccountId === accountId) {
      data.activeAccountId = null;
    }

    this.saveProfilesData(data);
    return removed;
  }
}

module.exports = { AccountService };
