@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ---------------------------------------------------------------------------
rem NORMAL ENTRY / BOOTSTRAP
rem The repository copy never replaces itself while it is running.
rem A fresh upgrade.cmd from origin/devel is extracted to TEMP, normalized to
rem CRLF, and the real upgrade runs synchronously from that TEMP copy.
rem ---------------------------------------------------------------------------
if /I "%VP_UPGRADE_INTERNAL%"=="1" if /I "%VP_UPGRADE_STAGE%"=="fresh" goto :fresh_entry

cls
set "VP_BOOT_REPO=%~dp0"
if "%VP_BOOT_REPO:~-1%"=="\" set "VP_BOOT_REPO=%VP_BOOT_REPO:~0,-1%"
set "VP_BOOT_LOG=%VP_BOOT_REPO%\upgrade.log"
set "VP_FRESH_UPDATER=%TEMP%\VoicePrompter-upgrade-%RANDOM%-%RANDOM%.cmd"

cd /d "%VP_BOOT_REPO%" || goto :bootstrap_repo_error
where git.exe >nul 2>&1 || goto :bootstrap_git_error
git rev-parse --is-inside-work-tree >nul 2>&1 || goto :bootstrap_repo_error
git fetch origin devel >nul 2>&1 || goto :bootstrap_fetch_error

git show origin/devel:upgrade.cmd >"%VP_FRESH_UPDATER%" 2>nul || goto :bootstrap_extract_error
if not exist "%VP_FRESH_UPDATER%" goto :bootstrap_extract_error
for %%I in ("%VP_FRESH_UPDATER%") do if %%~zI LSS 1000 goto :bootstrap_extract_error

rem cmd.exe label lookup is not reliable with LF-only batch files. Git stores text
rem canonically with LF, so normalize the temporary executable copy explicitly.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:VP_FRESH_UPDATER; $t=[IO.File]::ReadAllText($p); $t=[Text.RegularExpressions.Regex]::Replace($t,'\r?\n','`r`n'); [IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))" >nul 2>&1 || goto :bootstrap_extract_error

set "VP_UPGRADE_INTERNAL=1"
set "VP_UPGRADE_STAGE=fresh"
set "VP_UPGRADE_REPO=%VP_BOOT_REPO%"

"%ComSpec%" /d /s /c ""%VP_FRESH_UPDATER%""
set "VP_BOOT_RC=%ERRORLEVEL%"
del /q "%VP_FRESH_UPDATER%" >nul 2>&1
endlocal & exit /b %VP_BOOT_RC%

:bootstrap_repo_error
set "VP_BOOT_ERROR=VoicePrompter repository could not be opened or is not a Git working tree."
goto :bootstrap_fail

:bootstrap_git_error
set "VP_BOOT_ERROR=Git was not found in PATH."
goto :bootstrap_fail

:bootstrap_fetch_error
set "VP_BOOT_ERROR=git fetch origin devel failed during bootstrap."
goto :bootstrap_fail

:bootstrap_extract_error
set "VP_BOOT_ERROR=Could not prepare the current upgrade.cmd from origin/devel in TEMP."
if defined VP_FRESH_UPDATER del /q "%VP_FRESH_UPDATER%" >nul 2>&1
goto :bootstrap_fail

:bootstrap_fail
>"%VP_BOOT_LOG%" echo [VoicePrompter] Upgrade bootstrap failed %date% %time%
>>"%VP_BOOT_LOG%" echo ERROR: %VP_BOOT_ERROR%
powershell -NoProfile -Command "Write-Host 'ERROR: %VP_BOOT_ERROR%' -ForegroundColor Red"
endlocal & exit /b 1

rem ---------------------------------------------------------------------------
rem FRESH TEMP RUN
rem ---------------------------------------------------------------------------
:fresh_entry
cls
set "VP_REPO=%VP_UPGRADE_REPO%"
if not defined VP_REPO exit /b 1
cd /d "%VP_REPO%" || exit /b 1

set "VP_LOG=%VP_REPO%\upgrade.log"
set "VP_DEV_WAS_RUNNING=0"
set "VP_DEV_STARTED=0"
set "VP_DEV_FLAG=%TEMP%\voiceprompter-upgrade-dev-%RANDOM%-%RANDOM%.flag"
set "VP_LOCK_DIR=%TEMP%\voiceprompter-upgrade.lock"
set "VP_LOCK_PID="
set "VP_EXIT_CODE=1"
set "VP_REMOTE_UPDATER="
set "VP_LOCAL_UPDATER="

for /f "delims=" %%P in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)).ParentProcessId" 2^>nul') do set "VP_LOCK_PID=%%P"
call :acquire_lock
if errorlevel 1 exit /b 1

>"%VP_LOG%" echo [VoicePrompter] Upgrade started %date% %time%
call :info "Running current updater from a CRLF-normalized temporary copy."

call :main
set "VP_EXIT_CODE=%ERRORLEVEL%"
call :release_lock
endlocal & exit /b %VP_EXIT_CODE%

