# 92. Deep Agents Deploy 借鉴落地方案

> 版本: v1.0
> 日期: 2026-04-16
> 状态: 设计中
> 适用范围: `packages/cli`、`packages/session-core`、`desktop-app-vue/src/main/ai-engine`、`backend`
> 参考对象: LangChain Deep Agents Deploy / Going to production（2026-04）
> 关联文档: [82. CLI Runtime 收口路线图](./82_CLI_Runtime收口路线图.md) / [88. OpenAgents 对标补齐方案](./88_OpenAgents对标补齐方案.md) / [91. Managed Agents 对标计划](./91_Managed_Agents对标计划.md)

---

## 1. 结论先行

对本项目而言，Deep Agents Deploy 最值得借鉴的不是“再做一套 agent runtime”，而是下面四件事：

1. 把 agent 变成一个可打包、可迁移、可部署的标准单元
2. 把共享指令、技能、MCP、用户记忆拆成稳定边界
3. 明确区分本地模式和部署模式的能力边界
4. 用统一协议出口把 CLI / Desktop / Web / 外部 Agent 连接起来

本项目当前已经具备大量底层能力：

- `@chainlesschain/session-core` 已具备 session / memory / approval / stream 的共享抽象
- `desktop-app-vue` 已具备 MCP、A2A、skills、sandbox、code agent、IPC
- `packages/cli` 已具备 agent runtime、managed agents parity、MCP、memory、skill、session
- `backend` 已具备 code executor 等隔离执行基础

因此，本方案的原则是：

```text
吸收 Deep Agents Deploy 的“封装方式”和“部署边界”，
不替换 ChainlessChain 现有本地优先、多端一体、离线可用的核心优势。
```

---

## 2. 当前现状与可借鉴映射

### 2.1 项目已具备的对应能力

| Deep Agents Deploy 关注点 | 本项目现状 | 结论 |
|---|---|---|
| `AGENTS.md` 作为核心指令 | 仓库根已有 `AGENTS.md` | 已有基础，但尚未产品化为 agent bundle 资产 |
| `skills/` 作为稳定技能目录 | 已有 138+ skills，Desktop/CLI 都能消费 | 明显更强，不需要重造 |
| `mcp.json` / MCP 工具边界 | 已有 MCP SDK、MCP client、MCP tool gateway | 能力更强，但缺“部署态边界” |
| 用户级长期记忆 | `session-core` 有 `session/agent/global` memory | 还缺显式 `user` scope 语义 |
| sandbox 生命周期 | 已有 file sandbox / tool sandbox / code executor | 缺 thread vs assistant 两级生命周期抽象 |
| deployment endpoints | 已有 A2A、MCP、CLI、Desktop IPC | 缺统一“远程 agent service”出口 |

### 2.2 Deep Agents Deploy 关键规格摘要（2026-04 beta）

为避免讨论停留在印象层，本节把原版的可验证事实列出，作为后续对标基线。

#### 2.2.1 入口与打包

- 单条 CLI: `deepagents deploy`
- 打包单元: 一个目录 + 少量文件（`AGENTS.md` / `skills/` / `mcp.json` / 模型参数 / sandbox 参数）
- 运行宿主: LangSmith Deployment server（horizontally scalable，多租户）
- 许可: MIT，Python & TypeScript 双语言 harness

#### 2.2.2 模型与沙箱矩阵

| 维度 | 原版支持 |
|---|---|
| 模型 provider | OpenAI / Anthropic / Google / Azure / Bedrock / Fireworks / Baseten / OpenRouter / Ollama |
| Sandbox provider | Daytona / Runloop / Modal / LangSmith Sandboxes / 自定义 |
| 标准 | AGENTS.md（agents.md 规范）/ Agent Skills（agentskills.io）/ MCP / A2A / Agent Protocol |

#### 2.2.3 部署后自动暴露的 30+ 端点分类

| 类别 | 语义 | 典型用途 |
|---|---|---|
| MCP endpoints | 把 agent 作为 MCP server | 让其他 agent / IDE 调用 |
| A2A endpoints | agent-to-agent 通信 | 多 agent 编排 |
| Agent Protocol | UI 标准交互 | Web / desktop 前端接入 |
| Human-in-the-loop | 审批 / 护栏钩子 | 企业级合规 |
| Memory API | 短期 / 长期记忆读写 | 数据所有权、可迁移 |

#### 2.2.4 设计哲学关键词

