@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "VP_REPO=%CD%"
set "VP_LOG=%CD%\upgrade.log"
set "VP_DEV_WAS_RUNNING=0"
set "VP_DEV_PID="
set "VP_LOCAL_UPDATER="
set "VP_REMOTE_UPDATER="
set "VP_UPDATER_TMP=%CD%\upgrade.cmd.new"

rem Start every top-level upgrade with a fresh single-run log.
if /I not "%~1"=="--self-updated" >"%VP_LOG%" echo [VoicePrompter] Upgrade started %date% %time%

rem Bootstrap self-update first and independently of the rest of the working tree.
rem Only upgrade.cmd itself is replaced here. Working-tree safety checks happen
rem after the restarted updater is running.
if /I "%~1"=="--self-updated" goto :after_self_update

call :info "Checking upgrade.cmd version..."
git fetch origin devel >>"%VP_LOG%" 2>&1 || goto :error

for /f "delims=" %%H in ('git hash-object upgrade.cmd 2^>nul') do set "VP_LOCAL_UPDATER=%%H"
for /f "delims=" %%H in ('git rev-parse origin/devel:upgrade.cmd 2^>nul') do set "VP_REMOTE_UPDATER=%%H"

if not defined VP_REMOTE_UPDATER goto :self_update_read_error
if /I "%VP_LOCAL_UPDATER%"=="%VP_REMOTE_UPDATER%" goto :self_update_current

call :warn "A newer upgrade.cmd is available. Updating updater first..."
del /q "%VP_UPDATER_TMP%" >nul 2>&1

git show origin/devel:upgrade.cmd >"%VP_UPDATER_TMP%" 2>>"%VP_LOG%"
if errorlevel 1 goto :self_update_download_error

for /f "delims=" %%H in ('git hash-object "%VP_UPDATER_TMP%" 2^>nul') do set "VP_DOWNLOADED_UPDATER=%%H"
if /I not "%VP_DOWNLOADED_UPDATER%"=="%VP_REMOTE_UPDATER%" goto :self_update_verify_error

move /y "%VP_UPDATER_TMP%" "%~f0" >>"%VP_LOG%" 2>&1 || goto :self_update_replace_error

call :info "Restarting with the current upgrade.cmd..."
call "%~f0" --self-updated
exit /b %errorlevel%

:self_update_read_error
call :err "Could not read upgrade.cmd from origin/devel."
goto :error

:self_update_download_error
call :err "Could not download the current upgrade.cmd from origin/devel."
del /q "%VP_UPDATER_TMP%" >nul 2>&1
goto :error

:self_update_verify_error
call :err "Downloaded upgrade.cmd did not match the expected Git blob."
del /q "%VP_UPDATER_TMP%" >nul 2>&1
goto :error

:self_update_replace_error
call :err "Could not replace the local upgrade.cmd."
del /q "%VP_UPDATER_TMP%" >nul 2>&1
goto :error

:self_update_current
call :info "upgrade.cmd is current."

:after_self_update
call :info "Checking dev server on port 5173..."
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$repo=$env:VP_REPO; $c=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue ^| Select-Object -First 1; if($c){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue; if($p -and $p.CommandLine -and $p.CommandLine.Contains($repo) -and $p.CommandLine -match 'vite'){Write-Output $p.ProcessId}}"`) do set "VP_DEV_PID=%%P"

if defined VP_DEV_PID (
    call :info "VoicePrompter dev server detected, PID %VP_DEV_PID%. Stopping it safely..."
    taskkill /PID %VP_DEV_PID% /T /F >>"%VP_LOG%" 2>&1
    if errorlevel 1 (
        call :err "Could not stop VoicePrompter dev server PID %VP_DEV_PID%."
        goto :error
    )
    set "VP_DEV_WAS_RUNNING=1"
) else (
    call :info "No verified VoicePrompter dev server is running on port 5173."
    call :info "Other Node processes will not be touched."
)

call :info "Checking local working tree..."
call :check_clean_tree
if errorlevel 1 goto :error

