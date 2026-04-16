# Managed Agents 对标

> 版本: v2.0 | 日期: 2026-04-16 | 状态: `session-core` Phase A–J + J+ 全部落地，CLI 已接入 `memory recall/store`、`session policy`、`config beta`、`session tail/usage/lifecycle/park/unpark/end`，Desktop 已收口（21 IPC channels + Pinia store + SessionCorePage Usage tab + 38 session-service tests + Round 4 regression guard）。

## 概述

ChainlessChain 这轮对标的是 Anthropic Claude Managed Agents 的托管式 Agent 运行时语义，但实现策略不是复制云托管，而是把可复用的 session runtime 抽到共享包 `@chainlesschain/session-core`，再逐步接入 CLI 与 Desktop。

当前已完成：

- `SessionHandle` / `SessionManager` / `IdleParker`
- `TraceStore`
- `AgentGroup` / `SharedTaskList`
- `MemoryStore` / `MemoryConsolidator`
- `ApprovalGate`
- `BetaFlags`
- `StreamRouter`
- `file-adapters`

## 核心特性

- 🧠 **Scoped Memory** — `MemoryStore` 支持 `global / session / user / agent` 四种作用域，向量相似度 + 标签双索引，跨进程 JSON 持久化
- 🔐 **ApprovalGate** — 每个 session 独立的审批策略（`strict / trusted / autopilot`），持久化到 `approval-policies.json`，CLI 与 Desktop 共享同一份文件
- 🚦 **StreamRouter** — 统一 `StreamEvent` 协议（`NDJSON`），所有 LLM/Tool/Session 事件经由单一管道分发，支持 `collect()` 聚合文本输出
- 📦 **SessionHandle** — 轻量级 session 句柄，封装 `sessionId`、创建时间、状态机（`active / idle / parked / closed`）和 trace 文件路径
- 🗂️ **TraceStore** — 追加写入 JSONL 事件文件，支持按类型过滤、字节偏移 tail、用量 rollup（按 model 分组）
- 👥 **AgentGroup** — 多 agent 协同容器，`SharedTaskList` 实现任务分配与状态同步
- 🏷️ **BetaFlags** — 格式化 flag（`<feature>-YYYY-MM-DD`），CLI/Desktop/WS 三端共享开关，TTL 校验防过期 flag 误用
- 💾 **MemoryConsolidator** — 从 JSONL session trace 中提取 assistant 消息，批量写入 MemoryStore，支持 `--dry-run` 预览
- 🔌 **File Adapters** — 跨进程安全读写 `~/.chainlesschain/` 下所有持久化文件，原子写（先写 `.tmp` 再 rename）

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    @chainlesschain/session-core                  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ SessionHandle│  │  TraceStore  │  │     MemoryStore       │  │
│  │  (状态机)    │  │  (JSONL事件) │  │  (4-scope + 标签)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                       │              │
│  ┌──────▼───────────────────────────────────────▼───────────┐  │
│  │                    SessionManager                          │  │
│  │         (IdleParker · park/unpark · lifecycle events)      │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────┐  ┌────────▼──────────┐  ┌────────────────┐  │
│  │  ApprovalGate │  │   StreamRouter    │  │   BetaFlags    │  │
│  │ (strict/      │  │  (StreamEvent     │  │ (<feat>-date)  │  │
│  │  trusted/     │  │   NDJSON 协议)    │  │               │  │
│  │  autopilot)   │  └───────────────────┘  └────────────────┘  │
│  └───────────────┘                                              │
│                                                                  │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │     AgentGroup       │  │       MemoryConsolidator          │ │
│  │  SharedTaskList      │  │  (trace → MemoryStore 批量写入)   │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    file-adapters                          │   │
│  │   approval-policies.json · memory-store.json ·            │   │
│  │   beta-flags.json · parked-sessions.json                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │                              │
┌────────┴────────┐          ┌──────────┴──────────┐
│   packages/cli  │          │  desktop-app-vue     │
│  (64 commands)  │          │  (Electron main)     │
│  cc agent/serve │          │  IPC 18 channels     │
│  cc memory/session         │  coding-agent-session│
│  cc stream      │          │  -service.js         │
└─────────────────┘          └─────────────────────┘
         ▲
         │  WebSocket (port 18800)
