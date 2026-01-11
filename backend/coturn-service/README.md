# Coturn STUN/TURN Server

生产环境的STUN/TURN服务器，用于ChainlessChain的P2P通信NAT穿透。

## 功能特性

- **STUN服务器**: 帮助客户端发现自己的公网IP和端口
- **TURN服务器**: 当P2P直连失败时提供中继服务
- **WebRTC支持**: 完全兼容WebRTC协议
- **认证机制**: 支持长期凭证认证
- **高性能**: 支持大量并发连接

## 快速启动

### 使用Docker Compose（推荐）

在项目根目录的`docker-compose.yml`中已包含coturn服务配置：

```bash
# 启动coturn服务
docker-compose up -d coturn

# 查看日志
docker-compose logs -f coturn

# 停止服务
docker-compose stop coturn
```

### 独立运行

```bash
cd backend/coturn-service

# 构建镜像
docker build -t chainlesschain-coturn .

# 运行容器
docker run -d \
  --name coturn \
  -p 3478:3478 -p 3478:3478/udp \
  -p 5349:5349 -p 5349:5349/udp \
  -p 49152-65535:49152-65535/udp \
  -v $(pwd)/turnserver.conf:/etc/coturn/turnserver.conf \
  chainlesschain-coturn
```

## 配置说明

### 端口配置

- **3478**: STUN/TURN服务端口（TCP/UDP）
- **5349**: STUN/TURN TLS端口（TCP/UDP）
- **49152-65535**: TURN中继端口范围（UDP）

### 认证配置

默认用户凭证：
- 用户名: `chainlesschain`
- 密码: `chainlesschain2024`

**生产环境请务必修改密码！**

编辑 `turnserver.conf` 文件：

```conf
user=your_username:your_strong_password
```

### 公网IP配置

如果部署在云服务器上，需要配置公网IP：

1. 编辑 `turnserver.conf`
2. 取消注释并设置 `external-ip`：

```conf
external-ip=YOUR_PUBLIC_IP
```

### TLS/DTLS配置（可选）

如果需要加密连接，需要配置证书：

1. 准备SSL证书文件：
   - `cert.pem`: 证书文件
   - `pkey.pem`: 私钥文件

2. 将证书文件放到 `backend/coturn-service/` 目录

3. 编辑 `turnserver.conf`：

```conf
cert=/etc/coturn/cert.pem
pkey=/etc/coturn/pkey.pem
```

4. 取消注释TLS相关配置

## 客户端配置

### Desktop App配置

在桌面应用的P2P设置中配置STUN/TURN服务器：

```javascript
{
  stun: {
    servers: [
      'stun:your-server-ip:3478'
    ]
  },
  turn: {
    enabled: true,
    servers: [
      {
        urls: 'turn:your-server-ip:3478',
        username: 'chainlesschain',
        credential: 'chainlesschain2024'
      }
    ]
  }
}
```

### 环境变量配置

也可以通过环境变量配置：

```bash
# STUN服务器
export P2P_STUN_SERVERS='["stun:your-server-ip:3478"]'

# TURN服务器
export P2P_TURN_ENABLED=true
export P2P_TURN_SERVERS='[{"urls":"turn:your-server-ip:3478","username":"chainlesschain","credential":"chainlesschain2024"}]'
```

## 测试连接

### 使用在线工具测试

访问 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

配置STUN/TURN服务器信息，点击"Gather candidates"测试连接。

### 使用命令行测试

```bash
# 测试STUN服务器
turnutils_stunclient your-server-ip

# 测试TURN服务器
turnutils_uclient -u chainlesschain -w chainlesschain2024 your-server-ip
```

## 性能优化

### 带宽限制

编辑 `turnserver.conf` 设置带宽限制：

```conf
# 总带宽限制（字节/秒）
total-quota=104857600  # 100MB/s

# 每用户带宽限制
bps-capacity=1048576   # 1MB/s
```

### 连接数限制

```conf
# 最大分配数
max-allocate-lifetime=3600

# 最大会话数
max-bps=3000000
```

### 日志级别

生产环境可以降低日志级别：

```conf
# 移除 verbose 行以减少日志输出
# verbose
```

## 监控和维护

### 查看日志

```bash
# Docker日志
docker logs -f coturn

# 容器内日志文件
docker exec coturn tail -f /var/log/coturn/turnserver.log
```

### 查看连接状态

```bash
# 进入容器
docker exec -it coturn sh

# 查看活动会话（如果启用了CLI）
turnadmin -l
```

### 重启服务

```bash
docker-compose restart coturn
```

## 安全建议

1. **修改默认密码**: 使用强密码替换默认凭证
2. **启用TLS**: 生产环境建议启用TLS加密
3. **防火墙配置**: 只开放必要的端口
4. **限制访问**: 使用IP白名单限制访问来源
5. **定期更新**: 保持coturn版本更新
6. **监控日志**: 定期检查异常访问

## 故障排查

### 连接失败

1. 检查防火墙是否开放端口
2. 验证公网IP配置是否正确
3. 检查用户名密码是否正确
4. 查看服务器日志排查错误

### 性能问题

1. 检查带宽使用情况
2. 调整连接数限制
3. 考虑使用多个TURN服务器负载均衡

### UDP端口范围问题

如果UDP端口范围太大导致Docker启动失败，可以缩小范围：

```conf
min-port=49152
max-port=49252  # 只开放100个端口
```

## 云服务器部署

### 阿里云/腾讯云

1. 在安全组中开放端口：3478, 5349, 49152-65535
2. 配置 `external-ip` 为ECS/CVM的公网IP
3. 确保网络类型为VPC

### AWS/Azure

1. 在安全组/网络安全组中配置入站规则
2. 使用弹性IP作为 `external-ip`
3. 注意NAT网关配置

## 参考资料

- [Coturn官方文档](https://github.com/coturn/coturn)
- [WebRTC STUN/TURN配置](https://webrtc.org/getting-started/turn-server)
- [RFC 5389 - STUN](https://tools.ietf.org/html/rfc5389)
- [RFC 5766 - TURN](https://tools.ietf.org/html/rfc5766)
