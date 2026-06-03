#!/bin/bash

# Whisper 模型切换工具

set -e

echo "=== Whisper 模型切换工具 ==="
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 配置
WHISPER_URL="${WHISPER_LOCAL_URL:-http://localhost:8002}"

# 检查服务状态
check_service() {
    echo "检查 Whisper 服务状态..."
    if curl -s -f "$WHISPER_URL/health" > /dev/null; then
        echo -e "${GREEN}✓ 服务运行正常${NC}"
        return 0
    else
        echo -e "${RED}✗ 服务未运行${NC}"
        echo ""
        echo "请先启动 Whisper 服务:"
        echo "  docker-compose up -d whisper-service"
        exit 1
    fi
}

# 显示当前状态
show_status() {
    echo ""
    echo "=== 当前状态 ==="
    STATUS=$(curl -s "$WHISPER_URL/health" | python3 -m json.tool)
    echo "$STATUS"
    echo ""
}

# 显示可用模型
show_models() {
    echo "=== 可用模型 ==="
    echo ""
    echo "1. tiny   - 75MB   - 最快速度，基础准确度"
    echo "2. base   - 140MB  - 推荐使用，速度和准确度平衡 ⭐"
    echo "3. small  - 460MB  - 更高准确度"
    echo "4. medium - 1.5GB  - 专业级准确度"
    echo "5. large  - 2.9GB  - 最高质量"
    echo ""
}

# 切换模型
switch_model() {
    local model=$1

    echo ""
    echo "=== 切换到 $model 模型 ==="
    echo ""

    # 更新环境变量
    echo "更新 Docker 环境变量..."

    # 更新 .env 文件
    if [ -f "backend/whisper-service/.env" ]; then
        sed -i.bak "s/WHISPER_MODEL=.*/WHISPER_MODEL=$model/" backend/whisper-service/.env
        echo -e "${GREEN}✓ 已更新 .env 文件${NC}"
    fi

    # 重启容器
    echo ""
    echo "重启 Whisper 服务..."
    docker-compose restart whisper-service

    echo ""
    echo "等待服务启动..."
    sleep 10

    # 检查状态
    if curl -s -f "$WHISPER_URL/health" > /dev/null; then
        echo -e "${GREEN}✓ 服务已重启${NC}"
        show_status
    else
        echo -e "${RED}✗ 服务启动失败${NC}"
        echo "请查看日志: docker logs chainlesschain-whisper"
        exit 1
    fi
}

# 性能测试
performance_test() {
    local model=$1

    echo ""
    echo "=== 性能测试 ($model 模型) ==="
    echo ""

    # 下载测试音频
    if [ ! -f "/tmp/test-audio.flac" ]; then
        echo "下载测试音频..."
        curl -L -o /tmp/test-audio.flac \
            "https://github.com/openai/whisper/raw/main/tests/jfk.flac" 2>&1 | tail -1
    fi

    echo "开始转录测试..."
    START_TIME=$(date +%s%N)

    RESULT=$(curl -s -X POST "$WHISPER_URL/v1/audio/transcriptions" \
        -F "file=@/tmp/test-audio.flac" \
        -F "model=$model" \
        -F "language=en")

    END_TIME=$(date +%s%N)
    DURATION=$(( (END_TIME - START_TIME) / 1000000 ))

    echo ""
    echo "转录结果:"
    echo "$RESULT" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('text', 'N/A'))"
    echo ""
    echo -e "${GREEN}转录时间: ${DURATION}ms${NC}"
    echo ""
}

# 主菜单
main_menu() {
    check_service
    show_status
    show_models

    echo "请选择操作:"
    echo ""
    echo "1) 切换到 tiny 模型 (最快)"
    echo "2) 切换到 base 模型 (推荐)"
    echo "3) 切换到 small 模型"
    echo "4) 切换到 medium 模型"
    echo "5) 切换到 large 模型"
    echo "6) 性能测试"
    echo "7) 查看状态"
    echo "0) 退出"
    echo ""

    read -p "请输入选项 [0-7]: " choice

    case $choice in
        1)
            switch_model "tiny"
            ;;
        2)
            switch_model "base"
            ;;
        3)
            switch_model "small"
            ;;
        4)
            switch_model "medium"
            ;;
        5)
            switch_model "large"
            ;;
        6)
            echo ""
            read -p "使用哪个模型测试? [tiny/base/small/medium/large]: " test_model
            performance_test "$test_model"
            ;;
        7)
            show_status
            ;;
        0)
            echo "退出"
            exit 0
            ;;
        *)
            echo -e "${RED}无效选项${NC}"
            ;;
    esac

    echo ""
    read -p "按 Enter 继续..."
    main_menu
}

# 命令行参数处理
if [ $# -eq 0 ]; then
    # 交互模式
    main_menu
else
    # 命令行模式
    case $1 in
        status)
            check_service
            show_status
            ;;
        switch)
            if [ -z "$2" ]; then
                echo "用法: $0 switch <model>"
                echo "可用模型: tiny, base, small, medium, large"
                exit 1
            fi
            check_service
            switch_model "$2"
            ;;
        test)
            check_service
            model="${2:-base}"
            performance_test "$model"
            ;;
        *)
            echo "用法: $0 [status|switch <model>|test [model]]"
            echo ""
            echo "示例:"
            echo "  $0              # 交互模式"
            echo "  $0 status       # 查看状态"
            echo "  $0 switch base  # 切换到 base 模型"
            echo "  $0 test tiny    # 测试 tiny 模型性能"
            exit 1
            ;;
    esac
fi