- **memory ownership**: 记忆归用户，不绑定单一模型或 harness
- **open standards first**: AGENTS.md / agentskills.io / MCP / A2A / Agent Protocol
- **deployment ≠ lock-in**: 自托管可选，底层 harness 完全开源

---

### 2.3 当前最明显的差距

不是能力不足，而是“能力分散”：

- agent 配置没有稳定的 bundle 目录约定
- CLI / Desktop / Backend 能消费 agent，但没有统一 packaging
- MCP 在本地模式和未来部署模式下没有显式边界定义
- memory 已有 scope，但未把“用户偏好”抽成第一等对象
- sandbox 存在多个实现，但缺少统一生命周期策略
- 现有协议很多，但缺一个对外统一的 hosted agent entrypoint

---

## 3. 不该照搬的地方

### 3.1 不应照搬 LangSmith Deployment

Deep Agents Deploy 的默认宿主是 LangSmith Deployment。本项目不应把设计目标变成“兼容 LangSmith 平台”，原因很直接：

- 本项目是本地优先，不是云端优先
- 本项目强调离线可用、多端一致、硬件安全
- 本项目已有 Desktop + CLI + Backend + Mobile 结构，部署模型更复杂

所以正确方向不是“复制 LangSmith”，而是：

```text
定义 ChainlessChain 自己的 Agent Bundle 和 Runtime Contract，
同时让它兼容本地、局域网、私有部署三种运行形态。
```

### 3.2 不应废弃现有 skills / MCP / sandbox 体系

Deep Agents Deploy 在这些方面给的是统一封装，不是更强的底层能力。本项目已有：

- 更完整的 skills 生态
- 更丰富的 MCP 能力
- 更细的审批 / 权限 / 审计
- 更贴近 coding-agent 的本地执行模型

因此应做“收口”，不做“重写”。

---

## 4. 目标架构

## 4.1 目标一句话

把当前项目的 agent 能力收口成一个统一的 **ChainlessChain Agent Bundle + Agent Runtime Contract**。

## 4.2 目标结构

```text
agent-bundle/
├── chainless-agent.toml
├── AGENTS.md
├── skills/
├── mcp.json
├── USER.md
├── policies/
│   ├── approval.json
│   └── sandbox.json
└── manifests/
    └── capabilities.json
```

建议职责如下：

- `chainless-agent.toml`
  - agent id、显示名、默认模型、运行模式、sandbox 策略
- `AGENTS.md`
  - agent 共享系统指令、项目约定、行为边界
- `skills/`
  - bundle 私有技能，或指向工作区技能层
- `mcp.json`
  - 该 bundle 依赖的 MCP server 声明
- `USER.md`
  - 用户模板记忆，首次会话时 seed 到 user scope
- `policies/approval.json`
  - 默认审批策略与风险映射
- `policies/sandbox.json`
  - sandbox scope、镜像、资源配额、TTL
- `manifests/capabilities.json`
  - 对外暴露协议、可用工具域、版本信息

## 4.2.1 与 `deepagents deploy` 命令的对位

原版一条命令就能把目录打包并拉起服务。本项目等价命令建议分为三条，对应三种运行形态：

```bash
# 本地：把 bundle 挂到现有 CLI runtime
chainlesschain agent run --bundle ./agent-bundle

# 局域网：暴露为 WS + HTTP gateway
chainlesschain agent serve --bundle ./agent-bundle --mode lan --port 18800

# 托管：打包产物并推送到远端 runtime（远期）
chainlesschain agent deploy --bundle ./agent-bundle --target chainless-hub
```

三条命令共享同一个 bundle loader 和 runtime contract，仅 sandbox / MCP policy / 网络暴露策略不同。

---

## 4.3 运行形态

同一份 agent bundle 应支持三种模式：

1. `local`
   - Desktop / CLI 本机运行
   - 允许 stdio MCP、直接文件系统、离线模型
2. `lan`
   - 局域网 / 私有服务运行
   - 优先 HTTP/SSE MCP
   - 可接入统一 auth 与 session service
3. `hosted`
   - 服务端托管运行
   - 禁止 stdio MCP
   - 必须走 HTTP/SSE / API / sandbox

---

## 5. 核心借鉴点与本项目落地方式

### 5.1 借鉴点 A: Agent Bundle 约定式目录

### 现状问题

当前 agent 能力散落在：

