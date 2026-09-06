@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ---------------------------------------------------------------------------
rem NORMAL ENTRY / SELF-UPDATE BOOTSTRAP
rem Always execute the newest origin/devel updater from TEMP. The repository
rem copy is never overwritten while it is running.
rem ---------------------------------------------------------------------------
if /I "%VP_UPGRADE_INTERNAL%"=="1" if /I "%VP_UPGRADE_STAGE%"=="fresh" goto :fresh_entry

cls
set "VP_BOOT_SOURCE=%~dp0"
if "%VP_BOOT_SOURCE:~-1%"=="\" set "VP_BOOT_SOURCE=%VP_BOOT_SOURCE:~0,-1%"
set "VP_FRESH_UPDATER=%TEMP%\VoicePrompter-upgrade-%RANDOM%-%RANDOM%.cmd"
set "VP_BOOT_PUSHED=0"
set "VP_BOOT_REPO="
set "VP_BOOT_LOG="
set "VP_BOOT_NEW_REPO=0"
set "VP_REPOSITORY_URL=https://github.com/Suenee/VoicePrompter.git"

where powershell.exe >nul 2>&1 || goto :bootstrap_powershell_error
pushd "%VP_BOOT_SOURCE%" >nul 2>&1 || goto :bootstrap_repo_error
set "VP_BOOT_PUSHED=1"
set "VP_BOOT_REPO=%CD%"
if not exist "%VP_BOOT_REPO%\logs" mkdir "%VP_BOOT_REPO%\logs" >nul 2>&1
set "VP_BOOT_LOG=%VP_BOOT_REPO%\logs\upgrade.log"

call :ensure_git_bootstrap
if errorlevel 1 goto :bootstrap_git_error

git -c safe.directory=* rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    call :bootstrap_new_repository
    if errorlevel 1 goto :bootstrap_repo_error
    set "VP_BOOT_NEW_REPO=1"
)

git -c safe.directory=* fetch origin devel >nul 2>&1 || goto :bootstrap_fetch_error
git -c safe.directory=* show origin/devel:upgrade.cmd >"%VP_FRESH_UPDATER%" 2>nul || goto :bootstrap_extract_error
if not exist "%VP_FRESH_UPDATER%" goto :bootstrap_extract_error
for %%I in ("%VP_FRESH_UPDATER%") do if %%~zI LSS 1000 goto :bootstrap_extract_error

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:VP_FRESH_UPDATER; $t=[IO.File]::ReadAllText($p); $t=$t -replace \"`r?`n\",\"`r`n\"; [IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))" >nul 2>&1 || goto :bootstrap_extract_error

set "VP_UPGRADE_INTERNAL=1"
set "VP_UPGRADE_STAGE=fresh"
set "VP_UPGRADE_REPO=%VP_BOOT_SOURCE%"
set "VP_UPGRADE_NEW_REPO=%VP_BOOT_NEW_REPO%"
if "%VP_BOOT_PUSHED%"=="1" popd
set "VP_BOOT_PUSHED=0"

"%ComSpec%" /d /s /c ""%VP_FRESH_UPDATER%""
set "VP_BOOT_RC=%ERRORLEVEL%"
del /q "%VP_FRESH_UPDATER%" >nul 2>&1
endlocal & exit /b %VP_BOOT_RC%

:bootstrap_new_repository
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$bad=@(Get-ChildItem -LiteralPath $env:VP_BOOT_REPO -Force | Where-Object { $_.Name -ine 'upgrade.cmd' -and $_.Name -ine 'logs' }); if($bad.Count -gt 0){ Write-Output ('Refusing fresh bootstrap because the folder contains: '+(($bad | ForEach-Object Name) -join ', ')); exit 2 }; exit 0" >>"%VP_BOOT_LOG%" 2>&1
if errorlevel 1 exit /b 1
git init >nul 2>&1 || exit /b 1
git remote remove origin >nul 2>&1
git remote add origin "%VP_REPOSITORY_URL%" >nul 2>&1 || exit /b 1
exit /b 0

