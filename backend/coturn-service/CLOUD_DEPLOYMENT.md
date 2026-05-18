# Coturn云服务器部署指南

本指南将帮助您在云服务器上部署生产环境的STUN/TURN服务器。

## 支持的云平台

- 阿里云 ECS
- 腾讯云 CVM
- AWS EC2
- Azure VM
- Google Cloud Compute Engine
- 其他支持Docker的Linux服务器

## 前置要求

- Linux服务器（推荐Ubuntu 20.04+或CentOS 7+）
- 公网IP地址
- Docker和Docker Compose已安装
- Root或sudo权限

## 一、服务器准备

### 1.1 安装Docker

#### Ubuntu/Debian

```bash
# 更新包索引
sudo apt-get update

# 安装依赖
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# 添加Docker官方GPG密钥
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# 设置稳定版仓库
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 启动Docker
sudo systemctl start docker
sudo systemctl enable docker
```

#### CentOS/RHEL

```bash
# 安装依赖
sudo yum install -y yum-utils

# 添加Docker仓库
sudo yum-config-manager \
    --add-repo \
    https://download.docker.com/linux/centos/docker-ce.repo

# 安装Docker
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 启动Docker
sudo systemctl start docker
sudo systemctl enable docker
```

### 1.2 安装Docker Compose

```bash
# 下载Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# 添加执行权限
sudo chmod +x /usr/local/bin/docker-compose

# 验证安装
docker-compose --version
```

## 二、配置防火墙

### 2.1 阿里云/腾讯云安全组

登录云控制台，配置安全组规则：

| 协议 | 端口 | 源地址 | 说明 |
|------|------|--------|------|
| TCP | 3478 | 0.0.0.0/0 | STUN/TURN |
| UDP | 3478 | 0.0.0.0/0 | STUN/TURN |
| TCP | 5349 | 0.0.0.0/0 | STUN/TURN TLS |
| UDP | 5349 | 0.0.0.0/0 | STUN/TURN TLS |
| UDP | 49152-49252 | 0.0.0.0/0 | TURN中继 |

### 2.2 AWS安全组

在EC2控制台 -> 安全组 -> 入站规则中添加：

```
类型: 自定义TCP
端口范围: 3478
源: 0.0.0.0/0

类型: 自定义UDP
端口范围: 3478
源: 0.0.0.0/0

类型: 自定义TCP
端口范围: 5349
源: 0.0.0.0/0

类型: 自定义UDP
端口范围: 5349
源: 0.0.0.0/0

类型: 自定义UDP
端口范围: 49152-49252
源: 0.0.0.0/0
```

### 2.3 服务器防火墙（UFW）

```bash
# Ubuntu/Debian
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:49252/udp
sudo ufw reload
```

### 2.4 服务器防火墙（firewalld）

```bash
# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=3478/tcp
sudo firewall-cmd --permanent --add-port=3478/udp
sudo firewall-cmd --permanent --add-port=5349/tcp
sudo firewall-cmd --permanent --add-port=5349/udp
sudo firewall-cmd --permanent --add-port=49152-49252/udp
sudo firewall-cmd --reload
```

## 三、部署Coturn服务

### 3.1 上传文件

将以下文件上传到服务器（例如 `/opt/chainlesschain/`）：

```bash
# 创建目录
sudo mkdir -p /opt/chainlesschain/backend/coturn-service
cd /opt/chainlesschain

# 上传文件（使用scp或其他方式）
# - backend/coturn-service/Dockerfile
# - backend/coturn-service/turnserver.conf
# - docker-compose.yml（或创建单独的coturn配置）
```

### 3.2 获取公网IP

```bash
# 获取服务器公网IP
curl ifconfig.me
# 或
curl ipinfo.io/ip
```

记录这个IP地址，例如：`123.45.67.89`

### 3.3 修改配置文件

编辑 `backend/coturn-service/turnserver.conf`：

