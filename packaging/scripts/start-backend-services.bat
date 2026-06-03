@echo off
REM ============================================
REM ChainlessChain Backend Services Starter
REM ============================================
setlocal EnableDelayedExpansion

REM 设置颜色（绿色=成功，红色=错误）
set GREEN=[92m
set RED=[91m
set RESET=[0m

echo %GREEN%========================================%RESET%
echo %GREEN%  ChainlessChain Backend Services%RESET%
echo %GREEN%========================================%RESET%
echo.

REM 获取脚本目录
set SCRIPT_DIR=%~dp0
set APP_DIR=%SCRIPT_DIR%..\..\
set BACKEND_DIR=%APP_DIR%backend\
set DATA_DIR=%APP_DIR%data\
set CONFIG_DIR=%APP_DIR%config\

REM 检查是否在打包环境中运行
if exist "%APP_DIR%resources\backend" (
    set BACKEND_DIR=%APP_DIR%resources\backend\
    set DATA_DIR=%APP_DIR%data\
    set CONFIG_DIR=%APP_DIR%resources\config\
)

REM 创建数据目录
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%postgres" mkdir "%DATA_DIR%postgres"
if not exist "%DATA_DIR%redis" mkdir "%DATA_DIR%redis"
if not exist "%DATA_DIR%qdrant" mkdir "%DATA_DIR%qdrant"

REM 创建日志目录
if not exist "%DATA_DIR%logs" mkdir "%DATA_DIR%logs"
set LOG_DIR=%DATA_DIR%logs\
set STARTUP_LOG=%LOG_DIR%startup.log

echo [%date% %time%] Starting ChainlessChain backend services... > "%STARTUP_LOG%"

REM ============================================
REM 1. 检查并启动 PostgreSQL
REM ============================================
echo [1/4] %GREEN%Checking PostgreSQL...%RESET%
tasklist /FI "IMAGENAME eq postgres.exe" 2>NUL | find /I /N "postgres.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo       PostgreSQL is already running
    echo [%date% %time%] PostgreSQL is already running >> "%STARTUP_LOG%"
) else (
    echo       Starting PostgreSQL...

    REM 检查 PostgreSQL 是否已初始化
    if not exist "%DATA_DIR%postgres\PG_VERSION" (
        echo       Initializing PostgreSQL database...
        if exist "%BACKEND_DIR%postgres\bin\initdb.exe" (
            "%BACKEND_DIR%postgres\bin\initdb.exe" -D "%DATA_DIR%postgres" -U chainlesschain -E UTF8 --locale=C 2>> "%STARTUP_LOG%"
            echo       PostgreSQL initialized successfully
        ) else (
            echo       %RED%ERROR: PostgreSQL binaries not found%RESET%
            echo [%date% %time%] ERROR: PostgreSQL binaries not found >> "%STARTUP_LOG%"
        )
    )

    REM 启动 PostgreSQL
    if exist "%BACKEND_DIR%postgres\bin\pg_ctl.exe" (
        start /B "" "%BACKEND_DIR%postgres\bin\pg_ctl.exe" -D "%DATA_DIR%postgres" -l "%LOG_DIR%postgres.log" start
        timeout /t 5 /nobreak >NUL
        echo       %GREEN%PostgreSQL started%RESET%
        echo [%date% %time%] PostgreSQL started successfully >> "%STARTUP_LOG%"
    )
)

REM ============================================
REM 2. 检查并启动 Redis
REM ============================================
echo [2/4] %GREEN%Checking Redis...%RESET%
tasklist /FI "IMAGENAME eq redis-server.exe" 2>NUL | find /I /N "redis-server.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo       Redis is already running
    echo [%date% %time%] Redis is already running >> "%STARTUP_LOG%"
) else (
    echo       Starting Redis...
    if exist "%BACKEND_DIR%redis\redis-server.exe" (
        if exist "%CONFIG_DIR%redis.conf" (
            start /B "" "%BACKEND_DIR%redis\redis-server.exe" "%CONFIG_DIR%redis.conf" --dir "%DATA_DIR%redis"
        ) else (
            start /B "" "%BACKEND_DIR%redis\redis-server.exe" --dir "%DATA_DIR%redis" --requirepass chainlesschain_redis_2024
        )
        timeout /t 2 /nobreak >NUL
        echo       %GREEN%Redis started%RESET%
        echo [%date% %time%] Redis started successfully >> "%STARTUP_LOG%"
    ) else (
        echo       %RED%WARNING: Redis binaries not found, skipping%RESET%
        echo [%date% %time%] WARNING: Redis binaries not found >> "%STARTUP_LOG%"
    )
)

REM ============================================
REM 3. 检查并启动 Qdrant
REM ============================================
echo [3/4] %GREEN%Checking Qdrant...%RESET%
tasklist /FI "IMAGENAME eq qdrant.exe" 2>NUL | find /I /N "qdrant.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo       Qdrant is already running
    echo [%date% %time%] Qdrant is already running >> "%STARTUP_LOG%"
) else (
    echo       Starting Qdrant...
    if exist "%BACKEND_DIR%qdrant\qdrant.exe" (
        if exist "%CONFIG_DIR%qdrant.yaml" (
            start /B "" "%BACKEND_DIR%qdrant\qdrant.exe" --config-path "%CONFIG_DIR%qdrant.yaml"
        ) else (
            start /B "" "%BACKEND_DIR%qdrant\qdrant.exe" --storage-path "%DATA_DIR%qdrant"
        )
        timeout /t 3 /nobreak >NUL
        echo       %GREEN%Qdrant started%RESET%
        echo [%date% %time%] Qdrant started successfully >> "%STARTUP_LOG%"
    ) else (
        echo       %RED%WARNING: Qdrant binaries not found, skipping%RESET%
        echo [%date% %time%] WARNING: Qdrant binaries not found >> "%STARTUP_LOG%"
    )
)