:bootstrap_repo_error
set "VP_BOOT_ERROR=VoicePrompter repository could not be opened. For a fresh install, the folder must contain only upgrade.cmd (and optional logs)."
goto :bootstrap_fail
:bootstrap_git_error
set "VP_BOOT_ERROR=Git is required but could not be installed or found in PATH."
goto :bootstrap_fail
:bootstrap_powershell_error
set "VP_BOOT_ERROR=Windows PowerShell was not found."
goto :bootstrap_fail
:bootstrap_fetch_error
set "VP_BOOT_ERROR=git fetch origin devel failed during bootstrap."
goto :bootstrap_fail
:bootstrap_extract_error
set "VP_BOOT_ERROR=Could not prepare the current upgrade.cmd from origin/devel in TEMP."
if defined VP_FRESH_UPDATER del /q "%VP_FRESH_UPDATER%" >nul 2>&1
goto :bootstrap_fail
:bootstrap_fail
if defined VP_BOOT_LOG (
    >"%VP_BOOT_LOG%" echo [VoicePrompter] Upgrade bootstrap failed %date% %time%
    >>"%VP_BOOT_LOG%" echo ERROR: %VP_BOOT_ERROR%
)
powershell -NoProfile -Command "Write-Host 'ERROR: %VP_BOOT_ERROR%' -ForegroundColor Red" >nul 2>&1
if "%VP_BOOT_PUSHED%"=="1" popd
endlocal & exit /b 1

rem ---------------------------------------------------------------------------
rem FRESH TEMP RUN
rem ---------------------------------------------------------------------------
:fresh_entry
cls
set "VP_REPO_SOURCE=%VP_UPGRADE_REPO%"
if not defined VP_REPO_SOURCE exit /b 1
pushd "%VP_REPO_SOURCE%" >nul 2>&1 || exit /b 1
set "VP_REPO=%CD%"
set "VP_REPO_PUSHED=1"

if /I "%VP_UPGRADE_NEW_REPO%"=="1" (
    git -c safe.directory=* checkout -f -B devel origin/devel >nul 2>&1
    if errorlevel 1 (
        popd
        powershell -NoProfile -Command "Write-Host 'ERROR: Could not materialize VoicePrompter devel in the fresh folder.' -ForegroundColor Red"
        exit /b 1
    )
)

if not exist "%VP_REPO%\logs" mkdir "%VP_REPO%\logs" >nul 2>&1
if exist "%VP_REPO%\upgrade.log" move /Y "%VP_REPO%\upgrade.log" "%VP_REPO%\logs\upgrade-legacy.log" >nul 2>&1
set "VP_LOG=%VP_REPO%\logs\upgrade.log"
set "VP_LOCK_DIR=%TEMP%\voiceprompter-upgrade.lock"
set "VP_LOCK_PID="
set "VP_EXIT_CODE=1"
set "VP_DEV_WAS_RUNNING=0"
set "VP_DEV_STOPPED=0"
set "VP_DEV_STARTED=0"
set "VP_RESTART_REQUIRED=0"
set "VP_NPM_CI_REQUIRED=0"
set "VP_CHANGED_LIST=%TEMP%\voiceprompter-upgrade-changed-%RANDOM%-%RANDOM%.txt"
set "VP_DEV_FLAG=%TEMP%\voiceprompter-upgrade-dev-%RANDOM%-%RANDOM%.flag"

if defined LOCALAPPDATA (
    set "npm_config_cache=%LOCALAPPDATA%\VoicePrompter\npm-cache"
) else (
    set "npm_config_cache=%TEMP%\VoicePrompter\npm-cache"
)
if not exist "%npm_config_cache%" mkdir "%npm_config_cache%" >nul 2>&1

for /f "delims=" %%P in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)).ParentProcessId" 2^>nul') do set "VP_LOCK_PID=%%P"
call :acquire_lock
if errorlevel 1 (
    if "%VP_REPO_PUSHED%"=="1" popd
    exit /b 1
)

>"%VP_LOG%" echo [VoicePrompter] Upgrade started %date% %time%
call :info "Running current updater from a CRLF-normalized temporary copy."
call :info "Repository source: %VP_REPO_SOURCE%"
call :info "Active working path: %VP_REPO%"
call :info "Log: %VP_LOG%"

