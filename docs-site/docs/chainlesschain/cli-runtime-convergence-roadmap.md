# CLI Runtime 收口路线图

> **状态：In Progress** · 最后更新：2026-04-09 · 适用范围：`packages/cli` + `desktop-app-vue` · 目标周期：6 周
>
> 关联文档：[CLI Agent Runtime 重构计划](./cli-agent-runtime-plan) · [Minimal Coding Agent 实施计划](./minimal-coding-agent-plan) · [Canonical Tool Descriptor](./coding-agent-tool-descriptor-unification-plan) · [边界冻结 ADR](../../../docs/implementation-plans/CLI_RUNTIME_CONVERGENCE_ADR)

## 当前进度 (2026-04-09 Phase 6b 完成)

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 — 冻结边界 | ✅ 完成 | ADR 已签发 (`docs/implementation-plans/CLI_RUNTIME_CONVERGENCE_ADR.md`) |
| Phase 1 — 收口入口层 | ✅ 完成 | `agent/chat/serve/ui` 四个命令均经过 `createAgentRuntimeFactory()`;`AgentRuntime` 520 行已齐备 |
| Phase 2 — 收口 session 与 event | ✅ 完成 | `src/lib/jsonl-session-store.js`、`prompt-compressor.js` 均已挂 `@deprecated` re-export;`gateways/repl/agent-repl.js` 已是 1 行 re-export |
| Phase 3 — 收口 MCP | ✅ 完成 | `mcp-client.js` 迁移到 `harness/mcp-client.js`;`src/lib/mcp-client.js` 为 `@deprecated` 再导出 |
| Phase 4 — 收口 plugin/skill | ✅ 完成 | `plugin-manager.js` 迁移到 `harness/plugin-manager.js`;`src/lib/plugin-manager.js` 为 `@deprecated` 再导出;`commands/plugin.js` 直连 canonical 路径 |
| Phase 5 — 升级 doctor/status | ✅ 完成 | `runtime/diagnostics.js` 纯数据采集;`doctor --json` / `status --json` 落地稳定 schema (`chainlesschain.doctor.v1` / `chainlesschain.status.v1`),满足 D6 |
| Phase 6a — ws-server & ws-session-manager 反向迁移 | ✅ 完成 | `ws-server.js` (760 行) → `gateways/ws/ws-server.js`;`ws-session-manager.js` (1421 行) → `gateways/ws/ws-session-gateway.js`;两处 `src/lib/*` 均为 `@deprecated` 再导出 |
| Phase 6b — agent-core & ws-agent-handler 反向迁移 | ✅ 完成 | `agent-core.js` (1651 行) → `runtime/agent-core.js`;`ws-agent-handler.js` (476 行) → `gateways/ws/ws-agent-handler.js`;生产调用点 (`repl/agent-repl.js`、`gateways/ws/session-protocol.js`、`gateways/ws/ws-session-gateway.js`) 直连 canonical;`src/lib/*` 均为 `@deprecated` 再导出 |
| Phase 7 — parity harness | ⬜ 待启动 | 无 mock provider / golden transcript |

**兼容层当前状态:** 6 个历史 lib 实体文件 (~5151 行) 已全部退化为 `@deprecated` re-export shim。`src/lib/*` 冻结为兼容层,新增代码默认落到 `runtime/`、`gateways/`、`harness/`、`tools/`、`contracts/`。

## 概述

ChainlessChain 的 coding-agent / MCP / plugin / session / runtime 能力当前分散在 CLI、桌面主进程、以及旧兼容层三处，存在"双轨真相"与"运维面不足"问题。本路线图把这些能力收口为一条明确主线，让 `packages/cli` 成为唯一 canonical agent runtime，`desktop-app-vue` 退化为 host / bridge / IPC / UI 消费者。

**目标：**

- `packages/cli` 是唯一 canonical agent runtime
- `desktop-app-vue` 只承担 host / bridge / IPC / UI 消费职责
- `runtime / gateways / harness / contracts / tools` 是唯一允许新增核心逻辑的目录
- `packages/cli/src/lib/*` 中与新 runtime 重复的实现逐步降级为兼容层并最终清空
- `doctor / status / session / mcp / plugin` 全部共享同一套 machine-readable state

**非目标：** 本轮不重写整个 CLI，不重做桌面 UI 视觉层，不同时推进所有 AI 能力扩张，不引入第二套 agent kernel 包。

## 核心特性

