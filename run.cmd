@echo off
cd /d "%~dp0"

set "CHOKIDAR_USEPOLLING=1"
set "CHOKIDAR_INTERVAL=250"

call npm run dev