call :main
set "VP_EXIT_CODE=%ERRORLEVEL%"
call :release_lock
if exist "%VP_CHANGED_LIST%" del /q "%VP_CHANGED_LIST%" >nul 2>&1
if exist "%VP_DEV_FLAG%" del /q "%VP_DEV_FLAG%" >nul 2>&1
if "%VP_REPO_PUSHED%"=="1" popd
endlocal & exit /b %VP_EXIT_CODE%

:main
call :info "Checking required runtime components..."
call :ensure_git_runtime
if errorlevel 1 goto :error
call :ensure_node_runtime
if errorlevel 1 goto :error

for /f "delims=" %%V in ('git --version 2^>nul') do call :info "%%V"
for /f "delims=" %%V in ('node --version 2^>nul') do call :info "Node.js %%V"
for /f "delims=" %%V in ('npm --version 2^>nul') do call :info "npm %%V"

call :info "Cleaning known safe Vite temporary artifacts..."
call :cleanup_safe_transients
if errorlevel 1 goto :error

call :info "Checking local working tree..."
call :check_clean_tree
if errorlevel 1 goto :error

call :detect_dev_server
if errorlevel 1 goto :error

call :info "Switching to devel..."
git -c safe.directory=* checkout devel >>"%VP_LOG%" 2>&1 || goto :error
call :info "Fetching latest devel from origin..."
git -c safe.directory=* fetch origin devel >>"%VP_LOG%" 2>&1 || goto :error

call :classify_update
if errorlevel 1 goto :error

if "%VP_DEV_WAS_RUNNING%"=="1" if "%VP_RESTART_REQUIRED%"=="1" (
    call :info "Update touches runtime/configuration files; stopping the verified VoicePrompter dev server."
    call :stop_dev_server
    if errorlevel 1 goto :error
    set "VP_DEV_STOPPED=1"
) else if "%VP_DEV_WAS_RUNNING%"=="1" (
    call :info "Update is HMR-safe; leaving the running VoicePrompter dev server alive."
)

call :info "Synchronizing local devel with origin/devel..."
git -c safe.directory=* reset --hard origin/devel >>"%VP_LOG%" 2>&1 || goto :error
call :info "Repository upgrade.cmd is synchronized with origin/devel."

if not exist "node_modules" set "VP_NPM_CI_REQUIRED=1"
if "%VP_NPM_CI_REQUIRED%"=="1" (
    call :info "Installing dependencies from package-lock.json..."
    call npm ci --no-audit --no-fund >>"%VP_LOG%" 2>&1 || goto :error
) else (
    call :info "Dependencies unchanged; skipping npm ci."
)

call :info "Building VoicePrompter application..."
call npx tsc >>"%VP_LOG%" 2>&1 || goto :error
call npx vite build >>"%VP_LOG%" 2>&1 || goto :error

if "%VP_DEV_WAS_RUNNING%"=="1" if "%VP_DEV_STOPPED%"=="1" call :restart_dev_server
if errorlevel 1 goto :error

call :info "Upgrade completed successfully."
exit /b 0

:classify_update
set "VP_RESTART_REQUIRED=0"
set "VP_NPM_CI_REQUIRED=0"
>"%VP_CHANGED_LIST%" git -c safe.directory=* diff --name-only HEAD..origin/devel 2>>"%VP_LOG%"
if errorlevel 1 exit /b 1
for /f "usebackq delims=" %%F in ("%VP_CHANGED_LIST%") do call :classify_changed_file "%%F"
exit /b 0

:classify_changed_file
set "VP_CHANGED_FILE=%~1"
if /I "%VP_CHANGED_FILE%"=="package.json" set "VP_NPM_CI_REQUIRED=1"& set "VP_RESTART_REQUIRED=1"& exit /b 0
if /I "%VP_CHANGED_FILE%"=="package-lock.json" set "VP_NPM_CI_REQUIRED=1"& set "VP_RESTART_REQUIRED=1"& exit /b 0
if /I "%VP_CHANGED_FILE%"=="vite.config.ts" set "VP_RESTART_REQUIRED=1"& exit /b 0
if /I "%VP_CHANGED_FILE%"=="vite.config.js" set "VP_RESTART_REQUIRED=1"& exit /b 0
if /I "%VP_CHANGED_FILE%"=="vite.config.mjs" set "VP_RESTART_REQUIRED=1"& exit /b 0
if /I "%VP_CHANGED_FILE:~0,8%"=="tsconfig." set "VP_RESTART_REQUIRED=1"& exit /b 0
if /I "%VP_CHANGED_FILE:~0,5%"==".env." set "VP_RESTART_REQUIRED=1"& exit /b 0
if /I "%VP_CHANGED_FILE%"==".env" set "VP_RESTART_REQUIRED=1"& exit /b 0
exit /b 0

