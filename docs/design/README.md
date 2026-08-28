# 设计文档

> 本目录是 ChainlessChain 的研发设计入口，也是用户文档站与设计文档站的共享设计源。CLI Runtime 核对已更新到 2026-08-28：完整门禁的生产推荐版与 npm `latest` 均为 Agent Platform `0.166.7`，CLI、VS Code `0.37.72` 与 JetBrains `0.4.103` 的不可变标签都绑定精确 SHA `19834a1845`；三平台 CLI CI、Strict Sandbox、不可变制品、Trusted Publishing、provenance、npm/Open VSX/JetBrains 公网回读均已闭环。Agent SDK `0.2.4`、Agent Protocol `0.1.5` 保持公开。发布后的 Desktop Skill 安全提交 `2286267dea` 与远端协作/联邦/gossip/mesh 留存状态提交 `5edef7544b` 均按源码维护记录，不继承 `0.166.7` 制品授权。

## 当前重点

- CLI Agent Runtime、Cowork Runtime、Web Panel、Hooks、Workflow 等主线设计仍以 `docs/design/modules/` 为准。
- P2-14 已按限定范围完成：Process Broker 为其管理的声明 workspace writer 提供持久 checkpoint、分层 coverage 与 fenced rollback/recovery；外部副作用不在回滚承诺内。
- P2-16 已完成本地 Agent Team v6 authority、分布式 queue v1、预算/lease/wall fencing、两阶段 worktree 清理、交互式裁决与三平台长期 soak；10k task / 64 worker 是单进程规模验证，长期 soak 使用 2 个真实 OS worker。
- Agent Platform `0.166.5` 首次公开 Schema 生成的 37 类 stream event payload discriminated union、typed envelope 与严格 validator；`0.166.6` 补齐 Agent IPC/legacy transport 容量边界；`0.166.7` 将 CLI graph、Team、distributed-team、Cowork、Scheduler 与 App Server entry 统一接入 Graph Kernel cutover ledger，并约束 writer、store、source evidence、fencing 与恢复。
- 单一协议 Schema 与多语言 codegen 已提升为独立模块 107：canonical JSON Schema 同源生成 TS/Python/Kotlin/Swift 与 VS Code/Desktop vendor；跨端 causal conformance 固定并行工具交错、审批 binding 与终态投影，未知未来事件仍由 transport 无损透传。
- 上下文构建、压缩与记忆生命周期已提升为独立模块 108：先冻结 ContextItem、MemoryRecord、compaction rollout 和删除 receipt，再以无副作用 shadow 推进 CLI、Desktop、IDE 的单一 writer 切换；当前仍是提案，不冒充 authoritative cutover 已完成。
- 前序精确发布 SHA `2f5b0f263a` 的 Protocol、Python SDK、CLI CI、Strict Sandbox、IDE、Android、iOS、Desktop、E2E、Full/Code Quality 与 1,800 秒 App Server overload/RSS soak 均通过；Protocol `0.1.5`、TS/Python SDK `0.2.4`、CLI `0.166.5` 和 Open VSX `0.37.70` 已完成公网回读。该长期 soak 继续作为前序证据，不归因到 `0.166.7@19834a1845`。
- Desktop 与 VS Code 已接入默认关闭、仅暴露固定 Thread/Turn 方法的 `AppServerPilotClient`；审批 UI 未接入前保持 canonical decline，Desktop 子进程继续经过 Process Broker。
- App Server 新增实验 WebSocket：固定 `/app-server` 与 `chainlesschain.app-server.experimental.v1` 子协议，所有绑定要求至少 32 字节 token，非 loopback 还要求显式远程授权与 TLS；连接、payload、请求、输出、buffer 和清理时间全部有界。
- CLI `0.166.7` 在 `0.166.6` 有界 Agent IPC 之上完成 authoritative Graph entry cutover、耐久 takeover/migration/recovery 与 retired runtime 只读化；精确 SHA `19834a1845` 已完成三平台发布门并成为生产推荐。
- 发布后 Desktop 源码 `3e4d70eb52`—`2286267dea` 新增只读 Graph Run Debugger、外部 Skill Ed25519/摘要/隔离 Worker 执行、全部内置 Handler 能力目录，以及固定域名、动态公网、loopback 模型服务、网络诊断、环境访问与 shell 进程 Broker。远端 `5edef7544b` 另收紧 Yjs/社交协作文档、awareness、联邦模型 transport、gossip 与 mesh 留存状态生命周期。这些都是源码维护增量，不冒充 npm `0.166.7` 制品。
- PDH `0.4.59` 将 `better-sqlite3-multiple-ciphers` 降为可选依赖；无 Python/编译器/原生预构建时 npm 可跳过 native addon，CLI 继续使用内置 `sql.js` WASM。该降级只解决首次安装可移植性，不扩大 native SQLite 能力声明。
- Agenda、Routine、Cowork、Automation 与 Loop 继续共用 revision-bound permission/budget authority；三系统 72 小时 scheduler campaign、keeper formal aggregate、macOS 受保护 helper 和签名 native 分发仍未关闭。
- Checkpoint 的直接恢复与 timeline restore 共用 hash-chained CAS saga，并新增 `cc checkpoint recovery list|show|abort|resume|rollback|release`。恢复动作绑定 workspace prestate、owner/owner absence、seq/head fence 与持久 Git/copy engine；它仍只是文件恢复闭包，不是通用多资源事务。
- Open VSX 当前公开 `0.37.72`，JetBrains Marketplace 当前公开 `0.4.103`；两端标签均指向 `19834a1845`，重新认证 CLI `0.166.7` Graph authority 与 fenced recovery，且保持 IDE 投影只读。微软 VS Code Marketplace 与 JetBrains 作者签名仍未完成。
- Managed Agents 对标已新增独立模块 `91_Managed_Agents对标计划.md`，底层能力沉到共享包 `@chainlesschain/session-core`。
- `session-core` 当前已覆盖 SessionHandle、TraceStore、SessionManager、IdleParker、AgentGroup、SharedTaskList、MemoryStore、MemoryConsolidator、ApprovalGate、BetaFlags、StreamRouter、file-adapters。
- CLI 已接入 `memory recall/store`、`session policy`、`config beta list|enable|disable`；Desktop 仍处于 shim + 后续收口阶段。

