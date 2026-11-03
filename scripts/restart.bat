@echo off
echo Menghentikan instance lama...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*index.js*' -and $_.CommandLine -notlike '*npm-cache*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 1 >nul
echo Memulai Antigravity Discord Agent baru...
cd /d "%~dp0\.."
start "" wscript.exe scripts\start-hidden.vbs
echo Berhasil di-restart di background!