:detect_dev_server
del /q "%VP_DEV_FLAG%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$repo=[IO.Path]::GetFullPath($env:VP_REPO).TrimEnd('\').ToLowerInvariant(); $source=[IO.Path]::GetFullPath($env:VP_REPO_SOURCE).TrimEnd('\').ToLowerInvariant();" ^
  "$vite=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'node.exe' -and ([string]$_.CommandLine) -match '(?i)(^|[\\/])vite([\\/]|\.|\s|$)' -and ((([string]$_.CommandLine).ToLowerInvariant().Contains($repo)) -or (([string]$_.CommandLine).ToLowerInvariant().Contains($source))) });" ^
  "if($vite.Count -gt 0){ Set-Content -LiteralPath $env:VP_DEV_FLAG -Value '1' -NoNewline; foreach($p in $vite){ Write-Output ('[VoicePrompter] Verified dev server PID '+$p.ProcessId+' '+([string]$p.CommandLine)) } } else { Write-Output '[VoicePrompter] No verified VoicePrompter dev server was running.' }; exit 0" >>"%VP_LOG%" 2>&1
if errorlevel 1 exit /b 1
if exist "%VP_DEV_FLAG%" (
    set "VP_DEV_WAS_RUNNING=1"
    call :info "Verified VoicePrompter dev server is running."
) else (
    call :info "No verified VoicePrompter dev server was running."
)
call :info "Companion, VoicePrompter Bridge, and unrelated Node processes were not touched."
exit /b 0

:stop_dev_server
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $repo=[IO.Path]::GetFullPath($env:VP_REPO).TrimEnd('\').ToLowerInvariant(); $source=[IO.Path]::GetFullPath($env:VP_REPO_SOURCE).TrimEnd('\').ToLowerInvariant(); $all=@(Get-CimInstance Win32_Process);" ^
  "$roots=@($all | Where-Object { $_.Name -ieq 'node.exe' -and ([string]$_.CommandLine) -match '(?i)(^|[\\/])vite([\\/]|\.|\s|$)' -and ((([string]$_.CommandLine).ToLowerInvariant().Contains($repo)) -or (([string]$_.CommandLine).ToLowerInvariant().Contains($source))) });" ^
  "if($roots.Count -eq 0){ exit 0 }; $ids=New-Object 'System.Collections.Generic.HashSet[int]'; foreach($p in $roots){ [void]$ids.Add([int]$p.ProcessId) }; $changed=$true; while($changed){ $changed=$false; foreach($p in $all){ if($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)){ [void]$ids.Add([int]$p.ProcessId); $changed=$true } } };" ^
  "$targets=@($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | Sort-Object ProcessId -Descending); foreach($p in $targets){ try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output ('[VoicePrompter] Stopped PID '+$p.ProcessId+' '+$p.Name) } catch { if(Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue){ Write-Error ('Could not stop PID '+$p.ProcessId+': '+$_.Exception.Message); exit 2 } } }; exit 0" >>"%VP_LOG%" 2>&1
if errorlevel 1 (
    call :err "Could not safely stop the verified VoicePrompter dev server. Other Node applications were not touched."
    exit /b 1
)
exit /b 0

:restart_dev_server
if "%VP_DEV_STARTED%"=="1" exit /b 0
set "VP_DEV_STARTED=1"
call :info "Restarting the previously running dev server in a separate terminal..."
start "VoicePrompter DEV" cmd /k "pushd "%VP_REPO_SOURCE%" && set "npm_config_cache=%npm_config_cache%" && call run.cmd"
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}" >>"%VP_LOG%" 2>&1
if errorlevel 1 (
    call :warn "Dev server was restarted, but port 5173 is not listening yet. Check the VoicePrompter DEV window."
) else (
    call :info "Dev server is listening on port 5173."
)
exit /b 0