- 🎯 **单一运行时真相**：所有 `agent / chat / serve / ui` 入口经过 `runtime-factory`，避免命令层直连旧逻辑
- 📼 **统一 session / event 协议**：`jsonl-session-store` 为 canonical 持久化层，runtime event envelope 为跨 CLI / Desktop / WS 唯一事件形状
- 🔌 **MCP 状态收口**：CLI MCP 成为 canonical truth，Desktop 退化为 adapter / bridge，server registry / connection state / tool list / capability cache 共享一份
- 🧩 **Plugin / Skill 生命周期统一**：plugin manifest / install state / enable state / permission / skill exports 只有一份真相
- 🩺 **运维可观测性**：`doctor` / `status` 从"安装诊断"升级为"runtime health 面板"，能回答 session 是否可恢复、MCP / plugin 是否加载失败、provider 是否可用等具体问题
- 🧪 **Parity Harness**：给定 mock provider / MCP / tool，能 deterministic 回归固定 event 序列、session record、恢复行为、bridge roundtrip
- 🧱 **兼容层渐进退化**：`packages/cli/src/lib/*` 先变成薄 re-export，再更新所有 import，最后删除实现
- 🚦 **边界冻结**：新增 runtime 级代码默认只能进入 `runtime / gateways / harness / contracts / tools`

## 系统架构

### 目标架构

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

### 分层职责

| 层 | 位置 | 职责 |
|---|---|---|
| **Commands** | `packages/cli/src/commands/` | 参数解析、入口选择、调用 runtime factory |
| **Runtime** | `packages/cli/src/runtime/` | agent turn 生命周期、session 恢复、事件发射、policy / contract / state |
| **Gateways** | `packages/cli/src/gateways/` | 外部接入边界（WS / REPL / IPC bridge） |
| **Harness** | `packages/cli/src/harness/` | 生产级增强能力（session store、prompt compression、worktree 隔离） |
| **Tools** | `packages/cli/src/tools/` | 工具 registry、canonical tool descriptor |
| **Host (Desktop)** | `desktop-app-vue/src/main/` | bridge / IPC / 权限 UI / event consumer，不持有 runtime 真相 |

### 当前问题与收口方向

| 问题 | 现状 | 收口方向 |
|---|---|---|
| 主运行时双轨 | `src/runtime/` 已存在，但 `src/lib/agent-core.js`、`ws-server.js`、`ws-agent-handler.js`、`jsonl-session-store.js`、`mcp-client.js`、`plugin-manager.js` 仍并存 | 旧 `lib/*` 改为薄 re-export，最终删除实现 |
| Desktop 平行真相 | `coding-agent-bridge.js` / `mcp-client-manager.js` / `plugins/*` 持有 runtime 级逻辑 | Desktop 仅做 bridge / adapter，不再维护独立生命周期 |
| 运维面偏"安装诊断" | `doctor` / `status` 只做环境检查 | 增加 provider / MCP / plugin / session store / sandbox / bridge / worktree 检查 |
| 缺 parity harness | 有 unit / integration / e2e，但偏模块验证 | 引入 mock provider / MCP、golden transcript、turn-level parity test |

## 使用示例

### 阶段推进

路线图分 8 个阶段，建议 6 周内完成：

```text
Phase 0  冻结边界         — 发布 ADR，明确目录职责
Phase 1  收口入口层       — 所有命令走 runtime-factory
Phase 2  收口 session/event — jsonl-session-store + envelope 统一
Phase 3  收口 MCP         — CLI 为 canonical，Desktop 为 adapter
Phase 4  收口 plugin/skill — manifest / state / permission 统一
Phase 5  升级 doctor/status — runtime health 面板
Phase 6  清理兼容层       — lib/* 退化为 re-export
Phase 7  建 parity harness — deterministic agent 行为回归
```

### 建议时间表

根据 2026-04-09 基线审计,Phase 0/1 已完成、Phase 2 部分完成,原 6 周计划压缩为 5 周:

| 周 | 工作 |
|---|---|
| ~~第 1 周~~ | ~~Phase 0 + Phase 1~~ ✅ 已完成 |
| 第 1 周 | 完成 Phase 2 剩余项 (`ws-session-manager.js` 迁移到 `harness/` 或 `runtime/`) |
| 第 2 周 | Phase 3A / 3B (MCP canonical contract + CLI/Desktop 差异对照) |
| 第 3 周 | Phase 4 (plugin / skill) + 启动 Phase 5 |
| 第 4 周 | 完成 Phase 5 (`doctor --json` / `status --json` 稳定字段) + 启动 Phase 6 |
| 第 5 周 | 完成 Phase 6 (`agent-core.js` / `ws-server.js` / `ws-agent-handler.js` 退化为 shim) + 最小可用 parity harness |