:main
call :info "Checking for VoicePrompter-owned Node/esbuild processes..."
del /q "%VP_DEV_FLAG%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $repo=[IO.Path]::GetFullPath($env:VP_REPO).TrimEnd('\').ToLowerInvariant(); $flag=$env:VP_DEV_FLAG;" ^
  "$all=@(Get-CimInstance Win32_Process);" ^
  "$owned=@($all | Where-Object { $n=$_.Name.ToLowerInvariant(); $cl=[string]$_.CommandLine; $ep=[string]$_.ExecutablePath; (($n -eq 'node.exe') -or ($n -eq 'esbuild.exe')) -and (($cl.ToLowerInvariant().Contains($repo)) -or ($ep.ToLowerInvariant().Contains($repo))) });" ^
  "$vite=@($owned | Where-Object { $_.Name -ieq 'node.exe' -and ([string]$_.CommandLine) -match '(?i)(^|[\\/])vite([\\/]|\.|\s|$)' });" ^
  "if($vite.Count -gt 0){ Set-Content -LiteralPath $flag -Value '1' -NoNewline };" ^
  "if($owned.Count -eq 0){ Write-Output '[VoicePrompter] No VoicePrompter-owned Node/esbuild processes detected.'; exit 0 };" ^
  "Write-Output '[VoicePrompter] VoicePrompter-owned processes selected for shutdown:'; foreach($p in $owned){ Write-Output ('  PID '+$p.ProcessId+' '+$p.Name+' '+([string]$p.CommandLine)) };" ^
  "$ids=New-Object 'System.Collections.Generic.HashSet[int]'; foreach($p in $owned){ [void]$ids.Add([int]$p.ProcessId) };" ^
  "$changed=$true; while($changed){ $changed=$false; foreach($p in $all){ if($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)){ [void]$ids.Add([int]$p.ProcessId); $changed=$true } } };" ^
  "$targets=@($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | Sort-Object ProcessId -Descending); foreach($p in $targets){ try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output ('[VoicePrompter] Stopped PID '+$p.ProcessId+' '+$p.Name) } catch { Write-Error ('Could not stop PID '+$p.ProcessId+' '+$p.Name+': '+$_.Exception.Message); exit 2 } };" ^
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
git checkout devel >>"%VP_LOG%" 2>&1 || goto :error

call :info "Fetching latest devel from origin..."
git fetch origin devel >>"%VP_LOG%" 2>&1 || goto :error

call :info "Synchronizing local devel with origin/devel..."
git reset --hard origin/devel >>"%VP_LOG%" 2>&1 || goto :error

for /f "delims=" %%H in ('git rev-parse origin/devel:upgrade.cmd 2^>nul') do set "VP_REMOTE_UPDATER=%%H"
for /f "delims=" %%H in ('git hash-object upgrade.cmd 2^>nul') do set "VP_LOCAL_UPDATER=%%H"
if not defined VP_REMOTE_UPDATER goto :updater_sync_error
if not defined VP_LOCAL_UPDATER goto :updater_sync_error
if /I not "%VP_LOCAL_UPDATER%"=="%VP_REMOTE_UPDATER%" goto :updater_sync_error
call :info "Repository upgrade.cmd is synchronized with origin/devel."

call :info "Verifying VoicePrompter esbuild executable is not locked..."
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p=Join-Path $env:VP_REPO 'node_modules\@esbuild\win32-x64\esbuild.exe'; if(-not (Test-Path -LiteralPath $p)){ exit 0 }; try { $s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $s.Close(); exit 0 } catch { Write-Error ('VoicePrompter esbuild.exe is still locked: '+$_.Exception.Message); $all=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'esbuild.exe' }); foreach($x in $all){ Write-Output ('  esbuild PID '+$x.ProcessId+' '+([string]$x.CommandLine)) }; exit 4 }" >>"%VP_LOG%" 2>&1
if errorlevel 1 (
    call :err "VoicePrompter esbuild.exe is still locked. No unrelated process was terminated; see upgrade.log."
    goto :error
)

call :info "Installing dependencies from package-lock.json..."
call npm ci >>"%VP_LOG%" 2>&1 || goto :error

call :info "Building VoicePrompter application..."
call npx tsc >>"%VP_LOG%" 2>&1 || goto :error
call npx vite build >>"%VP_LOG%" 2>&1 || goto :error

if "%VP_DEV_WAS_RUNNING%"=="1" if "%VP_DEV_STARTED%"=="0" (
    set "VP_DEV_STARTED=1"
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

:updater_sync_error
call :err "Repository upgrade.cmd does not match origin/devel after synchronization."
goto :error

:check_clean_tree
set "VP_HAS_SAFE_DIRTY=0"
set "VP_HAS_UNSAFE_DIRTY=0"
for /f "delims=" %%L in ('git status --porcelain --untracked-files^=all 2^>nul') do call :inspect_dirty "%%L"
if "%VP_HAS_UNSAFE_DIRTY%"=="1" goto :dirty_unsafe
if not "%VP_HAS_SAFE_DIRTY%"=="1" goto :working_tree_safe

call :warn "Only known generated web artifacts are modified. Restoring them safely..."
for /f "delims=" %%L in ('git status --porcelain --untracked-files^=all 2^>nul') do call :restore_safe_dirty "%%L"
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
if "%VP_CHECK_STATUS%"=="??" if /I "%VP_CHECK_PATH%"=="upgrade.log" exit /b 0
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
call :warn "Review upgrade.log and resolve the listed files before running upgrade.cmd again."
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

:error
if exist "%VP_DEV_FLAG%" del /q "%VP_DEV_FLAG%" >nul 2>&1
if "%VP_DEV_WAS_RUNNING%"=="1" if "%VP_DEV_STARTED%"=="0" (
    set "VP_DEV_STARTED=1"
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
