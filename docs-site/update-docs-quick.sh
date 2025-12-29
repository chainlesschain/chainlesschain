#!/bin/bash
# ChainlessChain 文档快速更新脚本 v0.17.0
# 使用方法: ./update-docs-quick.sh

echo "========================================"
echo "ChainlessChain 文档更新到 v0.17.0"
echo "========================================"
echo

echo "[1/5] 备份当前文档..."
BACKUP_DIR="docs-backup-$(date +%Y%m%d)"
cp -r docs "$BACKUP_DIR"
echo "备份完成: $BACKUP_DIR"
echo

echo "[2/5] 更新版本号..."
# 更新主页版本徽章
sed -i 's/version-v0\.9\.0/version-v0.17.0/g' docs/index.md
sed -i 's/progress-70%/progress-92%/g' docs/index.md

# 更新所有文档中的版本引用
find docs -name "*.md" -exec sed -i 's/v0\.9\.0/v0.17.0/g' {} \;
find docs -name "*.md" -exec sed -i 's/版本 0\.9\.0/版本 0.17.0/g' {} \;
echo "版本号更新完成"
echo

echo "[3/5] 更新版权年份..."
find docs -name "*.md" -exec sed -i 's/Copyright © 2024/Copyright © 2024-2025/g' {} \;
echo "版权年份更新完成"
echo

echo "[4/5] 更新配置文件..."
# 备份配置文件
cp docs/.vitepress/config.js docs/.vitepress/config.js.bak
echo "配置文件已备份: docs/.vitepress/config.js.bak"
echo "请手动编辑配置文件以添加新的侧边栏项"
echo "参考: DOCS_UPDATE_v0.17.0.md 第5节"
echo

echo "[5/5] 验证VitePress构建..."
if [ -d "node_modules" ]; then
    echo "提示: 运行 npm run docs:dev 进行测试"
else
    echo "警告: node_modules 不存在，请先运行: npm install"
fi
echo

echo "========================================"
echo "快速更新完成！"
echo "========================================"
echo
echo "下一步操作:"
echo "1. 查看 DOCS_UPDATE_v0.17.0.md 了解详细更改"
echo "2. 手动编辑关键文件（参考指南第1-5节）"
echo "3. 运行 npm run docs:dev 测试"
echo "4. 运行 npm run docs:build 构建"
echo
echo "详细文档: DOCS_UPDATE_v0.17.0.md"
echo

# 显示需要手动更新的文件列表
echo "需要手动编辑的文件:"
echo "  - docs/index.md (features部分)"
echo "  - docs/chainlesschain/overview.md (添加新功能板块)"
echo "  - docs/guide/getting-started.md (更新安装步骤)"
echo "  - docs/.vitepress/config.js (添加侧边栏项)"
echo

echo "新增文档页面（需创建）:"
echo "  - docs/chainlesschain/blockchain.md"
echo "  - docs/chainlesschain/skill-tools.md"
echo "  - docs/chainlesschain/speech.md"
echo "  - docs/chainlesschain/ai-engines.md"
echo "  - docs/chainlesschain/browser-extension.md"
echo "  - docs/guide/tech-stack.md"
echo
