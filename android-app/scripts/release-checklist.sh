#!/bin/bash

# v0.32.0 发布检查清单 - Release Checklist
# 自动化检查发布前的所有必要步骤

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查结果统计
PASSED=0
FAILED=0
WARNING=0

# 打印标题
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  ChainlessChain Android v0.32.0${NC}"
    echo -e "${BLUE}  Release Checklist${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# 打印检查项
check_item() {
    local name="$1"
    local status="$2"
    local message="$3"

    if [ "$status" = "pass" ]; then
        echo -e "${GREEN}✅ PASS${NC} - $name"
        [ -n "$message" ] && echo "         $message"
        ((PASSED++))
    elif [ "$status" = "fail" ]; then
        echo -e "${RED}❌ FAIL${NC} - $name"
        [ -n "$message" ] && echo "         $message"
        ((FAILED++))
    elif [ "$status" = "warn" ]; then
        echo -e "${YELLOW}⚠️  WARN${NC} - $name"
        [ -n "$message" ] && echo "         $message"
        ((WARNING++))
    fi
}

# 检查Git状态
check_git_status() {
    echo ""
    echo "1. Git状态检查"
    echo "----------------"

    # 检查是否在main分支
    current_branch=$(git branch --show-current)
    if [ "$current_branch" = "main" ]; then
        check_item "当前分支" "pass" "在main分支"
    else
        check_item "当前分支" "fail" "当前在 $current_branch 分支，应该在main分支"
    fi

    # 检查是否有未提交的更改
    if [ -z "$(git status --porcelain)" ]; then
        check_item "工作区状态" "pass" "没有未提交的更改"
    else
        check_item "工作区状态" "fail" "有未提交的更改"
        git status --short
    fi

    # 检查是否与远程同步
    LOCAL=$(git rev-parse @)
    REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")
    if [ -z "$REMOTE" ]; then
        check_item "远程同步" "warn" "无法确定远程分支"
    elif [ "$LOCAL" = "$REMOTE" ]; then
        check_item "远程同步" "pass" "与远程同步"
    else
        check_item "远程同步" "fail" "本地与远程不同步"
    fi
}

# 检查版本号
check_version() {
    echo ""
    echo "2. 版本号检查"
    echo "----------------"

    # 检查build.gradle.kts中的版本号
    version_name=$(grep "versionName" app/build.gradle.kts | sed -E 's/.*"(.*)".*/\1/')
    version_code=$(grep "versionCode" app/build.gradle.kts | sed -E 's/.*= ([0-9]+).*/\1/')

    if [ "$version_name" = "0.26.2" ]; then
        check_item "版本名称" "warn" "仍然是 $version_name，应该更新为 0.32.0"
    else
        check_item "版本名称" "pass" "$version_name"
    fi

    check_item "版本代码" "pass" "$version_code"

    # 检查CHANGELOG是否包含当前版本
    if grep -q "\[0.32.0\]" CHANGELOG.md; then
        check_item "CHANGELOG更新" "pass" "包含v0.32.0条目"
    else
        check_item "CHANGELOG更新" "fail" "CHANGELOG.md缺少v0.32.0条目"
    fi
}

# 检查文档完整性
check_documentation() {
    echo ""
    echo "3. 文档完整性检查"
    echo "----------------"

    docs=(
        "docs/RELEASE_NOTES_v0.32.0.md"
        "docs/UPGRADE_GUIDE_v0.32.0.md"
        "docs/PERFORMANCE_OPTIMIZATION_REPORT.md"
        "docs/V0.32.0_FINAL_COMPLETION_REPORT.md"
    )

    for doc in "${docs[@]}"; do
        if [ -f "$doc" ]; then
            check_item "$(basename $doc)" "pass"
        else
            check_item "$(basename $doc)" "fail" "文件不存在"
        fi
    done
}

# 检查依赖和配置
check_dependencies() {
    echo ""
    echo "4. 依赖和配置检查"
    echo "----------------"

    # 检查ProGuard规则
    if [ -f "app/proguard-rules.pro" ]; then
        if grep -q "optimizationpasses" app/proguard-rules.pro; then
            check_item "ProGuard优化" "pass" "已配置激进优化"
        else
            check_item "ProGuard优化" "warn" "未找到优化配置"
        fi
    else
        check_item "ProGuard规则" "fail" "proguard-rules.pro不存在"
    fi

    # 检查资源压缩
    if grep -q "isShrinkResources = true" app/build.gradle.kts; then
        check_item "资源压缩" "pass" "已启用"
    else
        check_item "资源压缩" "fail" "未启用"
    fi

    # 检查AAB配置
    if grep -q "bundle {" app/build.gradle.kts; then
        check_item "App Bundle配置" "pass" "已配置"
    else
        check_item "App Bundle配置" "warn" "未找到bundle配置"
    fi
}

