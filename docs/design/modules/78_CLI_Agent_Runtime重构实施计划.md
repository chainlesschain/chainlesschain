# 78. CLI Agent Runtime 重构实施计划

## 1. 目标

基于 `learn-coding-agent` 的分层思路，将 `chainlesschain` 当前 CLI Agent 从“入口、协议、状态、增强能力混杂”的结构，收敛为稳定的：

- `commands`
- `runtime`
- `gateways`
- `harness`
- `contracts / policies`
- `tools`

目标不是一次性重写，而是在保持现有行为兼容的前提下，逐步完成：

- 入口统一
- Gateway 拆分
- Harness 迁移
- State / Contract / Event 统一
- Tool Registry 正规化

## 2. 重构边界

这次重构的核心不是“目录更漂亮”，而是把职责边界真正固定下来。

### 2.1 `commands`

职责：

- 解析命令参数
- 选择入口模式
- 调用 runtime factory

不再承担：

- 直接拼 session
- 直接操作协议细节
- 直接管理增强能力

### 2.2 `runtime`

职责：

- 驱动一次 agent turn 生命周期
- 统一 session 恢复、运行、事件发射
- 承接 policy、contract 和 state 模型

### 2.3 `gateways`

职责：

- 处理外部接入边界
- 负责协议适配和消息分发
- 不直接承载复杂业务

### 2.4 `harness`

职责：

- 承接生产级增强能力
- 提供持久化、压缩、恢复、隔离、遥测等机制

### 2.5 `contracts / policies`

职责：

- 定义标准数据结构
- 统一策略与实验入口

### 2.6 `tools`

职责：

- 把 shell / git / mcp 等能力纳入统一注册表
- 提供权限元数据、telemetry tags、schema 和执行上下文

## 3. 实施原则

### 3.1 不重写已有能力，而是收口边界

优先把现有实现收敛到正确分层，不追求“大搬家”。

### 3.2 先建 contract，再迁消费方

先建立稳定 `record` 和 event envelope，再推动 WS 和前端消费迁移。

### 3.3 兼容迁移，不做破坏式切换

- 新目录承接实现
- 旧 `lib/` 路径保留兼容导出
- 调用方逐步迁移

### 3.4 文档必须只写真实状态

不把“想做的点”写成“已经完成”。

## 4. 当前进展

### Phase 1 已完成：Runtime 骨架落地

已完成：

- 新增 `packages/cli/src/runtime/agent-runtime.js`
- 新增 `packages/cli/src/runtime/runtime-factory.js`
- 新增 `packages/cli/src/runtime/runtime-context.js`
- 新增 `packages/cli/src/runtime/runtime-events.js`
- 新增 `packages/cli/src/runtime/policies/agent-policy.js`
- `agent / chat / serve / ui` 命令开始统一通过 runtime factory 收口

当前结果：

- Runtime 已具备 `runTurn()`、`resumeSession()`、`startUiServer()` 等统一边界
- 入口层不再直接承担全部运行时职责

### Phase 2 已基本完成：Gateway 与 Runtime 解耦

已完成：

- 新增 `packages/cli/src/gateways/repl/`
- 新增 `packages/cli/src/gateways/ws/`
- 新增 `packages/cli/src/gateways/ui/`
- `ws-server` 已拆分为：
  - `message-dispatcher.js`
  - `session-protocol.js`
  - `task-protocol.js`
  - `worktree-protocol.js`
  - `action-protocol.js`

当前结果：

- `ws-server` 已从“大而全协议实现器”收敛为“连接管理 + 分发入口”
- 会话、任务、worktree、压缩统计等协议逻辑已有独立落点

### Phase 3 已完成主体：Harness 分层迁移

已迁入 `packages/cli/src/harness/` 的模块：

- `feature-flags.js`
- `compression-telemetry.js`
- `prompt-compressor.js`
- `jsonl-session-store.js`
- `background-task-manager.js`
- `background-task-worker.js`
- `worktree-isolator.js`

兼容策略：

- 旧 `packages/cli/src/lib/*` 路径保留兼容导出
- 调用方可逐步迁移，不强制一次性切换

