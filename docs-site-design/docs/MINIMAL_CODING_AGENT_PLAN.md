# Minimal Coding Agent 实施计划

**项目**: ChainlessChain  
**目标模块**: `desktop-app-vue` + `packages/cli`  
**文档日期**: 2026-04-06  
**状态**: Draft / Ready for Implementation

## 1. 目标

在当前仓库内落地一个最小可用的 coding agent，实现下面这条闭环：

1. 用户在桌面端输入编码任务
2. agent 进入多轮对话式循环，而不是单次 `generate/review`
3. agent 可以读文件、搜代码、生成计划、编辑文件、执行受控命令
4. 高风险动作必须经过权限门禁和 plan mode
5. 结果以流式事件返回到桌面端界面

本计划遵循 learn-coding-agent 的思路：先做最小 agent loop，再逐层补上权限、上下文压缩、会话、MCP、隔离等 harness。

## 2. 范围

### In Scope

- 在桌面端提供一个最小 coding agent 会话服务
- 复用 `packages/cli` 现有 agent runtime 和 harness 能力
- 接入最少 6 类工具：
  - `read_file`
  - `search_files`
  - `list_dir`
  - `edit_file`
  - `write_file`
  - `run_shell`
- 接入桌面端现有 `plan-mode`、`toolManager`、`mcp`、`sessionManager`
- 提供最小 IPC 协议给 renderer
- 补单元测试和一条集成验证链路

### Out of Scope

- 不在第一阶段支持完整多代理 swarm
- 不在第一阶段支持 GUI 自动化 / computer use
- 不在第一阶段重构整个 `aiEngineManager`
- 不在第一阶段把所有 skill/tool 全量迁移到 agent core

## 3. 当前仓库可复用资产

### CLI 侧

- `packages/cli/src/repl/agent-repl.js`
  - 已有 agent session、plan mode、autonomous、slash commands、streaming 输出
- `packages/cli/src/runtime/agent-runtime.js`
  - 已有 runtime 抽象，可启动 agent/chat/server/ui
- `packages/cli/src/tools/registry.js`
  - 已有工具描述、权限级别、telemetry 分类
- `packages/cli/src/harness/prompt-compressor.js`
  - 已有上下文压缩策略
- `packages/cli/src/harness/worktree-isolator.js`
  - 已有 worktree 隔离能力

### Desktop 侧

- `desktop-app-vue/src/main/index-optimized.js`
  - 已集中持有 `llmManager`、`promptCompressor`、`sessionManager`、`toolManager`、`mcpManager`
- `desktop-app-vue/src/main/ai-engine/ai-engine-ipc.js`
  - 已有 AI 主进程 IPC 通道
- `desktop-app-vue/src/main/skill-tool-system/skill-tool-ipc.js`
  - 已有工具与技能查询 / 调试入口
- `desktop-app-vue/src/main/ai-engine/plan-mode/index.js`
  - 已有工具分类与阻断逻辑
- `desktop-app-vue/src/main/mcp/`
  - 已有 MCP POC、adapter、安全策略设计
- `desktop-app-vue/src/main/ai-engine/code-agent/code-agent-ipc.js`
  - 已有单次式 code generation/review IPC，可降级为 agent 的子能力

## 4. 核心架构决策

## 推荐方案

MVP 不直接在 Electron 主进程内 `require()` 或 `import()` CLI agent 内核源码，而是优先采用**进程边界复用**：

```text
Renderer
  -> Electron IPC
  -> CodingAgentSessionService (Desktop Main)
  -> Local Agent Bridge
     -> packages/cli runtime
  -> Tool Adapter / Permission Gate / Event Stream
```

### 为什么这样做

1. `packages/cli` 当前是 ESM 包，`desktop-app-vue` 主进程目前以 CommonJS `require()` 为主，直接内嵌会产生模块边界复杂度。
2. CLI 已经有成熟的 session/runtime/serve/ui 入口，优先复用运行时比复制代码更稳。
3. 先走进程边界，可把 desktop host 和 agent kernel 解耦，后续再抽 `packages/agent-kernel`。

### 不推荐的 MVP 方案

- 继续把 `desktop-app-vue/src/main/ai-engine/ai-engine-manager*.js` 扩成“大一统 agent 控制器”
- 继续把 `code-agent-ipc.js` 从单次 RPC 强行演变成多轮 agent loop
- 在第一阶段同时做桌面端和 CLI 两套独立 agent 实现

## 5. 目标目录与文件规划

### 新增文件

- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js`
  - agent 会话生命周期
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js`
  - 桌面端与 CLI runtime 的桥接层
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-tool-adapter.js`
  - 将桌面端 tool/mcp/skill 能力适配到 agent 使用协议
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-permission-gate.js`
  - 统一权限裁决
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-events.js`
  - 流式事件定义
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js`
  - renderer IPC 入口
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-session-service.test.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-tool-adapter.test.js`

### 修改文件

- `desktop-app-vue/src/main/index-optimized.js`
  - 注册新 service 与 IPC
- `desktop-app-vue/src/main/ipc/ipc-registry.js`
  - 接入新 coding agent IPC
- `desktop-app-vue/src/main/ai-engine/code-agent/code-agent-ipc.js`
  - 保留旧接口，但标记为 legacy 或转调新 service

### 后续可选文件

- `packages/cli/src/gateways/ws/`
  - 如需补 agent 专用消息协议，可在这里扩展
- `packages/cli/src/lib/agent-core.js`
  - 第二阶段视情况抽稳定 API

## 6. 分阶段实施

## Phase 0: 基线确认

**目标**: 先打通最小依赖关系，避免编码到一半才发现模块边界不通。

### 任务

1. 确认桌面端如何启动本地 CLI agent runtime
2. 确认使用哪种桥接方式：
   - 优先: 本地 WebSocket / session 协议
   - 次选: spawn CLI 子进程 + stdio 协议
3. 定义最小事件流协议：
   - `session-started`
   - `message-delta`
   - `tool-start`
   - `tool-result`
   - `plan-required`
   - `completed`
   - `failed`
4. 确认 renderer 需要的最小动作：
   - `startSession`
   - `sendMessage`
   - `approvePlan`
   - `rejectPlan`
   - `cancelSession`
   - `getSessionState`

### 产出

- 一份固定的桥接协议
- 一份最小事件模型

### 验收

- 桌面端主进程可成功启动并连接 CLI runtime
- 能建立一个空 session 并收到心跳或 ready 事件

## Phase 1: 会话服务与事件流

**目标**: 在桌面主进程建立最小 coding agent 宿主。

### 任务

1. 实现 `coding-agent-session-service.js`
   - 创建 / 销毁 / 恢复 session
   - 管理每个 session 的状态机
2. 实现 `coding-agent-events.js`
   - 标准化主进程内部和 IPC 对外事件
3. 实现 `coding-agent-ipc-v3.js`
   - 对 renderer 提供最小命令接口
4. 在 `index-optimized.js` 中初始化 service

### 状态机建议

```text
idle -> starting -> ready -> running -> waiting_approval -> completed
                                   \-> failed
                                   \-> cancelled
