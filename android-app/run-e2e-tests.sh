#!/bin/bash

################################################################################
# ChainlessChain Android E2E测试执行脚本
# 版本: v0.30.0
# 用途: 快速运行所有E2E测试并生成报告
################################################################################

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
TEST_SUITE="com.chainlesschain.android.e2e.AppE2ETestSuite"
RETRY_COUNT=3
TIMEOUT=1800000  # 30分钟
TEST_OUTPUT_DIR="app/build/outputs/androidTest-results"
COVERAGE_OUTPUT_DIR="app/build/reports/jacoco/jacocoE2ETestReport"

################################################################################
# 打印带颜色的消息
################################################################################

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

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

################################################################################
# 检查环境
################################################################################

check_environment() {
    print_header "检查环境"

    # 检查Android SDK
    if [ -z "$ANDROID_HOME" ]; then
        print_error "ANDROID_HOME 未设置"
        exit 1
    fi
    print_success "Android SDK: $ANDROID_HOME"

    # 检查ADB
    if ! command -v adb &> /dev/null; then
        print_error "adb 命令未找到"
        exit 1
    fi
    print_success "ADB 已安装"

    # 检查设备连接
    DEVICE_COUNT=$(adb devices | grep -v "List" | grep "device$" | wc -l)
    if [ "$DEVICE_COUNT" -eq 0 ]; then
        print_error "未找到连接的设备或模拟器"
        print_info "请启动模拟器或连接设备后重试"
        exit 1
    fi
    print_success "找到 $DEVICE_COUNT 个设备"

    # 显示设备信息
    print_info "设备列表:"
    adb devices | grep "device$"
}

################################################################################
# 清理环境
################################################################################

clean_environment() {
    print_header "清理环境"

    # 卸载旧版本应用
    print_info "卸载旧版本应用..."
    adb uninstall com.chainlesschain.android 2>/dev/null || true
    adb uninstall com.chainlesschain.android.test 2>/dev/null || true

    # 清理构建缓存
    print_info "清理构建缓存..."
    ./gradlew clean

    print_success "环境清理完成"
}

################################################################################
# 构建应用
################################################################################

build_app() {
    print_header "构建应用"

    print_info "构建Debug APK..."
    ./gradlew assembleDebug

    print_info "构建Test APK..."
    ./gradlew assembleDebugAndroidTest

    print_success "构建完成"
}

################################################################################
# 运行E2E测试
################################################################################

run_e2e_tests() {
    print_header "运行E2E测试"

    local test_type="${1:-all}"
    local retry=0
    local success=false

    while [ $retry -lt $RETRY_COUNT ] && [ "$success" = false ]; do
        if [ $retry -gt 0 ]; then
            print_warning "第 $((retry + 1)) 次尝试..."
        fi

        case "$test_type" in
            all)
                print_info "运行所有E2E测试 (62个测试)..."
                if ./gradlew connectedDebugAndroidTest \
                    -Pandroid.testInstrumentationRunnerArguments.class=$TEST_SUITE \
                    --stacktrace; then
                    success=true
                fi
                ;;
            critical)
                print_info "运行关键测试 (11个测试)..."
                if ./gradlew connectedDebugAndroidTest \
                    -Pandroid.testInstrumentationRunnerArguments.annotation=com.chainlesschain.android.test.annotation.CriticalTest \
                    --stacktrace; then
                    success=true
                fi
                ;;
            ui)
                print_info "运行UI测试 (20个测试)..."
                if ./gradlew connectedDebugAndroidTest \
                    -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.p2p.e2e.SocialUIScreensE2ETest \
                    --stacktrace; then
                    success=true
                fi
                ;;
            feature)
                print_info "运行功能测试 (7个测试)..."
                if ./gradlew connectedDebugAndroidTest \
                    -Pandroid.testInstrumentationRunnerArguments.annotation=com.chainlesschain.android.test.annotation.FeatureTest \
                    --stacktrace; then
                    success=true
                fi
                ;;
            *)
                print_error "未知的测试类型: $test_type"
                print_info "支持的类型: all, critical, ui, feature"
                exit 1
                ;;
        esac

        retry=$((retry + 1))
    done

    if [ "$success" = true ]; then
        print_success "测试执行成功"
        return 0
    else
        print_error "测试执行失败（已重试 $RETRY_COUNT 次）"
        return 1
    fi
}

################################################################################
# 生成覆盖率报告
################################################################################

generate_coverage_report() {
    print_header "生成覆盖率报告"

    print_info "运行JaCoCo覆盖率分析..."
    ./gradlew jacocoE2ETestReport

    if [ -f "$COVERAGE_OUTPUT_DIR/html/index.html" ]; then
        print_success "覆盖率报告已生成"
        print_info "报告位置: $COVERAGE_OUTPUT_DIR/html/index.html"

        # 提取覆盖率数据
        if command -v xmllint &> /dev/null; then
            local ui_coverage=$(xmllint --xpath "string(//counter[@type='INSTRUCTION']/@covered)" "$COVERAGE_OUTPUT_DIR/jacocoTestReport.xml" 2>/dev/null || echo "N/A")
            print_info "UI覆盖率: $ui_coverage%"
        fi
    else
        print_warning "覆盖率报告生成失败"
    fi
}

################################################################################
# 收集测试结果
################################################################################

