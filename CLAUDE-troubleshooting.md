# ChainlessChain 故障排除指南

> 记录已知问题和验证过的解决方案，避免重复排查
>
> **版本**: v1.0.0
> **最后更新**: 2026-01-16

---

## 数据库问题

### Issue: SQLITE_BUSY 数据库锁定

**症状**:

```
Error: SQLITE_BUSY: database is locked
```

**原因**: SQLite 单写锁，多个写操作并发冲突

**解决方案**:

1. **启用 WAL 模式**（推荐）:

```javascript
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 30000");
```

2. **使用事务批量操作**:

```javascript
const insertMany = db.transaction((items) => {
  for (const item of items) {
    db.run("INSERT INTO notes VALUES (?, ?)", [item.id, item.content]);
  }
});
insertMany(items); // 一次事务，一次锁
```

3. **使用 ErrorMonitor 自动重试**:

```javascript
await errorMonitor.retryWithExponentialBackoff(() => db.run(sql, params), {
  maxRetries: 5,
  baseDelay: 100,
});
```

**状态**: 已在 `error-monitor.js` 实现自动处理

---

### Issue: 数据库加密密钥错误

**症状**:

```
Error: file is not a database
```

**原因**: SQLCipher 密钥不正确或数据库未加密

**解决方案**:

1. **检查密钥来源**:

```javascript
// 确保从 U-Key 或环境变量获取正确密钥
const key =
  (await ukeyManager.getDatabaseKey()) || process.env.DB_ENCRYPTION_KEY;
```

2. **重置数据库**（开发环境）:

```bash
rm data/chainlesschain.db
# 重启应用会自动创建新数据库
```

3. **验证密钥**:

```javascript
try {
  db.pragma(`key = '${key}'`);
  db.pragma("SELECT count(*) FROM sqlite_master"); // 测试查询
} catch (error) {
  console.error("密钥验证失败");
}
```

---

## LLM 服务问题

### Issue: Ollama 连接失败

**症状**:

```
Error: connect ECONNREFUSED 127.0.0.1:11434
```

**原因**: Ollama 服务未启动或端口被占用

**解决方案**:

1. **检查 Ollama 服务**:

```bash
# 检查服务状态
curl http://localhost:11434/api/tags

# 启动服务
ollama serve

# 或使用 Docker
docker start chainlesschain-ollama
```

2. **检查端口占用**:

```bash
# Windows
netstat -ano | findstr :11434

# Linux/macOS
lsof -i :11434
```

3. **使用 ErrorMonitor 自动重启**:

```javascript
// 已在 error-monitor.js 实现
await errorMonitor.attemptServiceReconnection("ollama");
```

**状态**: 已在 `error-monitor.js:1067-1158` 实现自动恢复

---

### Issue: 模型下载失败

**症状**:

```
Error: model "qwen2:7b" not found
```

**解决方案**:

1. **手动拉取模型**:

```bash
ollama pull qwen2:7b

# 或其他推荐模型
ollama pull llama3:8b
ollama pull nomic-embed-text
```

2. **检查磁盘空间**:

```bash
# 模型通常需要 4-8GB 空间
df -h ~/.ollama
```

3. **使用镜像源**（国内用户）:

```bash
# 设置环境变量
export OLLAMA_HOST=https://ollama.example.cn
```

---

### Issue: LLM 响应超时

**症状**:

```
Error: LLM request timeout after 30000ms
```

**原因**: 模型加载慢或硬件性能不足

**解决方案**:

1. **增加超时时间**:

```javascript
const response = await llmManager.chat(messages, {
  timeout: 60000, // 60 秒
});
```

2. **使用更小的模型**:

```javascript
// 使用 7B 而非 70B 模型
model: "qwen2:7b"; // 而非 qwen2:72b
```

3. **预热模型**:

```javascript
// 应用启动时预加载模型
await llmManager.warmup("qwen2:7b");
```

---

## P2P 网络问题

### Issue: NAT 穿透失败

**症状**:

```
Error: peer not reachable
```

**原因**: NAT 类型限制或防火墙阻挡

**解决方案**:

1. **使用信令服务器**:

```javascript
// 确保连接到信令服务器
const signalingServer = "wss://signaling.chainlesschain.io:9001";
await p2pNode.dial(signalingServer);
```

2. **启动本地信令服务器**（开发环境）:

```bash
cd signaling-server
npm run dev
```

3. **检查防火墙**:

- 允许 UDP 端口 4001-4003
- 允许 TCP 端口 9001

4. **使用中继节点**:

```javascript
// 配置 Circuit Relay
p2pNode.services.relay.enable();
```

---

### Issue: 消息解密失败

**症状**:

```
Error: Unable to decrypt message
```

**原因**: Signal Protocol 会话状态不同步

**解决方案**:

1. **重建会话**:

```javascript
await signalManager.resetSession(peerDID);
await signalManager.createSession(peerDID, preKeyBundle);
```

