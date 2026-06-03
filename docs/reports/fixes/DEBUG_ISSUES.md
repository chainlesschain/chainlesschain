# 问题排查和修复指南 - 2026-01-28

## 问题汇总

1. ❌ LLM 测试连接一直显示"连接中"
2. ❌ P2P 不能用
3. ❌ 文件浏览不能用

---

## ⚠️ 重要：需要重启桌面应用

**所有修复都需要重启桌面应用才能生效！**

### 如何重启桌面应用

#### 方法 1：通过任务管理器
1. 打开任务管理器（Ctrl + Shift + Esc）
2. 找到 `chainlesschain` 或 `electron` 进程
3. 结束任务
4. 重新启动应用

#### 方法 2：通过命令行
```bash
# 查找进程
tasklist | findstr "electron"

# 结束进程（替换 <PID> 为实际进程ID）
taskkill /F /PID <PID>

# 重新启动
cd E:\code\chainlesschain\desktop-app-vue
npm run dev
```

---

## 问题 1: LLM 测试连接超时

### 根本原因
火山引擎 API 的 `/models` 端点响应很慢或不支持，导致测试连接超时（默认 120 秒）。

### 已修复内容
✅ 在 `openai-client.js` 中添加了火山引擎特殊处理：
- 使用轻量级聊天测试（只发送 "hi"，5 token）
- 设置 10 秒快速超时
- 自动检测 `volces.com` 域名

### 验证修复

#### 步骤 1：检查修改是否存在
```bash
# 打开文件查看第 44 行
E:\code\chainlesschain\desktop-app-vue\src\main\llm\openai-client.js
```

应该看到：
```javascript
if (this.baseURL && this.baseURL.includes('volces.com')) {
  logger.info('[OpenAIClient] 检测到火山引擎，使用聊天测试代替模型列表');
  // ... 特殊处理代码
}
```

#### 步骤 2：重启应用并测试
1. **重启桌面应用**（重要！）
2. 打开 设置 → LLM 配置
3. 选择"豆包（火山引擎）"
4. 输入以下配置：
   - **API Key**: 你的火山引擎 API Key
   - **模型**: `doubao-seed-1-6-251015` 或其他可用模型
   - **API 地址**: 保持默认 `https://ark.cn-beijing.volces.com/api/v3`
5. 点击"测试连接"
6. 应该在 **10 秒内**返回结果

#### 步骤 3：查看日志
按 F12 打开开发者工具，查看 Console：
- 应该看到：`[OpenAIClient] 检测到火山引擎，使用聊天测试代替模型列表`
- 如果没有这条日志，说明**应用没有重启**，修改未生效

### 调试命令（前端 Console）
```javascript
// 测试 LLM 状态
await window.electronAPI.llm.checkStatus()

// 查看当前配置
const config = await window.electronAPI.llm.getConfig()
console.log('Provider:', config.provider)
console.log('BaseURL:', config.volcengine?.baseURL)
```

### 如果还是超时

#### 方案 A：检查网络
```bash
# 测试火山引擎 API 连通性
curl -v https://ark.cn-beijing.volces.com/api/v3/models
```

#### 方案 B：手动添加更详细的日志
编辑 `openai-client.js` 第 41 行，添加：
```javascript
async checkStatus() {
  console.log('[DEBUG] checkStatus called, baseURL:', this.baseURL);
  try {
    // ... 原有代码
```

#### 方案 C：前端添加超时
编辑 `LLMSettings.vue` 第 658 行：
```javascript
const result = await Promise.race([
  window.electronAPI.llm.checkStatus(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('前端超时：15秒无响应')), 15000)
  )
]);
```

---

## 问题 2: P2P 不能用

### 可能原因
1. P2P 初始化超时（已添加 30 秒超时保护）
2. libp2p 模块加载失败
3. 端口被占用
4. 网络配置问题

### 已修复内容
✅ 添加了 P2P 初始化超时保护（30 秒）
✅ 添加了 libp2p 模块加载超时（10 秒）

### 验证修复

#### 步骤 1：查看 P2P 初始化日志
1. 重启桌面应用
2. 按 F12 打开开发者工具
3. 查看 Console 日志，应该看到：
   ```
   [Social] P2P管理器初始化成功
   ```
   或
   ```
   [Social] P2P管理器初始化失败: <错误信息>
   ```

#### 步骤 2：检查 P2P 状态
前端 Console 执行：
```javascript
// 检查 P2P 状态
await window.electronAPI.p2p.getStatus()

// 查看已连接设备
await window.electronAPI.p2p.getConnectedDevices()
```

#### 步骤 3：检查端口占用
```bash
# 检查 P2P 端口是否被占用
netstat -ano | findstr "9000"
netstat -ano | findstr "9003"
netstat -ano | findstr "9095"
```

### 常见 P2P 错误

