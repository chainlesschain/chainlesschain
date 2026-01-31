#!/bin/bash

# ChainlessChain 官网 GitHub Pages 部署脚本 v0.21.0

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   ChainlessChain 官网 GitHub Pages 部署工具 v0.21.0    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 配置
DIST_DIR="dist"
BRANCH="gh-pages"
COMMIT_MESSAGE="Deploy website v0.21.0 - $(date '+%Y-%m-%d %H:%M:%S')"

# 检查 dist 目录
if [ ! -d "$DIST_DIR" ]; then
    echo -e "${RED}❌ dist 目录不存在，请先运行构建${NC}"
    echo ""
    echo "运行命令: npm run build"
    echo ""
    exit 1
fi

# 检查 git 仓库
if [ ! -d ".git" ]; then
    echo -e "${RED}❌ 当前目录不是 Git 仓库${NC}"
    exit 1
fi

echo -e "${BLUE}📋 部署信息:${NC}"
echo "   - 分支: $BRANCH"
echo "   - 源目录: $DIST_DIR"
echo "   - 提交信息: $COMMIT_MESSAGE"
echo ""

read -p "确认部署到 GitHub Pages? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ 已取消部署${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}🚀 开始部署...${NC}"
echo ""

# 进入 dist 目录
cd "$DIST_DIR" || exit 1

# 初始化 git（如果需要）
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}初始化 Git 仓库...${NC}"
    git init
    git checkout -b $BRANCH
fi

# 添加所有文件
echo -e "${YELLOW}添加文件到 Git...${NC}"
git add -A

# 提交
echo -e "${YELLOW}提交更改...${NC}"
git commit -m "$COMMIT_MESSAGE"

# 获取远程仓库地址
cd ..
REMOTE_URL=$(git config --get remote.origin.url)

if [ -z "$REMOTE_URL" ]; then
    echo -e "${RED}❌ 未找到远程仓库地址${NC}"
    echo ""
    echo "请先添加远程仓库:"
    echo "   git remote add origin <repository-url>"
    echo ""
    exit 1
fi

echo -e "${YELLOW}推送到 GitHub...${NC}"
echo "远程仓库: $REMOTE_URL"
echo ""

cd "$DIST_DIR" || exit 1

# 添加远程仓库（如果不存在）
if ! git remote | grep -q origin; then
    git remote add origin "$REMOTE_URL"
fi

# 强制推送到 gh-pages 分支
git push -f origin $BRANCH

PUSH_RESULT=$?

cd ..

# 检查结果
if [ $PUSH_RESULT -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ 部署成功！${NC}"
    echo ""
    echo -e "${BLUE}📝 下一步:${NC}"
    echo "   1. 访问 GitHub 仓库设置"
    echo "   2. 进入 Pages 设置页面"
    echo "   3. 选择 $BRANCH 分支作为源"
    echo "   4. 等待 GitHub Pages 构建完成（通常 1-2 分钟）"
    echo "   5. 访问网站测试"
    echo ""
    echo -e "${BLUE}🔗 可能的访问地址:${NC}"
    echo "   https://yourusername.github.io/chainlesschain"
    echo ""
else
    echo ""
    echo -e "${RED}❌ 部署失败！${NC}"
    echo ""
    echo "可能的原因:"
    echo "   1. 没有推送权限"
    echo "   2. 网络连接问题"
    echo "   3. 仓库不存在"
    echo ""
fi

exit $PUSH_RESULT