- `packages/cli/src/runtime`
- `packages/session-core/lib`
- `desktop-app-vue/src/main/ai-engine`
- `desktop-app-vue/src/main/mcp`

这导致：

- agent 配置难迁移
- Desktop 和 CLI 复用成本偏高
- 后续做托管 agent 时缺清晰打包边界

### 落地建议

新增一个 bundle loader，统一从目录约定加载：

- `AGENTS.md`
- skills
- MCP 配置
- memory seed
- approval policy
- sandbox policy

建议优先落在：

- `packages/session-core`
  - 定义 bundle schema 与解析器
- `packages/cli`
  - 先实现 bundle consume
- `desktop-app-vue`
  - 通过 shim / adapter 复用

### 价值

- 降低多端 agent 定义漂移
- 让“agent 是什么”从代码分支变成显式资产
- 后续可直接支持导入 / 导出 / 分享 / marketplace

---

### 5.2 借鉴点 B: `AGENTS.md` 一等公民化

### 现状问题

仓库已有 [AGENTS.md](/C:/code/chainlesschain/AGENTS.md)，但它当前更像开发协作规范，而不是运行时 agent bundle 的稳定输入。

### 落地建议

将 `AGENTS.md` 拆成两层：

1. 仓库级 `AGENTS.md`
   - 面向工程协作和默认行为
2. bundle 级 `AGENTS.md`
   - 面向具体 agent 的角色、边界、输出风格、工具策略

运行时注入顺序建议：

1. platform/system invariant prompt
2. repository / workspace `AGENTS.md`
3. bundle `AGENTS.md`
4. session recalled memory
5. turn-scoped dynamic context

### 价值

- 减少 prompt 逻辑散落在 JS / IPC / command handler 中
- 让 agent 的行为更可审计、可 diff、可版本化

---

### 5.3 借鉴点 C: 用户记忆显式化

### 现状问题

`MemoryStore` 已支持 `session/agent/global`，见 [packages/session-core/lib/memory-store.js](/C:/code/chainlesschain/packages/session-core/lib/memory-store.js)，但用户偏好目前没有被单独建模成稳定的一层。

这会导致两个问题：

- 用户偏好容易被写进 `agent/global`
- 多 agent 共享用户信息时边界不清晰

### 落地建议

在 `session-core` 增加 `user` scope：

- `session`: 本次会话临时事实
- `agent`: 某 agent 的共享记忆
- `user`: 某用户跨 agent 的偏好与档案
- `global`: 组织级 / 平台级只读策略

同时增加 bundle 级 `USER.md` seed 机制：

- 首次访问时，将 `USER.md` 模板写入 user scope
- 后续会话只读入，不覆盖已有用户记忆

### 价值

- 更贴近 Deep Agents 的 user memory 模型
- 更适合多端统一用户画像
- 有助于防止把用户偏好和组织级规则混写

---

### 5.4 借鉴点 D: 部署态 MCP 边界

### 现状问题

当前项目 MCP 能力比 Deep Agents 更完整，但“本地态”和“部署态”缺边界定义。尤其未来如果要做 hosted agent，`stdio` MCP 直接复用会有很高的不确定性。

### 落地建议

显式定义两套规则：

1. Local MCP Policy
   - 允许 `stdio` / HTTP / SSE
   - 允许本机进程拉起
2. Hosted MCP Policy
   - 只允许 HTTP / SSE
   - 禁止依赖宿主机拉本地进程
   - 必须通过 registry / trust policy / auth 进入

建议补的工程点：

- `mcp.json` schema 增加 `modeCompatibility`
- runtime 在 hosted 模式下拒绝 `stdio`
- CLI / Desktop UI 显示“该 MCP server 仅本地可用”

### 价值

- 降低未来部署模式的运行时分叉
- 明确安全边界
- 减少“本地可跑，部署即坏”的灰区

---

### 5.5 借鉴点 E: Sandbox 生命周期模型

### 现状问题

当前项目已有多个 sandbox 实现，但更多是“是否隔离”的问题，缺的是“隔离环境活多久”的统一模型。

### 落地建议

统一抽象为两类：

1. `thread` scope
   - 每个 session / thread 一个 sandbox
   - 适合一次性分析、短任务、临时执行
2. `assistant` scope
   - 某个 agent / assistant 共享长期 sandbox
   - 适合 coding agent、工作区代理、项目助理

可以优先映射到现有实现：

- `backend/code-executor`
- `desktop-app-vue/src/main/ai-engine/*sandbox*`
- `cowork/file-sandbox`

