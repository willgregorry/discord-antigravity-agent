@echo off
echo Stopping Antigravity Discord Agent...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object CommandLine -match 'node.*index\.js' | Where-Object CommandLine -notmatch 'npm-cache' | Where-Object CommandLine -notmatch 'NVIDIA' | Stop-Process -Force -ErrorAction SilentlyContinue"
echo Antigravity Discord Agent stopped.
pause