REM ============================================
REM 4. 启动 Java Project Service
REM ============================================
echo [4/4] %GREEN%Starting Project Service...%RESET%
tasklist /FI "WINDOWTITLE eq ChainlessChain-ProjectService*" 2>NUL | find /I /N "java.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo       Project Service is already running
    echo [%date% %time%] Project Service is already running >> "%STARTUP_LOG%"
) else (
    if exist "%BACKEND_DIR%jre\bin\java.exe" (
        if exist "%BACKEND_DIR%project-service.jar" (
            start "ChainlessChain-ProjectService" /MIN "%BACKEND_DIR%jre\bin\java.exe" ^
                -Xms256m -Xmx512m ^
                -Dspring.profiles.active=production ^
                -Dlogging.file.name="%LOG_DIR%project-service.log" ^
                -jar "%BACKEND_DIR%project-service.jar"
            timeout /t 3 /nobreak >NUL
            echo       %GREEN%Project Service started%RESET%
            echo [%date% %time%] Project Service started successfully >> "%STARTUP_LOG%"
        ) else (
            echo       %RED%WARNING: project-service.jar not found%RESET%
            echo [%date% %time%] WARNING: project-service.jar not found >> "%STARTUP_LOG%"
        )
    ) else (
        echo       %RED%WARNING: Java runtime not found%RESET%
        echo [%date% %time%] WARNING: Java runtime not found >> "%STARTUP_LOG%"
    )
)

echo.
echo %GREEN%========================================%RESET%
echo %GREEN%  All backend services started!%RESET%
echo %GREEN%========================================%RESET%
echo.
echo Services status:
echo   - PostgreSQL: http://localhost:5432
echo   - Redis: http://localhost:6379
echo   - Qdrant: http://localhost:6333
echo   - Project Service: http://localhost:9090
echo.
echo Log files location: %LOG_DIR%
echo.

REM 保存进程ID用于后续管理
echo [%date% %time%] Startup completed >> "%STARTUP_LOG%"

endlocal
exit /b 0
