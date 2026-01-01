@echo off
REM =============================================================================
REM ChainlessChain 独立打包脚本 - 无 Docker 版本
REM =============================================================================
REM 功能：
REM 1. 构建前端 Electron 应用
REM 2. 可选打包独立后端服务（Java/Python 编译版）
REM 3. 生成不依赖 Docker 的 Windows 安装包
REM =============================================================================

setlocal enabledelayedexpansion

echo.
echo ====================================================================
echo   ChainlessChain 独立版打包工具（无 Docker）
echo ====================================================================
echo.
echo 此脚本将打包以下内容：
echo   - 前端 Electron 应用 (Vue3 + Electron)
echo   - 可选：独立后端服务（编译版）
echo   - 本地数据库（SQLite）
echo.
echo 注意：此版本不依赖 Docker，适合：
echo   - 纯本地使用（所有数据存储在本地）
echo   - 后端服务已单独部署
echo   - 轻量级部署需求
echo.

REM =============================================================================
REM 选择打包模式
REM =============================================================================

echo 打包模式选择：
echo   [1] 仅前端应用 - 最轻量，不包含任何后端服务
echo   [2] 前端 + 便携后端 - 包含编译后的后端服务（需要先构建）
echo   [3] 前端 + 云端后端配置 - 连接到云端/远程后端服务
echo.
set /p PACKAGE_MODE="请选择模式 (1/2/3，默认 1): "
if "%PACKAGE_MODE%"=="" set PACKAGE_MODE=1

if "%PACKAGE_MODE%"=="1" (
    echo.
    echo 已选择: 仅前端应用
    echo 后端功能需要用户自行配置连接地址
    set INCLUDE_BACKEND=0
    set CLOUD_MODE=0
) else if "%PACKAGE_MODE%"=="2" (
    echo.
    echo 已选择: 前端 + 便携后端
    echo 将包含独立编译的后端服务
    set INCLUDE_BACKEND=1
    set CLOUD_MODE=0
) else if "%PACKAGE_MODE%"=="3" (
    echo.
    echo 已选择: 前端 + 云端后端配置
    echo 将包含云端服务配置模板
    set INCLUDE_BACKEND=0
    set CLOUD_MODE=1
) else (
    echo.
    echo [ERROR] 无效的选择，使用默认模式（仅前端）
    set PACKAGE_MODE=1
    set INCLUDE_BACKEND=0
    set CLOUD_MODE=0
)
echo.

REM =============================================================================
REM Step 1: 检查环境
REM =============================================================================

echo [1/5] 检查构建环境...
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
    echo 或手动运行: "C:\Program Files (x86)\Inno Setup 6\iscc.exe" installer-standalone.iss
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

echo [2/5] 检查 Node.js 依赖...
echo.