call :info "Switching to devel..."
git checkout devel >>"%VP_LOG%" 2>&1 || goto :error

call :info "Fetching latest devel from origin..."
git fetch origin devel >>"%VP_LOG%" 2>&1 || goto :error

call :info "Synchronizing local devel with origin/devel..."
git reset --hard origin/devel >>"%VP_LOG%" 2>&1 || goto :error

call :info "Installing dependencies from package-lock.json..."
call npm ci >>"%VP_LOG%" 2>&1 || goto :error

call :info "Building VoicePrompter application..."
call npx tsc >>"%VP_LOG%" 2>&1 || goto :error
call npx vite build >>"%VP_LOG%" 2>&1 || goto :error

if "%VP_DEV_WAS_RUNNING%"=="1" (
    call :info "Starting dev server in a separate terminal..."
    start "VoicePrompter DEV" cmd /k "cd /d "%VP_REPO%" && npm run dev"
    timeout /t 2 /nobreak >nul
    powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}" >>"%VP_LOG%" 2>&1
    if errorlevel 1 (
        call :warn "Dev server was started, but port 5173 is not listening yet. Check the VoicePrompter DEV window."
    ) else (
        call :info "Dev server is listening on port 5173."
    )
)

call :info "Upgrade completed successfully."
exit /b 0

rem Working-tree policy:
rem - upgrade.log is an updater-owned transient file and may be ignored when untracked.
rem - upgrade.cmd may be ignored only as an unstaged modification whose blob hash
rem   exactly matches origin/devel:upgrade.cmd. This is the expected state immediately
rem   after bootstrap self-update while local HEAD still points at the previous commit.
rem - Only unstaged modifications of known generated HTML artifacts may be cleaned.
rem - Staged changes, source files, package-lock.json, untracked/deleted/renamed files,
rem   or anything else are unsafe and MUST stop the upgrade without modifying them.
:check_clean_tree
set "VP_HAS_SAFE_DIRTY=0"
set "VP_HAS_UNSAFE_DIRTY=0"

for /f "delims=" %%L in ('git status --porcelain --untracked-files^=all 2^>nul') do call :inspect_dirty "%%L"

if "%VP_HAS_UNSAFE_DIRTY%"=="1" goto :dirty_unsafe
if not "%VP_HAS_SAFE_DIRTY%"=="1" goto :working_tree_safe

call :warn "Only known generated web artifacts are modified. Restoring them safely..."
for /f "delims=" %%L in ('git status --porcelain --untracked-files^=all 2^>nul') do call :restore_safe_dirty "%%L"

rem Re-evaluate from scratch. Internal updater files may still be present, but no
rem generated artifact or unsafe user change may remain.
set "VP_HAS_SAFE_DIRTY=0"
set "VP_HAS_UNSAFE_DIRTY=0"
for /f "delims=" %%L in ('git status --porcelain --untracked-files^=all 2^>nul') do call :inspect_dirty "%%L"
if "%VP_HAS_UNSAFE_DIRTY%"=="1" goto :dirty_after_cleanup
if "%VP_HAS_SAFE_DIRTY%"=="1" goto :dirty_after_cleanup
call :info "Generated artifact cleanup completed."

:working_tree_safe
call :info "Working tree contains no unsafe local changes."
exit /b 0

:inspect_dirty
set "VP_DIRTY_ENTRY=%~1"
set "VP_DIRTY_STATUS=%VP_DIRTY_ENTRY:~0,2%"
set "VP_DIRTY_PATH=%VP_DIRTY_ENTRY:~3%"

call :is_internal_updater_file "%VP_DIRTY_STATUS%" "%VP_DIRTY_PATH%"
if not errorlevel 1 exit /b 0

call :is_safe_generated "%VP_DIRTY_STATUS%" "%VP_DIRTY_PATH%"
if errorlevel 1 goto :inspect_unsafe
set "VP_HAS_SAFE_DIRTY=1"
exit /b 0

:inspect_unsafe
set "VP_HAS_UNSAFE_DIRTY=1"
call :err "Unsafe local change: %VP_DIRTY_STATUS% %VP_DIRTY_PATH%"
exit /b 0

