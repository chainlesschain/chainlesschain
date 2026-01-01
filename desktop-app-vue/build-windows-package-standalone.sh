#!/bin/bash
###############################################################################
# ChainlessChain 独立打包脚本 - 无 Docker 版本
###############################################################################
# 功能：
# 1. 构建前端 Electron 应用
# 2. 可选打包独立后端服务（Java/Python 编译版）
# 3. 生成不依赖 Docker 的 Windows 安装包
###############################################################################

set -e  # 遇到错误立即退出

echo ""
echo "===================================================================="
echo "  ChainlessChain 独立版打包工具（无 Docker）"
echo "===================================================================="
echo ""
echo "此脚本将打包以下内容："
echo "  - 前端 Electron 应用 (Vue3 + Electron)"
echo "  - 可选：独立后端服务（编译版）"
echo "  - 本地数据库（SQLite）"
echo ""
echo "注意：此版本不依赖 Docker，适合："
echo "  - 纯本地使用（所有数据存储在本地）"
echo "  - 后端服务已单独部署"
echo "  - 轻量级部署需求"
echo ""

###############################################################################
# 选择打包模式
###############################################################################

echo "打包模式选择："
echo "  [1] 仅前端应用 - 最轻量，不包含任何后端服务"
echo "  [2] 前端 + 便携后端 - 包含编译后的后端服务（需要先构建）"
echo "  [3] 前端 + 云端后端配置 - 连接到云端/远程后端服务"
echo ""
read -p "请选择模式 (1/2/3，默认 1): " PACKAGE_MODE
PACKAGE_MODE=${PACKAGE_MODE:-1}

if [ "$PACKAGE_MODE" == "1" ]; then
    echo ""
    echo "已选择: 仅前端应用"
    echo "后端功能需要用户自行配置连接地址"
    INCLUDE_BACKEND=0
    CLOUD_MODE=0
elif [ "$PACKAGE_MODE" == "2" ]; then
    echo ""
    echo "已选择: 前端 + 便携后端"
    echo "将包含独立编译的后端服务"
    INCLUDE_BACKEND=1
    CLOUD_MODE=0
elif [ "$PACKAGE_MODE" == "3" ]; then
    echo ""
    echo "已选择: 前端 + 云端后端配置"
    echo "将包含云端服务配置模板"
    INCLUDE_BACKEND=0
    CLOUD_MODE=1
else
    echo ""
    echo "[ERROR] 无效的选择，使用默认模式（仅前端）"
    PACKAGE_MODE=1
    INCLUDE_BACKEND=0
    CLOUD_MODE=0
fi
echo ""

###############################################################################
# Step 1: 检查环境
###############################################################################

echo "[1/5] 检查构建环境..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js 未安装或未添加到 PATH"
    echo "请从 https://nodejs.org/ 安装 Node.js"
    exit 1
fi
echo "  ✓ Node.js 已安装:"
node --version

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm 未安装"
    exit 1
fi
echo "  ✓ npm 已安装:"
npm --version

# 检查 Inno Setup (Windows only)
if command -v iscc &> /dev/null || [ -f "/c/Program Files (x86)/Inno Setup 6/iscc.exe" ]; then
    echo "  ✓ Inno Setup 已安装"
    SKIP_INSTALLER=0
else
    echo "[WARNING] Inno Setup 未安装或未添加到 PATH"
    echo ""
    echo "请安装 Inno Setup: https://jrsoftware.org/isdl.php"
    echo "或手动运行: \"/c/Program Files (x86)/Inno Setup 6/iscc.exe\" installer-standalone.iss"
    echo ""
    SKIP_INSTALLER=1
fi

echo ""

###############################################################################
# Step 2: 安装依赖（如果需要）
###############################################################################

echo "[2/5] 检查 Node.js 依赖..."
echo ""

if [ ! -d "node_modules" ]; then
    echo "  正在安装 Node.js 依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] npm install 失败"
        exit 1
    fi
else
    echo "  ✓ 依赖已安装"
fi

echo ""

###############################################################################
# Step 3: 构建前端应用
###############################################################################

echo "[3/5] 构建前端 Electron 应用..."
echo ""

