#!/bin/bash

# 性能测试运行脚本
# 自动化运行性能相关的E2E测试并生成报告

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
TEST_CLASS="com.chainlesschain.android.feature.p2p.e2e.PerformanceE2ETest"
REPORT_DIR="app/build/reports/androidTests/connected"
COVERAGE_DIR="app/build/reports/coverage/androidTest"

# 性能目标
TARGET_COLD_START_MS=1200
TARGET_MEMORY_MB=180
TARGET_FPS=58

# 打印标题
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  ChainlessChain Android${NC}"
    echo -e "${BLUE}  性能测试运行器${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# 检查环境
check_environment() {
    echo "1. 环境检查"
    echo "----------------"

    # 检查ADB
    if command -v adb &> /dev/null; then
        echo -e "${GREEN}✓${NC} ADB已安装"
    else
        echo -e "${RED}✗${NC} ADB未安装"
        exit 1
    fi

    # 检查设备连接
    device_count=$(adb devices | grep -v "List" | grep "device" | wc -l)
    if [ $device_count -gt 0 ]; then
        echo -e "${GREEN}✓${NC} 已连接 $device_count 个设备"
        echo ""
        adb devices | grep "device" | grep -v "List"
    else
        echo -e "${RED}✗${NC} 未检测到设备"
        echo "请连接Android设备或启动模拟器"
        exit 1
    fi

    echo ""
}

# 显示测试列表
show_test_list() {
    echo "2. 可用的性能测试"
    echo "----------------"
    echo ""
    echo "  1. test_startupPerformance_coldStart"
    echo "     - 测试冷启动时间"
    echo "     - 目标: <${TARGET_COLD_START_MS}ms"
    echo ""
    echo "  2. test_memoryUsage_peakAndAverage"
    echo "     - 测试内存使用"
    echo "     - 目标: 峰值<${TARGET_MEMORY_MB}MB"
    echo ""
    echo "  3. test_scrollPerformance_frameRate"
    echo "     - 测试滚动帧率"
    echo "     - 目标: ≥${TARGET_FPS}fps"
    echo ""
    echo "  4. test_imageLoadingPerformance_preloadAndCache"
    echo "     - 测试图片加载性能"
    echo "     - 目标: 平均<500ms"
    echo ""
}

# 选择测试
select_tests() {
    echo "3. 选择要运行的测试"
    echo "----------------"
    echo ""
    echo "1) 运行所有测试"
    echo "2) 仅启动速度测试"
    echo "3) 仅内存测试"
    echo "4) 仅滚动性能测试"
    echo "5) 仅图片加载测试"
    echo "6) 自定义选择"
    echo ""

    read -p "请选择 (1-6): " -n 1 -r choice
    echo ""
    echo ""

    case $choice in
        1)
            TEST_FILTER=""
            TEST_DESC="所有性能测试"
            ;;
        2)
            TEST_FILTER="test_startupPerformance_coldStart"
            TEST_DESC="启动速度测试"
            ;;
        3)
            TEST_FILTER="test_memoryUsage_peakAndAverage"
            TEST_DESC="内存使用测试"
            ;;
        4)
            TEST_FILTER="test_scrollPerformance_frameRate"
            TEST_DESC="滚动性能测试"
            ;;
        5)
            TEST_FILTER="test_imageLoadingPerformance_preloadAndCache"
            TEST_DESC="图片加载测试"
            ;;
        6)
            read -p "输入测试方法名: " TEST_FILTER
            TEST_DESC="自定义测试: $TEST_FILTER"
            ;;
        *)
            echo "无效选择，默认运行所有测试"
            TEST_FILTER=""
            TEST_DESC="所有性能测试"
            ;;
    esac

    echo "将运行: $TEST_DESC"
    echo ""
}

