@echo off
title Tele-AI Studio Server
cd /d "%~dp0\.."
echo ====================================================
echo Starting Tele-AI Studio Server...
echo Web Dashboard: http://localhost:3000
echo ====================================================
node server/index.js
pause