┌────────┴────────┐
│  cc serve       │
│  14 WS routes   │
│  sessions.*     │
│  memory.*       │
│  beta.*         │
│  stream.run     │
└─────────────────┘
```

## 配置参考

### session-core 初始化选项

```js
// packages/session-core/lib/index.js
const { createSessionCore } = require('@chainlesschain/session-core');

const core = createSessionCore({
  // 持久化根目录，默认 ~/.chainlesschain/
  dataDir: '/custom/path/.chainlesschain',

  // IdleParker 参数
  idleTimeoutMs: 300_000,      // 5 分钟无活动后标记 idle
  parkOnIdle: true,            // idle 后自动 park

  // MemoryStore 检索参数
  memory: {
    defaultLimit: 10,          // recall 默认返回条数
    similarityThreshold: 0.6,  // 向量相似度阈值（0~1）
    maxEntriesPerScope: 1000,  // 单 scope 最大条目数
  },

  // ApprovalGate 默认策略
  approval: {
    defaultPolicy: 'strict',   // 'strict' | 'trusted' | 'autopilot'
  },

  // BetaFlags TTL 校验
  betaFlags: {
    allowExpired: false,       // true = 过期 flag 仍生效（测试用）
  },
});
```

### CLI 环境变量

```bash
# 覆盖持久化目录（多用户或 CI 场景）
CHAINLESSCHAIN_DATA_DIR=/tmp/cc-test/.chainlesschain

# 强制 ApprovalGate 策略（CI 自动化）
CHAINLESSCHAIN_APPROVAL_POLICY=autopilot

# 关闭 IdleParker（长跑 agent 场景）
CHAINLESSCHAIN_DISABLE_IDLE_PARK=1

# WebSocket 服务端口（默认 18800）
CHAINLESSCHAIN_WS_PORT=18800

# WebSocket 鉴权 token
CHAINLESSCHAIN_WS_TOKEN=your-secret-token
```

### Desktop 端配置（`.chainlesschain/config.json`）

```json
{
  "sessionCore": {
    "idleTimeoutMs": 600000,
    "parkOnIdle": true,
    "approval": {
      "defaultPolicy": "trusted"
    },
    "memory": {
      "defaultLimit": 5,
      "similarityThreshold": 0.65
    }
  }
}
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| `SessionHandle` 创建 | < 1 ms | ~0.3 ms | ✅ |
| `TraceStore` 追加写入（单事件） | < 2 ms | ~0.8 ms | ✅ |
| `TraceStore` tail 读取（最后 100 行） | < 10 ms | ~4 ms | ✅ |
| `MemoryStore` store（单条） | < 5 ms | ~2 ms | ✅ |
| `MemoryStore` recall（全量扫描，1000 条） | < 50 ms | ~18 ms | ✅ |
| `ApprovalGate` decide（缓存命中） | < 1 ms | ~0.2 ms | ✅ |
| `ApprovalGate` decide（文件读取） | < 10 ms | ~5 ms | ✅ |
| `BetaFlags` isEnabled | < 1 ms | ~0.1 ms | ✅ |
| `StreamRouter` 单事件分发 | < 1 ms | ~0.4 ms | ✅ |
| `MemoryConsolidator` 批量（50 条 trace） | < 200 ms | ~85 ms | ✅ |
| `SessionManager` park/unpark | < 20 ms | ~9 ms | ✅ |
| file-adapter 原子写入 | < 15 ms | ~6 ms | ✅ |
| WS 路由响应（sessions.list） | < 30 ms | ~12 ms | ✅ |
| WS 路由响应（memory.recall） | < 60 ms | ~28 ms | ✅ |

## 测试覆盖率

**总计: 450+ 测试，全部通过**

### session-core 单元测试

