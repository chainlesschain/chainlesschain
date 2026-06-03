#!/bin/bash

# 移动端P2P功能测试 - 一键启动脚本
# 创建日期: 2026-01-07

echo "╔════════════════════════════════════════════════════════╗"
echo "║     ChainlessChain 移动端P2P功能测试 - 启动脚本      ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目路径
PROJECT_ROOT="/Users/mac/Documents/code2/chainlesschain"
MOBILE_APP="$PROJECT_ROOT/mobile-app-uniapp"
DESKTOP_APP="$PROJECT_ROOT/desktop-app-vue"

echo "${BLUE}📋 测试前检查...${NC}"
echo ""

# 1. 检查信令服务器
echo -n "1️⃣  检查信令服务器 (port 9001)... "
if lsof -i :9001 >/dev/null 2>&1; then
    echo "${GREEN}✅ 运行中${NC}"
else
    echo "${RED}❌ 未运行${NC}"
    echo "${YELLOW}   请先启动信令服务器:${NC}"
    echo "   cd $PROJECT_ROOT/signaling-server"
    echo "   npm start"
    exit 1
fi

# 2. 检查PC端应用
echo -n "2️⃣  检查PC端应用 (port 5173)... "
if lsof -i :5173 >/dev/null 2>&1; then
    echo "${GREEN}✅ 运行中${NC}"
else
    echo "${RED}❌ 未运行${NC}"
    echo "${YELLOW}   请先启动PC端应用:${NC}"
    echo "   cd $DESKTOP_APP"
    echo "   npm run dev"
    exit 1
fi

# 3. 检查测试数据
echo -n "3️⃣  检查测试数据库... "
DB_PATH="$HOME/Library/Application Support/chainlesschain-desktop-vue/data/chainlesschain.db"
if [ -f "$DB_PATH" ]; then
    NOTE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM notes;" 2>/dev/null || echo "0")
    if [ "$NOTE_COUNT" -ge 25 ]; then
        echo "${GREEN}✅ 就绪 ($NOTE_COUNT 条笔记)${NC}"
    else
        echo "${YELLOW}⚠️  笔记数量不足 ($NOTE_COUNT 条)${NC}"
        echo "${YELLOW}   建议重新初始化测试数据:${NC}"
        echo "   cd $DESKTOP_APP"
        echo "   node scripts/init-test-database.js"
    fi
else
    echo "${RED}❌ 数据库不存在${NC}"
    exit 1
fi

# 4. 检查移动端依赖
echo -n "4️⃣  检查移动端依赖... "
if [ -d "$MOBILE_APP/node_modules" ]; then
    echo "${GREEN}✅ 已安装${NC}"
else
    echo "${YELLOW}⚠️  未安装，正在安装...${NC}"
    cd "$MOBILE_APP"
    npm install
    if [ $? -eq 0 ]; then
        echo "${GREEN}✅ 安装完成${NC}"
    else
        echo "${RED}❌ 安装失败${NC}"
        exit 1
    fi
fi

echo ""
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}✅ 所有检查通过！准备启动移动端开发服务器...${NC}"
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 5. 启动移动端H5开发服务器
echo "${BLUE}🚀 启动移动端H5开发服务器...${NC}"
echo ""
cd "$MOBILE_APP"

# 检查是否已有服务器在运行
if lsof -i :8080 >/dev/null 2>&1; then
    echo "${YELLOW}⚠️  端口 8080 已被占用${NC}"
    echo "是否要停止现有服务器？(y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        lsof -ti :8080 | xargs kill -9
        echo "${GREEN}✅ 已停止现有服务器${NC}"
    else
        echo "${YELLOW}使用现有服务器...${NC}"
    fi
fi

echo ""
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${BLUE}📱 移动端应用启动中...${NC}"
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "${YELLOW}请在新终端窗口中运行以下命令:${NC}"
echo ""
echo "   cd $MOBILE_APP"
echo "   npm run dev:h5"
echo ""
echo "${YELLOW}或者直接在HBuilderX中打开项目并运行${NC}"
echo ""
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 6. 打开测试文档
echo "${BLUE}📖 测试文档位置:${NC}"
echo ""
echo "   ✅ 测试执行清单:"
echo "      $PROJECT_ROOT/MOBILE_TEST_EXECUTION_CHECKLIST.md"
echo ""
echo "   ✅ 快速启动指南:"
echo "      $PROJECT_ROOT/TESTING_QUICK_START.md"
echo ""
echo "   ✅ 测试报告模板:"
echo "      $PROJECT_ROOT/MOBILE_P2P_TEST_REPORT.md"
echo ""

# 7. 显示测试步骤
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}🎯 接下来的测试步骤:${NC}"
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "1️⃣  ${YELLOW}启动移动端${NC}"
echo "   - 在新终端运行: cd $MOBILE_APP && npm run dev:h5"
echo "   - 或在HBuilderX中打开项目并运行"
echo "   - 等待浏览器自动打开应用"
echo ""
echo "2️⃣  ${YELLOW}设备配对${NC} (3分钟)"
echo "   PC端: 设置 > P2P配对 > 生成配对码"
echo "   移动端: 输入6位码 > 开始配对"
echo ""
echo "3️⃣  ${YELLOW}执行测试${NC} (25分钟)"
echo "   ✓ PC状态监控 (2分钟)"
echo "   ✓ 知识库同步 + Markdown渲染 (5分钟) ⭐⭐⭐⭐⭐"
echo "   ✓ 项目文件同步 (5分钟)"
echo "   ✓ 代码语法高亮 (3分钟) ⭐⭐⭐⭐⭐"
echo "   ✓ 文件操作 (3分钟)"
echo "   ✓ 智能缓存性能 (3分钟) ⭐⭐⭐⭐⭐"
echo ""
echo "4️⃣  ${YELLOW}填写报告${NC}"
echo "   打开: $PROJECT_ROOT/MOBILE_P2P_TEST_REPORT.md"
echo "   记录所有测试结果和问题"
echo ""

# 8. 显示访问地址
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}🌐 服务地址:${NC}"
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "   信令服务器: ${GREEN}http://localhost:9001${NC}"
echo "   PC端应用:    ${GREEN}http://localhost:5173${NC}"
echo "   移动端应用:  ${GREEN}http://localhost:8080${NC} (启动后)"
echo ""

# 9. 提示
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${YELLOW}💡 测试技巧:${NC}"
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "   • 打开浏览器开发者工具 (F12) 查看日志"
echo "   • 同时打开测试清单文档边测边勾选"
echo "   • 截图保存重要界面和问题现场"
echo "   • 记录所有加载时间和性能数据"
echo ""

echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}✨ 准备就绪！祝测试顺利！${NC}"
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
