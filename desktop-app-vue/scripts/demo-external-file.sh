#!/bin/bash

###############################################################################
# 外部设备文件管理功能 - 演示脚本
#
# 用途：快速启动演示环境并执行基本测试
###############################################################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖
check_dependencies() {
    print_info "检查依赖..."

    if ! command -v node &> /dev/null; then
        print_error "Node.js 未安装"
        exit 1
    fi

    if ! command -v npm &> /dev/null; then
        print_error "npm 未安装"
        exit 1
    fi

    print_success "依赖检查通过"
}

# 检查数据库Schema
check_database_schema() {
    print_info "检查数据库Schema..."

    local db_file="src/main/database.js"

    if ! grep -q "external_device_files" "$db_file"; then
        print_error "数据库Schema未包含 external_device_files 表"
        exit 1
    fi

    if ! grep -q "file_transfer_tasks" "$db_file"; then
        print_error "数据库Schema未包含 file_transfer_tasks 表"
        exit 1
    fi

    if ! grep -q "file_sync_logs" "$db_file"; then
        print_error "数据库Schema未包含 file_sync_logs 表"
        exit 1
    fi

    print_success "数据库Schema检查通过"
}

# 检查核心文件
check_core_files() {
    print_info "检查核心文件..."

    local files=(
        "src/main/p2p/file-sync-protocols.js"
        "src/main/file/external-device-file-manager.js"
        "src/main/file/external-device-file-ipc.js"
        "src/renderer/pages/ExternalDeviceBrowser.vue"
    )

    for file in "${files[@]}"; do
        if [ ! -f "$file" ]; then
            print_error "文件不存在: $file"
            exit 1
        fi
    done

    print_success "核心文件检查通过"
}

# 检查路由配置
check_router_config() {
    print_info "检查路由配置..."

    local router_file="src/renderer/router/index.js"

    if ! grep -q "external-devices" "$router_file"; then
        print_error "路由配置中未找到 external-devices"
        exit 1
    fi

    print_success "路由配置检查通过"
}

# 运行集成测试
run_integration_tests() {
    print_info "运行集成测试..."

    if [ ! -f "tests/integration/external-device-file.test.js" ]; then
        print_warning "集成测试文件不存在，跳过测试"
        return
    fi

    npm test tests/integration/external-device-file.test.js || {
        print_error "集成测试失败"
        exit 1
    }

    print_success "集成测试通过"
}

# 启动开发服务器
start_dev_server() {
    print_info "启动开发服务器..."

    print_warning "请确保："
    echo "  1. Android端应用已启动"
    echo "  2. 两设备在同一WiFi/局域网"
    echo "  3. Android端已授予文件访问权限"
    echo ""

    read -p "是否继续? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "已取消启动"
        exit 0
    fi

    print_info "正在启动..."
    npm run dev
}

# 显示使用说明
show_usage_guide() {
    cat << EOF

${GREEN}=== 外部设备文件管理功能 - 使用指南 ===${NC}

${BLUE}1. 访问功能：${NC}
   在浏览器中打开：http://localhost:5173/#/external-devices

${BLUE}2. 基本操作：${NC}
   a) 选择设备：从下拉列表选择Android设备
   b) 同步索引：点击"同步索引"按钮获取文件列表
   c) 浏览文件：使用分类过滤和搜索功能
   d) 拉取文件：点击"拉取"按钮下载文件到本地
   e) 导入RAG：点击"导入RAG"按钮将文件导入知识库

${BLUE}3. 测试场景：${NC}
   a) 索引同步：测试全量和增量同步
   b) 文件传输：测试小文件和大文件传输
   c) 缓存管理：查看缓存统计和执行清理
   d) RAG集成：导入文件并在AI聊天中测试检索

${BLUE}4. 查看日志：${NC}
   - 打开开发者工具（F12）
   - 切换到Console查看日志
   - 查看Network监控P2P消息

${BLUE}5. 数据库检查：${NC}
   sqlite3 data/chainlesschain.db
   SELECT * FROM external_device_files;
   SELECT * FROM file_transfer_tasks;
   SELECT * FROM file_sync_logs;

${GREEN}=== 常见问题 ===${NC}

${YELLOW}Q: 设备列表为空？${NC}
A: 检查网络连接和P2P服务状态

${YELLOW}Q: 同步索引失败？${NC}
A: 查看控制台错误日志，检查Android端权限

${YELLOW}Q: 文件传输中断？${NC}
A: 检查网络稳定性，保持设备唤醒

更多帮助请查看：EXTERNAL_DEVICE_FILE_FEATURE.md

EOF
}

# 主流程
main() {
    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║   外部设备文件管理功能 - 演示脚本                         ║"
    echo "║   ChainlessChain Desktop App                              ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # 切换到项目根目录
    cd "$(dirname "$0")/.." || exit 1

    # 执行检查
    check_dependencies
    check_database_schema
    check_core_files
    check_router_config

    echo ""
    print_success "所有检查通过！"
    echo ""

    # 询问是否运行测试
    read -p "是否运行集成测试? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        run_integration_tests
    fi

    # 显示使用指南
    show_usage_guide

    # 启动开发服务器
    start_dev_server
}

# 执行主流程
main "$@"
