# ChainlessChain 架构模式库

> 记录项目中已验证的架构模式和解决方案，供 AI 助手和开发者参考
>
> **版本**: v1.5.0
> **最后更新**: 2026-04-16

---

## 代码编辑模式

### Pattern: Hashline — 内容哈希锚定行编辑 (v5.0.2.9)

**问题**: `edit_file` 使用精确字符串匹配进行替换，对空白漂移（自动格式化、缩进调整）、行号漂移（并发编辑）极度脆弱。oh-my-openagent 实测显示行号方案成功率仅 6.7%，而哈希锚定方案可达 68.3%。

**解决方案**:

```js
// 1. 读文件时以 hashed:true 拿到带哈希标记的内容
await executeTool("read_file", { path: "foo.js", hashed: true });
// → "a3Kp9Z| const x = 1;\nbB7rLm| const y = 2;"

// 2. 用哈希作为锚点替换单行
await executeTool("edit_file_hashed", {
  path: "foo.js",
  anchor_hash: "a3Kp9Z",
  expected_line: "const x = 1;", // 第二层安全检查，防哈希碰撞
  new_line: "const x = 42;",
});
```

**哈希算法**: `base64url(sha256(line.trim())).slice(0, 6)`

- 6 字符足够防碰撞（~680 亿空间），够短不污染 LLM 上下文
- `.trim()` 使哈希对缩进/尾随空白不敏感 — 抗自动格式化漂移
- 空行统一编码为 `______`（6 个下划线），避免模型"看到哈希就假设有内容"

**三种错误返回（self-healing）**:

- `hash_mismatch` — 锚点不存在，提示重新读文件
- `ambiguous_anchor` — 多行哈希相同，返回 `matches[]` 和 `current_snippet`（带新鲜哈希的上下文）让模型重试
- `content_mismatch` — 哈希命中但 `expected_line` 对不上（第二层安全检查失败）

**关键实现位置**:

- `packages/cli/src/lib/hashline.js` — 纯函数：`hashLine` / `annotateLines` / `findByHash` / `replaceByHash` / `snippetAround`
- `packages/cli/src/runtime/agent-core.js` — `read_file` (hashed 模式) + `edit_file_hashed` handler
- `packages/cli/src/runtime/coding-agent-contract-shared.cjs` — `edit_file_hashed` 契约
- `packages/cli/src/runtime/coding-agent-policy.cjs` — 策略元数据（MEDIUM risk，与 edit_file 同级）

**测试**: `__tests__/unit/hashline.test.js` (29 tests) + `__tests__/unit/agent-core-edit-hashed.test.js` (12 tests)

**权限**: 与 `edit_file` 同级（MEDIUM，`availableInPlanMode: false`，`requiresPlanApproval: true`），无需新增 Plan Mode / Permission Gate 规则。

**灵感来源**: oh-my-openagent 的 Hashline 设计

---

### Pattern: Hooks 三件套 — 会话级钩子触发 (v5.0.2.9)

**问题**: CLI `hook-manager.js` 定义了 28 个 `HookEvents`，但只有 `PreToolUse`/`PostToolUse`/`ToolError` 被 `runtime/agent-core.js` 实际触发。`SessionStart` / `UserPromptSubmit` / `SessionEnd` 这三个会话级钩子是死代码 —— 定义了但从未被调用，用户注册了也不会执行。

**解决方案** (借鉴 oh-my-openagent 的 hooks 三件套):

新增 `src/lib/session-hooks.js` 作为会话级钩子的唯一触发点，在 `repl/agent-repl.js` 的三个生命周期位置调用：

```js
// agent-repl.js
import { fireSessionHook } from "../lib/session-hooks.js";
import { HookEvents } from "../lib/hook-manager.js";

// 1. SessionStart — banner 之后，prompt() 之前
await fireSessionHook(_hookDb, HookEvents.SessionStart, {
  sessionId, provider, model, cwd: process.cwd(),
});

// 2. UserPromptSubmit — rl.on("line") 内，messages.push 之前
await fireSessionHook(_hookDb, HookEvents.UserPromptSubmit, {
  sessionId, prompt: trimmed, messageCount: messages.length,
});

// 3. SessionEnd — rl.on("close") 内，shutdown() 之前
await fireSessionHook(_hookDb, HookEvents.SessionEnd, {
  sessionId, messageCount: messages.length,
});
```

**关键设计**:
- **事件白名单**: `SESSION_HOOK_EVENTS` 冻结数组，非三件套事件直接抛错，防止静默 no-op（executeHooks 内部会按事件过滤，typo 会悄悄没效果）
- **fire-and-forget**: 匹配现有 `PreToolUse` 约定 —— 钩子失败永远不能中断 REPL。helper 吞掉所有内部错误返回 `[]`
- **观察性而非控制**: 首版不支持 abort / rewrite prompt。如需 gate prompt，用户应通过钩子返回码 + 独立包装层实现，不要塞进 helper
- **`hookDb === null` → no-op**: REPL 在没有 DB 模式下运行时自动跳过所有钩子
- **时间戳注入**: helper 自动往 context 里塞 `timestamp: ISO-string`，和 PreToolUse 保持一致

**关键实现位置**:
- `packages/cli/src/lib/session-hooks.js` — `fireSessionHook(hookDb, eventName, context)` + `SESSION_HOOK_EVENTS`
- `packages/cli/src/repl/agent-repl.js` — 三个 fire 站点（SessionStart/UserPromptSubmit/SessionEnd）
- tool-level 钩子继续由 `runtime/agent-core.js` 触发 —— 两层钩子各司其职

**测试**: `__tests__/unit/session-hooks.test.js` (15 tests — 白名单、no-op、stats 累计、优先级顺序、broken db 容错)

**未来可扩展**:
- `UserPromptSubmit` 可以解析钩子 stdout 作为 rewritten prompt（omo 风格）
- `AssistantResponse` 同样是死代码，可用相同 helper 在 `agentLoop` 返回点补一个第四位

**灵感来源**: oh-my-openagent 的 hooks 三件套

---

### Pattern: Skill-Embedded MCP — 技能内联 MCP 服务器 (v5.0.2.9)

