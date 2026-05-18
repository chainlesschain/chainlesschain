#!/bin/bash

# AI 智能化流程 E2E 测试运行脚本

set -e

echo "=============================================="
echo "  AI 智能化项目创建流程 E2E 测试"
echo "=============================================="
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 显示帮助
if [ "${1}" == "help" ] || [ "${1}" == "-h" ] || [ "${1}" == "--help" ]; then
  echo "用法: ./tests/e2e/run-ai-flow-tests.sh [测试范围]"
  echo ""
  echo "测试范围:"
  echo "  all          - 运行所有测试（默认）"
  echo "  intent       - 仅测试意图识别"
  echo "  template     - 仅测试模板推荐"
  echo "  skill        - 仅测试技能工具选择"
  echo "  task         - 仅测试任务调度"
  echo "  verify       - 仅测试最终验证"
  echo "  integration  - 仅测试完整集成流程"
  echo "  performance  - 仅测试性能基准"
  echo "  ui           - UI 可视化模式"
  echo "  debug        - 调试模式"
  echo ""
  echo "示例:"
  echo "  ./tests/e2e/run-ai-flow-tests.sh"
  echo "  ./tests/e2e/run-ai-flow-tests.sh intent"
  echo "  ./tests/e2e/run-ai-flow-tests.sh integration"
  echo ""
  exit 0
fi

# 检查依赖
echo -e "${YELLOW}检查依赖...${NC}"
if [ ! -d "desktop-app-vue/dist/main" ]; then
  echo -e "${YELLOW}应用未构建，正在构建...${NC}"
  cd desktop-app-vue && npm run build && cd ..
fi
echo -e "${GREEN}✓ 依赖检查完成${NC}"
echo ""

# 选择测试范围
case "${1:-all}" in
  "intent")
    echo -e "${BLUE}测试范围: 用户意图识别${NC}"
    playwright test tests/e2e/ai-intelligent-creation.e2e.test.ts -g "用户意图识别"
    ;;
  "template")
    echo -e "${BLUE}测试范围: 智能模板推荐${NC}"
    playwright test tests/e2e/ai-intelligent-creation.e2e.test.ts -g "智能模板推荐"
    ;;
  "skill")
    echo -e "${BLUE}测试范围: 技能工具选择${NC}"
    playwright test tests/e2e/ai-intelligent-creation.e2e.test.ts -g "智能技能和工具选择"
    ;;
  "task")
    echo -e "${BLUE}测试范围: 任务调度和执行${NC}"
    playwright test tests/e2e/ai-intelligent-creation.e2e.test.ts -g "任务调度和执行"
    ;;
  "verify")
    echo -e "${BLUE}测试范围: 最终任务完成验证${NC}"
    playwright test tests/e2e/ai-intelligent-creation.e2e.test.ts -g "最终任务完成验证"
    ;;
  "integration")
    echo -e "${BLUE}测试范围: 端到端智能化流程集成${NC}"
    playwright test tests/e2e/ai-intelligent-creation.e2e.test.ts -g "端到端智能化流程集成"
    ;;
  "performance")
    echo -e "${BLUE}测试范围: 性能和质量基准${NC}"
    playwright test tests/e2e/ai-intelligent-creation.e2e.test.ts -g "性能和质量基准"
    ;;
  "ui")
    echo -e "${BLUE}运行模式: UI 可视化${NC}"
    npm run test:e2e:ui tests/e2e/ai-intelligent-creation.e2e.test.ts
    ;;
  "debug")
    echo -e "${BLUE}运行模式: 调试模式${NC}"
    npm run test:e2e:debug tests/e2e/ai-intelligent-creation.e2e.test.ts
    ;;
  *)
    echo -e "${BLUE}测试范围: 所有测试${NC}"
    npm run test:e2e:ai-flow
    ;;
esac

TEST_EXIT_CODE=$?

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✅ 测试完成！${NC}"
  echo ""
  echo "📊 查看详细报告:"
  echo "   npm run test:e2e:report"
else
  echo -e "${YELLOW}⚠️ 部分测试失败${NC}"
  echo ""
  echo "💡 提示:"
  echo "   某些 AI 功能可能未实现，这是正常的"
  echo "   测试会在相关接口不存在时跳过验证"
  echo ""
  echo "查看详细信息:"
  echo "   npm run test:e2e:report"
fi

exit $TEST_EXIT_CODE
