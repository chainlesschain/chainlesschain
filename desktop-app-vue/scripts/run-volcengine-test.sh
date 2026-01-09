#!/bin/bash

echo "========================================"
echo "火山引擎豆包功能测试"
echo "========================================"
echo ""

echo "选择测试类型:"
echo "1. 基础功能测试（无需API Key）"
echo "2. E2E完整测试（需要API Key）"
echo ""
read -p "请输入选项 (1 或 2): " choice

case $choice in
  1)
    echo ""
    echo "========== 运行基础功能测试 =========="
    echo ""
    node src/main/llm/volcengine-text-test.js
    ;;
  2)
    echo ""
    echo "========== 运行 E2E 完整测试 =========="
    echo ""
    echo "提示: 确保已配置火山引擎 API Key"
    echo ""
    npm run test:e2e -- volcengine-text.e2e.test.ts
    ;;
  *)
    echo "无效选项！"
    exit 1
    ;;
esac

echo ""
echo "========================================"
echo "测试完成！"
echo "========================================"
