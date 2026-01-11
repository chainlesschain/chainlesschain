#!/bin/bash

# P2P功能测试执行脚本
# 自动运行所有P2P相关测试

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 打印标题
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# 检查依赖
check_dependencies() {
    print_header "检查依赖"

    # 检查Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js 未安装"
        exit 1
    fi
    print_success "Node.js: $(node --version)"

    # 检查npm
    if ! command -v npm &> /dev/null; then
        print_error "npm 未安装"
        exit 1
    fi
    print_success "npm: $(npm --version)"

    # 检查Playwright
    if ! npm list @playwright/test &> /dev/null; then
        print_warning "Playwright 未安装，正在安装..."
        npm install --save-dev @playwright/test
        npx playwright install
    fi
    print_success "Playwright 已安装"
}

# 启动应用
start_app() {
    print_header "启动应用"

    # 检查应用是否已运行
    if lsof -i:5173 &> /dev/null; then
        print_success "应用已在运行 (http://localhost:5173)"
        return 0
    fi

    print_info "启动开发服务器..."
    npm run dev &
    APP_PID=$!

    # 等待应用启动
    print_info "等待应用启动..."
    for i in {1..30}; do
        if curl -s http://localhost:5173 &> /dev/null; then
            print_success "应用启动成功"
            return 0
        fi
        sleep 1
    done

    print_error "应用启动超时"
    kill $APP_PID 2>/dev/null || true
    exit 1
}

# 启动信令服务器
start_signaling_server() {
    print_header "启动信令服务器"

    # 检查信令服务器是否已运行
    if lsof -i:9001 &> /dev/null; then
        print_success "信令服务器已在运行 (ws://localhost:9001)"
        return 0
    fi

    print_info "启动信令服务器..."
    cd signaling-server
    npm start &
    SIGNALING_PID=$!
    cd ..

    # 等待服务器启动
    print_info "等待信令服务器启动..."
    sleep 3

    if lsof -i:9001 &> /dev/null; then
        print_success "信令服务器启动成功"
        return 0
    else
        print_error "信令服务器启动失败"
        kill $SIGNALING_PID 2>/dev/null || true
        exit 1
    fi
}

# 运行P2P连接测试
run_connection_tests() {
    print_header "运行P2P连接测试"

    npx playwright test tests/integration/p2p-call.test.js --grep "P2P连接建立" --reporter=list

    if [ $? -eq 0 ]; then
        print_success "P2P连接测试通过"
    else
        print_error "P2P连接测试失败"
        return 1
    fi
}

# 运行音视频通话测试
run_call_tests() {
    print_header "运行音视频通话测试"

    npx playwright test tests/integration/p2p-call.test.js --grep "音视频通话" --reporter=list

    if [ $? -eq 0 ]; then
        print_success "音视频通话测试通过"
    else
        print_error "音视频通话测试失败"
        return 1
    fi
}

# 运行屏幕共享测试
run_screen_share_tests() {
    print_header "运行屏幕共享测试"

    npx playwright test tests/integration/p2p-call.test.js --grep "屏幕共享" --reporter=list

    if [ $? -eq 0 ]; then
        print_success "屏幕共享测试通过"
    else
        print_error "屏幕共享测试失败"
        return 1
    fi
}

# 运行通话历史测试
run_history_tests() {
    print_header "运行通话历史测试"

    npx playwright test tests/integration/p2p-call.test.js --grep "通话历史" --reporter=list

    if [ $? -eq 0 ]; then
        print_success "通话历史测试通过"
    else
        print_error "通话历史测试失败"
        return 1
    fi
}

# 运行连接健康监控测试
run_health_tests() {
    print_header "运行连接健康监控测试"

    npx playwright test tests/integration/p2p-call.test.js --grep "连接健康监控" --reporter=list

    if [ $? -eq 0 ]; then
        print_success "连接健康监控测试通过"
    else
        print_error "连接健康监控测试失败"
        return 1
    fi
}

# 运行性能测试
run_performance_tests() {
    print_header "运行性能和稳定性测试"

    npx playwright test tests/integration/p2p-call.test.js --grep "性能和稳定性" --reporter=list --timeout=120000

    if [ $? -eq 0 ]; then
        print_success "性能和稳定性测试通过"
    else
        print_error "性能和稳定性测试失败"
        return 1
    fi
}

# 运行所有测试
run_all_tests() {
    print_header "运行所有P2P测试"

    local failed=0

    run_connection_tests || failed=$((failed + 1))
    run_call_tests || failed=$((failed + 1))
    run_screen_share_tests || failed=$((failed + 1))
    run_history_tests || failed=$((failed + 1))
    run_health_tests || failed=$((failed + 1))
    run_performance_tests || failed=$((failed + 1))

    return $failed
}

# 生成测试报告
generate_report() {
    print_header "生成测试报告"

    # 生成HTML报告
    npx playwright show-report

    print_success "测试报告已生成"
}

# 清理
cleanup() {
    print_header "清理环境"

    # 停止应用
    if [ ! -z "$APP_PID" ]; then
        print_info "停止应用..."
        kill $APP_PID 2>/dev/null || true
    fi

    # 停止信令服务器
    if [ ! -z "$SIGNALING_PID" ]; then
        print_info "停止信令服务器..."
        kill $SIGNALING_PID 2>/dev/null || true
    fi

    print_success "清理完成"
}

# 主函数
main() {
    print_header "P2P功能测试套件"

    # 设置清理陷阱
    trap cleanup EXIT

    # 检查依赖
    check_dependencies

    # 启动服务
    start_app
    start_signaling_server

    # 运行测试
    local test_mode=${1:-all}

    case $test_mode in
        connection)
            run_connection_tests
            ;;
        call)
            run_call_tests
            ;;
        screen)
            run_screen_share_tests
            ;;
        history)
            run_history_tests
            ;;
        health)
            run_health_tests
            ;;
        performance)
            run_performance_tests
            ;;
        all)
            run_all_tests
            failed=$?
            ;;
        *)
            print_error "未知的测试模式: $test_mode"
            print_info "可用模式: connection, call, screen, history, health, performance, all"
            exit 1
            ;;
    esac

    # 生成报告
    generate_report

    # 输出结果
    echo ""
    print_header "测试完成"

    if [ ${failed:-0} -eq 0 ]; then
        print_success "所有测试通过! ✅"
        exit 0
    else
        print_error "$failed 个测试套件失败 ❌"
        exit 1
    fi
}

# 显示帮助
show_help() {
    echo "P2P功能测试脚本"
    echo ""
    echo "用法: $0 [模式]"
    echo ""
    echo "模式:"
    echo "  connection   - 运行P2P连接测试"
    echo "  call         - 运行音视频通话测试"
    echo "  screen       - 运行屏幕共享测试"
    echo "  history      - 运行通话历史测试"
    echo "  health       - 运行连接健康监控测试"
    echo "  performance  - 运行性能和稳定性测试"
    echo "  all          - 运行所有测试 (默认)"
    echo ""
    echo "示例:"
    echo "  $0              # 运行所有测试"
    echo "  $0 connection   # 只运行连接测试"
    echo "  $0 call         # 只运行通话测试"
}

# 检查参数
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# 运行主函数
main "$@"