### 里程碑验收

- **M1 单一运行时入口**：所有命令入口经过 runtime factory，不再有绕过 runtime 的主链路
- **M2 单一 session / event 真相**：session store 和 event envelope 成为唯一事实源，Desktop / WS / REPL 全部对齐
- **M3 MCP / plugin 真相合并**：CLI 与 Desktop 不再各自维护独立状态
- **M4 运维面完成**：`doctor` / `status` / `session` 能解释 agent 不可用原因
- **M5 parity harness 完成**：agent 核心行为可 deterministic 回归

### 下一步建议

优先启动以下 3 个小任务，不要一上来大规模重构：

1. 审计 `commands/*` 到 `runtime-factory` 的入口一致性
2. 列一份 CLI MCP 与 Desktop MCP 的功能对照表
3. 给 `doctor --json` 和 `status --json` 先定义稳定字段草案

## 故障排查

### Issue: 新增 runtime 代码误入 `src/lib/*`

**症状**：PR 中出现对 `packages/cli/src/lib/*` 的新功能性修改（而非兼容层收敛）。

**原因**：团队未对齐 Phase 0 的边界冻结结论。

**解决方案**：

1. 将新增逻辑迁到 `runtime / gateways / harness / contracts / tools` 对应子目录
2. `src/lib/*` 只允许出现 re-export / wrapper / 废弃注释
3. 在 CI 增加路径白名单检查（阻止 `src/lib/*` 非兼容层新增）

### Issue: Desktop 与 CLI 的 MCP 状态不一致

**症状**：`chainlesschain mcp servers` 显示 server 在线，Desktop MCP 页面却显示断开（或反之）。

**原因**：CLI MCP 与 `desktop-app-vue/src/main/mcp/mcp-client-manager.js` 维护了两份独立 connection state。

**解决方案**：

1. 参见 Phase 3：先定义 canonical MCP contract，再让 Desktop 退化为 CLI adapter
2. 过渡期内，以 `chainlesschain mcp servers --json` 为准，Desktop 消费同一 JSON

### Issue: session resume 后状态丢失

**症状**：`agent --session <id>` 恢复后，工具调用历史 / plan / turn 计数与前次不一致。

**原因**：旧 `lib/jsonl-session-store.js` 与 `harness/jsonl-session-store.js` 两处写入，resume 时读取到过时副本。

**解决方案**：

1. 确认写入点已统一到 `harness/jsonl-session-store.js`
2. `src/lib/jsonl-session-store.js` 应仅为 re-export shim
3. 通过 `chainlesschain doctor --json` 检查 `sessionStore.corruption` 字段

### Issue: `doctor` / `status` 无法定位 agent 不可用原因

**症状**：agent 启动失败但 `doctor` 只报告"环境 OK"。

**原因**：Phase 5 尚未完成，`doctor` 仍偏安装诊断。

**解决方案**：

1. 临时：检查 `chainlesschain status --json` 中 provider / MCP / plugin / bridge 字段
2. 长期：推进 Phase 5，补齐 provider connectivity / last successful turn / MCP connections / plugin load failures / sandbox mode / worktree isolation / Desktop bridge availability 检查项

## 安全考虑

- **边界冻结 (Phase 0)**：禁止新增 runtime 级实现进入 `packages/cli/src/lib/*`、`desktop-app-vue/src/main/mcp/`、`desktop-app-vue/src/main/plugins/`，防止 ACL / permission policy 漂移
- **Permission Policy 统一 (Phase 3)**：MCP permission policy 和 trusted server policy 只有一份真相，避免 CLI 放行但 Desktop 拒绝（或反之）造成权限绕过
- **Sandbox / Approval Mode 可观测 (Phase 5)**：`doctor` / `status` 暴露当前 sandbox 模式和 approval policy 状态，用户能立即看到是否有工具被静默阻断
- **Worktree 隔离状态可见 (Phase 5)**：`doctor` 检查 worktree 是否脏、是否存在未合并隔离分支，避免污染主工作区
- **兼容层渐进退化**：旧 `lib/*` 先变 wrapper 再删除，避免直接删除造成下游消费者访问未授权路径
- **Parity Harness 防回退 (Phase 7)**：shell policy parity、MCP invoke parity、plan approval parity 进入回归矩阵，防止权限语义在收口过程中悄悄弱化

### 风险应对

