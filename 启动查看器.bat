@echo off
setlocal
cd /d "%~dp0"
title 投影查看器 ^| Litematica Viewer

if /i "%~1"=="--build-only" goto build_only

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 没有找到 Node.js。
  echo   请先安装 Node.js 20+^: https://nodejs.org/zh-cn
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\three\package.json" (
  echo   [1/3] 首次运行^: 安装依赖，只需一次...
  where pnpm >nul 2>nul
  if errorlevel 1 (
    call npm install
  ) else (
    call pnpm install
  )
  if errorlevel 1 (
    echo   [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
) else (
  echo   [1/3] 依赖已就绪。
)

:build_only
echo   [2/3] 构建界面...
call node build.mjs
if errorlevel 1 (
  echo   [错误] 构建失败。
  pause
  exit /b 1
)
if /i "%~1"=="--build-only" exit /b 0

echo   [3/3] 启动本地服务并打开浏览器...
echo.
echo   如果没有自动打开浏览器，请手动访问^:  http://127.0.0.1:5178/
echo   关闭本窗口即退出查看器。
echo.
node server.mjs --port 5178 --open
echo.
echo   服务已停止。
pause
