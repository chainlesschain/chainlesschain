#!/bin/bash

# 批量测试所有新创建的E2E测试模块
# 每个模块运行1-2个测试文件作为验证

echo "======================================"
echo "E2E测试批量验证"
echo "======================================"
echo ""

# 测试计数
total=0
passed=0
failed=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# 测试函数
run_test() {
  local module=$1
  local file=$2
  total=$((total + 1))

  echo "测试 $module/$file..."
  if npx playwright test tests/e2e/$module/$file --timeout=60000 --reporter=dot > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $module/$file 通过"
    passed=$((passed + 1))
  else
    echo -e "${RED}✗${NC} $module/$file 失败"
    failed=$((failed + 1))
  fi
}

# 运行测试
run_test "knowledge" "knowledge-graph.e2e.test.ts"
run_test "knowledge" "file-import.e2e.test.ts"

run_test "social" "contacts.e2e.test.ts"
run_test "social" "friends.e2e.test.ts"

run_test "project" "project-workspace.e2e.test.ts"
run_test "project" "project-categories.e2e.test.ts"

run_test "settings" "general-settings.e2e.test.ts"
run_test "settings" "system-settings.e2e.test.ts"

run_test "monitoring" "database-performance.e2e.test.ts"
run_test "monitoring" "llm-performance.e2e.test.ts"

run_test "trading" "trading-hub.e2e.test.ts"
run_test "trading" "marketplace.e2e.test.ts"

run_test "enterprise" "organizations.e2e.test.ts"
run_test "enterprise" "enterprise-dashboard.e2e.test.ts"

run_test "devtools" "webide.e2e.test.ts"

run_test "content" "rss-feeds.e2e.test.ts"
run_test "content" "email-accounts.e2e.test.ts"

run_test "plugins" "plugin-marketplace.e2e.test.ts"

run_test "multimedia" "audio-import.e2e.test.ts"

echo ""
echo "======================================"
echo "测试总结"
echo "======================================"
echo "总测试数: $total"
echo -e "${GREEN}通过: $passed${NC}"
echo -e "${RED}失败: $failed${NC}"
echo "成功率: $((passed * 100 / total))%"
echo "======================================"