| 风险 | 应对 |
|---|---|
| 收口过程中功能回退 | 每阶段先做 adapter，再删旧实现；targeted integration test 兜住主链路 |
| Desktop 依赖旧 flat shape | 先桥接 envelope 与 legacy shape，消费者全部迁移后再删兼容层 |
| MCP / plugin 差异比预期大 | 先做 canonical contract，不追求实现合并，先追求状态模型统一 |
| 文档先行但代码未跟进 | 每阶段结束必须同步更新本文档状态，文档不写"理想态" |

## 关键文件

### Runtime 核心（canonical）

- `packages/cli/src/runtime/runtime-factory.js` — 唯一入口工厂
- `packages/cli/src/runtime/agent-runtime.js` — `runTurn / resumeSession / startServer / startUiServer`
- `packages/cli/src/runtime/runtime-events.js` — 跨端统一 event envelope
- `packages/cli/src/runtime/contracts/session-record.js`
- `packages/cli/src/runtime/contracts/task-record.js`
- `packages/cli/src/runtime/contracts/worktree-record.js`
- `packages/cli/src/runtime/coding-agent-managed-tool-policy.cjs`

### Harness / Gateways

- `packages/cli/src/harness/jsonl-session-store.js` — canonical session persistence
- `packages/cli/src/gateways/ws/session-protocol.js`
- `packages/cli/src/gateways/ws/task-protocol.js`
- `packages/cli/src/gateways/ws/worktree-protocol.js`
- `packages/cli/src/gateways/repl/agent-repl.js`

### 命令入口

- `packages/cli/src/commands/agent.js`
- `packages/cli/src/commands/chat.js`
- `packages/cli/src/commands/serve.js`
- `packages/cli/src/commands/ui.js`
- `packages/cli/src/commands/mcp.js`
- `packages/cli/src/commands/plugin.js`
- `packages/cli/src/commands/skill.js`
- `packages/cli/src/commands/doctor.js`
- `packages/cli/src/commands/status.js`
- `packages/cli/src/commands/session.js`

### 待收口的兼容层（`src/lib/*`）

- `packages/cli/src/lib/agent-core.js`
- `packages/cli/src/lib/ws-server.js`
- `packages/cli/src/lib/ws-agent-handler.js`
- `packages/cli/src/lib/ws-session-manager.js`
- `packages/cli/src/lib/jsonl-session-store.js`
- `packages/cli/src/lib/prompt-compressor.js`
- `packages/cli/src/lib/background-task-manager.js`
- `packages/cli/src/lib/worktree-isolator.js`
- `packages/cli/src/lib/mcp-client.js`
- `packages/cli/src/lib/plugin-manager.js`
- `packages/cli/src/lib/skill-loader.js`

### Desktop 侧 bridge / adapter

- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js`
- `desktop-app-vue/src/main/mcp/mcp-client-manager.js`
- `desktop-app-vue/src/main/mcp/mcp-ipc.js`
- `desktop-app-vue/src/main/mcp/mcp-tool-adapter.js`
- `desktop-app-vue/src/main/mcp/mcp-security-policy.js`
- `desktop-app-vue/src/main/plugins/plugin-manager.js`
- `desktop-app-vue/src/main/plugins/plugin-loader.js`
- `desktop-app-vue/src/main/plugins/plugin-registry.js`
- `desktop-app-vue/src/main/plugins/plugin-ipc.js`
- `desktop-app-vue/src/main/marketplace/plugin-ecosystem-v2.js`

### Renderer 消费者

- `desktop-app-vue/src/renderer/stores/coding-agent.ts`
- `desktop-app-vue/src/renderer/stores/autonomous-agent.ts`
- `desktop-app-vue/src/renderer/stores/agents.ts`

### 测试 / Parity Harness

- `packages/cli/__tests__/unit/agent-runtime.test.js`
- `packages/cli/__tests__/integration/agent-core-integration.test.js`
- `packages/cli/__tests__/e2e/coding-agent-envelope-roundtrip.test.js`
- `desktop-app-vue/tests/integration/coding-agent-bridge-real-cli.test.js`
- `desktop-app-vue/tests/integration/coding-agent-lifecycle.integration.test.js`

## 完成定义

当满足以下条件时，认为收口完成：

1. `packages/cli` 成为唯一 canonical runtime
2. Desktop 不再维护平行 MCP / plugin / session 真相
3. runtime state 全部具备统一 record / event / JSON 输出
4. `doctor` / `status` 能直接定位运行时问题
5. 关键 agent 行为具备 parity harness 回归能力
