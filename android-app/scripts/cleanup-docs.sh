#!/bin/bash
# Android App 文档整理脚本
# 用法: cd android-app && bash scripts/cleanup-docs.sh

set -e  # 遇到错误立即退出

echo "🧹 开始整理 android-app 文档目录..."
echo ""

# 检查是否在正确的目录
if [ ! -f "build.gradle.kts" ]; then
    echo "❌ 错误: 请在 android-app 根目录下执行此脚本"
    exit 1
fi

# 1. 创建目录结构
echo "📁 创建文档目录结构..."
mkdir -p docs/development-phases
mkdir -p docs/build-deployment
mkdir -p docs/ci-cd
mkdir -p docs/features/p2p
mkdir -p docs/optimization
mkdir -p docs/planning
mkdir -p docs/ui-ux

# 2. 移动开发阶段文档
echo "📝 移动开发阶段文档..."
if ls PHASE*.md 1> /dev/null 2>&1; then
    git mv PHASE*.md docs/development-phases/ 2>/dev/null || mv PHASE*.md docs/development-phases/
    echo "  ✓ 已移动根目录下的 PHASE*.md"
fi

if ls docs/PHASE*.md 1> /dev/null 2>&1; then
    git mv docs/PHASE*.md docs/development-phases/ 2>/dev/null || mv docs/PHASE*.md docs/development-phases/
    echo "  ✓ 已移动 docs/ 下的 PHASE*.md"
fi

# 3. 移动构建部署文档
echo "🏗️  移动构建部署文档..."
for file in BUILD_REQUIREMENTS.md; do
    if [ -f "$file" ]; then
        git mv "$file" docs/build-deployment/ 2>/dev/null || mv "$file" docs/build-deployment/
        echo "  ✓ $file"
    fi
done

for file in DEPLOYMENT_CHECKLIST.md RELEASE_TESTING_GUIDE.md ANDROID_SIGNING_SETUP.md GOOGLE_PLAY_SETUP.md; do
    if [ -f "docs/$file" ]; then
        git mv "docs/$file" docs/build-deployment/ 2>/dev/null || mv "docs/$file" docs/build-deployment/
        echo "  ✓ docs/$file"
    fi
done

# 4. 移动 CI/CD 文档
echo "🔄 移动 CI/CD 文档..."
for file in ANDROID_CI_CD_GUIDE.md ANDROID_CI_CD_COMPLETE.md CI_CD_ARCHITECTURE.md CI_EMULATOR_FIX.md; do
    if [ -f "docs/$file" ]; then
        git mv "docs/$file" docs/ci-cd/ 2>/dev/null || mv "docs/$file" docs/ci-cd/
        echo "  ✓ docs/$file"
    fi
done

# 5. 移动 P2P 文档
echo "🔗 移动 P2P 文档..."
if [ -f "P2P_INTEGRATION_SUMMARY.md" ]; then
    git mv P2P_INTEGRATION_SUMMARY.md docs/features/p2p/ 2>/dev/null || mv P2P_INTEGRATION_SUMMARY.md docs/features/p2p/
    echo "  ✓ P2P_INTEGRATION_SUMMARY.md"
fi

for file in P2P_API_REFERENCE.md P2P_USER_GUIDE.md P2P_DEVICE_MANAGEMENT_IMPLEMENTATION.md; do
    if [ -f "docs/$file" ]; then
        git mv "docs/$file" docs/features/p2p/ 2>/dev/null || mv "docs/$file" docs/features/p2p/
        echo "  ✓ docs/$file"
    fi
done

# 6. 移动优化测试文档
echo "⚡ 移动优化测试文档..."
if [ -f "OPTIMIZATION_SUMMARY.md" ]; then
    git mv OPTIMIZATION_SUMMARY.md docs/optimization/ 2>/dev/null || mv OPTIMIZATION_SUMMARY.md docs/optimization/
    echo "  ✓ OPTIMIZATION_SUMMARY.md"
fi

for file in OPTIMIZATION_COMPLETE.md INTEGRATION_TESTING_COMPLETE.md; do
    if [ -f "docs/$file" ]; then
        git mv "docs/$file" docs/optimization/ 2>/dev/null || mv "docs/$file" docs/optimization/
        echo "  ✓ docs/$file"
    fi
done

# 7. 移动项目规划文档
echo "📋 移动项目规划文档..."
if [ -f "ANDROID_PROJECT_ENHANCEMENT_PLAN.md" ]; then
    git mv ANDROID_PROJECT_ENHANCEMENT_PLAN.md docs/planning/ 2>/dev/null || mv ANDROID_PROJECT_ENHANCEMENT_PLAN.md docs/planning/
    echo "  ✓ ANDROID_PROJECT_ENHANCEMENT_PLAN.md"
fi

# 8. 移动 UI/UX 文档
echo "🎨 移动 UI/UX 文档..."
if [ -f "docs/APP_ICON_GUIDE.md" ]; then
    git mv docs/APP_ICON_GUIDE.md docs/ui-ux/ 2>/dev/null || mv docs/APP_ICON_GUIDE.md docs/ui-ux/
    echo "  ✓ docs/APP_ICON_GUIDE.md"
fi

# 9. 显示整理结果
echo ""
echo "✅ 文档整理完成！"
echo ""
echo "📊 整理统计："
echo "  - 开发阶段: $(ls docs/development-phases/*.md 2>/dev/null | wc -l) 个文件"
echo "  - 构建部署: $(ls docs/build-deployment/*.md 2>/dev/null | wc -l) 个文件"
echo "  - CI/CD: $(ls docs/ci-cd/*.md 2>/dev/null | wc -l) 个文件"
echo "  - P2P 功能: $(ls docs/features/p2p/*.md 2>/dev/null | wc -l) 个文件"
echo "  - 优化测试: $(ls docs/optimization/*.md 2>/dev/null | wc -l) 个文件"
echo "  - 项目规划: $(ls docs/planning/*.md 2>/dev/null | wc -l) 个文件"
echo "  - UI/UX: $(ls docs/ui-ux/*.md 2>/dev/null | wc -l) 个文件"
echo ""
echo "📁 根目录文件数: $(ls -1 *.md *.kts *.properties *.yml *.bat gradlew .editorconfig .gitignore 2>/dev/null | wc -l)"
echo ""
echo "💡 下一步:"
echo "  1. 查看变更: git status"
echo "  2. 确认无误后提交: git add . && git commit -m 'docs: reorganize android app documentation'"
echo "  3. 可以删除整理计划文件: rm DIRECTORY_CLEANUP_PLAN.md"