- ✅ `session-handle.test.js` — 状态机转换、sessionId 生成、序列化 (22 tests)
- ✅ `trace-store.test.js` — 追加写入、tail、usage rollup、文件轮转 (31 tests)
- ✅ `memory-store.test.js` — 4-scope CRUD、标签过滤、recall 相似度排序 (38 tests)
- ✅ `memory-consolidator.test.js` — trace→memory 提取、dry-run、agentId 过滤 (19 tests)
- ✅ `approval-gate.test.js` — strict/trusted/autopilot 语义、持久化、并发安全 (24 tests)
- ✅ `beta-flags.test.js` — flag 格式校验、TTL 检查、enable/disable/list (18 tests)
- ✅ `stream-router.test.js` — StreamEvent 协议、collect()、abort、背压 (29 tests)
- ✅ `session-manager.test.js` — lifecycle events、park/unpark、IdleParker 触发 (33 tests)
- ✅ `agent-group.test.js` — 多 agent 注册、SharedTaskList 分配与状态同步 (26 tests)
- ✅ `file-adapters.test.js` — 原子写入、并发、损坏文件降级 (21 tests)
- ✅ `quality-gate.test.js` — weighted-mean/min/all-pass 聚合策略 (39 tests)
- ✅ `agent-bundle-schema.test.js` — bundle 字段校验、必填项、嵌套结构 (17 tests)
- ✅ `agent-bundle-loader.test.js` — AGENTS.md 解析、MCP wiring、USER.md seed (22 tests)
- ✅ `agent-bundle-resolver.test.js` — bundle 路径解析、相对/绝对路径、缺失文件容错 (14 tests)

### CLI 集成与 E2E 测试

- ✅ `session-core-singletons.test.js` — 单例懒加载、dataDir 覆盖 (4 tests)
- ✅ `managed-agents-cli.integration.test.js` — memory/session/beta 命令实际写文件 (3 tests)
- ✅ `managed-agents-commands.test.js` — 完整 CLI E2E 流程 (6 tests)
- ✅ `cli-context-engineering.test.js` — recall 注入 agent 提示词 (55 tests)
- ✅ `command-registration.test.js` — 所有命令注册无冲突 (26 tests)

### Desktop 端测试

- ✅ `coding-agent-session-service.test.js` — Phase J ApprovalGate 合流、auto-consolidate、Phase J+ 升级提示与降级二次确认 (+10 tests，共 38 tests)
- ✅ `coding-agent-permission-gate.test.js` — Permission Gate ↔ ApprovalGate 双层合流（capability + Plan Mode + per-session policy）
- ✅ `coding-agent-tool-adapter.test.js` — 8 个 mvp 核心工具（含 Hashline `edit_file_hashed`）+ MCP/Managed 工具白名单 (8 tests)
- ✅ `agent-sandbox-v2.test.js` — Phase 4 bundle-aware lifecycle 持久化与还原 (41 tests)
- ✅ `coding-agent.store.test.ts` (renderer) — Phase J+ 升级提示 + Round 4 regression guard（事件类型碰撞防御）(30 tests)

> **架构 ADR**: Permission Gate 与 ApprovalGate 共存（capability vs policy 两层正交），不会被合并。详见 [`91_Managed_Agents对标计划`](../design/modules/91-managed-agents-parity.md) 第四节末 ADR。

## 安全考虑

### 1. 持久化文件权限

`file-adapters` 在 Linux/macOS 上以 `0600` 权限创建 `~/.chainlesschain/*.json`，防止同机其他用户读取内存和策略数据。Windows 上依赖用户配置文件目录的 ACL 隔离。

### 2. ApprovalGate 防降级

从 `strict` 改为 `autopilot` 的操作在 Desktop 端会触发二次确认对话框（IPC `session:policy-change-confirm`）。CLI 端则需要显式 `--set autopilot` flag，不支持通过配置文件静默降级。

### 3. BetaFlags 日期 TTL

所有 beta flag 必须包含形如 `YYYY-MM-DD` 的过期日期后缀。过期 flag 在 `isEnabled()` 时返回 `false` 并触发 `warn` 日志，防止实验性功能在生产环境中永久残留。默认不允许绕过（`allowExpired: false`）。