**问题**: MCP 服务器目前必须预注册在 DB 中，所有注册的 MCP 工具在每次 agent 会话启动时全量暴露给 LLM。当技能数量增长到 130+ 时，会造成"工具爆炸"问题：模型上下文里塞满大量不相关的 MCP 工具，token 消耗大、工具选择困难。

**解决方案** (借鉴 oh-my-openagent 的 "Skill-Embedded MCPs" 设计):

技能在自己的 SKILL.md body 里用 fenced code block 直接声明所需的 MCP 服务器，运行时只在该技能激活期间 mount，技能退出后 unmount。

```markdown
---
name: weather-agent
description: Query weather using MCP
---

This skill fetches live weather data.

## MCP Servers

\`\`\`mcp-servers
[
  {
    "name": "weather",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-weather"]
  }
]
\`\`\`

## Instructions
...
```

**关键设计**:

- **Fenced code block 而非 YAML frontmatter**: 零改动现有 simple YAML parser，markdown 语法干净，编辑器高亮友好（可用 ```` ```json mcp-servers ```` 变体）
- **纯函数解析 + 验证**: `parseSkillMcpServers(body)` 返回经过 `validateMcpServerConfig` 过滤的 frozen 配置数组；无效条目（缺 name/command、非对象）自动跳过
- **容错 mount**: `mountSkillMcpServers(client, skill)` 单个服务器失败不会中断其他服务器，失败项收集到 `skipped` 数组并通过 `onWarn` 回调上报
- **disconnectAll 回退**: `unmountSkillMcpServers` 优先调用 `mcpClient.disconnect(name)`；若 client 没有单点 disconnect，自动回退到 `disconnectAll()`
- **零破坏**: 未声明 `mcp-servers` 块的技能 `skill.mcpServers = []`，现有技能无需迁移

**关键实现位置**:

- `packages/cli/src/lib/skill-mcp.js` — `parseSkillMcpServers` / `validateMcpServerConfig` / `mountSkillMcpServers` / `unmountSkillMcpServers`
- `packages/cli/src/lib/skill-loader.js` — `_loadFromDir` 填充 `skill.mcpServers`
- 消费方（future phase）：agent-runtime 在 `run_skill` 工具路径 mount/unmount；context engineering 基于当前激活的技能过滤 MCP 工具集

**测试**: `__tests__/unit/skill-mcp.test.js` (26 tests) + 现有 `skill-loader.test.js` (28 tests) 回归通过

**灵感来源**: oh-my-openagent 的 Skill-Embedded MCPs 设计

---

## 数据库模式

### Pattern: SQLite 并发处理

**问题**: SQLite 单写锁导致 SQLITE_BUSY 错误

**解决方案**:

```javascript
// 1. 启用 WAL 模式
db.pragma("journal_mode = WAL");

// 2. 设置 busy_timeout
db.pragma("busy_timeout = 30000");

// 3. 使用 ErrorMonitor 自动重试
const result = await errorMonitor.retryWithExponentialBackoff(
  () => db.run(sql, params),
  { maxRetries: 5, baseDelay: 100 },
);
```

**实现位置**: `desktop-app-vue/src/main/error-monitor.js:877-948`

---

### Pattern: 参数化查询防注入

**问题**: SQL 注入攻击风险

**解决方案**:

```javascript
// ✅ 正确 - 参数化查询
const stmt = db.prepare("SELECT * FROM notes WHERE id = ?");
const note = stmt.get(noteId);

// ✅ 正确 - 批量插入
const insert = db.prepare("INSERT INTO notes (title, content) VALUES (?, ?)");
const insertMany = db.transaction((notes) => {
  for (const note of notes) insert.run(note.title, note.content);
});

// ❌ 错误 - 字符串拼接
const note = db.exec(`SELECT * FROM notes WHERE id = '${noteId}'`);
```

**检测工具**: `desktop-app-vue/scripts/rules-validator.js:76-203`

---

## LLM 集成模式

### Pattern: 多提供商路由

**问题**: 不同任务需要不同性价比的模型

**解决方案**:

```javascript
// LLMManager 智能路由
class LLMManager {
  async chat(messages, options = {}) {
    const provider = this.selectProvider(options);

    // 简单任务 → 本地 Ollama (免费)
    // 复杂推理 → 云端高性能模型
    // 敏感数据 → 本地模型 (数据不出境)
  }

  selectProvider(options) {
    if (options.localOnly || this.containsSensitiveData(messages)) {
      return "ollama";
    }
    if (options.complexity === "high") {
      return this.config.preferredCloudProvider;
    }
    return "ollama"; // 默认本地
  }
}
```

**实现位置**: `desktop-app-vue/src/main/llm/llm-manager.js`

---

### Pattern: 类别路由 (Category Routing, v5.0.2.9)

**问题**: 138 个 SKILL.md 如果硬编码 `model: claude-opus-4-6`，换 provider 时得全部改一遍；而且 cowork/agent 代码里也会散落模型字符串。

**解决方案** (借鉴 oh-my-openagent 的 category 路由思路):

Skill 声明 *类别* 而非 model，运行时根据 **用户当前 `llm-config.js` 已配置的 provider** 自动挑选最优匹配。

```javascript
// llm-manager.js
const LLM_CATEGORIES = {
  QUICK:     "quick",     // 补全/简单改写  → 优先本地 ollama
  DEEP:      "deep",      // 长上下文/架构  → 优先 anthropic/openai
  REASONING: "reasoning", // 推理密集        → 优先 deepseek/o1
  VISION:    "vision",    // 多模态          → 优先 gemini/gpt-4o
  CREATIVE:  "creative",  // 文案/UI        → 优先 anthropic
};

// 从 SKILL.md 现有字段反推 category（零迁移成本）
inferCategoryFromModelHints({ "context-window": "large", capability: "reasoning" })
// → "reasoning"

// 解析到具体 provider + model
llmManager.resolveCategory("deep")
// → { provider: "anthropic", model: "claude-3-opus-...", options: { maxTokens: 8192 } }

