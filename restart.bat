@echo off
echo Menghentikan instance lama...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*Antigravity-Agent*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 1 >nul
echo Memulai Antigravity Discord Agent baru...
cd /d "%~dp0"
start "" wscript.exe start-hidden.vbs
echo Berhasil di-restart di background!
