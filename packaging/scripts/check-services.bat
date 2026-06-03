@echo off
REM ============================================
REM ChainlessChain Services Health Check
REM ============================================
setlocal EnableDelayedExpansion

set GREEN=[92m
set RED=[91m
set YELLOW=[93m
set RESET=[0m

echo %GREEN%========================================%RESET%
echo %GREEN%  ChainlessChain Services Status%RESET%
echo %GREEN%========================================%RESET%
echo.

REM ============================================
REM 检查 PostgreSQL
REM ============================================
echo [PostgreSQL]
tasklist /FI "IMAGENAME eq postgres.exe" 2>NUL | find /I /N "postgres.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo   Status: %GREEN%RUNNING%RESET%
    echo   Port: 5432
) else (
    echo   Status: %RED%STOPPED%RESET%
)
echo.

REM ============================================
REM 检查 Redis
REM ============================================
echo [Redis]
tasklist /FI "IMAGENAME eq redis-server.exe" 2>NUL | find /I /N "redis-server.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo   Status: %GREEN%RUNNING%RESET%
    echo   Port: 6379
) else (
    echo   Status: %RED%STOPPED%RESET%
)
echo.

REM ============================================
REM 检查 Qdrant
REM ============================================
echo [Qdrant Vector Database]
tasklist /FI "IMAGENAME eq qdrant.exe" 2>NUL | find /I /N "qdrant.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo   Status: %GREEN%RUNNING%RESET%
    echo   Port: 6333 (HTTP), 6334 (gRPC)
) else (
    echo   Status: %RED%STOPPED%RESET%
)
echo.

REM ============================================
REM 检查 Project Service
REM ============================================
echo [Project Service (Java)]
tasklist /FI "WINDOWTITLE eq ChainlessChain-ProjectService*" 2>NUL | find /I /N "java.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo   Status: %GREEN%RUNNING%RESET%
    echo   Port: 9090
) else (
    echo   Status: %RED%STOPPED%RESET%
)
echo.

REM ============================================
REM 检查端口占用
REM ============================================
echo %YELLOW%========================================%RESET%
echo %YELLOW%  Port Usage%RESET%
echo %YELLOW%========================================%RESET%
netstat -ano | findstr ":5432 :6379 :6333 :9090" 2>NUL
if "%ERRORLEVEL%"=="1" (
    echo   No ports in use
)
echo.

echo %GREEN%========================================%RESET%
echo Press any key to exit...
pause >NUL

endlocal
exit /b 0
