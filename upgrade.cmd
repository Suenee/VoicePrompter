@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ---------------------------------------------------------------------------
rem NORMAL ENTRY / BOOTSTRAP
rem The repository copy never replaces itself while it is running.
rem A fresh upgrade.cmd from origin/devel is extracted to TEMP, normalized to
rem CRLF, and the real upgrade runs synchronously from that TEMP copy.
rem Bootstrap is safe for mapped drives and UNC paths, can install missing Git,
rem and can turn an otherwise empty folder containing upgrade.cmd into a full
rem VoicePrompter devel working tree.
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

rem pushd maps UNC paths to a temporary drive letter, unlike cd /d.
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

rem cmd.exe label lookup is not reliable with LF-only batch files. Git stores text
rem canonically with LF, so normalize the temporary executable copy explicitly.
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
rem Never initialize over an arbitrary populated directory. A fresh bootstrap
rem directory may contain only this updater and its logs directory.
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

rem pushd makes UNC repositories usable by cmd.exe, npm, Node, Vite and Git.
pushd "%VP_REPO_SOURCE%" >nul 2>&1 || exit /b 1
set "VP_REPO=%CD%"
set "VP_REPO_PUSHED=1"

rem On a brand-new PC the bootstrap has only initialized .git and fetched devel.
rem The updater itself is already running safely from TEMP, so it is now safe to
rem replace the downloaded bootstrap copy with the complete repository contents.
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
set "VP_DEV_WAS_RUNNING=0"
set "VP_DEV_STARTED=0"
set "VP_DEV_FLAG=%TEMP%\voiceprompter-upgrade-dev-%RANDOM%-%RANDOM%.flag"
set "VP_LOCK_DIR=%TEMP%\voiceprompter-upgrade.lock"
set "VP_LOCK_PID="
set "VP_EXIT_CODE=1"
set "VP_REMOTE_UPDATER="
set "VP_LOCAL_UPDATER="

rem Keep npm cache local even when the repository itself lives on a network disk.
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
call :info "npm cache: %npm_config_cache%"
if /I "%VP_UPGRADE_NEW_REPO%"=="1" call :info "Fresh repository bootstrap completed from origin/devel."

call :main
set "VP_EXIT_CODE=%ERRORLEVEL%"
call :release_lock
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

call :info "Checking for VoicePrompter-owned Node/esbuild processes..."
del /q "%VP_DEV_FLAG%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $repo=[IO.Path]::GetFullPath($env:VP_REPO).TrimEnd('\').ToLowerInvariant(); $source=[IO.Path]::GetFullPath($env:VP_REPO_SOURCE).TrimEnd('\').ToLowerInvariant(); $flag=$env:VP_DEV_FLAG;" ^
  "$all=@(Get-CimInstance Win32_Process);" ^
  "$owned=@($all | Where-Object { $n=$_.Name.ToLowerInvariant(); $cl=[string]$_.CommandLine; $ep=[string]$_.ExecutablePath; $cll=$cl.ToLowerInvariant(); $epl=$ep.ToLowerInvariant(); (($n -eq 'node.exe') -or ($n -eq 'esbuild.exe')) -and (($cll.Contains($repo)) -or ($cll.Contains($source)) -or ($epl.Contains($repo)) -or ($epl.Contains($source))) });" ^
  "$vite=@($owned | Where-Object { $_.Name -ieq 'node.exe' -and ([string]$_.CommandLine) -match '(?i)(^|[\\/])vite([\\/]|\.|\s|$)' });" ^
  "if($vite.Count -gt 0){ Set-Content -LiteralPath $flag -Value '1' -NoNewline };" ^
  "if($owned.Count -eq 0){ Write-Output '[VoicePrompter] No VoicePrompter-owned Node/esbuild processes detected.'; exit 0 };" ^
  "Write-Output '[VoicePrompter] VoicePrompter-owned processes selected for shutdown:'; foreach($p in $owned){ Write-Output ('  PID '+$p.ProcessId+' '+$p.Name+' '+([string]$p.CommandLine)) };" ^
  "$ids=New-Object 'System.Collections.Generic.HashSet[int]'; foreach($p in $owned){ [void]$ids.Add([int]$p.ProcessId) };" ^
  "$changed=$true; while($changed){ $changed=$false; foreach($p in $all){ if($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)){ [void]$ids.Add([int]$p.ProcessId); $changed=$true } } };" ^
  "$targets=@($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | Sort-Object ProcessId -Descending); foreach($p in $targets){ if(-not (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue)){ Write-Output ('[VoicePrompter] Process already exited PID '+$p.ProcessId+' '+$p.Name); continue }; try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output ('[VoicePrompter] Stopped PID '+$p.ProcessId+' '+$p.Name) } catch { if(-not (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue)){ Write-Output ('[VoicePrompter] Process already exited PID '+$p.ProcessId+' '+$p.Name); continue }; Write-Error ('Could not stop PID '+$p.ProcessId+' '+$p.Name+': '+$_.Exception.Message); exit 2 } };" ^
  "$deadline=(Get-Date).AddSeconds(5); do { Start-Sleep -Milliseconds 200; $left=@(Get-CimInstance Win32_Process | Where-Object { $ids.Contains([int]$_.ProcessId) }) } while($left.Count -gt 0 -and (Get-Date) -lt $deadline);" ^
  "if($left.Count -gt 0){ foreach($p in $left){ Write-Error ('Process still running: PID '+$p.ProcessId+' '+$p.Name) }; exit 3 }; exit 0" >>"%VP_LOG%" 2>&1
