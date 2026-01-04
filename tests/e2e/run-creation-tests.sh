#!/bin/bash

# 项目创建流程 E2E 测试运行脚本
# 自动化测试前的准备工作和测试执行

set -e  # 遇到错误立即退出

echo "=============================================="
echo "  ChainlessChain 项目创建流程 E2E 测试"
echo "=============================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ 错误: 请在项目根目录运行此脚本${NC}"
  exit 1
fi

# 步骤 1: 检查依赖
echo -e "${YELLOW}📦 步骤 1/5: 检查依赖...${NC}"
if [ ! -d "node_modules" ]; then
  echo "  安装根目录依赖..."
  npm install
fi

if [ ! -d "desktop-app-vue/node_modules" ]; then
  echo "  安装桌面应用依赖..."
  cd desktop-app-vue && npm install && cd ..
fi
echo -e "${GREEN}✓ 依赖检查完成${NC}"
echo ""

# 步骤 2: 构建应用
echo -e "${YELLOW}🔨 步骤 2/5: 构建桌面应用...${NC}"
echo "  这可能需要几分钟时间..."
cd desktop-app-vue

# 检查是否已经构建
if [ ! -d "dist/main" ] || [ ! -f "dist/main/index.js" ]; then
  npm run build
  echo -e "${GREEN}✓ 应用构建完成${NC}"
else
  echo -e "${GREEN}✓ 应用已构建，跳过${NC}"
fi

cd ..
echo ""

# 步骤 3: 初始化数据库（可选）
echo -e "${YELLOW}💾 步骤 3/5: 检查数据库...${NC}"
if [ -f "scripts/init-database.js" ]; then
  if [ ! -f "desktop-app-vue/data/chainlesschain.db" ]; then
    echo "  初始化数据库..."
    npm run init:db || echo "  ⚠️  数据库初始化可选，继续测试..."
  else
    echo -e "${GREEN}✓ 数据库已存在${NC}"
  fi
else
  echo "  ⚠️  未找到数据库初始化脚本，跳过"
fi
echo ""

# 步骤 4: 检查 Playwright
echo -e "${YELLOW}🎭 步骤 4/5: 检查 Playwright...${NC}"
if ! command -v playwright &> /dev/null; then
  echo "  安装 Playwright..."
  npx playwright install
else
  echo -e "${GREEN}✓ Playwright 已安装${NC}"
fi
echo ""

# 步骤 5: 运行测试
echo -e "${YELLOW}🧪 步骤 5/5: 运行 E2E 测试...${NC}"
echo ""
echo "=============================================="
echo "  开始测试..."
echo "=============================================="
echo ""

# 根据参数选择测试模式
case "${1:-all}" in
  "debug")
    echo "  运行模式: 调试模式"
    npm run test:e2e:debug tests/e2e/project-creation-workflow.e2e.test.ts
    ;;
  "ui")
    echo "  运行模式: UI 模式"
    npm run test:e2e:ui tests/e2e/project-creation-workflow.e2e.test.ts
    ;;
  "template")
    echo "  运行范围: 仅模板选择功能"
    playwright test tests/e2e/project-creation-workflow.e2e.test.ts -g "模板选择功能"
    ;;
  "skill")
    echo "  运行范围: 仅技能和工具选择"
    playwright test tests/e2e/project-creation-workflow.e2e.test.ts -g "技能和工具选择功能"
    ;;
  "workflow")
    echo "  运行范围: 仅完整创建流程"
    playwright test tests/e2e/project-creation-workflow.e2e.test.ts -g "完整项目创建流程"
    ;;
  "all"|*)
    echo "  运行范围: 所有测试"
    npm run test:e2e:creation
    ;;
esac

# 检查测试结果
TEST_EXIT_CODE=$?

echo ""
echo "=============================================="
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✅ 测试完成！所有测试通过${NC}"
  echo ""
  echo "📊 查看测试报告:"
  echo "   npm run test:e2e:report"
else
  echo -e "${RED}❌ 测试失败！${NC}"
  echo ""
  echo "🔍 查看详细信息:"
  echo "   1. 运行 UI 模式: ./tests/e2e/run-creation-tests.sh ui"
  echo "   2. 运行调试模式: ./tests/e2e/run-creation-tests.sh debug"
  echo "   3. 查看测试报告: npm run test:e2e:report"
fi
echo "=============================================="
echo ""

# 显示帮助信息
if [ "${1}" == "help" ] || [ "${1}" == "-h" ] || [ "${1}" == "--help" ]; then
  echo "用法: ./tests/e2e/run-creation-tests.sh [模式]"
  echo ""
  echo "可用模式:"
  echo "  all       - 运行所有测试（默认）"
  echo "  debug     - 调试模式运行"
  echo "  ui        - UI 可视化模式运行"
  echo "  template  - 仅测试模板选择功能"
  echo "  skill     - 仅测试技能和工具选择"
  echo "  workflow  - 仅测试完整创建流程"
  echo "  help      - 显示此帮助信息"
  echo ""
  echo "示例:"
  echo "  ./tests/e2e/run-creation-tests.sh"
  echo "  ./tests/e2e/run-creation-tests.sh ui"
  echo "  ./tests/e2e/run-creation-tests.sh template"
  echo ""
fi

exit $TEST_EXIT_CODE
