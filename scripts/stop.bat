@echo off
echo Stopping Antigravity Discord Agent...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*index.js*' -and $_.CommandLine -notlike '*npm-cache*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Antigravity Discord Agent stopped.
pause
