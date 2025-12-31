@echo off
REM ============================================
REM 检查所有构建组件是否已准备
REM ============================================
setlocal EnableDelayedExpansion

set GREEN=[92m
set RED=[91m
set YELLOW=[93m
set CYAN=[96m
set RESET=[0m

echo %CYAN%========================================%RESET%
echo %CYAN% ChainlessChain Build Components Check%RESET%
echo %CYAN%========================================%RESET%
echo.

set ROOT_DIR=%~dp0..\..
set PACKAGING_DIR=%ROOT_DIR%\packaging
set BACKEND_DIR=%ROOT_DIR%\backend

set ALL_READY=1

REM ============================================
REM 1. 检查 PostgreSQL
REM ============================================
echo %YELLOW%[1/5] PostgreSQL Portable%RESET%
if exist "%PACKAGING_DIR%\postgres\bin\postgres.exe" (
    echo   Status: %GREEN%✓ Ready%RESET%
    echo   Path: %PACKAGING_DIR%\postgres\bin\postgres.exe
) else (
    echo   Status: %RED%✗ Missing%RESET%
    echo   Download: https://www.enterprisedb.com/download-postgresql-binaries
    echo   Extract to: %PACKAGING_DIR%\postgres\
    set ALL_READY=0
)
echo.

REM ============================================
REM 2. 检查 Redis
REM ============================================
echo %YELLOW%[2/5] Redis for Windows%RESET%
if exist "%PACKAGING_DIR%\redis\redis-server.exe" (
    echo   Status: %GREEN%✓ Ready%RESET%
    echo   Path: %PACKAGING_DIR%\redis\redis-server.exe
) else (
    echo   Status: %RED%✗ Missing%RESET%
    echo   Download: https://github.com/tporadowski/redis/releases
    echo   Extract to: %PACKAGING_DIR%\redis\
    set ALL_READY=0
)
echo.

REM ============================================
REM 3. 检查 Qdrant
REM ============================================
echo %YELLOW%[3/5] Qdrant Vector Database%RESET%
if exist "%PACKAGING_DIR%\qdrant\qdrant.exe" (
    echo   Status: %GREEN%✓ Ready%RESET%
    echo   Path: %PACKAGING_DIR%\qdrant\qdrant.exe
) else (
    echo   Status: %RED%✗ Missing%RESET%
    echo   Download: https://github.com/qdrant/qdrant/releases
    echo   Extract to: %PACKAGING_DIR%\qdrant\
    set ALL_READY=0
)
echo.

REM ============================================
REM 4. 检查 JRE 17
REM ============================================
echo %YELLOW%[4/5] Java Runtime Environment 17%RESET%
if exist "%PACKAGING_DIR%\jre-17\bin\java.exe" (
    echo   Status: %GREEN%✓ Ready%RESET%
    echo   Path: %PACKAGING_DIR%\jre-17\bin\java.exe
    "%PACKAGING_DIR%\jre-17\bin\java.exe" -version 2>&1 | findstr "version"
) else (
    echo   Status: %RED%✗ Missing%RESET%
    echo   Download: https://adoptium.net/temurin/releases/?version=17
    echo   Extract to: %PACKAGING_DIR%\jre-17\
    set ALL_READY=0
)
echo.

REM ============================================
REM 5. 检查 Java 后端
REM ============================================
echo %YELLOW%[5/5] Java Backend Service (JAR)%RESET%
if exist "%BACKEND_DIR%\project-service\target\project-service.jar" (
    echo   Status: %GREEN%✓ Ready%RESET%
    echo   Path: %BACKEND_DIR%\project-service\target\project-service.jar

    REM 显示 JAR 文件大小
    for %%F in ("%BACKEND_DIR%\project-service\target\project-service.jar") do (
        set size=%%~zF
        set /a sizeMB=!size! / 1048576
        echo   Size: !sizeMB! MB
    )
) else (
    echo   Status: %RED%✗ Missing%RESET%
    echo.
    REM 检查 Maven 是否可用
    where mvn >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo   %YELLOW%Maven is available. You can build it:%RESET%
        echo   cd %BACKEND_DIR%\project-service
        echo   mvn clean package -DskipTests
    ) else (
        echo   %RED%Maven is not installed.%RESET%
        echo   Option 1: Install Maven from https://maven.apache.org/download.cgi
        echo   Option 2: Use a pre-built JAR file
    )
    set ALL_READY=0
)
echo.

REM ============================================
REM 额外检查: Node.js 和 npm
REM ============================================
echo %YELLOW%[Extra] Development Tools%RESET%
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    node --version | findstr "v"
    echo   Node.js: %GREEN%✓ Installed%RESET%
) else (
    echo   Node.js: %RED%✗ Not found%RESET%
    set ALL_READY=0
)

where npm >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    npm --version
    echo   npm: %GREEN%✓ Installed%RESET%
) else (
    echo   npm: %RED%✗ Not found%RESET%
    set ALL_READY=0
)
echo.

REM ============================================
REM 最终结果
REM ============================================
echo %CYAN%========================================%RESET%
if "%ALL_READY%"=="1" (
    echo %GREEN% ✓ All components are ready!%RESET%
    echo.
    echo %GREEN% You can now run:%RESET%
    echo   cd %ROOT_DIR%
    echo   build-windows-package.bat
    echo.
) else (
    echo %RED% ✗ Some components are missing%RESET%
    echo.
    echo %YELLOW% Please download the missing components above%RESET%
    echo.
    echo %CYAN% For detailed instructions, see:%RESET%
    echo   %PACKAGING_DIR%\CURRENT_STATUS.md
    echo   %PACKAGING_DIR%\BUILD_INSTRUCTIONS.md
    echo.
)
echo %CYAN%========================================%RESET%
echo.

pause
endlocal
exit /b 0