## 最新文档对齐

### `cli-runtime-current.md`

- 生产基线与 npm `latest` 已统一为 Agent Platform CLI `0.166.7@19834a1845`；IDE 市场 Open VSX `0.37.72`、JetBrains `0.4.103` 也已独立公开回读。
- 新增 37 类 canonical stream event 的 payload discriminated union、SDK `0.2.4` / Protocol `0.1.5`、跨端 causal conformance、固定能力 App Server pilot 与实验 WebSocket 边界核对。
- 补充类型化 secret 配置、MCP `ws/wss` 与恢复裁决、canonical session/budget、受控 Skill 子 Agent、checkpoint restore saga 与保守 recovery CLI。
- 明确 `CHAINLESSCHAIN_HOME` 是完整运行目录覆盖值，测试夹具不得写入真实 home。
- 补充 process-execution-broker 的非秘密会话标识 allowlist 与默认凭据过滤边界。
- 明确 production `run_skill` 不 import `handler.js`，隔离 Skill 只获得三个只读文件工具；历史 `shell-exec` metadata 不产生 process authority，无消费方的 `skill-process-broker` façade 已删除。
- 记录 CLI-Anything/CLI Pack legacy handler 仍可生成但不会由 production `run_skill` 执行；未来恢复前必须重新满足可执行身份、完整进程树、宿主 dispose 与三平台门禁。
- 记录异步 hook 的 POSIX 进程组 / Windows `taskkill` + 后代快照 fallback 设计。
- 记录 unit / integration / E2E 三平台分层门禁、P2-14/P2-16 专项门、打包/启动校验，以及 `0.166.5@2f5b0f263a` 的 exact-SHA、不可变制品、provenance、App Server 1,800 秒 overload/RSS soak 与 registry 回读边界。

### `modules/103_Agent_SDK平台化方案.md`

- 从早期 stream-json SDK 方案升级为 Agent Platform 总体设计，覆盖 canonical Schema、多语言 codegen、CC App Server 与 Graph Kernel。
- 记录 `cc serve --app-server`、`cc team graph inspect|diff|eval`、有界队列、rollout/fork、Effect/reconcile 与 HumanTask 安全不变量。
- 明确公开 CLI/SDK/Protocol 与后续源码候选、产品入口迁移、真实 provider 旅程和长期 soak 的证据边界。

### `modules/107_单一协议Schema与自动代码生成.md`

- 独立定义 canonical Schema 所有权、wire/package/consumer 三层版本身份与生成物矩阵。
- 记录 additive/breaking change 规则、v1 baseline、共享 fixtures、跨语言 conformance、三平台 CI 和 npm 发布闭环。
- 明确 `cc codegen` 是用户代码生成 Agent，不是协议 codegen；37 类 discriminator 与 payload union、跨端 causal conformance 已完成，未知事件仍须无损透传；全部产品 authoritative adapter 切换仍不得写成已完成。

