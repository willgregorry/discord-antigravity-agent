const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class TunnelService {
  constructor() {
    this.activeTunnels = new Map(); // channelId -> { process, url, port }
    this.cloudflaredPath = path.join(__dirname, 'bin', 'cloudflared.exe');
  }

  async startTunnel(channelId, port) {
    if (this.activeTunnels.has(channelId)) {
      this.stopTunnel(channelId);
    }

    if (!fs.existsSync(this.cloudflaredPath)) {
      throw new Error('cloudflared binary tidak ditemukan di ' + this.cloudflaredPath);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(this.cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
        windowsHide: true
      });

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          child.kill();
          reject(new Error('Timeout: Gagal mendapatkan URL tunnel dalam 15 detik.'));
        }
      }, 15000);

      const checkUrl = (chunk) => {
        const str = chunk.toString();
        const m = str.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (m && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          const tunnelUrl = m[0];
          this.activeTunnels.set(channelId, { process: child, url: tunnelUrl, port });
          resolve(tunnelUrl);
        }
      };

      child.stderr.on('data', checkUrl);
      child.stdout.on('data', checkUrl);

      child.on('error', (err) => {
        if (!resolved) {
          clearTimeout(timeout);
          reject(err);
        }
      });

      child.on('close', () => {
        this.activeTunnels.delete(channelId);
      });
    });
  }

  stopTunnel(channelId) {
    if (this.activeTunnels.has(channelId)) {
      const item = this.activeTunnels.get(channelId);
      try {
        item.process.kill();
      } catch (_) {}
      this.activeTunnels.delete(channelId);
      return item;
    }
    return null;
  }

  getTunnel(channelId) {
    return this.activeTunnels.get(channelId) || null;
  }
}

module.exports = { TunnelService };