### 4. TraceStore 敏感数据

session trace JSONL 文件默认存储在 `~/.chainlesschain/sessions/<sessionId>.jsonl`，其中可能包含用户输入的敏感内容。建议在生产环境启用 Desktop 的 SQLCipher 全库加密，并在 CI 环境将 `CHAINLESSCHAIN_DATA_DIR` 指向临时目录。

### 5. WebSocket 鉴权

`cc serve` 启动的 WebSocket 服务器在收到第一条消息前强制校验 `Authorization: Bearer <token>` 头。未提供 `--token` 时仅监听 `127.0.0.1`（不对外暴露）。生产部署应始终传入强随机 token 并配合 TLS 终止代理。

### 6. MemoryConsolidator 权限隔离

`memory consolidate --session <id>` 只能读取属于当前 CLI 用户 dataDir 下的 trace 文件，不能跨用户合并。Desktop 端通过 `coding-agent-session-service.js` 的 `_autoConsolidate()` 在 `closeSession` 时自动触发，scope 强制绑定当前 sessionId。

## 故障排查

**Q: `memory recall` 返回空结果，但之前明明 store 过内容**

A: 检查 `--scope` 参数是否一致。store 时用了 `--scope session --scope-id sess_xxx`，recall 时必须传相同的 scope 和 scope-id，否则走 global scope 查找会找不到。可先用 `--scope global` 无条件 recall 验证数据是否实际写入。

---

**Q: `session policy <id> --set autopilot` 报错 `session not found`**

A: policy 文件按 sessionId 索引，session 必须先通过 `cc agent --session <id>` 或 `cc session lifecycle` 确认存在。若 session 已过期被清理，需重新创建。也可直接编辑 `~/.chainlesschain/approval-policies.json` 手动写入。

---

**Q: `config beta enable` 执行成功但 feature 没有生效**

A: Beta flag 仅控制"功能开关"，需要对应功能的代码实际读取该 flag。检查 flag 名称格式是否为 `<feature>-YYYY-MM-DD`（中划线分隔，日期在最后）。可通过 `config beta list --json` 确认 flag 已写入且 `expired: false`。

---

**Q: `cc serve` 的 WebSocket 客户端连接后立即断开**

A: 最常见原因是未传 token 或 token 错误。服务端在握手后第一条消息校验 `Authorization`，校验失败直接关闭连接并写 warn 日志。可在服务端加 `--debug` 查看详细日志，或临时不带 `--token` 启动（仅本地 127.0.0.1 可连）。

---

**Q: `MemoryConsolidator` 跑完没有任何条目写入 MemoryStore**

A: consolidate 只提取 trace 中 `type === "assistant_message"` 且 `content` 非空的事件。若 session 的 trace 文件只有 `tool_call` / `tool_result` 事件（纯工具调用 session），则不会产生记忆条目。用 `session tail <id>` 先检查 trace 内容。

---

**Q: Desktop 与 CLI 的 `approval-policies.json` 不同步**

A: 两端都使用 file-adapter 原子写入同一文件路径，正常情况下自动共享。若出现不同步，检查 Desktop 的 `userData` 路径与 CLI 的 `CHAINLESSCHAIN_DATA_DIR` 是否指向同一目录。Windows 下 Desktop 默认路径为 `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/`。

## 关键文件

- `packages/session-core/`
- `packages/cli/src/lib/session-core-singletons.js`
- `packages/cli/src/commands/session.js`
- `packages/cli/src/commands/memory.js`
- `packages/cli/src/commands/config.js`
- `docs/design/modules/91_Managed_Agents对标计划.md`

## 使用示例

### CLI — 基础 Memory 存储与检索

