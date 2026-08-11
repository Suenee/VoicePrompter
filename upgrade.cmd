@echo off
setlocal
cd /d "%~dp0"

echo [VoicePrompter] Switching to devel...
git checkout devel || goto :error

echo [VoicePrompter] Pulling latest changes...
git pull --ff-only || goto :error

echo [VoicePrompter] Installing dependencies...
call npm install || goto :error

echo [VoicePrompter] Building project...
call npm run build || goto :error

echo.
echo [VoicePrompter] Upgrade completed successfully.
exit /b 0

:error
echo.
echo [VoicePrompter] Upgrade FAILED. See the error above.
exit /b 1
