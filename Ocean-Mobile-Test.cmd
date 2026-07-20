@echo off
setlocal
title Ocean Mobile Test
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo Building Ocean client...
  call npm.cmd run build:client
  if errorlevel 1 goto :failed
)

if not exist "dist-server\index.js" (
  echo Building Ocean Gateway...
  call npm.cmd run build:server
  if errorlevel 1 goto :failed
)

set "LAN_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
  for /f "tokens=*" %%B in ("%%A") do set "LAN_IP=%%B"
)

start "Ocean Gateway" cmd /k "set OCEAN_GATEWAY_HOST=0.0.0.0&& node --env-file-if-exists=.env dist-server/index.js"
start "Ocean Mobile Preview" cmd /k "npm.cmd run preview -- --host 0.0.0.0 --port 4173"

echo.
echo Ocean is starting for phone testing.
echo Keep the two new windows open while testing.
echo.
if defined LAN_IP (
  echo On your phone, open:
  echo http://%LAN_IP%:4173/?fidelity=86
) else (
  echo Could not detect the Wi-Fi address. Send a screenshot of this window to Codex.
)
echo.
echo If Windows asks about firewall access, allow Private networks only.
pause
goto :eof

:failed
echo Ocean could not be prepared. Send a screenshot of this window to Codex.
pause
