# ChainlessChain 架构模式库

> 记录项目中已验证的架构模式和解决方案，供 AI 助手和开发者参考
>
> **版本**: v1.0.0
> **最后更新**: 2026-01-16

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
