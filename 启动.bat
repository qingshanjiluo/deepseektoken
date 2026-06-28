@echo off
cd /d %~dp0
set NON_INTERACTIVE=1
node server.js
pause
