# ADR: CLI Runtime 收口边界冻结

> **状态**: Accepted
> **日期**: 2026-04-09
> **决策者**: ChainlessChain 核心团队
> **相关文档**:
> - 路线图: [cli-runtime-convergence-roadmap.md](../../docs-site/docs/chainlesschain/cli-runtime-convergence-roadmap.md)
> - 设计: [82_CLI_Runtime收口路线图.md](../design/modules/82_CLI_Runtime收口路线图.md)
> - 相关 ADR: [LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md](./LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md)

## 上下文

ChainlessChain 的 coding-agent / MCP / plugin / session / runtime 能力当前分散在三处:

1. **新 runtime 分层** (`packages/cli/src/runtime/`、`gateways/`、`harness/`、`tools/`、`contracts/`) — 路线图认可的 canonical 位置
2. **旧兼容层** (`packages/cli/src/lib/*`) — 仍保留 5000+ 行实体实现,包括 `agent-core.js` (1651)、`ws-session-manager.js` (1421)、`ws-server.js` (760)、`ws-agent-handler.js` (476)、`plugin-manager.js` (430)、`mcp-client.js` (413)
3. **Desktop 主进程** (`desktop-app-vue/src/main/ai-engine/code-agent/`、`desktop-app-vue/src/main/mcp/`、`desktop-app-vue/src/main/plugins/`) — 在部分模块持有 runtime 级逻辑,形成与 CLI 的"平行真相"

2026-04-09 的基线审计确认:

- ✅ Phase 1 完成: `agent/chat/serve/ui` 四个命令入口均经过 `createAgentRuntimeFactory()`
- ✅ Phase 2 部分完成: `src/lib/jsonl-session-store.js` (22 行) 和 `prompt-compressor.js` (10 行) 已经是 re-export shim; `gateways/repl/agent-repl.js` 已是 1 行 re-export
- ⚠️ Phase 6 未开始: 6 个 lib 实体文件仍承载真实逻辑,并且 `gateways/ws/ws-server.js`、`gateways/ws/ws-session-gateway.js` 已经是 re-export 空壳,说明此前的收口工作未完成

**2026-04-09 推进小结(Phase 6b 完成):** 当日已完成 Phase 3–6b 全部反向迁移,6 个历史 lib 实体文件 (`mcp-client.js` 413、`plugin-manager.js` 430、`ws-server.js` 760、`ws-session-manager.js` 1421、`agent-core.js` 1651、`ws-agent-handler.js` 476,共 ~5151 行) 已全部退化为 `@deprecated` re-export shim,canonical 实现落在 `runtime/`、`gateways/ws/`、`harness/`。`doctor --json` / `status --json` 稳定 schema (`chainlesschain.doctor.v1` / `chainlesschain.status.v1`) 已落地,满足 D6。剩余 Phase 7 (parity harness / mock provider / golden transcript) 待启动。

继续不作约束会出现两种风险:

1. 新需求继续进入 `src/lib/*`,导致兼容层越收越厚
2. Desktop 持续在自己的 mcp/plugins 目录新增独立状态管理,让 MCP / plugin 真相永久分叉

## 决策

自本 ADR 生效起,团队在 agent runtime 相关工作上遵循以下边界约束。

### D1. Canonical Runtime 归属

**`packages/cli` 是唯一 canonical agent runtime。**

所有 agent turn 生命周期、session 恢复、event envelope、tool registry、policy / contract / state 模型的**真实实现**只能位于:

- `packages/cli/src/runtime/`
- `packages/cli/src/gateways/`
- `packages/cli/src/harness/`
- `packages/cli/src/tools/`
- `packages/cli/src/runtime/contracts/`

### D2. Desktop 的角色收敛

**`desktop-app-vue` 只做 host / bridge / IPC / UI 消费。**

允许的职责:

- Electron main 作为 host 启动并管理 runtime 生命周期
- bridge / IPC 层翻译 runtime envelope 为 renderer 可消费的事件
- Renderer 作为 event consumer 展示 session / plan / approval / tool 状态
- Host-managed 工具(例如需要 Electron 原生能力的 `computer-use` 类工具)可注册到 runtime tool registry

禁止的职责:

- 在 Desktop 侧新建独立的 session store / prompt compressor / agent loop
- 在 `desktop-app-vue/src/main/mcp/` 维护独立于 CLI 的 MCP connection state / server registry / permission policy
- 在 `desktop-app-vue/src/main/plugins/` 维护独立于 CLI 的 plugin manifest / install state / enable state

### D3. `src/lib/*` 冻结为兼容层

**`packages/cli/src/lib/*` 从本 ADR 生效起只允许兼容层存在。**

具体约束:

- **禁止** 在 `src/lib/*` 新增任何 runtime 级实现
- **禁止** 在现有 `src/lib/*` 实体文件中新增未列入 Phase 6 清理计划的新逻辑
- **允许** 将 `src/lib/*` 文件内部改为 re-export / wrapper,指向 `runtime / gateways / harness / contracts / tools` 下的新实现
- **允许** 在 `src/lib/*` 添加 `@deprecated` 注释和迁移说明
- **推荐** 在 PR 中显式标注"兼容层收缩",使 reviewer 能快速判断是否符合本 ADR

### D4. 新增代码默认目录

新增的 agent runtime 相关代码默认进入以下目录之一:

| 类型 | 目标目录 |
|---|---|
| agent turn 生命周期 / runtime kernel | `packages/cli/src/runtime/` |
| Session 持久化 / prompt 压缩 / worktree 隔离 / 增强能力 | `packages/cli/src/harness/` |
| WS / REPL / IPC bridge / 外部接入协议 | `packages/cli/src/gateways/` |
| 工具 registry / 工具描述符 / 工具实现 | `packages/cli/src/tools/` |
| Session / Task / Worktree / Event 等数据契约 | `packages/cli/src/runtime/contracts/` |
| Desktop UI 消费逻辑 | `desktop-app-vue/src/renderer/stores/` |
| Desktop bridge / IPC / host-managed tool | `desktop-app-vue/src/main/ai-engine/code-agent/` (仅 bridge 职责) |

### D5. MCP 与 Plugin 的单一真相

- **MCP**: CLI runtime 的 MCP 实现为 canonical truth; Desktop 改为 adapter / bridge。server registry、connection state、tool list、resource list、capability cache、permission policy、trusted server policy 只有一份真相(具体收口见 Phase 3)
- **Plugin / Skill**: plugin manifest、install state、enable / disable state、权限元数据、skill exports 只有一份真相(具体收口见 Phase 4)

### D6. 运维面机读优先

`doctor` / `status` / `session` 命令必须优先输出 machine-readable JSON,且字段一经发布即视为公开 API。Desktop 端通过直接消费这些 JSON 获取 runtime health 状态,**不得**通过绕过 CLI 的私有 IPC 通道读取同类状态(具体收口见 Phase 5)。

## 后果

### 积极后果

- **真相唯一**: session / MCP / plugin 状态在 CLI 与 Desktop 之间不再漂移
- **代码可追溯**: 所有新增 runtime 代码都能从目录路径直接判断职责归属
- **测试可落地**: parity harness 可以基于唯一真相建立 deterministic 回归
- **兼容期明确**: 下游消费者有清晰的迁移终点(所有 import 从 `src/lib/*` 指向新目录)
- **运维可观测**: Desktop 直接消费 CLI JSON 输出,不重复实现诊断逻辑

### 负面后果与应对

| 后果 | 应对 |
|---|---|
| 收口过程中跨多个 PR,可能出现临时的双轨状态 | 每个阶段先建 adapter,再删旧实现;targeted integration test 兜主链路 |
| Desktop 部分历史代码依赖 `lib/*` 的 flat shape | 过渡期保留 re-export shim,bridge 层做 envelope / legacy shape 双向转换 |
| CI 需要新增路径白名单检查阻止 `src/lib/*` 新增 | 推荐但不强制,先通过 PR review 执行;若违反频率高再落地 CI 检查 |
| 团队在边界不清时可能犹豫新代码该放哪 | 本 ADR 的 D4 表格即为默认选择;有歧义时向 canonical runtime 倾斜 |

### 中性后果

- 设计文档与代码落差缩小,但需要每个阶段结束同步更新路线图
- `src/lib/*` 的行数会先收缩到 re-export 层,最终删除;短期内 lib 目录仍会继续存在

## 不在本 ADR 范围内

- 本 ADR **不**决定具体迁移顺序(见路线图 Phase 1–7)
- 本 ADR **不**决定 MCP canonical contract 的具体字段(见 Phase 3A)
- 本 ADR **不**决定 parity harness 的 mock provider 实现(见 Phase 7)
- 本 ADR **不**引入新的 agent kernel 包

## 生效方式

- 本 ADR 一经合并即对所有后续 agent runtime 相关 PR 生效
- 已经在评审中的 PR 不追溯,但 reviewer 应在合并前要求作者确认新增代码符合 D4
- 本 ADR 的任何松动都需要明确的后续 ADR 覆盖,不得通过个别 PR 静默变更边界

## 参考

- [CLI Runtime 收口路线图](../../docs-site/docs/chainlesschain/cli-runtime-convergence-roadmap.md)
- [78. CLI Agent Runtime 重构实施计划](../design/modules/78_CLI_Agent_Runtime重构实施计划.md)
- [79. Coding Agent 系统](../design/modules/79_Coding_Agent系统.md)
- [82. CLI Runtime 收口路线图](../design/modules/82_CLI_Runtime收口路线图.md)
