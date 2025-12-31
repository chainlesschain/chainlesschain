@echo off
REM ============================================
REM ChainlessChain Windows Package Builder
REM ============================================
REM 构建包含所有组件的Windows安装包
REM ============================================

setlocal EnableDelayedExpansion

set GREEN=[92m
set RED=[91m
set YELLOW=[93m
set CYAN=[96m
set RESET=[0m

echo %CYAN%========================================%RESET%
echo %CYAN% ChainlessChain Windows Package Builder%RESET%
echo %CYAN%========================================%RESET%
echo.

REM 设置目录
set ROOT_DIR=%~dp0
set PACKAGING_DIR=%ROOT_DIR%packaging
set BACKEND_DIR=%ROOT_DIR%backend
set DESKTOP_DIR=%ROOT_DIR%desktop-app-vue
set DIST_DIR=%PACKAGING_DIR%\dist
set BUILD_LOG=%PACKAGING_DIR%\build.log

REM 清理构建日志
if exist "%BUILD_LOG%" del /F /Q "%BUILD_LOG%"
echo [%date% %time%] Build started > "%BUILD_LOG%"

REM 创建必要的目录
echo %YELLOW%[0/8] Creating directories...%RESET%
if not exist "%PACKAGING_DIR%" mkdir "%PACKAGING_DIR%"
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
if not exist "%PACKAGING_DIR%\jre-17" mkdir "%PACKAGING_DIR%\jre-17"
if not exist "%PACKAGING_DIR%\postgres" mkdir "%PACKAGING_DIR%\postgres"
if not exist "%PACKAGING_DIR%\redis" mkdir "%PACKAGING_DIR%\redis"
if not exist "%PACKAGING_DIR%\qdrant" mkdir "%PACKAGING_DIR%\qdrant"
if not exist "%PACKAGING_DIR%\config" mkdir "%PACKAGING_DIR%\config"

REM ============================================
REM 步骤 1: 检查必需工具
REM ============================================
echo.
echo %CYAN%[1/8] Checking required tools...%RESET%
echo [%date% %time%] Checking required tools >> "%BUILD_LOG%"

REM 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo %RED%ERROR: Node.js not found. Please install Node.js first.%RESET%
    echo [%date% %time%] ERROR: Node.js not found >> "%BUILD_LOG%"
    goto :error
)
node --version
echo   %GREEN%✓ Node.js found%RESET%

REM 检查 npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo %RED%ERROR: npm not found.%RESET%
    goto :error
)
npm --version
echo   %GREEN%✓ npm found%RESET%

REM 检查 Maven (可选 - 如果已有jar文件可跳过)
where mvn >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo %YELLOW%WARNING: Maven not found. Will skip Java backend build.%RESET%
    echo %YELLOW%         Please manually build backend/project-service and place JAR in target folder.%RESET%
    echo [%date% %time%] WARNING: Maven not found >> "%BUILD_LOG%"
    set SKIP_JAVA_BUILD=1
) else (
    mvn --version
    echo   %GREEN%✓ Maven found%RESET%
    set SKIP_JAVA_BUILD=0
)

REM 检查 Java (可选)
where java >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo %YELLOW%WARNING: Java not found.%RESET%
    set HAS_JAVA=0
) else (
    java -version 2>&1 | findstr /C:"version"
    echo   %GREEN%✓ Java found%RESET%
    set HAS_JAVA=1
)

echo.

REM ============================================
REM 步骤 2: 构建 Java 后端服务
REM ============================================
echo %CYAN%[2/8] Building Java Backend Service...%RESET%
echo [%date% %time%] Building Java backend >> "%BUILD_LOG%"

if "%SKIP_JAVA_BUILD%"=="1" (
    echo %YELLOW%Skipping Java build (Maven not available)%RESET%
    if exist "%BACKEND_DIR%\project-service\target\project-service.jar" (
        echo   %GREEN%✓ Using existing JAR file%RESET%
    ) else (
        echo   %RED%ERROR: No JAR file found and Maven not available%RESET%
        echo   %RED%Please build backend/project-service manually%RESET%
        echo [%date% %time%] ERROR: No JAR file and no Maven >> "%BUILD_LOG%"
        goto :error
    )
) else (
    cd /d "%BACKEND_DIR%\project-service"
    call mvn clean package -DskipTests 2>&1 | tee -a "%BUILD_LOG%"
    if %ERRORLEVEL% NEQ 0 (
        echo %RED%ERROR: Java backend build failed%RESET%
        echo [%date% %time%] ERROR: Java backend build failed >> "%BUILD_LOG%"
        goto :error
    )
    cd /d "%ROOT_DIR%"
    echo   %GREEN%✓ Java backend built successfully%RESET%
    echo [%date% %time%] Java backend built successfully >> "%BUILD_LOG%"
)

echo.

REM ============================================
REM 步骤 3: 准备第三方组件
REM ============================================
echo %CYAN%[3/8] Preparing third-party components...%RESET%
echo [%date% %time%] Preparing third-party components >> "%BUILD_LOG%"

REM 3.1 PostgreSQL
echo   [3.1] PostgreSQL...
if not exist "%PACKAGING_DIR%\postgres\bin\postgres.exe" (
    echo %YELLOW%PostgreSQL not found. Please download manually:%RESET%
    echo https://get.enterprisedb.com/postgresql/postgresql-16.1-1-windows-x64-binaries.zip
    echo Extract to: %PACKAGING_DIR%\postgres\
    echo.
    echo %YELLOW%Press any key to continue (or Ctrl+C to abort)...%RESET%
    pause >nul
) else (
    echo     %GREEN%✓ PostgreSQL ready%RESET%
)

REM 3.2 Redis
echo   [3.2] Redis...
if not exist "%PACKAGING_DIR%\redis\redis-server.exe" (
    echo %YELLOW%Redis not found. Downloading...%RESET%
    curl -L "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip" -o "%TEMP%\redis.zip"
    if %ERRORLEVEL% EQU 0 (
        powershell -Command "Expand-Archive -Force '%TEMP%\redis.zip' '%PACKAGING_DIR%\redis'"
        echo     %GREEN%✓ Redis downloaded%RESET%
    ) else (
        echo     %YELLOW%Download failed. Please download manually:%RESET%
        echo https://github.com/tporadowski/redis/releases
        pause
    )
) else (
    echo     %GREEN%✓ Redis ready%RESET%
)

REM 3.3 Qdrant
echo   [3.3] Qdrant...
if not exist "%PACKAGING_DIR%\qdrant\qdrant.exe" (
    echo %YELLOW%Qdrant not found. Downloading...%RESET%
    curl -L "https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-pc-windows-msvc.zip" -o "%TEMP%\qdrant.zip"
    if %ERRORLEVEL% EQU 0 (
        powershell -Command "Expand-Archive -Force '%TEMP%\qdrant.zip' '%PACKAGING_DIR%\qdrant'"
        echo     %GREEN%✓ Qdrant downloaded%RESET%
    ) else (
        echo     %YELLOW%Download failed. Please download manually:%RESET%
        echo https://github.com/qdrant/qdrant/releases
        pause
    )
) else (
    echo     %GREEN%✓ Qdrant ready%RESET%
)

REM 3.4 JRE (Java Runtime Environment)
echo   [3.4] JRE 17...
if not exist "%PACKAGING_DIR%\jre-17\bin\java.exe" (
    echo %YELLOW%JRE 17 not found. Please download manually:%RESET%
    echo https://adoptium.net/temurin/releases/?version=17
    echo Download: Windows x64 JRE .zip
    echo Extract to: %PACKAGING_DIR%\jre-17\
    echo.
    pause
) else (
    echo     %GREEN%✓ JRE 17 ready%RESET%
)

echo.

REM ============================================
REM 步骤 4: 创建配置文件
REM ============================================
echo %CYAN%[4/8] Creating configuration files...%RESET%
echo [%date% %time%] Creating configuration files >> "%BUILD_LOG%"

REM Redis配置
if not exist "%PACKAGING_DIR%\config\redis.conf" (
    echo port 6379 > "%PACKAGING_DIR%\config\redis.conf"
    echo requirepass chainlesschain_redis_2024 >> "%PACKAGING_DIR%\config\redis.conf"
    echo appendonly yes >> "%PACKAGING_DIR%\config\redis.conf"
    echo dir ./data/redis >> "%PACKAGING_DIR%\config\redis.conf"
    echo   %GREEN%✓ Redis config created%RESET%
)

REM Qdrant配置
if not exist "%PACKAGING_DIR%\config\qdrant.yaml" (
    echo service: > "%PACKAGING_DIR%\config\qdrant.yaml"
    echo   http_port: 6333 >> "%PACKAGING_DIR%\config\qdrant.yaml"
    echo   grpc_port: 6334 >> "%PACKAGING_DIR%\config\qdrant.yaml"
    echo. >> "%PACKAGING_DIR%\config\qdrant.yaml"
    echo storage: >> "%PACKAGING_DIR%\config\qdrant.yaml"
    echo   storage_path: ./data/qdrant >> "%PACKAGING_DIR%\config\qdrant.yaml"
    echo   %GREEN%✓ Qdrant config created%RESET%
)

echo.

REM ============================================
REM 步骤 5: 构建 Electron 应用
REM ============================================
echo %CYAN%[5/8] Building Electron Application...%RESET%
echo [%date% %time%] Building Electron application >> "%BUILD_LOG%"

cd /d "%DESKTOP_DIR%"

REM 安装依赖
echo   Installing dependencies...
call npm install 2>&1 | tee -a "%BUILD_LOG%"
if %ERRORLEVEL% NEQ 0 (
    echo %RED%ERROR: npm install failed%RESET%
    goto :error
)

REM 构建前端
echo   Building renderer (Vue)...
call npm run build:renderer 2>&1 | tee -a "%BUILD_LOG%"
if %ERRORLEVEL% NEQ 0 (
    echo %RED%ERROR: Renderer build failed%RESET%
    goto :error
)

REM 构建主进程
echo   Building main process...
call npm run build:main 2>&1 | tee -a "%BUILD_LOG%"
if %ERRORLEVEL% NEQ 0 (
    echo %RED%ERROR: Main process build failed%RESET%
    goto :error
)

echo   %GREEN%✓ Electron app built successfully%RESET%
echo [%date% %time%] Electron app built successfully >> "%BUILD_LOG%"

cd /d "%ROOT_DIR%"
echo.

REM ============================================
REM 步骤 6: 打包 Electron 应用
REM ============================================
echo %CYAN%[6/8] Packaging Electron Application...%RESET%
echo [%date% %time%] Packaging Electron application >> "%BUILD_LOG%"

cd /d "%DESKTOP_DIR%"

REM 使用 Electron Forge 打包
call npm run package 2>&1 | tee -a "%BUILD_LOG%"
if %ERRORLEVEL% NEQ 0 (
    echo %YELLOW%WARNING: Package failed, trying to continue...%RESET%
)

echo   %GREEN%✓ Electron app packaged%RESET%
echo [%date% %time%] Electron app packaged >> "%BUILD_LOG%"

cd /d "%ROOT_DIR%"
echo.

REM ============================================
REM 步骤 7: 创建安装程序
REM ============================================
echo %CYAN%[7/8] Creating Windows Installer...%RESET%
echo [%date% %time%] Creating Windows installer >> "%BUILD_LOG%"

cd /d "%DESKTOP_DIR%"

call npm run make:win 2>&1 | tee -a "%BUILD_LOG%"
if %ERRORLEVEL% NEQ 0 (
    echo %RED%ERROR: Installer creation failed%RESET%
    echo [%date% %time%] ERROR: Installer creation failed >> "%BUILD_LOG%"
    goto :error
)

echo   %GREEN%✓ Installer created successfully%RESET%
echo [%date% %time%] Installer created successfully >> "%BUILD_LOG%"

cd /d "%ROOT_DIR%"
echo.

REM ============================================
REM 步骤 8: 整理输出文件
REM ============================================
echo %CYAN%[8/8] Organizing output files...%RESET%
echo [%date% %time%] Organizing output files >> "%BUILD_LOG%"

REM 复制安装程序到dist目录
if exist "%DESKTOP_DIR%\out\make\squirrel.windows\x64\*.exe" (
    xcopy /Y /I "%DESKTOP_DIR%\out\make\squirrel.windows\x64\*.exe" "%DIST_DIR%\" 2>&1 | tee -a "%BUILD_LOG%"
    echo   %GREEN%✓ Installer copied to packaging/dist/%RESET%
)

REM 复制版本信息
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" "%DESKTOP_DIR%\package.json"') do set VERSION=%%~a
echo Version: %VERSION% > "%DIST_DIR%\VERSION.txt"
echo Build Date: %date% %time% >> "%DIST_DIR%\VERSION.txt"

echo.
echo %GREEN%========================================%RESET%
echo %GREEN%  Build Completed Successfully!%RESET%
echo %GREEN%========================================%RESET%
echo.
echo Output files location:
echo   %DIST_DIR%
echo.
dir "%DIST_DIR%"
echo.
echo %CYAN%Package size and location:%RESET%
for %%F in ("%DIST_DIR%\*.exe") do (
    echo   %%~nxF - %%~zF bytes
)
echo.
echo %GREEN%Ready to distribute!%RESET%
echo.
echo [%date% %time%] Build completed successfully >> "%BUILD_LOG%"

pause
exit /b 0

:error
echo.
echo %RED%========================================%RESET%
echo %RED%  Build Failed!%RESET%
echo %RED%========================================%RESET%
echo.
echo Please check the build log for details:
echo   %BUILD_LOG%
echo.
echo [%date% %time%] Build failed >> "%BUILD_LOG%"
pause
exit /b 1
