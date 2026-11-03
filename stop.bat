@echo off
echo Stopping Antigravity Discord Agent...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*Antigravity-Agent*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Antigravity Discord Agent stopped.
pause