```bash
sudo nano /opt/chainlesschain/backend/coturn-service/turnserver.conf
```

修改以下配置：

```conf
# 设置公网IP（重要！）
external-ip=123.45.67.89

# 修改密码（重要！）
user=chainlesschain:YOUR_STRONG_PASSWORD_HERE

# 其他配置保持不变
```

**生成强密码示例**：

```bash
# 生成随机密码
openssl rand -base64 32
```

### 3.4 创建Docker Compose配置

创建 `/opt/chainlesschain/docker-compose.coturn.yml`：

```yaml
version: '3.8'

services:
  coturn:
    build:
      context: ./backend/coturn-service
      dockerfile: Dockerfile
    container_name: coturn-production
    ports:
      - "3478:3478"
      - "3478:3478/udp"
      - "5349:5349"
      - "5349:5349/udp"
      - "49152-49252:49152-49252/udp"
    volumes:
      - ./backend/coturn-service/turnserver.conf:/etc/coturn/turnserver.conf:ro
      - coturn-logs:/var/log/coturn
    environment:
      - DETECT_EXTERNAL_IP=yes
    restart: always
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  coturn-logs:
```

### 3.5 启动服务

```bash
cd /opt/chainlesschain

# 构建并启动
sudo docker-compose -f docker-compose.coturn.yml up -d

# 查看日志
sudo docker-compose -f docker-compose.coturn.yml logs -f coturn
```

## 四、验证部署

### 4.1 检查容器状态

```bash
sudo docker ps | grep coturn
```

应该看到类似输出：
```
CONTAINER ID   IMAGE                  STATUS         PORTS
abc123def456   coturn-production      Up 2 minutes   0.0.0.0:3478->3478/tcp, ...
```

### 4.2 检查端口监听

```bash
sudo netstat -tulpn | grep 3478
```

应该看到：
```
tcp        0      0 0.0.0.0:3478            0.0.0.0:*               LISTEN      -
udp        0      0 0.0.0.0:3478            0.0.0.0:*                           -
```

### 4.3 使用在线工具测试

访问 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

配置：
```json
[
  {
    "urls": "stun:123.45.67.89:3478"
  },
  {
    "urls": "turn:123.45.67.89:3478",
    "username": "chainlesschain",
    "credential": "YOUR_STRONG_PASSWORD_HERE"
  }
]
```

点击 "Gather candidates"，应该看到：
- `srflx` 候选（STUN成功）
- `relay` 候选（TURN成功）

### 4.4 使用命令行测试

在本地机器上运行：

```bash
# 测试STUN
node backend/coturn-service/test-stun-turn.js \
  STUN_SERVER=123.45.67.89 \
  TURN_SERVER=123.45.67.89 \
  TURN_USERNAME=chainlesschain \
  TURN_PASSWORD=YOUR_STRONG_PASSWORD_HERE
```

## 五、配置客户端

### 5.1 桌面应用配置

在桌面应用的系统设置 -> P2P网络中：

1. **STUN服务器**：
   - 添加：`stun:123.45.67.89:3478`

2. **TURN服务器**：
   - 启用TURN
   - URL：`turn:123.45.67.89:3478`
   - 用户名：`chainlesschain`
   - 密码：`YOUR_STRONG_PASSWORD_HERE`

### 5.2 或使用一键配置

如果您的服务器IP是固定的，可以修改桌面应用的快速配置功能：

编辑 `desktop-app-vue/src/renderer/pages/settings/SystemSettings.vue`：

