# Managed Agents Parity — CLI 命令

> 版本: v1.9 | 日期: 2026-04-16 | 状态: CLI 已接入 `memory recall/store`、`session policy`、`config beta`，并完成跨进程持久化。

这是一页命令侧文档，聚焦当前已经可直接在 CLI 中使用的 Managed Agents 对标能力。总体设计、Phase A-F 进度和 Desktop 收口计划见 [Managed Agents 对标总览](./managed-agents-parity)。

## 概述

Managed Agents CLI 是 `@chainlesschain/session-core` 在命令行侧的完整接入层，覆盖 Agent 会话生命周期的全链路：从记忆的写入与召回，到会话的暂停与恢复，再到实验特性的开关管理与流式输出。

所有数据持久化在本地 `~/.chainlesschain/` 目录，与 Desktop 端共用相同的 JSON 文件，实现 CLI ↔ Desktop 双端状态同步。CLI 命令是无头（headless）的——不依赖图形界面，适合脚本自动化、CI/CD 流程以及远程 Agent 调度。

核心命令分组：

| 命令组 | 能力 | Phase |
|--------|------|-------|
| `memory store/recall/consolidate` | 四级作用域记忆写入与检索 | Phase D |
| `session policy` | 会话级审批策略 | Phase E |
| `config beta` | 日期制实验特性开关 | Phase E |
| `session lifecycle` / `park` / `unpark` / `end` | 会话生命周期管理 | Phase H |
| `stream` | 统一流式输出（NDJSON） | Phase F |
| `session tail` / `session usage` | 会话事件追踪与 token 用量 | Phase I |

## 核心特性

