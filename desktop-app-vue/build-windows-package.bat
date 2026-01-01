@echo off
REM =============================================================================
REM ChainlessChain 完整打包脚本 - 前端 + 后端一体化
REM =============================================================================
REM 功能：
REM 1. 构建前端 Electron 应用
REM 2. 打包后端 Docker Compose 配置
REM 3. 生成包含前后端的 Windows 安装包
REM =============================================================================

setlocal enabledelayedexpansion

echo.
echo ====================================================================
echo   ChainlessChain Windows 一体化打包工具
echo ====================================================================
echo.
echo 此脚本将打包以下内容：
echo   - 前端 Electron 应用 (Vue3 + Electron)
echo   - 后端 Docker Compose 配置 (Ollama, Qdrant, PostgreSQL, Redis, etc.)
echo   - 一键启动脚本
echo.
echo.
echo 打包模式选择：
echo   [1] 在线安装包 - 用户首次启动时下载镜像 (约 200MB)
echo   [2] 离线安装包 - 包含所有 Docker 镜像 (约 5-6GB)
echo.
set /p PACKAGE_MODE="请选择模式 (1 或 2，默认 1): "
if "%PACKAGE_MODE%"=="" set PACKAGE_MODE=1

if "%PACKAGE_MODE%"=="2" (
    echo.
    echo 已选择: 离线安装包模式
    echo 将包含所有 Docker 镜像，安装包较大 (约 5-6GB)
    set OFFLINE_MODE=1
) else (
    echo.
    echo 已选择: 在线安装包模式
    echo 用户首次启动时需要下载约 2-3GB 的 Docker 镜像
    set OFFLINE_MODE=0
)
echo.

REM =============================================================================
REM Step 1: 检查环境
REM =============================================================================

echo [1/6] 检查构建环境...
echo.

REM 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js 未安装或未添加到 PATH
    echo 请从 https://nodejs.org/ 安装 Node.js
    pause
    exit /b 1
)
echo   ✓ Node.js 已安装:
node --version

REM 检查 npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm 未安装
    pause
    exit /b 1
)
echo   ✓ npm 已安装:
npm --version

REM 检查 Inno Setup
where iscc >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Inno Setup 未安装或未添加到 PATH
    echo.
    echo 请安装 Inno Setup: https://jrsoftware.org/isdl.php
    echo 或手动运行: "C:\Program Files (x86)\Inno Setup 6\iscc.exe" installer.iss
    echo.
    set SKIP_INSTALLER=1
) else (
    echo   ✓ Inno Setup 已安装
    set SKIP_INSTALLER=0
)

echo.

REM =============================================================================
REM Step 2: 安装依赖（如果需要）
REM =============================================================================

echo [2/6] 检查 Node.js 依赖...
echo.

if not exist "node_modules" (
    echo   正在安装 Node.js 依赖...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] npm install 失败
        pause
        exit /b 1
    )
) else (
    echo   ✓ 依赖已安装
)

echo.

REM =============================================================================
REM Step 3: 构建前端应用
REM =============================================================================

echo [3/6] 构建前端 Electron 应用...
echo.

echo   正在构建 Renderer (Vue3)...
call npm run build:renderer
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Renderer 构建失败
    pause
    exit /b 1
)

echo   正在构建 Main Process (Electron)...
call npm run build:main
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Main Process 构建失败
    pause
    exit /b 1
)

echo   正在打包 Electron 应用...
call npm run package
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Electron 打包失败
    pause
    exit /b 1
)

echo   ✓ 前端应用构建完成
echo.

REM =============================================================================
REM Step 4: 准备后端服务文件
REM =============================================================================

echo [4/6] 准备后端 Docker 服务配置...
echo.

set BACKEND_DIR=out\ChainlessChain-win32-x64\backend-services

REM 创建后端服务目录
if not exist "%BACKEND_DIR%" mkdir "%BACKEND_DIR%"

