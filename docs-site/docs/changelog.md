# 更新日志

所有重要的项目更改都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [5.0.1.6] - 2026-03-15

### Added

- **Agent 智能增强**: `run_code` 工具新增 auto pip-install、脚本持久化、错误分类、环境检测
  - `classifyError()`: 5 种错误类型 (import_error/syntax_error/timeout/permission_error/runtime_error)，每种附带 `hint` 字段
  - `isValidPackageName()`: 正则验证包名安全性，拒绝 Shell 元字符（防注入）
  - `getEnvironmentInfo()`: 检测 OS/Python/Node.js/Git 环境信息，缓存后注入 System Prompt
  - `getCachedPython()`: 缓存 Python 解释器检测结果，复用 cli-anything-bridge 的检测逻辑
  - 脚本默认保存到 `.chainlesschain/agent-scripts/`（`persist: false` 时使用临时文件自动清理）
  - Python 执行遇到 `ModuleNotFoundError` 时自动 `pip install` 并重试
- **agent-core 提取去重**: 从 agent-repl.js 提取 AGENT_TOOLS、executeTool、chatWithTools、agentLoop 到 agent-core.js
  - agent-repl.js 变为薄包装层，仅添加 REPL 显示逻辑
  - ws-agent-handler.js 复用同一 agentLoop 异步生成器
- **Desktop agent 模式**: conversation:agent-chat IPC handler + FunctionCaller 9 工具 + UI 侧边栏切换
- **测试覆盖增强**: 新增 ~26 个测试
  - `agent-core-pip-install.test.js` (4 tests): pip auto-install 流程
  - `agent-core-python-cache.test.js` (3 tests): Python 缓存和环境检测
  - `agent-core-integration.test.js` (3 tests): SlotFiller + agentLoop 集成
  - agent-core.test.js 扩展 (6 tests): chatWithTools provider + agentLoop run_code
  - agent-repl.test.js 扩展 (4 tests): 薄包装层契约测试
  - ws-session-workflow.test.js 扩展 (2 tests): run_code 工具和事件转发
  - agent-enhancements.test.js 扩展 (4 tests): E2E 导出验证
  - CLI 总计 2503 测试 (113 文件)，全部通过

## [5.0.1.5] - 2026-03-15

### Added

- **SlotFiller 集成到 Agent 主循环**: 在 agentLoop() 调用 LLM 前自动检测用户意图中的缺失参数
  - `CLISlotFiller.detectIntent(userMessage)`: 正则匹配 9 种意图类型 (create_file/deploy/refactor/test/analyze/search/install/generate/edit_file)
  - `CLISlotFiller._extractEntities()`: 自动提取文件路径、文件类型、平台、包名等实体
  - agent-core.js `agentLoop()` 新增 `slotFiller` + `interaction` 选项，新增 `slot-filling` yield 事件
  - 终端 Agent REPL (agent-repl.js) 和 WebSocket Agent Handler (ws-agent-handler.js) 均集成 SlotFiller
- **serve 命令接入 WSSessionManager**: `chainlesschain serve` 现在自动启用有状态会话支持
  - 调用 `bootstrap()` 初始化 DB，创建 `WSSessionManager` 并注入到 `ChainlessChainWSServer`
  - 启动信息显示 "Sessions: enabled" 和项目路径
  - 新增 session:create / session:close 事件日志

### Fixed

- **session-resume 后无法发送消息**: 修复 `_handleSessionResume` 中恢复会话后未创建 handler 的问题，现在 resume 会重建 WebSocketInteractionAdapter 和 WSAgentHandler/WSChatHandler

## [5.0.1.4] - 2026-03-15

### Added

- **WebSocket 有状态会话**: `chainlesschain serve` 新增 Agent/Chat 有状态会话支持
  - `session-create`: 创建 agent/chat 会话，支持绑定项目上下文 (`projectRoot`)
  - `session-resume`: 从数据库恢复历史会话
  - `session-message`: 发送消息到会话，支持流式响应
  - `session-list` / `session-close`: 会话列表与关闭
  - `slash-command`: 在会话中执行 /plan、/model 等斜杠命令
  - `session-answer`: 回答 SlotFiller/InteractivePlanner 的交互式提问
  - `serve --project <path>`: 指定默认项目根目录
  - 新增 ws-session-manager.js、ws-agent-handler.js、ws-chat-handler.js
- **交互抽象层 (InteractionAdapter)**: 统一终端 REPL 和 WebSocket 两种用户交互模式
  - `TerminalInteractionAdapter`: 封装 prompts.js 的终端交互
  - `WebSocketInteractionAdapter`: 通过 WebSocket 发送 question 消息等待回答
- **Agent/Chat 核心提取**: 从 REPL 模块提取可复用的业务逻辑
  - `agent-core.js`: 异步生成器 `agentLoop`，yield 工具执行/响应事件
  - `chat-core.js`: 异步生成器 `chatStream`，yield 流式 token 事件
- **SlotFiller (参数槽填充)**: 从桌面版移植，适配 CLI
  - 自动检测缺失参数、规则推断、LLM 推断、交互式提问
  - 支持 6 种意图类型的必需参数定义
  - 通过 InteractionAdapter 实现终端/WebSocket 双模式交互
- **InteractivePlanner (交互式规划)**: 从桌面版移植，适配 CLI
  - LLM 驱动的计划生成 + 技能推荐
  - 用户确认/调整/重新生成/取消工作流
  - 与 PlanModeManager 深度集成
- **新增 204 个 WebSocket 会话相关测试**，CLI 总计 4500+ 测试

### Fixed

- **全面修复中文编码 (乱码) 问题**: 修复 22 个文件共 49 处编码违规
  - `data.toString()` → `data.toString("utf8")`: 40 处修复
  - `execSync`/`spawnSync` 缺少 `encoding: "utf-8"`: 9 处修复
  - 涉及文件：fine-tuning-manager、code-executor、python-sandbox、preview-manager、plugin-loader、python-bridge、automation-manager、gptq-quantizer、gguf-quantizer、whisper-client、local-tts-client、edge-tts-client、extended-tools-datascience、advanced-features-ipc、code-runner handler、did-manager、browser-extension-server、voice-video-manager、signaling-server、mobile-bridge、user-browser-handler、backend-service-manager 等

## [5.0.1.3] - 2026-03-14

### Added

- **WebSocket 服务器接口**: `chainlesschain serve` 命令，通过 WebSocket 暴露全部 CLI 命令供外部工具远程调用
  - `serve --port <port>`: 指定监听端口（默认 18800）
  - `serve --token <token>`: 启用 Token 认证
  - `serve --allow-remote`: 允许非本地连接（需配合 `--token`）
  - 支持 `execute`（缓冲模式）和 `stream`（流式模式）两种执行方式
  - 支持 `cancel` 取消运行中的命令
  - 30s ping/pong 心跳检测死连接
  - 安全防护：阻止递归调用 `serve`、阻止交互式命令（chat/agent/setup）
  - Shell-safe tokenizer 防止命令注入（无 `shell: true`）
  - 最大连接数限制 + 命令超时控制
  - 新增 ws-server.js 库 + serve.js 命令 + 3 个测试文件（54 个测试）
  - CLI 总计 61 个命令

## [5.0.1.2] - 2026-03-14

### Added

