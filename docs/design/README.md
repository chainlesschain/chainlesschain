# 设计文档

> 本目录是 ChainlessChain 的研发设计入口，也是用户文档站与设计文档站的共享设计源。CLI Runtime 核对已更新到 2026-08-08：npm `latest`、生产推荐版与当前源码包元数据均为 `0.163.1`，发布证据绑定不可变 tag `v-npm-0-163-1` 的精确 SHA `e3f56b11e2`。

## 当前重点

- CLI Agent Runtime、Cowork Runtime、Web Panel、Hooks、Workflow 等主线设计仍以 `docs/design/modules/` 为准。
- P2-14 已按限定范围完成：Process Broker 为其管理的声明 workspace writer 提供持久 checkpoint、分层 coverage 与 fenced rollback/recovery；外部副作用不在回滚承诺内。
- P2-16 已完成本地 Agent Team v6 authority、分布式 queue v1、预算/lease/wall fencing、两阶段 worktree 清理、交互式裁决与三平台长期 soak；10k task / 64 worker 是单进程规模验证，长期 soak 使用 2 个真实 OS worker。
- CLI `0.163.1` 已公开 canonical session authority、固定 MCP npm 执行 capsule、原生更新恢复、macOS PTY helper 修复、有界长会话压缩、live session tail durable-witness 竞态加固、Windows MCP 原子启动、可复现 Web Panel 构建与 Node 22 standalone 基座。
- 精确发布 SHA `e3f56b11e2` 的三平台 CLI CI、Strict Sandbox、unsigned 六目标原生验证、三系统两小时可靠性门、不可变制品、SBOM、Trusted Publishing、SLSA provenance 与 registry/npmmirror 回读均已闭环；原生证据仍固定 `signed=false`、`releaseEligible=false`，不等于 Desktop/native 签名发行完成。
- Checkpoint 的直接恢复与 timeline restore 共用 hash-chained CAS saga，并新增 `cc checkpoint recovery list|show|abort|resume|rollback|release`。恢复动作绑定 workspace prestate、owner/owner absence、seq/head fence 与持久 Git/copy engine；它仍只是文件恢复闭包，不是通用多资源事务。
- Open VSX 当前公开 `0.37.45`，累计下载已突破 **2 万**；tag 指向精确提交 `aed0a3ae53`，stable/最低支持版 × 三平台六格真实宿主同时验证多根与多窗口隔离。JetBrains Marketplace 当前公开并审核通过 `0.4.81`，tag 保持指向 `b5177f13c9`。权威变更继续由 CLI-owned authority 执行。
- Managed Agents 对标已新增独立模块 `91_Managed_Agents对标计划.md`，底层能力沉到共享包 `@chainlesschain/session-core`。
- `session-core` 当前已覆盖 SessionHandle、TraceStore、SessionManager、IdleParker、AgentGroup、SharedTaskList、MemoryStore、MemoryConsolidator、ApprovalGate、BetaFlags、StreamRouter、file-adapters。
- CLI 已接入 `memory recall/store`、`session policy`、`config beta list|enable|disable`；Desktop 仍处于 shim + 后续收口阶段。

## 最新文档对齐

### `cli-runtime-current.md`

- 生产基线更新为 CLI `0.163.1`；npm `latest`、源码包元数据与完整门禁公开版已对齐，`0.162.199` 作为上传前失败的不可变 tag 保留。
- 补充类型化 secret 配置、MCP `ws/wss` 与恢复裁决、canonical session/budget、受控 Skill 子 Agent、checkpoint restore saga 与保守 recovery CLI。
- 明确 `CHAINLESSCHAIN_HOME` 是完整运行目录覆盖值，测试夹具不得写入真实 home。
- 补充 process-execution-broker 的非秘密会话标识 allowlist 与默认凭据过滤边界。
- 明确 production `run_skill` 不 import `handler.js`，隔离 Skill 只获得三个只读文件工具；历史 `shell-exec` metadata 不产生 process authority，无消费方的 `skill-process-broker` façade 已删除。
- 记录 CLI-Anything/CLI Pack legacy handler 仍可生成但不会由 production `run_skill` 执行；未来恢复前必须重新满足可执行身份、完整进程树、宿主 dispose 与三平台门禁。
- 记录异步 hook 的 POSIX 进程组 / Windows `taskkill` + 后代快照 fallback 设计。
- 记录 unit / integration / E2E 三平台分层门禁、P2-14/P2-16 专项门、两小时可靠性门、打包/启动校验，以及 0.163.1 的 exact-SHA、不可变制品、SBOM、provenance 与 registry 回读边界。

### `CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN.md`

- P2-14 保持“限定范围完成”，不把 Process Broker coverage 扩写成宿主机所有写入保证。
- P2-16 保持“完成”，同时区分单进程 10k/64 规模证据和双进程三平台长期 soak。
- 增加实现、正式 release 与原生 validation 的分层证据，避免把 unsigned native 门误写成签名发行闭环。

### `modules/98_IDE桥接对标方案.md`

- 页首记录已对齐状态：Open VSX/源码 VS Code `0.37.45`，JetBrains Marketplace/源码 `0.4.81`。
- 记录 CLI-owned Sessions Workbench、可恢复交付、canonical rewind/branch timeline、VS Code 内联聊天，以及五类 session 的 reply/artifact/PR/重启恢复真实宿主 journey；这些能力已进入公开稳定版。
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

1. `modules/78_CLI_Agent_Runtime重构实施计划.md`
2. `modules/82_CLI_Runtime收口路线图.md`
3. `modules/85_Hermes_Agent对标实施方案.md`
4. `modules/88_OpenAgents对标补齐方案.md`
5. `modules/91_Managed_Agents对标计划.md`

### Desktop / Web / 协议联动

- `modules/69_WebSocket服务器接口.md`
- `modules/73_Web管理界面.md`
- `modules/75_Web管理面板.md`
- `modules/77_Agent架构优化系统.md`
- `modules/79_Coding_Agent系统.md`

## 当前验证摘要

近期与本目录直接相关的新增验证包括：

- CLI `0.163.1` exact-SHA：CLI CI 的 Ubuntu/Windows/macOS unit、integration、E2E 与打包/安装门，三平台 CLI Strict Sandbox、两小时可靠性门、unsigned 六目标 native validation，以及 npm exact-SHA、不可变制品、SBOM、provenance、registry readback 全绿
- IDE：Open VSX `0.37.45` 的不可变 VSIX、stable/minimum × 三平台真实宿主、多根/多窗口隔离、发布与回读全绿；JetBrains Marketplace `0.4.81` 的 2024.2/2025.2 三平台宿主、上传与回读全绿

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