collect_test_results() {
    print_header "收集测试结果"

    if [ -d "$TEST_OUTPUT_DIR" ]; then
        local test_count=$(find "$TEST_OUTPUT_DIR" -name "*.xml" | wc -l)
        print_info "找到 $test_count 个测试结果文件"

        # 统计测试结果
        local total_tests=0
        local passed_tests=0
        local failed_tests=0
        local skipped_tests=0

        for xml_file in $(find "$TEST_OUTPUT_DIR" -name "*.xml"); do
            if command -v xmllint &> /dev/null; then
                local tests=$(xmllint --xpath "string(/testsuite/@tests)" "$xml_file" 2>/dev/null || echo "0")
                local failures=$(xmllint --xpath "string(/testsuite/@failures)" "$xml_file" 2>/dev/null || echo "0")
                local skipped=$(xmllint --xpath "string(/testsuite/@skipped)" "$xml_file" 2>/dev/null || echo "0")

                total_tests=$((total_tests + tests))
                failed_tests=$((failed_tests + failures))
                skipped_tests=$((skipped_tests + skipped))
            fi
        done

        passed_tests=$((total_tests - failed_tests - skipped_tests))

        print_info "测试统计:"
        print_success "  ✅ 通过: $passed_tests"
        print_error "  ❌ 失败: $failed_tests"
        print_warning "  ⏭️  跳过: $skipped_tests"
        print_info "  📊 总计: $total_tests"

        if [ $total_tests -gt 0 ]; then
            local pass_rate=$(awk "BEGIN {printf \"%.2f\", ($passed_tests / $total_tests) * 100}")
            print_info "  📈 通过率: $pass_rate%"

            if [ "$pass_rate" = "100.00" ]; then
                print_success "所有测试通过！🎉"
            else
                print_warning "存在失败或跳过的测试"
            fi
        fi
    else
        print_warning "未找到测试结果"
    fi
}

################################################################################
# 保存测试截图
################################################################################

save_test_screenshots() {
    print_header "保存测试截图"

    local screenshot_dir="test-screenshots-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$screenshot_dir"

    # 从设备拉取截图
    print_info "从设备拉取测试截图..."
    adb pull /sdcard/Pictures/Screenshots "$screenshot_dir/" 2>/dev/null || print_warning "未找到测试截图"

    # 拉取测试报告截图
    adb pull /data/data/com.chainlesschain.android/files/screenshots "$screenshot_dir/test-failures/" 2>/dev/null || true

    if [ -d "$screenshot_dir" ] && [ "$(ls -A $screenshot_dir)" ]; then
        print_success "截图已保存到: $screenshot_dir"
    else
        print_info "没有截图需要保存"
        rm -rf "$screenshot_dir"
    fi
}

################################################################################
# 生成测试摘要
################################################################################

generate_test_summary() {
    print_header "测试摘要"

    local summary_file="test-summary-$(date +%Y%m%d-%H%M%S).txt"

    cat > "$summary_file" <<EOF
ChainlessChain Android E2E测试报告
========================================
测试时间: $(date '+%Y-%m-%d %H:%M:%S')
版本: v0.30.0

测试配置
----------------------------------------
- 测试套件: $TEST_SUITE
- 设备数量: $(adb devices | grep "device$" | wc -l)
- 重试次数: $RETRY_COUNT
- 超时设置: ${TIMEOUT}ms

测试结果
----------------------------------------
$(cat "$TEST_OUTPUT_DIR/connected/index.html" 2>/dev/null | grep -A 5 "Test Summary" || echo "详见测试报告")

覆盖率
----------------------------------------
$(cat "$COVERAGE_OUTPUT_DIR/html/index.html" 2>/dev/null | grep -A 5 "Coverage" || echo "详见覆盖率报告")

文件位置
----------------------------------------
- 测试报告: $TEST_OUTPUT_DIR/connected/index.html
- 覆盖率报告: $COVERAGE_OUTPUT_DIR/html/index.html
- 测试截图: $(ls -d test-screenshots-* 2>/dev/null | tail -1 || echo "无")

========================================
EOF

    print_success "测试摘要已保存到: $summary_file"
    cat "$summary_file"
}

################################################################################
# 主函数
################################################################################

main() {
    local start_time=$(date +%s)

    print_header "ChainlessChain Android E2E测试执行器 v0.30.0"

    # 解析参数
    local test_type="${1:-all}"
    local skip_build="${2:-false}"
    local skip_clean="${3:-false}"

    # 执行流程
    check_environment

    if [ "$skip_clean" != "true" ]; then
        clean_environment
    fi

    if [ "$skip_build" != "true" ]; then
        build_app
    fi

    if run_e2e_tests "$test_type"; then
        generate_coverage_report
        collect_test_results
        save_test_screenshots
        generate_test_summary

        local end_time=$(date +%s)
        local duration=$((end_time - start_time))

        print_header "测试完成"
        print_success "总耗时: ${duration}秒"
        exit 0
    else
        print_header "测试失败"
        collect_test_results
        save_test_screenshots
        exit 1
    fi
}

################################################################################
# 帮助信息
################################################################################

show_help() {
    cat <<EOF
ChainlessChain Android E2E测试执行器 v0.30.0

用法: $0 [test_type] [skip_build] [skip_clean]

参数:
  test_type    测试类型 (默认: all)
               - all:      运行所有测试 (62个)
               - critical: 运行关键测试 (11个)
               - ui:       运行UI测试 (20个)
               - feature:  运行功能测试 (7个)

  skip_build   跳过构建 (true/false, 默认: false)
  skip_clean   跳过清理 (true/false, 默认: false)

示例:
  # 运行所有测试
  $0

  # 仅运行UI测试
  $0 ui

  # 运行关键测试，跳过构建
  $0 critical true

  # 快速运行（跳过清理和构建）
  $0 all true true

报告位置:
  - 测试结果: app/build/outputs/androidTest-results/connected/index.html
  - 覆盖率: app/build/reports/jacoco/jacocoE2ETestReport/html/index.html

EOF
}

################################################################################
# 入口
################################################################################

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

main "$@"