// Skill 驱动（便捷写法）
llmManager.resolveCategory(undefined, { skill })
```

**关键设计**:
- **"已配置"判定**: `ollama` 始终可用（本地），`custom` 需 `baseURL`，其他需 `apiKey`
- **纯新增，零破坏**: `chat()` 完全不改；老的 `model:` / `modelHints.preferred` 照常工作
- **缓存**: 结果缓存到 `this._categoryMappingCache`，`rebuildCategoryMapping()` 强制刷新（应对配置变更）
- **`_deps` 注入**: `getLLMConfig` 通过 `_deps` 懒加载，Vitest 测试可覆盖

**实现位置**: `desktop-app-vue/src/main/llm/llm-manager.js` (末尾 Category Routing 段)
**测试**: `desktop-app-vue/src/main/llm/__tests__/llm-manager-category-routing.test.js` (26 tests)

---

### Pattern: Token 成本追踪

**问题**: LLM API 调用成本难以控制

**解决方案**:

```javascript
// TokenTracker 追踪每次调用
class TokenTracker {
  async trackUsage(provider, model, inputTokens, outputTokens) {
    const cost = this.calculateCost(provider, model, inputTokens, outputTokens);

    await db.run(
      `
      INSERT INTO llm_usage_log (provider, model, input_tokens, output_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?)
    `,
      [provider, model, inputTokens, outputTokens, cost],
    );

    // 检查预算
    if (await this.isOverBudget()) {
      this.emit("budget-alert", { currentSpend: await this.getMonthlySpend() });
    }
  }
}
```

**实现位置**: `desktop-app-vue/src/main/llm/token-tracker.js`

---

### Pattern: 会话压缩

**问题**: 长对话历史消耗大量 Token

**解决方案**:

```javascript
// PromptCompressor 三层压缩策略
class PromptCompressor {
  async compress(messages, options) {
    // 1. 去重 - 移除重复内容
    messages = this.deduplication(messages);

    // 2. 截断 - 保留最近 N 条
    messages = this.truncation(messages, options.maxMessages);

    // 3. 总结 - 使用 LLM 总结旧历史 (可选)
    if (options.enableSummarization && this.llmManager) {
      messages = await this.summarization(messages);
    }

    return messages;
  }
}
```

**实现位置**: `desktop-app-vue/src/main/llm/prompt-compressor.js`
**测试结果**: 压缩率 0.76-0.93，节省 7-24% Token

---

## P2P 通信模式

### Pattern: Signal Protocol E2E 加密

**问题**: P2P 消息需要端到端加密

**解决方案**:

```javascript
// 1. 建立会话
const session = await signalProtocol.createSession(recipientDID, preKeyBundle);

// 2. 加密消息
const ciphertext = await session.encrypt(plaintext);

// 3. 发送加密消息
await p2pNode.pubsub.publish(topic, ciphertext);

// 4. 接收方解密
const plaintext = await session.decrypt(ciphertext);
```

**实现位置**: `desktop-app-vue/src/main/p2p/signal-manager.js`

---

### Pattern: 离线消息队列

**问题**: 对方不在线时消息丢失

**解决方案**:

```javascript
class OfflineMessageQueue {
  async sendMessage(recipientDID, message) {
    try {
      await this.p2pManager.send(recipientDID, message);
    } catch (error) {
      if (error.code === "PEER_NOT_FOUND") {
        // 存入离线队列
        await db.run(
          `
          INSERT INTO offline_queue (recipient_did, message, created_at)
          VALUES (?, ?, ?)
        `,
          [recipientDID, JSON.stringify(message), Date.now()],
        );

        // 下次对方上线时自动重发
        this.scheduleRetry(recipientDID);
      }
    }
  }
}
```

**实现位置**: `desktop-app-vue/src/main/p2p/offline-queue.js`

---

## 错误处理模式

### Pattern: 智能错误诊断

**问题**: 错误信息不易理解和修复

**解决方案**:

```javascript
// ErrorMonitor AI 诊断
class ErrorMonitor {
  async analyzeError(error) {
    const analysis = {
      classification: this.classifyError(error), // DATABASE, NETWORK, etc.
      severity: this.assessSeverity(error), // low/medium/high/critical
      autoFixResult: await this.attemptAutoFix(error),
      aiDiagnosis: await this.getAIDiagnosis(error), // 本地 Ollama
      recommendations: this.generateRecommendations(analysis),
    };

    return analysis;
  }
}
```

**实现位置**: `desktop-app-vue/src/main/error-monitor.js:849-932`

---

## MCP 集成模式

### Pattern: 安全的 MCP 服务器管理

**问题**: MCP 服务器可能访问敏感数据

**解决方案**:

```javascript
// 1. 白名单注册
const trustedServers = require("./servers/server-registry.json");

// 2. 路径限制
const securityPolicy = {
  allowedPaths: ["notes/", "imports/", "exports/"],
  forbiddenPaths: ["chainlesschain.db", "ukey/", "did/private-keys/"],
  readOnly: false,
};

// 3. 用户确认高风险操作
if (tool.riskLevel === "high") {
  const consent = await dialog.showMessageBox({
    type: "warning",
    message: `MCP 工具 ${tool.name} 请求执行高风险操作`,
    buttons: ["允许", "拒绝"],
  });
}
```

**实现位置**: `desktop-app-vue/src/main/mcp/mcp-security-policy.js`

---

## 配置管理模式

### Pattern: 统一配置管理

**问题**: 配置分散在多个文件中

**解决方案**:

```javascript
// UnifiedConfigManager 单一入口
class UnifiedConfigManager {
  constructor() {
    this.configDir = path.join(projectRoot, ".chainlesschain");
    this.config = this.loadConfig();
  }

  getConfig(section) {
    return this.config[section];
  }

  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  // 配置优先级: 环境变量 > config.json > 默认值
  getValue(key, defaultValue) {
    return process.env[key] || this.config[key] || defaultValue;
  }
}
```

**实现位置**: `desktop-app-vue/src/main/config/unified-config-manager.js`

---

## 性能优化模式

### Pattern: 查询结果缓存

**问题**: 重复查询消耗数据库资源

**解决方案**:

```javascript
class QueryCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl || 60000; // 默认 60 秒
  }

  async query(sql, params, queryFn) {
    const cacheKey = this.getCacheKey(sql, params);

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.ttl) {
        return cached.data;
      }
    }

    const result = await queryFn();
    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }
}
```

---

## Android 区块链模式

### Pattern: BouncyCastle secp256k1 椭圆曲线操作

**问题**: Android 端需要实现以太坊兼容的 ECDSA 签名和公钥推导，不依赖原生 C 库

**解决方案**:

```kotlin
// 使用 BouncyCastle CustomNamedCurves (比 ECNamedCurveTable 更高效)
val curveParams = CustomNamedCurves.getByName("secp256k1")