:check_clean_tree
set "VP_HAS_SAFE_DIRTY=0"
set "VP_HAS_UNSAFE_DIRTY=0"
for /f "delims=" %%L in ('git -c safe.directory^=* status --porcelain --untracked-files^=all 2^>nul') do call :inspect_dirty "%%L"
if "%VP_HAS_UNSAFE_DIRTY%"=="1" goto :dirty_unsafe
if not "%VP_HAS_SAFE_DIRTY%"=="1" goto :working_tree_safe

call :warn "Only known generated artifacts are modified. Restoring them safely..."
for /f "delims=" %%L in ('git -c safe.directory^=* status --porcelain --untracked-files^=all 2^>nul') do call :restore_safe_dirty "%%L"
set "VP_HAS_SAFE_DIRTY=0"
set "VP_HAS_UNSAFE_DIRTY=0"
for /f "delims=" %%L in ('git -c safe.directory^=* status --porcelain --untracked-files^=all 2^>nul') do call :inspect_dirty "%%L"
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
if "%VP_CHECK_STATUS%"=="??" if /I "%VP_CHECK_PATH:~0,5%"=="logs/" if /I "%VP_CHECK_PATH:~-4%"==".log" exit /b 0
if not "%VP_CHECK_STATUS%"==" M" exit /b 1
if /I "%VP_CHECK_PATH%"=="upgrade.cmd" goto :check_managed_cmd
if /I "%VP_CHECK_PATH%"=="run.cmd" goto :check_managed_cmd
exit /b 1

:check_managed_cmd
git -c safe.directory=* diff --ignore-space-at-eol --quiet -- "%VP_CHECK_PATH%" >nul 2>&1
if not errorlevel 1 exit /b 0
set "VP_CURRENT_MANAGED_HASH="
set "VP_REMOTE_MANAGED_HASH="
for /f "delims=" %%H in ('git -c safe.directory^=* hash-object "%VP_CHECK_PATH%" 2^>nul') do set "VP_CURRENT_MANAGED_HASH=%%H"
for /f "delims=" %%H in ('git -c safe.directory^=* rev-parse "origin/devel:%VP_CHECK_PATH%" 2^>nul') do set "VP_REMOTE_MANAGED_HASH=%%H"
if defined VP_CURRENT_MANAGED_HASH if defined VP_REMOTE_MANAGED_HASH if /I "%VP_CURRENT_MANAGED_HASH%"=="%VP_REMOTE_MANAGED_HASH%" exit /b 0
exit /b 1

:is_safe_generated
set "VP_CHECK_STATUS=%~1"
set "VP_CHECK_PATH=%~2"
if not "%VP_CHECK_STATUS%"==" M" exit /b 1
if /I "%VP_CHECK_PATH%"=="changelog.html" exit /b 0
if /I "%VP_CHECK_PATH%"=="public/sitemap.xml" exit /b 0
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
git -c safe.directory=* restore -- "%VP_DIRTY_PATH%" >>"%VP_LOG%" 2>&1
if errorlevel 1 exit /b 1
exit /b 0

:cleanup_safe_transients
for %%F in ("vite.config.ts.timestamp-*.mjs") do (
    if exist "%%~fF" (
        call :warn "Removing Vite temporary artifact: %%~nxF"
        del /q "%%~fF" >>"%VP_LOG%" 2>&1
        if errorlevel 1 exit /b 1
    )
)
exit /b 0

:dirty_unsafe
call :err "Local changes outside the safe generated-artifact whitelist were found."
call :warn "No local files were modified by the updater."
call :warn "Review %VP_LOG% and resolve the listed files before running upgrade.cmd again."
exit /b 1

:dirty_after_cleanup
call :err "Working tree still contains unexpected changes after safe generated-artifact cleanup."
call :warn "Upgrade stopped rather than risking local work."
exit /b 1