REM 复制 Docker Compose 配置文件
echo   复制 Docker Compose 配置...
copy "..\docker-compose.yml" "%BACKEND_DIR%\docker-compose.yml" 1>nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 无法复制 docker-compose.yml
    echo 请确保文件存在: ..\docker-compose.yml
    pause
    exit /b 1
)

REM 复制 .env 示例文件
if exist "..\.env.example" (
    copy "..\.env.example" "%BACKEND_DIR%\.env.example" 1>nul 2>&1
    echo   复制 .env.example 配置...
)

REM 创建启动脚本
echo   创建后端服务启动脚本...
(
echo @echo off
echo REM ChainlessChain 后端服务启动脚本
echo.
echo echo ====================================
echo echo   ChainlessChain 后端服务管理
echo echo ====================================
echo echo.
echo.
echo REM 检查 Docker 是否安装
echo where docker ^>nul 2^>^&1
echo if %%ERRORLEVEL%% NEQ 0 ^(
echo     echo [ERROR] Docker 未安装或未运行
echo     echo.
echo     echo ChainlessChain 后端服务需要 Docker Desktop
echo     echo 请从以下地址下载安装：
echo     echo   https://www.docker.com/products/docker-desktop
echo     echo.
echo     echo 安装完成后，请重新运行此脚本
echo     pause
echo     exit /b 1
echo ^)
echo.
echo REM 检查 Docker 是否运行
echo docker info ^>nul 2^>^&1
echo if %%ERRORLEVEL%% NEQ 0 ^(
echo     echo [WARNING] Docker Desktop 未运行
echo     echo 正在尝试启动 Docker Desktop...
echo     start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo     echo 请等待 Docker Desktop 启动完成，然后按任意键继续...
echo     pause ^>nul
echo ^)
echo.
echo echo [1] 启动后端服务
echo echo [2] 停止后端服务
echo echo [3] 查看服务状态
echo echo [4] 查看服务日志
echo echo [5] 重启服务
echo echo [0] 退出
echo echo.
echo set /p choice="请选择操作 (0-5): "
echo.
echo if "%%choice%%"=="1" goto START_SERVICES
echo if "%%choice%%"=="2" goto STOP_SERVICES
echo if "%%choice%%"=="3" goto STATUS_SERVICES
echo if "%%choice%%"=="4" goto LOGS_SERVICES
echo if "%%choice%%"=="5" goto RESTART_SERVICES
echo if "%%choice%%"=="0" exit /b 0
echo goto END
echo.
echo :START_SERVICES
echo REM 检查是否有离线 Docker 镜像需要导入
echo if exist "docker-images\import-docker-images.bat" ^(
echo     echo 检测到离线 Docker 镜像
echo     echo 首次启动需要导入镜像，这可能需要几分钟...
echo     echo.
echo     cd docker-images
echo     call import-docker-images.bat
echo     cd ..
echo     echo.
echo ^)
echo.
echo echo 正在启动后端服务...
echo docker-compose up -d
echo echo 服务已启动！
echo echo.
echo echo 服务地址：
echo echo   - Ollama LLM:        http://localhost:11434
echo echo   - Qdrant Vector DB:  http://localhost:6333
echo echo   - ChromaDB:          http://localhost:8000
echo echo   - PostgreSQL:        localhost:5432
echo echo   - Redis:             localhost:6379
echo echo   - AI Service:        http://localhost:8001
echo echo   - Project Service:   http://localhost:9090
echo echo.
echo pause
echo goto END
echo.
echo :STOP_SERVICES
echo echo 正在停止后端服务...
echo docker-compose down
echo echo 服务已停止
echo pause
echo goto END
echo.
echo :STATUS_SERVICES
echo echo 后端服务状态：
echo docker-compose ps
echo pause
echo goto END
echo.
echo :LOGS_SERVICES
echo echo 后端服务日志（按 Ctrl+C 退出）：
echo docker-compose logs -f
echo goto END
echo.
echo :RESTART_SERVICES
echo echo 正在重启后端服务...
echo docker-compose restart
echo echo 服务已重启
echo pause
echo goto END
echo.
echo :END
) > "%BACKEND_DIR%\manage-backend.bat"

