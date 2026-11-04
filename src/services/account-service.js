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
  }

  getLiveTokenPath() {
    if (process.env.ANTIGRAVITY_TOKEN_PATH && fs.existsSync(process.env.ANTIGRAVITY_TOKEN_PATH)) {
      return process.env.ANTIGRAVITY_TOKEN_PATH;
    }
    const homePath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
    if (fs.existsSync(homePath)) return homePath;

    const userProfile = process.env.USERPROFILE || '';
    if (userProfile) {
      const upPath = path.join(userProfile, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
      if (fs.existsSync(upPath)) return upPath;
    }
    return homePath;
  }

  readCredFromWinCred() {
    if (process.platform !== 'win32') return null;
    try {
      const scriptPath = path.join(this.rootDir, 'scripts', 'cred_helper.ps1');
      if (!fs.existsSync(scriptPath)) return null;
      const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', 'read'], {
        encoding: 'utf8',
        timeout: 6000,
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
    try {
      const scriptPath = path.join(this.rootDir, 'scripts', 'cred_helper.ps1');
      if (!fs.existsSync(scriptPath)) return false;
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', 'write'], {
        input: tokenJsonString,
        encoding: 'utf8',
        timeout: 6000,
        windowsHide: true
      });
      return true;
    } catch (_) {}
    return false;
  }

  readLiveToken() {
    // 1. Try Windows Credential Manager first on Windows
    const winCred = this.readCredFromWinCred();
    if (winCred) return winCred;

    // 2. Fallback to file on disk
    const p = this.getLiveTokenPath();
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        return JSON.parse(raw);
      } catch (_) {
        return null;
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
    return {
      activeAccountId: data.activeAccountId,
      accounts: data.accounts || [],
      liveToken: liveToken ? {
        email: liveToken.id_token_email || liveToken.email || null,
        maskedEmail: this.maskEmail(liveToken.id_token_email || liveToken.email),
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
    
    // 1. Write to Windows Credential Manager if on Windows
    this.writeCredToWinCred(raw);

    // 2. Also write to live file path for compatibility
    const livePath = this.getLiveTokenPath();
    const liveDir = path.dirname(livePath);
    if (!fs.existsSync(liveDir)) fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(livePath, raw, 'utf8');

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
