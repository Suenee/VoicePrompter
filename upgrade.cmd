@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "VP_REPO=%CD%"
set "VP_DEV_WAS_RUNNING=0"
set "VP_DEV_PID="

echo [VoicePrompter] Checking dev server on port 5173...
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$repo=$env:VP_REPO; $c=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue ^| Select-Object -First 1; if($c){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue; if($p -and $p.CommandLine -and $p.CommandLine.Contains($repo) -and $p.CommandLine -match 'vite'){Write-Output $p.ProcessId}}"`) do set "VP_DEV_PID=%%P"

if defined VP_DEV_PID (
    echo [VoicePrompter] VoicePrompter dev server detected, PID %VP_DEV_PID%. Stopping it safely...
    taskkill /PID %VP_DEV_PID% /T /F >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Could not stop VoicePrompter dev server PID %VP_DEV_PID%.
        goto :error
    )
    set "VP_DEV_WAS_RUNNING=1"
) else (
    echo [VoicePrompter] No verified VoicePrompter dev server is running on port 5173.
    echo [VoicePrompter] Other Node processes will not be touched.
)

echo [VoicePrompter] Switching to devel...
git checkout devel || goto :error

echo [VoicePrompter] Pulling latest changes...
git pull --ff-only || goto :error

echo [VoicePrompter] Installing dependencies...
call npm install || goto :error

echo [VoicePrompter] Building project...
call npm run build || goto :error

if "%VP_DEV_WAS_RUNNING%"=="1" (
    echo [VoicePrompter] Starting dev server in a separate terminal...
    start "VoicePrompter DEV" cmd /k "cd /d "%VP_REPO%" && npm run dev"
    timeout /t 2 /nobreak >nul
    powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}"
    if errorlevel 1 (
        echo WARNING: Dev server was started, but port 5173 is not listening yet. Check the VoicePrompter DEV window.
    ) else (
        echo [VoicePrompter] Dev server is listening on port 5173.
    )
)

echo.
echo [VoicePrompter] Upgrade completed successfully.
exit /b 0

:error
if "%VP_DEV_WAS_RUNNING%"=="1" (
    echo [VoicePrompter] Upgrade failed. Restarting the previously running dev server...
    start "VoicePrompter DEV" cmd /k "cd /d "%VP_REPO%" && npm run dev"
)
echo.
echo [VoicePrompter] Upgrade FAILED. See the error above.
exit /b 1
