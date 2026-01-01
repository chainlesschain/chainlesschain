@echo off
REM ChainlessChain 控制面板启动脚本

echo ========================================
echo ChainlessChain 控制面板
echo ========================================
echo.

cd /d "%~dp0"

REM 检查Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未找到 Node.js
    pause
    exit /b 1
)

REM 启动API服务
echo 正在启动控制面板 API 服务...
echo.
start "Control Panel API" node control-panel-api.js 3001

REM 等待服务启动
timeout /t 2 >nul

REM 打开浏览器
echo 正在打开控制面板...
start http://localhost:3001

echo.
echo ========================================
echo 控制面板已启动
echo 访问地址: http://localhost:3001
echo 按任意键停止服务...
echo ========================================
pause >nul

REM 停止API服务
taskkill /FI "WINDOWTITLE eq Control Panel API*" /F >nul 2>nul

echo.
echo 控制面板已关闭
pause