// 公钥推导 - 使用 FixedPointCombMultiplier (常量时间，防侧信道攻击)
val pointQ = FixedPointCombMultiplier().multiply(curveParams.g, BigInteger(1, privateKey))
val uncompressedPubKey = pointQ.getEncoded(false) // 65 bytes
val compressedPubKey = pointQ.getEncoded(true)     // 33 bytes (BIP32 用)

// ECDSA 签名 - 使用 HMacDSAKCalculator (RFC 6979 确定性 k)
val signer = ECDSASigner(HMacDSAKCalculator(SHA256Digest()))
signer.init(true, ECPrivateKeyParameters(privKeyNum, domainParams))
val (r, s) = signer.generateSignature(hash)

// EIP-2 正规化: s 必须在曲线阶的下半部分
if (s > curveParams.n.shiftRight(1)) {
    s = curveParams.n.subtract(s)
}

// Recovery ID 计算: 尝试 0-3 恢复公钥并与原始公钥比对
```

**关键要点**:

- 使用 `CustomNamedCurves` 而非 `ECNamedCurveTable` (性能更好)
- BIP32 非硬化子密钥推导必须使用 33 字节压缩公钥
- 签名后务必做 EIP-2 s 正规化，否则交易会被以太坊节点拒绝
- Recovery ID 用于 `ecrecover`，v = recId + 27 (Legacy) 或 recId (EIP-1559)

**实现位置**: `android-app/core-blockchain/src/main/java/.../crypto/WalletCoreAdapter.kt`

---

### Pattern: RLP 编码 (以太坊交易序列化)

**问题**: 以太坊交易需要 RLP 编码，Android 端无现成库

**解决方案**:

```kotlin
object RLPEncoder {
    // 单字节 [0x00, 0x7f] → 直接编码
    // 短字符串 <56B → 0x80+len 前缀
    // 长字符串 ≥56B → 0xb7+lenOfLen + len 前缀
    // 短列表 <56B → 0xc0+len 前缀
    // 长列表 ≥56B → 0xf7+lenOfLen + len 前缀

    fun encodeBytes(input: ByteArray): ByteArray { ... }
    fun encodeBigInteger(value: BigInteger): ByteArray { ... }
    fun encodeList(items: List<ByteArray>): ByteArray { ... }
}

// Legacy tx: RLP([nonce, gasPrice, gasLimit, to, value, data])
// EIP-1559: 0x02 || RLP([chainId, nonce, maxPriorityFee, maxFee, gasLimit, to, value, data, []])
// 签名后追加 v, r, s 到列表末尾
```

**关键要点**:

- BigInteger 编码时需要去除前导零字节（符号位）
- 零值编码为空字节数组 `encodeBytes(ByteArray(0))`
- EIP-1559 交易需要 `0x02` 类型前缀在 RLP 之前
- 签名交易通过剥离 RLP 列表头、追加 v/r/s、重新包装实现

**实现位置**: `android-app/core-blockchain/src/main/java/.../crypto/RLPEncoder.kt`

---

### Pattern: Ethereum Keystore V3 解密

**问题**: 用户导入以太坊钱包 Keystore JSON 文件

**解决方案**:

```kotlin
fun decryptKeystoreV3(keystoreJson: String, password: String): ByteArray {
    // 1. 解析 JSON: crypto.cipher, crypto.kdf, crypto.ciphertext, cipherparams.iv, mac
    // 2. KDF 派生密钥:
    //    - scrypt: SCrypt.generate(password, salt, n, r, p, dkLen)
    //    - pbkdf2: PBKDF2WithHmacSHA256(password, salt, iterations, dkLen)
    // 3. MAC 验证: keccak256(derivedKey[16:32] + ciphertext) == mac
    // 4. AES-128-CTR 解密: Cipher("AES/CTR/NoPadding", derivedKey[0:16], iv)
}
```

**关键要点**:

- 同时支持 `"crypto"` 和 `"Crypto"` 字段名（不同钱包生成的格式不同）
- MAC 验证失败 = 密码错误，需要给用户友好提示
- BouncyCastle 的 `SCrypt.generate` 直接可用，无需额外依赖

**实现位置**: `android-app/feature-blockchain/src/main/java/.../manager/WalletManager.kt`

---

## Android UI 模式

### Pattern: Compose 搜索输入防抖

**问题**: 用户输入搜索词时，每次按键都触发网络请求

**解决方案**:

```kotlin
var searchQuery by remember { mutableStateOf("") }

// 输入框只更新 state，不直接调用搜索
onQueryChange = { searchQuery = it }

// 单独的 LaunchedEffect 处理防抖
LaunchedEffect(Unit) {
    snapshotFlow { searchQuery }
        .debounce(300)
        .distinctUntilChanged()
        .collectLatest { query ->
            viewModel.searchFriends(query)
        }
}
```

**关键要点**:

- `snapshotFlow` 将 Compose State 转为 Flow
- `debounce(300)` 等待 300ms 无新输入后才触发
- `distinctUntilChanged()` 避免相同查询重复请求
- `collectLatest` 取消前一个未完成的搜索

**实现位置**: `android-app/feature-p2p/src/main/java/.../social/FriendListScreen.kt`

---

### Pattern: Compose 深色模式平滑过渡

**问题**: 深色/浅色模式切换时颜色突变，体验生硬

**解决方案**:

```kotlin
@Composable
private fun ColorScheme.animate(durationMs: Int = 400): ColorScheme {
    val animSpec = tween<Color>(durationMillis = durationMs)
    return copy(
        primary = animateColorAsState(primary, animSpec, label = "primary").value,
        background = animateColorAsState(background, animSpec, label = "background").value,
        surface = animateColorAsState(surface, animSpec, label = "surface").value,
        // ... 覆盖所有关键颜色属性
    )
}

