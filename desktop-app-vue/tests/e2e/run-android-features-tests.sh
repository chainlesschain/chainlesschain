#!/bin/bash

# 安卓端功能对应页面 E2E 测试运行脚本
# 创建日期: 2026-01-25

echo "========================================="
echo "安卓端功能对应页面 E2E 测试"
echo "========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试文件列表
TEST_FILES=(
  "tests/e2e/llm/llm-test-chat.e2e.test.ts"
  "tests/e2e/p2p/device-pairing.e2e.test.ts"
  "tests/e2e/p2p/safety-numbers.e2e.test.ts"
  "tests/e2e/p2p/session-fingerprint.e2e.test.ts"
  "tests/e2e/p2p/device-management.e2e.test.ts"
  "tests/e2e/p2p/file-transfer.e2e.test.ts"
  "tests/e2e/p2p/message-queue.e2e.test.ts"
  "tests/e2e/test/android-features-test.e2e.test.ts"
)

# 测试文件名称
TEST_NAMES=(
  "LLM测试聊天"
  "设备配对"
  "安全号码验证"
  "会话指纹验证"
  "设备管理"
  "P2P文件传输"
  "消息队列管理"
  "Android功能测试入口"
)

# 统计变量
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
START_TIME=$(date +%s)

echo -e "${BLUE}开始运行测试...${NC}"
echo ""

# 检查是否指定了特定测试
if [ ! -z "$1" ]; then
  case $1 in
    "llm")
      echo -e "${YELLOW}运行 LLM 功能测试...${NC}"
      npm run test:e2e tests/e2e/llm/llm-test-chat.e2e.test.ts
      ;;
    "p2p")
      echo -e "${YELLOW}运行 P2P 功能测试...${NC}"
      npm run test:e2e tests/e2e/p2p/
      ;;
    "all")
      echo -e "${YELLOW}运行所有安卓功能测试...${NC}"
      for i in "${!TEST_FILES[@]}"; do
        echo ""
        echo -e "${BLUE}[$((i+1))/${#TEST_FILES[@]}] 运行: ${TEST_NAMES[$i]}${NC}"
        echo "文件: ${TEST_FILES[$i]}"
        echo "---"

        if npm run test:e2e "${TEST_FILES[$i]}"; then
          echo -e "${GREEN}✓ ${TEST_NAMES[$i]} 测试通过${NC}"
          ((PASSED_TESTS++))
        else
          echo -e "${RED}✗ ${TEST_NAMES[$i]} 测试失败${NC}"
          ((FAILED_TESTS++))
        fi
        ((TOTAL_TESTS++))
        echo ""
      done
      ;;
    *)
      echo -e "${RED}未知的测试类型: $1${NC}"
      echo "用法: ./run-android-features-tests.sh [llm|p2p|all]"
      echo "  llm  - 只运行LLM功能测试"
      echo "  p2p  - 只运行P2P功能测试"
      echo "  all  - 运行所有测试"
      exit 1
      ;;
  esac
else
  echo -e "${YELLOW}请指定要运行的测试类型:${NC}"
  echo "  ./run-android-features-tests.sh llm   - LLM功能测试"
  echo "  ./run-android-features-tests.sh p2p   - P2P功能测试"
  echo "  ./run-android-features-tests.sh all   - 所有测试"
  exit 0
fi

# 如果运行了所有测试，显示统计信息
if [ "$1" == "all" ]; then
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))

  echo ""
  echo "========================================="
  echo -e "${BLUE}测试结果统计${NC}"
  echo "========================================="
  echo "总测试文件数: $TOTAL_TESTS"
  echo -e "${GREEN}通过: $PASSED_TESTS${NC}"
  echo -e "${RED}失败: $FAILED_TESTS${NC}"
  echo "运行时间: ${DURATION}秒"
  echo ""

  if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✓ 所有测试通过!${NC}"
    exit 0
  else
    echo -e "${RED}✗ 有测试失败，请检查日志${NC}"
    exit 1
  fi
fi
