@echo off
setlocal enabledelayedexpansion

REM ChainlessChain Windows 本地发布脚本（基于 gh CLI）
REM 用于在 Windows 机器上构建离线安装包并发布到 GitHub Releases

echo ===========================================
echo   ChainlessChain Windows 本地发布工具
echo ===========================================
echo.

REM 检查参数
if "%~1"=="" (
    echo 使用方法: %~nx0 ^<version^> [options]
    echo.
    echo 示例:
    echo   %~nx0 v0.16.0              # 创建正式版本
    echo   %~nx0 v0.16.0-beta.1       # 创建预发布版本
    echo   %~nx0 v0.16.0 --draft      # 创建草稿版本
    echo.
    exit /b 1
)

set "VERSION=%~1"
set "DRAFT="
set "PRERELEASE="

REM 解析参数
:parse_args
shift
if "%~1"=="" goto args_done
if "%~1"=="--draft" set "DRAFT=--draft"
if "%~1"=="--prerelease" set "PRERELEASE=--prerelease"
goto parse_args
:args_done

REM 确保版本号以 v 开头
echo !VERSION! | findstr /r "^v" >nul
if errorlevel 1 set "VERSION=v!VERSION!"

echo [INFO] 发布版本: !VERSION!
if defined DRAFT echo [WARNING] 草稿模式: 发布将标记为草稿
if defined PRERELEASE echo [WARNING] 预发布模式: 发布将标记为预发布版本
echo.

REM 检查必要工具
echo [INFO] 检查必要工具...

where gh >nul 2>&1
if errorlevel 1 (
    echo [ERROR] GitHub CLI ^(gh^) 未安装。请访问: https://cli.github.com/
    exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker 未安装。请访问: https://www.docker.com/
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js 未安装。请访问: https://nodejs.org/
    exit /b 1
)

echo [SUCCESS] 所有必要工具已安装
echo.

REM 检查 Docker 是否运行
echo [INFO] 检查 Docker 状态...
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker 未运行。请启动 Docker Desktop 后重试。
    exit /b 1
)
echo [SUCCESS] Docker 正在运行
echo.

REM 检查 gh 是否已登录
echo [INFO] 检查 GitHub CLI 登录状态...
gh auth status >nul 2>&1
if errorlevel 1 (
    echo [ERROR] GitHub CLI 未登录。请运行: gh auth login
    exit /b 1
)
echo [SUCCESS] GitHub CLI 已登录
echo.

REM 确认发布
set /p CONFIRM="确认发布版本 !VERSION!？(y/N): "
if /i not "!CONFIRM!"=="y" (
    echo [ERROR] 发布已取消
    exit /b 1
)

REM 项目目录
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\..\"
set "PACKAGING_DIR=%PROJECT_ROOT%packaging"
set "DESKTOP_APP_DIR=%PROJECT_ROOT%desktop-app-vue"
set "RELEASE_DIR=%PROJECT_ROOT%release-output"

cd /d "%PROJECT_ROOT%"

REM 清理之前的构建
echo [INFO] 清理之前的构建...
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"

REM Step 1: 导出 Docker 镜像
echo [INFO] Step 1/5: 导出 Docker 镜像...
cd /d "%PACKAGING_DIR%"

if not exist "export-docker-images.bat" (
    echo [ERROR] export-docker-images.bat 不存在
    exit /b 1
)

call export-docker-images.bat

REM 验证 Docker 镜像已导出
if not exist "docker-images\*.tar" (
    echo [ERROR] Docker 镜像导出失败
    exit /b 1
)

echo [SUCCESS] Docker 镜像导出完成
echo.

REM 显示镜像大小
echo [INFO] Docker 镜像列表:
dir /s /b docker-images\*.tar
echo.

REM Step 2: 安装依赖
echo [INFO] Step 2/5: 安装依赖...
cd /d "%PROJECT_ROOT%"
call npm ci

cd /d "%DESKTOP_APP_DIR%"
call npm ci

echo [SUCCESS] 依赖安装完成
echo.

REM Step 3: 构建应用
echo [INFO] Step 3/5: 构建应用...
cd /d "%DESKTOP_APP_DIR%"

echo [INFO] 构建主进程...
call npm run build:main

echo [INFO] 构建渲染进程...
set NODE_ENV=production
call npm run build

echo [SUCCESS] 应用构建完成
echo.

REM Step 4: 打包 Windows
echo [INFO] Step 4/5: 打包 Windows 平台...
cd /d "%DESKTOP_APP_DIR%"

set SKIP_BACKEND_CHECK=true
call npm run make:win

