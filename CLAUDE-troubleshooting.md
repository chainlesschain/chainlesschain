# ChainlessChain 故障排除指南

> 记录已知问题和验证过的解决方案，避免重复排查
>
> **版本**: v1.2.0
> **最后更新**: 2026-02-16

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

## Android 区块链问题

### Issue: ECDSA 签名和公钥推导返回空数组

**症状**:

```
WalletCoreAdapter.privateKeyToPublicKey() returns ByteArray(0)
WalletCoreAdapter.ecdsaSign() returns ByteArray(0)
```

**原因**: `WalletCoreAdapter.kt` 中的密码学方法仅有占位符实现，返回空 `ByteArray`

**解决方案**:

1. **使用 BouncyCastle 实现 secp256k1 操作**:

```kotlin
// 公钥推导
val curveParams = CustomNamedCurves.getByName("secp256k1")
val pointQ = FixedPointCombMultiplier().multiply(curveParams.g, BigInteger(1, privateKey))
return pointQ.getEncoded(false) // 65 bytes uncompressed

// ECDSA 签名 (RFC 6979)
val signer = ECDSASigner(HMacDSAKCalculator(SHA256Digest()))
signer.init(true, ECPrivateKeyParameters(privateKeyNum, domainParams))
val components = signer.generateSignature(hash)
```

2. **注意 EIP-2 s 值规范化**:

```kotlin
val halfN = curveParams.n.shiftRight(1)
if (s > halfN) s = curveParams.n.subtract(s) // 防止交易延展性攻击
```

3. **BIP32 非硬化派生必须使用压缩公钥**:

```kotlin
// ❌ 错误：使用 65 字节非压缩公钥
val publicKey = pointQ.getEncoded(false)

// ✅ 正确：使用 33 字节压缩公钥
val publicKey = pointQ.getEncoded(true)
```

**状态**: 已在 `WalletCoreAdapter.kt` 实现，使用已有依赖 `org.bouncycastle:bcprov-jdk15on:1.70`

---

### Issue: RLP 编码和交易签名返回空数据

**症状**:

```
TransactionManager.buildRawTransaction() returns ByteArray(0)
TransactionManager.signTransaction() returns "0x"
```

**原因**: `TransactionManager.kt` 中交易构建和签名方法仅有占位符

**解决方案**:

1. **创建独立 RLPEncoder 工具类**:

```kotlin
object RLPEncoder {
    fun encodeBytes(data: ByteArray): ByteArray  // RLP 编码字节数组
    fun encodeBigInteger(value: BigInteger): ByteArray  // 编码大整数
    fun encodeList(items: List<ByteArray>): ByteArray  // 编码列表
}
```

2. **区分 Legacy 和 EIP-1559 交易格式**:

```kotlin
// Legacy (type 0): RLP([nonce, gasPrice, gasLimit, to, value, data])
// EIP-1559 (type 2): 0x02 || RLP([chainId, nonce, maxPriorityFee, maxFee, gasLimit, to, value, data, []])
```

3. **签名流程**:

```kotlin
val rawTx = buildRawTransaction(txRequest)
val txHash = keccak256(rawTx)
val signature = walletCoreAdapter.signHash(txHash, privateKey)
// 将 v, r, s 附加到交易中重新 RLP 编码
```

**状态**: 已实现，新建 `RLPEncoder.kt` 工具类

---

### Issue: Keystore JSON 导入抛出 UnsupportedOperationException

**症状**:

```
java.lang.UnsupportedOperationException: Keystore import not yet implemented
```

**原因**: `WalletManager.kt` 的 `ImportType.KEYSTORE` 分支未实现

**解决方案**:

1. **实现 Keystore V3 解密**:

```kotlin
fun decryptKeystoreV3(keystoreJson: String, password: String): ByteArray {
    val crypto = JSONObject(keystoreJson).getJSONObject("crypto")
    val kdf = crypto.getString("kdf")
    // 1. KDF 派生密钥 (scrypt 或 pbkdf2)
    // 2. MAC 验证: keccak256(derivedKey[16:32] + ciphertext) == mac
    // 3. AES-128-CTR 解密得到私钥
}
```

2. **注意 scrypt 在移动端的性能**:

```kotlin
// scrypt 参数 n=262144 在移动端可能需要 1-3 秒
// 建议在后台线程执行，显示进度提示
withContext(Dispatchers.IO) {
    SCrypt.generate(passwordBytes, salt, n, r, p, dkLen)
}
```

3. **MAC 验证防止错误密码**:

```kotlin
val mac = keccak256(derivedKey.sliceArray(16..31) + ciphertext)
if (!mac.contentEquals(expectedMac)) {
    throw IllegalArgumentException("密码错误或Keystore文件损坏")
}
```

**状态**: 已实现，支持 scrypt 和 pbkdf2 两种 KDF

---

## Android AI 集成问题

### Issue: CUSTOM LLM Provider 无法连接自定义端点

**症状**:

```
java.net.ConnectException: Connection refused (OpenAI default endpoint)
```

**原因**: `AIModule.kt` 中 `LLMProvider.CUSTOM` 分支创建 `OpenAIAdapter(apiKey)` 时未传入用户配置的 `baseURL`，始终连接 `https://api.openai.com/v1`

**解决方案**:

```kotlin
// ❌ 修复前
LLMProvider.CUSTOM -> OpenAIAdapter(apiKey)

// ✅ 修复后
LLMProvider.CUSTOM -> {
    val config = configManager.getConfig().custom
    OpenAIAdapter(apiKey, config.baseURL.ifBlank { "https://api.openai.com/v1" })
}
```

**状态**: 已修复

---

### Issue: API Key 未配置时应用崩溃

**症状**:

```
java.lang.IllegalStateException: Required value was null
```

**原因**: `AIModule.kt` 使用 `requireNotNull(apiKey)` 在 API Key 为空时直接崩溃

**解决方案**:

```kotlin
// ❌ 修复前
val finalApiKey = requireNotNull(apiKey) { "API Key required" }

// ✅ 修复后
if (finalApiKey.isNullOrBlank()) {
    throw IllegalArgumentException("${provider.displayName}的API Key未配置，请在AI设置中配置后重试")
}
```

同时在 ViewModel 中添加具体错误类型判断：

```kotlin
val errorMsg = when (e) {
    is java.net.UnknownHostException -> "网络连接失败，请检查网络设置"
    is java.net.SocketTimeoutException -> "连接超时，请检查网络或服务地址"
    is java.net.ConnectException -> "无法连接到AI服务，请检查服务是否启动"
    is IllegalArgumentException -> e.message ?: "参数错误"
    else -> "发送失败: ${e.message ?: "未知错误"}"
}
```

**状态**: 已修复

---

## Android UI 问题

### Issue: 搜索好友时频繁触发 API 请求

**症状**: 每输入一个字符都触发搜索请求，导致界面卡顿和服务端压力

**原因**: `FriendListScreen.kt` 中 `onQueryChange` 直接调用 `viewModel.searchFriends()`

**解决方案**:

```kotlin
// 使用 snapshotFlow + debounce 防抖
LaunchedEffect(Unit) {
    snapshotFlow { searchQuery }
        .debounce(300)
        .distinctUntilChanged()
        .collectLatest { query -> viewModel.searchFriends(query) }
}
```

**注意**: 需要添加 `@OptIn(FlowPreview::class)` 注解，因为 `debounce` 是实验性 API

**状态**: 已修复

---

### Issue: 深色模式切换时颜色突变

**症状**: 切换深色/浅色模式时，颜色瞬间跳变，体验不流畅

**原因**: `Theme.kt` 中 `MaterialTheme(colorScheme = colorScheme)` 直接应用新配色，无过渡动画

**解决方案**:

```kotlin
// 添加 ColorScheme.animate() 扩展函数
@Composable
fun ColorScheme.animate(): ColorScheme = copy(
    primary = animateColorAsState(primary, tween(400)).value,
    onPrimary = animateColorAsState(onPrimary, tween(400)).value,
    background = animateColorAsState(background, tween(400)).value,
    surface = animateColorAsState(surface, tween(400)).value,
    // ... 其他 24+ 颜色属性
)

// 使用
val animatedColorScheme = colorScheme.animate()
MaterialTheme(colorScheme = animatedColorScheme, ...)
```

**状态**: 已修复

---

## 开发工具问题

### Issue: Git pre-commit hook 运行全量测试导致提交缓慢

**症状**: `git commit` 触发 pre-commit hook 运行 desktop-app-vue 全量 Vitest 测试（10k+ 用例），耗时 ~11 分钟，且部分测试有不稳定超时失败

**原因**: pre-commit hook 配置运行了完整测试套件而非仅验证受影响的文件

**临时解决方案**:

```bash
# 跳过 hook（仅当确认改动无关 JS/TS 代码时使用）
git commit --no-verify -m "message"
```

**建议改进**:

1. **按路径过滤**: hook 中检测改动文件路径，仅修改 `desktop-app-vue/` 时才跑桌面端测试
2. **使用 lint-staged**: 仅对暂存文件运行相关测试
3. **拆分快速/慢速测试**: pre-commit 仅运行快速测试，push 时运行全量

**状态**: 使用 `--no-verify` 临时绕过，待优化 hook 配置

---

## 技能系统问题 (v0.35.0)

### Issue: SKILL.md 解析失败 — gray-matter 不可用

**症状**:

```
[SkillMdParser] gray-matter not available, using simple parser
Warning: Skill "xxx" frontmatter parsing incomplete
```

**原因**: `gray-matter` 是可选依赖，未安装时使用简易解析器。简易解析器不支持完整 YAML（多行字符串、嵌套数组等）。

**解决方案**:

1. **安装 gray-matter**:

```bash
cd desktop-app-vue
npm install gray-matter
```

2. **简化 YAML frontmatter**: 如果无法安装，避免使用多行字符串和复杂嵌套：

```yaml
# ✅ 简易解析器支持
name: my-skill
description: 简单描述
version: 1.0.0

# ❌ 简易解析器不支持
description: |
  多行
  描述
capabilities:
  - name: cap1
    value: true
```

**实现位置**: `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-md-parser.js:14-19`

**状态**: 已解决 — 简易解析器可满足大多数场景

---

### Issue: 统一工具注册表初始化顺序错误

**症状**:

```
[UnifiedToolRegistry] FunctionCaller not bound, skipping import
[UnifiedToolRegistry] 0 tools imported (expected 60+)
```

**原因**: `UnifiedToolRegistry.initialize()` 在 `bindFunctionCaller()` 之前被调用。IPC Registry 中初始化顺序不正确。

**解决方案**:

1. **确保正确的初始化顺序** (在 `ipc-registry.js` Phase 15):

```javascript
// Phase 15: Unified Tools (必须在 FunctionCaller、MCP、Skills 之后)
const registry = new UnifiedToolRegistry();
registry.bindFunctionCaller(functionCaller); // 先绑定
registry.bindMCPAdapter(mcpAdapter);
registry.bindSkillRegistry(skillRegistry);
await registry.initialize(); // 最后初始化
```

2. **检查 \_initPromise 防重入**: `initialize()` 有内置防重入保护，确保不会并发调用。

**实现位置**: `desktop-app-vue/src/main/ipc/ipc-registry.js` (Phase 15)

**状态**: 已解决 — 初始化顺序在 ipc-registry.js 中明确控制

---

### Issue: ToolSkillMapper 未匹配到预期工具

**症状**: 某些 FunctionCaller 工具在 ToolsExplorerPage 中显示为 "uncategorized" 而非预期分组。

**原因**: 工具名称不匹配 SKILL_GROUPS 中定义的正则模式。

**解决方案**:

1. **检查工具名称**: 确认工具注册时使用的名称与 SKILL_GROUPS 模式匹配
2. **添加新的匹配模式**:

```javascript
// tool-skill-mapper.js — 添加匹配规则
{ name: "my-group", match: [/^my_prefix_/, "specific_tool_name"], category: "custom" }
```

3. **使用 SKILL.md 覆盖**: 创建 SKILL.md 并在 `## 工具` 中明确列出工具名，优先级高于 ToolSkillMapper

**实现位置**: `desktop-app-vue/src/main/ai-engine/tool-skill-mapper.js`

**状态**: 设计预期 — uncategorized 工具可通过 SKILL.md 或修改 SKILL_GROUPS 解决

---

### Issue: 演示模板加载时 JSON 解析失败

**症状**:

```
[DemoTemplateLoader] Failed to parse template: SyntaxError: Unexpected token
```

**原因**: 模板 JSON 文件格式错误（尾随逗号、注释等非标准 JSON）。

**解决方案**:

1. **验证 JSON 格式**: 使用 `JSON.parse()` 前先验证

```bash
# 检查 JSON 语法
node -e "JSON.parse(require('fs').readFileSync('path/to/template.json'))"
```

2. **模板 JSON 结构要求**:

```json
{
  "name": "template-name",
  "displayName": "显示名",
  "description": "描述",
  "category": "automation|ai-workflow|knowledge|remote",
  "difficulty": "beginner|intermediate|advanced",
  "skills": ["skill-1", "skill-2"],
  "steps": [...]
}
```

**实现位置**: `desktop-app-vue/src/main/templates/demo-template-loader.js`

**状态**: 已解决 — DemoTemplateLoader 包含 try-catch 错误处理

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