- **CLI-Anything 集成**: Agent 原生软件 CLI 桥接，将 [CLI-Anything](https://github.com/HKUDS/CLI-Anything) 生成的工具自动注册为 ChainlessChain 技能
  - `cli-anything doctor`: 检测 Python + CLI-Anything 环境
  - `cli-anything scan`: 扫描 PATH 中已生成的 `cli-anything-*` 工具
  - `cli-anything register <name>`: 注册工具为 managed 层技能（SKILL.md + handler.js）
  - `cli-anything list`: 列出已注册工具
  - `cli-anything remove <name>`: 移除已注册工具
  - 新增 cli-anything-bridge.js 库 + cli-anything.js 命令 + 3 个测试文件
  - CLI 总计 60 个命令
- **火山引擎 (Volcengine) LLM Provider**: 新增第 8 个 LLM 提供商，支持豆包系列模型
- **任务模型选择器 (Task Model Selector)**: 根据任务类型自动选择最优 LLM 模型
- **LLM 代理 (Proxy) 支持**: 通过 `chainlesschain llm proxy` 配置 HTTP/SOCKS 代理

### Fixed

- **中文编码修复**: 修复 system-handler.js 中 `.toString()` 缺少 `utf-8` 参数导致的乱码问题
- **全局编码规范**: 修复多个文件中 child_process 输出缺少 `encoding: 'utf-8'` 的问题

## [5.0.1.1] - 2026-03-12

### Added

- **CLI Phase 102 功能补齐**: 3 个新命令（init/cowork + skill 子命令增强），CLI 总计 59 个命令
  - `init`: 项目初始化命令，4 种模板（code-project/data-science/devops/空项目），生成 `.chainlesschain/` 项目结构
  - `cowork`: 多智能体协作（debate 多视角辩论审查 + compare A/B 方案对比 + analyze 代码分析）
  - `skill add/remove/sources`: 自定义技能管理，4 层优先级系统（bundled < marketplace < managed < workspace）
  - 10 个新源文件: project-detector.js, skill-loader.js, cowork-adapter.js, cowork/debate-review-cli.js, cowork/ab-comparator-cli.js, cowork/code-knowledge-graph-cli.js, cowork/decision-kb-cli.js, cowork/project-style-analyzer-cli.js, commands/init.js, commands/cowork.js
  - 8 个新测试文件（106 个新测试），CLI 总计 2009 tests / 89 files
  - 插件技能集成: plugin_skills 数据库表，插件 manifest 声明技能自动安装到 marketplace 层

## [5.0.1] - 2026-03-11

### Added

- **CLI Phase 5 P2P与企业功能**: 5 个新命令（p2p/sync/wallet/org/plugin），CLI 总计 59 个命令
  - `p2p`: P2P 消息系统（peer 注册/消息收发/设备配对），P2PBridge 桌面桥接
  - `sync`: 文件与知识同步（push/pull/冲突检测与解决/操作日志）
  - `wallet`: 数字钱包（Ed25519 密钥对 + AES-256-GCM 私钥加密，资产 CRUD，转账交易）
  - `org`: 组织管理（CRUD/成员邀请/角色/团队管理/审批工作流）
  - `plugin`: 插件市场（安装/启停/更新/设置管理/注册表搜索）
  - 5 个新 lib 模块: p2p-manager.js, sync-manager.js, wallet-manager.js, org-manager.js, plugin-manager.js
  - 160 个新单元测试 + 10 个 E2E 测试，CLI 总计 2009 tests / 89 files
- **CLI Phase 4 安全与身份**: 4 个新命令（did/encrypt/auth/audit），CLI 总计 29 个命令
  - `did`: Ed25519 DID 身份管理（创建/签名/验证/导出），W3C DID Core 子集
  - `encrypt`/`decrypt`: AES-256-GCM 文件加密，PBKDF2 密钥派生，自定义 CCLC01 格式
  - `auth`: RBAC 权限引擎，4 内置角色，26 权限范围，通配符匹配，过期控制
  - `audit`: 审计日志系统，8 事件类型，4 风险级别，自动风险评估，敏感数据脱敏
  - 4 个新 lib 模块: did-manager.js, crypto-manager.js, permission-engine.js, audit-logger.js
  - 130 个新单元测试 + 12 个 E2E 测试
- **CLI Phase 1 AI 智能层**: 4 个新命令 + Agent Plan Mode，CLI 总计 19 个命令
  - `search <query>`: BM25 混合搜索，支持 `--mode bm25`、`--top-k`、`--json` 选项
  - `tokens show|breakdown|recent|cache`: Token 用量追踪、多 Provider 成本分析、响应缓存统计
  - `memory show|add|search|delete|daily|file`: 持久记忆管理，数据库记忆 + 文件系统每日笔记
  - `session list|show|resume|export|delete`: 会话持久化、恢复、Markdown 导出
  - Agent Plan Mode: `/plan` 斜杠命令进入只读规划模式，支持 show/approve/reject/exit
  - 6 个新 lib 模块: bm25-search.js, token-tracker.js, response-cache.js, session-manager.js, memory-manager.js, plan-mode.js
  - CLI 测试: 380 tests, 25 files, all passing (from 117 tests / 18 files)

- **CLI 分发系统** (`packages/cli/`): 轻量级 npm CLI 包（~2MB），支持 `npm install -g chainlesschain` 一键安装
  - 19 个子命令: setup, start, stop, status, services, config, update, doctor, db, note, chat, ask, llm, agent, skill, search, tokens, memory, session
  - 按需从 GitHub Releases 下载平台二进制文件
  - 交互式设置向导，支持 5 种 LLM 提供商配置
  - Docker 服务编排、进程管理、环境诊断
- **CLI Headless Phase 0-3** — 完全独立的无头CLI，不依赖桌面端
  - 5 个核心包提取: core-env(17测试), shared-logger(11测试), core-infra(26测试), core-config(16测试), core-db(48测试) — 共 118 个测试
  - 7 个新 Headless 命令: `db`(init/info/backup/restore), `note`(add/list/show/search/delete), `chat`(交互式AI对话+流式输出), `ask`(单次问答), `llm`(models/test), `agent`(8工具+138技能), `skill`(list/categories/info/search/run)
  - Agent REPL (Claude Code 风格): read_file, write_file, edit_file, run_shell, search_files, list_dir, run_skill, list_skills
  - 138 个内置技能集成到 CLI，支持按分类/标签搜索和直接运行
  - CLI 基础测试: 117 tests, 18 files (Phase 1 扩展至 380 tests, 25 files)
- **原生模块保护**: 所有原生/可选模块 require 添加 try-catch 守卫，确保打包后优雅降级
- **CI/CD**: npm 自动发布工作流 (`publish-cli.yml`)
- MCP Community Registry remote fetch (`_fetchRemoteCatalog`, `remoteRegistryUrl`)
- Android `RemoteSkillProvider` interface in `core-p2p` for cross-module skill delegation
- iOS `VectorStore.list(limit:offset:)` protocol method + implementations
- iOS `DatabaseEngine` read-only SQL query execution via DatabaseManager
- Community registry unit tests (10 remote fetch tests)
- Skill lazy-load unit tests (48 tests)
- Community registry full unit tests (~28 tests)
- Community registry lifecycle integration tests (~8 tests)
- Skill loader supplementary unit tests (~20 tests)
- Browser action edge-case tests (~12 tests)
- MCP Registry E2E tests (~8 tests)

### Fixed

- iOS `MCPHttpSseTransport.sendRequest()` fatalError → delegates to existing `send()`
- iOS `CollaborativeEditorView` hardcoded userId → uses `IdentityManager.shared`
- iOS `VectorStoreView` empty placeholder → real `store.list()` integration
- Security audit test regex patterns matching actual handler patterns
- Vitest cowork-e2e.test.js exclusion (CJS format incompatible with Vitest collection)
- Android `P2PSkillBridge` cross-module dependency (app→feature-ai) via interface extraction
- CommunityRegistry `_fetchRemoteCatalog` validation inconsistency (description no longer required)
- CommunityRegistry `_compareVersions` NaN handling for non-numeric version parts

### Changed

- Android `P2PSkillBridge` now depends on `RemoteSkillProvider` interface instead of `P2PClient`
- Android `feature-ai/build.gradle.kts` adds `core-p2p` dependency
- Android `RemoteModule` binds `P2PClient` as `RemoteSkillProvider`

## [5.0.0] - 2026-03-10

### 新增

- **v5.0.0 Phase 78-100 全面实现 — 23 个新模块，5 个里程碑**

**Milestone 1: 架构重构基座 (Phase 78-80) — v4.0.0-alpha**

- `IPC 域分割 + 懒加载` (Phase 78): IPC Registry 拆分为 10 个域，LazyPhaseLoader 按需加载，IPC Middleware 统一中间件 (限流/权限/计时)，3 IPC 处理器
- `共享资源层 + DI 容器` (Phase 79): ServiceContainer 统一 DI (循环依赖检测)，SharedCacheManager (LRU+TTL)，EventBus 跨模块通信，ResourcePool 资源池管理，4 IPC 处理器
- `数据库演进框架` (Phase 80): MigrationManager 版本化迁移 (up/down)，QueryBuilder 流式 SQL，IndexOptimizer 索引优化器，4 IPC 处理器

**Milestone 2: AI Agent 2.0 生态 (Phase 81-87) — v4.1.0**

- `A2A 协议引擎` (Phase 81): Google A2A 标准，Agent Card 发现 (JSON-LD)，Task 生命周期管理，SSE+WebSocket 流，8 IPC 处理器
- `自主工作流编排器` (Phase 82): DAG 工作流，条件分支/循环/并行/审批门，5 内置模板，断点续执行，10 IPC 处理器
- `层次化记忆 2.0` (Phase 83): 4 层记忆 (工作→短期→长期→核心)，遗忘曲线，记忆巩固，跨 Agent 共享，8 IPC 处理器
- `多模态感知层` (Phase 84): 屏幕理解，语音双向流，文档解析，视频分析，跨模态推理，8 IPC 处理器
- `Agent 经济系统` (Phase 85): 微支付 (State Channel)，计算资源市场，贡献度证明，Agent NFT，收益分配，10 IPC 处理器
- `代码生成 Agent 2.0` (Phase 86): 全栈代码生成，Git 感知，代码审查 (安全检测)，5 框架脚手架，CI/CD 自动配置，8 IPC 处理器
- `Agent 安全沙箱 2.0` (Phase 87): WASM 隔离，权限白名单，资源配额，执行审计，行为 AI 监控，6 IPC 处理器

**Milestone 3: Web3 深化 + 隐私计算 (Phase 88-92) — v4.2.0**

- `零知识证明引擎` (Phase 88): zk-SNARK/zk-STARK，Groth16 证明系统，Circom 电路编译，身份选择性披露，6 IPC 处理器
- `跨链互操作协议` (Phase 89): EVM 链 (ETH/Polygon/BSC/Arbitrum) + Solana，HTLC 原子交换，跨链消息，8 IPC 处理器
- `去中心化身份 2.0` (Phase 90): W3C DID v2.0，可验证展示，社交恢复，跨平台漫游，声誉可移植，8 IPC 处理器
- `隐私计算框架` (Phase 91): 联邦学习，MPC，差分隐私，同态加密查询，8 IPC 处理器
- `DAO 治理 2.0` (Phase 92): 二次方投票，委托投票，提案生命周期，国库管理，8 IPC 处理器

**Milestone 4: 企业级生产力平台 (Phase 93-97) — v4.5.0**

- `低代码平台` (Phase 93): 可视化构建器，15 内置组件，数据连接器 (REST/GraphQL/DB/CSV)，版本管理+回滚，10 IPC 处理器
- `企业知识图谱` (Phase 94): 实体抽取+关系发现，图查询，知识推理引擎，GraphRAG 融合，8 IPC 处理器
- `BI 智能分析` (Phase 95): NL→SQL，OLAP，智能报表，异常检测+趋势预测，8 IPC 处理器
- `工作流自动化` (Phase 96): 12 内置连接器 (Gmail/Slack/GitHub 等)，触发器系统，10 IPC 处理器
- `多租户 SaaS` (Phase 97): 租户隔离，用量计量，订阅计费 (4 套餐)，数据导入/导出，8 IPC 处理器

**Milestone 5: 生态融合 + 终极形态 (Phase 98-100) — v5.0.0**

- `统一应用运行时` (Phase 98): 插件 SDK 2.0，热更新，Profiler (Flame Graph)，CRDT 同步，8 IPC 处理器
- `智能插件生态 2.0` (Phase 99): AI 推荐，依赖解析+冲突检测，沙箱隔离，AI 代码审计，收益分成，8 IPC 处理器
- `自进化 AI 系统` (Phase 100): NAS 架构搜索，持续学习，自我诊断+修复，行为预测，能力评估+成长轨迹，8 IPC 处理器

### 统计

- 🆕 23 个新模块，62 个源文件，29 个测试文件
- 📊 ~178 IPC Handlers，646+ 单元测试全部通过
- 📄 23 份设计文档 (docs/design/modules/43-65)
- 📘 23 个 VitePress 文档页面

---

## [1.2.1] - 2026-03-10

### 新增

- **v1.2.1 新增 6 个社区生态补充技能 (总计 137 个桌面内置技能, 100% Handler 覆盖)**
  - 研究社区技能生态 (OpenClaw、awesome-skills 等)，补充 6 个高频缺失技能

**社区生态补充技能 (6 个)**:

- `brainstorming`: 创意头脑风暴，5 种方法 (自由思考/思维导图/SWOT/六顶帽/SCAMPER)
- `debugging-strategies`: 系统调试策略，9 种模式 (诊断/二分法/追踪/假设/小黄鸭/根因分析/红旗检测/防御加固/会话追踪)
- `api-design`: API 设计，5 种模式 (RESTful 设计/审查/OpenAPI/版本策略/错误码)
- `frontend-design`: 前端设计，5 种模式 (组件/布局/响应式/无障碍/主题)
- `create-pr`: PR 创建，4 种模式 (创建/草稿/模板/Changelog)
- `doc-coauthoring`: 文档协作，5 种模式 (初稿/扩展/审查/结构/术语表)

### 增强

- **核心技能 Handler v2.0 升级 (4 个)**:
  - `tavily-search v2.0`: 新增 crawl/map/research/qna 模式，域名过滤，内容提取
  - `find-skills v2.0`: 新增 marketplace 浏览/技能对比/兼容性检查/热度追踪/版本检查/依赖解析，集成 6 大技能市场
  - `github-manager v2.0`: 新增代码搜索/Issue-PR 详情/PR 审查/分支管理/Release 管理/标签管理/分支比较
  - `self-improving-agent v2.0`: 新增本能捕获/验证/技能提取/知识导出，Claudeception 模式技能提取

- **已有 Handler 增强 (5 个)**:
  - `knowledge-graph`: 重构优化 (397 行新增)
  - `proactive-agent`: 扩展至 604 行，增强自主触发能力
  - `security-audit`: 新增漂移检测/完整性验证/CVE Feed
  - `multi-search-engine`: 新增多 Provider 搜索能力
  - `excel-analyzer`: 新增 161 行分析功能

### 测试

- 新增 84 个单元测试 (6 个技能共 13+35+13+12+14+17 个测试用例)
- 新增 68 个 Handler 单元测试 (4 个新测试文件)
- 新增 20 个 E2E 测试 (IPC 可达性测试) + 14 个 E2E 测试 (技能增强)

---

## [1.2.0] - 2026-03-06

### 新增

- \*\*v1.2.0 新增 32 个实用技能 (总计 131 个桌面内置技能, 100% Handler 覆盖)
  - 研究 10 大外部技能标准并转化为内置技能，新增 12 个实用流行技能，以及 10 个集成/生产力/知识技能

**外部技能标准转化 (10 个)**:

- `tavily-search`: 联网搜索，Tavily API 深度搜索/新闻/内容提取
- `find-skills`: 技能发现，从注册表搜索/推荐/分类浏览
- `proactive-agent`: 主动代理，4 种自主触发器(文件监控/阈值/周期/模式匹配)
- `agent-browser`: Agent 浏览器，快照引用模式(@e1/@e2)浏览器自动化
- `remotion-video`: 视频生成，React/Remotion 6 种模板
- `cron-scheduler`: 定时调度，Cron 表达式 + 自然语言时间
- `planning-with-files`: 规划工作流，Manus 3 文件模式
- `content-publisher`: 内容发布，5 种内容类型
- `skill-creator`: 技能创建器，元技能：创建/测试/验证/优化
- `webapp-testing`: Web 测试，侦察-执行模式

**实用流行技能 (12 个)**:

- `deep-research`: 深度研究，8 阶段研究流水线
- `git-worktree-manager`: Git Worktree 管理
- `pr-reviewer`: PR 审查，通过 gh CLI 分析差异
- `docker-compose-generator`: Docker Compose 生成，10 种服务模板
- `terraform-iac`: Terraform IaC，AWS/GCP/Azure HCL 配置生成
- `api-docs-generator`: API 文档生成，OpenAPI 3.0 规范
- `news-monitor`: 新闻监控，HackerNews API + 趋势检测
- `ultrathink`: 深度思考，7 步扩展推理框架
- `youtube-summarizer`: YouTube 摘要，字幕提取 + 章节分段
- `database-query`: 数据库助手，SQL 生成/优化/Schema 内省
- `k8s-deployer`: K8s 部署，清单生成 + Helm Chart + 安全检查
- `cursor-rules-generator`: IDE 规则生成，5 种 AI 编码助手配置

**集成与生产力技能 (10 个)**:

- `api-gateway`: API 网关，100+ API 统一接口/密钥管理/链式调用
- `free-model-manager`: 免费模型管理，Ollama/HuggingFace 模型发现/下载/管理
- `github-manager`: GitHub 管理，Issues/PR/仓库/Workflows 操作
- `google-workspace`: Google 工作区，Gmail/Calendar/Drive 集成
- `humanizer`: AI 文本人性化，去除 AI 写作痕迹/语气调整
- `notion`: Notion 集成，页面创建/数据库查询/内容管理
- `obsidian`: Obsidian 笔记库，笔记创建/搜索/标签管理/双链
- `self-improving-agent`: 自我改进代理，错误追踪/模式分析/改进建议
- `summarizer`: 万能摘要，URL/PDF/YouTube/文本摘要 + 关键点提取
- `weather`: 天气查询，全球天气/预报/告警 (wttr.in 免密钥)

---

## [3.4.0] - 2026-02-28

### 新增

- 🌐 **EvoMap 全球进化网络** (Phase 76-77, 10 IPC)
  - `evomap-federation.js`: 多 Hub 联邦互连，Gene 跨 Hub 流通，进化压力选择，基因重组
  - `gene-ip-manager.js`: Gene 所有权证明（DID+VC），贡献溯源，衍生链追踪
  - `evomap-dao.js`: 社区治理 DAO，Gene 质量投票，争议仲裁，标准制定
  - `evomap-federation-ipc.js` + `evomap-governance-ipc.js`: 10 IPC 处理器
  - `evoMapFederation.ts` + `evoMapGovernance.ts` Store
  - `EvoMapFederationPage.vue` + `EvoMapGovernancePage.vue`

- 🗄️ **新增数据库表** (4 张): `evomap_hub_federation`, `gene_lineage`, `gene_ownership`, `evomap_governance_proposals`

---

## [3.3.0] - 2026-02-27

### 新增

- 🌍 **全球去中心化社交** (Phase 72-75, 20 IPC)
  - `protocol-fusion-bridge.js`: ActivityPub/Nostr/Matrix 多协议统一消息桥接，身份映射
  - `realtime-translator.js`: 本地 LLM 实时多语言翻译（50+语言），上下文感知
  - `content-quality-assessor.js`: AI 内容质量评估，去中心化共识审核
  - `filecoin-storage.js`: Filecoin 持久化存储交易，存储证明验证
  - `content-distributor.js`: P2P 内容分发网络，热点内容自动缓存
  - `anti-censorship-manager.js`: Tor 隐藏服务，域前置策略，流量混淆
  - `mesh-network-manager.js`: BLE/WiFi Direct 本地网状网络，无互联网通信

- 🗄️ **新增数据库表** (5 张): `unified_messages`, `identity_mappings`, `filecoin_deals`, `content_versions`, `anti_censorship_routes`

---

## [3.2.0] - 2026-02-26

### 新增

- 🔒 **硬件安全生态** (Phase 68-71, 18 IPC)
  - `trust-root-manager.js`: U盾+SIMKey+TEE 三位一体统一信任根，硬件认证链互验，跨设备密钥同步
  - `pqc-ecosystem-manager.js`: ML-KEM/ML-DSA 全子系统迁移，混合模式过渡，固件 PQC 加速
  - `satellite-comm.js`: LEO 卫星短消息通道（Iridium/Globalstar），加密+压缩
  - `disaster-recovery.js`: 完全离线密钥恢复，紧急吊销广播
  - `hsm-adapter-manager.js`: Yubikey/Ledger/Trezor 第三方硬件适配层，统一 HSM 接口

- 🗄️ **新增数据库表** (5 张): `trust_root_attestations`, `cross_device_key_sync`, `pqc_subsystem_migrations`, `satellite_messages`, `hsm_adapters`

---

## [3.1.0] - 2026-02-25

### 新增

- 🏪 **去中心化 AI 市场** (Phase 65-67, 16 IPC)
  - `skill-service-protocol.js`: 标准化技能描述（输入/输出/依赖/SLA），REST/gRPC 远程调用
  - `skill-invoker.js`: 跨组织代理技能委派，版本兼容检测
  - `token-ledger.js`: 代币账本（发行/转账/冻结），贡献奖励结算
  - `contribution-tracker.js`: 技能/算力/数据贡献追踪，信誉加权定价
  - `inference-node-registry.js`: GPU/CPU 推理节点自注册，算力基准测试
  - `inference-scheduler.js`: 延迟/成本/算力智能调度，模型分片并行推理

- 🗄️ **新增数据库表** (6 张): `skill_service_registry`, `skill_invocations`, `token_transactions`, `contributions`, `inference_nodes`, `inference_tasks`

---

## [3.0.0] - 2026-02-24

### 新增

- 🤖 **全自主 AI 开发者** (Phase 62-64, 15 IPC)
  - `tech-learning-engine.js`: 自主技术栈感知，官方文档/Release Notes 变更跟踪，最佳实践提取
  - `autonomous-developer.js`: 端到端自主开发流程（需求理解→架构决策→代码生成→测试→部署）
  - `collaboration-governance.js`: 人机协作治理框架，决策审批网关，操作回放审计，置信度门控

- 🗄️ **新增数据库表** (6 张): `tech_stack_profiles`, `learned_practices`, `dev_sessions`, `architecture_decisions`, `governance_decisions`, `autonomy_levels`

---

## [2.0.0] - 2026-02-23

### 新增

- 🏗️ **生产加固 + 联邦网络** (Phase 57-61, 23 IPC)
  - `performance-baseline.js`: 性能基线采集，历史对比，回归检测
  - `security-auditor.js`: OWASP Top 10 自动扫描，依赖漏洞检测，安全评分
  - `federation-hardening.js`: 断路器模式，健康检查，连接池管理
  - `federation-stress-tester.js`: 100 节点压力测试，延迟/吞吐量/错误率基准
  - `reputation-optimizer.js`: 贝叶斯优化信誉权重，异常检测，信誉分析
  - `sla-manager.js`: 跨组织 SLA 合约，违约检测，自动补偿

- 🗄️ **新增数据库表** (10 张): `performance_baselines`, `security_audit_reports`, `federation_circuit_breakers`, `federation_health_checks`, `stress_test_runs`, `stress_test_results`, `reputation_optimization_runs`, `reputation_analytics`, `sla_contracts`, `sla_violations`

---

## [1.1.0] - 2026-02-27

### 重构

- 🔄 **ES6模块迁移** — 全项目迁移至ES6 import/export语法，使用Node.js协议导入（`node:fs`、`node:path`等），淘汰CommonJS require
- 📦 **Phase 46-51测试补全** — 门限签名、BLE U-Key、内容推荐、Nostr桥接、DLP、SIEM六大模块完整单元测试+Store测试+E2E测试

### 新增

- 🔩 **Cowork v3.0 - 全自动开发流水线** (5 模块, 15 IPC)
  - `pipeline-ipc.js`: DAG 流水线编排，5 种步骤类型（串联/并行/条件/循环/转换），10 个预置模板
  - `requirement-parser.js`: 结构化需求提取，约束/验收条件/优先级分析
  - `deploy-agent.js`: 多环境部署编排（dev/staging/prod），蓝绿/金丝雀策略
  - `post-deploy-monitor.js`: 部署后健康监控，KPI 基线偏差检测
  - `rollback-manager.js`: Git Revert/Docker/Config 多策略自动回滚

- 💬 **Cowork v3.1 - 自然语言编程** (3 模块, 10 IPC)
  - `spec-translator.js`: NL→Spec 9 步翻译流水线，9 种意图分类，完整度评分，LLM 增强
  - `project-style-analyzer.js`: 跨团队代码约定提取（命名/缩进/注释风格），自动规则生成
  - `nl-programming-ipc.js`: 统一 NL 编程 IPC 处理器注册（10 个通道）

- 🖼️ **Cowork v3.2 - 多模态协作** (6 模块, 12 IPC)
  - `modality-fusion.js`: 音频/图像/文档/屏幕/文本五模态统一融合引擎
  - `document-parser.js`: PDF/Word/Excel 文档解析，表格/图片提取，OCR 支持
  - `screen-recorder.js`: Electron desktopCapturer 截屏/录制，Tesseract OCR（英/中）
  - `multimodal-context.js`: 多模态会话上下文管理，Token 预算控制
  - `multimodal-output.js`: 富媒体输出生成（Markdown/HTML/ECharts 图表/幻灯片）
  - `multimodal-collab-ipc.js`: 多模态协作 IPC 注册（12 个通道）

- 🚨 **Cowork v3.3 - 自主运维** (7 模块, 15 IPC)
  - `alert-manager.js`: 多通道告警（Webhook/Email/IM/App），P0-P3 升级链，智能去重
  - `auto-remediator.js`: Playbook 驱动自动修复，8 种动作类型，回滚集成，成功率统计
  - `postmortem-generator.js`: 事故后分析报告自动生成，根因分析，改进建议，SLA 计算
  - `autonomous-ops-ipc.js`: 自主运维 IPC 注册（15 个通道）

- 🪪 **Cowork v4.0 - 去中心化代理网络** (7 模块, 20 IPC)
  - `agent-did.js`: W3C DID 规范，`did:cc:agent-{uuid}` 格式，Ed25519 密钥对，能力证明
  - `agent-credential-manager.js`: W3C Verifiable Credentials 签发/验证/吊销，3 种凭证类型
  - `agent-authenticator.js`: DID 互认证协议（Challenge-Response / 凭证证明 / 双向 TLS）
  - `agent-reputation.js`: 动态信誉评分（0.0-1.0），多维度加权，时间衰减，4 级声望等级
  - `federated-agent-registry.js`: KadDHT 去中心化代理发现，跨组织技能查询，延迟感知路由
  - `cross-org-task-router.js`: 跨组织任务委派，凭证证明，SLA 预算，全程审计日志
  - `decentralized-network-ipc.js`: 去中心化网络 20 个 IPC 通道（DID/认证/凭证/联邦/信誉）

- 🗄️ **新增数据库表** (13 张)
  - v3.0: `pipeline_executions`, `pipeline_steps`, `deployment_records`
  - v3.1: `nl_programs`, `style_rules`
  - v3.2: `multimodal_sessions`, `document_cache`
  - v3.3: `alert_records`, `remediation_logs`, `postmortem_reports`
  - v4.0: `agent_dids`, `agent_reputation`, `federated_task_log`

### 统计

- IPC 处理器: 166 → **238 个** (+72)
- 代码行数: ~28,000 → **~45,120 行** (+17,120)
- 数据库表: 8 → **21 张** (+13)
- 新增模块: **28 个**（v3.0: 5 / v3.1: 3 / v3.2: 6 / v3.3: 7 / v4.0: 7）

---

## [1.0.0] - 2026-02-23

### 新增

- 📞 **P2P语音/视频通话** (WebRTC + DTLS-SRTP全加密)
  - `call-manager.js`: 通话生命周期管理（发起/接听/挂断/录制）
  - `media-engine.js`: 音视频采集编码（VP8/VP9/H.264, Opus 48kHz）
  - `call-signaling.js`: Offer/Answer/ICE信令（Signal协议加密通道）
  - `sfu-relay.js`: SFU中继节点（2-4人Mesh / 5-8人SFU混合架构）
  - Vue组件: `CallPanel.vue`, `IncomingCall.vue`；Store: `call.ts`

- 🖼️ **共享加密相册**
  - `shared-album-manager.js`: 相册CRUD与权限分级（查看/贡献/管理）
  - `photo-encryptor.js`: AES-256相册密钥加密，P2P分布式存储
  - `exif-stripper.js`: EXIF隐私数据剥离（GPS/设备信息移除）
  - `photo-sync.js`: P2P增量同步引擎
  - Vue组件: `PhotoViewer.vue`；Store: `albums.ts`

- 👥 **社区/频道系统**
  - `community-manager.js`: 社区CRUD，多级角色（创建者/管理员/版主/成员）
  - `channel-manager.js`: 多频道管理（公告/讨论/只读/订阅）
  - `governance-engine.js`: 去中心化治理投票（提案/公示/投票/执行）
  - `gossip-protocol.js`: Gossip协议消息分发（3跳转发、ID去重、离线补偿）
  - `content-moderator.js`: AI辅助内容审核
  - Vue页面: `CommunityPage.vue`, `ChannelPage.vue`；Store: `community.ts`

- 📝 **协作编辑文档（社交版）**
  - `collab-engine.js`: Yjs CRDT协作引擎，无冲突实时合并
  - `collab-sync.js`: P2P DataChannel操作同步
  - `collab-awareness.js`: 协作者光标/选区实时感知
  - `doc-version-manager.js`: 版本历史与回溯
  - Vue组件: `CursorOverlay.vue`；Vue页面: `CollabEditorPage.vue`；Store: `socialCollab.ts`

- ⏰ **朋友圈时光机**
  - `time-machine.js`: 时间线多维浏览（年/月/日/事件视图）
  - `memory-generator.js`: AI生成"N年前的今天"、年度社交报告、友谊里程碑
  - `sentiment-analyzer.js`: 动态情感趋势分析（基于本地Ollama）
  - Vue页面: `TimeMachinePage.vue`；Vue组件: `MemoryCard.vue`；Store: `timeMachine.ts`

- 📺 **去中心化直播**
  - `livestream-manager.js`: P2P推流 + SFU多级分发（<10人Mesh / 10-100人SFU / >100人级联）
  - `danmaku-engine.js`: 实时弹幕（加密DataChannel传输，弹幕去重）
  - Vue页面: `LivestreamPage.vue`；Vue组件: `DanmakuOverlay.vue`；Store: `livestream.ts`

- 🔮 **高级社交特性**
  - `anonymous-mode.js`: 零知识证明匿名发帖/评论
  - `social-token.js`: 社区治理代币（发行/流通/激励）
  - `storage-market.js`: 去中心化存储市场（代币购买节点存储）
  - `ai-social-assistant.js`: AI智能回复建议、话题推荐、社交破冰
  - `mesh-social.js`: P2P Mesh离线社交（无互联网场景）
  - `platform-bridge.js`: 跨平台桥接（Mastodon/Nostr ActivityPub）

- 🎓 **Cowork协作演化技能** (共95个内置技能)
  - `/debate-review`: 3视角代码评审（性能/安全/可维护性），共识投票裁决
  - `/ab-compare`: 多智能体方案A/B对比与基准测试
  - `/orchestrate`: 工作流编排（feature/bugfix/refactor/security-audit模板）
  - `/verification-loop`: 6阶段验证（Build→TypeCheck→Lint→Test→Security→DiffReview）
  - `/stream-processor`: 流式数据逐行处理（log/csv/json）

- 🔧 **基础设施**
  - `social-initializer.js`: 社交模块启动序列编排（15个模块依序初始化）
  - `ipc-registry.js` 新增: 全部社交/P2P IPC处理器统一注册
  - Router `index.ts` 新增6条社交路由
  - Pinia 新增6个TypeScript Store（albums, call, community, livestream, socialCollab, timeMachine）

### 修复

- 修复 `whisper-client.js` 和相关测试
- 修复 `fine-tuning-manager.test.js` 和 `training-data-builder.test.js`
- 修复 `git-hook-runner.test.js` 和 `dual-model-manager.test.js`

---

## [0.39.0] - 2026-02-22

### 新增

- 🧠 **Cowork v2.1.0 - 自进化与知识图谱系统** (7个核心模块, 35个IPC处理器)
  - **代码知识图谱** (`code-knowledge-graph`): 工作区代码扫描，8种实体类型，7种关系类型，中心性分析，循环依赖检测，热点发现 (14个IPC)
  - **决策知识库** (`decision-knowledge-base`): 历史决策记录，相似性搜索，最佳实践提取，9个问题类别 (6个IPC)
  - **Prompt优化器** (`prompt-optimizer`): 技能提示词自优化，A/B变体测试，SHA-256去重，成功率追踪 (5个IPC)
  - **技能发现器** (`skill-discoverer`): 任务失败分析，关键词提取，Marketplace技能搜索推荐 (4个IPC)
  - **辩论式代码审查** (`debate-review`): 3视角多Agent审查(性能/安全/可维护性)，共识投票，APPROVE/NEEDS_WORK/REJECT裁决 (3个IPC)
  - **A/B方案对比** (`ab-comparator`): 5种Agent风格方案生成，3维基准评测(正确性/性能/质量)，自动评分排名 (3个IPC)
  - **统一IPC注册** (`evolution-ipc`): 6个模块35个处理器统一注册

- 🔧 **Cowork支撑模块**
  - **CI/CD优化器**: 智能测试选择，依赖图分析，Flakiness评分，增量构建编排 (10个IPC)
  - **负载均衡器**: 实时Agent指标追踪，复合负载评分，任务自动迁移 (8个IPC)
  - **ML任务调度器**: 加权线性回归复杂度预测，资源估算，在线学习 (8个IPC)
  - **IPC API文档生成器**: 递归扫描`*-ipc.js`，OpenAPI 3.0生成，Markdown文档自动生成 (6个IPC)

- 🌐 **Cowork v2.0.0 - 跨设备协作**
  - **P2P Agent网络**: WebRTC DataChannel跨设备Agent通信，15种消息协议 (12个IPC)
  - **设备发现**: 网络设备自动发现，4级能力分层 (6个IPC)
  - **混合执行器**: 6种执行策略(本地优先/远程优先/最佳适配/负载均衡) (5个IPC)
  - **Computer Use桥接**: 12个AI工具映射为Cowork技能 (6个IPC)
  - **Cowork API服务器**: RESTful API 20+端点，Bearer/API-Key认证，SSE流 (5个IPC)
  - **Webhook管理器**: 17种事件类型，HMAC签名验证，指数退避重试 (7个IPC)

- 🎯 **新增技能**: ab-compare, debate-review, stream-processor (总计92个)

### 改进

- 📊 8个新数据库表(知识图谱/决策/提示词/发现)
- 🔗 Hook系统集成: DecisionKB自动捕获PostToolUse事件，SkillDiscoverer监听ToolError
- 🧠 ContextEngineering集成: 知识图谱架构洞察注入LLM提示

---

## [0.38.0] - 2026-02-21

### 新增

- 🔐 **SIMKey v0.38.0 - 6大安全增强功能**
  - **iOS eSIM支持**: 通过Apple eSIM API + Secure Enclave集成，iOS用户可使用eSIM作为SIMKey安全载体
  - **5G SIM卡优化**: 签名速度提升3-5倍，支持国密SM2/SM3/SM4/SM9，批量签名流水线
  - **NFC离线签名**: 近场通信离线身份验证、交易签名、文件签名，无需网络
  - **多SIM卡自动切换**: 双卡双待智能管理，网络故障自动切换，工作/个人分离
  - **SIM卡健康监控**: 实时健康评分仪表盘，智能告警，自动维护，报告导出
  - **量子抗性算法升级**: NIST PQC标准(ML-KEM/ML-DSA/SLH-DSA)，混合加密模式，密钥迁移工具

### 改进

- 📱 iOS用户不再受SIM卡API限制，eSIM模式提供完整SIMKey功能
- ⚡ 5G USIM卡上加密操作性能提升4-5倍
- 🔒 后量子密码学混合模式确保长期数据安全

---

## [0.37.6] - 2026-02-17

### 新增

- 🎨 **10个系统+安全+设计+分析技能** - 总计90个内置技能，Handler覆盖率100%
  - 系统管理: backup-manager（数据备份恢复）、performance-profiler（性能分析基准）
  - 知识管理: query-enhancer（RAG查询优化）、memory-insights（知识库分析）
  - 安全工具: crypto-toolkit（加密哈希编码）、password-generator（密码Token生成）
  - 数据+网络: data-exporter（多格式数据导出）、network-diagnostics（网络诊断工具）
  - 设计+工具: color-picker（颜色调色板工具）、text-transformer（文本编解码转换）

### 改进

- 🧪 新增 ~34 个测试用例，总计 250 测试全部通过

---

## [0.37.5] - 2026-02-17

### 新增

- 🎨 **10个开发效率+系统工具技能** - 总计80个内置技能，Handler覆盖率100%
  - 开发效率: json-yaml-toolkit、regex-playground、http-client、snippet-library、markdown-enhancer
  - 系统运维: log-analyzer、system-monitor、env-file-manager
  - 知识+工具: knowledge-graph、clipboard-manager

### 改进

- 🧪 新增 ~28 个测试用例，总计 216 测试全部通过
- ⚡ 零新增依赖，全部使用Node.js内置模块 + 已有npm包

---

## [0.37.4] - 2026-02-17

### 新增

- 🎨 **10个图像+数据+工具技能** - 总计70个内置技能，Handler覆盖率100%
  - 图像处理: image-editor、ocr-scanner、image-generator
  - 数据处理: chart-creator、csv-processor
  - 开发工具: word-generator、template-renderer、code-runner
  - 自动化+工具: voice-commander、file-compressor

### 改进

- 🧪 新增 ~31 个测试用例，总计 188 测试全部通过
- ⚡ 零新增依赖，深度复用16个已有引擎

---

## [0.37.3] - 2026-02-17

### 新增

- 🎨 **10个Office文档+音视频处理技能** - 总计60个内置技能，Handler覆盖率100%
  - Office文档: pdf-toolkit、doc-converter、excel-analyzer、pptx-creator、doc-comparator
  - 音视频: audio-transcriber、video-toolkit、subtitle-generator、tts-synthesizer、media-metadata

### 改进

- 🧪 新增 ~28 个测试用例，总计 157 测试全部通过
- ⚡ 音视频技能支持优雅降级（缺少ffmpeg/Whisper时返回有用信息）

---

## [0.37.2] - 2026-02-17

### 新增

- 📱 **Android移动生产力技能** - 5个LOCAL技能: quick-note、email-draft、meeting-notes、daily-planner、text-improver
- 🔗 **Android PC远程委托技能** - 8个REMOTE技能: pc-screenshot、pc-file-search、pc-run-command、pc-open-url、pc-clipboard、pc-system-info、pc-git-status、pc-processes
- 🏗️ **remoteSkillName映射** - Android技能→桌面技能名称映射，支持REMOTE/HYBRID路由
- 🎨 **10个Office+媒体技能** - 桌面端新增pdf-toolkit、doc-converter、excel-analyzer等

### 改进

- 📱 Android技能总数: 15 → 28 (5 LOCAL + 8 REMOTE)
- 🧪 Android新增 21 个测试用例

---

## [0.37.1] - 2026-02-17

### 新增

- 🎨 **10个AI会话+开发效率技能** - 总计50个内置技能，Handler覆盖率100%
  - AI会话增强: prompt-enhancer、codebase-qa、auto-context、multi-model-router
  - 开发效率: code-translator、dead-code-eliminator、changelog-generator、mock-data-generator、git-history-analyzer、i18n-manager

### 改进

- 🧪 新增 ~20 个测试用例，总计 ~120 测试

---

## [0.37.0] - 2026-02-17

### 新增

- 📱 **Android Agent Skills系统** - 完整的Agent Skills系统实现
  - SkillMdParser: YAML frontmatter解析（SnakeYAML）
  - SkillRegistry: 线程安全注册表（ConcurrentHashMap + SkillIndex）
  - SkillLoader: 三层加载（bundled→managed→workspace）
  - SkillExecutor: Handler优先，LLM-prompt降级
  - 7个Kotlin Handler: CodeReview、ExplainCode、Summarize、Translate、Refactor、UnitTest、Debug
  - 15个SKILL.md资产文件
  - SkillRegistry.toFunctionDefinitions() 支持OpenAI函数调用格式

---

## [0.36.0] - 2026-02-16

### 新增

- 🔗 **AI调用链打通** - ManusOptimizations.bindUnifiedRegistry() 完整打通 Registry→Manus→ContextEngineering→LLM Prompt
- 🛡️ **初始化安全** - \_initPromise 并发锁 + IPC init-wait guard (10s超时)
- 🧪 **E2E集成测试** - 4个端到端测试验证完整调用链 (31 tests total)
- 🎨 **30个内置技能** - 新增15个技能(repo-map, refactor, doc-generator, api-tester, onboard-project, lint-and-fix, test-and-fix, dependency-analyzer, db-migration, project-scaffold, env-doctor, context-loader, vulnerability-scanner, release-manager, mcp-server-generator)，覆盖12大类别
- 🔧 **18个可执行Handler** - 新增11个handler，第一批: env-doctor, repo-map, context-loader, lint-and-fix, test-and-fix；第二批: refactor, doc-generator, api-tester, onboard-project, dependency-analyzer, project-scaffold

### 改进

- 📦 **参数序列化限制** - MAX_PARAMS_LENGTH=500 + circular reference保护
- 🔒 **类型安全** - Store错误处理 `err: unknown` + 安全类型转换
- 🛠️ **MCPSkillGenerator** - 空工具名过滤 `.filter(Boolean)`
- 💪 **ToolsExplorerPage** - onMounted try-catch 错误恢复

---

## [0.35.0] - 2026-02-16

### 新增

- 🎨 **15个内置技能** - 7个可执行Handler + 8个文档型技能，覆盖7大类别
  - 自动化: browser-automation, computer-use, workflow-automation
  - 知识: memory-management, smart-search
  - 数据: web-scraping, data-analysis
  - 开发: code-review, git-commit, explain-code, test-generator, performance-optimizer
  - 安全: security-audit
  - DevOps: devops-automation
  - 远程: remote-control
- 🗂️ **统一工具注册表 (UnifiedToolRegistry)** - 聚合FunctionCaller(60+) + MCP(8) + Skills(15)
- 📦 **ToolSkillMapper** - 自动将未覆盖工具分组到10个默认技能类别
- 🔧 **MCPSkillGenerator** - MCP服务器连接时自动生成SkillManifestEntry
- 📋 **Agent Skills开放标准** - 13个扩展字段(tools/instructions/examples/dependencies等)
- 📄 **10个演示模板** - 自动化(3)+AI工作流(3)+知识管理(2)+远程控制(2)
- 🖥️ **ToolsExplorerPage** - 工具浏览器页面(路由: #/tools/explorer)
- 📄 **DemoTemplatesPage** - 演示模板浏览页面(路由: #/demo-templates)
- 📊 **unified-tools Pinia Store** - 统一工具状态管理
- 🔗 **名称标准化** - kebab-case(SKILL.md) ↔ snake_case(FunctionCaller)自动桥接

### 改进

- ⚡ SkillMdParser增强 - 支持13个Agent Skills标准字段
- 🔧 Context Engineering集成 - 技能分组工具序列化到LLM提示词
- 📊 社区MCP服务器 - 增加skillInstructions/skillExamples/skillCategory元数据

---

## [0.34.0] - 2026-02-15

### 新增

- 🏛️ **企业审计合规** - 统一审计日志+GDPR合规+DSR处理(18 IPC)
- 🛒 **插件市场** - 浏览/安装/评分/发布+自动更新(22 IPC)
- 🤖 **专业化多代理** - 8种代理模板+任务编排(16 IPC)
- 🔑 **SSO企业认证** - SAML 2.0+OAuth 2.0/OIDC+PKCE(20 IPC)
- 🔧 **MCP SDK** - Server Builder+HTTP+SSE+社区注册中心
- 🎨 **5个内置技能** - security-audit, devops-automation, data-analysis, test-generator, performance-optimizer

---

## [0.33.0] - 2026-02-11

### 新增

- 🖥️ **Computer Use电脑操作能力** - 类似Claude Computer Use的完整电脑操作能力
  - CoordinateAction：像素级坐标点击、拖拽、手势操作
  - VisionAction：Vision AI集成，支持Claude/GPT-4V/LLaVA视觉定位
  - DesktopAction：桌面级截图、鼠标键盘控制、窗口管理
  - NetworkInterceptor：网络请求拦截、模拟、条件控制
  - AuditLogger：操作审计日志，风险评估，敏感信息脱敏
  - ScreenRecorder：屏幕录制为截图序列，暂停/恢复/导出
  - ActionReplay：操作回放引擎，变速、单步、断点调试
  - SafeMode：安全模式，权限控制、区域限制、速率限制
  - WorkflowEngine：工作流引擎，条件分支、循环、并行执行、子工作流
  - ElementHighlighter：元素高亮显示，调试和演示可视化
  - TemplateActions：预定义操作模板，快速执行常用自动化任务
  - ComputerUseMetrics：性能指标收集和分析
  - 68+ IPC处理器，12个AI可调用工具
- 🌐 **浏览器插件增强** - Phase 17-19 高级调试能力
  - 215个远程命令，完整浏览器自动化
  - WebSocket调试、Service Worker管理、内存分析
  - DOM变动观察、事件监听器检查
  - 输入记录和回放
  - 媒体查询模拟、页面生命周期控制
  - 网络限流、设备模拟、传感器模拟
- 📱 **Android应用管理器和安全信息UI** - 远程控制功能增强
- 🔧 **前端组件** - ComputerUsePanel浏览器自动化面板

### 改进

- ⚡ Computer Use性能优化 - 95%+元素定位准确率，<200ms截图对比
- 🔒 安全增强 - 完整的操作审计和风险评估
- 📊 指标收集 - 全面的性能监控和分析

---

## [0.32.0] - 2026-02-08

### 新增

- 🌐 **浏览器插件 Phase 17** - 高级调试能力
  - WebSocket调试（监控、发送、关闭）
  - Service Worker管理（列表、注销、更新）
  - 缓存存储操作（列出、获取、删除）
  - 安全信息获取（SSL证书、安全状态）
  - 动画控制（暂停、播放、设置速度）
  - 布局检查（盒模型、计算布局）
  - 代码覆盖率分析（JS/CSS）
  - 内存分析（堆快照、采样、GC）

### 改进

- 🔧 浏览器插件代码优化 - background.js 5,900+行
- 📚 文档更新

---

## [0.31.0] - 2026-02-05

### 新增

- 🖥️ **DesktopAction桌面操作** - 桌面级截图和控制
- 📹 **ScreenRecorder屏幕录制** - 录制为截图序列
- 🔄 **ActionReplay操作回放** - 支持断点调试

### 改进

- ⚡ 截图性能优化
- 🔧 跨平台兼容性增强

---

## [0.30.0] - 2026-02-01

### 新增

- 👁️ **VisionAction视觉操作** - Vision AI元素定位
  - 支持Claude Vision、GPT-4V、LLaVA
  - 多语言OCR（10+语言）
  - 元素验证和等待
- 🎯 **CoordinateAction坐标操作** - 像素级精确操作
  - 点击、拖拽、滚动、手势
- 🛡️ **SafeMode安全模式** - 权限控制和区域限制

### 改进

- 🔒 安全性增强 - 操作审计和风险评估
- 📊 性能指标收集

---

## [0.29.0] - 2026-01-30

### 新增

- 📝 **SessionManager会话管理** - 智能上下文管理
  - 自动压缩（30-40% token节省）
  - 搜索、标签、导出/导入
  - 自动摘要
  - Permanent Memory集成
- ⚙️ **Context Engineering** - KV-Cache优化
  - 静态/动态内容分离（60-85%缓存命中率）
  - 工具定义序列化
  - 任务上下文管理
  - 可恢复压缩
- 🎭 **Plan Mode** - Claude Code风格的安全规划模式
  - 仅允许只读工具
  - 计划生成和审批工作流
- 🔧 **Skills系统** - Markdown技能定义
  - 三层加载（bundled/managed/workspace）
  - 门控检查（平台、依赖、环境）
  - 内置技能（code-review、git-commit、explain-code）
- 🌐 **浏览器自动化系统** - 完整的浏览器自动化
  - BrowserEngine核心引擎
  - ElementLocator多策略元素定位
  - SnapshotEngine截图对比
  - RecordingEngine用户操作录制
  - SmartDiagnostics AI诊断
- 🏢 **权限引擎** - 企业级RBAC
  - 资源级权限
  - 权限继承和委托
  - 团队权限
  - 审计日志
- 👥 **团队管理器** - 组织子团队管理
  - 团队CRUD
  - 成员管理
  - 团队层级
  - 团队报告（日报/周报）
- 📘 **TypeScript迁移** - 28个Pinia stores迁移到TypeScript

### 改进

- ⚡ 17个Context Engineering IPC处理器
- 🔧 14个Plan Mode IPC处理器
- 📊 17个Skills IPC处理器
- 🧪 75%代码覆盖率，233+测试用例

---

## [0.28.0] - 2026-01-28

### 新增

- 🪝 **Hooks系统** - Claude Code风格的钩子系统
  - 21个钩子事件（PreToolUse、PostToolUse、SessionStart等）
  - 4种钩子类型（Sync、Async、Command、Script）
  - 优先级系统（SYSTEM→HIGH→NORMAL→LOW→MONITOR）
  - 中间件集成（IPC、Tool、Session、File、Agent）
  - 脚本钩子（自动加载 `.chainlesschain/hooks/*.js`）
- 🔍 **混合搜索引擎** - Vector + BM25融合
  - 向量搜索（语义相似度）
  - BM25搜索（Okapi BM25算法）
  - RRF融合（Reciprocal Rank Fusion）
  - <20ms搜索延迟
- ⚠️ **IPC错误处理中间件** - 企业级错误处理
  - 10种错误类型分类
  - 标准化响应格式
  - ErrorMonitor集成
  - 统计收集
- 🧠 **Permanent Memory系统** - Clawdbot风格持久记忆
  - 每日笔记自动记录
  - MEMORY.md长期知识
  - 预压缩刷新
  - 混合搜索
  - 自动索引

### 改进

- 📚 完整的钩子系统文档
- 🔧 中间件工厂函数

---

## [0.27.0] - 2026-01-27

### 新增

- 🤖 **Cowork多智能体协作系统 v1.0.0** - 生产级企业框架，支持智能任务分配、并行执行、协同工作流
  - TeammateTool核心类：13个协作操作（创建团队/分配任务/投票决策等）
  - CoworkOrchestrator：AI驱动的智能单/多代理决策引擎
  - FileSandbox：18+敏感文件模式检测，5层防御架构，零关键漏洞
  - LongRunningTaskManager：检查点/恢复机制，指数退避重试
  - Skills系统：4个Office技能（Excel/Word/PPT/数据分析），插件架构
  - 前端UI：CoworkDashboard、TaskMonitor、SkillManager（~2,500行）
  - 200+测试用例，90%+代码覆盖率
- 📚 **Phase 4文档自动化系统** - 自动生成和更新项目文档
- 🔄 **Phase 3 CI/CD智能化** - 智能化持续集成和部署流程优化
- 🎛️ **远程控制系统 Phase 2** - 完整的远程控制功能实现
- 👥 **团队模板系统** - 代码审查、文档生成、测试模板

### 改进

- ⚡ 性能优化 - 所有操作达到或超过基线目标（45ms团队创建，3ms权限检查）
- 🔗 完整集成 - 与RAG、LLM、ErrorMonitor、SessionManager无缝连接
- 📊 实时监控 - 10+种ECharts图表类型，实时数据可视化
- ✅ 生产就绪 - 综合文档，企业级质量保证

## [0.26.2] - 2026-01-26

### 新增

- 📱 **Android性能优化 Phase 7** - APK体积优化、滚动性能优化
- 🛡️ **AI内容审核系统** - 自动审核工作流、审核队列数据库层
- 📞 **通话历史系统** - WebRTC通话UI、通话历史数据库

### 改进

- 🧪 单元测试优化 - 更新8个单元测试文件，提升测试稳定性
- 🔧 编译错误修复 - 清理TestUtils.kt，解决编译问题
- ⚡ 内存泄漏修复 - 关键性能和内存泄漏修复

## [0.26.1] - 2026-01-25

### 新增

- 📱 **Android全局文件浏览器** - 完整的文件浏览和AI集成（Phase 1-8）
- 🎨 **Android UI增强** - 使用统计、编辑器功能、媒体播放器、PDF预览
- 🔌 **LLM提供商集成** - 12个LLM提供商适配器，完整配置和测试
- 🍎 **iOS企业版功能** - RBAC权限系统、组织工作区管理（Phase 2.1-2.2）
- ⛓️ **iOS区块链功能** - HD钱包、智能合约、交易系统、跨链转账（Phase 1.1-1.6）

### 改进

- 🧪 E2E测试套件 - 100%通过率，全面验证
- 🔧 测试重组 - 桌面测试重新组织，提升可维护性
- ⚡ P2P传输优化 - 改进文件传输稳定性

## [0.26.0] - 2026-01-19

### 新增

- 📝 **统一日志系统** - 700+个console调用迁移到集中式logger，支持日志级别控制、结构化日志、生产环境调试
- 📱 **Android P2P UI完整集成** - 8个P2P屏幕（设备发现/配对/安全验证/DID管理/消息队列/QR扫描）
- 🛡️ **ChatPanel内存泄漏防护** - 4层防护机制（定时器安全/事件清理/API取消/消息限制）
- 🔗 **P2P WebRTC兼容层** - WebRTC兼容性层优化P2P通信稳定性

### 改进

- 🗂️ 代码结构重构 - src/main目录按功能分类重组
- 🧪 测试框架优化 - 修复不稳定测试，提升CI/CD稳定性
- ⚡ 性能优化 - 内存管理和长时间运行稳定性增强

## [0.25.0] - 2026-01-15

### 新增

- 🤖 **Manus AI优化系统** - Context Engineering、Tool Masking、TaskTrackerFile、可恢复压缩
- 🔄 **Multi-Agent多智能体系统** - Agent协调器、3个专用Agent、并行/链式执行

### 改进

- 💰 Token成本降低50-90%（理论值）
- ⚡ 复杂任务完成时间降低30%

## [0.24.0] - 2026-01-10

### 新增

- 🔌 **MCP Chat Integration** - MCP工具集成到AI聊天
- ⚙️ **统一配置目录系统** - `.chainlesschain/`目录集中管理
- 💰 **Token预算管理系统** - LLM使用成本跟踪、预算控制

## [0.23.0] - 2026-01-05

### 新增

- 📱 **移动端同步功能** - 桌面-移动端数据双向同步、群聊实时同步
- 💬 **移动端社交功能** - WebSocket实时更新、群聊功能、@提及、#话题标签
- 📝 **企业版知识库协作** - 实时协作编辑、版本历史、评论讨论

## [0.22.0] - 2025-12-31

### 新增

- 🎤 **语音消息系统** - 录制/播放、音频波形可视化
- 📁 **P2P文件传输** - 大文件分块传输、断点续传、SHA-256校验
- 🔄 **消息转发功能** - 支持多种消息类型转发

## [0.21.0] - 2025-12-30

### 新增

- 📊 **知识图谱可视化完善** - 8个图分析算法、5种可视化方式
- 🧠 **智能实体提取** - 9种实体类型、8种关系类型
- 📤 **多格式导出** - JSON、GraphML、GEXF、DOT、CSV、HTML

## [0.20.0] - 2025-12-30

### 新增

- 🏢 **企业版DID邀请链接** - 安全令牌、权限控制、使用记录
- 📱 **移动端知识库增强** - Markdown渲染、代码高亮、图片预览
- 🎤 **语音识别功能完善** - Whisper集成(100%准确度/2.5x实时速度)

## [0.19.0] - 2025-12-30

### 新增

- 🌐 **PC端核心功能完善** - 多语言支持、STUN/TURN网络测试
- 📞 **P2P通信完善** - WebRTC语音/视频通话、屏幕共享

## [0.18.0] - 2025-12-29

### 新增

- 🧪 **测试框架升级** - 全面迁移到Vitest(94个测试文件/900+用例)
- 📱 **移动端数据同步** - 跨设备无缝协作
- 🐧 **Linux平台完整支持** - ZIP便携版和DEB安装包

## [0.17.0] - 2025-12-29

### 新增

- ⛓️ **区块链集成 Phase 1-3 完成**
- 🔧 **技能工具系统集成**
- 🌐 **浏览器扩展完善**
- 🔌 **插件系统增强**

### 改进

- ⚡ 智能合约测试覆盖率达到100%
- 🎨 优化托管交易UI/UX

### 修复

- 🐛 修复 vue-i18n CSP 违规问题

## [0.16.0] - 2025-12-28

### 新增

- 🎤 **语音识别系统 Phase 3 完成**
- 🔐 **U盾多品牌支持**
- 🧠 **19个AI专用引擎**

### 改进

- ⚡ RAG 检索准确度提升20%

### 计划中

- 浏览器扩展（网页剪藏）
- iOS SIMKey支持
- 多语言界面
- 语音输入
- 更多LLM模型支持

## [0.9.0] - 2024-12-02

### 新增

- 🎉 完整的文档网站（VitePress）
- 📱 移动端Vue版本桌面应用
- 🔐 U盾和SIMKey完整集成
- 🌐 去中心化社交功能
- 💱 交易辅助模块
- 🧠 本地AI模型支持（Ollama集成）

### 改进

- ⚡ 数据库查询性能优化（提升3倍）
- 🎨 全新的UI设计
- 📊 向量检索准确度提升15%
- 🔄 Git同步速度优化

### 修复

- 🐛 修复Windows系统下U盾驱动问题
- 🐛 修复Git冲突解决时的崩溃问题
- 🐛 修复移动端SIMKey认证失败
- 🐛 修复大文件上传超时问题

## [0.8.0] - 2024-10-15

### 新增

- ✨ RAG (检索增强生成) 功能
- 📝 Markdown编辑器增强
- 🔍 全文搜索优化
- 📂 知识库分类管理
- 🏷️ 标签系统

### 改进

- 🚀 启动速度提升50%
- 💾 内存占用降低30%
- 🎯 AI问答准确度提升20%

### 修复

- 🐛 修复知识库导入时的编码问题
- 🐛 修复向量数据库索引损坏
- 🐛 修复跨设备同步冲突

## [0.7.0] - 2024-08-20

### 新增

- 🔐 SQLCipher数据库加密
- 🌳 Git版本控制集成
- ☁️ GitHub/GitLab同步支持
- 🔑 密钥管理系统
- 📱 Android应用Beta版

### 改进

- 🎨 界面重新设计
- 📚 文档系统完善
- ⚡ 向量检索性能优化

### 修复

- 🐛 修复文件导入失败问题
- 🐛 修复AI问答超时
- 🐛 修复数据同步丢失

## [0.6.0] - 2024-06-10

### 新增

- 🧠 本地AI模型集成（初版）
- 📄 PDF文件支持
- 🖼️ 图片OCR识别
- 📊 知识图谱可视化

### 改进

- 🔍 搜索算法优化
- 💨 UI渲染性能提升
- 📝 编辑器功能增强

### 修复

- 🐛 修复大文件处理崩溃
- 🐛 修复中文分词错误
- 🐛 修复内存泄漏

## [0.5.0] - 2024-04-05

### 新增

- 📚 知识库基础功能
- 🔍 向量检索引擎
- 💾 本地存储系统
- 📝 Markdown编辑器

### 改进

- 🎨 UI/UX设计优化
- ⚡ 性能优化

## [0.4.0] - 2024-02-15

### 新增

- 🔐 U盾集成（飞天诚信）
- 🔑 密钥管理
- 🔒 数据加密

### 改进

- 🛡️ 安全性增强
- 📚 文档完善

## [0.3.0] - 2024-01-10

### 新增

- 🎨 UI框架搭建（Electron + React）
- 📁 文件系统基础功能
- ⚙️ 配置管理系统

## [0.2.0] - 2023-12-01

### 新增

- 📐 系统架构设计
- 🗄️ 数据模型设计
- 📝 技术文档

## [0.1.0] - 2023-10-20

### 新增

- 🎉 项目初始化
- 📋 需求分析
- 🔬 技术调研

---

## 版本说明

### 版本号规则

格式: `主版本号.次版本号.修订号`

- **主版本号**: 不兼容的API更改
- **次版本号**: 向后兼容的功能新增
- **修订号**: 向后兼容的问题修复

### 变更类型

- **新增**: 新功能
- **改进**: 对现有功能的改进
- **修复**: Bug修复
- **废弃**: 即将移除的功能
- **移除**: 已移除的功能
- **安全**: 安全相关的修复

### 获取更新

#### 自动更新（推荐）

应用会自动检查更新并提示安装。

#### 手动更新

访问[GitHub Releases](https://github.com/chainlesschain/releases)下载最新版本。

#### 更新通知

- 📧 邮件通知（订阅更新）
- 🔔 应用内通知
- 📱 微信公众号推送

### 升级注意事项

#### 0.8.0 → 0.9.0

::: warning 重要
此版本包含数据库结构变更，升级前请备份数据。
:::

升级步骤：

1. 备份数据: `设置 → 数据管理 → 备份`
2. 下载新版本
3. 安装更新
4. 首次启动会自动迁移数据

#### 0.7.0 → 0.8.0

::: tip 提示
向量数据库需要重建索引，可能需要10-30分钟。
:::

#### 0.6.0 → 0.7.0

::: info 信息
新增Git同步功能，需要配置Git仓库。
:::

### 已知问题

#### v0.17.0

- [x] ~~iOS SIMKey支持受系统限制~~ → 已通过eSIM模式解决 (v0.38.0)
- [ ] 部分U盾型号兼容性待测试
- [ ] macOS Sequoia系统通知权限问题

#### v0.8.0

- [x] ~~Windows 11下U盾驱动问题~~ (已在v0.17.0修复)
- [ ] 大文件(>1GB)同步较慢

### 反馈渠道

发现Bug或有建议？

- 🐛 [GitHub Issues](https://github.com/chainlesschain/issues)
- 📧 support@chainlesschain.com
- 💬 [社区论坛](https://community.chainlesschain.com)

---

**感谢所有贡献者的支持！** 🙏

查看[贡献者列表](https://github.com/chainlesschain/graphs/contributors)
