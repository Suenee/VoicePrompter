@echo off
cd /d "%~dp0"

set "CHOKIDAR_USEPOLLING=1"
set "CHOKIDAR_INTERVAL=250"

set "VP_LAN_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip = Get-NetIPConfiguration ^| Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address.IPAddress -notlike '169.254.*' } ^| ForEach-Object { $_.IPv4Address.IPAddress } ^| Select-Object -First 1; if ($ip) { $ip }"`) do set "VP_LAN_IP=%%I"

echo.
echo VoicePrompter local: http://localhost:5173/app/index.html
if defined VP_LAN_IP (
    echo VoicePrompter LAN:   http://%VP_LAN_IP%:5173/app/index.html
) else (
    echo VoicePrompter LAN:   IP address could not be detected automatically.
)
echo.

call npm run dev -- --host 0.0.0.0