- 🧠 **四级作用域记忆** — `global / session / agent / user` 四种隔离粒度，支持 query 关键字匹配 + tag 过滤 + 相关性评分召回
- 🔁 **记忆自动沉淀** — `memory consolidate` 将会话 JSONL 事件流提取为结构化记忆条目，去重并写入 MemoryStore
- 🛡️ **会话级审批策略** — `strict / trusted / autopilot` 三档策略，持久化到 `approval-policies.json`，跨重启保留
- 🚩 **日期制 Feature Flag** — `<feature>-YYYY-MM-DD` 格式，到期自动过期，零副作用实验开关
- 🏊 **会话生命周期管理** — park（序列化暂停）/ unpark（恢复）/ end（关闭+沉淀）完整状态机
- 🌊 **统一流式输出** — `stream` 命令输出标准 NDJSON StreamEvent，兼容管道和脚本消费
- 📡 **实时事件尾随** — `session tail` 跟踪会话 JSONL 文件变更，支持按事件类型过滤与时间戳偏移
- 📊 **Token 用量统计** — `session usage` 提供 per-session 和全局 token 滚动汇总，支持按模型分组
- 🔗 **CLI ↔ Desktop 双端共享** — 所有持久化文件路径统一，Desktop 通过 IPC 读写同一套数据
- 🧪 **完整测试覆盖** — session-core 452 测试 + CLI 单元/集成/E2E 全覆盖

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLI 命令层 (packages/cli)                     │
│                                                                  │
│  memory.js        session.js       config.js      stream.js     │
│  store/recall/    policy/          beta            NDJSON        │
│  consolidate      lifecycle/tail/  list/enable/    输出          │
│                   usage            disable                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ require
┌──────────────────────────▼──────────────────────────────────────┐
│              session-core-singletons.js (CLI 胶水层)             │
│  单例懒加载：getMemoryStore() / getApprovalGate() /              │
│             getBetaFlags() / getSessionManager()                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ require
┌──────────────────────────▼──────────────────────────────────────┐
│              @chainlesschain/session-core                        │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐            │
│  │ MemoryStore  │  │ ApprovalGate │  │  BetaFlags  │            │
│  │ Consolidator │  │ 三档策略     │  │ 日期制过期  │            │
│  └─────────────┘  └──────────────┘  └─────────────┘            │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐            │
│  │SessionManager│  │ StreamRouter │  │ TraceStore  │            │
│  │ park/unpark  │  │ NDJSON 协议  │  │ JSONL 事件  │            │
│  └─────────────┘  └──────────────┘  └─────────────┘            │
│                                                                  │
│  file-adapters.js — JSON / JSONL 本地持久化                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 同一份文件
┌──────────────────────────▼──────────────────────────────────────┐
│              ~/.chainlesschain/ (持久化目录)                      │
│                                                                  │
│  memory-store.json        parked-sessions.json                  │
│  approval-policies.json   sessions/<id>.jsonl                   │
│  beta-flags.json                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 共用
┌──────────────────────────▼──────────────────────────────────────┐
│              Desktop (Electron)                                  │
│  session-core-ipc.js — 24 IPC 通道读写同一目录                   │
│  Pinia Store (sessionCore.ts) — 双端状态同步                     │
└─────────────────────────────────────────────────────────────────┘
```

### 持久化文件一览

| 文件 | 写入命令 | 说明 |
|------|----------|------|
| `memory-store.json` | `memory store/consolidate` | MemoryStore 全量快照 |
| `approval-policies.json` | `session policy --set` | per-session 审批策略 |
| `beta-flags.json` | `config beta enable/disable` | 实验特性开关状态 |
| `parked-sessions.json` | `session park/unpark/end` | 暂停会话快照 |
| `sessions/<id>.jsonl` | Agent 运行时写入 | 会话事件流（NDJSON） |

## 命令范围

当前可直接使用的命令只有三组：

```bash
chainlesschain memory store <content> --scope <session|agent|global>
chainlesschain memory recall [query]
chainlesschain session policy <sessionId> [--set strict|trusted|autopilot]
chainlesschain config beta list|enable|disable <feature>-<YYYY-MM-DD>
```

## Scoped Memory

`memory store` / `memory recall` 使用 `@chainlesschain/session-core` 的 `MemoryStore`，与传统 `memory add`、`memory search` 的数据库实现分离。

### 写入

```bash
chainlesschain memory store "偏好 TypeScript" --scope global --category preference
chainlesschain memory store "这个会话在做 CLI 文档收口" --scope session --scope-id sess_docs --category context
chainlesschain memory store "部署相关操作需要谨慎" --scope agent --scope-id agent_codegen --category safety --tags deploy,warning
```

### 召回

```bash
chainlesschain memory recall "TypeScript" --scope global
chainlesschain memory recall "部署" --scope agent --scope-id agent_codegen --limit 5
chainlesschain memory recall --tags deploy,warning --json
```

### 持久化文件

- `~/.chainlesschain/memory-store.json`

## Session Approval Policy

`session policy` 使用 `ApprovalGate` 管理单会话审批策略。

### 支持策略

| 策略 | 说明 |
|---|---|
| `strict` | 默认最保守，中高风险操作需要确认 |
| `trusted` | 低中风险尽量放行，仅高风险要求确认 |
| `autopilot` | 自动放行 |

### 使用示例

```bash
chainlesschain session policy sess_build_001
chainlesschain session policy sess_build_001 --set trusted
chainlesschain session policy sess_build_001 --json
```

### 持久化文件

- `~/.chainlesschain/approval-policies.json`

## Beta Flags

`config beta` 使用 `BetaFlags` 管理实验特性开关。推荐命名格式：

```text
<feature>-<YYYY-MM-DD>
```

### 使用示例

```bash
chainlesschain config beta list
chainlesschain config beta enable managed-agents-2026-04-15
chainlesschain config beta disable managed-agents-2026-04-15
chainlesschain config beta list --json
```

### 持久化文件

- `~/.chainlesschain/beta-flags.json`

## 当前限制

- `memory consolidate --session <id>` 还未接入 CLI
- 新会话自动注入 top-K scoped memory 还未接入
- CLI 主运行时尚未全部切到 `ApprovalGate` / `StreamRouter`
- Desktop 端还未与 CLI 共用同一套持久化状态文件

## 配置参考

### MemoryStore 写入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `content` | string | ✅ | 记忆内容正文 |
| `--scope` | `global\|session\|agent\|user` | ✅ | 作用域级别 |
| `--scope-id` | string | session/agent/user 时建议提供 | 会话/Agent/用户 ID |
| `--category` | string | — | 分类标签，默认 `general` |
| `--tags` | string (逗号分隔) | — | 多标签，用于过滤召回 |
| `--json` | flag | — | 输出 JSON 格式 |

### MemoryStore 召回参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `[query]` | string | — | 关键字，子字符串匹配 |
| `--scope` | string | — | 过滤作用域 |
| `--scope-id` | string | — | 过滤 scopeId |
| `--tags` | string | — | 按标签过滤，逗号分隔 |
| `--limit` | number | `10` | 最大返回条数 |
| `--json` | flag | — | 输出 JSON 格式 |

### session policy 策略矩阵

| 策略 | LOW 风险 | MEDIUM 风险 | HIGH 风险 | CRITICAL 风险 |
|------|----------|-------------|-----------|---------------|
| `strict` | 需审批 | 需审批 | 需审批 | 需审批 |
| `trusted` | 自动放行 | 自动放行 | 需审批 | 需审批 |
| `autopilot` | 自动放行 | 自动放行 | 自动放行 | 自动放行 |

### BetaFlags 格式规范

```text
格式:  <feature>-<YYYY-MM-DD>
示例:  idle-park-2026-05-01
       managed-agents-2026-04-15
       stream-router-v2-2026-06-30

