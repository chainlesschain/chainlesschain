# Hermes Agent 对标实施 (6 Phase 全落地)

> **版本: v1.0 | 状态: ✅ 全部完成 | 6 个阶段 | 8 新文件 | ~1400 行代码 | 253 tests**

ChainlessChain CLI Agent 对标 [Hermes Agent](https://github.com/NousResearch/hermes-agent)（Nous Research, 2026-02）系统性补齐 6 项高影响力差距：共享迭代预算、跨会话 FTS 搜索、持久用户画像、零摩擦插件加载、Docker/SSH 执行后端、消息网关。全部向后兼容，纯 CLI 侧（`packages/cli/`）实现。

## 概述

Hermes Agent 是 Nous Research 的自进化个人 AI Agent 框架，核心设计理念为 "Agent That Grows With You"。ChainlessChain 已具备成熟的 Agent 体系（138 技能、4 层记忆、学习闭环、技能合成），但在对标分析中发现 6 项具体差距限制了复杂任务完成能力和用户体验。

**差距分析总表**:

| 维度 | Hermes Agent | ChainlessChain（改造前） | 差距 |
|------|-------------|------------------------|------|
| 迭代预算 | 90 共享，渐进警告 | 15 硬编码，子 Agent 独立 | **高** |
| 跨会话搜索 | FTS5 全会话 + 网关 | 会话已存储但不可搜索 | **高** |
| 用户画像 | USER.md (AI 策展，字符限制) | 无用户画像文件 | **中** |
| 冻结提示词 | 启动时捕获，不可变 | 每轮重新构建 | **中** |
| 插件加载 | 文件拖放 `~/.hermes/plugins/` | 需 DB 注册 | **中** |
| 执行后端 | Local/Docker/SSH/Daytona/Modal | 仅 Local | **中** |
| 消息网关 | Telegram/Discord/Slack 等 | CLI + WS + Web UI | **低-中** |

已达到对等无需改造的维度：技能自动生成、记忆系统、上下文压缩。

## 核心特性

- 🔢 **共享迭代预算**: `IterationBudget` 替换硬编码 `MAX_ITERATIONS=15`，父子 Agent 共享同一实例，70%/90%/100% 三级渐进警告
- 🔍 **跨会话 FTS 搜索**: SQLite FTS5 虚拟表，`/search` REPL 命令 + `search_sessions` Agent 工具，`SessionEnd` 自动索引
- 👤 **USER.md 用户画像**: `~/.chainlesschain/USER.md` 持久化，2000 字符上限 + AI 凝练，自动注入上下文
- 🔌 **零摩擦插件**: 文件拖放 `~/.chainlesschain/plugins/*.js` 自动加载，DB 注册插件优先
- 🐳 **Docker/SSH 后端**: 抽象执行层 + 工厂模式，Local/Docker/SSH 三种后端透明切换
- 📨 **消息网关**: GatewayBase 会话管理 + 限流，Telegram MarkdownV2 + Discord 2000 字符分割

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      agent-repl.js                          │
│    (冻结系统提示词 · /search · /profile · 预算感知)          │
├──────────┬──────────┬───────────┬───────────┬───────────────┤
│ 迭代预算 │ 会话搜索 │  用户画像 │  插件自动 │  执行后端     │
│ Phase 1  │ Phase 2  │  Phase 3  │  发现     │  Phase 5      │
│          │          │           │  Phase 4  │               │
├──────────┴──────────┴───────────┴───────────┴───────────────┤
│                   消息网关基座 (Phase 6)                     │
│           Telegram Formatter · Discord Formatter            │
├─────────────────────────────────────────────────────────────┤
│            agent-core.js · hook-manager.js                  │
│      (IterationWarning / IterationBudgetExhausted 事件)     │
└─────────────────────────────────────────────────────────────┘
```

**依赖关系**:

```
Phase 1 (预算)  ──────────────────────┐
Phase 2 (FTS 搜索)  ────────────┐     │
Phase 3 (USER.md + 冻结提示词)  │     │  ← 独立可并行
Phase 4 (插件)  ── 独立         │     │
                                │     │
Phase 5 (后端) ──── 依赖 Phase 1 (跨后端预算共享)
Phase 6 (网关) ──── 受益于 Phase 2 (会话自动索引)
```

## Phase 1: 共享迭代预算

### 设计

替换 `agent-core.js` 中硬编码的 `MAX_ITERATIONS = 15`，引入共享引用 `IterationBudget` 类。

| 特性 | 说明 |
|------|------|
| 默认预算 | 50 次迭代（原 15 次） |
| 共享引用 | 父 Agent 创建 budget，子 Agent 接收同一实例并消费 |
| 渐进警告 | 70% → `iteration-warning`，90% → `iteration-wrapping-up`，100% → 硬停止 + 工作摘要 |
| 配置 | `CC_ITERATION_BUDGET` 环境变量 或 `config.json` → `agent.iterationBudget` |
| 钩子事件 | `IterationWarning`、`IterationBudgetExhausted` |
| 警告注入 | 警告消息追加到工具结果中，LLM 可见并据此收尾 |

### 使用示例

```bash
# 设置自定义预算
CC_ITERATION_BUDGET=100 chainlesschain agent

# 渐进警告会出现在工具结果中:
# [70%] "⚠️ 迭代预算使用 70%，还剩 30 次，请开始收尾"
# [90%] "⚠️ 迭代预算即将耗尽，还剩 10 次，必须尽快完成"
# [100%] 硬停止 + 自动输出工作摘要
```

```javascript
import { IterationBudget, WarningLevel } from "./lib/iteration-budget.js";

const budget = new IterationBudget(80);
budget.consume();                    // → true (成功消费)
budget.remaining();                  // → 79
budget.percentage();                 // → 0.0125
budget.warningLevel();               // → "none" | "warning" | "wrapping-up" | "exhausted"
budget.isExhausted();                // → false
budget.hasRemaining();               // → true
budget.toSummary();                  // → { limit, consumed, remaining, percentage, warningLevel }
budget.toWarningMessage();           // → 人类可读的警告文本

// 环境变量解析
IterationBudget.resolveLimit();      // → 读取 CC_ITERATION_BUDGET 或返回默认 50
```

## Phase 2: 跨会话 FTS 搜索

### 设计

SQLite FTS5 全文搜索索引，覆盖所有历史会话的消息内容。

| 特性 | 说明 |
|------|------|
| FTS5 虚拟表 | `session_fts` 索引消息内容 |
| 索引触发 | `SessionEnd` 钩子自动索引已完成会话 |
| REPL 命令 | `/search <query>` 带高亮摘要 |
| Agent 工具 | `search_sessions` — LLM 可主动搜索历史上下文 |
| 回填 | `reindexAll()` 为已有会话补建索引 |
| 容错 | FTS5 语法错误自动回退为引号短语搜索 |
| 内容限制 | `MAX_CONTENT_LENGTH = 10000` 每条消息 |

### 使用示例

```bash
# 在 REPL 中搜索历史会话
chainlesschain agent
> /search 认证模块 bug

# 搜索结果示例:
# [sess-abc123] 2026-04-10 — ...修复认证模块的 JWT 验证...
# [sess-def456] 2026-04-08 — ...认证 bug 根因是 token 过期...
```

```javascript
import { SessionSearchIndex } from "./lib/session-search.js";

const index = new SessionSearchIndex(db);
await index.ensureTables();                         // 创建 FTS5 虚拟表
await index.indexSession("session-123");            // 索引单个会话
await index.reindexAll();                           // 回填所有历史会话
const results = await index.search("认证", { limit: 10 });
// → [{ sessionId, content, snippet, timestamp, score }]
const stats = index.getStats();                     // 索引统计
```

## Phase 3: USER.md 用户画像 + 冻结提示词

### 设计

持久用户画像文件和会话级不可变系统提示词。

| 特性 | 说明 |
|------|------|
| 画像路径 | `~/.chainlesschain/USER.md`（全局） |
| 字符上限 | 2000 字符，超限时 AI 自动凝练 |
| 上下文注入 | 插入 `buildOptimizedMessages()` 的 instinct 和 memory 之间 |
| 冻结提示词 | `buildSystemPrompt()` 在会话启动时调用一次，存为不可变快照 |
| REPL 命令 | `/profile show\|set <text>\|clear\|path` |

### 使用示例

```bash
chainlesschain agent
> /profile show           # 显示当前画像内容
> /profile set 我偏好函数式编程和 TypeScript，喜欢简洁的代码风格
> /profile path           # 显示 USER.md 文件路径
> /profile clear          # 清空画像

# USER.md 内容会自动注入到每次对话的上下文中
# 系统提示词在会话开始时冻结，中途不会重建
```

```javascript
import {
  readUserProfile,
  updateUserProfile,
  appendToUserProfile,
  consolidateUserProfile,
  MAX_USER_PROFILE_LENGTH,   // 2000
} from "./lib/user-profile.js";

readUserProfile();                          // → "我偏好函数式编程..."
updateUserProfile("新的画像内容");            // → { written: true, truncated: false, length: 7 }
appendToUserProfile("擅长 Rust");            // → { appended: true, needsConsolidation: false }
await consolidateUserProfile(llmFn);         // → { consolidated: true, oldLength, newLength }
```

## Phase 4: 零摩擦插件自动加载

### 设计

文件拖放插件加载，无需 DB 注册。

| 特性 | 说明 |
|------|------|
| 扫描目录 | `~/.chainlesschain/plugins/*.js` |
| 插件导出 | `{ name, version?, description?, tools?, hooks?, commands? }` |
| 工具注入 | 通过 `getAgentToolDefinitions({ extraTools })` 已有参数 |
| 钩子注册 | 自动注册到 HookManager |
| 命令注册 | 自动添加到 REPL 斜杠命令 |
| 覆盖规则 | DB 注册插件优先覆盖同名文件插件 |
| 验证 | `validatePluginExports()` 收集所有错误 |

### 使用示例

创建 `~/.chainlesschain/plugins/my-plugin.js`:

```javascript
module.exports = {
  name: "my-plugin",
  version: "1.0.0",
  description: "自定义插件示例",

  // 注入工具 — LLM 可调用
  tools: [
    {
      type: "function",
      function: {
        name: "my_custom_tool",
        description: "执行自定义操作",
        parameters: { type: "object", properties: { input: { type: "string" } } }
      }
    }
  ],

  // 注入命令 — 用户可通过 /greet 调用
  commands: {
    greet: {
      handler: (args) => console.log(`Hello, ${args}!`),
      description: "打招呼"
    }
  },

  // 注入钩子 — 自动响应事件
  hooks: {
    SessionStart: (ctx) => console.log("会话开始:", ctx.sessionId)
  }
};
```

重启 Agent，工具和命令即自动可用。

```javascript
import {
  scanPluginDir,
  getAutoDiscoveredPlugins,
  extractPluginTools,
  extractPluginCommands,
  validatePluginExports,
} from "./lib/plugin-autodiscovery.js";

const files = scanPluginDir();                               // 扫描 .js 文件
const { plugins, errors } = await getAutoDiscoveredPlugins(); // 加载并验证
const tools = extractPluginTools(plugins);                    // 提取工具定义
const commands = extractPluginCommands(plugins);              // 提取命令 (Map)

// 验证插件导出
const result = validatePluginExports(mod, "my-plugin.js");
// → { valid: true, errors: [] } 或 { valid: false, errors: ["missing name", ...] }
```

## Phase 5: Docker/SSH 执行后端

### 设计

抽象执行层，支持 Local、Docker、SSH 三种后端。

| 特性 | 说明 |
|------|------|
| 接口 | `ExecutionBackend.execute(command, opts) → { stdout, stderr, exitCode }` |
| LocalBackend | 封装现有 `execSync`，默认 60s 超时，1MB maxBuffer |
| DockerBackend | `docker exec`（容器模式）或 `docker run --rm`（镜像模式），支持自定义 shell、volumes、workdir |
| SSHBackend | `ssh -i <key> <user>@<host>`，支持自定义端口、远程 workdir（via `cd`） |
| 工厂 | `createBackend({ type, options })` 配置驱动创建 |
| 作用范围 (MVP) | 仅 `run_shell` 和 `run_code` 使用后端抽象；文件工具保持本地 |

### 使用示例

```javascript
import { createBackend } from "./lib/execution-backend.js";

// 本地后端 (默认)
const local = createBackend();
const result = local.execute("ls -la");
// → { stdout: "...", stderr: "", exitCode: 0 }

// Docker 容器后端
const docker = createBackend({
  type: "docker",
  options: { container: "my-app", workdir: "/app", shell: "bash" }
});
docker.execute("npm test");

// Docker 镜像后端 (一次性运行)
const dockerRun = createBackend({
  type: "docker",
  options: { image: "node:20", volumes: ["/src:/src"] }
});
dockerRun.execute("node --version");

// SSH 远程后端
const ssh = createBackend({
  type: "ssh",
  options: { host: "prod.io", user: "deploy", key: "~/.ssh/id_rsa", port: 2222, workdir: "/opt/app" }
});
ssh.execute("uptime");
// → { stdout: " 15:30:01 up 42 days...", stderr: "", exitCode: 0 }

// 后端描述
docker.describe();  // → "docker (container: my-app)"
ssh.describe();     // → "ssh (deploy@prod.io:2222)"
```

## Phase 6: 消息平台网关

### 设计

网关基座类和 Telegram/Discord 格式化器。

| 特性 | 说明 |
|------|------|
| GatewayBase | EventEmitter 继承，会话-per-聊天管理，消息映射，限流，响应分片 |
| 限流 | 可配置窗口 + 每聊天最大值，滑动窗口过期机制 |
| Telegram 格式化 | MarkdownV2 转义，标题→粗体，代码块保留，长度截断 |
| Discord 格式化 | 2000 字符限制，换行感知分割，`codeBlock()`、`quoteBlock()` 辅助函数 |
| 会话存储 | 复用 JSONL store，通过 Phase 2 FTS 自动索引 |

### 使用示例

```javascript
import { GatewayBase } from "./gateways/gateway-base.js";

const gw = new GatewayBase({
  platform: "telegram",
  rateLimitMax: 10,           // 每窗口最多 10 条消息
  rateLimitWindow: 60000,     // 60 秒窗口
  maxResponseLength: 4096,
});

await gw.start();
gw.on("started", ({ platform }) => console.log(`${platform} 网关已启动`));

// 会话管理
const session = gw.getOrCreateSession("chat-12345");
gw.addMessage("chat-12345", "user", "你好");
gw.addMessage("chat-12345", "assistant", "你好！有什么可以帮你的？");

// 限流检查
gw.recordMessage("chat-12345");
gw.isRateLimited("chat-12345");  // → false

// 响应分片 (长文本)
const chunks = gw.splitResponse(longText, 4096);  // 按换行优先分割

await gw.stop();
```

```javascript
// Telegram 格式化
import { formatForTelegram, escapeMarkdownV2 } from "./gateways/telegram/telegram-formatter.js";

escapeMarkdownV2("hello_world");           // → "hello\\_world"
formatForTelegram("## 标题\n**粗体**");     // → "*标题*\n*粗体*"
formatForTelegram(longText, { maxLength: 4096 }); // 截断 + "..."

// Discord 格式化
import { formatForDiscord, splitForDiscord, codeBlock, quoteBlock } from "./gateways/discord/discord-formatter.js";

formatForDiscord(longText);                  // 截断到 2000 字符
splitForDiscord(longText);                   // → ["chunk1", "chunk2", ...]
codeBlock("const x = 1;", "js");            // → "```js\nconst x = 1;\n```"
quoteBlock("信息", "第一行\n第二行");         // → "**信息**\n> 第一行\n> 第二行"
```

## 配置参考

所有配置项可写入 `.chainlesschain/config.json` 的 `agent` 字段，或通过环境变量覆盖：

```javascript
{
  "agent": {
    // Phase 1 — 共享迭代预算
    "iterationBudget": 50,          // 每次 agent 会话的最大迭代次数
    "budgetWarningLevels": {
      "warning": 0.7,               // 70% 时发出第一级警告
      "wrappingUp": 0.9             // 90% 时发出第二级警告，提示收尾
    },

    // Phase 2 — FTS 搜索索引
    "sessionSearch": {
      "enabled": true,
      "maxContentLength": 10000,    // 每条消息索引的最大字符数
      "autoIndexOnSessionEnd": true // SessionEnd 钩子自动索引
    },

    // Phase 3 — USER.md 用户画像
    "userProfile": {
      "enabled": true,
      "maxLength": 2000,            // 画像最大字符数（超限触发 AI 凝练）
      "path": "~/.chainlesschain/USER.md"  // 画像文件路径（可自定义）
    },

    // Phase 4 — 插件自动发现
    "plugins": {
      "enabled": true,
      "dir": "~/.chainlesschain/plugins",  // 插件扫描目录
      "dbOverride": true            // DB 注册插件优先覆盖同名文件插件
    },

    // Phase 5 — 执行后端
    "executionBackend": {
      "type": "local",              // "local" | "docker" | "ssh"
      "docker": {
        "container": null,          // 目标容器名（exec 模式）
        "image": null,              // 目标镜像（run 模式，二选一）
        "shell": "sh",              // 容器内使用的 shell
        "workdir": null,            // 容器内工作目录
        "volumes": []               // 卷挂载列表，格式 "host:container"
      },
      "ssh": {
        "host": null,               // 远程主机地址
        "user": "root",             // SSH 登录用户
        "key": "~/.ssh/id_rsa",     // 私钥文件路径
        "port": 22,                 // SSH 端口
        "workdir": null             // 远程工作目录（通过 cd 切换）
      }
    },

    // Phase 6 — 消息网关
    "gateway": {
      "rateLimitMax": 10,           // 每窗口最多消息数（按聊天）
      "rateLimitWindow": 60000,     // 限流窗口（毫秒），默认 60 秒
      "maxResponseLength": 4096     // 单条响应最大字符数
    }
  }
}
```

### 环境变量覆盖

| 环境变量 | 对应配置项 | 说明 |
| --- | --- | --- |
| `CC_ITERATION_BUDGET` | `agent.iterationBudget` | 覆盖最大迭代次数 |
| `CC_EXECUTION_BACKEND` | `agent.executionBackend.type` | 覆盖执行后端类型 |
| `CC_DOCKER_CONTAINER` | `agent.executionBackend.docker.container` | Docker exec 目标容器 |
| `CC_SSH_HOST` | `agent.executionBackend.ssh.host` | SSH 远程主机 |
| `CC_SSH_KEY` | `agent.executionBackend.ssh.key` | SSH 私钥路径 |
| `CC_USER_PROFILE_PATH` | `agent.userProfile.path` | 自定义 USER.md 路径 |
| `CC_PLUGINS_DIR` | `agent.plugins.dir` | 自定义插件扫描目录 |

---

## 故障排查

### 问题: 迭代预算过快耗尽

**症状**: Agent 在预期之前以 "Budget exhausted" 停止

**原因**: 子 Agent 共享父 Agent 的预算。复杂子任务可能消耗大部分预算。

**解决方案**:

1. **增大预算**: `CC_ITERATION_BUDGET=100 chainlesschain agent`
2. **观察警告**: 70% 和 90% 阈值的警告消息提示剩余量
3. **检查消费**: `budget.toSummary()` 查看详细消费明细

### 问题: FTS 搜索无结果

**症状**: `/search <query>` 返回空结果，但历史会话中确实存在匹配内容

**原因**: Phase 2 安装前完成的会话未被索引

**解决方案**:

```javascript
const index = new SessionSearchIndex(db);
await index.reindexAll(); // 回填所有历史会话
```

### 问题: 插件加载失败

**症状**: 插件文件放入 `~/.chainlesschain/plugins/` 后工具/命令不可用

**原因**: 插件导出验证失败（缺少 `name`、`tools` 类型错误等）

**解决方案**:

1. 确保插件导出对象至少包含 `name` 字符串属性
2. `tools` 必须是数组（如存在），`hooks` 和 `commands` 必须是对象（如存在）
3. 检查启动时的警告消息: `getAutoDiscoveredPlugins({ onWarn: console.warn })`

### 问题: Docker 后端报 "neither container nor image specified"

**症状**: `DockerBackend.execute()` 返回 exitCode 1

**原因**: DockerBackend 需要指定 `container`（exec 模式）或 `image`（run 模式）

**解决方案**:

```javascript
// 指定容器（exec 模式）
createBackend({ type: "docker", options: { container: "my-container" } });
// 或指定镜像（run 模式）
createBackend({ type: "docker", options: { image: "node:20" } });
```

### 问题: SSH 后端连接被拒

**症状**: SSHBackend 返回 exitCode 255，stderr 包含 "Connection refused"

**原因**: 目标主机 SSH 服务未启动或端口/密钥配置错误

**解决方案**:

1. 验证 SSH 连通性: `ssh -i <key> <user>@<host> -p <port> "echo ok"`
2. 检查密钥文件路径和权限
3. 确认防火墙允许目标端口

## 安全考虑

1. **SSH 密钥保护**: SSHBackend 接收密钥文件路径但从不记录或暴露密钥内容，密钥仅通过 `-i` 标志传递
2. **Docker 命令转义**: DockerBackend 对命令中的双引号进行转义，防止通过 `docker exec` 的 shell 注入
3. **插件验证**: 文件拖放插件在加载前进行验证，无效导出被拒绝并返回详细错误消息。DB 注册插件始终优先覆盖同名文件插件，防止未授权工具注入
4. **限流防护**: GatewayBase 按聊天实施限流，可配置窗口大小和最大消息数，防止消息平台滥用
5. **USER.md 字符上限**: 2000 字符硬上限防止画像无限增长，AI 凝练使用带明确 "consolidating" 提示的 LLM 函数
6. **FTS 内容限制**: `MAX_CONTENT_LENGTH = 10000` 每条消息，防止索引时内存耗尽
7. **预算硬停止**: 迭代预算在 100% 时强制停止，防止 Agent 无限循环，停止前自动输出工作摘要
8. **冻结提示词不可变性**: 系统提示词在会话启动时构建一次，中途不重建，防止通过中途操纵进行提示词注入

## 性能指标

### 运行时延迟

| 操作 | 指标 | 说明 |
| --- | --- | --- |
| 迭代预算检查 (`consume()`) | <0.1ms | 纯内存操作，无 I/O |
| FTS5 单次搜索 (10k 会话) | <50ms | SQLite FTS5 全文匹配 |
| 会话索引 (SessionEnd) | <20ms | 单会话消息批量写入 FTS 表 |
| 回填索引 (`reindexAll()`) | ~5ms/会话 | 历史会话补建索引 |
| USER.md 读取 | <2ms | 文件系统缓存命中 |
| USER.md AI 凝练 | 取决于 LLM | 仅在超过 2000 字符时触发 |
| 插件扫描加载 (10 插件) | <30ms | 启动时一次性开销 |
| 插件验证 (单个) | <1ms | 纯函数，同步 |
| LocalBackend `execute()` | 取决于命令 | 直接 `execSync` 封装 |
| DockerBackend `execute()` | +5~50ms 启动开销 | exec 模式；run 模式更高 |
| SSHBackend `execute()` | +10~100ms RTT | 取决于网络延迟 |
| GatewayBase 限流检查 | <0.5ms | 滑动窗口内存计算 |
| 响应分片 (`splitResponse`) | <1ms/4KB | 按换行优先分割 |

### 资源消耗

| 组件 | 内存开销 | 说明 |
| --- | --- | --- |
| `IterationBudget` 实例 | ~200B | 轻量计数器 |
| FTS5 索引（10k 消息） | ~2MB SQLite 页 | 取决于消息平均长度 |
| 插件（每个） | ~50KB JS 模块 | 模块缓存复用 |
| GatewayBase 会话 Map | ~1KB/会话 | 消息历史不存内存，存 JSONL |

---

## 关键文件

| 文件 | 阶段 | 说明 |
|------|------|------|
| `src/lib/iteration-budget.js` | Phase 1 | 共享迭代预算类 (176L) |
| `src/lib/session-search.js` | Phase 2 | FTS5 跨会话搜索索引 (192L) |
| `src/lib/user-profile.js` | Phase 3 | USER.md CRUD + AI 凝练 (173L) |
| `src/lib/cli-context-engineering.js` | Phase 3 | USER.md 上下文注入点 (修改) |
| `src/lib/plugin-autodiscovery.js` | Phase 4 | 零摩擦插件扫描+加载 (227L) |
| `src/lib/execution-backend.js` | Phase 5 | Local/Docker/SSH 后端工厂 (242L) |
| `src/gateways/gateway-base.js` | Phase 6 | 网关基座类 (189L) |
| `src/gateways/telegram/telegram-formatter.js` | Phase 6 | Telegram MarkdownV2 格式化 (96L) |
| `src/gateways/discord/discord-formatter.js` | Phase 6 | Discord 格式化 + 分割 (93L) |
| `src/repl/agent-repl.js` | Phase 1-3 | `/search`、`/profile`、预算接入 (修改) |

## 测试覆盖率

### 测试矩阵

| 层级 | 文件 | 测试数 | 覆盖阶段 |
| --- | --- | --- | --- |
| 单元 | `iteration-budget.test.js` | 38 | Phase 1 |
| 单元 | `session-search.test.js` | 32 | Phase 2 |
| 单元 | `user-profile.test.js` | 27 | Phase 3 |
| 单元 | `plugin-autodiscovery.test.js` | 30 | Phase 4 |
| 单元 | `execution-backend.test.js` | 42 | Phase 5 |
| 单元 | `gateway-base.test.js` | 37 | Phase 6 |
| 集成 | `hermes-parity-workflow.test.js` | 25 | Phase 1-4 |
| E2E | `hermes-parity-commands.test.js` | 22 | Phase 1-3 REPL |
| **合计** | **8 文件** | **253** | |

### 关键测试场景

**Phase 1 — 迭代预算**

✅ `consume()` 消耗后 `remaining()` 正确递减

✅ 70% 阈值时 `warningLevel()` 返回 `"warning"`

✅ 90% 阈值时 `warningLevel()` 返回 `"wrapping-up"`

✅ 100% 时 `isExhausted()` 为 `true`，`consume()` 返回 `false`

✅ 子 Agent 共享同一 `IterationBudget` 实例，消费后父 Agent `remaining()` 同步减少

✅ `CC_ITERATION_BUDGET` 环境变量覆盖默认预算

**Phase 2 — FTS 搜索**

✅ `ensureTables()` 幂等，重复调用不报错

✅ `indexSession()` 后 `search()` 能找到消息内容

✅ `reindexAll()` 为已有会话补建索引，不重复索引已有条目

✅ FTS5 语法错误时自动回退为引号短语搜索

✅ 消息超过 `MAX_CONTENT_LENGTH` 时截断后写入

✅ `SessionEnd` 钩子触发自动索引

**Phase 3 — USER.md 用户画像**

✅ `updateUserProfile()` 写入文件，`readUserProfile()` 读取一致

✅ 内容超过 2000 字符时 `appendToUserProfile()` 返回 `needsConsolidation: true`

✅ `consolidateUserProfile(llmFn)` 调用 LLM 并将结果写回文件

✅ 冻结提示词在会话开始后调用 `buildSystemPrompt()` 仅一次

✅ `/profile show|set|clear|path` REPL 命令正确路由

**Phase 4 — 插件自动加载**

✅ `scanPluginDir()` 只返回 `.js` 文件路径

✅ `validatePluginExports()` 检测缺失 `name`、非数组 `tools`、非对象 `hooks`

✅ DB 注册插件同名时覆盖文件插件

✅ 单个插件加载失败不阻断其他插件

**Phase 5 — 执行后端**

✅ `LocalBackend.execute()` 返回 `{ stdout, stderr, exitCode }`

✅ `DockerBackend` container 模式生成 `docker exec` 命令

✅ `DockerBackend` image 模式生成 `docker run --rm` 命令

✅ 两者均未指定时 `execute()` 返回 `exitCode: 1`

✅ `SSHBackend` 生成正确的 `ssh -i -p` 命令字符串

✅ `createBackend()` 工厂按 `type` 返回正确实例

**Phase 6 — 消息网关**

✅ `GatewayBase` 首次 `getOrCreateSession()` 创建新会话

✅ 限流窗口内超出 `rateLimitMax` 时 `isRateLimited()` 返回 `true`

✅ 窗口过期后限流计数器重置

✅ `splitResponse()` 按换行优先分割，每片不超过 `maxLength`

✅ `escapeMarkdownV2()` 正确转义 Telegram 保留字符

✅ `splitForDiscord()` 每片不超过 2000 字符

### 运行测试

```bash
cd packages/cli

# 单元测试（分批运行，避免 OOM）
npx vitest run __tests__/unit/iteration-budget.test.js __tests__/unit/session-search.test.js __tests__/unit/user-profile.test.js
npx vitest run __tests__/unit/plugin-autodiscovery.test.js __tests__/unit/execution-backend.test.js __tests__/unit/gateway-base.test.js

# 集成测试
npx vitest run __tests__/integration/hermes-parity-workflow.test.js

# E2E 测试
npx vitest run __tests__/e2e/hermes-parity-commands.test.js
```

## 相关文档

- **设计文档 (中文)**: [docs/design/modules/85_Hermes_Agent对标实施方案.md](../../design/modules/85_Hermes_Agent对标实施方案.md)
- **英文用户文档**: [docs-site/docs/design/modules/85-hermes-agent-parity.md](../design/modules/85-hermes-agent-parity.md)
- **Hermes Agent 原始参考**: [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- **自主学习闭环**: [autonomous-learning-loop.md](./autonomous-learning-loop.md) — 与 Phase 2 搜索和轨迹存储协同
- **上下文工程**: [context-engineering.md](./context-engineering.md) — Phase 3 USER.md 注入点
- **Hook 系统**: [hooks.md](./hooks.md) — `SessionEnd` 触发 FTS 索引、`IterationWarning` 事件
- **技能系统**: [skills.md](./skills.md) — Phase 4 插件工具与技能系统集成