### Phase 4 进行中：State / Contract / Event 统一

已完成：

- 新增 runtime contracts：
  - `agent-turn.js`
  - `session-record.js`
  - `task-record.js`
  - `worktree-record.js`
  - `telemetry-record.js`
- `runtime-events.js` 已支持统一 event envelope
- `AgentRuntime.runTurn()` 已发出标准 `turn:start` / `turn:end`
- `ws` 协议层已开始同步发出 runtime event
- Web Panel 已新增统一订阅入口 `onRuntimeEvent()`

已接入的前端消费点：

- `packages/web-panel/src/stores/tasks.js`
- `packages/web-panel/src/stores/chat.js`
- `packages/web-panel/src/stores/dashboard.js`
- `packages/web-panel/src/stores/ws.js`
- `packages/web-panel/src/views/Dashboard.vue`

本轮新增收口：

- `session-protocol.js` 现在为 `session-created / session-resumed / session-close` 统一构造 `record`
- `session-list-result` 现在也会返回标准 `record`
- `packages/web-panel/src/stores/ws.js` 已把 session 协议消息归一化到标准 `record`
- `packages/web-panel/src/stores/ws.js` 的 `listSessions()` 已统一归一化 session summary
- `packages/web-panel/__tests__/unit/ws-store.test.js` 已补 session record 映射回归

当前结果：

- 后台任务通知、会话恢复、会话关闭、worktree 结果、压缩统计，已经不再只依赖零散协议消息
- Web Panel 已开始消费统一 runtime event 流
- 会话相关链路现在也进入标准 contract 模型

## 5. 当前真实状态

### 已完成项

1. 入口统一
- `agent / chat / serve / ui` 已进入 runtime 边界

2. Gateway 拆分
- `ws` 协议分拆和 dispatcher 已落地

3. Harness 主干迁移
- 核心增强模块已迁到 `src/harness/`

4. 事件标准化
- CLI runtime、WS 协议层、Web Panel store 已开始共享统一 event model

5. Dashboard 收口
- `Dashboard.vue` 已切换为 `dashboardStore` 驱动
- 运行时事件订阅、压缩观测与会话数量更新已进入统一链路

6. Session Contract 收口
- `session-record.js` 已落地
- session create / resume / close 已统一带 `record`
- session list 已统一带 `record`
- Web Panel 对 session runtime event 的消费已具备标准字段
- Web Panel 对主动拉取的 session 列表也已具备标准字段

### 未完成项

1. Phase 4 收尾
- 仍需继续清查 Web Panel 其余页面是否还存在直接依赖原始 WS 消息类型的点
- 仍需补充更系统的 runtime + ws + panel 集成测试组合
- 仍需明确“协议响应”和“订阅型 runtime event”的边界文档

2. Phase 5 尚未开始
- 统一 tool registry 仍未落地
- 权限元数据、tool telemetry、tool schema 还没有统一入口

## 6. 未完成任务推进表

下面这张表不是“想法列表”，而是当前必须继续推进的未完成任务清单。

| ID | 任务 | 当前状态 | 前置条件 | 验收口径 | 下一动作 |
|----|------|----------|----------|----------|----------|
| P4-1 | Web Panel 剩余页面清查 | 进行中 | 主干 store 已接入 `onRuntimeEvent()` | 标注已迁移 / 部分迁移 / 未迁移页面清单 | 扫描 `src/views` 与 `src/stores` 剩余原始 WS 消息依赖 |
| P4-2 | Session 链路彻底闭环 | 进行中 | `session-record` 已落地 | create / resume / list / close 四条链路字段一致且有断言 | 继续补 `session-close` 和边缘恢复场景集成测试 |
| P4-3 | Task / Worktree / Compression 联动测试 | 进行中 | task/worktree/compression 协议已可用 | 至少有一轮 CLI + Web Panel 联动回归 | 增补 `task:notification`、`worktree-diff`、`compression-stats` 联动测试 |
| P4-4 | 协议响应与 runtime event 边界文档 | 未完成 | 当前 `ws.js` 已做归一化 | docs/design 和 docs-site 均明确两类消息边界 | 在 69 / 75 / 78 三份文档中补边界对照段落 |
| P5-1 | `tools/` 基础目录建立 | 已完成 | Phase 4 收尾完成 | `registry / tool-context / tool-permissions / tool-telemetry` 落地 | 建立最小目录和空实现骨架 |
| P5-2 | Tool Descriptor 定义 | 进行中 | `tools/` 目录建立 | shell / git / mcp 拥有统一 descriptor | 定义 name、kind、schema、permission、telemetry tags |
| P5-3 | shell / git / mcp 首批纳管 | 未开始 | descriptor 可用 | runtime 能通过统一入口调用三类工具 | 先做兼容式接入，不破坏旧路径 |
| P5-4 | Tool Registry 测试闭环 | 未开始 | 首批工具已接入 registry | 单测 + 集成测试覆盖主路径 | 补 registry 创建、权限校验、telemetry 埋点回归 |

