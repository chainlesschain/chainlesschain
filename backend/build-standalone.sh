#!/bin/bash
###############################################################################
# 后端服务独立编译脚本
###############################################################################
# 功能：将 Java 和 Python 后端服务编译为独立可执行文件
# 输出：project-service.exe, ai-service.exe
###############################################################################

set -e  # 遇到错误立即退出

echo ""
echo "===================================================================="
echo "  ChainlessChain 后端服务独立编译工具"
echo "===================================================================="
echo ""
echo "此脚本将编译后端服务为独立可执行文件"
echo "不依赖 Java 运行时或 Python 环境"
echo ""

# 创建输出目录
mkdir -p standalone

###############################################################################
# 编译选项
###############################################################################

echo "请选择编译方式："
echo "  [1] 打包 JAR + JRE（快速，体积较大约 200MB）"
echo "  [2] GraalVM Native Image（慢，体积小约 50MB，需要 GraalVM）"
echo "  [3] jpackage（推荐，体积适中约 100MB）"
echo ""
read -p "请选择 (1/2/3，默认 1): " BUILD_MODE
BUILD_MODE=${BUILD_MODE:-1}

echo ""

###############################################################################
# 编译 Project Service (Java)
###############################################################################

echo "[1/2] 编译 Project Service..."
echo ""

cd project-service

if [ "$BUILD_MODE" == "1" ]; then
    # 方式 1: 打包 JAR + 嵌入 JRE
    echo "使用方式 1: JAR + JRE 打包"
    echo ""

    # 编译 JAR
    echo "  编译 Spring Boot JAR..."
    mvn clean package -DskipTests
    if [ $? -ne 0 ]; then
        echo "[ERROR] Maven 编译失败"
        cd ..
        exit 1
    fi

    # 复制 JAR
    cp target/project-service-*.jar ../standalone/project-service.jar

    # 创建启动脚本
    echo "  创建启动包装器..."
    cat > ../standalone/project-service.sh << 'EOFSH'
#!/bin/bash
# Project Service Launcher
cd "$(dirname "$0")"

# 检查 Java
if ! command -v java &> /dev/null; then
    echo "[ERROR] Java 未安装"
    echo "请安装 Java 17+ 或使用 jpackage 版本"
    exit 1
fi

# 启动服务
java -jar project-service.jar
EOFSH
    chmod +x ../standalone/project-service.sh

    # Windows 批处理版本
    cat > ../standalone/project-service.bat << 'EOFBAT'
@echo off
REM Project Service Launcher
cd /d "%~dp0"

REM 检查 Java
where java >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Java 未安装
    echo 请安装 Java 17+ 或使用 jpackage 版本
    pause
    exit /b 1
)

REM 启动服务
java -jar project-service.jar
EOFBAT

    echo "  ✓ Project Service JAR 已创建"
    echo "  注意: 需要 Java 17+ 运行时"

elif [ "$BUILD_MODE" == "2" ]; then
    # 方式 2: GraalVM Native Image
    echo "使用方式 2: GraalVM Native Image"
    echo ""

    # 检查 GraalVM
    if ! command -v native-image &> /dev/null; then
        echo "[ERROR] GraalVM native-image 未安装"
        echo ""
        echo "请安装 GraalVM 并运行:"
        echo "  gu install native-image"
        echo ""
        cd ..
        exit 1
    fi

    # 编译 JAR
    echo "  编译 Spring Boot JAR..."
    mvn clean package -DskipTests -Pnative
    if [ $? -ne 0 ]; then
        echo "[ERROR] Maven 编译失败"
        cd ..
        exit 1
    fi

    # 生成 Native Image
    echo "  生成 Native Image（这可能需要几分钟）..."
    native-image -jar target/project-service-*.jar ../standalone/project-service
    if [ $? -ne 0 ]; then
        echo "[ERROR] Native Image 生成失败"
        cd ..
        exit 1
    fi

    echo "  ✓ Project Service 原生可执行文件已创建"
    echo "  文件大小: 约 50MB"