2. **清理旧会话**:

```javascript
// 删除损坏的会话
await db.run("DELETE FROM signal_sessions WHERE peer_did = ?", [peerDID]);
```

3. **请求对方重发 Pre-Key Bundle**:

```javascript
await p2pManager.requestPreKeyBundle(peerDID);
```

---

## Electron 问题

### Issue: IPC 通信失败

**症状**:

```
Error: An object could not be cloned
```

**原因**: IPC 只能传输可序列化数据

**解决方案**:

1. **序列化复杂对象**:

```javascript
// 主进程
ipcMain.handle("get-data", async () => {
  const data = await fetchData();
  return JSON.parse(JSON.stringify(data)); // 确保可序列化
});
```

2. **避免传输函数和 Buffer**:

```javascript
// ❌ 错误
return { buffer: Buffer.from("data"), fn: () => {} };

// ✅ 正确
return { data: buffer.toString("base64") };
```

---

### Issue: 开发模式热重载不生效

**症状**: 修改代码后需要手动重启

**解决方案**:

1. **重建主进程**:

```bash
npm run build:main
npm run dev
```

2. **检查 Vite 配置**:

```javascript
// vite.config.js
export default {
  server: {
    watch: {
      usePolling: true, // Windows 需要
    },
  },
};
```

---

## 构建和打包问题

### Issue: 打包后应用启动白屏

**症状**: 开发模式正常，打包后白屏

**原因**: 资源路径不正确

**解决方案**:

1. **检查 base 配置**:

```javascript
// vite.config.js
export default {
  base: "./", // 使用相对路径
};
```

2. **检查 preload 路径**:

```javascript
// main/index.js
webPreferences: {
  preload: path.join(__dirname, "preload.js");
}
```

3. **检查控制台错误**:

```javascript
// 打包后打开 DevTools
mainWindow.webContents.openDevTools();
```

---

### Issue: better-sqlite3 原生模块编译失败

**症状**:

```
Error: Cannot find module 'better-sqlite3'
```

**解决方案**:

1. **重新编译原生模块**:

```bash
npm rebuild better-sqlite3 --runtime=electron --target=39.2.6
```

2. **使用 electron-rebuild**:

```bash
npx electron-rebuild
```

3. **检查 Node 版本**:

```bash
# 确保使用 Node 18+
node --version
```

---

## U-Key 问题

### Issue: Windows 驱动加载失败

**症状**:

```
Error: Failed to load SIMKey SDK
```

**解决方案**:

1. **检查驱动文件**:

```bash
# 确保 SDK 文件存在
ls SIMKeySDK-20220416/
```

2. **安装 Visual C++ 运行时**:
   下载并安装 Visual C++ Redistributable 2019

3. **使用模拟模式**（开发环境）:

```javascript
// app-config.js
{
  ukey: {
    simulationMode: true,
    defaultPIN: '123456'
  }
}
```

---

### Issue: PIN 验证失败

**症状**:

```
Error: PIN_ERROR, remaining attempts: 2
```

**解决方案**:

1. **重置 PIN**（需要 PUK）:

```javascript
await ukeyManager.resetPIN(puk, newPIN);
```

2. **使用默认 PIN**（模拟模式）:

```javascript
// 默认 PIN: 123456
await ukeyManager.verifyPIN("123456");
```

3. **检查剩余尝试次数**:

```javascript
const attempts = await ukeyManager.getRemainingAttempts();
if (attempts < 3) {
  console.warn("PIN 尝试次数不足，请谨慎操作");
}
```

---

## 性能问题

### Issue: 应用启动慢

**解决方案**:

1. **延迟加载非核心模块**:

```javascript
// 懒加载 P2P 模块
const p2pManager = await import("./p2p/p2p-manager.js");
```

2. **预编译模型**:

```bash
ollama run qwen2:7b "test" # 预热模型
```

3. **使用 SplashScreen**:

```javascript
// 显示加载界面
const splash = new BrowserWindow({
  /* ... */
});
splash.loadFile("splash.html");
```

---

### Issue: 内存占用过高

**症状**: 内存使用超过 500MB

**解决方案**:

1. **清理缓存**:

```javascript
await errorMonitor.clearCaches();
```

2. **限制会话历史**:

```javascript
// 使用 SessionManager 压缩
await sessionManager.compressSession(sessionId);
```

3. **强制垃圾回收**:

```javascript
if (global.gc) global.gc();
```

---

## 添加新问题

当遇到并解决新问题时，请按以下格式添加：

```markdown
### Issue: [问题标题]

**症状**:
```

[错误信息或现象]

````

**原因**: [根本原因]

**解决方案**:

1. **[方案1名称]**:
```[language]
// 代码或命令
````

2. **[方案2名称]**:
   ...

**状态**: [已解决 / 待验证 / 已在 xxx 实现自动处理]

```

---

**维护者**: 开发团队
**更新周期**: 遇到新问题时及时更新
```