# 准备测试环境
prepare_test_env() {
    echo "4. 准备测试环境"
    echo "----------------"

    # 清理旧的测试数据
    echo "清理旧测试数据..."
    adb shell pm clear com.chainlesschain.android.debug 2>/dev/null || true

    # 检查屏幕是否解锁
    screen_state=$(adb shell dumpsys power | grep "mHoldingDisplay" || echo "unknown")
    echo "设备屏幕状态: $screen_state"

    # 建议解锁屏幕
    echo ""
    echo -e "${YELLOW}⚠${NC} 请确保设备屏幕已解锁且保持唤醒"
    echo ""
    read -p "按Enter继续..." -r
    echo ""
}

# 运行性能测试
run_tests() {
    echo "5. 运行测试"
    echo "----------------"
    echo ""

    start_time=$(date +%s)

    if [ -z "$TEST_FILTER" ]; then
        # 运行所有测试
        echo "执行: ./gradlew :feature-p2p:connectedAndroidTest --tests \"$TEST_CLASS\""
        echo ""
        ./gradlew :feature-p2p:connectedAndroidTest --tests "$TEST_CLASS"
    else
        # 运行特定测试
        echo "执行: ./gradlew :feature-p2p:connectedAndroidTest --tests \"$TEST_CLASS.$TEST_FILTER\""
        echo ""
        ./gradlew :feature-p2p:connectedAndroidTest --tests "$TEST_CLASS.$TEST_FILTER"
    fi

    end_time=$(date +%s)
    test_duration=$((end_time - start_time))

    echo ""
    echo -e "${GREEN}✓${NC} 测试完成（耗时: ${test_duration}秒）"
    echo ""
}

# 提取测试结果
extract_results() {
    echo "6. 提取测试结果"
    echo "----------------"
    echo ""

    # 从logcat提取性能指标
    echo "从设备日志提取性能数据..."
    echo ""

    # 提取启动性能
    startup_time=$(adb logcat -d -s StartupPerf:D | grep "Startup time:" | tail -n 1 | sed -E 's/.*Startup time: ([0-9]+)ms.*/\1/' || echo "N/A")
    if [ "$startup_time" != "N/A" ] && [ "$startup_time" -lt $TARGET_COLD_START_MS ]; then
        startup_status="${GREEN}✓ PASS${NC}"
    elif [ "$startup_time" != "N/A" ]; then
        startup_status="${RED}✗ FAIL${NC}"
    else
        startup_status="N/A"
    fi

    # 提取内存使用
    memory_peak=$(adb logcat -d -s Memory:D | grep "After viewing image:" | tail -n 1 | sed -E 's/.*: ([0-9]+)MB.*/\1/' || echo "N/A")
    if [ "$memory_peak" != "N/A" ] && [ "$memory_peak" -lt $TARGET_MEMORY_MB ]; then
        memory_status="${GREEN}✓ PASS${NC}"
    elif [ "$memory_peak" != "N/A" ]; then
        memory_status="${RED}✗ FAIL${NC}"
    else
        memory_status="N/A"
    fi

    # 提取滚动FPS
    scroll_fps=$(adb logcat -d -s ScrollPerf:D | grep "Estimated FPS:" | tail -n 1 | sed -E 's/.*Estimated FPS: ([0-9.]+).*/\1/' || echo "N/A")
    if [ "$scroll_fps" != "N/A" ] && [ $(echo "$scroll_fps >= $TARGET_FPS" | bc -l) -eq 1 ]; then
        scroll_status="${GREEN}✓ PASS${NC}"
    elif [ "$scroll_fps" != "N/A" ]; then
        scroll_status="${YELLOW}⚠ WARN${NC}"
    else
        scroll_status="N/A"
    fi

    # 打印结果
    echo -e "${BLUE}性能测试结果：${NC}"
    echo ""
    echo -e "  启动时间:    ${startup_time}ms (目标: <${TARGET_COLD_START_MS}ms) $startup_status"
    echo -e "  内存峰值:    ${memory_peak}MB (目标: <${TARGET_MEMORY_MB}MB) $memory_status"
    echo -e "  滚动帧率:    ${scroll_fps}fps (目标: ≥${TARGET_FPS}fps) $scroll_status"
    echo ""
}