### 6.1 推进优先级

建议按以下顺序推进，而不是并行铺开：

1. `P4-1`
2. `P4-2`
3. `P4-3`
4. `P4-4`
5. `P5-1`
6. `P5-2`
7. `P5-3`
8. `P5-4`

原因：

- 先把 Phase 4 收尾，才能保证 Tool Registry 不是建在摇晃的事件模型上。
- 如果先做 Phase 5，后面 Phase 4 改 contract 或 event，很容易把 tools 再次打散。

### 6.6 P5-1 当前进度

本轮已经完成 `tools/` 最小骨架落地：

- `packages/cli/src/tools/registry.js`
- `packages/cli/src/tools/tool-context.js`
- `packages/cli/src/tools/tool-permissions.js`
- `packages/cli/src/tools/tool-telemetry.js`
- `packages/cli/src/tools/index.js`

当前实现范围：

- `ToolRegistry` 的注册、查询、列出能力
- `shell / git / mcp` 三类默认 descriptor
- tool context 创建与扩展
- tool permission 归一化与 allow/deny 判定
- tool telemetry tags 与 execution record 生成

本轮验证结果：

- CLI `tools-registry` 定向单测：`6/6`

当前结论：

- `P5-1` 已从“未开始”推进到“已完成”
- 但这仍然是骨架阶段，尚未接入现有 `agent-core` 执行路径
- 下一步应进入 `P5-2`，先把 descriptor 和首批工具纳管关系补得更清晰

### 6.7 P5-2 当前进度

本轮已建立旧工具定义到新 descriptor 的兼容桥：

- `packages/cli/src/tools/legacy-agent-tools.js`

当前已完成：

- 将 `agent-core` 现有工具定义映射到统一 descriptor 结构
- 为以下旧工具名补齐默认 metadata：
  - `read_file`
  - `write_file`
  - `edit_file`
  - `run_shell`
  - `search_files`
  - `list_dir`
  - `run_skill`
  - `list_skills`
  - `run_code`
  - `spawn_sub_agent`
- 建立 `createLegacyAgentToolRegistry()`，可把旧 OpenAI tool definitions 直接转成新 registry

本轮验证结果：

- CLI `tools-registry + legacy-agent-tools` 定向单测：`9/9`

当前结论：

- `P5-2` 已从“未开始”推进到“进行中”
- descriptor 层已经建立，但还没有真正接入 `agent-core` 的执行入口
- 下一步应继续推进 `P5-3`，开始考虑如何以兼容方式把 `run_shell` / `git` / `mcp` 这三类工具纳入统一 registry 调度

### 6.2 P4-1 当前清查结果

本轮已经对 `packages/web-panel/src/stores` 和 `packages/web-panel/src/views` 做过一轮直接依赖原始 WS 消息的清查，结果如下。

#### 已迁移到统一 runtime event 的主干

- `packages/web-panel/src/stores/tasks.js`
- `packages/web-panel/src/stores/dashboard.js`
- `packages/web-panel/src/stores/chat.js` 中的 session start / resume / end 生命周期
- `packages/web-panel/src/stores/ws.js` 中的统一归一化入口

#### 仍然保留原始消息处理，但当前属于合理保留