规则:
  - feature 部分使用 kebab-case，仅小写字母和连字符
  - 日期部分严格 ISO 格式 YYYY-MM-DD
  - 日期到期后 BetaFlags.isEnabled() 自动返回 false
  - 不区分大小写（内部统一转小写存储）
```

### session lifecycle 参数

```bash
# session park
chainlesschain session park <sessionId>          # 序列化快照到 parked-sessions.json

# session unpark
chainlesschain session unpark <sessionId>        # 从快照恢复，状态变 running

# session end
chainlesschain session end <sessionId>           # 关闭会话
chainlesschain session end <sessionId> --consolidate              # 关闭 + 写入 MemoryStore
chainlesschain session end <sessionId> --consolidate --scope agent --agent-id coder

# session tail
chainlesschain session tail <sessionId>          # 跟踪实时 JSONL 事件
chainlesschain session tail <sessionId> --from-start              # 从头回放
chainlesschain session tail <sessionId> --type tool_call,assistant_message
chainlesschain session tail <sessionId> --since <timestamp-ms>
chainlesschain session tail <sessionId> --once   # 读完现有内容后退出

# session usage
chainlesschain session usage <sessionId>         # 单会话 token 用量
chainlesschain session usage                     # 全局汇总
chainlesschain session usage --json --limit 500  # JSON + 最多 500 条
```

### stream 命令参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--provider` | 当前活跃 provider | 指定 LLM provider |
| `--model` | provider 默认 | 指定模型 |
| `--base-url` | provider 配置 | 自定义 API base URL |
| `--api-key` | provider 配置 | 覆盖 API key |
| `--text` | — | 输出模式：将 StreamEvent 汇聚为纯文本 |

## 性能指标

### 命令响应时间

| 命令 | 冷启动（首次） | 热路径（重复） | 说明 |
|------|---------------|---------------|------|
| `memory store` | < 20ms | < 5ms | 文件读写 + JSON 序列化 |
| `memory recall` (1000 条) | < 30ms | < 10ms | 内存过滤，无索引开销 |
| `memory consolidate` | 100~500ms | 100~500ms | 取决于事件数量 |
| `session policy` (get) | < 10ms | < 5ms | 读 JSON 文件 |
| `session policy` (set) | < 20ms | < 10ms | 写 JSON 文件 |
| `config beta list` | < 10ms | < 5ms | 读 JSON 文件 |
| `session park` | < 50ms | < 20ms | 序列化 SessionHandle 快照 |
| `session unpark` | < 50ms | < 20ms | 反序列化 + 状态恢复 |
| `session end --consolidate` | 100~600ms | 100~600ms | 关闭 + 沉淀 |
| `stream` (首 token) | 300~2000ms | 300~2000ms | 取决于 LLM provider 延迟 |
| `session tail` (attach) | < 30ms | < 10ms | 文件定位 + 事件解析 |
| `session usage` | < 20ms | < 10ms | JSONL 扫描 + 汇总 |

### 资源占用

| 指标 | 数值 | 备注 |
|------|------|------|
| CLI 进程内存（空闲） | < 30MB | Node.js + session-core 加载 |
| MemoryStore 单条内存占用 | ~500B | 含 content + 元数据 |
| 持久化文件（1000 条记忆） | ~300KB | 未压缩 JSON |
| 单会话 JSONL（1000 事件） | ~100KB | 视 tool_call args 大小 |
| `stream` 峰值内存 | < 50MB | StreamRouter 缓冲 |