```javascript
const handleQuickSetupProductionCoturn = () => {
  const serverIP = '123.45.67.89'; // 您的服务器IP
  const password = 'YOUR_STRONG_PASSWORD_HERE'; // 您的密码

  // 添加生产STUN服务器
  const stunServer = `stun:${serverIP}:3478`;
  if (!config.value.p2p.stun.servers.includes(stunServer)) {
    config.value.p2p.stun.servers.unshift(stunServer);
  }

  // 启用TURN
  config.value.p2p.turn.enabled = true;

  // 添加生产TURN服务器
  const turnServer = {
    urls: `turn:${serverIP}:3478`,
    username: 'chainlesschain',
    credential: password
  };

  const exists = config.value.p2p.turn.servers.some(
    server => server.urls === turnServer.urls
  );

  if (!exists) {
    config.value.p2p.turn.servers.unshift(turnServer);
  }

  message.success('生产环境coturn服务器配置已完成！');
};
```

## 六、监控和维护

### 6.1 查看日志

```bash
# 实时日志
sudo docker logs -f coturn-production

# 最近100行
sudo docker logs --tail 100 coturn-production

# 导出日志
sudo docker logs coturn-production > coturn.log
```

### 6.2 查看资源使用

```bash
# 容器资源使用
sudo docker stats coturn-production

# 系统资源
htop
```

### 6.3 查看连接统计

```bash
# 进入容器
sudo docker exec -it coturn-production sh

# 查看活跃连接
netstat -an | grep 3478 | wc -l
```

### 6.4 设置监控告警

#### 使用cron定时检查

创建 `/opt/chainlesschain/check-coturn.sh`：

```bash
#!/bin/bash

# 检查容器是否运行
if ! docker ps | grep -q coturn-production; then
    echo "Coturn容器未运行，正在重启..."
    cd /opt/chainlesschain
    docker-compose -f docker-compose.coturn.yml up -d

    # 发送告警（可选）
    # curl -X POST "https://your-webhook-url" \
    #   -d "Coturn服务已重启"
fi

# 检查端口是否监听
if ! netstat -tulpn | grep -q ":3478"; then
    echo "端口3478未监听，正在重启容器..."
    docker restart coturn-production
fi
```

添加到crontab：

```bash
# 编辑crontab
sudo crontab -e

# 添加每5分钟检查一次
*/5 * * * * /opt/chainlesschain/check-coturn.sh >> /var/log/coturn-check.log 2>&1
```

## 七、性能优化

### 7.1 调整系统参数

编辑 `/etc/sysctl.conf`：

```conf
# 增加文件描述符限制
fs.file-max = 1000000

# 增加网络缓冲区
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864

# 增加连接跟踪表大小
net.netfilter.nf_conntrack_max = 1000000
net.nf_conntrack_max = 1000000
```

应用配置：

```bash
sudo sysctl -p
```

### 7.2 调整Docker资源限制

修改 `docker-compose.coturn.yml`：

```yaml
services:
  coturn:
    # ... 其他配置 ...
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### 7.3 调整Coturn配置

编辑 `turnserver.conf`：

```conf
# 带宽限制
total-quota=104857600  # 100MB/s
bps-capacity=1048576   # 1MB/s per user

# 连接数限制
max-allocate-lifetime=3600
```

## 八、安全加固

### 8.1 启用TLS/DTLS

生成SSL证书：

```bash
# 使用Let's Encrypt（推荐）
sudo apt-get install certbot
sudo certbot certonly --standalone -d turn.yourdomain.com

# 或生成自签名证书（测试用）
sudo openssl req -x509 -newkey rsa:4096 \
  -keyout /opt/chainlesschain/backend/coturn-service/pkey.pem \
  -out /opt/chainlesschain/backend/coturn-service/cert.pem \
  -days 365 -nodes
```

修改 `turnserver.conf`：

```conf
# 启用TLS
cert=/etc/coturn/cert.pem
pkey=/etc/coturn/pkey.pem

# 取消注释
# no-tls
# no-dtls
```

更新Docker Compose挂载：

```yaml
volumes:
  - ./backend/coturn-service/turnserver.conf:/etc/coturn/turnserver.conf:ro
  - ./backend/coturn-service/cert.pem:/etc/coturn/cert.pem:ro
  - ./backend/coturn-service/pkey.pem:/etc/coturn/pkey.pem:ro
