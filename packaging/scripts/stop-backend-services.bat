@echo off
REM ============================================
REM ChainlessChain Backend Services Stopper
REM ============================================
setlocal EnableDelayedExpansion

set GREEN=[92m
set RED=[91m
set RESET=[0m

echo %GREEN%========================================%RESET%
echo %GREEN%  Stopping Backend Services%RESET%
echo %GREEN%========================================%RESET%
echo.

REM 获取脚本目录
set SCRIPT_DIR=%~dp0
set APP_DIR=%SCRIPT_DIR%..\..\
set DATA_DIR=%APP_DIR%data\

REM 检查是否在打包环境中运行
if exist "%APP_DIR%resources\backend" (
    set DATA_DIR=%APP_DIR%data\
)

REM 创建日志
if not exist "%DATA_DIR%logs" mkdir "%DATA_DIR%logs"
set LOG_DIR=%DATA_DIR%logs\
set SHUTDOWN_LOG=%LOG_DIR%shutdown.log

echo [%date% %time%] Stopping ChainlessChain backend services... > "%SHUTDOWN_LOG%"

REM ============================================
REM 1. 停止 Java Project Service
REM ============================================
echo [1/4] Stopping Project Service...
tasklist /FI "WINDOWTITLE eq ChainlessChain-ProjectService*" 2>NUL | find /I /N "java.exe">NUL
if "%ERRORLEVEL%"=="0" (
    for /f "tokens=2" %%a in ('tasklist /FI "WINDOWTITLE eq ChainlessChain-ProjectService*" /FO LIST ^| find "PID:"') do (
        taskkill /PID %%a /F >NUL 2>&1
    )
    echo       %GREEN%Project Service stopped%RESET%
    echo [%date% %time%] Project Service stopped >> "%SHUTDOWN_LOG%"
) else (
    echo       Project Service was not running
)

REM ============================================
REM 2. 停止 Qdrant
REM ============================================
echo [2/4] Stopping Qdrant...
tasklist /FI "IMAGENAME eq qdrant.exe" 2>NUL | find /I /N "qdrant.exe">NUL
if "%ERRORLEVEL%"=="0" (
    taskkill /IM qdrant.exe /F >NUL 2>&1
    echo       %GREEN%Qdrant stopped%RESET%
    echo [%date% %time%] Qdrant stopped >> "%SHUTDOWN_LOG%"
) else (
    echo       Qdrant was not running
)

REM ============================================
REM 3. 停止 Redis
REM ============================================
echo [3/4] Stopping Redis...
tasklist /FI "IMAGENAME eq redis-server.exe" 2>NUL | find /I /N "redis-server.exe">NUL
if "%ERRORLEVEL%"=="0" (
    taskkill /IM redis-server.exe /F >NUL 2>&1
    echo       %GREEN%Redis stopped%RESET%
    echo [%date% %time%] Redis stopped >> "%SHUTDOWN_LOG%"
) else (
    echo       Redis was not running
)

REM ============================================
REM 4. 停止 PostgreSQL
REM ============================================
echo [4/4] Stopping PostgreSQL...
tasklist /FI "IMAGENAME eq postgres.exe" 2>NUL | find /I /N "postgres.exe">NUL
if "%ERRORLEVEL%"=="0" (
    REM 尝试优雅关闭
    if exist "%APP_DIR%backend\postgres\bin\pg_ctl.exe" (
        "%APP_DIR%backend\postgres\bin\pg_ctl.exe" -D "%DATA_DIR%postgres" stop -m fast >NUL 2>&1
    )
    if exist "%APP_DIR%resources\backend\postgres\bin\pg_ctl.exe" (
        "%APP_DIR%resources\backend\postgres\bin\pg_ctl.exe" -D "%DATA_DIR%postgres" stop -m fast >NUL 2>&1
    )
    timeout /t 3 /nobreak >NUL

    REM 如果还在运行，强制关闭
    tasklist /FI "IMAGENAME eq postgres.exe" 2>NUL | find /I /N "postgres.exe">NUL
    if "%ERRORLEVEL%"=="0" (
        taskkill /IM postgres.exe /F /T >NUL 2>&1
    )
    echo       %GREEN%PostgreSQL stopped%RESET%
    echo [%date% %time%] PostgreSQL stopped >> "%SHUTDOWN_LOG%"
) else (
    echo       PostgreSQL was not running
)

echo.
echo %GREEN%========================================%RESET%
echo %GREEN%  All services stopped successfully%RESET%
echo %GREEN%========================================%RESET%
echo.

echo [%date% %time%] Shutdown completed >> "%SHUTDOWN_LOG%"

endlocal
exit /b 0
