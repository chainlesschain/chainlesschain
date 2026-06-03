@echo off
REM =============================================================================
REM 后端服务独立编译脚本
REM =============================================================================
REM 功能：将 Java 和 Python 后端服务编译为独立可执行文件
REM 输出：project-service.exe, ai-service.exe
REM =============================================================================

setlocal enabledelayedexpansion

echo.
echo ====================================================================
echo   ChainlessChain 后端服务独立编译工具
echo ====================================================================
echo.
echo 此脚本将编译后端服务为独立可执行文件
echo 不依赖 Java 运行时或 Python 环境
echo.

REM 创建输出目录
if not exist "standalone" mkdir "standalone"

REM =============================================================================
REM 编译选项
REM =============================================================================

echo 请选择编译方式：
echo   [1] 打包 JAR + JRE（快速，体积较大约 200MB）
echo   [2] GraalVM Native Image（慢，体积小约 50MB，需要 GraalVM）
echo   [3] jpackage（推荐，体积适中约 100MB）
echo.
set /p BUILD_MODE="请选择 (1/2/3，默认 1): "
if "%BUILD_MODE%"=="" set BUILD_MODE=1

echo.

REM =============================================================================
REM 编译 Project Service (Java)
REM =============================================================================

echo [1/2] 编译 Project Service...
echo.

cd project-service

if "%BUILD_MODE%"=="1" (
    REM 方式 1: 打包 JAR + 嵌入 JRE
    echo 使用方式 1: JAR + JRE 打包
    echo.

    REM 编译 JAR
    echo   编译 Spring Boot JAR...
    call mvn clean package -DskipTests
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Maven 编译失败
        cd ..
        pause
        exit /b 1
    )

    REM 复制 JAR
    copy "target\project-service-*.jar" "..\standalone\project-service.jar" >nul

    REM 创建启动脚本
    echo   创建启动包装器...
    (
    echo @echo off
    echo REM Project Service Launcher
    echo cd /d "%%~dp0"
    echo.
    echo REM 检查 Java
    echo where java ^>nul 2^>^&1
    echo if %%ERRORLEVEL%% NEQ 0 ^(
    echo     echo [ERROR] Java 未安装
    echo     echo 请安装 Java 17+ 或使用 jpackage 版本
    echo     pause
    echo     exit /b 1
    echo ^)
    echo.
    echo REM 启动服务
    echo java -jar project-service.jar
    ) > "..\standalone\project-service.bat"

    echo   ✓ Project Service JAR 已创建
    echo   注意: 需要 Java 17+ 运行时

) else if "%BUILD_MODE%"=="2" (
    REM 方式 2: GraalVM Native Image
    echo 使用方式 2: GraalVM Native Image
    echo.

    REM 检查 GraalVM
    where native-image >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] GraalVM native-image 未安装
        echo.
        echo 请安装 GraalVM 并运行:
        echo   gu install native-image
        echo.
        cd ..
        pause
        exit /b 1
    )

    REM 编译 JAR
    echo   编译 Spring Boot JAR...
    call mvn clean package -DskipTests -Pnative
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Maven 编译失败
        cd ..
        pause
        exit /b 1
    )

    REM 生成 Native Image
    echo   生成 Native Image（这可能需要几分钟）...
    native-image -jar target\project-service-*.jar ..\standalone\project-service.exe
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Native Image 生成失败
        cd ..
        pause
        exit /b 1
    )

    echo   ✓ Project Service 原生可执行文件已创建
    echo   文件大小: 约 50MB

) else if "%BUILD_MODE%"=="3" (
    REM 方式 3: jpackage
    echo 使用方式 3: jpackage
    echo.

    REM 检查 jpackage (JDK 14+)
    where jpackage >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] jpackage 未找到
        echo 请确保使用 JDK 14+ 并添加到 PATH
        cd ..
        pause
        exit /b 1
    )

    REM 编译 JAR
    echo   编译 Spring Boot JAR...
    call mvn clean package -DskipTests
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Maven 编译失败
        cd ..
        pause
        exit /b 1
    )

    REM 使用 jpackage 打包
    echo   使用 jpackage 打包（这可能需要几分钟）...
    jpackage ^
        --input target ^
        --name project-service ^
        --main-jar project-service-*.jar ^
        --type app-image ^
        --dest ..\standalone\project-service-dist ^
        --app-version 1.0.0 ^
        --vendor "ChainlessChain Team"

    if !ERRORLEVEL! EQU 0 (
        REM 创建简化的启动脚本
        copy "..\standalone\project-service-dist\project-service\project-service.exe" "..\standalone\project-service.exe" >nul
        echo   ✓ Project Service 可执行文件已创建
        echo   文件大小: 约 100MB
    ) else (
        echo [ERROR] jpackage 打包失败
        cd ..
        pause
        exit /b 1
    )
)

REM 复制配置文件
copy "src\main\resources\application.yml" "..\standalone\application.yml" >nul

cd ..
echo.

REM =============================================================================
REM 编译 AI Service (Python)
REM =============================================================================

echo [2/2] 编译 AI Service...
echo.

cd ai-service

REM 检查 Python
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Python 未安装，跳过 AI Service 编译
    echo 请安装 Python 3.11+ 后重新运行
    cd ..
    goto SKIP_AI_SERVICE
)

echo   检查 PyInstaller...
python -m pip show pyinstaller >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   安装 PyInstaller...
    python -m pip install pyinstaller
)

echo   使用 PyInstaller 编译...
echo   （这可能需要几分钟，首次编译会更慢）
echo.

REM 使用 PyInstaller 打包
python -m PyInstaller ^
    --name ai-service ^
    --onefile ^
    --add-data "config.py;." ^
    --hidden-import fastapi ^
    --hidden-import uvicorn ^
    --hidden-import ollama ^
    --hidden-import qdrant_client ^
    main.py

if %ERRORLEVEL% EQU 0 (
    REM 复制可执行文件
    copy "dist\ai-service.exe" "..\standalone\ai-service.exe" >nul
    echo   ✓ AI Service 可执行文件已创建
    echo   文件大小: 约 30-50MB
) else (
    echo [ERROR] PyInstaller 编译失败
    cd ..
    pause
    exit /b 1
)

REM 复制配置文件
copy "config.py" "..\standalone\config.yml" >nul

cd ..

:SKIP_AI_SERVICE

REM =============================================================================
REM 完成
REM =============================================================================

echo.
echo ====================================================================
echo   编译完成！
echo ====================================================================
echo.
echo 输出目录: standalone\
echo.
echo 生成的文件：
dir /b standalone\*.exe standalone\*.bat 2>nul
echo.

if "%BUILD_MODE%"=="1" (
    echo 注意：JAR 版本需要 Java 17+ 运行时
    echo 建议使用 project-service.bat 启动
) else (
    echo 这些文件可以在没有 Java/Python 环境的机器上运行
)

echo.
echo 下一步:
echo   1. 测试服务是否能正常启动
echo   2. 运行 desktop-app-vue\build-windows-package-standalone.bat
echo   3. 选择模式 [2] 前端 + 便携后端
echo.

pause