REM 复制文件到 release 目录
echo [INFO] 复制文件到 release 目录...
for /r "out\make" %%f in (*.exe) do copy "%%f" "%RELEASE_DIR%\"
for /r "out\make" %%f in (*.zip) do copy "%%f" "%RELEASE_DIR%\ChainlessChain-Windows-x64.zip"

echo [SUCCESS] 打包完成
echo.

REM 显示生成的文件
echo [INFO] 生成的安装包:
dir "%RELEASE_DIR%"
echo.

REM Step 5: 创建 GitHub Release
echo [INFO] Step 5/5: 创建 GitHub Release...
cd /d "%PROJECT_ROOT%"

REM 生成 Release Notes
for /f "delims=" %%i in ('git describe --tags --abbrev^=0 2^>nul') do set "PREV_TAG=%%i"

if "!PREV_TAG!"=="" (
    set "CHANGELOG=Initial release"
) else (
    set "CHANGELOG="
    for /f "delims=" %%i in ('git log !PREV_TAG!..HEAD --pretty^=format:"- %%s (%%h)" --no-merges') do (
        set "CHANGELOG=!CHANGELOG!%%i"
    )
)

REM 创建 release notes 文件
set "RELEASE_NOTES_FILE=%RELEASE_DIR%\release-notes.md"
(
echo ## 🎉 ChainlessChain !VERSION!
echo.
echo ### 📦 离线 Docker 版本^(完全离线安装^)
echo.
echo **本安装包包含完整的 Docker 镜像**，可在无网络环境下完成安装和使用。
echo.
echo - ✅ PostgreSQL 16 Alpine ^(~90 MB^)
echo - ✅ Redis 7 Alpine ^(~30 MB^)
echo - ✅ Qdrant v1.12.5 ^(~120 MB^)
echo - ✅ Ollama Latest ^(~500 MB^)
echo.
echo ---
echo.
echo ### 📋 安装步骤
echo.
echo 1. **安装 Docker Desktop**^(一次性^)
echo    - 下载: https://www.docker.com/products/docker-desktop/
echo.
echo 2. **安装 ChainlessChain** - 运行 Setup.exe
echo.
echo 3. **加载 Docker 镜像**^(首次安装^)
echo    - 运行 `load-docker-images.bat`
echo.
echo 4. **启动服务**
echo    - 运行 `start-services.bat`
echo.
echo 5. **启动应用** - 启动 ChainlessChain 桌面应用即可使用！
echo.
echo ---
echo.
echo ### 📚 文档
echo.
echo - 📖 [快速开始指南]^(https://github.com/$GITHUB_REPOSITORY/blob/main/packaging/QUICK_START_OFFLINE.md^)
echo - 📖 [完整安装文档]^(https://github.com/$GITHUB_REPOSITORY/blob/main/packaging/DOCKER_OFFLINE_PACKAGING.md^)
echo - 🔧 [故障排除]^(https://github.com/$GITHUB_REPOSITORY/blob/main/packaging/DOCKER_OFFLINE_PACKAGING.md#故障排除^)
echo.
echo ---
echo.
echo ### 📝 更新日志
echo.
echo !CHANGELOG!
) > "!RELEASE_NOTES_FILE!"

REM 使用 gh CLI 创建 release
echo [INFO] 创建 GitHub Release...

set "GH_ARGS=--title "ChainlessChain !VERSION!" --notes-file "!RELEASE_NOTES_FILE!""
if defined DRAFT set "GH_ARGS=!GH_ARGS! --draft"
if defined PRERELEASE set "GH_ARGS=!GH_ARGS! --prerelease"

REM 收集所有文件
set "FILES="
for %%f in ("%RELEASE_DIR%\*.exe") do set "FILES=!FILES! "%%f""
for %%f in ("%RELEASE_DIR%\*.zip") do set "FILES=!FILES! "%%f""

gh release create !VERSION! !GH_ARGS! !FILES!

echo [SUCCESS] GitHub Release 创建成功！
echo.

REM 显示 Release URL
for /f "delims=" %%i in ('git remote get-url origin') do set "REPO_URL=%%i"
set "REPO_URL=!REPO_URL:.git=!"
set "RELEASE_URL=!REPO_URL!/releases/tag/!VERSION!"

echo ===========================================
echo   🎉 发布完成！
echo ===========================================
echo.
echo 📦 发布版本: !VERSION!
echo 🔗 Release URL: !RELEASE_URL!
echo.
echo 📂 本地文件位置: %RELEASE_DIR%
dir "%RELEASE_DIR%"
echo.

echo [SUCCESS] 所有步骤完成！
pause