REM 创建一键启动脚本（同时启动前端 + 后端）
echo   创建一键启动脚本...
(
echo @echo off
echo REM ChainlessChain 一键启动脚本
echo.
echo echo ====================================
echo echo   ChainlessChain 启动中...
echo echo ====================================
echo echo.
echo.
echo REM 1. 检查并启动后端服务
echo cd /d "%%~dp0backend-services"
echo call manage-backend.bat
echo.
echo REM 2. 启动前端应用
echo cd /d "%%~dp0"
echo start "" "chainlesschain.exe"
echo.
echo echo ChainlessChain 已启动！
echo pause
) > "out\ChainlessChain-win32-x64\start-all.bat"

echo   ✓ 后端服务配置准备完成
echo.

REM =============================================================================
REM Step 4.5: 导出 Docker 镜像（离线模式）
REM =============================================================================

if "%OFFLINE_MODE%"=="1" (
    echo [4.5/7] 导出 Docker 镜像（离线模式）...
    echo.
    echo 注意：此步骤需要 Docker Desktop 运行，且需要下载大量数据
    echo 请确保网络连接正常且有足够的磁盘空间（约 5-6GB）
    echo.

    REM 检查 Docker 是否运行
    docker info >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo [WARNING] Docker Desktop 未运行
        echo.
        set /p START_DOCKER="是否启动 Docker Desktop 并继续？(Y/N): "
        if /i "!START_DOCKER!"=="Y" (
            echo 正在启动 Docker Desktop...
            start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
            echo 请等待 Docker Desktop 启动完成，然后按任意键继续...
            pause >nul

            REM 再次检查
            docker info >nul 2>&1
            if !ERRORLEVEL! NEQ 0 (
                echo [ERROR] Docker Desktop 启动失败
                echo 将跳过离线镜像导出，生成在线安装包
                set OFFLINE_MODE=0
                goto SKIP_DOCKER_EXPORT
            )
        ) else (
            echo 跳过离线镜像导出，将生成在线安装包
            set OFFLINE_MODE=0
            goto SKIP_DOCKER_EXPORT
        )
    )

    REM 运行镜像导出脚本
    echo 正在导出 Docker 镜像...
    call export-docker-images.bat

    if !ERRORLEVEL! EQU 0 (
        REM 复制导出的镜像到打包目录
        if exist "docker-images-offline" (
            echo 复制 Docker 镜像到打包目录...
            xcopy /E /I /Y "docker-images-offline\*" "%BACKEND_DIR%\docker-images\" 1>nul 2>&1
            echo   ✓ Docker 镜像已复制
        ) else (
            echo [WARNING] Docker 镜像导出失败，将生成在线安装包
            set OFFLINE_MODE=0
        )
    ) else (
        echo [WARNING] Docker 镜像导出失败，将生成在线安装包
        set OFFLINE_MODE=0
    )

    echo.
)

:SKIP_DOCKER_EXPORT

REM =============================================================================
REM Step 5: 创建 README 和安装说明
REM =============================================================================

if "%OFFLINE_MODE%"=="1" (
    echo [5/7] 创建安装说明文档...
) else (
    echo [5/6] 创建安装说明文档...
)
echo.