并补充统一字段：

- `scope`
- `ttl`
- `maxDiskMb`
- `maxMemoryMb`
- `baseImage`
- `networkPolicy`

### 价值

- 提升 coding agent 的长期工作区稳定性
- 让清理、恢复、审计策略可统一
- 降低 Desktop / CLI / Backend 三套执行模型的概念差异

---

### 5.6 借鉴点 F: 对外统一 Agent Service

### 现状问题

项目已有：

- CLI agent
- Desktop code agent
- A2A engine
- MCP integration
- IPC / WS gateway

但对外仍缺一个明确的“统一 agent service 层”。

### 与 Deep Agents 30+ 端点的对位

下表把原版五大类端点映射到本项目现有能力，用于判断“补齐 vs 新建”。

| Deep Agents 端点类别 | 对应本项目能力 | 差距判断 |
|---|---|---|
| MCP endpoints | `desktop-app-vue/src/main/mcp/*`、`packages/cli mcp *` | 能力齐，但缺“把本 agent 作为 MCP server 导出” |
| A2A endpoints | `cli a2a register/discover/submit`、A2A engine | 协议已有，缺统一 HTTP/SSE 出口 |
| Agent Protocol | IPC envelope / StreamRouter (Phase F) | envelope 已统一，缺对外 HTTP adapter |
| Human-in-the-loop | `ApprovalGate` (session-core) + `approvalFlow` 字段 | 策略已有，缺 webhook/回调通道 |
| Memory API | `MemoryStore` scoped memory + `memory store/recall` | scope 齐，缺远程只读 API 和 ETag/版本 |

结论：**协议层不缺，出口层缺**。本项目不应再造第二套 runtime，而是把 session-core 的 envelope + ApprovalGate + MemoryStore 通过一层统一 HTTP/SSE gateway 暴露。

### 落地建议

定义 `Chainless Agent Service`，统一暴露：

- `session/create`
- `session/resume`
- `runs/stream`
- `memory/recall`
- `approval/decision`
- `tools/list`
- `a2a/submit`
- `mcp/invoke`
- `agent/export-as-mcp`（新增，用于把本 agent 反向注册成 MCP server）

协议层不必一步到位，但建议先统一内部 contract：

- 先在 `session-core` 定义 event / envelope
- 再让 CLI、Desktop IPC、WS gateway 消费同一协议

### 价值

- 为 Web / Mobile / 外部 agent 接入打通基础层
- 避免将来再做第三套 agent host
- 与 [91_Managed_Agents对标计划.md](/C:/code/chainlesschain/docs/design/modules/91_Managed_Agents%E5%AF%B9%E6%A0%87%E8%AE%A1%E5%88%92.md) 的 session-core 收口方向一致

---

## 6. 分阶段实施方案

### Phase 1: Agent Bundle 基础设施

### 目标

先把“agent 是什么”收口成可加载、可校验、可序列化的 bundle。

### 交付

- `packages/session-core/lib/agent-bundle-schema.js`
- `packages/session-core/lib/agent-bundle-loader.js`
- `packages/session-core/lib/agent-bundle-resolver.js`
- `packages/session-core/__tests__/agent-bundle-*.test.js`

### 范围

- 支持 `chainless-agent.toml`
- 自动发现 `AGENTS.md` / `skills/` / `mcp.json` / `USER.md`
- 返回 canonical bundle object

### 验收

- CLI 可从 bundle 启动 agent
- Desktop 可通过 adapter 读取同一 bundle
- bundle 解析结果可稳定 snapshot

### 优先级

`P0`

---

### Phase 2: User Memory 与 Bundle Memory Seed

### 目标

将用户记忆从隐式逻辑升级为显式一层。

### 交付

- `MemoryStore` 增加 `USER` scope
- `MemoryConsolidator` 支持写入 user scope
- bundle loader 支持 `USER.md`
- CLI memory 命令支持 `--scope user`

### 验收

- 新用户首次访问自动 seed
- 同一用户跨 session 可召回偏好
- 不会覆盖已有用户记忆

### 优先级

`P0`

---

### Phase 3: Hosted MCP Policy

### 目标

显式切开 local MCP 与 hosted MCP 规则。

### 交付

- `mcp.json` schema 扩展
- runtime mode = `local|lan|hosted`
- hosted 模式拒绝 `stdio`
- MCP 管理界面显示兼容模式

### 验收