```bash
# 存储偏好到 global scope
chainlesschain memory store "偏好 TypeScript，不喜欢 any 类型" \
  --scope global --category preference

# 存储会话级上下文
chainlesschain memory store "用户正在调试 P2P 连接问题" \
  --scope session --scope-id sess_abc123 --tags p2p,debug

# 检索相关记忆
chainlesschain memory recall "TypeScript 偏好" --scope global --json

# 跨 agent 检索
chainlesschain memory recall "p2p" --tags p2p --limit 5 --json
```

### CLI — Session 审批策略管理

```bash
# 查看当前策略
chainlesschain session policy sess_abc123

# 升级为 autopilot（CI 自动化场景）
chainlesschain session policy sess_abc123 --set autopilot

# JSON 输出（供脚本消费）
chainlesschain session policy sess_abc123 --json
```

### CLI — Session 生命周期

```bash
# 列出所有 session（含已 park 的）
chainlesschain session lifecycle --json

# park 一个 session（保存状态，释放资源）
chainlesschain session park sess_abc123

# 恢复 parked session
chainlesschain session unpark sess_abc123

# 关闭并合并记忆
chainlesschain session end sess_abc123 --consolidate

# 启动 agent 时自动 unpark
chainlesschain agent --session sess_abc123
```

### CLI — StreamRouter NDJSON 输出

```bash
# 流式输出所有事件
chainlesschain stream "总结一下项目结构"

# 只收集最终文本
chainlesschain stream "列出所有 CLI 命令" --text

# 指定 provider 和 model
chainlesschain stream "代码审查" --provider anthropic --model claude-sonnet-4-6
```

### CLI — Beta Flags

```bash
# 列出所有 flag（含过期状态）
chainlesschain config beta list --json

# 启用实验性功能
chainlesschain config beta enable idle-park-2026-05-01

# 禁用
chainlesschain config beta disable idle-park-2026-05-01
```

### Node.js — session-core API

```js
const {
  SessionHandle,
  TraceStore,
  MemoryStore,
  ApprovalGate,
  StreamRouter,
} = require('@chainlesschain/session-core');

// 创建 session
const session = new SessionHandle({ agentId: 'coder' });
console.log(session.sessionId); // sess_xxxxxxxx

// 追踪事件
const trace = new TraceStore(session.sessionId, { dataDir: '~/.chainlesschain' });
await trace.append({ type: 'assistant_message', content: 'Hello' });

// 存储记忆
const memory = new MemoryStore({ dataDir: '~/.chainlesschain' });
await memory.store({
  content: '用户偏好 TypeScript',
  scope: 'global',
  category: 'preference',
});
const results = await memory.recall({ query: 'TypeScript', scope: 'global', limit: 5 });

// 审批策略检查
const gate = new ApprovalGate({ dataDir: '~/.chainlesschain' });
const decision = await gate.decide(session.sessionId, {
  toolName: 'run_shell',
  riskLevel: 'high',
});
// decision.approved === false (strict 模式下高风险工具需要人工审批)

// 流式输出
const router = new StreamRouter();
router.on('event', (evt) => process.stdout.write(JSON.stringify(evt) + '\n'));
const text = await router.collect(asyncLLMStream);
```

### WebSocket — cc serve API

```js
const ws = new WebSocket('ws://localhost:18800');

// 鉴权握手
ws.send(JSON.stringify({
  type: 'auth',
  token: process.env.CC_WS_TOKEN,
}));

// 存储记忆
ws.send(JSON.stringify({
  id: 'req-1',
  type: 'memory.store',
  content: '偏好 TypeScript',
  scope: 'global',
  category: 'preference',
}));

// 检索记忆
ws.send(JSON.stringify({
  id: 'req-2',
  type: 'memory.recall',
  query: 'TypeScript',
  scope: 'global',
  limit: 5,
}));

// 接收响应
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  // msg.type === 'memory.recall.response'
  // msg.ok === true
  // msg.results === [{ id, content, scope, score, ... }]
});
```

## 相关文档

- [会话管理](./cli-session)
- [持久记忆](./cli-memory)
- [配置管理](./cli-config)
- [设计文档 91](../design/modules/91-managed-agents-parity)
- [Hermes Agent 对标](./hermes-agent-parity)