if not exist "node_modules" (
    echo   正在安装 Node.js 依赖...
    call npm install
    if !ERRORLEVEL! NEQ 0 (
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

echo [3/5] 构建前端 Electron 应用...
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
REM Step 4: 准备独立后端服务（可选）
REM =============================================================================

if "%INCLUDE_BACKEND%"=="1" (
    echo [4/5] 准备独立后端服务...
    echo.

    set BACKEND_DIR=out\ChainlessChain-win32-x64\backend-standalone

    REM 创建后端服务目录
    if not exist "%BACKEND_DIR%" mkdir "%BACKEND_DIR%"

    REM 检查编译后的后端服务
    if exist "..\backend\standalone\project-service.exe" (
        echo   复制 Project Service...
        copy "..\backend\standalone\project-service.exe" "%BACKEND_DIR%\" 1>nul 2>&1
        copy "..\backend\standalone\application.yml" "%BACKEND_DIR%\" 1>nul 2>&1
    ) else (
        echo [WARNING] Project Service 可执行文件不存在
        echo 请先构建后端服务: cd ..\backend && build-standalone.bat
    )

    if exist "..\backend\standalone\ai-service.exe" (
        echo   复制 AI Service...
        copy "..\backend\standalone\ai-service.exe" "%BACKEND_DIR%\" 1>nul 2>&1
        copy "..\backend\standalone\config.yml" "%BACKEND_DIR%\" 1>nul 2>&1
    ) else (
        echo [WARNING] AI Service 可执行文件不存在
        echo 请先构建后端服务: cd ..\backend && build-standalone.bat
    )

    REM 创建后端服务管理脚本
    echo   创建后端服务管理脚本...
    (
    echo @echo off
    echo REM ChainlessChain 独立后端服务管理
    echo.
    echo echo ====================================
    echo echo   ChainlessChain 后端服务管理
    echo echo ====================================
    echo echo.
    echo.
    echo echo [1] 启动所有后端服务
    echo echo [2] 停止所有后端服务
    echo echo [3] 重启所有后端服务
    echo echo [4] 查看服务状态
    echo echo [0] 退出
    echo echo.
    echo set /p choice="请选择操作 (0-4): "
    echo.
    echo if "%%choice%%"=="1" goto START_SERVICES
    echo if "%%choice%%"=="2" goto STOP_SERVICES
    echo if "%%choice%%"=="3" goto RESTART_SERVICES
    echo if "%%choice%%"=="4" goto STATUS_SERVICES
    echo if "%%choice%%"=="0" exit /b 0
    echo goto END
    echo.
    echo :START_SERVICES
    echo echo 正在启动后端服务...
    echo.
    echo if exist "project-service.exe" ^(
    echo     echo 启动 Project Service...
    echo     start "Project Service" project-service.exe
    echo ^)
    echo.
    echo if exist "ai-service.exe" ^(
    echo     echo 启动 AI Service...
    echo     start "AI Service" ai-service.exe
    echo ^)
    echo.
    echo echo 后端服务已启动！
    echo echo.
    echo echo 服务地址：
    echo echo   - Project Service:  http://localhost:9090
    echo echo   - AI Service:       http://localhost:8001
    echo echo.
    echo pause
    echo goto END
    echo.
    echo :STOP_SERVICES
    echo echo 正在停止后端服务...
    echo taskkill /F /IM project-service.exe /T ^>nul 2^>^&1
    echo taskkill /F /IM ai-service.exe /T ^>nul 2^>^&1
    echo echo 后端服务已停止
    echo pause
    echo goto END
    echo.
    echo :RESTART_SERVICES
    echo call :STOP_SERVICES
    echo timeout /t 2 /nobreak ^>nul
    echo call :START_SERVICES
    echo goto END
    echo.
    echo :STATUS_SERVICES
    echo echo 后端服务状态：
    echo echo.
    echo tasklist /FI "IMAGENAME eq project-service.exe" 2^>nul ^| find /I "project-service.exe" ^>nul
    echo if %%ERRORLEVEL%% EQU 0 ^(
    echo     echo   ✓ Project Service 运行中
    echo ^) else ^(
    echo     echo   ✗ Project Service 未运行
    echo ^)
    echo.
    echo tasklist /FI "IMAGENAME eq ai-service.exe" 2^>nul ^| find /I "ai-service.exe" ^>nul
    echo if %%ERRORLEVEL%% EQU 0 ^(
    echo     echo   ✓ AI Service 运行中
    echo ^) else ^(
    echo     echo   ✗ AI Service 未运行
    echo ^)
    echo echo.
    echo pause
    echo goto END
    echo.
    echo :END
    ) > "%BACKEND_DIR%\manage-backend.bat"

    echo   ✓ 独立后端服务准备完成
    echo.
) else if "%CLOUD_MODE%"=="1" (
    echo [4/5] 准备云端后端配置...
    echo.

    set CONFIG_DIR=out\ChainlessChain-win32-x64\backend-config

    REM 创建配置目录
    if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

    REM 创建云端后端配置模板
    (
    echo # ChainlessChain 云端后端配置
    echo # 请根据实际情况修改以下配置
    echo.
    echo # Project Service 地址
    echo PROJECT_SERVICE_URL=https://your-server.com/api
    echo PROJECT_SERVICE_PORT=9090
    echo.
    echo # AI Service 地址
    echo AI_SERVICE_URL=https://your-ai-server.com/api
    echo AI_SERVICE_PORT=8001
    echo.
    echo # LLM 配置（云端）
    echo LLM_PROVIDER=openai  # openai, azure, qwen, glm, etc.
    echo LLM_API_KEY=your_api_key_here
    echo LLM_MODEL=gpt-3.5-turbo
    echo.
    echo # 向量数据库配置（云端）
    echo VECTOR_DB_URL=https://your-vector-db.com
    echo VECTOR_DB_API_KEY=your_vector_db_key
    echo.
    echo # 数据库配置（云端）
    echo DB_HOST=your-db-server.com
    echo DB_PORT=5432
    echo DB_NAME=chainlesschain
    echo DB_USER=your_db_user
    echo DB_PASSWORD=your_db_password
    echo.
    echo # Redis 配置（云端）
    echo REDIS_HOST=your-redis-server.com
    echo REDIS_PORT=6379
    echo REDIS_PASSWORD=your_redis_password
    ) > "%CONFIG_DIR%\backend-config.env"

    REM 创建配置说明
    (
    echo # 云端后端配置说明
    echo.
    echo ## 配置步骤
    echo.
    echo 1. 编辑 `backend-config.env` 文件
    echo 2. 填入您的后端服务地址和凭证
    echo 3. 重启 ChainlessChain 应用
    echo.
    echo ## 支持的 LLM 提供商
    echo.
    echo - OpenAI (GPT-3.5/GPT-4^)
    echo - Azure OpenAI
    echo - Alibaba Qwen (通义千问^)
    echo - Zhipu GLM (智谱清言^)
    echo - Baidu Qianfan (百度千帆^)
    echo - 更多...
    echo.
    echo ## 安全建议
    echo.
    echo - 不要将 API Key 提交到版本控制系统
    echo - 定期更换密码和密钥
    echo - 使用 HTTPS 连接
    echo.
    ) > "%CONFIG_DIR%\README.md"

    echo   ✓ 云端后端配置准备完成
    echo.
) else (
    echo [4/5] 跳过后端服务准备...
    echo.
    echo   仅前端模式，不包含后端服务
    echo.
)

REM =============================================================================
REM Step 5: 创建安装说明
REM =============================================================================

echo [5/5] 创建安装说明文档...
echo.

if "%INCLUDE_BACKEND%"=="1" (
    set MODE_TEXT=独立版（包含后端服务）
    set REQUIREMENTS=- Windows 10/11 (64-bit^)^
- 至少 4GB RAM^
- 至少 2GB 可用磁盘空间
) else if "%CLOUD_MODE%"=="1" (
    set MODE_TEXT=云端版（连接远程后端）
    set REQUIREMENTS=- Windows 10/11 (64-bit^)^
- 至少 2GB RAM^
- 稳定的网络连接^
- 云端后端服务地址
) else (
    set MODE_TEXT=前端版（需自行配置后端）
    set REQUIREMENTS=- Windows 10/11 (64-bit^)^
- 至少 2GB RAM^
- 后端服务地址（需单独部署）
)

(
echo ChainlessChain Windows 独立安装包 - %MODE_TEXT%
echo =============================
echo.
echo ## 系统要求
echo.
echo %REQUIREMENTS%
echo.
echo ## 安装步骤
echo.
echo 1. 运行 `ChainlessChain-Standalone-Setup-*.exe` 安装程序
echo 2. 按照安装向导完成安装
echo 3. 配置后端服务（根据您选择的模式）
echo.
) > "INSTALL_INFO_STANDALONE.md"

if "%INCLUDE_BACKEND%"=="1" (
    (
    echo ## 启动应用（独立版）
    echo.
    echo ### 方式 1: 自动启动（推荐）
    echo 双击桌面上的 "ChainlessChain" 图标
    echo 后端服务会自动在后台启动
    echo.
    echo ### 方式 2: 手动管理
    echo 1. 运行 `backend-standalone\manage-backend.bat` 启动后端
    echo 2. 双击 "ChainlessChain" 图标启动前端
    echo.
    echo ## 服务地址
    echo.
    echo - Project Service:  http://localhost:9090
    echo - AI Service:       http://localhost:8001
    echo.
    echo ## 数据存储
    echo.
    echo 所有数据存储在本地：
    echo - 用户数据: %%APPDATA%%\chainlesschain-desktop-vue\data
    echo - 数据库: SQLite（本地文件）
    echo - 日志: %%APPDATA%%\chainlesschain-desktop-vue\logs
    echo.
    ) >> "INSTALL_INFO_STANDALONE.md"
) else if "%CLOUD_MODE%"=="1" (
    (
    echo ## 配置云端后端
    echo.
    echo 1. 找到安装目录下的 `backend-config` 文件夹
    echo 2. 编辑 `backend-config.env` 文件
    echo 3. 填入您的后端服务地址和 API 密钥
    echo 4. 保存并重启应用
    echo.
    echo ## 配置示例
    echo.
    echo ```env
    echo PROJECT_SERVICE_URL=https://api.chainlesschain.com
    echo AI_SERVICE_URL=https://ai.chainlesschain.com
    echo LLM_PROVIDER=openai
    echo LLM_API_KEY=sk-xxxxxxxxxxxxx
    echo ```
    echo.
    echo ## 注意事项
    echo.
    echo - 确保网络连接稳定
    echo - 妥善保管 API 密钥
    echo - 定期检查服务状态
    echo.
    ) >> "INSTALL_INFO_STANDALONE.md"
) else (
    (
    echo ## 配置后端服务
    echo.
    echo 此版本仅包含前端应用，您需要：
    echo.
    echo 1. 单独部署后端服务（Docker 或独立部署）
    echo 2. 在应用设置中配置后端服务地址
    echo 3. 重启应用以应用配置
    echo.
    echo ## 后端部署选项
    echo.
    echo ### 选项 1: Docker 部署
    echo ```bash
    echo cd backend
    echo docker-compose up -d
    echo ```
    echo.
    echo ### 选项 2: 独立部署
    echo 参考 `backend/README.md` 中的部署说明
    echo.
    echo ### 选项 3: 云端服务
    echo 使用云端托管的后端服务
    echo.
    ) >> "INSTALL_INFO_STANDALONE.md"
)

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
    echo   "C:\Program Files (x86)\Inno Setup 6\iscc.exe" installer-standalone.iss
    echo.
    goto DONE
)

REM 调用 Inno Setup 编译器
echo   正在编译安装包...
iscc installer-standalone.iss

if %ERRORLEVEL% EQU 0 (
    echo.
    echo   ✓ 安装包生成成功！
    echo.
) else (
    echo.
    echo [ERROR] 安装包生成失败
    echo 请检查 installer-standalone.iss 配置文件
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
echo 打包模式: %MODE_TEXT%
echo.
echo 输出文件：
echo.

if exist "out\installer\ChainlessChain-Standalone-Setup-*.exe" (
    dir /b "out\installer\ChainlessChain-Standalone-Setup-*.exe"
    echo.
    echo 完整路径：
    cd
    echo \out\installer\
    echo.
    for %%F in (out\installer\ChainlessChain-Standalone-Setup-*.exe) do (
        set SIZE=%%~zF
        set /a SIZE_MB=!SIZE! / 1048576
        echo 安装包大小: !SIZE_MB! MB
    )
    echo.
) else (
    echo   打包的应用位于: out\ChainlessChain-win32-x64\
    echo.
)

echo 使用说明:
if "%INCLUDE_BACKEND%"=="1" (
    echo   - 包含独立后端服务，无需 Docker
    echo   - 所有服务运行在本地
    echo   - 数据存储在本地 SQLite 数据库
) else if "%CLOUD_MODE%"=="1" (
    echo   - 需要配置云端后端服务地址
    echo   - 编辑 backend-config/backend-config.env
    echo   - 需要有效的 API 密钥
) else (
    echo   - 仅包含前端应用
    echo   - 需要单独部署后端服务
    echo   - 在应用设置中配置后端地址
)
echo.

pause
