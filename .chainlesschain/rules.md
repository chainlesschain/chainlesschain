# ChainlessChain 项目编码规则

> 本文件定义项目特定的编码规则和约束，优先级高于 CLAUDE.md 通用规则
>
> **版本**: v1.1
> **最后更新**: 2026-01-16
> **变更**: 更新已实现功能状态（TokenTracker、Husky、LLM 性能仪表板）

---

## 数据库操作规则

### 强制要求

1. **必须使用事务**: 所有写操作必须包裹在 `transaction()` 中
2. **禁止字符串拼接 SQL**: 使用参数化查询防止注入
3. **必须处理 SQLITE_BUSY**: 使用 ErrorMonitor 自动重试
4. **加密要求**: 敏感数据必须使用 SQLCipher 加密存储

### 示例代码

```javascript
// ✅ 正确
await db.transaction(async () => {
  await db.run("INSERT INTO notes (title, content) VALUES (?, ?)", [
    title,
    content,
  ]);
});

// ❌ 错误 - 字符串拼接SQL
db.run(`INSERT INTO notes (title, content) VALUES ('${title}', '${content}')`);

// ❌ 错误 - 未使用事务
db.run("INSERT INTO notes (title, content) VALUES (?, ?)", [title, content]);
```

---

## LLM 调用规则

### 强制要求

1. **优先使用本地模型**: Ollama 可处理的任务不调用云端 API
2. **必须追踪 Token**: 每次调用后更新 TokenTracker（已集成 `src/main/llm/token-tracker.js`）
3. **实现超时和重试**: 默认 30s 超时，失败重试 3 次
4. **成本控制**: 遵循月度预算限制（默认 $50/月）

### 模型选择策略

```javascript
// 简单任务 → 使用 Ollama (免费)
if (taskComplexity === "simple") {
  provider = "ollama";
  model = "qwen2:7b";
}

// 复杂推理 → 使用云端高性能模型
if (taskComplexity === "complex") {
  provider = "volcengine"; // 或 openai, zhipu
  model = "doubao-seed-1.6-pro";
}
```

---

## P2P 消息规则

### 强制要求

1. **强制 E2E 加密**: 所有 P2P 消息必须使用 Signal Protocol
2. **离线消息队列**: 发送失败的消息加入 `offline_queue` 表
3. **设备同步**: 多设备场景必须调用 DeviceSyncManager
4. **身份验证**: 消息发送前必须验证 DID 身份

### 示例代码

```javascript
// ✅ 正确
const encryptedMessage = await signalProtocol.encrypt(message, recipientDID);
await p2pManager.sendMessage(recipientDID, encryptedMessage);

// ❌ 错误 - 未加密
await p2pManager.sendMessage(recipientDID, message);
```

---

## 插件开发规则

### 强制要求

1. **沙箱隔离**: 所有插件必须在 PluginSandbox 中执行
2. **权限最小化**: manifest.json 只声明必需权限
3. **错误边界**: 插件错误不能影响主应用
4. **安全审计**: 插件市场上架前必须通过安全扫描

### manifest.json 示例

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "permissions": ["database:read", "filesystem:read"],
  "sandbox": true
}
```

---

## 性能规则

### 强制要求

1. **查询优化**: 数据库查询必须使用索引（通过 EXPLAIN QUERY PLAN 验证）
2. **缓存策略**: 频繁访问的数据使用 QueryCache（TTL 60s）
3. **懒加载**: Vue 组件超过 100KB 必须使用 `defineAsyncComponent`
4. **图片优化**: 上传图片必须压缩和生成缩略图

### 性能指标要求

根据 `desktop-app-vue/config/performance.config.js`:

- 意图识别延迟: P95 < 1500ms
- 知识检索延迟: P95 < 2000ms
- 响应生成延迟: P95 < 4000ms
- 总响应时间: P95 < 8000ms

---

## 测试要求

### 覆盖率要求

1. **核心模块覆盖率**: DatabaseManager, LLMManager, P2PManager 必须 ≥ 80%
2. **E2E 测试**: 新增页面必须有 Playwright 测试
3. **性能测试**: AI 引擎管道必须符合性能阈值
4. **安全测试**: 定期运行安全扫描（SQL注入、XSS等）

### 测试命令

```bash
# 单元测试
npm run test:db      # 数据库测试
npm run test:ukey    # U-Key集成测试
vitest run           # 所有单元测试

# E2E测试
npx playwright test

# 性能测试
npm run test:performance
```

---

## Git 提交规范

### Conventional Commits

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Type 类型

- `feat(module)`: 新功能
- `fix(module)`: Bug 修复
- `perf(module)`: 性能优化
- `test(module)`: 测试相关
- `docs`: 文档更新
- `refactor(module)`: 重构（不改变功能）
- `style`: 代码格式化
- `chore`: 构建/工具链更新

### Scope 模块

**必须指定模块**: rag, llm, p2p, database, plugin, ui, trade, did, git, etc.

### 示例

```bash
feat(rag): 添加重排序器支持
fix(ukey): 修复Windows驱动兼容性问题
perf(database): 优化查询索引，提升检索速度30%
docs(api): 更新RAG API文档
test(p2p): 添加E2E加密单元测试
```

---

## 安全规则

### 禁止项

1. ❌ **硬编码密钥**: API Key、密码等必须使用环境变量
2. ❌ **eval() 使用**: 禁止使用 `eval()` 和 `Function()` 构造函数
3. ❌ **innerHTML 直接赋值**: 使用 `textContent` 或 Vue 模板
4. ❌ **敏感数据日志**: 禁止记录 API Key、密码、私钥

### 示例

```javascript
// ✅ 正确
const apiKey = process.env.OPENAI_API_KEY;