### 扩展限制

| 参数 | 推荐上限 | 超限行为 |
|------|----------|----------|
| MemoryStore 总条目 | 10,000 | recall 性能线性下降 |
| 单会话 JSONL 事件 | 5,000 | tail --from-start 变慢 |
| 并发 stream 请求 | 4 | 超出时排队 |
| BetaFlags 总数 | 100 | 无硬限制，仅 list 变长 |

## 测试覆盖率

### session-core 单元测试（452 测试）

```
✅ memory-store.test.js                - 40 测试  (四级作用域/召回/标签/相关性)
✅ memory-consolidator.test.js         - 15 测试  (提取/分类/去重/dry-run)
✅ approval-gate.test.js               - 30 测试  (三策略/四风险级别/evaluate)
✅ beta-flags.test.js                  - 16 测试  (enable/disable/过期/格式校验)
✅ session-manager.test.js             - 25 测试  (创建/park/unpark/关闭/查询)
✅ session-handle.test.js              - 25 测试  (状态机/touch/snapshot/版本)
✅ trace-store.test.js                 - 24 测试  (事件追踪/过滤/摘要/maxEvents)
✅ stream-router.test.js               - 19 测试  (StreamEvent 协议/路由/取消)
✅ file-adapters.test.js               - 8  测试  (JSON 持久化/原子写入)
✅ idle-parker.test.js                 - 14 测试  (阈值/轮询/自动 park)
✅ quality-gate.test.js                - 39 测试  (加权评分/聚合策略/工厂)
✅ service-envelope.test.js            - 21 测试  (创建/验证/dot-case 路由)
   ... 其他 10 个模块文件               - 177 测试
```

**session-core 合计**: `452 / 452` ✅

### CLI 单元测试

```
✅ session-core-singletons.test.js     - 4  测试  (懒加载单例/getters)
✅ command-registration.test.js        - 26 测试  (memory/session/config/stream 注册)
```

### CLI 集成测试

```
✅ managed-agents-cli.integration.test.js  - 3 测试
     - memory store → recall 跨命令持久化
     - session policy set → get 跨进程读取
     - config beta enable → list 状态验证
```

### CLI E2E 测试

```
✅ managed-agents-commands.test.js     - 6  测试
     - memory store + recall (global scope)
     - memory store + recall (session scope)
     - session policy set + get (trusted)
     - config beta enable + disable + list
     - session park + lifecycle list
     - stream text output (mock provider)
```

**CLI 合计**: `39 / 39` ✅  
**全链路合计**: `491 / 491` ✅

## 安全考虑

### 审批策略默认收紧

- 🔒 新会话默认策略为 `strict`，所有风险等级的工具调用均需审批
- ⚠️ 设置 `autopilot` 为不可逆操作感知变更——CLI 会在 stdout 打印明确的风险提示
- 📁 策略存储在 `approval-policies.json`，文件权限依赖操作系统用户隔离（`chmod 600` 建议）
- 🔄 Desktop Phase J 已确保 `_executeHostedTool` 也经过 `ApprovalGate`，无绕过路径

### 本地数据安全

- 📂 所有持久化文件存储在 `~/.chainlesschain/`，不写入系统全局目录，不上传云端
- 🗂️ 会话 JSONL 按 session ID 分文件，防止跨会话读取
- 🧩 MemoryStore 按 `scope + scopeId` 隔离，`recall` 时必须提供正确的 scopeId 才能访问对应记忆
- 🧹 `session end` 不自动删除 JSONL 文件，需要手动清理或调用 `prune` 命令释放空间

### BetaFlags 实验安全

- 📅 Flag 必须携带过期日期，到期后 `isEnabled()` 自动返回 `false`，防止实验特性永久开启
- 🚫 Flag 格式校验在写入时执行，非法格式（如缺少日期、日期格式错误）会被拒绝并返回错误
- 📋 `config beta list` 会展示所有 flag 及其过期状态，便于审计已开启的实验特性

### stream 命令安全

- 🔑 `--api-key` 参数通过命令行传入时会出现在进程列表，生产环境建议使用环境变量 `CHAINLESSCHAIN_API_KEY`
- 🌐 `--base-url` 参数可指向任意端点，使用前确认 URL 来源可信
- 📤 `stream` 输出是纯文本 / NDJSON，不执行任何工具调用，无副作用风险

