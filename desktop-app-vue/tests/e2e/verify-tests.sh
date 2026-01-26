#!/bin/bash

# E2E测试验证脚本
# 用途：验证所有新创建的E2E测试文件的基本结构

echo "======================================"
echo "E2E测试验证脚本"
echo "======================================"
echo ""

# 定义颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 计数器
total_files=0
valid_files=0
invalid_files=0

# 新增测试目录
directories=(
  "knowledge"
  "social"
  "settings"
  "monitoring"
  "trading"
  "enterprise"
  "devtools"
  "content"
  "plugins"
  "multimedia"
)

echo "检查测试目录..."
echo ""

for dir in "${directories[@]}"; do
  dir_path="tests/e2e/$dir"

  if [ ! -d "$dir_path" ]; then
    echo -e "${RED}✗${NC} 目录不存在: $dir_path"
    continue
  fi

  echo -e "${GREEN}✓${NC} 目录存在: $dir_path"

  # 统计该目录下的测试文件
  file_count=$(find "$dir_path" -name "*.e2e.test.ts" -o -name "*.spec.ts" | wc -l)
  echo "  └─ 测试文件数: $file_count"

  # 检查每个测试文件
  for test_file in "$dir_path"/*.{e2e.test.ts,spec.ts} 2>/dev/null; do
    if [ -f "$test_file" ]; then
      total_files=$((total_files + 1))
      filename=$(basename "$test_file")

      # 检查文件是否包含基本结构
      has_import=$(grep -q "import.*@playwright/test" "$test_file" && echo "yes" || echo "no")
      has_helpers=$(grep -q "launchElectronApp\|closeElectronApp" "$test_file" && echo "yes" || echo "no")
      has_describe=$(grep -q "test.describe" "$test_file" && echo "yes" || echo "no")
      has_test=$(grep -q "test(" "$test_file" && echo "yes" || echo "no")

      if [ "$has_import" = "yes" ] && [ "$has_helpers" = "yes" ] && [ "$has_describe" = "yes" ] && [ "$has_test" = "yes" ]; then
        valid_files=$((valid_files + 1))
        echo -e "  ${GREEN}✓${NC} $filename"
      else
        invalid_files=$((invalid_files + 1))
        echo -e "  ${RED}✗${NC} $filename"
        [ "$has_import" = "no" ] && echo "      - 缺少 Playwright 导入"
        [ "$has_helpers" = "no" ] && echo "      - 缺少辅助函数"
        [ "$has_describe" = "no" ] && echo "      - 缺少 test.describe"
        [ "$has_test" = "no" ] && echo "      - 缺少测试用例"
      fi
    fi
  done

  echo ""
done

echo "======================================"
echo "验证结果统计"
echo "======================================"
echo -e "总文件数: $total_files"
echo -e "${GREEN}有效文件: $valid_files${NC}"
echo -e "${RED}无效文件: $invalid_files${NC}"
echo ""

if [ $invalid_files -eq 0 ]; then
  echo -e "${GREEN}✓ 所有测试文件验证通过！${NC}"
  exit 0
else
  echo -e "${YELLOW}⚠ 发现 $invalid_files 个问题文件，请检查${NC}"
  exit 1
fi