### `modules/104_CC_App_Server设计.md`

- 单独记录 stdio JSON-RPC、Thread/Turn/Item/Approval 状态机、有界请求/输出队列、hash-chain rollout、fork 与物理中断结算。
- 明确 App Server 是产品集成入口，不复制 Agent Kernel 或 Graph Kernel 的状态机；stdio 是稳定默认入口，带强制 token、loopback/远程 TLS 边界和全链路容量上限的 WebSocket 仍标 experimental。

### `modules/105_Graph_Kernel设计.md`

- 单独记录 GraphDefinition 编译、GraphRun、Task/Attempt、lease/fence、Message、Effect、Handoff、HumanTask、trace/diff/eval 与 adapter cutover。
- 明确 GraphRun 只是 identity/authority/budget/revision envelope；Task Graph 是控制面，Agent Tree 是动态执行拓扑，Artifact/Trace Graph 是只读证据投影，三者不能互相代替。
- 记录 `0.166.7` 已完成 CLI graph、Team、distributed-team、Cowork、Scheduler 与 App Server entry 的 authoritative writer 迁移，同时保持 Desktop/Browser/IDE 独立验收。

### `modules/109_Desktop_Cowork_Skill_Execution_Security.md`

- 定义 bundled / external / prompt-only 三类 Skill 信任分层，以及执行前稳定重读、Ed25519、摘要、可信 key 和显式能力清单。
- 记录一次性隔离 Worker、有界 JSONL 协议、宿主 Capability Broker、生成能力目录和 Handler byte-drift 门禁。
- 记录固定域名、动态公网、媒体/模型、loopback 本地服务与网络诊断 Broker 的 SSRF、shell、秘密环境和资源上限不变量。

### `modules/106_Agent_Kernel设计.md`

- 单独记录模型/工具主循环、runtime policy、权限、沙箱、预算、输出背压、中断和有界 cleanup。
- 说明 CLI、SDK、WebSocket 与 App Server 如何复用同一内核，以及 Agent Kernel 与 Graph authority 的结算边界。

### `modules/108_Context_Memory_Kernel设计.md`

- 单独记录上下文预算、压缩状态机、记忆作用域与生命周期、来源/敏感度传播、外置内容引用、删除对账和跨端等价性。
- 明确现有 CLI/Desktop/session-core 多套实现只是迁移输入；共享契约、shadow、canonical writer、legacy fenced/retired 必须分阶段验收。

### `CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN.md`

- P2-14 保持“限定范围完成”，不把 Process Broker coverage 扩写成宿主机所有写入保证。
- P2-16 保持“完成”，同时区分单进程 10k/64 规模证据和双进程三平台长期 soak。
- 增加实现、正式 release 与原生 validation 的分层证据，避免把 unsigned native 门误写成签名发行闭环。

### `modules/98_IDE桥接对标方案.md`

- 当前公开口径已对齐为 Open VSX VS Code `0.37.72` 与 JetBrains Marketplace `0.4.103`；两端重新认证 CLI `0.166.7` 的 Graph authority、fenced recovery 与 legacy containment，同时保留结构化授权、无正文 canonical collaboration 投影及默认关闭的固定能力 App Server pilot。
- 记录 Automation Center、CLI-owned Sessions Workbench、可恢复交付、canonical rewind/branch timeline、VS Code 内联聊天，以及五类 session 的 reply/artifact/PR/重启恢复真实宿主 journey；这些能力已进入公开稳定版。
- 初版 Phase 0–7、`0.2.x` / `0.1.0` 和当时的 Marketplace 待审状态继续保留为历史首发记录，不再冒充当前版本。

### `modules/91_Managed_Agents对标计划.md`

- 状态更新为 `Phase A-F 已落地`
- `session-core` 测试数更新为 `293/293`
- CLI 接入状态更新为：
  - `memory recall/store` 已落地并持久化到 `memory-store.json`
  - `config beta list|enable|disable` 已落地并持久化到 `beta-flags.json`
  - `session policy` 已落地并持久化到 `approval-policies.json`
- 后续工作明确收敛到：
  - Phase G: CLI 主运行路径收口
  - Phase H: Desktop 主进程 / IPC 收口

### 相关增量模块

- `modules/85_Hermes_Agent对标实施方案.md`
- `modules/86_Web_Cowork日常任务协作系统.md`
- `modules/88_OpenAgents对标补齐方案.md`
- `modules/91_Managed_Agents对标计划.md`

这些模块共同构成当前 Agent Runtime 对标与收口主线。