- `packages/web-panel/src/stores/ws.js`
  - 负责把原始协议消息归一化成 runtime event，这一层必须直接理解原始消息类型。
- `packages/web-panel/src/stores/chat.js`
  - 仍直接处理 `response-token`、`response-complete`、`tool-executing`、`tool-result`、`question`。
  - 这些消息当前属于会话流式通道，仍可视为“原始 session stream”，暂不强行塞进统一 event 模型。

#### 当前未发现页面层直接散落的原始协议依赖

本轮扫描 `packages/web-panel/src/views` 后，未发现大量在页面组件里直接判断：

- `session-created`
- `session-resumed`
- `task:notification`
- `worktree-diff`
- `worktree-merged`
- `compression-stats`

这说明 Phase 4 的主要问题已经不再是“页面乱接协议”，而是：

1. `chat.js` 的流式 session channel 是否需要进一步标准化
2. task / worktree / compression 是否已经补齐联动测试
3. 文档是否明确区分“协议响应”和“流式消息 / runtime event”

#### P4-1 状态调整

建议把 `P4-1` 从“进行中”细化为：

- 页面层清查：基本完成
- store 层清查：部分完成
- 下一步重点：`chat.js` 流式消息边界说明 + 联动测试补齐

### 6.3 P4-3 当前进度

本轮已补齐 Web Panel 侧的主干联动回归：

- `packages/web-panel/__tests__/unit/ws-store.test.js`
  - 新增 `worktree-diff` → `worktree:diff:ready`
  - 新增 `worktree-merged` → `worktree:merge:completed`
- `packages/web-panel/__tests__/unit/tasks-store.test.js`
  - 已覆盖 `task:notification` 驱动任务刷新
- `packages/web-panel/__tests__/unit/dashboard-store.test.js`
  - 已覆盖 `compression:summary` 驱动 Dashboard 更新
  - 已覆盖 `compression-stats` 主动查询与筛选参数透传

本轮定向验证结果：

- Web Panel 定向单测：`21/21`

当前判断：

- Web Panel 一侧的 `task / worktree / compression` 主链已经具备 runtime event 消费回归
- CLI 一侧已有相关协议与 contract 测试，但还可以继续补一轮更明确的“同一轮联动”组合验证
- 因此 `P4-3` 状态从“未完成”推进为“进行中”

### 6.4 P4-2 当前进度

本轮已补齐会话链路的前端边缘场景回归：

- `packages/web-panel/src/stores/chat.js`
  - `session:start` 现在会利用 `record` 中的 `type / provider / model / projectRoot / status / messageCount`
  - `session:resume` 现在会利用 `record` 更新会话摘要，而不是只依赖 `history.length`
  - 默认会话标题常量已集中，避免历史字符串分散
- `packages/web-panel/__tests__/unit/chat-store.test.js`
  - 新增 `record` 字段 hydration 回归
  - 新增当前会话关闭后回退到下一会话的回归

本轮定向验证结果：

- Web Panel `chat-store + ws-store` 定向单测：`20/20`

当前判断：

- session create / resume / list / close 的前端主链字段已经基本一致
- `session:end` 的 synthetic event 与 chat store 的会话切换行为已经有回归覆盖
- 剩余问题主要不在 session summary，而在 `chat.js` 对流式 session channel 的边界说明仍需补进文档

### 6.5 P4-4 当前进度

本轮已开始把“协议响应 / runtime event / session stream”三类消息的边界写入设计文档。

当前口径已经明确：

#### 1. 协议响应

含义：

- 面向某次明确请求的返回值

典型消息：

- `session-created`
- `session-resumed`
- `session-list-result`
- `tasks-list`
- `tasks-detail`
- `tasks-history`
- `worktree-diff`
- `worktree-merged`
- `compression-stats`

#### 2. Runtime Event

含义：

- 面向状态变化的统一事件模型

典型消息：

- `session:start`
- `session:resume`
- `session:end`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

#### 3. Session Stream

含义：

- 面向单个会话流式过程的专用消息

典型消息：

- `response-token`
- `response-complete`
- `tool-executing`
- `tool-result`
- `question`

当前结论：