:is_internal_updater_file
set "VP_CHECK_STATUS=%~1"
set "VP_CHECK_PATH=%~2"

rem upgrade.log is safe only as an untracked updater-owned transient file.
if "%VP_CHECK_STATUS%"=="??" if /I "%VP_CHECK_PATH%"=="upgrade.log" exit /b 0

rem A self-updated upgrade.cmd is safe only when it is an ordinary unstaged
rem modification and its content exactly equals the current origin/devel blob.
if not "%VP_CHECK_STATUS%"==" M" exit /b 1
if /I not "%VP_CHECK_PATH%"=="upgrade.cmd" exit /b 1

set "VP_CURRENT_UPDATER_HASH="
set "VP_EXPECTED_UPDATER_HASH="
for /f "delims=" %%H in ('git hash-object upgrade.cmd 2^>nul') do set "VP_CURRENT_UPDATER_HASH=%%H"
for /f "delims=" %%H in ('git rev-parse origin/devel:upgrade.cmd 2^>nul') do set "VP_EXPECTED_UPDATER_HASH=%%H"
if not defined VP_CURRENT_UPDATER_HASH exit /b 1
if not defined VP_EXPECTED_UPDATER_HASH exit /b 1
if /I "%VP_CURRENT_UPDATER_HASH%"=="%VP_EXPECTED_UPDATER_HASH%" exit /b 0
exit /b 1

:is_safe_generated
set "VP_CHECK_STATUS=%~1"
set "VP_CHECK_PATH=%~2"

rem Only ordinary unstaged modifications are ever auto-restored.
if not "%VP_CHECK_STATUS%"==" M" exit /b 1
if /I "%VP_CHECK_PATH%"=="changelog.html" exit /b 0
if /I "%VP_CHECK_PATH:~0,5%"=="blog/" if /I "%VP_CHECK_PATH:~-5%"==".html" exit /b 0
if /I "%VP_CHECK_PATH:~0,4%"=="mac/" if /I "%VP_CHECK_PATH:~-10%"=="index.html" exit /b 0
exit /b 1

:restore_safe_dirty
set "VP_DIRTY_ENTRY=%~1"
set "VP_DIRTY_STATUS=%VP_DIRTY_ENTRY:~0,2%"
set "VP_DIRTY_PATH=%VP_DIRTY_ENTRY:~3%"
call :is_safe_generated "%VP_DIRTY_STATUS%" "%VP_DIRTY_PATH%"
if errorlevel 1 exit /b 0
call :warn "Restoring generated artifact: %VP_DIRTY_PATH%"
git restore -- "%VP_DIRTY_PATH%" >>"%VP_LOG%" 2>&1
if errorlevel 1 exit /b 1
exit /b 0

:dirty_unsafe
call :err "Local changes outside the safe generated-artifact whitelist were found."
call :warn "No local files were modified by the updater."
call :warn "Review upgrade.log and resolve the listed files before running upgrade.cmd again."
exit /b 1

:dirty_after_cleanup
call :err "Working tree still contains unexpected changes after safe generated-artifact cleanup."
call :warn "Upgrade stopped rather than risking local work."
exit /b 1

:error
if "%VP_DEV_WAS_RUNNING%"=="1" (
    call :warn "Upgrade failed. Restarting the previously running dev server..."
    start "VoicePrompter DEV" cmd /k "cd /d "%VP_REPO%" && npm run dev"
)
call :err "Upgrade FAILED. See upgrade.log for details."
exit /b 1

:info
call :emit 7 "[VoicePrompter] %~1"
exit /b

:warn
call :emit 14 "WARNING: %~1"
exit /b

:err
call :emit 12 "ERROR: %~1"
exit /b

:emit
set "VP_COLOR=%~1"
set "VP_TEXT=%~2"
>>"%VP_LOG%" echo %VP_TEXT%
powershell -NoProfile -Command "Write-Host $env:VP_TEXT -ForegroundColor ([ConsoleColor]%VP_COLOR%)"
exit /b
