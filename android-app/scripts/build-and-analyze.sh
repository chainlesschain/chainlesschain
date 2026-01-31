#!/bin/bash

# APK构建和分析脚本
# 自动化构建Release APK并分析大小

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
TARGET_APK_SIZE_MB=40
PROJECT_ROOT="."
OUTPUT_DIR="app/build/outputs/apk/release"
BUNDLE_DIR="app/build/outputs/bundle/release"

# 打印标题
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  APK构建和分析工具${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# 检查环境
check_environment() {
    echo "1. 检查环境"
    echo "----------------"

    # 检查Java版本
    if command -v java &> /dev/null; then
        java_version=$(java -version 2>&1 | head -n 1 | cut -d'"' -f2)
        echo -e "${GREEN}✓${NC} Java: $java_version"
    else
        echo -e "${RED}✗${NC} Java未安装"
        exit 1
    fi

    # 检查Gradle
    if [ -f "./gradlew" ]; then
        echo -e "${GREEN}✓${NC} Gradle Wrapper: 存在"
    else
        echo -e "${RED}✗${NC} Gradle Wrapper不存在"
        exit 1
    fi

    # 检查Android SDK
    if [ -n "$ANDROID_HOME" ]; then
        echo -e "${GREEN}✓${NC} Android SDK: $ANDROID_HOME"
    else
        echo -e "${YELLOW}⚠${NC} ANDROID_HOME未设置"
    fi

    echo ""
}

# 清理旧构建
clean_build() {
    echo "2. 清理旧构建"
    echo "----------------"

    echo "执行: ./gradlew clean"
    ./gradlew clean --quiet

    echo -e "${GREEN}✓${NC} 清理完成"
    echo ""
}

# 构建Release APK
build_apk() {
    echo "3. 构建Release APK"
    echo "----------------"

    echo "执行: ./gradlew assembleRelease"
    echo ""

    start_time=$(date +%s)
    ./gradlew assembleRelease
    end_time=$(date +%s)

    build_duration=$((end_time - start_time))
    echo ""
    echo -e "${GREEN}✓${NC} 构建完成（耗时: ${build_duration}秒）"
    echo ""
}

# 构建App Bundle
build_bundle() {
    echo "4. 构建App Bundle (可选)"
    echo "----------------"

    read -p "是否构建AAB? (y/n): " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "执行: ./gradlew bundleRelease"
        echo ""

        start_time=$(date +%s)
        ./gradlew bundleRelease
        end_time=$(date +%s)

        build_duration=$((end_time - start_time))
        echo ""
        echo -e "${GREEN}✓${NC} AAB构建完成（耗时: ${build_duration}秒）"
    else
        echo "跳过AAB构建"
    fi

    echo ""
}

# 分析APK大小
analyze_apk_size() {
    echo "5. 分析APK大小"
    echo "----------------"

    if [ ! -d "$OUTPUT_DIR" ]; then
        echo -e "${RED}✗${NC} 输出目录不存在: $OUTPUT_DIR"
        return
    fi

    # 查找所有APK文件
    apk_files=$(find "$OUTPUT_DIR" -name "*.apk" -type f)

    if [ -z "$apk_files" ]; then
        echo -e "${RED}✗${NC} 未找到APK文件"
        return
    fi

    echo "找到的APK文件："
    echo ""

    total_size=0
    apk_count=0

    while IFS= read -r apk; do
        filename=$(basename "$apk")
        size=$(stat -f%z "$apk" 2>/dev/null || stat -c%s "$apk" 2>/dev/null)
        size_mb=$((size / 1024 / 1024))

        # 判断是否达标
        if [ $size_mb -le $TARGET_APK_SIZE_MB ]; then
            status="${GREEN}✓ 达标${NC}"
        else
            status="${RED}✗ 超标${NC}"
        fi

        echo -e "  $filename"
        echo -e "    大小: ${size_mb}MB"
        echo -e "    状态: $status (目标: <${TARGET_APK_SIZE_MB}MB)"
        echo ""

        total_size=$((total_size + size))
        apk_count=$((apk_count + 1))
    done <<< "$apk_files"

    # 打印总结
    if [ $apk_count -gt 1 ]; then
        total_size_mb=$((total_size / 1024 / 1024))
        echo "  总计: $apk_count 个APK文件，总大小: ${total_size_mb}MB"
        echo ""
    fi
}

# 详细分析APK内容
analyze_apk_contents() {
    echo "6. 详细分析APK内容"
    echo "----------------"

    # 查找universal APK（最大的）
    universal_apk=$(find "$OUTPUT_DIR" -name "*universal*.apk" -type f | head -n 1)

    if [ -z "$universal_apk" ]; then
        # 如果没有universal，查找release APK
        universal_apk=$(find "$OUTPUT_DIR" -name "*release.apk" -type f | head -n 1)
    fi

    if [ -z "$universal_apk" ]; then
        echo -e "${YELLOW}⚠${NC} 未找到APK文件用于分析"
        echo ""
        return
    fi

    echo "分析APK: $(basename $universal_apk)"
    echo ""

    # 创建临时解压目录
    temp_dir=$(mktemp -d)
    unzip -q "$universal_apk" -d "$temp_dir"

    # 分析各部分大小
    echo "APK内容分解："
    echo ""

    # DEX文件
    dex_size=$(find "$temp_dir" -name "*.dex" -type f -exec stat -f%z {} \; 2>/dev/null | awk '{s+=$1} END {print s}' || \
               find "$temp_dir" -name "*.dex" -type f -exec stat -c%s {} \; 2>/dev/null | awk '{s+=$1} END {print s}')
    dex_size_mb=$((dex_size / 1024 / 1024))
    echo "  DEX文件 (代码):     ${dex_size_mb}MB"

    # 资源文件
    res_size=$(du -s "$temp_dir/res" 2>/dev/null | awk '{print $1}' || echo 0)
    res_size_mb=$((res_size / 1024))
    echo "  res/ (资源):        ${res_size_mb}MB"

    # Native库
    if [ -d "$temp_dir/lib" ]; then
        lib_size=$(du -s "$temp_dir/lib" 2>/dev/null | awk '{print $1}' || echo 0)
        lib_size_mb=$((lib_size / 1024))
        echo "  lib/ (Native库):    ${lib_size_mb}MB"
    fi

    # Assets
    if [ -d "$temp_dir/assets" ]; then
        assets_size=$(du -s "$temp_dir/assets" 2>/dev/null | awk '{print $1}' || echo 0)
        assets_size_mb=$((assets_size / 1024))
        echo "  assets/ (资产):     ${assets_size_mb}MB"
    fi

    # META-INF
    if [ -d "$temp_dir/META-INF" ]; then
        meta_size=$(du -s "$temp_dir/META-INF" 2>/dev/null | awk '{print $1}' || echo 0)
        meta_size_mb=$((meta_size / 1024))
        echo "  META-INF/ (元数据): ${meta_size_mb}MB"
    fi

    # 清理临时目录
    rm -rf "$temp_dir"

    echo ""
}

# 分析AAB大小
analyze_bundle_size() {
    echo "7. 分析App Bundle大小"
    echo "----------------"

    if [ ! -d "$BUNDLE_DIR" ]; then
        echo "未构建AAB，跳过"
        echo ""
        return
    fi

    aab_file=$(find "$BUNDLE_DIR" -name "*.aab" -type f | head -n 1)

    if [ -z "$aab_file" ]; then
        echo "未找到AAB文件"
        echo ""
        return
    fi

    filename=$(basename "$aab_file")
    size=$(stat -f%z "$aab_file" 2>/dev/null || stat -c%s "$aab_file" 2>/dev/null)
    size_mb=$((size / 1024 / 1024))

    echo "  $filename"
    echo "  大小: ${size_mb}MB"
    echo ""

    # 检查bundletool
    if command -v bundletool &> /dev/null; then
        echo "使用bundletool分析分发大小..."
        echo ""
        bundletool get-size total --bundle="$aab_file" 2>/dev/null || echo "分析失败"
        echo ""
    else
        echo -e "${YELLOW}⚠${NC} bundletool未安装，跳过详细分析"
        echo "安装: brew install bundletool (macOS)"
        echo ""
    fi
}

# 生成报告
generate_report() {
    echo "8. 生成分析报告"
    echo "----------------"

    report_file="build-analysis-report.txt"

    {
        echo "ChainlessChain Android - APK构建分析报告"
        echo "========================================"
        echo ""
        echo "构建时间: $(date)"
        echo ""
        echo "APK文件列表:"
        find "$OUTPUT_DIR" -name "*.apk" -type f -exec basename {} \; 2>/dev/null || echo "无"
        echo ""
        echo "详细大小分析已保存到控制台输出"
        echo ""
    } > "$report_file"

    echo -e "${GREEN}✓${NC} 报告已保存到: $report_file"
    echo ""
}

# 提供优化建议
provide_suggestions() {
    echo "9. 优化建议"
    echo "----------------"

    # 查找最大的APK
    largest_apk=$(find "$OUTPUT_DIR" -name "*.apk" -type f -exec stat -f%z {} + 2>/dev/null | sort -rn | head -n 1 || \
                  find "$OUTPUT_DIR" -name "*.apk" -type f -exec stat -c%s {} + 2>/dev/null | sort -rn | head -n 1)

    if [ -n "$largest_apk" ]; then
        largest_size_mb=$((largest_apk / 1024 / 1024))

        echo "当前最大APK: ${largest_size_mb}MB"
        echo ""

        if [ $largest_size_mb -gt $TARGET_APK_SIZE_MB ]; then
            echo -e "${YELLOW}APK超过目标大小，建议：${NC}"
            echo ""
            echo "  1. 执行WebP转换: ./scripts/convert_to_webp.sh"
            echo "  2. 检查是否有未使用的依赖"
            echo "  3. 使用AAB分发（按设备下载）"
            echo "  4. 检查资源压缩是否启用"
            echo "  5. 使用Android Studio APK Analyzer分析"
            echo ""
        else
            echo -e "${GREEN}✓${NC} APK大小符合目标 (<${TARGET_APK_SIZE_MB}MB)"
            echo ""
        fi
    fi

    echo "进一步优化："
    echo "  • 使用 ./gradlew bundleRelease 构建AAB"
    echo "  • AAB会自动按设备分发，减少下载大小"
    echo "  • arm64-v8a预计: ~28MB"
    echo "  • armeabi-v7a预计: ~26MB"
    echo ""
}

# 主函数
main() {
    cd "$(dirname "$0")/.."  # 切换到项目根目录

    print_header
    check_environment
    clean_build
    build_apk
    build_bundle
    analyze_apk_size
    analyze_apk_contents
    analyze_bundle_size
    generate_report
    provide_suggestions

    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}✅ 构建和分析完成！${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

main "$@"
