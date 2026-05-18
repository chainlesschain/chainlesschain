@echo off
chcp 65001 >nul
echo ========================================
echo ChainlessChain 服务停止脚本
echo ========================================
echo.

echo [1/2] 停止Docker服务...
cd /d "%~dp0config\docker"
docker-compose down
if %errorlevel% neq 0 (
    echo ❌ 停止服务失败
    pause
    exit /b 1
)
echo ✅ Docker服务已停止

echo.
echo [2/2] 检查服务状态...
docker ps --filter "name=chainlesschain"

echo.
echo ========================================
echo ✅ 所有服务已停止
echo ========================================
echo.
pause