// ❌ 错误
const apiKey = "sk-1234567890abcdef";
```

---

## U-Key 集成规则

### 平台支持

- **Windows**: 完整硬件支持（Koffi FFI + SIMKey SDK）
- **macOS/Linux**: 仅支持模拟模式

### 强制要求

1. **PIN 验证**: 所有 U-Key 操作必须先验证 PIN
2. **错误处理**: 处理 U-Key 未插入、PIN 错误等异常
3. **模拟模式**: 开发环境默认使用模拟模式

---

## 代码质量门禁

### Pre-commit Hooks (已实现)

在提交代码前自动运行以下检查（Husky v9.1.7 + lint-staged v16.2.7）:

1. ✅ **ESLint**: 代码风格和潜在错误
2. ✅ **TypeScript**: 类型检查（如适用）
3. ✅ **规则验证**: 自定义安全规则检查（`npm run validate:rules`）
4. ✅ **安全扫描**: SQL 注入、XSS 等漏洞检测

### 当前配置

**`.husky/pre-commit`**:

```bash
#!/usr/bin/env sh
npx lint-staged
cd desktop-app-vue && npm run validate:rules
```

**`package.json` (lint-staged)**:

```json
{
  "lint-staged": {
    "*.{js,vue}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

### 相关命令

```bash
npm run validate:rules    # 运行规则验证器
npm run security:check    # 完整安全检查（规则 + npm audit）
npm run fix:sql           # 自动修复 SQL 注入问题
```

---

## Token 优化指引

### 成本目标

- **开发环境**: < $5/周
- **生产环境**: < $50/月

### 优化策略

1. **优先本地模型**: 简单任务使用 Ollama（免费）
2. **上下文压缩**: 对话历史超过 10 条消息时自动总结（PromptCompressor 已实现）
3. **结果缓存**: 重复查询使用缓存（ResponseCache，TTL 1 小时）
4. **批量处理**: 相似任务合并到一次调用
5. **成本监控**: 实时查看 Token 使用（LLM 性能仪表板 `#/llm/performance`）

### 已实现的优化模块

| 模块             | 文件位置                                    | 功能                          |
| ---------------- | ------------------------------------------- | ----------------------------- |
| TokenTracker     | `src/main/llm/token-tracker.js`             | 实时 Token 追踪和成本计算     |
| PromptCompressor | `src/main/llm/prompt-compressor.js`         | 智能上下文压缩（节省 30-40%） |
| SessionManager   | `src/main/llm/session-manager.js`           | 会话管理和历史压缩            |
| ResponseCache    | `src/main/llm/response-cache.js`            | LLM 响应缓存                  |
| 性能仪表板       | `src/renderer/pages/LLMPerformancePage.vue` | 可视化成本分析                |

---

## 配置管理规则

### 统一配置目录

使用 `.chainlesschain/` 目录管理所有配置:

```
.chainlesschain/
├── config.json              # 核心配置
├── rules.md                 # 本文件
├── memory/                  # 会话数据
├── logs/                    # 日志文件
├── cache/                   # 缓存数据
└── checkpoints/             # 检查点和备份
```

### 配置优先级

1. **环境变量** (最高优先级)
2. **`.chainlesschain/config.json`**
3. **默认配置** (代码中定义)

---

## 异常情况处理

### 数据库锁定 (SQLITE_BUSY)

```javascript
// 自动重试策略
const retryOptions = {
  maxRetries: 3,
  retryDelay: 100,
  backoff: "exponential",
};
```

### 网络错误

```javascript
// LLM API 调用超时和重试
const timeout = 30000; // 30s
const maxRetries = 3;
```

### U-Key 错误

```javascript
// 处理 U-Key 未插入、PIN 错误等
if (error.code === "UKEY_NOT_FOUND") {
  // 提示用户插入 U-Key
} else if (error.code === "PIN_ERROR") {
  // 提示 PIN 错误，剩余次数
}
```

---

## 文档要求

### 代码注释

1. **JSDoc**: 所有公共 API 必须有 JSDoc 注释
2. **复杂逻辑**: 添加行内注释解释"为什么"而非"是什么"
3. **TODO**: 使用 `// TODO:` 标记待办事项

### README 更新

当添加新功能时，必须更新相关 README:

- `README.md` (中文)
- `README_EN.md` (英文)
- `CLAUDE.md` (AI辅助开发指南)

---

## 依赖管理

### 版本锁定

1. **生产依赖**: 使用精确版本 (`"^"` 或 `"~"` 仅用于小版本)
2. **关键依赖**: Electron, Vue, SQLite 版本锁定
3. **安全更新**: 定期运行 `npm audit` 检查漏洞

### 已知兼容性问题

- **MyBatis Plus**: 已升级到 3.5.9，兼容 Spring Boot 3.x ✅
- **Ollama httpx**: 必须 < 0.26.0

---

## 参考资料

- **系统设计**: `docs/design/系统设计_个人移动AI管理系统.md`
- **实施状态**: `IMPLEMENTATION_COMPLETE.md`
- **快速开始**: `QUICK_START.md`, `HOW_TO_RUN.md`
- **贡献指南**: `docs/development/CONTRIBUTING.md`
- **优化计划**: `docs/development/OPTIMIZATION_PLAN_FROM_OPENCLAUDE.md`

---

**最后更新**: 2026-01-16 (v1.1)
**维护者**: 开发团队
**审核周期**: 每月更新

---

## 更新日志

### v1.1 (2026-01-16)

- 更新 TokenTracker 状态为已实现
- 更新 Pre-commit Hooks 为已实现（Husky v9.1.7 + lint-staged v16.2.7）
- 更新 Token 优化指引，添加已实现模块表格
- 添加规则验证器和安全检查命令说明