:acquire_lock
if not defined VP_LOCK_PID (
    powershell -NoProfile -Command "Write-Host 'ERROR: Could not determine updater process ID. Upgrade stopped.' -ForegroundColor Red"
    exit /b 1
)
mkdir "%VP_LOCK_DIR%" >nul 2>&1
if not errorlevel 1 (
    >"%VP_LOCK_DIR%\pid.txt" echo %VP_LOCK_PID%
    exit /b 0
)
set "VP_EXISTING_LOCK_PID="
if exist "%VP_LOCK_DIR%\pid.txt" set /p VP_EXISTING_LOCK_PID=<"%VP_LOCK_DIR%\pid.txt"
if defined VP_EXISTING_LOCK_PID (
    powershell -NoProfile -Command "if(Get-Process -Id %VP_EXISTING_LOCK_PID% -ErrorAction SilentlyContinue){exit 0}else{exit 1}" >nul 2>&1
    if not errorlevel 1 (
        powershell -NoProfile -Command "Write-Host 'ERROR: Another VoicePrompter upgrade is already running (PID %VP_EXISTING_LOCK_PID%).' -ForegroundColor Red"
        exit /b 1
    )
)
rmdir /s /q "%VP_LOCK_DIR%" >nul 2>&1
mkdir "%VP_LOCK_DIR%" >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Write-Host 'ERROR: Could not acquire VoicePrompter upgrade lock.' -ForegroundColor Red"
    exit /b 1
)
>"%VP_LOCK_DIR%\pid.txt" echo %VP_LOCK_PID%
exit /b 0

:release_lock
if exist "%VP_LOCK_DIR%" rmdir /s /q "%VP_LOCK_DIR%" >nul 2>&1
exit /b 0

:ensure_git_bootstrap
where git.exe >nul 2>&1
if not errorlevel 1 exit /b 0
echo [VoicePrompter] Git was not found. Attempting installation via winget...
where winget.exe >nul 2>&1
if errorlevel 1 exit /b 1
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --silent >nul 2>&1
if errorlevel 1 exit /b 1
call :refresh_path
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git.exe >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

:ensure_git_runtime
where git.exe >nul 2>&1
if not errorlevel 1 exit /b 0
call :warn "Git disappeared from PATH. Attempting repair..."
call :ensure_git_bootstrap
if errorlevel 1 (
    call :err "Git is required. Automatic installation via winget failed or winget is unavailable."
    exit /b 1
)
exit /b 0

:ensure_node_runtime
set "VP_NODE_VERSION="
set "VP_NODE_MAJOR="
where node.exe >nul 2>&1
if errorlevel 1 goto :node_install_required
for /f "delims=" %%V in ('node --version 2^>nul') do set "VP_NODE_VERSION=%%V"
if not defined VP_NODE_VERSION goto :node_install_required
set "VP_NODE_VERSION=%VP_NODE_VERSION:v=%"
for /f "tokens=1 delims=." %%V in ("%VP_NODE_VERSION%") do set "VP_NODE_MAJOR=%%V"
if not defined VP_NODE_MAJOR goto :node_install_required
set /a VP_NODE_MAJOR_NUM=%VP_NODE_MAJOR% >nul 2>&1
if errorlevel 1 goto :node_install_required
if %VP_NODE_MAJOR_NUM% LSS 20 goto :node_install_required
where npm.cmd >nul 2>&1
if errorlevel 1 goto :node_install_required
exit /b 0

:node_install_required
call :warn "Node.js 20+ with npm was not found. Attempting Node.js LTS installation via winget..."
where winget.exe >nul 2>&1
if errorlevel 1 goto :node_winget_missing
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --silent >>"%VP_LOG%" 2>&1
if errorlevel 1 goto :node_install_failed
call :refresh_path
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node.exe >nul 2>&1 || goto :node_installed_not_available
where npm.cmd >nul 2>&1 || goto :npm_missing_after_install
exit /b 0

:node_winget_missing
call :err "Node.js 20+ is required and winget is unavailable for automatic installation."
exit /b 1
:node_install_failed
call :err "Automatic Node.js LTS installation failed."
exit /b 1
:node_installed_not_available
call :err "Node.js was installed but is not available in this process. Run upgrade.cmd again."
exit /b 1
:npm_missing_after_install
call :err "npm was not found after Node.js installation."
exit /b 1

:refresh_path
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')" 2^>nul`) do set "PATH=%%P"
exit /b 0

:error
if "%VP_DEV_WAS_RUNNING%"=="1" if "%VP_DEV_STOPPED%"=="1" if "%VP_DEV_STARTED%"=="0" (
    call :warn "Upgrade failed. Restarting the previously running dev server..."
    call :restart_dev_server
)
call :err "Upgrade FAILED. See %VP_LOG% for details."
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
