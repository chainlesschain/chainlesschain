# Signaling Server Quick Start

WebSocket信令服务器，用于ChainlessChain移动端与PC端的P2P通讯。

## 快速启动

### 方式1：直接运行（推荐用于开发）

```bash
# 进入目录
cd signaling-server

# 安装依赖（首次运行）
npm install

# 开发模式（自动重启）
npm run dev

# 或生产模式
npm start
```

### 方式2：从项目根目录运行

```bash
# 开发模式
npm run signaling:dev

# 生产模式
npm run signaling:start

# Docker模式
npm run signaling:docker
```

### 方式3：Docker部署（推荐用于生产）

```bash
# 从项目根目录启动
docker-compose up -d signaling-server

# 查看日志
docker-compose logs -f signaling-server

# 停止服务
docker-compose stop signaling-server
```

### 方式4：云端部署

```bash
# 使用云端配置
docker-compose -f config/docker/docker-compose.cloud.yml up -d signaling-server

# 查看日志
docker-compose -f config/docker/docker-compose.cloud.yml logs -f signaling-server
```

## 验证服务

服务启动后，你应该看到：

```
[SignalingServer] WebSocket服务器启动在端口 9001
[SignalingServer] 等待客户端连接...
```

## 端口配置

默认端口：`9001`

可通过环境变量修改：
```bash
PORT=9001 npm start
```

## 连接测试

使用WebSocket客户端测试连接：

```javascript
const ws = new WebSocket('ws://localhost:9001');

ws.onopen = () => {
  console.log('Connected to signaling server');

  // 注册节点
  ws.send(JSON.stringify({
    type: 'register',
    peerId: 'test-peer-id',
    deviceType: 'desktop',
    deviceInfo: {
      name: 'Test Device',
      platform: 'darwin',
      version: '0.16.0'
    }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

## 故障排查

### 连接被拒绝 (ECONNREFUSED)

**问题**：`Error: connect ECONNREFUSED 127.0.0.1:9001`

**解决方案**：
1. 确认信令服务器已启动
2. 检查端口9001是否被占用：`lsof -i :9001`
3. 检查防火墙设置

### 端口被占用

**问题**：`Error: listen EADDRINUSE: address already in use :::9001`

**解决方案**：
```bash
# 查找占用端口的进程
lsof -i :9001

# 杀死进程
kill -9 <PID>

# 或使用不同端口
PORT=9002 npm start
```

## 生产环境部署

### 使用PM2管理进程

```bash
# 安装PM2
npm install -g pm2

# 启动服务
pm2 start index.js --name chainlesschain-signaling

# 保存配置
pm2 save

# 设置开机自启
pm2 startup
```

### 使用Docker（推荐）

```bash
# 构建镜像
docker build -t chainlesschain-signaling-server .

# 运行容器
docker run -d \
  --name chainlesschain-signaling \
  -p 9001:9001 \
  --restart unless-stopped \
  chainlesschain-signaling-server
```

## 监控

服务器每5分钟打印统计信息：

```
[Stats] 连接数: 5, 总连接: 120, 转发消息: 3456, 离线消息: 12
```

## 安全建议

生产环境建议：
- 使用WSS（WebSocket over TLS）
- 添加身份验证机制
- 限制连接速率
- 定期备份离线消息队列

## 更多信息

详细文档请参考：[README.md](./README.md)
