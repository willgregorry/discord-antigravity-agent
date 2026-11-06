@echo off
echo Menghentikan instance lama...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object CommandLine -match 'node.*index\.js' | Where-Object CommandLine -notmatch 'npm-cache' | Where-Object CommandLine -notmatch 'NVIDIA' | Stop-Process -Force -ErrorAction SilentlyContinue"
timeout /t 1 >nul
echo Memulai Antigravity Discord Agent baru...
cd /d "%~dp0\.."
start "" wscript.exe scripts\start-hidden.vbs
echo Berhasil di-restart di background!