// 在 Theme 中使用
val animatedColorScheme = colorScheme.animate()
MaterialTheme(colorScheme = animatedColorScheme, ...)
```

**关键要点**:

- 使用 `ColorScheme.copy()` 扩展函数，保持原有结构
- 每个颜色属性需要唯一的 `label` 参数（调试用）
- 400ms tween 是视觉上舒适的过渡时长
- 需覆盖至少 20+ 个颜色属性才能避免"部分过渡"的违和感

**实现位置**: `android-app/core-ui/src/main/java/.../theme/Theme.kt`

---

### Pattern: Compose 点击弹跳动画

**问题**: 按钮点击反馈单调，缺少物理感

**解决方案**:

```kotlin
val likeScale = remember { Animatable(1f) }
val tintColor by animateColorAsState(
    targetValue = if (isLiked) Color(0xFFE91E63) else MaterialTheme.colorScheme.onSurfaceVariant,
    animationSpec = spring(stiffness = Spring.StiffnessLow)
)

// 点击时触发 scale 脉冲
onClick = {
    isLiked = !isLiked
    scope.launch {
        likeScale.animateTo(1.3f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessLow))
        likeScale.animateTo(1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessLow))
    }
}

// Icon 应用 scale
Icon(modifier = Modifier.scale(likeScale.value), tint = tintColor)
```

**关键要点**:

- `Animatable` 比 `animateFloatAsState` 更适合脉冲效果（可串联动画）
- `spring(DampingRatioMediumBouncy)` 产生自然的弹跳感
- 颜色用 `animateColorAsState`（单向渐变），scale 用 `Animatable`（双向脉冲）
- 需要 `rememberCoroutineScope()` 在 onClick 中启动协程

**实现位置**: `android-app/app/src/main/java/.../screens/ExploreScreen.kt`

---

## Android AI 集成模式

### Pattern: LLM 适配器工厂 + CUSTOM Provider

**问题**: 用户使用 OpenAI 兼容的第三方 API 端点，需要自定义 baseURL

**解决方案**:

```kotlin
class LLMAdapterFactory {
    fun createAdapter(provider: LLMProvider, apiKey: String): LLMAdapter {
        // API Key 验证 - 友好错误而非崩溃
        if (apiKey.isNullOrBlank()) {
            throw IllegalArgumentException("${provider.displayName}的API Key未配置，请在AI设置中配置后重试")
        }

        return when (provider) {
            LLMProvider.CUSTOM -> {
                val config = configManager.getConfig().custom
                OpenAIAdapter(apiKey, config.baseURL.ifBlank { "https://api.openai.com/v1" })
            }
            // ... 其他 providers
        }
    }
}
```

**关键要点**:

- CUSTOM provider 复用 `OpenAIAdapter`，因为大多数第三方 API 兼容 OpenAI 格式
- `requireNotNull` 会产生不友好的 `IllegalArgumentException`，改用 if-else + 带 provider 名称的错误信息
- ViewModel 中按异常类型给出具体错误提示 (UnknownHost → 网络, Timeout → 超时, ConnectException → 服务未启动)

**实现位置**: `android-app/feature-ai/src/main/java/.../di/AIModule.kt`

---

## 统一工具注册表模式 (v0.35.0)

### Pattern: 三系统工具聚合

**问题**: FunctionCaller (60+ 工具)、MCP (8 服务器)、Skills (30 技能) 三套工具系统各自独立，AI 无法统一发现和使用所有工具。

**解决方案**:

```javascript
// UnifiedToolRegistry — 单例聚合三大工具系统
class UnifiedToolRegistry extends EventEmitter {
  constructor() {
    super();
    this.tools = new Map(); // 所有工具 keyed by normalized name
    this.skills = new Map(); // 技能清单 keyed by skill name
    this.functionCaller = null; // FunctionCaller 引用
    this.mcpAdapter = null; // MCPToolAdapter 引用
    this.skillRegistry = null; // SkillRegistry 引用
  }

  // 绑定三大系统
  bindFunctionCaller(fc) {
    this.functionCaller = fc;
  }
  bindMCPAdapter(adapter) {
    this.mcpAdapter = adapter;
    // 监听 MCP 服务器连接/断开事件
    adapter.on?.("server-registered", ({ serverName, toolIds }) => {
      this._onMCPServerRegistered(serverName, toolIds);
    });
  }
  bindSkillRegistry(sr) {
    this.skillRegistry = sr;
  }

  // 初始化: 导入所有工具 + 关联技能元数据
  async initialize() {
    this._importFunctionCallerTools();
    this._importMCPTools();
    this._importSkillTools();
    this._applyToolSkillMapper(); // 未覆盖工具自动分组
    this._applyMCPSkillGenerator(); // MCP 服务器自动生成技能
  }
}
```

**实现位置**: `desktop-app-vue/src/main/ai-engine/unified-tool-registry.js`

---

### Pattern: 工具名称标准化映射

**问题**: SKILL.md 使用 kebab-case (如 `browser-automation`)，FunctionCaller 使用 snake_case (如 `file_reader`)，需要统一匹配。

**解决方案**:

```javascript
// 标准化为 snake_case 进行内部匹配
_normalizeName(name) {
  return name.replace(/-/g, '_').toLowerCase();
}

// SKILL.md 中声明的 tools 字段与 FunctionCaller 工具匹配
_associateSkillTools(skill) {
  const toolNames = skill.tools || [];
  for (const toolName of toolNames) {
    const normalized = this._normalizeName(toolName);
    const tool = this.tools.get(normalized);
    if (tool) {
      tool.skillName = skill.name;
      tool.instructions = skill.instructions;
      tool.examples = skill.examples;
    }
  }
}
```

**实现位置**: `desktop-app-vue/src/main/ai-engine/unified-tool-registry.js`

---

### Pattern: 默认技能自动分组 (ToolSkillMapper)

**问题**: 60+ FunctionCaller 工具中，只有部分被 SKILL.md 覆盖，其余工具缺少技能元数据。

**解决方案**:

```javascript
// 10 个默认技能分组，使用正则匹配工具名
const SKILL_GROUPS = [
  { name: "file-operations",   match: [/^file_/], category: "core" },
  { name: "code-generation",   match: [/^html_gen/, /^css_gen/, /^js_gen/], category: "development" },
  { name: "git-operations",    match: [/^git_/], category: "development" },
  { name: "data-processing",   match: [/^data_/, "json_parser"], category: "data" },
  // ... 10 groups total
];

