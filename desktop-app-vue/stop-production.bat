@echo off
REM ChainlessChain 生产环境停止脚本

echo ========================================
echo ChainlessChain 生产环境停止
echo ========================================
echo.

cd /d "%~dp0"

REM 停止集成服务
echo 正在停止生产环境集成服务...
echo.
node production-integration.js stop

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [成功] 所有服务已停止
) else (
    echo.
    echo [警告] 停止过程中可能出现错误
)

echo.
pause