(
echo ChainlessChain Windows 安装包
echo =============================
echo.
echo ## 系统要求
echo.
echo - Windows 10/11 (64-bit^)
echo - 至少 8GB RAM (推荐 16GB^)
echo - 至少 20GB 可用磁盘空间
echo - **Docker Desktop** (用于后端服务^)
echo.
echo ## 安装步骤
echo.
echo 1. 运行 `ChainlessChain-Setup-*.exe` 安装程序
echo 2. 按照安装向导完成安装
echo 3. 安装 Docker Desktop (如果尚未安装^):
echo    - 下载地址: https://www.docker.com/products/docker-desktop
echo    - 安装完成后重启计算机
echo.
echo ## 启动应用
echo.
echo ### 方式 1: 一键启动 (推荐^)
echo 双击 `start-all.bat`，将自动启动后端服务和前端应用
echo.
echo ### 方式 2: 分别启动
echo 1. 先运行 `backend-services\manage-backend.bat` 启动后端
echo 2. 再双击桌面上的 ChainlessChain 图标启动前端
echo.
echo ## 首次使用
echo.
echo 首次启动时，Docker 会自动下载所需的镜像 (约 2-3GB^)，请耐心等待。
echo.
echo 下载内容包括：
echo - Ollama (本地 LLM 服务^)
echo - Qdrant (向量数据库^)
echo - PostgreSQL (关系数据库^)
echo - Redis (缓存服务^)
echo - ChromaDB (向量数据库^)
echo.
echo ## 服务端口
echo.
echo - Ollama LLM:        http://localhost:11434
echo - Qdrant Vector DB:  http://localhost:6333
echo - ChromaDB:          http://localhost:8000
echo - PostgreSQL:        localhost:5432
echo - Redis:             localhost:6379
echo - AI Service:        http://localhost:8001
echo - Project Service:   http://localhost:9090
echo.
echo ## 常见问题
echo.
echo ### Q: 提示 "Docker 未安装或未运行"
echo A: 请安装 Docker Desktop 并确保它正在运行
echo.
echo ### Q: 启动很慢
echo A: 首次启动需要下载 Docker 镜像，后续启动会快很多
echo.
echo ### Q: 端口冲突
echo A: 请确保上述端口未被其他程序占用
echo.
echo ## 卸载
echo.
echo 1. 运行控制面板中的卸载程序
echo 2. 可选择保留或删除用户数据
echo 3. 如需完全清理，请同时运行: `docker-compose down -v`
echo.
) > "INSTALL_INFO.md"

echo   ✓ 安装说明文档已创建
echo.

REM =============================================================================
REM Step 6: 生成 Windows 安装包
REM =============================================================================

echo [6/6] 生成 Windows 安装包...
echo.

if "%SKIP_INSTALLER%"=="1" (
    echo [WARNING] 跳过安装包生成 (Inno Setup 未安装^)
    echo.
    echo 手动生成安装包：
    echo   "C:\Program Files (x86)\Inno Setup 6\iscc.exe" installer.iss
    echo.
    goto DONE
)

REM 调用 Inno Setup 编译器
echo   正在编译安装包...
iscc installer.iss

if %ERRORLEVEL% EQU 0 (
    echo.
    echo   ✓ 安装包生成成功！
    echo.
) else (
    echo.
    echo [ERROR] 安装包生成失败
    echo 请检查 installer.iss 配置文件
    pause
    exit /b 1
)

REM =============================================================================
REM 完成
REM =============================================================================

:DONE
echo.
echo ====================================================================
echo   打包完成！
echo ====================================================================
echo.
echo 输出文件：
echo.

if exist "out\installer\ChainlessChain-Setup-*.exe" (
    dir /b "out\installer\ChainlessChain-Setup-*.exe"
    echo.
    echo 完整路径：
    cd
    echo \out\installer\
    echo.
    echo 安装包大小：
    for %%F in (out\installer\ChainlessChain-Setup-*.exe) do echo   %%~zF 字节 (约 %%~zFMB MB)
    echo.
) else (
    echo   打包的应用位于: out\ChainlessChain-win32-x64\
    echo.
)

echo 注意事项：
echo   1. 用户需要先安装 Docker Desktop
echo   2. 首次启动会下载约 2-3GB 的 Docker 镜像
echo   3. 建议在安装说明中提醒用户
echo.

pause