echo "  正在构建 Renderer (Vue3)..."
npm run build:renderer
if [ $? -ne 0 ]; then
    echo "[ERROR] Renderer 构建失败"
    exit 1
fi

echo "  正在构建 Main Process (Electron)..."
npm run build:main
if [ $? -ne 0 ]; then
    echo "[ERROR] Main Process 构建失败"
    exit 1
fi

echo "  正在打包 Electron 应用..."
npm run package
if [ $? -ne 0 ]; then
    echo "[ERROR] Electron 打包失败"
    exit 1
fi

echo "  ✓ 前端应用构建完成"
echo ""

###############################################################################
# Step 4: 准备独立后端服务（可选）
###############################################################################

if [ "$INCLUDE_BACKEND" == "1" ]; then
    echo "[4/5] 准备独立后端服务..."
    echo ""

    BACKEND_DIR="out/ChainlessChain-win32-x64/backend-standalone"

    # 创建后端服务目录
    mkdir -p "$BACKEND_DIR"

    # 检查编译后的后端服务
    if [ -f "../backend/standalone/project-service.exe" ] || [ -f "../backend/standalone/project-service.bat" ]; then
        echo "  复制 Project Service..."
        cp -r ../backend/standalone/* "$BACKEND_DIR/" 2>/dev/null || true
    else
        echo "[WARNING] Project Service 可执行文件不存在"
        echo "请先构建后端服务: cd ../backend && ./build-standalone.sh"
    fi

    # 创建后端服务管理脚本
    echo "  创建后端服务管理脚本..."
    cat > "$BACKEND_DIR/manage-backend.sh" << 'EOF'
#!/bin/bash
# ChainlessChain 独立后端服务管理

echo "===================================="
echo "  ChainlessChain 后端服务管理"
echo "===================================="
echo ""

echo "[1] 启动所有后端服务"
echo "[2] 停止所有后端服务"
echo "[3] 重启所有后端服务"
echo "[4] 查看服务状态"
echo "[0] 退出"
echo ""
read -p "请选择操作 (0-4): " choice

case $choice in
    1)
        echo "正在启动后端服务..."
        echo ""
        if [ -f "project-service.exe" ]; then
            echo "启动 Project Service..."
            ./project-service.exe &
        fi

        if [ -f "ai-service.exe" ]; then
            echo "启动 AI Service..."
            ./ai-service.exe &
        fi

        echo "后端服务已启动！"
        echo ""
        echo "服务地址："
        echo "  - Project Service:  http://localhost:9090"
        echo "  - AI Service:       http://localhost:8001"
        echo ""
        read -p "按 Enter 继续..."
        ;;
    2)
        echo "正在停止后端服务..."
        pkill -f project-service.exe
        pkill -f ai-service.exe
        echo "后端服务已停止"
        read -p "按 Enter 继续..."
        ;;
    3)
        echo "正在重启后端服务..."
        pkill -f project-service.exe
        pkill -f ai-service.exe
        sleep 2
        if [ -f "project-service.exe" ]; then
            ./project-service.exe &
        fi
        if [ -f "ai-service.exe" ]; then
            ./ai-service.exe &
        fi
        echo "后端服务已重启"
        read -p "按 Enter 继续..."
        ;;
    4)
        echo "后端服务状态："
        echo ""
        if pgrep -f project-service.exe > /dev/null; then
            echo "  ✓ Project Service 运行中"
        else
            echo "  ✗ Project Service 未运行"
        fi

        if pgrep -f ai-service.exe > /dev/null; then
            echo "  ✓ AI Service 运行中"
        else
            echo "  ✗ AI Service 未运行"
        fi
        echo ""
        read -p "按 Enter 继续..."
        ;;
    0)
        exit 0
        ;;
esac
EOF
    chmod +x "$BACKEND_DIR/manage-backend.sh"

    # 创建 Windows 批处理版本
    cat > "$BACKEND_DIR/manage-backend.bat" << 'EOF'
@echo off
REM ChainlessChain 独立后端服务管理
echo ====================================
echo   ChainlessChain 后端服务管理
echo ====================================
echo.
echo [1] 启动所有后端服务
echo [2] 停止所有后端服务
echo [3] 重启所有后端服务
echo [4] 查看服务状态
echo [0] 退出
echo.
set /p choice="请选择操作 (0-4): "

if "%choice%"=="1" goto START_SERVICES
if "%choice%"=="2" goto STOP_SERVICES
if "%choice%"=="3" goto RESTART_SERVICES
if "%choice%"=="4" goto STATUS_SERVICES
if "%choice%"=="0" exit /b 0
goto END

:START_SERVICES
echo 正在启动后端服务...
if exist "project-service.exe" (
    echo 启动 Project Service...
    start "Project Service" project-service.exe
)
if exist "ai-service.exe" (
    echo 启动 AI Service...
    start "AI Service" ai-service.exe
)
echo 后端服务已启动！
echo.
echo 服务地址：
echo   - Project Service:  http://localhost:9090
echo   - AI Service:       http://localhost:8001
pause
goto END

:STOP_SERVICES
echo 正在停止后端服务...
taskkill /F /IM project-service.exe /T >nul 2>&1
taskkill /F /IM ai-service.exe /T >nul 2>&1
echo 后端服务已停止
pause
goto END

:RESTART_SERVICES
call :STOP_SERVICES
timeout /t 2 /nobreak >nul
call :START_SERVICES
goto END

:STATUS_SERVICES
echo 后端服务状态：
tasklist /FI "IMAGENAME eq project-service.exe" 2>nul | find /I "project-service.exe" >nul
if %ERRORLEVEL% EQU 0 (
    echo   ✓ Project Service 运行中
) else (
    echo   ✗ Project Service 未运行
)
tasklist /FI "IMAGENAME eq ai-service.exe" 2>nul | find /I "ai-service.exe" >nul
if %ERRORLEVEL% EQU 0 (
    echo   ✓ AI Service 运行中
) else (
    echo   ✗ AI Service 未运行
)
pause
goto END

:END
EOF

    echo "  ✓ 独立后端服务准备完成"
    echo ""
elif [ "$CLOUD_MODE" == "1" ]; then
    echo "[4/5] 准备云端后端配置..."
    echo ""

    CONFIG_DIR="out/ChainlessChain-win32-x64/backend-config"
    mkdir -p "$CONFIG_DIR"

    # 创建云端后端配置模板
    cat > "$CONFIG_DIR/backend-config.env" << 'EOF'
# ChainlessChain 云端后端配置
# 请根据实际情况修改以下配置

# Project Service 地址
PROJECT_SERVICE_URL=https://your-server.com/api
PROJECT_SERVICE_PORT=9090

# AI Service 地址
AI_SERVICE_URL=https://your-ai-server.com/api
AI_SERVICE_PORT=8001

# LLM 配置（云端）
LLM_PROVIDER=openai  # openai, azure, qwen, glm, etc.
LLM_API_KEY=your_api_key_here
LLM_MODEL=gpt-3.5-turbo

# 向量数据库配置（云端）
VECTOR_DB_URL=https://your-vector-db.com
VECTOR_DB_API_KEY=your_vector_db_key

# 数据库配置（云端）
DB_HOST=your-db-server.com
DB_PORT=5432
DB_NAME=chainlesschain
DB_USER=your_db_user
DB_PASSWORD=your_db_password

# Redis 配置（云端）
REDIS_HOST=your-redis-server.com
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
EOF

    # 创建配置说明
    cat > "$CONFIG_DIR/README.md" << 'EOF'
# 云端后端配置说明

## 配置步骤

1. 编辑 `backend-config.env` 文件
2. 填入您的后端服务地址和凭证
3. 重启 ChainlessChain 应用

## 支持的 LLM 提供商

- OpenAI (GPT-3.5/GPT-4)
- Azure OpenAI
- Alibaba Qwen (通义千问)
- Zhipu GLM (智谱清言)
- Baidu Qianfan (百度千帆)
- 更多...

## 安全建议

- 不要将 API Key 提交到版本控制系统
- 定期更换密码和密钥
- 使用 HTTPS 连接
EOF

    echo "  ✓ 云端后端配置准备完成"
    echo ""
else
    echo "[4/5] 跳过后端服务准备..."
    echo ""
    echo "  仅前端模式，不包含后端服务"
    echo ""
fi

###############################################################################
# Step 5: 创建安装说明
###############################################################################

echo "[5/5] 创建安装说明文档..."
echo ""

if [ "$INCLUDE_BACKEND" == "1" ]; then
    MODE_TEXT="独立版（包含后端服务）"
    REQUIREMENTS="- Windows 10/11 (64-bit)
- 至少 4GB RAM
- 至少 2GB 可用磁盘空间"
elif [ "$CLOUD_MODE" == "1" ]; then
    MODE_TEXT="云端版（连接远程后端）"
    REQUIREMENTS="- Windows 10/11 (64-bit)
- 至少 2GB RAM
- 稳定的网络连接
- 云端后端服务地址"
else
    MODE_TEXT="前端版（需自行配置后端）"
    REQUIREMENTS="- Windows 10/11 (64-bit)
- 至少 2GB RAM
- 后端服务地址（需单独部署）"
fi

cat > "INSTALL_INFO_STANDALONE.md" << EOF
ChainlessChain Windows 独立安装包 - ${MODE_TEXT}
=============================

## 系统要求

${REQUIREMENTS}

## 安装步骤

1. 运行 \`ChainlessChain-Standalone-Setup-*.exe\` 安装程序
2. 按照安装向导完成安装
3. 配置后端服务（根据您选择的模式）
EOF

echo "  ✓ 安装说明文档已创建"
echo ""

###############################################################################
# Step 6: 生成 Windows 安装包
###############################################################################

echo "[6/6] 生成 Windows 安装包..."
echo ""

if [ "$SKIP_INSTALLER" == "1" ]; then
    echo "[WARNING] 跳过安装包生成 (Inno Setup 未安装)"
    echo ""
    echo "手动生成安装包："
    echo "  \"/c/Program Files (x86)/Inno Setup 6/iscc.exe\" installer-standalone.iss"
    echo ""
else
    # 调用 Inno Setup 编译器
    echo "  正在编译安装包..."

    if command -v iscc &> /dev/null; then
        iscc installer-standalone.iss
    elif [ -f "/c/Program Files (x86)/Inno Setup 6/iscc.exe" ]; then
        "/c/Program Files (x86)/Inno Setup 6/iscc.exe" installer-standalone.iss
    else
        echo "[ERROR] 找不到 Inno Setup 编译器"
        exit 1
    fi

    if [ $? -eq 0 ]; then
        echo ""
        echo "  ✓ 安装包生成成功！"
        echo ""
    else
        echo ""
        echo "[ERROR] 安装包生成失败"
        echo "请检查 installer-standalone.iss 配置文件"
        exit 1
    fi
fi

###############################################################################
# 完成
###############################################################################

echo ""
echo "===================================================================="
echo "  打包完成！"
echo "===================================================================="
echo ""
echo "打包模式: ${MODE_TEXT}"
echo ""
echo "输出文件："
echo ""

if [ -f "out/installer/ChainlessChain-Standalone-Setup-"*.exe ]; then
    ls -lh out/installer/ChainlessChain-Standalone-Setup-*.exe | awk '{print $9, "(" $5 ")"}'
    echo ""
    echo "完整路径："
    pwd
    echo "/out/installer/"
    echo ""
else
    echo "  打包的应用位于: out/ChainlessChain-win32-x64/"
    echo ""
fi

echo "使用说明:"
if [ "$INCLUDE_BACKEND" == "1" ]; then
    echo "  - 包含独立后端服务，无需 Docker"
    echo "  - 所有服务运行在本地"
    echo "  - 数据存储在本地 SQLite 数据库"
elif [ "$CLOUD_MODE" == "1" ]; then
    echo "  - 需要配置云端后端服务地址"
    echo "  - 编辑 backend-config/backend-config.env"
    echo "  - 需要有效的 API 密钥"
else
    echo "  - 仅包含前端应用"
    echo "  - 需要单独部署后端服务"
    echo "  - 在应用设置中配置后端地址"
fi
echo ""

read -p "按 Enter 退出..."