// 匹配逻辑: 字符串精确匹配 + 正则匹配
matchTool(toolName, patterns) {
  return patterns.some(p =>
    p instanceof RegExp ? p.test(toolName) : toolName === p
  );
}
```

**实现位置**: `desktop-app-vue/src/main/ai-engine/tool-skill-mapper.js`

---

### Pattern: MCP 服务器自动生成技能 (MCPSkillGenerator)

**问题**: MCP 服务器连接时，其工具没有 Agent Skills 元数据 (instructions/examples)。

**解决方案**:

```javascript
// 从 BUILTIN_CATALOG 获取预定义元数据，否则自动生成
generateSkillFromMCPServer(serverName, catalogEntry, tools) {
  const instructions = catalogEntry?.skillInstructions
    || this._generateInstructions(serverName, displayName, tools);
  const examples = catalogEntry?.skillExamples
    || this._generateExamples(serverName, tools);

  return {
    name: `mcp-${serverName}`,
    displayName,
    instructions,
    examples,
    toolNames: tools.map(t => t.toolId),
    source: "mcp-auto",
  };
}
```

**实现位置**: `desktop-app-vue/src/main/mcp/mcp-skill-generator.js`

---

## Canonical Tool Descriptor 规范 (v5.0.2.9)

> 设计文档：`docs/design/modules/83_工具描述规范统一.md`

### Pattern: `inputSchema` 为真源，`parameters` 只读镜像

**问题**: CLI / Desktop Main / Renderer / MCP 四端曾经有 5 套工具定义源，字段漂移导致 Plan Mode、Permission Gate、function-calling schema 行为不一致。

**解决方案**:

```js
// Canonical shape (详见 unified-tool-registry.js / tool-masking.js)
{
  name: "read_file",                        // 必填
  inputSchema: { type: "object", ... },     // 真源，必填
  parameters: { type: "object", ... },      // 只读镜像，由 normalizer 自动从 inputSchema 派生
  // 身份
  title, description, kind, source, category,
  // 权限 & Plan Mode
  isReadOnly, riskLevel, permissions,
  availableInPlanMode, requiresPlanApproval, requiresConfirmation, approvalFlow,
  // Telemetry / Skill 关联
  telemetry, skillName, skillCategory, instructions, examples, tags,
}
```

**强制规则**:

- **禁止手工双写** `inputSchema` + `parameters`。写路径只允许三种形态：
  1. 只写 `inputSchema`，由 normalizer 产出 `parameters` 镜像（推荐）
  2. 只写 legacy `parameters`，由 normalizer 反向镜像 `inputSchema`（FunctionCaller 工具注册端）
  3. 在 canonicalize helper 中显式 `parameters: inputSchema` 或 `inputSchema: parameters`（`tool-masking.js` / `computer-use-tools.js` / `mcp-ipc.js`）
- **读路径统一用 fallback 链**: `tool.inputSchema || tool.parameters || { type: "object", properties: {} }`，永远不要只读 `parameters`
- **权限语义必须随 descriptor 走**: Permission Gate / Plan Mode 只读 `isReadOnly` / `riskLevel` / `availableInPlanMode` / `requiresPlanApproval`，禁止用工具名硬编码白名单
- **对外必 clone**: `unified-tool-registry` 从缓存 Map 取出的 descriptor 在暴露给 IPC / Renderer 前必须 `cloneValue()`，防止消费方污染缓存
- **默认 Plan Mode 收紧**: 未显式标注 `availableInPlanMode: true` 的工具按需要审批处理

**关键实现位置**:

- `packages/cli/src/runtime/coding-agent-contract-shared.cjs` — CLI 真源契约
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-tool-adapter.js` — Desktop 从 contract 派生
- `desktop-app-vue/src/main/ai-engine/unified-tool-registry.js` — `createUnifiedToolDescriptor()` + clone-on-read
- `desktop-app-vue/src/main/ai-engine/tool-masking.js` — `toCanonicalDescriptor()` + `_projectCanonical()` + `CANONICAL_TOOL_FIELDS`
- `desktop-app-vue/src/main/ai-engine/function-caller.js` — `buildMaskingPayload()` 透传 canonical 字段
- `desktop-app-vue/src/main/ai-engine/tools/computer-use-tools.js` — `canonicalizeComputerUseTool()`
- `desktop-app-vue/src/main/mcp/mcp-ipc.js` — IPC 序列化镜像
- `desktop-app-vue/src/main/llm/context-engineering.js` — LLM prompt 组装 (inputSchema 优先)
- `desktop-app-vue/src/renderer/stores/unified-tools.ts` — Renderer 只读 `inputSchema`

**新增工具的正确姿势**:

1. CLI core 工具：在 `coding-agent-contract-shared.cjs` 新增 entry，写 `inputSchema`，不要写 `parameters`
2. Desktop FunctionCaller 工具：在 `extended-tools*.js` 里按旧 `parameters` 写法即可，normalizer 自动产出 canonical shape
3. MCP 工具：由 `mcp-tool-adapter.js` / `unified-tool-registry.js` 自动规范化，工具源码不用关心
4. 技能绑定工具：SKILL.md 里只声明 `tools` 字段（工具名数组），元数据由技能 loader 注入

---

## 技能系统模式 (v0.35.0)

### Pattern: 四层技能加载

**问题**: 技能来源多样（内置、市场、用户管理、工作区），需要支持覆盖和优先级。

**解决方案**:

