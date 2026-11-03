@echo off
cd /d "%~dp0"
title Antigravity Discord Agent - Setup
echo Installing dependencies...
call npm install
echo.
echo Running setup wizard...
node setup.js
pause
