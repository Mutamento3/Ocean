@echo off
chcp 65001 >nul
title Ocean Gateway
cd /d "%~dp0"

if not exist "dist-server\index.js" (
  echo 正在准备 Ocean Gateway...
  call npm.cmd run build:server
  if errorlevel 1 goto :failed
)

echo Ocean Gateway 正在运行。
echo 请在本地测试期间保留这个窗口；按 Ctrl+C 可以停止。
echo.
node --env-file-if-exists=.env dist-server/index.js
goto :eof

:failed
echo Ocean Gateway 启动失败，请把这个窗口截图给 Codex。
pause