```javascript
// 四层加载，高层覆盖低层同名技能
async loadSkills() {
  const layers = [
    { source: "bundled",     dir: path.join(__dirname, "builtin") },
    { source: "marketplace", dir: marketplaceSkillsDir },
    { source: "managed",     dir: userManagedDir },
    { source: "workspace",   dir: workspaceSkillsDir },  // 最高优先级
  ];

  for (const layer of layers) {
    const skills = await this._loadFromDir(layer.dir, layer.source);
    for (const skill of skills) {
      this.registry.set(skill.name, skill); // 后加载覆盖前加载
    }
  }
}
```

**实现位置**: `desktop-app-vue/src/main/ai-engine/cowork/skills/index.js`

---

### Pattern: SKILL.md + Agent Skills 标准解析

**问题**: 技能定义需要支持 YAML frontmatter (基础元数据) + Markdown body (提示词/门控/参数) + Agent Skills 扩展字段。

**解决方案**:

```javascript
// SkillMdParser: YAML frontmatter + Markdown sections
parse(content) {
  // 1. 解析 YAML frontmatter (gray-matter 或 fallback 解析器)
  const { data: meta, content: body } = matter(content);

  // 2. 解析 Markdown sections
  const sections = this._parseSections(body);

  // 3. 合并 Agent Skills 标准字段 (13 扩展字段)
  return {
    name: meta.name,
    description: meta.description,
    version: meta.version,
    // Agent Skills 标准
    tools: this._parseTools(sections["工具"] || sections["Tools"]),
    instructions: sections["指南"] || sections["Instructions"] || meta.instructions,
    examples: this._parseExamples(sections["示例"] || sections["Examples"]),
    inputSchema: meta["input-schema"],
    outputSchema: meta["output-schema"],
    modelHints: meta["model-hints"],
    dependencies: meta.dependencies,
    // 门控检查
    gates: this._parseGates(sections["门控检查"]),
    // 提示词
    prompt: sections["提示词"] || sections["Prompt"],
  };
}
```

**实现位置**: `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-md-parser.js`

---

## 测试模式

### Pattern: \_deps Injection for CJS Module Testing

**问题**: Vitest `vi.mock()` 无法拦截被 `server.deps.inline` 内联的 CJS 模块的 `require()` 调用，导致 mock 不生效。

**解决方案**:

```javascript
// 源文件: 导出可变 _deps 对象
const { v4: uuidv4 } = require("uuid");
const { spawn } = require("child_process");
const _deps = { uuidv4, spawn };

class MyClass {
  doSomething() {
    return _deps.uuidv4(); // 使用 _deps 而非直接调用
  }
}
module.exports = { MyClass, _deps };

// 测试文件: beforeEach 中覆盖 _deps 属性
const mod = require("../my-module.js");
mod._deps.uuidv4 = vi.fn(() => "test-uuid");
```

**实现位置**: `desktop-app-vue/src/main/` 多个 CJS 模块 (quantization-manager, gguf-quantizer 等)

---

### Pattern: Skill Lazy Loading (parseMetadataOnly)

**问题**: 137 个技能在启动时全部解析 YAML + Markdown body，导致启动延迟。

**解决方案**:

```javascript
// SkillMdParser.parseMetadataOnly(content)
// 仅解析 YAML frontmatter，跳过 Markdown body
// 返回 stub: { ...metadata, _isStub: true, _bodyLoaded: false }

// MarkdownSkill.ensureFullyLoaded()
// 首次访问时触发完整文件读取
async ensureFullyLoaded() {
  if (!this.definition._bodyLoaded) {
    const fullContent = await fs.promises.readFile(this.filePath, "utf-8");
    this.definition = this.parser.parseContent(fullContent);
    this.definition._bodyLoaded = true;
  }
}
```

**实现位置**: `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-md-parser.js`, `markdown-skill.js`

---

### Pattern: Remote Registry Fetch with Graceful Fallback

**问题**: MCP 社区注册中心需要从远程获取服务器目录，但网络不可用时不能阻塞本地目录。

**解决方案**:

```javascript
async refreshCatalog() {
  this._loadBuiltinCatalog(); // 始终加载本地目录

  if (this.remoteRegistryUrl) {
    try {
      const remoteServers = await this._fetchRemoteCatalog();
      for (const server of remoteServers) {
        if (server.id && server.name) {
          this.catalog.set(server.id, { ...server, source: "remote" });
        }
      }
    } catch (remoteError) {
      logger.warn("Remote fetch failed, using local catalog");
      // 不抛出 — 优雅降级到本地目录
    }
  }
}
```

**实现位置**: `desktop-app-vue/src/main/mcp/community-registry.js:937-990`

---

### Pattern: Interface Extraction for Cross-Module DI (Android)

**问题**: Android `P2PClient` 在 `app` 模块中，`P2PSkillBridge` 在 `feature-ai` 模块中，跨模块直接依赖导致 Hilt/KSP 编译失败。

**解决方案**:

```kotlin
// core-p2p 模块 — 定义接口
interface RemoteSkillProvider {
    suspend fun executeRemoteSkill(skillName: String, params: Map<String, Any>): Result<String>
    suspend fun isDesktopConnected(): Boolean
    suspend fun getAvailableRemoteSkills(): List<String>
}

// app 模块 — P2PClient 实现接口
class P2PClient @Inject constructor(...) : RemoteSkillProvider { ... }

// RemoteModule — Hilt 绑定
@Binds @Singleton
abstract fun bindRemoteSkillProvider(impl: P2PClient): RemoteSkillProvider

// feature-ai 模块 — 依赖接口
class P2PSkillBridge @Inject constructor(
    private val remoteProvider: RemoteSkillProvider // 不依赖 P2PClient
)
```

**实现位置**: `android-app/core-p2p/.../RemoteSkillProvider.kt`, `android-app/app/.../di/RemoteModule.kt`

---

## 通用冲突解决 (Generic Conflict Resolution, v5.0.2.10)

### Pattern: detect → score → rerun 三阶段冲突解决

**问题**: CutClaw 的 ParallelShotOrchestrator 实现了"并行生成 → 检测冲突 → 质量评分 → 重跑输家"的模式，但它与视频剪辑强耦合。当 cowork debate 多方案择优、并行代码生成等场景也需要类似模式时，只能重新实现。

**解决方案** (借鉴 CutClaw 泛化为 SubRuntimePool API):

