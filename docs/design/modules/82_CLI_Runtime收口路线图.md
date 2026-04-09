# 82. CLI Runtime 收口路线图

> **状态：Phase 2–6b 已完成 · Phase 7 待启动** · 最后更新：2026-04-09 · 适用范围：`packages/cli` + `desktop-app-vue`
>
> 关联设计：[78. CLI Agent Runtime 重构实施计划](./78-cli-agent-runtime) · [79. Coding Agent 系统](./79-coding-agent) · [81. Tool Descriptor 统一](./81-tool-descriptor-unification)
>
> 用户文档：[CLI Runtime 收口路线图](../../chainlesschain/cli-runtime-convergence-roadmap)
>
> ADR：[CLI_RUNTIME_CONVERGENCE_ADR](../../../../docs/implementation-plans/CLI_RUNTIME_CONVERGENCE_ADR)

## 0. 基线审计 (2026-04-09)

在启动实施前对现状进行了一次 ground-truth 审计,结果如下:

| 阶段 | 状态 | 证据 |
|---|---|---|
| Phase 0 | ✅ 完成 | ADR `CLI_RUNTIME_CONVERGENCE_ADR.md` 已签发 |
| Phase 1 | ✅ 完成 | `agent/chat/serve/ui` 四命令均走 `createAgentRuntimeFactory()`;`runtime-factory.js` 导出 `createAgentRuntime/createChatRuntime/createServerRuntime/createUiRuntime`;`AgentRuntime` 类 520 行齐全 |
| Phase 2 | 🟡 部分完成 | `src/lib/jsonl-session-store.js` (22 行) 与 `prompt-compressor.js` (10 行) 已是 re-export shim;canonical 实现在 `src/harness/jsonl-session-store.js` (461 行);`gateways/repl/agent-repl.js` (1 行) 已是 re-export,canonical 在 `src/repl/agent-repl.js` (~1100 行) |
| Phase 2 剩余 | ✅ 完成 (Phase 6a-2) | `ws-session-manager.js` 1421 行 → 13 行 shim,canonical 在 `src/gateways/ws/ws-session-gateway.js` |
| Phase 3 | ✅ 完成 | `mcp-client.js` 413 行 → shim,canonical 在 `src/harness/mcp-client.js` |
| Phase 4 | ✅ 完成 | `plugin-manager.js` 430 行 → shim,canonical 在 `src/harness/plugin-manager.js` |
| Phase 5 | ✅ 完成 | `doctor --json` / `status --json` 稳定字段落地,schema `chainlesschain.doctor.v1` / `chainlesschain.status.v1` 已发布 |
| Phase 6a-1 | ✅ 完成 | `ws-server.js` 760 行 → shim,canonical 在 `src/gateways/ws/ws-server.js` |
| Phase 6b | ✅ 完成 (2026-04-09) | `agent-core.js` 1651 行 → shim (canonical `src/runtime/agent-core.js`);`ws-agent-handler.js` 476 行 → shim (canonical `src/gateways/ws/ws-agent-handler.js`) |
| Phase 6c | ✅ 完成 | 6 个 lib 实体全部 `@deprecated` 标注完成,新增 `runtime-convergence-shims.test.js` 作为回归护栏 (41 tests) |
| Phase 7 | ⬜ 待启动 | parity harness / mock provider / golden transcript |

**Phase 6b 完结快照 (2026-04-09):** 原计划 6 个 lib 实体 5151 行全部退化为 `@deprecated` re-export shim。canonical 实体分布:

| 原 lib 文件 | 原行数 | shim 行数 | canonical 位置 |
|---|---|---|---|
| `src/lib/agent-core.js` | 1651 | 27 | `src/runtime/agent-core.js` |
| `src/lib/ws-session-manager.js` | 1421 | 13 | `src/gateways/ws/ws-session-gateway.js` |
| `src/lib/ws-server.js` | 760 | 13 | `src/gateways/ws/ws-server.js` |
| `src/lib/ws-agent-handler.js` | 476 | 13 | `src/gateways/ws/ws-agent-handler.js` |
| `src/lib/plugin-manager.js` | 430 | ≤40 | `src/harness/plugin-manager.js` |
| `src/lib/mcp-client.js` | 413 | ≤40 | `src/harness/mcp-client.js` |

规则 D3 (`src/lib/*` 冻结为兼容层) 由新增回归测试 `packages/cli/__tests__/integration/runtime-convergence-shims.test.js` 护栏,静态解析确保 shim `@deprecated` 横幅、≤ 40 行、canonical 全部命名导出被 re-export、9 个生产调用点不回退到 shim 路径。



## 1. 目标

把 `chainlesschain` 当前分散在 CLI、桌面主进程、旧兼容层中的 coding-agent / MCP / plugin / session / runtime 能力，收口为一条明确主线：

