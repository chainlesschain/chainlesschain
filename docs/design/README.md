# 设计文档

> 本目录是 ChainlessChain 的研发设计入口，也是 `docs-site` 设计区的同步源。CLI Runtime 核对已更新到 2026-07-23 的实际代码状态。

## 当前重点

- CLI Agent Runtime、Cowork Runtime、Web Panel、Hooks、Workflow 等主线设计仍以 `docs/design/modules/` 为准。
- Managed Agents 对标已新增独立模块 `91_Managed_Agents对标计划.md`，底层能力沉到共享包 `@chainlesschain/session-core`。
- `session-core` 当前已覆盖 SessionHandle、TraceStore、SessionManager、IdleParker、AgentGroup、SharedTaskList、MemoryStore、MemoryConsolidator、ApprovalGate、BetaFlags、StreamRouter、file-adapters。
- CLI 已接入 `memory recall/store`、`session policy`、`config beta list|enable|disable`；Desktop 仍处于 shim + 后续收口阶段。

## 最新文档对齐

### `cli-runtime-current.md`

- 明确 `CHAINLESSCHAIN_HOME` 是完整运行目录覆盖值，测试夹具不得写入真实 home。
- 补充 process-execution-broker 的非秘密会话标识 allowlist 与默认凭据过滤边界。
- 记录异步 hook 的 POSIX 进程组 / Windows `taskkill` + 后代快照 fallback 设计。
- 记录 unit / integration / E2E 分层门禁与 2026-07-23 E2E 基线。

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

- `@chainlesschain/session-core`: `293/293`
- CLI unit: `session-core-singletons.test.js` `4/4`
- CLI unit: `cli-context-engineering.test.js` `55/55`
- CLI unit: `command-registration.test.js` `26/26`
- CLI integration: `managed-agents-cli.integration.test.js` `3/3`
- CLI E2E: `managed-agents-commands.test.js` `6/6`

## 文档同步说明

- 设计源文件在 `docs/design/`
- 文档站镜像在 `docs-site/docs/design/`
- 同步脚本为 `docs-site/scripts/sync-design-docs.js`
- 新增模块如果需要在文档站展示，必须同时补齐：
  - `sync-design-docs.js` 的文件名映射
  - `docs-site/docs/.vitepress/config.js` 的 sidebar 链接

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