```javascript
// sub-runtime-pool.js — 纯函数 + 实例方法
// 1. 检测冲突对 (O(n²) 两两比较)
const pairs = detectConflictPairs(results, (a, b) => {
  // conflictDetector: 返回 true 表示 a/b 冲突
  return a.targetFile === b.targetFile;
});

// 2. 用质量分数选出赢家/输家
const { winners, losers } = pickWinnersAndLosers(pairs, (result) => {
  // qualityScorer: 返回 0~1 的质量分
  return result.testsPassed / result.testsTotal;
});

// 3. 带冲突解决的并行执行
const results = await pool.runWithConflictResolution({
  projectRoot, sessionId,
  tasks: [...],
  conflictDetector,  // (a, b) => boolean
  qualityScorer,     // (result) => number
  rerunBuilder,      // (loser, winners) => newTask | null
  maxReruns: 3,      // 防止无限循环
});
// 事件: conflict-resolution:initial-done, round-start, rerun, round-end
```

**关键设计**: 三个回调 (`conflictDetector` / `qualityScorer` / `rerunBuilder`) 完全由调用方注入，SubRuntimePool 不了解业务语义。

**实现位置**: `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js`
**消费方**: video-editing pipeline + `DebateReview.resolveConflictingVerdicts()`
**测试**: `tests/unit/ai-engine/sub-runtime-conflict-resolution.test.js` (17 tests) + `cowork/__tests__/debate-review.test.js`

---

### Pattern: QualityGate 可插拔检查器注册表 (v5.0.2.10)

**问题**: CutClaw 的质量检查（主角占比、美学评分、lint pass）硬编码在视频管线里。其他管线（代码生成、文档生成）也需要质量门控，但检查项完全不同。

**解决方案** (session-core 通用 QualityGate):

```javascript
// packages/session-core/lib/quality-gate.js
const gate = new QualityGate({ threshold: 0.7, aggregate: "weighted-mean" });

// 注册检查器 — 每个检查器是 { name, check(result, ctx), weight?, tags? }
gate.register(createProtagonistChecker({ minRatio: 0.3, weight: 2 }));
gate.register(createDurationChecker({ tolerance: 0.15, weight: 1 }));
gate.register(createThresholdChecker({
  name: "aesthetic", field: "aestheticScore", minValue: 0.6, weight: 1.5
}));

// 执行检查 — 返回 { passed, score, checks[] }
const result = gate.check(pipelineOutput, context, { tags: ["video"] });
// result.passed === true  (score >= threshold)
// result.score === 0.78   (weighted mean of individual checks)
```

**聚合策略**: `WEIGHTED_MEAN` (加权平均) / `MIN` (最低分) / `ALL_PASS` (全部通过)

**实现位置**: `packages/session-core/lib/quality-gate.js`
**测试**: `packages/session-core/__tests__/quality-gate.test.js` (39 tests)

---

### Pattern: LLM 类别路由媒体扩展 (v5.0.2.10)

**问题**: v5.0.2.9 的 Category Routing 有 7 个类别 (quick/deep/reasoning/vision/creative/embedding/audio)，但视频剪辑需要区分 ASR (语音转文字)、音频分析 (beat detection 不需要 LLM)、视频理解 (需要原生视频模态 VLM)。

**解决方案**: 扩展 LLM_CATEGORIES 到 10 个:

```javascript
// llm-manager.js — 新增 3 个媒体类别
LLM_CATEGORIES.ASR            = "asr";            // 语音转文字
LLM_CATEGORIES.AUDIO_ANALYSIS = "audio-analysis";  // 节拍检测/音频特征
LLM_CATEGORIES.VIDEO_VLM      = "video-vlm";       // 视频理解 VLM

// 每个类别有不同的 provider 偏好
CATEGORY_PROVIDER_PRIORITY["asr"]            = ["openai", "gemini", "volcengine", "custom", "ollama"];
CATEGORY_PROVIDER_PRIORITY["audio-analysis"] = ["ollama", "gemini", "openai", "custom"];  // 本地优先
CATEGORY_PROVIDER_PRIORITY["video-vlm"]      = ["gemini", "openai", "anthropic", "volcengine", "custom"];

// inferCategoryFromModelHints 新增映射
// capability: "transcription" → ASR (not AUDIO)
// capability: "beat-detection" / hints.beatDetection → AUDIO_ANALYSIS
// capability: "video-review" / hints.videoVlm → VIDEO_VLM
```

**实现位置**: `desktop-app-vue/src/main/llm/llm-manager.js` (Category Routing 段末尾)
**测试**: `tests/unit/llm/llm-manager-media-categories.test.js` (25 tests)

---

### Pattern: Desktop ApprovalGate 合流 (v5.0.2.10)

**问题**: Phase H 在 Desktop 引入了 `evaluateToolCallWithApprovalGate()`，但 `_executeHostedTool` (CLI 子进程发来的 host-tool-call) 仍然调用同步的 `permissionGate.evaluateToolCall()`，绕过了 ApprovalGate 策略。

**解决方案** (Phase J):

```javascript
// coding-agent-session-service.js
// 修改前 — 同步，无 ApprovalGate
const evaluation = this.permissionGate.evaluateToolCall({ toolName, session, ... });

// 修改后 — 异步，走 ApprovalGate
const evaluation = await this.evaluateToolCall({ toolName, session, sessionId, ... });
// evaluateToolCall() 内部: 懒加载 singleton → gate.decide() → 合并到 Permission Gate 结果
```

同时 `closeSession` 新增 fire-and-forget `_autoConsolidate()` — 将 session events 映射为 TraceStore 事件，通过 MemoryConsolidator 写入 MemoryStore。

**实现位置**: `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js`
**测试**: `__tests__/coding-agent-session-service.test.js` (36 tests, +8 Phase J)

---

## 添加新模式

当发现新的有效模式时，请按以下格式添加：

````markdown
### Pattern: [模式名称]

**问题**: [描述要解决的问题]

**解决方案**:

```[language]
// 代码示例
```
````

**实现位置**: `[文件路径:行号]`
**相关文档**: [链接]

```

---

**维护者**: 开发团队
**更新周期**: 每次重大架构变更后更新
```
