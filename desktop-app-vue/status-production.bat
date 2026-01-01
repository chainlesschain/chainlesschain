@echo off
REM ChainlessChain 生产环境状态查看

echo ========================================
echo ChainlessChain 生产环境状态
echo ========================================
echo.

cd /d "%~dp0"

REM 查看运行状态
echo 正在查询运行状态...
echo.
node production-integration.js status

echo.
echo ----------------------------------------
echo 健康检查
echo ----------------------------------------
echo.
node production-integration.js health

echo.
echo ----------------------------------------
echo 日志文件
echo ----------------------------------------
echo.

if exist "logs\production-integration.log" (
    echo 最新日志（最后20行）:
    echo.
    powershell -Command "Get-Content -Path 'logs\production-integration.log' -Tail 20"
) else (
    echo 日志文件不存在
)

echo.
pause