elif [ "$BUILD_MODE" == "3" ]; then
    # 方式 3: jpackage
    echo "使用方式 3: jpackage"
    echo ""

    # 检查 jpackage (JDK 14+)
    if ! command -v jpackage &> /dev/null; then
        echo "[ERROR] jpackage 未找到"
        echo "请确保使用 JDK 14+ 并添加到 PATH"
        cd ..
        exit 1
    fi

    # 编译 JAR
    echo "  编译 Spring Boot JAR..."
    mvn clean package -DskipTests
    if [ $? -ne 0 ]; then
        echo "[ERROR] Maven 编译失败"
        cd ..
        exit 1
    fi

    # 使用 jpackage 打包
    echo "  使用 jpackage 打包（这可能需要几分钟）..."
    jpackage \
        --input target \
        --name project-service \
        --main-jar project-service-*.jar \
        --type app-image \
        --dest ../standalone/project-service-dist \
        --app-version 1.0.0 \
        --vendor "ChainlessChain Team"

    if [ $? -eq 0 ]; then
        # 创建简化的启动脚本
        if [ -f "../standalone/project-service-dist/project-service/bin/project-service" ]; then
            cp ../standalone/project-service-dist/project-service/bin/project-service ../standalone/project-service
            chmod +x ../standalone/project-service
        fi
        if [ -f "../standalone/project-service-dist/project-service/project-service.exe" ]; then
            cp ../standalone/project-service-dist/project-service/project-service.exe ../standalone/project-service.exe
        fi
        echo "  ✓ Project Service 可执行文件已创建"
        echo "  文件大小: 约 100MB"
    else
        echo "[ERROR] jpackage 打包失败"
        cd ..
        exit 1
    fi
fi

# 复制配置文件
cp src/main/resources/application.yml ../standalone/application.yml 2>/dev/null || true

cd ..
echo ""

###############################################################################
# 编译 AI Service (Python)
###############################################################################

echo "[2/2] 编译 AI Service..."
echo ""

cd ai-service

# 检查 Python
if ! command -v python &> /dev/null && ! command -v python3 &> /dev/null; then
    echo "[WARNING] Python 未安装，跳过 AI Service 编译"
    echo "请安装 Python 3.11+ 后重新运行"
    cd ..
    exit 0
fi

PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    PYTHON_CMD="python"
fi

echo "  检查 PyInstaller..."
$PYTHON_CMD -m pip show pyinstaller &> /dev/null
if [ $? -ne 0 ]; then
    echo "  安装 PyInstaller..."
    $PYTHON_CMD -m pip install pyinstaller
fi

echo "  使用 PyInstaller 编译..."
echo "  （这可能需要几分钟，首次编译会更慢）"
echo ""

# 使用 PyInstaller 打包
$PYTHON_CMD -m PyInstaller \
    --name ai-service \
    --onefile \
    --add-data "config.py:." \
    --hidden-import fastapi \
    --hidden-import uvicorn \
    --hidden-import ollama \
    --hidden-import qdrant_client \
    main.py

if [ $? -eq 0 ]; then
    # 复制可执行文件
    if [ -f "dist/ai-service" ]; then
        cp dist/ai-service ../standalone/ai-service
        chmod +x ../standalone/ai-service
    fi
    if [ -f "dist/ai-service.exe" ]; then
        cp dist/ai-service.exe ../standalone/ai-service.exe
    fi
    echo "  ✓ AI Service 可执行文件已创建"
    echo "  文件大小: 约 30-50MB"
else
    echo "[ERROR] PyInstaller 编译失败"
    cd ..
    exit 1
fi

# 复制配置文件
cp config.py ../standalone/config.yml 2>/dev/null || true

cd ..

###############################################################################
# 完成
###############################################################################

echo ""
echo "===================================================================="
echo "  编译完成！"
echo "===================================================================="
echo ""
echo "输出目录: standalone/"
echo ""
echo "生成的文件："
ls -lh standalone/*.{exe,jar,sh} 2>/dev/null || ls -lh standalone/ | grep -E '\.(exe|jar|sh)$'
echo ""

if [ "$BUILD_MODE" == "1" ]; then
    echo "注意：JAR 版本需要 Java 17+ 运行时"
    echo "建议使用 project-service.sh 或 project-service.bat 启动"
else
    echo "这些文件可以在没有 Java/Python 环境的机器上运行"
fi

echo ""
echo "下一步:"
echo "  1. 测试服务是否能正常启动"
echo "  2. 运行 desktop-app-vue/build-windows-package-standalone.sh"
echo "  3. 选择模式 [2] 前端 + 便携后端"
echo ""

read -p "按 Enter 退出..."
