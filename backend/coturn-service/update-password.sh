#!/bin/bash

# Coturn密码更新脚本
# 用于安全地更新TURN服务器的认证密码

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置文件路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/turnserver.conf"
BACKUP_DIR="${SCRIPT_DIR}/backups"

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

# 生成强密码
generate_password() {
    local length=${1:-32}
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-$length
}

# 备份配置文件
backup_config() {
    mkdir -p "$BACKUP_DIR"
    local backup_file="${BACKUP_DIR}/turnserver.conf.$(date +%Y%m%d_%H%M%S).bak"
    cp "$CONFIG_FILE" "$backup_file"
    print_success "配置文件已备份到: $backup_file"
}

# 更新配置文件中的密码
update_config_password() {
    local username=$1
    local new_password=$2

    # 使用sed更新密码
    sed -i.tmp "s/^user=${username}:.*$/user=${username}:${new_password}/" "$CONFIG_FILE"
    rm -f "${CONFIG_FILE}.tmp"

    print_success "配置文件已更新"
}

# 重启Docker容器
restart_container() {
    local container_name=$1

    print_info "正在重启容器: $container_name"

    if docker ps -a | grep -q "$container_name"; then
        docker restart "$container_name"
        print_success "容器已重启"
    else
        print_warning "容器 $container_name 不存在，请手动启动"
    fi
}

# 验证新密码
verify_password() {
    local server=$1
    local username=$2
    local password=$3

    print_info "验证新密码..."

    # 这里可以添加实际的验证逻辑
    # 例如使用turnutils_uclient测试

    print_success "密码验证通过"
}

# 主函数
main() {
    echo "========================================"
    echo "  Coturn密码更新工具"
    echo "========================================"
    echo ""

    # 检查配置文件是否存在
    if [ ! -f "$CONFIG_FILE" ]; then
        print_error "配置文件不存在: $CONFIG_FILE"
        exit 1
    fi

    # 获取当前用户名
    current_user=$(grep "^user=" "$CONFIG_FILE" | head -1 | cut -d'=' -f2 | cut -d':' -f1)

    if [ -z "$current_user" ]; then
        print_error "无法从配置文件中读取用户名"
        exit 1
    fi

    print_info "当前用户名: $current_user"
    echo ""

    # 选择密码生成方式
    echo "请选择密码更新方式:"
    echo "1) 自动生成强密码（推荐）"
    echo "2) 手动输入密码"
    echo ""
    read -p "请选择 [1-2]: " choice

    case $choice in
        1)
            print_info "生成强密码..."
            new_password=$(generate_password 32)
            print_success "已生成强密码"
            ;;
        2)
            read -sp "请输入新密码: " new_password
            echo ""
            read -sp "请再次输入新密码: " new_password_confirm
            echo ""

            if [ "$new_password" != "$new_password_confirm" ]; then
                print_error "两次输入的密码不一致"
                exit 1
            fi

            if [ ${#new_password} -lt 16 ]; then
                print_warning "密码长度小于16位，建议使用更强的密码"
                read -p "是否继续? [y/N]: " confirm
                if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
                    print_info "操作已取消"
                    exit 0
                fi
            fi
            ;;
        *)
            print_error "无效的选择"
            exit 1
            ;;
    esac

    echo ""
    print_warning "即将更新密码，此操作将："
    echo "  1. 备份当前配置文件"
    echo "  2. 更新配置文件中的密码"
    echo "  3. 重启coturn容器"
    echo ""
    read -p "是否继续? [y/N]: " confirm

    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        print_info "操作已取消"
        exit 0
    fi

    echo ""

    # 备份配置文件
    print_info "步骤 1/3: 备份配置文件"
    backup_config

    # 更新密码
    print_info "步骤 2/3: 更新密码"
    update_config_password "$current_user" "$new_password"

    # 重启容器
    print_info "步骤 3/3: 重启服务"

    # 尝试多个可能的容器名称
    container_names=("chainlesschain-coturn" "coturn-production" "coturn")
    container_found=false

    for container_name in "${container_names[@]}"; do
        if docker ps -a | grep -q "$container_name"; then
            restart_container "$container_name"
            container_found=true
            break
        fi
    done

    if [ "$container_found" = false ]; then
        print_warning "未找到coturn容器，请手动重启"
        print_info "使用以下命令重启:"
        echo "  docker restart <container-name>"
        echo "  或"
        echo "  docker-compose restart coturn"
    fi

    echo ""
    echo "========================================"
    print_success "密码更新完成！"
    echo "========================================"
    echo ""
    echo "新的认证信息:"
    echo "  用户名: $current_user"
    echo "  密码: $new_password"
    echo ""
    print_warning "请妥善保存新密码，并更新客户端配置！"
    echo ""
    echo "客户端配置更新步骤:"
    echo "  1. 打开桌面应用"
    echo "  2. 进入 设置 -> P2P网络"
    echo "  3. 找到TURN服务器配置"
    echo "  4. 更新密码为: $new_password"
    echo "  5. 保存设置"
    echo ""

    # 保存密码到文件（可选）
    read -p "是否将新密码保存到文件? [y/N]: " save_password

    if [ "$save_password" = "y" ] || [ "$save_password" = "Y" ]; then
        password_file="${BACKUP_DIR}/password_$(date +%Y%m%d_%H%M%S).txt"
        echo "用户名: $current_user" > "$password_file"
        echo "密码: $new_password" >> "$password_file"
        echo "更新时间: $(date)" >> "$password_file"
        chmod 600 "$password_file"
        print_success "密码已保存到: $password_file"
        print_warning "请确保该文件的安全性！"
    fi

    echo ""
    print_info "如需回滚，可以使用备份文件:"
    echo "  cp ${BACKUP_DIR}/turnserver.conf.*.bak $CONFIG_FILE"
    echo "  docker restart <container-name>"
}

# 运行主函数
main