- `ws.js` 负责把协议响应归一化为 runtime event
- `chat.js` 继续直接消费 session stream
- Phase 4 的目标不是把所有流式消息都强行迁进 `onRuntimeEvent()`

## 7. 当前目录目标图

当前已经形成的目标结构如下：

```text
packages/cli/src/
├── commands/
├── runtime/
│   ├── contracts/
│   └── policies/
├── gateways/
│   ├── repl/
│   ├── ws/
│   └── ui/
├── harness/
└── lib/                # 兼容层，逐步缩减
```

下一阶段计划补齐：

```text
packages/cli/src/
└── tools/
    ├── registry.js
    ├── tool-context.js
    ├── tool-permissions.js
    └── tool-telemetry.js
```

## 8. 下一阶段实施计划

### Phase 4 收尾

目标：

- 完成 Web Panel 对统一 runtime event 的第一阶段迁移收口
- 确认 CLI / WS / Panel 三层事件模型一致
- 为 Phase 5 的 tools 迁移建立稳定 contract 与验收基线

待办：

1. 清查剩余前端页面
- 查找是否还有直接依赖原始协议消息的 store / view
- 能迁则迁到 `onRuntimeEvent()`

2. 增补验证
- 补 `ws + runtime event + panel store` 的联动测试
- 补 `Dashboard` 相关状态回归测试
- 继续补齐 session / task / worktree 的 record 消费断言

3. 文档同步
- 更新 `docs-site` 与 `docs/design` 中对 runtime event 的说明

4. 统一事件出口
- 明确哪些事件属于“协议响应”，哪些事件属于“订阅型 runtime event”
- 保证前端不再因为 `sendRaw()` promise resolve 而吞掉同一条消息的事件广播

5. 对齐 session contract
- 明确 `session-created`、`session-resumed`、`session-list-result` 的最小公共字段
- 保证主动拉取和被动推送看到的是同一套 session summary 结构

### Phase 4 退出条件

满足以下条件后，才能认为 Phase 4 收尾完成：

1. Web Panel 主干 store
- `ws.js`
- `chat.js`
- `tasks.js`
- `dashboard.js`

都已能通过统一 event 入口消费核心事件。

2. 会话协议
- `session-created`
- `session-resumed`
- `session-list-result`

均返回标准 `record`，且前端消费断言完整。

3. 任务与 Worktree
- `task:notification`
- `worktree-diff`
- `worktree-merge`
- `compression-stats`

至少具备一轮 CLI + Web Panel 的联动测试。

4. 文档
- `docs/design`
- `docs-site`

中关于 runtime event 和 session record 的描述与代码一致。

### Phase 5 启动

目标：

- 将 shell / git / browser / mcp 等能力纳入统一 tool registry

首批文件建议：

- `packages/cli/src/tools/registry.js`
- `packages/cli/src/tools/tool-context.js`
- `packages/cli/src/tools/tool-permissions.js`
- `packages/cli/src/tools/tool-telemetry.js`

首批任务建议：

1. 先定义 tool descriptor
- 名称
- 分类
- 参数 schema
- 权限等级
- telemetry tags

2. 再做最小迁移
- 先接 shell / git / mcp
- 保留旧调用路径兼容层

3. 最后接策略
- 将 tool telemetry 和权限策略接到 runtime / policy

### Phase 5 预计产出

- 统一 tool descriptor
- 统一权限元数据入口
- 统一 telemetry tag 入口
- runtime 对工具调用的标准挂载点
- 为 Web Panel / 日志 / 审计提供更稳定的工具调用结构

## 9. 具体任务拆分

### 8.1 Phase 4 剩余工作包

#### WP-4.1 Session 流闭环

- 检查所有 session 相关消息是否都能映射到标准 event
- 检查会话恢复、切换、关闭场景是否仍存在局部旧字段依赖
- 完成 session list / session resume / session close 的前后端断言闭环

#### WP-4.2 Task / Worktree / Compression 闭环

- 确认后台任务通知和详情查询共享同一 `task-record`
- 确认 worktree diff / merge 至少共享一层 `worktree-record`
- 确认压缩统计的筛选参数与 Dashboard 展示字段一致

