@echo off
REM ChainlessChain 生产环境启动脚本

echo ========================================
echo ChainlessChain 生产环境启动
echo ========================================
echo.

cd /d "%~dp0"

REM 检查Node.js是否安装
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未找到 Node.js
    echo 请先安装 Node.js: https://nodejs.org/
    pause
    exit /b 1
)

REM 显示Node版本
echo Node.js 版本:
node --version
echo.

REM 检查数据库文件
if not exist "..\data\chainlesschain.db" (
    echo [警告] 数据库文件不存在
    echo 路径: ..\data\chainlesschain.db
    echo 请确保应用已初始化
    pause
)

REM 创建日志目录
if not exist "logs" mkdir logs

REM 启动集成服务
echo 正在启动生产环境集成服务...
echo.
node production-integration.js start

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [错误] 启动失败
    pause
    exit /b 1
)

pause