- `packages/cli` 是唯一 canonical agent runtime
- `desktop-app-vue` 只承担 host、bridge、IPC、UI 消费职责
- `runtime / gateways / harness / contracts / tools` 是唯一允许新增核心逻辑的目录
- `packages/cli/src/lib/*` 中与新 runtime 重复的实现逐步降级为兼容层并最终清空
- `doctor / status / session / mcp / plugin` 全部共享同一套 machine-readable state

### 非目标

- 不重写整个 CLI
- 不重做桌面 UI 视觉层
- 不同时推进所有 AI 能力扩张
- 不引入第二套 agent kernel 包

## 2. 当前问题

### 2.1 主运行时双轨

仓库已形成新的 runtime 分层（`packages/cli/src/runtime/` · `gateways/` · `harness/` · `tools/`），但大量旧实现仍停留在：

- `packages/cli/src/lib/agent-core.js`
- `packages/cli/src/lib/ws-server.js`
- `packages/cli/src/lib/ws-agent-handler.js`
- `packages/cli/src/lib/jsonl-session-store.js`
- `packages/cli/src/lib/prompt-compressor.js`
- `packages/cli/src/lib/mcp-client.js`
- `packages/cli/src/lib/plugin-manager.js`

结果：文档上已经"收口"，代码上仍然"并存"。

### 2.2 Desktop 平行真相

桌面主进程存在自己的 agent host 能力，但其中一部分越过 host 边界持有 runtime 级逻辑：

- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js`
- `desktop-app-vue/src/main/mcp/mcp-client-manager.js`
- `desktop-app-vue/src/main/plugins/*`

不继续收口，CLI 与 Desktop 会长期维护两套 MCP / plugin / session 语义。

### 2.3 运维可观测性不足

`doctor.js` / `status.js` 能做基础环境检查，但无法回答：session 是否可恢复、哪个 MCP server 失败、哪个 plugin 加载失败、provider 是否可用、sandbox / approval policy 是否阻断、worktree 是否脏。

### 2.4 缺少 parity harness

已有较多 unit / integration / e2e，但仍偏模块验证。缺一条真正的 agent parity harness：给定输入 prompt + mock provider + mock MCP + mock tool，断言固定 event 序列、session record、恢复行为、bridge roundtrip。

## 3. 目标架构

```text
User / Desktop UI / CLI command
  └─> packages/cli/src/commands/*
        └─> runtime/runtime-factory.js
              └─> runtime/agent-runtime.js
                    ├─> tools/*
                    ├─> harness/*
                    ├─> runtime/contracts/*
                    └─> runtime/runtime-events.js

Desktop Main
  └─> bridge / ipc / host-managed tools only
        └─> consumes runtime envelopes and records
        (not owning a second runtime truth)
```

### 3.1 工作原则

1. 不重写，先收口
2. 先确定 canonical source，再迁移消费者
3. 兼容层先变薄，再删除
4. 先统一 state 和 event，再谈功能扩张
5. 新增能力默认只能进入 `runtime / gateways / harness / contracts / tools`

## 4. 阶段计划

### Phase 0：冻结边界

**目标**：在团队层面明确"以后什么能往哪写"，避免收口过程中继续长出新分叉。

**要做的事**：

- 发布短 ADR，明确 `packages/cli` 是唯一 canonical runtime
- 明确 `desktop-app-vue` 只做 host / bridge / IPC / UI
- 明确 `packages/cli/src/lib/*` 只允许兼容，不允许新增 runtime 逻辑

**验收标准**：

- 新增 agent runtime 相关代码不再进入 `packages/cli/src/lib/*`
- 设计文档中出现明确的 canonical runtime 描述
- Desktop 新增需求默认以 bridge / adapter 方式实现

### Phase 1：收口入口层

**目标**：让所有 `agent / chat / serve / ui` 启动路径统一经过 runtime factory。

**重点文件**：

- `packages/cli/src/commands/agent.js` / `chat.js` / `serve.js` / `ui.js`
- `packages/cli/src/runtime/runtime-factory.js` / `agent-runtime.js`
- `packages/cli/src/repl/agent-repl.js` 与 `packages/cli/src/gateways/repl/agent-repl.js`

**迁移动作**：

- 保留旧入口文件，但内部改为薄转发
- 所有新 policy 注入只允许经由 `runtime-factory`
- 明确 `AgentRuntime` 拥有 `runTurn / resumeSession / startServer / startUiServer`

**验收标准**：所有交互入口都能追到 `runtime-factory -> AgentRuntime`；不存在命令层直接 new 旧 session manager / ws server / repl core。

### Phase 2：收口 session 与 event

**目标**：统一"会话怎么存"和"状态怎么广播"。

**重点文件**：

- `packages/cli/src/harness/jsonl-session-store.js`
- `packages/cli/src/runtime/runtime-events.js`
- `packages/cli/src/runtime/contracts/session-record.js` / `task-record.js` / `worktree-record.js`
- `packages/cli/src/gateways/ws/session-protocol.js` / `task-protocol.js` / `worktree-protocol.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js`

**迁移动作**：

- 旧 `packages/cli/src/lib/jsonl-session-store.js` 改为 re-export shim
- bridge 内部只认 envelope，不再解析多套 ad-hoc shape
- `session:list` / `session:created` / `session:resumed` / `turn:start` / `turn:end` 统一字段

**验收标准**：会话记录只有一个主写入点；WS 返回与 Desktop bridge 返回使用同一事件 shape；resume 后能恢复同样的 session record。

### Phase 3：收口 MCP

**目标**：结束 CLI 一套 MCP、Desktop 一套 MCP 的状态。

**策略**：选定 CLI runtime 的 MCP 实现为 canonical truth，Desktop 变成 adapter / bridge。

**重点文件**：

- `packages/cli/src/lib/mcp-client.js` · `packages/cli/src/commands/mcp.js`
- `packages/cli/src/runtime/coding-agent-managed-tool-policy.cjs`
- `desktop-app-vue/src/main/mcp/mcp-client-manager.js` / `mcp-ipc.js` / `mcp-tool-adapter.js` / `mcp-security-policy.js`

**子阶段**：

- **Phase 3A**：定义 canonical MCP contract
- **Phase 3B**：CLI MCP 补齐 Desktop 缺口 或 Desktop 退化为 CLI adapter
- **Phase 3C**：Desktop UI 只读统一的 MCP state

**验收标准**：`chainlesschain mcp servers/tools/call` 与 Desktop 展示结果一致；同一 server 的连接状态不再出现 CLI / Desktop 不一致；permission/trust policy 只有一份真相。

### Phase 4：收口 plugin / skill

**目标**：统一插件生命周期、技能注册和权限元数据。

**重点文件**：

- `packages/cli/src/lib/plugin-manager.js` · `packages/cli/src/commands/plugin.js` · `skill.js`
- `packages/cli/src/lib/skill-loader.js`
- `desktop-app-vue/src/main/plugins/plugin-manager.js` / `plugin-loader.js` / `plugin-registry.js`
- `desktop-app-vue/src/main/marketplace/plugin-ecosystem-v2.js`

**迁移动作**：先统一 manifest 和状态字段 → 再统一 DB / file-based persistence → 最后让 Desktop 插件页消费 canonical plugin state。

**验收标准**：`plugin list/install/enable/disable` 与 Desktop 插件页读同一状态源；plugin skills 与 standalone skills 不再走两套注册路径。

### Phase 5：升级 doctor / status / session 运维面

**目标**：把 `doctor` 和 `status` 从"安装诊断"升级为"runtime health 面板"。

**建议新增检查项**：

- provider connectivity
- last successful turn timestamp
- session store corruption detection
- active MCP connections
- plugin load failures
- sandbox mode / approval mode
- active worktree isolation branches
- Desktop bridge availability

**重点文件**：

- `packages/cli/src/commands/doctor.js` / `status.js` / `session.js`
- `packages/cli/src/constants.js`
- `packages/cli/src/runtime/runtime-events.js`
- `packages/cli/src/harness/jsonl-session-store.js`

**验收标准**：`doctor --json` / `status --json` 具备稳定字段；桌面端可直接消费；用户能从输出中定位"为什么 agent 不可用"。

### Phase 6：清理兼容层

**目标**：让旧 `src/lib/*` 从实现层退化到兼容导出层。

**优先清理对象**：`agent-core.js` · `ws-server.js` · `ws-agent-handler.js` · `ws-session-manager.js` · `jsonl-session-store.js` · `prompt-compressor.js` · `background-task-manager.js` · `worktree-isolator.js`

**迁移方法**：旧文件内部改为 re-export / wrapper → 更新所有 import 指向新目录 → 加废弃注释与迁移说明 → 确认无消费者后删除实现。

**验收标准**：重复实现数量明显下降；新目录承担真实实现；不再出现同类功能在 `lib` 与 `runtime / harness` 各维护一份。

### Phase 7：建 parity harness

**目标**：建立可重放、可比较、可自动回归的 agent 行为测试。

**要做的事**：引入 mock provider / mock MCP server / golden transcript / golden event stream；固化 turn-level parity test、resume / recovery parity test、Desktop bridge roundtrip parity test。

**建议测试矩阵**：agent loop parity · plan approval parity · shell policy parity · MCP invoke parity · plugin tool parity · session resume parity · worktree isolation parity · Desktop bridge envelope parity。

**重点文件**：

- `packages/cli/__tests__/unit/agent-runtime.test.js`
- `packages/cli/__tests__/integration/agent-core-integration.test.js`
- `packages/cli/__tests__/e2e/coding-agent-envelope-roundtrip.test.js`
- `desktop-app-vue/tests/integration/coding-agent-bridge-real-cli.test.js`
- `desktop-app-vue/tests/integration/coding-agent-lifecycle.integration.test.js`

**验收标准**：给定固定 mock 输入，可稳定得到同一组 event / record；session 恢复流程可 deterministic 回归；Desktop 与 CLI 的 roundtrip 协议可自动验证。

## 5. 文件级改造清单

### P0：立即禁止新增重复逻辑

- 禁止在 `packages/cli/src/lib/*` 新增 runtime 级实现
- 禁止在 `desktop-app-vue/src/main/mcp/` 新增独立 MCP 真相
- 禁止在 `desktop-app-vue/src/main/plugins/` 新增独立 plugin 真相

### P1：第一批必须收口的文件

- `packages/cli/src/runtime/runtime-factory.js`
- `packages/cli/src/runtime/agent-runtime.js`
- `packages/cli/src/runtime/runtime-events.js`
- `packages/cli/src/harness/jsonl-session-store.js`
- `packages/cli/src/lib/mcp-client.js`
- `packages/cli/src/lib/plugin-manager.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js`
- `desktop-app-vue/src/main/mcp/mcp-client-manager.js`

### P2：第二批兼容层清理对象

- `packages/cli/src/lib/ws-server.js` / `ws-agent-handler.js` / `ws-session-manager.js`
- `packages/cli/src/lib/jsonl-session-store.js`
- `packages/cli/src/lib/prompt-compressor.js`
- `packages/cli/src/lib/background-task-manager.js`
- `packages/cli/src/lib/worktree-isolator.js`

### P3：第三批 UI / 协议消费者调整对象

- `desktop-app-vue/src/main/mcp/mcp-ipc.js`
- `desktop-app-vue/src/main/plugins/plugin-ipc.js`
- `desktop-app-vue/src/renderer/stores/coding-agent.ts` / `autonomous-agent.ts` / `agents.ts`

## 6. 里程碑与时间表

| 里程碑 | 内容 |
|---|---|
| **M1** | 单一运行时入口完成：所有命令入口经过 runtime factory |
| **M2** | 单一 session / event 真相完成：Desktop / WS / REPL 全部对齐 |
| **M3** | MCP / plugin 真相合并完成：CLI 与 Desktop 不再各自维护独立状态 |
| **M4** | 运维面完成：`doctor` / `status` / `session` 能解释 agent 不可用原因 |
| **M5** | parity harness 完成：agent 核心行为可 deterministic 回归 |

根据 2026-04-09 基线审计,Phase 0/1 已完成、Phase 2 部分完成,原 6 周计划压缩为 5 周:

| 周 | 工作 |
|---|---|
| ~~第 1 周~~ | ~~Phase 0 + Phase 1~~ ✅ 已完成 |
| 第 1 周 | 完成 Phase 2 剩余项 (`ws-session-manager.js` 迁移) |
| 第 2 周 | Phase 3A / 3B (MCP canonical contract + CLI/Desktop 差异对照) |
| 第 3 周 | Phase 4 (plugin / skill) + 启动 Phase 5 |
| 第 4 周 | 完成 Phase 5 (`doctor --json` / `status --json` 稳定字段) + 启动 Phase 6 |
| 第 5 周 | 完成 Phase 6 (`agent-core.js` / `ws-server.js` / `ws-agent-handler.js` 退化为 shim) + 最小可用 parity harness |

## 7. 风险与应对

| 风险 | 应对 |
|---|---|
| 收口过程中功能回退 | 每阶段先做 adapter，再删旧实现；targeted integration test 兜住主链路 |
| Desktop 依赖旧 flat shape | 先桥接 envelope 与 legacy shape；消费者全部迁移后再删兼容层 |
| MCP / plugin 差异比预期大 | 先做 canonical contract；不先追求实现合并，先追求状态模型统一 |
| 文档先行但代码未跟进 | 每阶段结束必须同步更新本文档状态；文档不写"理想态"，只写已落实与下一步 |

## 8. 完成定义

当满足以下条件时，认为收口完成：

1. `packages/cli` 成为唯一 canonical runtime
2. Desktop 不再维护平行 MCP / plugin / session 真相
3. runtime state 全部具备统一 record / event / JSON 输出
4. `doctor` / `status` 能直接定位运行时问题
5. 关键 agent 行为具备 parity harness 回归能力

## 9. 下一步建议

优先启动以下 3 个小任务，不要一上来大规模重构：

1. 审计 `commands/*` 到 `runtime-factory` 的入口一致性
2. 列一份 CLI MCP 与 Desktop MCP 的功能对照表
3. 给 `doctor --json` 和 `status --json` 先定义稳定字段草案