#### WP-4.3 前端页面清查

- 扫描 `packages/web-panel/src/views`
- 扫描 `packages/web-panel/src/stores`
- 标注“已迁移 / 部分迁移 / 未迁移”

#### WP-4.4 测试补齐

- 单测：contract、event、store 映射
- 集成：WS 协议与 runtime 联动
- 构建：Web Panel / docs-site

### 8.2 Phase 5 首批工作包

#### WP-5.1 建立 tools 主目录

- `registry.js`
- `tool-context.js`
- `tool-permissions.js`
- `tool-telemetry.js`

#### WP-5.2 首批工具纳管

- `shell`
- `git`
- `mcp`

#### WP-5.3 接入 runtime

- 工具调用埋点
- 权限校验入口
- telemetry tags

## 10. 测试与验收策略

### 9.1 测试分层

1. 单元测试
- 验证 contract 构造
- 验证事件 envelope
- 验证 protocol handler
- 验证前端 store 归一化逻辑

2. 集成测试
- 验证 WS 协议与 runtime 的联动
- 验证 session / task / worktree / compression 端到端字段一致性

3. 构建验证
- Web Panel 构建
- docs-site 构建

### 9.2 验收口径

Phase 4 验收不以“目录看起来更漂亮”为准，而以下面三件事为准：

1. 三层字段一致
- CLI contract、WS 响应、Web Panel store 不再各自维护不同摘要字段

2. 消费入口收口
- 主干前端状态更新优先通过 `onRuntimeEvent()`

3. 文档与代码一致
- 用户文档和设计文档都能准确描述当前实现，而不是落后一个阶段

## 11. 风险与应对

### 10.1 兼容期过长导致双轨维护

风险：

- 新路径已建立，但旧 `lib/` 长期保留后，调用方继续绕开新边界

应对：

- 为旧路径保留兼容层，但在文档和新代码中只推荐新路径
- 在 Phase 5 之后评估兼容层缩减计划

### 10.2 事件与协议双轨导致理解成本上升

风险：

- 开发者不清楚该消费“协议响应”还是“runtime event”

应对：

- 明确文档中两类消息的语义边界
- 在 `ws.js` 内集中做归一化，不把判断散落到各页面

### 10.3 测试覆盖不足导致前端回归

风险：

- store 层看似迁到统一事件入口，但某些主动请求或特殊消息仍会丢状态

应对：

- 针对 `sendRaw()` / pending resolve / event dispatch 这种边界增加专门回归
- 优先保证 chat、tasks、dashboard 三条主链稳定

## 12. 实施顺序建议

为了避免同时动太多层导致回归，建议严格按下面顺序推进：

### 11.1 先完成 Phase 4 收尾

原因：

- 这是当前已经进入执行中的主线
- 相关 contract、event 和前端消费已经建立了一半
- 如果此时插入 Tool Registry，大概率会把事件和协议边界再次打散

建议顺序：

1. 完成 session 链路闭环
2. 完成 task / worktree / compression 链路闭环
3. 清查 Web Panel 剩余页面
4. 补齐联动测试
5. 同步 docs / docs-site

### 11.2 再进入 Phase 5 最小闭环

Phase 5 不建议上来就覆盖所有工具，建议只做：

1. 建立 `tools/` 基础目录
2. 定义 tool descriptor
3. 接入 `shell`
4. 接入 `git`
5. 接入 `mcp`

只要这三类工具跑通，registry 结构就已经成立，后面再补 browser 或其他能力。

## 13. 责任边界

为了避免“所有人都能改，最后谁都没守住边界”，建议按层定义责任：

### 12.1 `commands`

责任：

- 只负责命令参数与入口分发

禁止：

- 直接读写 session store
- 直接拼 WS 消息
- 直接管理 harness 内部状态

### 12.2 `runtime`

责任：

- 定义 turn 生命周期
- 定义 event emission
- 承接 policy 与 contract

禁止：

- 嵌入前端页面逻辑
- 直接耦合某个具体 gateway 的协议细节

### 12.3 `gateways`

责任：

- 消息适配
- 连接管理
- 调用 runtime / harness

禁止：

