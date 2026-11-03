const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function runEncodedPowerShell(script) {
  return new Promise((resolve, reject) => {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || stdout || err.message));
      }
      resolve(stdout.trim());
    });
  });
}

class SystemService {
  constructor() {
    this.watcherInterval = null;
    this.lastAlertTime = 0;
  }

  async getStatus() {
    const psScript = `
$battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$disks = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3'

$diskList = @()
foreach ($d in $disks) {
    $diskList += @{
        Drive = $d.DeviceID
        FreeGB = [math]::Round($d.FreeSpace / 1GB, 1)
        TotalGB = [math]::Round($d.Size / 1GB, 1)
    }
}

$statusObj = @{
    BatteryPercent = if ($battery) { $battery.EstimatedChargeRemaining } else { $null }
    BatteryStatus = if ($battery) { $battery.BatteryStatus } else { $null }
    CpuLoad = if ($cpu) { [math]::Round($cpu) } else { 0 }
    TotalRamMB = [math]::Round($os.TotalVisibleMemorySize / 1024)
    FreeRamMB = [math]::Round($os.FreePhysicalMemory / 1024)
    BootTime = $os.LastBootUpTime.ToString('yyyy-MM-ddTHH:mm:ssZ')
    Disks = $diskList
}

$statusObj | ConvertTo-Json -Compress
`;
    const output = await runEncodedPowerShell(psScript);
    return JSON.parse(output);
  }

  lockWorkstation() {
    exec('rundll32.exe user32.dll,LockWorkStation');
  }

  turnOffMonitor() {
    const ps = `(Add-Type '[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);' -Name a -PassThru)::SendMessage(0xffff, 0x0112, 0xF170, 2)`;
    exec(`powershell -NoProfile -Command "${ps}"`);
  }

  sleepLaptop() {
    exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
  }

  shutdownLaptop() {
    exec('shutdown /s /t 10');
  }

  cancelShutdown() {
    exec('shutdown /a');
  }

  async captureScreenshot(targetPath) {
    const resolved = path.resolve(targetPath);
    const escaped = resolved.replace(/'/g, "''");
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
} catch {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $screen.Size)
}
$dir = Split-Path -Parent '${escaped}'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bitmap.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
    await runEncodedPowerShell(psScript);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    throw new Error('Gagal menyimpan file screenshot: ' + resolved);
  }

  startBatteryWatcher(onAlert) {
    if (this.watcherInterval) clearInterval(this.watcherInterval);
    this.watcherInterval = setInterval(async () => {
      try {
        const stats = await this.getStatus();
        if (stats.BatteryPercent !== null && stats.BatteryPercent <= 20 && stats.BatteryStatus === 1) { // 1 = Discharging
          const now = Date.now();
          if (now - this.lastAlertTime > 15 * 60 * 1000) { // Max 1 alert per 15 mins
            this.lastAlertTime = now;
            onAlert(stats);
          }
        }
      } catch (_) {}
    }, 2 * 60 * 1000); // Check every 2 mins
  }
}

module.exports = { SystemService };