#### 错误 1：初始化超时
```
[Social] P2P管理器初始化失败: P2P初始化超时
```
**原因**: 网络问题或模块加载慢
**解决**:
- 检查网络连接
- 检查防火墙设置
- 尝试禁用 WebRTC（在 P2P 设置中）

#### 错误 2：libp2p 模块加载超时
```
[P2PManager] libp2p模块加载超时
```
**原因**: 依赖模块损坏或缺失
**解决**:
```bash
cd E:\code\chainlesschain\desktop-app-vue
npm install libp2p @libp2p/tcp @libp2p/websockets --force
```

#### 错误 3：端口被占用
```
Error: listen EADDRINUSE: address already in use :::9000
```
**解决**:
```bash
# 查找占用端口的进程
netstat -ano | findstr "9000"

# 结束进程（替换 <PID>）
taskkill /F /PID <PID>
```

### P2P 配置优化

#### 禁用 WebRTC（如果有问题）
前端 Console 执行：
```javascript
// 禁用 WebRTC 传输
await window.electronAPI.settings.set('p2p.transports.webrtc.enabled', 'false')
```

#### 修改 P2P 端口
```javascript
await window.electronAPI.settings.set('p2p.websocket.port', '9004')
```

---

## 问题 3: 文件浏览不能用

### 需要明确的问题
请确认是以下哪种情况：

#### 情况 A：本地文件浏览不能用
- 无法浏览电脑本地文件
- 知识库文件管理不能用

#### 情况 B：外部设备文件浏览不能用
- 无法浏览 Android 手机文件
- PC-Android P2P 文件同步不能用

### 情况 A：本地文件浏览

#### 检查方法
1. 打开"知识库"页面
2. 尝试导入文件
3. 查看是否有错误提示

#### 可能原因
- 文件权限问题
- 路径配置错误
- 数据库初始化失败

#### 调试命令
```javascript
// 检查数据库状态
await window.electronAPI.database.checkConnection()

// 测试文件读取
await window.electronAPI.fs.readFile('E:\\test.txt')
```

### 情况 B：外部设备文件浏览

#### 已知限制
⚠️ **Android P2P 文件浏览功能未实现**

根本原因：
- Android 端缺少 `FileIndexProtocolHandler.kt`（350+ 行代码）
- 文件索引协议未实现

#### 当前状态
- ✅ Desktop 端完整实现（已修复 RAG 集成和取消功能）
- ❌ Android 端协议处理器不存在
- ✅ Android 端基础设施就绪（ExternalFileDao、P2PNetworkModule）

#### 临时解决方案
1. 使用 USB 连接手机
2. 使用 ADB 文件传输
3. 使用第三方文件共享应用

#### 如果要实现此功能
需要创建：
```
android-app/core-p2p/src/main/java/com/chainlesschain/android/core/p2p/
  FileIndexProtocolHandler.kt  (约 350 行)
```

实现以下功能：
- 处理 `file:index-request` 协议
- 返回 `file:index-response` 数据
- 支持增量同步
- 支持文件分块传输

---

## 快速测试清单

### ✅ 测试 LLM 修复
- [ ] 重启桌面应用
- [ ] 配置火山引擎 API
- [ ] 测试连接（应在 10 秒内返回）
- [ ] 查看日志确认特殊处理触发

### ✅ 测试 P2P 修复
- [ ] 重启桌面应用
- [ ] 查看初始化日志
- [ ] 检查端口占用
- [ ] 测试设备发现

### ⚠️ 文件浏览
- [ ] 测试本地文件浏览
- [ ] 确认是否需要 P2P 文件浏览
- [ ] 如需 Android 文件浏览，需要额外开发

---

## 总结

| 问题 | 修复状态 | 需要操作 |
|------|---------|---------|
| LLM 测试连接超时 | ✅ 已修复 | **重启应用** |
| P2P 初始化超时 | ✅ 已修复 | **重启应用** + 检查端口 |
| 本地文件浏览 | ❓ 需确认 | 提供错误信息 |
| Android P2P 文件浏览 | ❌ 未实现 | 需要开发 |

---

## 下一步行动

1. **立即执行**: 重启桌面应用
2. **测试 LLM**: 配置火山引擎并测试连接
3. **测试 P2P**: 查看初始化日志和状态
4. **确认文件浏览**: 明确是本地还是 P2P 文件浏览问题
5. **提供反馈**: 如果还有问题，提供：
   - Console 日志截图
   - 具体错误信息
   - 操作步骤

---

## 获取详细日志

### 方法 1：开发者工具
1. 按 F12
2. 切换到 Console 标签
3. 复制所有日志

### 方法 2：日志文件
```bash
# 查找日志文件
cd %APPDATA%\chainlesschain-desktop-vue\logs
dir *.log

# 查看最新日志
type main.log
```

### 方法 3：实时监控
```bash
# Windows PowerShell
Get-Content -Path "%APPDATA%\chainlesschain-desktop-vue\logs\main.log" -Wait
```