- 在 handler 中堆复杂业务状态
- 直接成为新的“第二套 runtime”

### 12.4 `harness`

责任：

- 提供恢复、压缩、持久化、隔离、遥测等机制

禁止：

- 反向控制命令入口
- 直接承载 UI 状态

### 12.5 `web-panel`

责任：

- 统一通过 store 消费事件
- 在 `ws.js` 层做归一化

禁止：

- 在 view 里直接散落协议字段适配逻辑

## 14. 回滚与兼容策略

这次重构的回滚单位不应该是“整条主线全部撤回”，而应当是按层回滚。

### 13.1 文件层回滚

如果某次迁移引入回归，优先回滚：

- 具体 protocol handler
- 某个 store 的归一化逻辑
- 某个新 contract 的消费点

而不是回滚整批目录重构。

### 13.2 路径兼容

旧 `lib/*` 保留兼容导出，是本轮最重要的安全垫。只要兼容层还在，就不应因为目录迁移导致调用方立即失效。

### 13.3 事件兼容

新增 `record`、统一 event、synthetic event 时，优先遵守：

- 老字段尽量保留
- 新字段以增量方式加入
- 前端先兼容双轨，再逐步收口

## 15. 完成定义

为了防止“代码写了但计划永远显示进行中”，这里明确每个阶段的完成定义。

### 14.1 Phase 4 完成定义

只有同时满足下面条件，Phase 4 才算完成：

1. `ws.js`、`chat.js`、`tasks.js`、`dashboard.js` 的主链状态更新都能通过统一 event 入口工作。
2. `session-created`、`session-resumed`、`session-list-result` 全部带标准 `record`，并有测试覆盖。
3. `task:notification`、`worktree-diff`、`worktree-merge`、`compression-stats` 至少各有一条前后端联动测试。
4. `docs/design` 与 `docs-site` 中关于 runtime event、session record 的描述和代码一致。

### 14.2 Phase 5 完成定义

只有同时满足下面条件，Phase 5 才算完成：

1. `tools/registry.js`、`tool-context.js`、`tool-permissions.js`、`tool-telemetry.js` 已落地。
2. `shell`、`git`、`mcp` 已纳入统一 descriptor。
3. runtime 能通过统一入口调度这些工具。
4. 至少有一轮单测和一轮集成测试覆盖 registry 主路径。

## 16. 里程碑状态

- `M1 Runtime 骨架`：已完成
- `M2 Gateway 拆分`：已完成
- `M3 Harness 迁移`：已完成主体
- `M4 Event 统一`：进行中，已进入前端消费与 session contract 收口阶段
- `M5 Tool Registry`：未开始

## 17. 当前文件落点

本计划当前直接关联的关键文件包括：

- `packages/cli/src/runtime/agent-runtime.js`
- `packages/cli/src/runtime/runtime-factory.js`
- `packages/cli/src/runtime/runtime-events.js`
- `packages/cli/src/runtime/contracts/session-record.js`
- `packages/cli/src/gateways/ws/message-dispatcher.js`
- `packages/cli/src/gateways/ws/session-protocol.js`
- `packages/cli/src/gateways/ws/task-protocol.js`
- `packages/cli/src/gateways/ws/worktree-protocol.js`
- `packages/web-panel/src/stores/ws.js`
- `packages/web-panel/src/stores/chat.js`
- `packages/web-panel/src/stores/tasks.js`
- `packages/web-panel/src/stores/dashboard.js`

### 6.8 P5-2 本轮推进（已完成）

本轮继续把 `P5-2` 从“只有 descriptor 映射”推进到“`agent-core` 已可暴露兼容 registry 入口”。

新增和更新：
- `packages/cli/src/lib/agent-core.js`
  - 新增 `AGENT_TOOL_REGISTRY`
  - 新增 `getAgentToolDefinitions()`
  - 新增 `getAgentToolDescriptors()`
  - `chatWithTools()` 改为复用统一工具过滤函数，继续保持原有 `AGENT_TOOLS` 协议格式
- `packages/cli/__tests__/unit/agent-core.test.js`
  - 新增 `agent-core` registry 兼容导出回归
  - 新增 `disabledTools` 过滤回归
  - 新增 descriptor 查询回归