if errorlevel 1 (
    call :err "Could not safely stop VoicePrompter-owned processes. Other Node applications were not touched."
    goto :error
)
if exist "%VP_DEV_FLAG%" (
    set "VP_DEV_WAS_RUNNING=1"
    del /q "%VP_DEV_FLAG%" >nul 2>&1
    call :info "VoicePrompter dev server was running and its verified process tree was stopped."
) else (
    call :info "No verified VoicePrompter dev server was running."
)
call :info "Companion, VoicePrompter Bridge, and unrelated Node processes were not touched."

call :info "Cleaning known safe Vite temporary artifacts..."
call :cleanup_safe_transients
if errorlevel 1 goto :error

call :info "Checking local working tree..."
call :check_clean_tree
if errorlevel 1 goto :error

call :info "Switching to devel..."
git -c safe.directory=* checkout devel >>"%VP_LOG%" 2>&1 || goto :error

call :info "Fetching latest devel from origin..."
git -c safe.directory=* fetch origin devel >>"%VP_LOG%" 2>&1 || goto :error

call :info "Synchronizing local devel with origin/devel..."
git -c safe.directory=* reset --hard origin/devel >>"%VP_LOG%" 2>&1 || goto :error

for /f "delims=" %%H in ('git -c safe.directory^=* rev-parse origin/devel:upgrade.cmd 2^>nul') do set "VP_REMOTE_UPDATER=%%H"
for /f "delims=" %%H in ('git -c safe.directory^=* hash-object upgrade.cmd 2^>nul') do set "VP_LOCAL_UPDATER=%%H"
if not defined VP_REMOTE_UPDATER goto :updater_sync_error
if not defined VP_LOCAL_UPDATER goto :updater_sync_error
if /I not "%VP_LOCAL_UPDATER%"=="%VP_REMOTE_UPDATER%" goto :updater_sync_error
call :info "Repository upgrade.cmd is synchronized with origin/devel."

call :info "Verifying VoicePrompter esbuild executable is not locked..."
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p=Join-Path $env:VP_REPO 'node_modules\@esbuild\win32-x64\esbuild.exe'; if(-not (Test-Path -LiteralPath $p)){ exit 0 }; try { $s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $s.Close(); exit 0 } catch { Write-Error ('VoicePrompter esbuild.exe is still locked: '+$_.Exception.Message); $all=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'esbuild.exe' }); foreach($x in $all){ Write-Output ('  esbuild PID '+$x.ProcessId+' '+([string]$x.CommandLine)) }; exit 4 }" >>"%VP_LOG%" 2>&1
if errorlevel 1 (
    call :err "VoicePrompter esbuild.exe is still locked. No unrelated process was terminated; see logs\upgrade.log."
    goto :error
)

call :info "Installing dependencies from package-lock.json..."
call npm ci --no-audit --no-fund >>"%VP_LOG%" 2>&1 || goto :error

call :info "Building VoicePrompter application..."
call npx tsc >>"%VP_LOG%" 2>&1 || goto :error
call npx vite build >>"%VP_LOG%" 2>&1 || goto :error

