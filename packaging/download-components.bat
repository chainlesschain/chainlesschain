@echo off
REM ============================================
REM 下载第三方组件脚本
REM ============================================
setlocal EnableDelayedExpansion

set GREEN=[92m
set RED=[91m
set YELLOW=[93m
set CYAN=[96m
set RESET=[0m

echo %CYAN%========================================%RESET%
echo %CYAN% ChainlessChain Components Downloader%RESET%
echo %CYAN%========================================%RESET%
echo.

set PACKAGING_DIR=%~dp0
set TEMP_DOWNLOAD=%TEMP%\chainlesschain-components

REM 创建临时下载目录
if not exist "%TEMP_DOWNLOAD%" mkdir "%TEMP_DOWNLOAD%"

REM ============================================
REM 1. 下载 Redis for Windows
REM ============================================
echo %YELLOW%[1/4] Downloading Redis for Windows...%RESET%
if exist "%PACKAGING_DIR%redis\redis-server.exe" (
    echo   %GREEN%✓ Redis already exists, skipping%RESET%
) else (
    echo   Downloading Redis...
    curl -L "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip" -o "%TEMP_DOWNLOAD%\redis.zip"

    if %ERRORLEVEL% EQU 0 (
        echo   Extracting Redis...
        powershell -Command "Expand-Archive -Force '%TEMP_DOWNLOAD%\redis.zip' '%PACKAGING_DIR%\redis'"
        echo   %GREEN%✓ Redis downloaded and extracted%RESET%
    ) else (
        echo   %RED%✗ Redis download failed%RESET%
        echo   Please download manually from: https://github.com/tporadowski/redis/releases
    )
)
echo.

REM ============================================
REM 2. 下载 Qdrant
REM ============================================
echo %YELLOW%[2/4] Downloading Qdrant...%RESET%
if exist "%PACKAGING_DIR%qdrant\qdrant.exe" (
    echo   %GREEN%✓ Qdrant already exists, skipping%RESET%
) else (
    echo   Downloading Qdrant...
    curl -L "https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-pc-windows-msvc.zip" -o "%TEMP_DOWNLOAD%\qdrant.zip"

    if %ERRORLEVEL% EQU 0 (
        echo   Extracting Qdrant...
        powershell -Command "Expand-Archive -Force '%TEMP_DOWNLOAD%\qdrant.zip' '%TEMP_DOWNLOAD%\qdrant-temp'"

        REM Qdrant zip 内部可能有文件夹，需要移动exe
        if not exist "%PACKAGING_DIR%qdrant" mkdir "%PACKAGING_DIR%qdrant"

        REM 尝试多种可能的路径
        if exist "%TEMP_DOWNLOAD%\qdrant-temp\qdrant.exe" (
            move /Y "%TEMP_DOWNLOAD%\qdrant-temp\qdrant.exe" "%PACKAGING_DIR%\qdrant\"
        ) else if exist "%TEMP_DOWNLOAD%\qdrant-temp\bin\qdrant.exe" (
            move /Y "%TEMP_DOWNLOAD%\qdrant-temp\bin\qdrant.exe" "%PACKAGING_DIR%\qdrant\"
        ) else (
            REM 尝试找到qdrant.exe
            for /r "%TEMP_DOWNLOAD%\qdrant-temp" %%f in (qdrant.exe) do (
                move /Y "%%f" "%PACKAGING_DIR%\qdrant\"
                goto :qdrant_found
            )
        )

        :qdrant_found
        echo   %GREEN%✓ Qdrant downloaded and extracted%RESET%
    ) else (
        echo   %RED%✗ Qdrant download failed%RESET%
        echo   Please download manually from: https://github.com/qdrant/qdrant/releases
    )
)
echo.

REM ============================================
REM 3. PostgreSQL 和 JRE 需要手动下载
REM ============================================
echo %YELLOW%[3/4] PostgreSQL (Manual Download Required)%RESET%
if exist "%PACKAGING_DIR%postgres\bin\postgres.exe" (
    echo   %GREEN%✓ PostgreSQL already exists%RESET%
) else (
    echo   %YELLOW%PostgreSQL requires manual download:%RESET%
    echo   1. Visit: https://www.enterprisedb.com/download-postgresql-binaries
    echo   2. Download: PostgreSQL 16.x Windows x64 binaries
    echo   3. Extract to: %PACKAGING_DIR%postgres\
    echo.
    echo   %CYAN%Press any key to open download page...%RESET%
    pause >nul
    start https://www.enterprisedb.com/download-postgresql-binaries
)
echo.

echo %YELLOW%[4/4] JRE 17 (Manual Download Required)%RESET%
if exist "%PACKAGING_DIR%jre-17\bin\java.exe" (
    echo   %GREEN%✓ JRE 17 already exists%RESET%
) else (
    echo   %YELLOW%JRE 17 requires manual download:%RESET%
    echo   1. Visit: https://adoptium.net/temurin/releases/?version=17
    echo   2. Select: Windows x64 JRE .zip
    echo   3. Extract to: %PACKAGING_DIR%jre-17\
    echo.
    echo   %CYAN%Press any key to open download page...%RESET%
    pause >nul
    start https://adoptium.net/temurin/releases/?version=17
)
echo.

REM ============================================
REM 清理临时文件
REM ============================================
echo %CYAN%Cleaning up temporary files...%RESET%
if exist "%TEMP_DOWNLOAD%" (
    rmdir /S /Q "%TEMP_DOWNLOAD%"
)

REM ============================================
REM 检查所有组件
REM ============================================
echo.
echo %CYAN%========================================%RESET%
echo %CYAN% Component Status Check%RESET%
echo %CYAN%========================================%RESET%
echo.

set ALL_READY=1

echo [PostgreSQL]
if exist "%PACKAGING_DIR%postgres\bin\postgres.exe" (
    echo   Status: %GREEN%✓ Ready%RESET%
) else (
    echo   Status: %RED%✗ Missing%RESET%
    set ALL_READY=0
)

echo.
echo [Redis]
if exist "%PACKAGING_DIR%redis\redis-server.exe" (
    echo   Status: %GREEN%✓ Ready%RESET%
) else (
    echo   Status: %RED%✗ Missing%RESET%
    set ALL_READY=0
)

echo.
echo [Qdrant]
if exist "%PACKAGING_DIR%qdrant\qdrant.exe" (
    echo   Status: %GREEN%✓ Ready%RESET%
) else (
    echo   Status: %RED%✗ Missing%RESET%
    set ALL_READY=0
)

echo.
echo [JRE 17]
if exist "%PACKAGING_DIR%jre-17\bin\java.exe" (
    echo   Status: %GREEN%✓ Ready%RESET%
) else (
    echo   Status: %RED%✗ Missing%RESET%
    set ALL_READY=0
)

echo.
echo %CYAN%========================================%RESET%

if "%ALL_READY%"=="1" (
    echo %GREEN% All components are ready! %RESET%
    echo %GREEN% You can now run: build-windows-package.bat %RESET%
) else (
    echo %YELLOW% Some components are missing. %RESET%
    echo %YELLOW% Please download them manually. %RESET%
)

echo %CYAN%========================================%RESET%
echo.

pause
endlocal
exit /b 0
