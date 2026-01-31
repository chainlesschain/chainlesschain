#!/bin/bash
# 整理 desktop-app-vue 根目录文件脚本

set -e
cd "$(dirname "$0")/.."

echo "=== 开始整理根目录文件 ==="

# 1. 移动文档文件到对应目录
echo "1. 移动文档文件..."

# Features
if [ -f "EXTERNAL_DEVICE_FILE_FEATURE.md" ]; then
  git mv EXTERNAL_DEVICE_FILE_FEATURE.md docs/features/ 2>/dev/null || mv EXTERNAL_DEVICE_FILE_FEATURE.md docs/features/
  echo "  ✓ EXTERNAL_DEVICE_FILE_FEATURE.md -> docs/features/"
fi

if [ -f "MCP_POC_QUICKSTART.md" ]; then
  git mv MCP_POC_QUICKSTART.md docs/features/ 2>/dev/null || mv MCP_POC_QUICKSTART.md docs/features/
  echo "  ✓ MCP_POC_QUICKSTART.md -> docs/features/"
fi

# Optimization
if [ -f "OPTIMIZATION_PROGRESS_REPORT.md" ]; then
  git mv OPTIMIZATION_PROGRESS_REPORT.md docs/optimization/ 2>/dev/null || mv OPTIMIZATION_PROGRESS_REPORT.md docs/optimization/
  echo "  ✓ OPTIMIZATION_PROGRESS_REPORT.md -> docs/optimization/"
fi

if [ -f "OPTIMIZATION_RECOMMENDATIONS.md" ]; then
  git mv OPTIMIZATION_RECOMMENDATIONS.md docs/optimization/ 2>/dev/null || mv OPTIMIZATION_RECOMMENDATIONS.md docs/optimization/
  echo "  ✓ OPTIMIZATION_RECOMMENDATIONS.md -> docs/optimization/"
fi

# OPTIMIZATION_SUMMARY.md - 根目录是旧版本，删除
if [ -f "OPTIMIZATION_SUMMARY.md" ]; then
  git rm OPTIMIZATION_SUMMARY.md 2>/dev/null || rm OPTIMIZATION_SUMMARY.md
  echo "  ✓ OPTIMIZATION_SUMMARY.md (旧版本已删除，保留 docs/optimization/ 中的新版本)"
fi

# Deployment
if [ -f "PRODUCTION_BUILD_AND_ESLINT_FIXES.md" ]; then
  git mv PRODUCTION_BUILD_AND_ESLINT_FIXES.md docs/deployment/ 2>/dev/null || mv PRODUCTION_BUILD_AND_ESLINT_FIXES.md docs/deployment/
  echo "  ✓ PRODUCTION_BUILD_AND_ESLINT_FIXES.md -> docs/deployment/"
fi

if [ -f "PRODUCTION_DEPLOYMENT_CHECKLIST.md" ]; then
  git mv PRODUCTION_DEPLOYMENT_CHECKLIST.md docs/deployment/ 2>/dev/null || mv PRODUCTION_DEPLOYMENT_CHECKLIST.md docs/deployment/
  echo "  ✓ PRODUCTION_DEPLOYMENT_CHECKLIST.md -> docs/deployment/"
fi

# Releases
if [ -f "RELEASE.md" ]; then
  git mv RELEASE.md docs/releases/ 2>/dev/null || mv RELEASE.md docs/releases/
  echo "  ✓ RELEASE.md -> docs/releases/"
fi

if [ -f "RELEASE_NOTES_TEMPLATE.md" ]; then
  git mv RELEASE_NOTES_TEMPLATE.md docs/releases/ 2>/dev/null || mv RELEASE_NOTES_TEMPLATE.md docs/releases/
  echo "  ✓ RELEASE_NOTES_TEMPLATE.md -> docs/releases/"
fi

# Security
if [ -f "SQL_SECURITY_AUDIT.md" ]; then
  git mv SQL_SECURITY_AUDIT.md docs/security/ 2>/dev/null || mv SQL_SECURITY_AUDIT.md docs/security/
  echo "  ✓ SQL_SECURITY_AUDIT.md -> docs/security/"
fi

# General docs
if [ -f "FINAL_SUMMARY.md" ]; then
  git mv FINAL_SUMMARY.md docs/ 2>/dev/null || mv FINAL_SUMMARY.md docs/
  echo "  ✓ FINAL_SUMMARY.md -> docs/"
fi

# 2. 整理测试目录
echo -e "\n2. 整理测试目录..."

# 创建测试 fixtures 目录
mkdir -p tests/fixtures

# 移动 test-data 到 tests/fixtures/
if [ -d "test-data" ]; then
  git mv test-data tests/fixtures/data 2>/dev/null || mv test-data tests/fixtures/data
  echo "  ✓ test-data -> tests/fixtures/data"
fi

# 移动 test-plugin 到 tests/fixtures/
if [ -d "test-plugin" ]; then
  git mv test-plugin tests/fixtures/plugin 2>/dev/null || mv test-plugin tests/fixtures/plugin
  echo "  ✓ test-plugin -> tests/fixtures/plugin"
fi

# 3. 更新 .gitignore
echo -e "\n3. 更新 .gitignore..."
if ! grep -q "test-auto-mkdir" .gitignore; then
  echo "" >> .gitignore
  echo "# Test generated directories" >> .gitignore
  echo "test-auto-mkdir/" >> .gitignore
  echo "  ✓ 添加 test-auto-mkdir/ 到 .gitignore"
fi

echo -e "\n=== 整理完成 ==="
echo "请检查变更，然后提交："
echo "  git status"
echo "  git commit -m 'chore: reorganize root directory files'"