if "%VP_DEV_WAS_RUNNING%"=="1" if "%VP_DEV_STARTED%"=="0" (
    set "VP_DEV_STARTED=1"
    call :info "Starting dev server in a separate terminal..."
    start "VoicePrompter DEV" cmd /k "pushd "%VP_REPO_SOURCE%" && set "npm_config_cache=%npm_config_cache%" && npm run dev"
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

:updater_sync_error
call :err "Repository upgrade.cmd does not match origin/devel after synchronization."
goto :error

:check_clean_tree
set "VP_HAS_SAFE_DIRTY=0"
set "VP_HAS_UNSAFE_DIRTY=0"
for /f "delims=" %%L in ('git -c safe.directory^=* status --porcelain --untracked-files^=all 2^>nul') do call :inspect_dirty "%%L"
if "%VP_HAS_UNSAFE_DIRTY%"=="1" goto :dirty_unsafe
if not "%VP_HAS_SAFE_DIRTY%"=="1" goto :working_tree_safe

call :warn "Only known generated web artifacts are modified. Restoring them safely..."
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
if /I not "%VP_CHECK_PATH%"=="upgrade.cmd" exit /b 1
set "VP_CURRENT_UPDATER_HASH="
set "VP_EXPECTED_UPDATER_HASH="
for /f "delims=" %%H in ('git -c safe.directory^=* hash-object upgrade.cmd 2^>nul') do set "VP_CURRENT_UPDATER_HASH=%%H"
for /f "delims=" %%H in ('git -c safe.directory^=* rev-parse origin/devel:upgrade.cmd 2^>nul') do set "VP_EXPECTED_UPDATER_HASH=%%H"
if not defined VP_CURRENT_UPDATER_HASH exit /b 1
if not defined VP_EXPECTED_UPDATER_HASH exit /b 1
if /I "%VP_CURRENT_UPDATER_HASH%"=="%VP_EXPECTED_UPDATER_HASH%" exit /b 0
exit /b 1

:is_safe_generated
set "VP_CHECK_STATUS=%~1"
set "VP_CHECK_PATH=%~2"
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
call :warn "Review logs\upgrade.log and resolve the listed files before running upgrade.cmd again."
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

rem ---------------------------------------------------------------------------
rem FRESH-PC TOOL BOOTSTRAP
rem ---------------------------------------------------------------------------
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
call :info "Git is available."
exit /b 0

:ensure_node_runtime
set "VP_NODE_OK=0"
set "VP_NODE_MAJOR="
where node.exe >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%V in ('node -p "parseInt(process.versions.node.split('.')[0],10)" 2^>nul') do set "VP_NODE_MAJOR=%%V"
    if defined VP_NODE_MAJOR if !VP_NODE_MAJOR! GEQ 20 (
        where npm.cmd >nul 2>&1
        if not errorlevel 1 set "VP_NODE_OK=1"
    )
)
if "%VP_NODE_OK%"=="1" exit /b 0

call :warn "Node.js 20+ with npm was not found. Attempting Node.js LTS installation via winget..."
where winget.exe >nul 2>&1
if errorlevel 1 (
    call :err "Node.js 20+ is required and winget is unavailable for automatic installation."
    exit /b 1
)

winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --silent >>"%VP_LOG%" 2>&1
if errorlevel 1 (
    call :err "Automatic Node.js LTS installation failed."
    exit /b 1
)

call :refresh_path
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"

set "VP_NODE_MAJOR="
for /f "delims=" %%V in ('node -p "parseInt(process.versions.node.split('.')[0],10)" 2^>nul') do set "VP_NODE_MAJOR=%%V"
if not defined VP_NODE_MAJOR (
    call :err "Node.js was installed but is not available in this process. Run upgrade.cmd again."
    exit /b 1
)
if !VP_NODE_MAJOR! LSS 20 (
    call :err "Installed Node.js is older than version 20."
    exit /b 1
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    call :err "npm was not found after Node.js installation."
    exit /b 1
)
call :info "Node.js LTS and npm are available."
exit /b 0

:refresh_path
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')" 2^>nul`) do set "PATH=%%P"
exit /b 0

:error
if exist "%VP_DEV_FLAG%" del /q "%VP_DEV_FLAG%" >nul 2>&1
if "%VP_DEV_WAS_RUNNING%"=="1" if "%VP_DEV_STARTED%"=="0" (
    set "VP_DEV_STARTED=1"
    call :warn "Upgrade failed. Restarting the previously running dev server..."
    start "VoicePrompter DEV" cmd /k "pushd "%VP_REPO_SOURCE%" && set "npm_config_cache=%npm_config_cache%" && npm run dev"
)
call :err "Upgrade FAILED. See logs\upgrade.log for details."
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