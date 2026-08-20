@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "VP_REPO=%CD%"
set "VP_DEV_WAS_RUNNING=0"
set "VP_DEV_PID="
set "VP_LOCAL_UPDATER="
set "VP_REMOTE_UPDATER="

rem Self-update must happen before the updater performs application upgrade work.
rem Keep this flow outside parenthesized blocks: cmd.exe expands %%variables%% for an
rem entire block before execution, and nested CALL after replacing this file can
rem otherwise corrupt parsing of later PowerShell commands.
if /I "%~1"=="--self-updated" goto :after_self_update

echo [VoicePrompter] Checking upgrade.cmd version...
git fetch origin devel || goto :error

for /f "delims=" %%H in ('git rev-parse HEAD:upgrade.cmd 2^>nul') do set "VP_LOCAL_UPDATER=%%H"
for /f "delims=" %%H in ('git rev-parse origin/devel:upgrade.cmd 2^>nul') do set "VP_REMOTE_UPDATER=%%H"

if not defined VP_REMOTE_UPDATER goto :self_update_read_error
if /I "%VP_LOCAL_UPDATER%"=="%VP_REMOTE_UPDATER%" goto :self_update_current

echo [VoicePrompter] A newer upgrade.cmd is available. Updating updater first...
call :check_clean_tree
if errorlevel 1 goto :error

git checkout devel || goto :error
git reset --hard origin/devel || goto :error

echo [VoicePrompter] Restarting with the current upgrade.cmd...
call "%~f0" --self-updated
exit /b %errorlevel%

:self_update_read_error
echo ERROR: Could not read upgrade.cmd from origin/devel.
goto :error

:self_update_current
echo [VoicePrompter] upgrade.cmd is current.

:after_self_update
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

echo [VoicePrompter] Checking local working tree...
call :check_clean_tree
if errorlevel 1 goto :error

echo [VoicePrompter] Switching to devel...
git checkout devel || goto :error

echo [VoicePrompter] Fetching latest devel from origin...
git fetch origin devel || goto :error

echo [VoicePrompter] Synchronizing local devel with origin/devel...
git reset --hard origin/devel || goto :error

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

:check_clean_tree
git diff --quiet 2>nul || goto :dirty_sub
git diff --cached --quiet 2>nul || goto :dirty_sub
exit /b 0

:dirty_sub
echo.
echo ERROR: Local uncommitted changes were found.
echo [VoicePrompter] Upgrade stopped to avoid overwriting your work.
echo [VoicePrompter] Commit, stash, or discard the local changes and run upgrade.cmd again.
exit /b 1

:error
if "%VP_DEV_WAS_RUNNING%"=="1" (
    echo [VoicePrompter] Upgrade failed. Restarting the previously running dev server...
    start "VoicePrompter DEV" cmd /k "cd /d "%VP_REPO%" && npm run dev"
)
echo.
echo [VoicePrompter] Upgrade FAILED. See the error above.
exit /b 1