```

### 8.2 限制访问来源

如果只为特定客户端提供服务，可以限制IP：

```conf
# 允许的IP范围
allowed-peer-ip=10.0.0.0-10.255.255.255
allowed-peer-ip=172.16.0.0-172.31.255.255
allowed-peer-ip=192.168.0.0-192.168.255.255
```

### 8.3 定期更新密码

创建密码轮换脚本（见下一节）。

## 九、备份和恢复

### 9.1 备份配置

```bash
# 备份配置文件
sudo tar -czf coturn-backup-$(date +%Y%m%d).tar.gz \
  /opt/chainlesschain/backend/coturn-service/

# 上传到对象存储（可选）
# aws s3 cp coturn-backup-*.tar.gz s3://your-bucket/
```

### 9.2 恢复配置

```bash
# 解压备份
sudo tar -xzf coturn-backup-20260111.tar.gz -C /

# 重启服务
cd /opt/chainlesschain
sudo docker-compose -f docker-compose.coturn.yml restart
```

## 十、故障排查

### 问题1: 容器无法启动

```bash
# 查看详细日志
sudo docker logs coturn-production

# 检查配置文件语法
sudo docker run --rm -v $(pwd)/backend/coturn-service/turnserver.conf:/tmp/turnserver.conf coturn/coturn turnserver -c /tmp/turnserver.conf --check-config
```

### 问题2: STUN工作但TURN不工作

- 检查用户名密码是否正确
- 检查UDP端口49152-49252是否开放
- 查看coturn日志中的认证错误

### 问题3: 高延迟或丢包

- 检查服务器带宽
- 调整系统网络参数
- 考虑使用CDN或多地域部署

### 问题4: 连接数过多

- 增加服务器资源
- 调整max-allocate-lifetime
- 部署多个TURN服务器负载均衡

## 十一、多服务器部署

如果需要高可用和负载均衡，可以部署多个TURN服务器：

### 11.1 部署多个服务器

在不同地域部署多个coturn服务器（例如：北京、上海、广州）。

### 11.2 客户端配置

在桌面应用中配置多个TURN服务器：

```javascript
config.p2p.turn.servers = [
  {
    urls: 'turn:beijing.example.com:3478',
    username: 'chainlesschain',
    credential: 'password1'
  },
  {
    urls: 'turn:shanghai.example.com:3478',
    username: 'chainlesschain',
    credential: 'password2'
  },
  {
    urls: 'turn:guangzhou.example.com:3478',
    username: 'chainlesschain',
    credential: 'password3'
  }
];
```

WebRTC会自动选择最优服务器。

## 十二、成本估算

### 云服务器配置建议

| 用户规模 | CPU | 内存 | 带宽 | 月成本（估算） |
|---------|-----|------|------|---------------|
| < 100 | 2核 | 2GB | 5Mbps | ¥100-200 |
| 100-500 | 4核 | 4GB | 10Mbps | ¥300-500 |
| 500-2000 | 8核 | 8GB | 20Mbps | ¥800-1500 |
| > 2000 | 多服务器 | - | - | 按需扩展 |

**注意**：实际成本取决于云平台、地域和流量使用情况。

## 总结

完成以上步骤后，您的生产环境STUN/TURN服务器就部署完成了！

**关键检查清单**：
- [x] 服务器防火墙已配置
- [x] 云平台安全组已配置
- [x] 公网IP已设置到配置文件
- [x] 默认密码已修改为强密码
- [x] 容器正常运行
- [x] STUN/TURN测试通过
- [x] 客户端配置已更新
- [x] 监控告警已设置

**下一步**：
- 配置TLS加密（可选但推荐）
- 设置自动备份
- 配置监控告警
- 考虑多地域部署

如有问题，请查看：
- Coturn日志：`sudo docker logs coturn-production`
- 测试报告：`backend/coturn-service/TEST_REPORT.md`
- 快速指南：`backend/coturn-service/QUICKSTART.md`