- 本地 agent 仍兼容现有 `stdio`
- hosted mode 下 bundle 校验阶段直接拦截不兼容 server

### 优先级

`P1`

---

### Phase 4: Sandbox 生命周期统一

### 目标

让 sandbox 的“作用域”和“生命周期”成为统一配置，而不是散落在不同执行器里。

### 交付

- sandbox policy schema
- `thread` / `assistant` scope
- TTL / quota / cleanup contract
- coding agent session service 适配

### 验收

- coding agent 可选长期 workspace
- 短任务 agent 默认使用 thread scope
- session 恢复时 sandbox 复用或重建行为明确

### 优先级

`P1`

---

### Phase 5: Unified Agent Service Contract

### 目标

用统一 contract 把 CLI / Desktop / WS / Backend 连接起来。

### 交付

- `session-core` 定义 agent service event envelope
- CLI gateway 消费该 envelope
- Desktop IPC / WS gateway 对齐该 envelope
- 为 hosted agent 预留 HTTP service adapter

### 验收

- CLI / Desktop 不再维护两套流式事件真相
- 对外暴露统一 session/run/approval/memory 语义

### 优先级

`P2`

---

## 7. 风险与控制

### 风险 1: 又做一套新概念，导致复杂度上升

控制方式：

- 所有 bundle / service / policy 抽象优先下沉到 `session-core`
- Desktop 只做消费，不再新建平行语义

### 风险 2: 过早追求 hosted，影响本地优先体验

控制方式：

- 默认模式仍是 `local`
- `hosted` 相关限制只在 hosted mode 生效

### 风险 3: 破坏现有 skills / MCP / coding agent 流程

控制方式：

- Phase 1-2 只做增量封装，不动既有行为
- 用 adapter 逐步迁移，不大爆炸式重构

### 风险 4: 把用户记忆和共享策略混用

控制方式：

- `user` scope 单独建模
- `global` 默认只读
- approval / memory policy 显式化

---

## 8. 推荐的近期执行顺序

最现实的顺序不是 5 个阶段并行，而是：

1. 先做 Agent Bundle Loader
2. 再做 User Memory scope
3. 然后补 Hosted MCP Policy
4. 再统一 Sandbox 生命周期
5. 最后收口 Unified Agent Service

理由很简单：

- bundle 是所有后续工作的入口
- user memory 是最直接的产品收益点
- hosted MCP 是未来部署模式必须先补的边界
- sandbox 生命周期会影响 coding agent 稳定性
- 统一 service contract 必须建立在前面边界已稳定的前提下

---

## 9. 最终判断

Deep Agents Deploy 对本项目最有价值的启发，不是“替换本项目现有 agent 架构”，而是：

- 用 bundle 统一 agent 定义
- 用明确边界切开本地与部署
- 用 user memory 提升长期个性化
- 用统一协议层支撑跨端与托管

如果按收益 / 成本比排序，最值得优先做的是：

1. Agent Bundle
2. User Memory
3. Hosted MCP Policy

这三项做完，本项目就会从“能力很多的 agent 系统”进化成“有稳定封装边界的 agent 平台”。

---

## 10. 后续拆解建议

本文档之后，建议继续拆出三份执行文档：

1. `92A_Agent_Bundle_Schema_设计.md`
2. `92B_User_Memory_作用域改造.md`
3. `92C_Hosted_MCP_兼容矩阵.md`

这样可以直接进入实现，不需要再次从概念层讨论。

---

## 11. 参考资料

- [Deep Agents Deploy: an open alternative to Claude Managed Agents (LangChain Blog, 2026-04-09)](https://www.langchain.com/blog/deep-agents-deploy-an-open-alternative-to-claude-managed-agents/)
- [Deep Agents overview — LangChain Docs](https://docs.langchain.com/oss/python/deepagents/overview)
- [Deep Agents v0.5 release notes](https://blog.langchain.com/deep-agents-v0-5/)
- [langchain-ai/deepagents on GitHub](https://github.com/langchain-ai/deepagents)
- [AGENTS.md 规范](https://agents.md/)
- [Agent Skills 规范](https://agentskills.io/)
- 本项目关联文档:
  - [82. CLI Runtime 收口路线图](./82_CLI_Runtime收口路线图.md)
  - [88. OpenAgents 对标补齐方案](./88_OpenAgents对标补齐方案.md)
  - [91. Managed Agents 对标计划](./91_Managed_Agents对标计划.md)