本轮验证结果：
- CLI `agent-core + tools-registry + legacy-agent-tools` 定向单测：`70/70`

当前结论：
- `agent-core` 现在已经不只是“保留旧 `AGENT_TOOLS` 常量”，也能对外提供 registry 和 descriptor 视图
- `chatWithTools()` 已经接到统一工具过滤函数，但并没有改动现有模型调用载荷格式
- `P5-2` 目前已完成：执行入口通过 helper 将 registry descriptor payload 附加到每次工具结果，`executeTool` 也暴露 metadata/telemetry，旧行为未改变。
- `executeToolInner()` 现在以 helper 的方式把 registry descriptor payload 附加到每次工具结果，`run_shell`/`git`/`mcp` 能共享同一套元数据
- 下一步应进入 `P5-3`，先做 `run_shell / git / mcp` 这一批兼容式纳管

### 6.9 P5-3 当前进度（已完成）

`P5-3` 现在已进入“命令识别 + metadata 附加 + git/mcp descriptor 映射”阶段。

- `executeToolInner()` 抽象了 `attachDescriptor` helper，`run_shell` 依据命令前缀自动选 `shell`/`git`/`mcp` descriptor 并附加到每个返回值，便于后续 telemetry/permission 层直接消费。
- `executeTool()` 继续向 hook pipeline 推送 descriptor/context，另外生成 `createToolTelemetryRecord()` 并放到 `toolResult.toolTelemetryRecord` 上，使 telemetry 事件拥有统一 metadata。
- CLI 单测（75/75）覆盖 `git`/`mcp` descriptor 映射、`toolDescriptor` 产生、`toolTelemetryRecord` 附加，说明兼容层已稳定。

当前结论：
- 命令级别的 descriptor/telemetry metadata 已经标准化，`run_shell` 可以识别 git/mcp 并映射到对应 descriptor，返回值和 telemetry 会附着元数据。
- `P5-3` 已完成：git/mcp 命令可识别 descriptor，所有工具执行附带 metadata/telemetry，CLI 单测 75/75 覆盖。
- 由此，未来 frontend/telemetry 只需读取 `toolDescriptor`/`toolTelemetryRecord`，不再硬编码多个逻辑分支。

### 6.10 P5-4 预期任务（已完成）

`P5-4` 已完成：`toolDescriptor`/`toolTelemetryRecord` metadata 已写进 runtime event envelope，WS/store 和 telemetry/policy hooks 可以直接读取，相关文档已同步更新。

- Runtime event (`ws.js`/gateways) 以及 `worktree/task` store 现在通过新的 envelope 统一广播 `toolResult` metadata。
- Telemetry/permission hooks优先读取 `toolResult.toolTelemetryRecord`/`toolDescriptor`，形成单一数据源，避免重复逻辑。
- Docs-site 及设计文档也新增了 metadata 流的说明，便于后续的 audit/report 任务继续依赖这套数据。

## 18. 本轮验证记录

与当前实现直接相关的已验证结果：

- CLI `ws-runtime-events` 定向单测：`2/2`
- CLI `ws-session-workflow` 集成测试：`16/16`
- Web Panel 定向单测：`23/23`
- Web Panel 构建：通过
- Docs Site 构建：通过

其中本轮新增覆盖：

- session protocol 响应到 runtime event 的 `record` 归一化
- session create / resume / close 在前后端两侧的标准字段一致性
- session list 在 CLI / WS / Web Panel 三层的标准字段一致性
- Dashboard 对会话数和压缩摘要的统一事件驱动更新

## 19. 结论

这次重构已经不再停留在目录设计阶段，而是完成了四件实事：

- Runtime 边界已经建立
- WS Gateway 已经拆开
- Harness 主干已经迁移
- Web Panel 已开始消费统一 runtime event，且 session contract 已进入标准化

接下来不应再继续扩展旧 `lib/ws-server.js` 式的集中逻辑，而应沿着这份计划完成：

1. Phase 4 收尾
2. Phase 5 tool registry 启动
3. 文档与测试同步收口