```

### 验收

- renderer 可创建 coding agent session
- 输入消息后可收到流式文本事件
- session 结束后状态正确落盘或保存在内存

## Phase 2: 最小工具适配层

**目标**: 只接 6 个核心工具，形成 coding loop 闭环。

### 任务

1. 实现 `coding-agent-tool-adapter.js`
2. 把桌面端现有能力映射为 agent 工具：
   - 文件读取 -> file/document/workspace 能力
   - 搜索 -> ripgrep / 现有搜索工具
   - 列目录 -> workspace/file manager
   - 编辑 / 写入 -> 文件系统能力
   - shell -> 受控命令执行器
3. 建立工具元数据模型：
   - `name`
   - `description`
   - `inputSchema`
   - `isReadOnly`
   - `riskLevel`
   - `source`

### 推荐首批工具

| 工具 | 来源 | 风险级别 |
|---|---|---|
| `read_file` | desktop file utils / workspace | low |
| `search_files` | ripgrep / existing search | low |
| `list_dir` | workspace manager | low |
| `edit_file` | desktop host controlled edit | medium |
| `write_file` | desktop host controlled write | medium |
| `run_shell` | sandboxed shell executor | high |

### 验收

- agent 能完成 “读文件 -> 搜索 -> 生成修改 -> 写回” 的一轮任务
- 工具调用结果能在桌面端 UI 中逐步显示

## Phase 3: 权限门禁与 Plan Mode

**目标**: 所有有副作用动作都不依赖 prompt 自觉，统一走宿主层权限门禁。

### 任务

1. 实现 `coding-agent-permission-gate.js`
2. 接入现有 `plan-mode/index.js`
3. 约定工具分级：
   - `low`: 直接允许
   - `medium`: plan mode 批准后允许
   - `high`: 二次确认
4. 对 `edit_file`、`write_file`、`run_shell` 做统一阻断
5. 在 session 中注入权限反馈事件：
   - `tool-blocked`
   - `plan-generated`
   - `approval-requested`

### 关键规则

1. 只读工具默认允许
2. 写文件在 plan mode 未批准前一律阻断
3. shell 命令默认高风险
4. 删除、覆盖、Git 写操作暂不进入 MVP 白名单

### 验收

- 未批准 plan 时，agent 只能读和分析
- 批准后，agent 才能执行写入和 shell
- 拒绝后，session 状态可继续分析或终止，不出现脏状态

## Phase 4: 上下文、会话恢复、压缩

**目标**: 把最小 loop 变成可连续使用的产品能力。

### 任务

1. 接入桌面端现有 `sessionManager`
2. 接入或复用 CLI `PromptCompressor`
3. 设计 session 存储结构：
   - 消息历史
   - 工具调用摘要
   - plan 审批记录
   - 工作目录 / project root
4. 建立自动压缩触发点：
   - 消息数过多
   - token 超阈值
   - 工具结果过长

### 注意点

- MVP 阶段优先“压缩工具输出 + 保留最近轮次”
- 不要先做复杂长期记忆系统

### 验收

- session 可恢复
- 长对话不因上下文爆炸而失控
- 压缩后仍能正确延续最近任务

## Phase 5: MCP 与 ToolManager 扩展

**目标**: 在核心 loop 稳定后，再开放外部能力。

### 任务

1. 在 `coding-agent-tool-adapter.js` 中增加 `mcp` 工具通道
2. 优先只暴露安全且确定性强的 MCP 工具
3. 接入 `toolManager` 中可复用工具
4. 建立工具来源分层：
   - `core`
   - `desktop-managed`
   - `mcp`
   - `legacy-code-agent`

### 原则

1. MCP 只是扩展层，不得绕过宿主权限门禁
2. 不能把所有 toolManager 工具一次性开放给 agent
3. 高风险工具默认关闭，由白名单启用

### 验收

- agent 能列出已启用的外部工具
- MCP 工具调用也能走 plan mode / permission gate

## Phase 6: 隔离、验证与收尾

**目标**: 把 MVP 做到可上线试用，而不是仅在 happy path 能跑。

### 任务

1. 为多文件改动场景预留 worktree 隔离开关
2. 补测试：
   - session service unit tests
   - permission gate unit tests
   - tool adapter unit tests
   - 一个桌面端 integration test
3. 建立最小验收脚本：
   - 新建 session
   - 让 agent 修改一个测试文件
   - 进入 plan mode
   - 用户批准
   - 写入成功
   - 运行测试命令
   - 输出结果

### 验收

- 主流程通过
- 失败路径有清晰错误
- 不会因为权限拒绝导致 session 卡死

## 7. 里程碑

### M1: 可连接

- 能创建 session
- 能发送消息
- 能流式返回文本

### M2: 可执行

- 能读文件、搜索、编辑、写回
- plan mode 生效

### M3: 可恢复

- 支持 session 恢复
- 支持上下文压缩

### M4: 可扩展

- 接入 MCP / ToolManager 白名单工具
- 具备最小测试覆盖

## 8. 测试计划

### 单元测试

- `coding-agent-session-service.test.js`
- `coding-agent-tool-adapter.test.js`
- `coding-agent-permission-gate.test.js`

### 集成测试

- 主进程启动 session
- 发送任务并收到流式事件
- plan mode 拦截写操作
- 批准后执行成功

### 回归测试

- 不影响现有 `code-agent:generate/review/fix/refactor`
- 不影响现有 `ai:processInput`
- 不影响现有 MCP IPC 和 tool IPC

## 9. 风险与缓解

### 风险 1: CLI ESM 与 Desktop CommonJS 边界复杂

**缓解**:

- MVP 走进程桥接，不做源码级直接复用
- 第二阶段再评估抽 `packages/agent-kernel`

### 风险 2: 工具能力重复，桌面端和 CLI 各有一套

**缓解**:

- Desktop 作为宿主，只暴露统一适配后的工具协议
- 不允许 renderer 直接感知底层双实现

### 风险 3: plan mode 逻辑分散

**缓解**:

- 所有副作用工具统一走 `coding-agent-permission-gate.js`
- prompt 只做辅助说明，不做最终授权

### 风险 4: 流式事件协议不稳定

**缓解**:

- 先冻结最小事件集
- 事件字段版本化，例如 `version: 1`

### 风险 5: 一开始就上多代理导致调试困难

**缓解**:

- 多代理延后到 Phase 6 之后
- 单代理稳定后再接 sub-agent/worktree

## 10. MVP 验收标准

满足下面条件即可视为最小 coding agent MVP 完成：

1. 桌面端可创建 coding agent session
2. agent 可在单个项目目录内进行多轮编码对话
3. agent 至少能调用 6 个核心工具
4. 写操作和 shell 操作必须经过 plan mode 或审批
5. 对话可恢复，长上下文可压缩
6. 至少有 1 条集成测试覆盖完整主路径

## 11. 后续演进

MVP 完成后，推荐按这个顺序继续演进：

1. worktree 隔离
2. sub-agent / reviewer agent
3. git-aware diff / patch preview
4. PR / commit generation
5. 更细粒度权限策略
6. 将 CLI runtime 中稳定能力抽成共享 `agent-kernel` 包

## 12. 推荐执行顺序

如果按最小风险推进，建议实际编码顺序如下：

1. `coding-agent-events.js`
2. `coding-agent-session-service.js`
3. `coding-agent-ipc-v3.js`
4. `coding-agent-tool-adapter.js`
5. `coding-agent-permission-gate.js`
6. `index-optimized.js` / `ipc-registry.js` 接线
7. 单元测试
8. 集成测试

这样做的原因是：先把 session 与事件流打通，再接工具；先把工具打通，再加权限；最后再接压缩、恢复和 MCP，避免一开始把复杂度堆满。
