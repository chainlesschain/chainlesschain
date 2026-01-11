# STUN/TURN服务器快速启动指南

## 一键启动

```bash
# 1. 启动coturn服务
docker-compose up -d coturn

# 2. 查看服务状态
docker ps | grep coturn

# 3. 查看日志
docker logs -f chainlesschain-coturn

# 4. 运行测试
cd backend/coturn-service
./test.sh
```

## 验证服务

### 方法1: 使用测试脚本

```bash
node backend/coturn-service/test-stun-turn.js
```

预期输出：
```
✓ STUN服务器响应成功
  XOR映射地址: 192.168.65.1:xxxxx

✓ TURN服务器响应成功
  响应长度: 40 字节

✓ 所有测试通过！
```

### 方法2: 使用在线工具

访问 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

配置：
```json
[
  {
    "urls": "stun:localhost:3478"
  },
  {
    "urls": "turn:localhost:3478",
    "username": "chainlesschain",
    "credential": "chainlesschain2024"
  }
]
```

点击 "Gather candidates" 测试。

## P2P功能测试

```bash
# 测试信令服务器和P2P功能
node test-p2p-functionality.js

# 测试NAT穿透
cd desktop-app-vue
node test-scripts/test-p2p-nat-traversal.js
```

## 常用命令

```bash
# 启动服务
docker-compose up -d coturn

# 停止服务
docker-compose stop coturn

# 重启服务
docker-compose restart coturn

# 查看日志
docker logs chainlesschain-coturn

# 实时日志
docker logs -f chainlesschain-coturn

# 进入容器
docker exec -it chainlesschain-coturn sh

# 删除服务
docker-compose down coturn
```

## 配置文件位置

- **Docker配置**: `backend/coturn-service/Dockerfile`
- **Coturn配置**: `backend/coturn-service/turnserver.conf`
- **Docker Compose**: `docker-compose.yml`
- **P2P配置**: `desktop-app-vue/src/main/p2p/p2p-manager.js`

## 端口说明

| 端口 | 协议 | 用途 |
|------|------|------|
| 3478 | TCP/UDP | STUN/TURN服务 |
| 5349 | TCP/UDP | STUN/TURN TLS |
| 49152-49252 | UDP | TURN中继端口 |
| 9001 | TCP | 信令服务器 |
| 9002 | TCP | 信令服务器健康检查 |

## 故障排查

### 问题1: 容器无法启动

```bash
# 检查端口占用
lsof -i :3478

# 查看容器日志
docker logs chainlesschain-coturn

# 重新构建
docker-compose build coturn
docker-compose up -d coturn
```

### 问题2: STUN测试失败

```bash
# 检查容器状态
docker ps | grep coturn

# 检查端口映射
docker port chainlesschain-coturn

# 测试端口连通性
nc -zv localhost 3478
```

### 问题3: P2P连接失败

```bash
# 检查信令服务器
docker ps | grep signaling

# 测试信令服务器
curl http://localhost:9002/health

# 查看P2P日志
docker logs chainlesschain-signaling-server
```

## 生产环境部署

### 1. 修改配置

编辑 `backend/coturn-service/turnserver.conf`:

```conf
# 设置公网IP
external-ip=YOUR_PUBLIC_IP

# 修改密码
user=chainlesschain:YOUR_STRONG_PASSWORD
```

### 2. 更新客户端配置

编辑 `desktop-app-vue/src/main/p2p/p2p-manager.js`:

```javascript
stun: {
  servers: [
    'stun:YOUR_SERVER_IP:3478',
    'stun:stun.l.google.com:19302'  // 备用
  ],
},
turn: {
  enabled: true,
  servers: [
    {
      urls: 'turn:YOUR_SERVER_IP:3478',
      username: 'chainlesschain',
      credential: 'YOUR_STRONG_PASSWORD'
    }
  ],
}
```

### 3. 配置防火墙

```bash
# Ubuntu/Debian
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:49252/udp

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=3478/tcp
sudo firewall-cmd --permanent --add-port=3478/udp
sudo firewall-cmd --permanent --add-port=5349/tcp
sudo firewall-cmd --permanent --add-port=5349/udp
sudo firewall-cmd --permanent --add-port=49152-49252/udp
sudo firewall-cmd --reload
```

### 4. 重启服务

```bash
docker-compose restart coturn
```

## 监控和维护

### 查看连接统计

```bash
# 查看活跃连接
docker exec chainlesschain-coturn netstat -an | grep 3478

# 查看资源使用
docker stats chainlesschain-coturn
```

### 日志管理

```bash
# 查看最近100行日志
docker logs --tail 100 chainlesschain-coturn

# 查看特定时间的日志
docker logs --since 1h chainlesschain-coturn

# 导出日志
docker logs chainlesschain-coturn > coturn.log
```

## 性能优化

### 调整并发连接数

编辑 `turnserver.conf`:

```conf
# 最大分配数
max-allocate-lifetime=3600

# 带宽限制
total-quota=104857600  # 100MB/s
bps-capacity=1048576   # 1MB/s per user
```

### 调整中继端口范围

```conf
# 减少端口范围以节省资源
min-port=49152
max-port=49252  # 只开放100个端口
```

## 更多信息

- 详细文档: `backend/coturn-service/README.md`
- 测试报告: `backend/coturn-service/TEST_REPORT.md`
- 项目文档: `CLAUDE.md`