### CLI ↔ Desktop 共享文件竞争

- ⚡ `file-adapters.js` 使用原子写入（先写临时文件再重命名），防止并发写入损坏 JSON
- 🔁 Desktop IPC 层在写前加读取校验，避免覆盖 CLI 刚写入的数据
- 💥 极端情况下双端同时写同一 key 时，后写者覆盖先写者——当前不支持 CRDT 合并

## 故障排查

### Q: `memory recall` 返回空结果？

检查以下三点：

1. **scope 和 scopeId 是否匹配写入时的值**
   ```bash
   # 写入时用了 --scope-id sess_123，召回时也要带上
   chainlesschain memory recall "关键词" --scope session --scope-id sess_123
   ```

2. **query 关键字是否在内容中存在**（子字符串匹配，大小写不敏感）
   ```bash
   # 直接查看 memory-store.json 确认写入
   cat ~/.chainlesschain/memory-store.json | python -m json.tool | grep -i "关键词"
   ```

3. **文件是否存在且可读**
   ```bash
   ls -la ~/.chainlesschain/memory-store.json
   ```

---

### Q: `session policy --set` 设置后重新读取仍是旧值？

原因：CLI 进程重启会重新初始化单例，但如果另一个进程同时持有旧文件句柄，可能读到缓存版本。

解决方法：
```bash
# 确认文件已更新
cat ~/.chainlesschain/approval-policies.json | python -m json.tool

# 手动强制读取最新值
chainlesschain session policy <sessionId> --json
```

---

### Q: `config beta enable` 报格式错误？

Flag 必须严格符合 `<feature>-YYYY-MM-DD` 格式：
```bash
# ✅ 正确
chainlesschain config beta enable idle-park-2026-05-01

# ❌ 错误：缺少日期
chainlesschain config beta enable idle-park

# ❌ 错误：日期格式不对
chainlesschain config beta enable idle-park-26-05-01
```

---

### Q: `session park` 后 `session lifecycle` 看不到该会话？

`parked` 状态的会话存储在 `parked-sessions.json`，默认 `lifecycle` 命令会同时展示 running 和 parked 会话。如果仍看不到：

```bash
# 明确过滤 parked 状态
chainlesschain session lifecycle --status parked --json

# 检查文件
cat ~/.chainlesschain/parked-sessions.json | python -m json.tool
```

---

### Q: `stream` 命令挂起没有输出？

可能是 LLM provider 连接问题：

```bash
# 先测试 provider 连通性
chainlesschain llm test

# 指定已知可用的 provider
chainlesschain stream "ping" --provider ollama --model qwen2:7b

# 如果使用 anthropic
chainlesschain stream "ping" --provider anthropic --model claude-haiku-4-5
```

---

### Q: `session tail` 无法附加到会话？

`session tail` 需要会话 JSONL 文件已存在：

```bash
# 确认文件存在
ls ~/.chainlesschain/sessions/

# 文件路径格式
~/.chainlesschain/sessions/<sessionId>.jsonl

# 从头回放验证文件可读
chainlesschain session tail <sessionId> --from-start --once
```

---

### 调试工具箱

```bash
# 查看所有持久化文件
ls -lh ~/.chainlesschain/

# 验证 session-core 模块正常加载
node -e "const sc = require('@chainlesschain/session-core'); console.log(Object.keys(sc).length, 'exports')"

# 检查 CLI 单例初始化
chainlesschain config beta list --json   # 若返回 [] 则单例正常
chainlesschain session lifecycle --json  # 若返回 [] 则 SessionManager 正常

# 重置特定持久化文件（谨慎操作）
# cp ~/.chainlesschain/memory-store.json ~/.chainlesschain/memory-store.json.bak
# echo '{"memories":[]}' > ~/.chainlesschain/memory-store.json
```

## 关键文件

- `packages/cli/src/commands/memory.js`
- `packages/cli/src/commands/session.js`
- `packages/cli/src/commands/config.js`
- `packages/cli/src/lib/session-core-singletons.js`
- `packages/session-core/lib/file-adapters.js`

## 相关文档

- [Managed Agents 对标总览](./managed-agents-parity)
- [会话管理](./cli-session)
- [持久记忆](./cli-memory)
- [配置管理](./cli-config)
- [设计文档 91](../design/modules/91-managed-agents-parity)