# 检查测试
check_tests() {
    echo ""
    echo "5. 测试检查"
    echo "----------------"

    # 检查测试文件是否存在
    test_files=(
        "feature-p2p/src/test/java/com/chainlesschain/android/feature/p2p/moderation/ContentModeratorTest.kt"
        "feature-p2p/src/androidTest/java/com/chainlesschain/android/feature/p2p/e2e/ModerationE2ETest.kt"
        "feature-p2p/src/androidTest/java/com/chainlesschain/android/feature/p2p/e2e/PerformanceE2ETest.kt"
    )

    for test_file in "${test_files[@]}"; do
        if [ -f "$test_file" ]; then
            check_item "$(basename $test_file)" "pass"
        else
            check_item "$(basename $test_file)" "warn" "测试文件不存在"
        fi
    done

    # 提示运行测试
    check_item "单元测试运行" "warn" "请手动运行: ./gradlew test"
    check_item "E2E测试运行" "warn" "请手动运行: ./gradlew connectedAndroidTest"
}

# 检查构建配置
check_build_config() {
    echo ""
    echo "6. 构建配置检查"
    echo "----------------"

    # 检查签名配置
    if grep -q "signingConfigs {" app/build.gradle.kts; then
        check_item "签名配置" "pass" "已配置"
    else
        check_item "签名配置" "fail" "未配置签名"
    fi

    # 检查混淆配置
    if grep -q "isMinifyEnabled = true" app/build.gradle.kts; then
        check_item "代码混淆" "pass" "Release版已启用"
    else
        check_item "代码混淆" "fail" "未启用代码混淆"
    fi

    # 检查WebP转换脚本
    if [ -f "scripts/convert_to_webp.sh" ]; then
        check_item "WebP转换脚本" "pass" "脚本存在"
        if [ -x "scripts/convert_to_webp.sh" ]; then
            check_item "脚本可执行权限" "pass"
        else
            check_item "脚本可执行权限" "warn" "需要 chmod +x"
        fi
    else
        check_item "WebP转换脚本" "fail" "脚本不存在"
    fi
}

# 检查性能优化实施
check_performance_optimization() {
    echo ""
    echo "7. 性能优化实施检查"
    echo "----------------"

    optimizations=(
        "app/src/main/java/com/chainlesschain/android/initializer/AppInitializer.kt:三级初始化"
        "core-ui/src/main/java/com/chainlesschain/android/core/ui/image/ImageLoadingConfig.kt:图片缓存优化"
        "feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/components/PostCardOptimized.kt:组件重组优化"
        "feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/ImagePreloader.kt:图片预加载"
    )

    for opt in "${optimizations[@]}"; do
        file="${opt%%:*}"
        name="${opt##*:}"
        if [ -f "$file" ]; then
            check_item "$name" "pass"
        else
            check_item "$name" "fail" "文件不存在: $file"
        fi
    done
}

# 检查AI审核系统
check_ai_moderation() {
    echo ""
    echo "8. AI审核系统检查"
    echo "----------------"

    moderation_files=(
        "feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/moderation/ContentModerator.kt:审核引擎"
        "feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/repository/moderation/ModerationQueueRepository.kt:审核仓库"
        "feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/moderation/ModerationQueueScreen.kt:审核UI"
        "core-database/src/main/java/com/chainlesschain/android/core/database/entity/moderation/ModerationQueueEntity.kt:数据模型"
    )

    for mod_file in "${moderation_files[@]}"; do
        file="${mod_file%%:*}"
        name="${mod_file##*:}"
        if [ -f "$file" ]; then
            check_item "$name" "pass"
        else
            check_item "$name" "fail" "文件不存在: $file"
        fi
    done
}

# 生成待办事项
generate_todos() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  待办事项 (TODO)${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "发布前必须完成："
    echo "  [ ] 更新版本号为0.32.0（app/build.gradle.kts）"
    echo "  [ ] 运行单元测试: ./gradlew test"
    echo "  [ ] 运行E2E测试: ./gradlew connectedAndroidTest"
    echo "  [ ] 执行WebP转换: ./scripts/convert_to_webp.sh"
    echo "  [ ] 构建Release APK: ./gradlew assembleRelease"
    echo "  [ ] 验证APK大小 <40MB"
    echo "  [ ] 在真机上测试性能"
    echo "  [ ] 更新README.md"
    echo "  [ ] 创建Git tag: git tag v0.32.0"
    echo "  [ ] 推送到远程: git push origin main --tags"
    echo ""
    echo "可选："
    echo "  [ ] 运行LeakCanary检测内存泄漏"
    echo "  [ ] 生成Baseline Profiles"
    echo "  [ ] 执行Macrobenchmark测试"
    echo "  [ ] 生成测试覆盖率报告"
    echo ""
}

# 打印总结
print_summary() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  检查结果总结${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "${GREEN}通过: $PASSED${NC}"
    echo -e "${YELLOW}警告: $WARNING${NC}"
    echo -e "${RED}失败: $FAILED${NC}"
    echo ""

    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}✅ 发布检查通过！${NC}"
        echo "建议: 完成待办事项后即可发布"
    else
        echo -e "${RED}❌ 发布检查失败！${NC}"
        echo "请修复失败的检查项后再发布"
    fi
    echo ""
}

# 主函数
main() {
    cd "$(dirname "$0")/.."  # 切换到项目根目录

    print_header
    check_git_status
    check_version
    check_documentation
    check_dependencies
    check_tests
    check_build_config
    check_performance_optimization
    check_ai_moderation
    generate_todos
    print_summary

    # 返回错误码
    if [ $FAILED -gt 0 ]; then
        exit 1
    else
        exit 0
    fi
}

main "$@"