# 生成HTML报告
generate_report() {
    echo "7. 生成测试报告"
    echo "----------------"

    if [ -d "$REPORT_DIR" ]; then
        echo -e "${GREEN}✓${NC} HTML报告已生成"
        echo "位置: $REPORT_DIR/index.html"
        echo ""

        # 尝试打开报告
        if command -v open &> /dev/null; then
            read -p "是否打开HTML报告? (y/n): " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                open "$REPORT_DIR/index.html"
            fi
        fi
    else
        echo -e "${YELLOW}⚠${NC} 未找到HTML报告"
    fi

    echo ""
}

# 生成性能报告文件
save_performance_report() {
    echo "8. 保存性能报告"
    echo "----------------"

    report_file="performance-test-report-$(date +%Y%m%d-%H%M%S).txt"

    {
        echo "ChainlessChain Android - 性能测试报告"
        echo "========================================"
        echo ""
        echo "测试时间: $(date)"
        echo "测试类型: $TEST_DESC"
        echo ""
        echo "性能指标："
        echo "  启动时间: ${startup_time}ms (目标: <${TARGET_COLD_START_MS}ms)"
        echo "  内存峰值: ${memory_peak}MB (目标: <${TARGET_MEMORY_MB}MB)"
        echo "  滚动帧率: ${scroll_fps}fps (目标: ≥${TARGET_FPS}fps)"
        echo ""
        echo "设备信息："
        adb shell getprop ro.product.model
        adb shell getprop ro.build.version.release
        echo ""
    } > "$report_file"

    echo -e "${GREEN}✓${NC} 报告已保存到: $report_file"
    echo ""
}

# 提供优化建议
provide_recommendations() {
    echo "9. 优化建议"
    echo "----------------"
    echo ""

    has_issues=0

    if [ "$startup_time" != "N/A" ] && [ "$startup_time" -ge $TARGET_COLD_START_MS ]; then
        echo -e "${YELLOW}启动时间需要优化：${NC}"
        echo "  • 检查AppInitializer是否正确配置"
        echo "  • 确认异步初始化正在运行"
        echo "  • 查看StartupPerformanceMonitor日志"
        echo ""
        has_issues=1
    fi

    if [ "$memory_peak" != "N/A" ] && [ "$memory_peak" -ge $TARGET_MEMORY_MB ]; then
        echo -e "${YELLOW}内存使用需要优化：${NC}"
        echo "  • 检查Coil缓存配置"
        echo "  • 使用LeakCanary检测内存泄漏"
        echo "  • 查看MemoryInfo监控数据"
        echo ""
        has_issues=1
    fi

    if [ "$scroll_fps" != "N/A" ] && [ $(echo "$scroll_fps < $TARGET_FPS" | bc -l) -eq 1 ]; then
        echo -e "${YELLOW}滚动性能需要优化：${NC}"
        echo "  • 确认PostCardOptimized正在使用"
        echo "  • 检查ImagePreloader是否启用"
        echo "  • 查看ScrollPerformanceMonitor日志"
        echo ""
        has_issues=1
    fi

    if [ $has_issues -eq 0 ]; then
        echo -e "${GREEN}✓${NC} 所有性能指标均达标！"
        echo ""
        echo "继续保持："
        echo "  • 定期运行性能测试"
        echo "  • 监控线上性能指标"
        echo "  • 持续优化代码质量"
        echo ""
    fi
}

# 主函数
main() {
    cd "$(dirname "$0")/.."  # 切换到项目根目录

    print_header
    check_environment
    show_test_list
    select_tests
    prepare_test_env
    run_tests
    extract_results
    generate_report
    save_performance_report
    provide_recommendations

    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}✅ 性能测试完成！${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

main "$@"