## 推荐阅读路径

### Agent Runtime / 对标主线

1. `modules/103_Agent_SDK平台化方案.md`
2. `modules/107_单一协议Schema与自动代码生成.md`
3. `modules/104_CC_App_Server设计.md`
4. `modules/106_Agent_Kernel设计.md`
5. `modules/108_Context_Memory_Kernel设计.md`
6. `modules/105_Graph_Kernel设计.md`
7. `modules/109_Desktop_Cowork_Skill_Execution_Security.md`
8. `modules/78_CLI_Agent_Runtime重构实施计划.md`
9. `modules/82_CLI_Runtime收口路线图.md`
10. `modules/85_Hermes_Agent对标实施方案.md`
11. `modules/88_OpenAgents对标补齐方案.md`
12. `modules/91_Managed_Agents对标计划.md`

### Desktop / Web / 协议联动

- `modules/69_WebSocket服务器接口.md`
- `modules/73_Web管理界面.md`
- `modules/75_Web管理面板.md`
- `modules/77_Agent架构优化系统.md`
- `modules/79_Coding_Agent系统.md`

## 当前验证摘要

近期与本目录直接相关的新增验证包括：

- CLI `0.166.5@2f5b0f263a` exact-SHA：CLI CI、CLI Strict Sandbox、Agent Protocol、Python SDK、IDE Roadmap、Android、iOS、E2E、Code Quality、IDE Extensions/ARM64、Full Test Suite 与 macOS launcher 的权威门均通过
- App Server 同一候选的 1,800.21 秒 soak：2,427,887 次请求，51,236 次成功、2,376,651 次预期过载、0 次非预期错误、0 个 drain 残留，RSS 增长 0.762%
- Agent SDK `0.2.4` / Agent Protocol `0.1.5`：TypeScript npm、Python PyPI、payload union、跨端 causal fixtures 与公网安装回读通过
- CLI/IDE `19834a1845`：Linux/Windows/macOS CLI CI 与 Strict Sandbox、npm Trusted Publishing/provenance、Open VSX `0.37.72` 与 JetBrains `0.4.103` 公网回读均成功

- `@chainlesschain/session-core`: `293/293`
- CLI unit: `session-core-singletons.test.js` `4/4`
- CLI unit: `cli-context-engineering.test.js` `55/55`
- CLI unit: `command-registration.test.js` `26/26`
- CLI integration: `managed-agents-cli.integration.test.js` `3/3`
- CLI E2E: `managed-agents-commands.test.js` `6/6`

## 文档同步说明

- 共享设计源文件在 `docs/design/`，不要直接修改生成镜像。
- 用户文档站镜像在 `docs-site/docs/design/`，同步脚本为 `docs-site/scripts/sync-design-docs.js`。
- 设计文档站镜像在 `docs-site-design/docs/`，同步脚本为 `docs-site-design/scripts/sync-docs.js`；其自定义 `index.md` 与 `.vitepress/` 不会被覆盖。
- 中文源文件名到两个站点 ASCII 文件名的单一映射位于 `docs/design/_filename-map.json`。
- 新增模块如果需要在文档站展示，必须同时补齐 `_filename-map.json` 与两个站点相应 `.vitepress/config.js` 的导航入口；只运行同步脚本不会自动生成 sidebar。

## 目录说明

- `README.md`: 本目录入口和当前状态说明
- `系统设计_主文档.md`: 总体设计
- `实施总结与附录.md`: 阶段总结与附录
- `modules/`: 各阶段模块设计与实施计划

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部。设计文档目录 README：docs/design 设计文档索引。

### 2. 核心特性

设计文档索引 / 导航。

### 3. 系统架构

见正文架构 / 设计章节。

### 4. 系统定位

ChainlessChain 的「设计文档索引」。

### 5. 核心功能

见正文功能 / 设计章节。

### 6. 技术架构

见正文实现 / 技术章节。

### 7. 系统特点

见正文（状态 / 版本 / 特性）。

### 8. 应用场景

见正文应用场景 / 背景。

### 9. 竞品对比

见正文对比 / 借鉴（如有）。

### 10. 配置参考

见正文配置 / 参数章节。

### 11. 性能指标

见正文性能 / 指标章节。

### 12. 测试覆盖

见正文测试 / E2E 章节。

### 13. 安全考虑

见正文安全 / 权限章节。

### 14. 故障排除

见正文故障 / trap / 已知限制章节。

### 15. 关键文件

见正文实现位置 / 关键文件章节。

### 16. 使用示例

见正文使用 / 命令 / API 示例。

### 17. 相关文档

[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
