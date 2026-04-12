# Cowork 路线图

> **版本: v1.2.0-v4.0 | 自进化代理 | 全自动开发 | 自然语言编程 | 多模态协作 | 自主运维 | 去中心化代理网络**

## 概述

Cowork 路线图记录了从 v1.2.0 到 v4.0 的多智能体协作系统演进路径，涵盖自进化代理、全自动开发流水线、自然语言编程（NL→Spec）、多模态协作（音视频/图像/文档融合）、自主运维（异常检测/自动修复）以及去中心化代理网络（Agent DID/联邦发现/跨组织路由）等关键里程碑。

> 基础功能请参阅 [Cowork 核心文档](/chainlesschain/cowork) | 高级功能请参阅 [Cowork 高级功能](/chainlesschain/cowork-advanced)

## 核心特性

- 🤖 **自进化代理**: 代理自动学习、优化策略，持续提升任务执行效率
- 🏗️ **全自动开发流水线**: 从需求解析到部署监控的 7 阶段全自动化开发
- 💬 **自然语言编程**: NL→Spec 规范翻译，多轮消歧，自然语言驱动代码生成
- 🎨 **多模态协作**: 文本/图像/音频/视频多模态融合，跨模态上下文理解
- 🔧 **自主运维**: 异常检测、事件分类、自动修复、回滚管理、事后报告
- 🌐 **去中心化代理网络**: Agent 联邦注册、DID 身份认证、跨组织任务路由

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│                  Cowork Evolution                     │
├──────────┬──────────┬──────────┬─────────────────────┤
│ v1.2.0   │ v2.0     │ v3.0     │ v4.0                │
│ Instinct │ Full-Auto│ NL Prog  │ Agent Federation    │
│ Learning │ Dev      │ Multimod │ Cross-Org Routing   │
├──────────┴──────────┴──────────┴─────────────────────┤
│  Pipeline Orchestrator (7 阶段) + Deploy Agent       │
├──────────────────────────────────────────────────────┤
│  AnomalyDetector │ IncidentClassifier │ AutoRemediate│
├──────────────────┴──────────────┬────────────────────┤
│  ModalityFusion │ MultimodalCtx │ MultimodalOutput   │
├─────────────────┴───────────────┴────────────────────┤
│  AgentDID │ AgentReputation │ FederatedAgentRegistry │
└──────────────────────────────────────────────────────┘
```

## 未来规划

---

### v1.2.0 — 专业化代理与智能调度 ✅

**目标**: Instinct 学习系统 + Orchestrate 编排工作流 + Verification Loop 验证流水线

#### 已完成

- [x] **Instinct Learning System** — 自动从 Hook 观测中提取可复用模式，置信度强化/衰减，上下文感知检索，LLM Prompt 自动注入（11 IPC handlers, ~1,380 行）
- [x] **Orchestrate Workflow Skill** — 4 种预置工作流模板（feature/bugfix/refactor/security-audit），代理交接协议，AgentCoordinator 集成（~620 行）
- [x] **Verification Loop Skill** — 6 阶段自动化验证流水线（Build → TypeCheck → Lint → Test → Security → DiffReview），项目类型自动检测，READY/NOT READY 裁决（~665 行）
- [x] **Context Engineering 集成** — InstinctManager 注入 ContextEngineering，自动在 KV-Cache Prompt 中添加已学习模式
- [x] **数据库 Schema** — instincts + instinct_observations 表，含索引
- [x] **IPC Registry Phase 17** — Instinct Learning System 11 个 IPC handler 注册

#### 代理能力画像（已实现基础版 — Instinct 驱动）

```
Instinct 驱动的能力画像:

  Instinct Cache (示例):
  ┌────────────────────────────────────────────┐
  │ [tool-preference] confidence: 0.72         │
  │   "User frequently uses file_reader"       │
  │                                            │
  │ [workflow] confidence: 0.35                │
  │   "Sequence: file_reader → analyzer → writer" │
  │                                            │
  │ [error-fix] confidence: 0.60               │
  │   "Recurring error: ENOENT on config path" │
  │                                            │
  │ [coding-pattern] confidence: 0.55          │
  │   "Prefers async/await over callbacks"     │
  │                                            │
  │ 进化: 自动从 PostToolUse 事件提取          │
  │ 注入: ContextEngineering 第 4.5 步         │
  └────────────────────────────────────────────┘
```

#### v1.3.0 — ML 调度、负载均衡、CI/CD 优化、API 文档

- [x] **ML 驱动的任务调度** — 基于历史数据训练轻量模型，预测任务复杂度和资源需求 → `ml-task-scheduler.js` (8 IPC handlers)
- [x] **动态负载均衡** — 实时监控代理负载，自动迁移任务到空闲代理 → `load-balancer.js` (8 IPC handlers)
- [x] **CI/CD 深度优化** — 智能测试选择（70%+ 缓存命中率）、增量构建编排 → `cicd-optimizer.js` (10 IPC handlers)
- [x] **API 文档自动生成** — 扫描 IPC handlers 和函数签名，生成 OpenAPI/Swagger 文档 → `ipc-api-doc-generator.js` (6 IPC handlers)

##### ML 驱动的任务调度

MLTaskScheduler 使用加权线性回归模型（无外部 ML 依赖）预测任务复杂度：

- **特征提取**: 词数、关键词密度、子任务数、优先级权重、任务类型基准
- **在线学习**: 任务完成后通过指数移动平均 (EMA) 更新权重
- **复杂度预测**: 1-10 分制，附带置信度评估
- **资源估算**: 根据复杂度推荐代理数量、Token 预算、预估耗时
- **批量再训练**: 支持从数据库历史数据全量重新训练

```javascript
// 预测任务复杂度
const result = await window.electron.ipcRenderer.invoke(
  "ml-scheduler:predict-complexity",
  "重构认证模块，支持 OAuth2.0 + PKCE 流程",
  { priority: "high", type: "refactoring" },
);
// result.data = { complexity: 7.2, confidence: 0.68, estimatedDurationMs: 129600, ... }

// 预测资源需求
const resources = await window.electron.ipcRenderer.invoke(
  "ml-scheduler:predict-resources",
  7.2,
  "refactoring",
);
// resources.data = { agentCount: 3, tokenBudget: 15000, tier: 4, ... }
```

| IPC Channel                           | 功能               |
| ------------------------------------- | ------------------ |
| `ml-scheduler:predict-complexity`     | 预测任务复杂度     |
| `ml-scheduler:predict-resources`      | 预测资源需求       |
| `ml-scheduler:get-model-stats`        | 模型准确率、样本量 |
| `ml-scheduler:retrain`                | 强制批量再训练     |
| `ml-scheduler:get-history`            | 历史预测 vs 实际   |
| `ml-scheduler:get-feature-importance` | 特征权重排名       |
| `ml-scheduler:configure`              | 更新调度器配置     |
| `ml-scheduler:get-config`             | 获取当前配置       |

##### 动态负载均衡

LoadBalancer 实时监控每个代理的负载指标，自动建议任务迁移：

- **复合负载评分**: `0.4*taskLoad + 0.3*queueDepth + 0.2*errorRate + 0.1*responseTime`
- **健康监控**: 30s 心跳检查，自动标记无响应代理
- **自动重平衡**: 当代理负载超过阈值 (0.8) 时建议迁移
- **负载卸载**: 系统整体负载 > 90% 时拒绝新任务

```javascript
// 获取系统负载
const load = await window.electron.ipcRenderer.invoke(
  "load-balancer:get-system-load",
);
// load.data = { agents: [...], avgLoad: 0.45, maxLoad: 0.72, loadSheddingActive: false }

// 建议最佳代理
const suggestion = await window.electron.ipcRenderer.invoke(
  "load-balancer:suggest-assignment",
  { type: "code-review", priority: "high" },
);
// suggestion.data = { agentId: "agent-3", loadScore: 0.21, reason: "Least loaded agent" }
```

| IPC Channel                        | 功能                 |
| ---------------------------------- | -------------------- |
| `load-balancer:get-metrics`        | 所有代理负载指标     |
| `load-balancer:get-agent-load`     | 单个代理负载         |
| `load-balancer:get-system-load`    | 系统负载摘要         |
| `load-balancer:suggest-assignment` | 推荐最优代理         |
| `load-balancer:migrate-task`       | 迁移任务到其他代理   |
| `load-balancer:set-threshold`      | 配置负载阈值         |
| `load-balancer:get-history`        | 负载历史（图表数据） |
| `load-balancer:get-config`         | 获取均衡器配置       |

##### CI/CD 深度优化

CICDOptimizer 通过依赖图分析和缓存实现智能测试选择和增量构建：

- **测试缓存**: SHA256(变更文件集) → 缓存测试选择结果，相同变更复用
- **依赖图**: 解析 require/import 构建传递性依赖树
- **Flakiness 评分**: 追踪测试通过/失败历史，计算不稳定度
- **覆盖映射**: 源文件 ↔ 测试文件双向映射
- **增量构建**: DAG 拓扑排序，并行执行无依赖步骤

```javascript
// 智能测试选择
const result = await window.electron.ipcRenderer.invoke("cicd:select-tests", [
  "src/main/llm/context-engineering.js",
  "src/main/llm/session-manager.js",
]);
// result.data = { tests: ["tests/context.test.js", ...], cached: true, hitRate: "75%" }

// 增量构建计划
const plan = await window.electron.ipcRenderer.invoke("cicd:plan-build", [
  "src/main/llm/context-engineering.js",
]);
// plan.data = { steps: [...], savedTimeMs: 85000, savingsPercent: "71%" }
```

| IPC Channel                 | 功能                |
| --------------------------- | ------------------- |
| `cicd:select-tests`         | 智能测试选择        |
| `cicd:get-cache-stats`      | 缓存命中率          |
| `cicd:clear-cache`          | 清除测试缓存        |
| `cicd:get-test-history`     | 测试 Flakiness 数据 |
| `cicd:get-dependency-graph` | 依赖图可视化        |
| `cicd:plan-build`           | 生成增量构建计划    |
| `cicd:execute-build-step`   | 执行单个构建步骤    |
| `cicd:get-build-cache`      | 构建缓存统计        |
| `cicd:analyze-coverage`     | 源码→测试覆盖分析   |
| `cicd:get-config`           | 获取优化器配置      |

##### API 文档自动生成

IPCApiDocGenerator 扫描所有 `*-ipc.js` 文件，提取 IPC handler 定义，生成 OpenAPI 3.0 规范和 Markdown 文档：

- **Handler 扫描**: 递归发现所有 IPC 文件，正则 + JSDoc 解析
- **参数提取**: 从函数签名、解构模式、`@param` 标签提取
- **响应推断**: 检测 `{ success, data, error }` 标准模式
- **OpenAPI 3.0**: 每个 IPC channel 映射为 `POST /ipc/{namespace}/{operation}`
- **Markdown 输出**: 按命名空间分组的可读 API 参考

```javascript
// 生成完整文档
const docs = await window.electron.ipcRenderer.invoke("api-docs:generate", {
  rescan: true,
});
// docs.data = { openApiSpec: {...}, markdown: "# ChainlessChain IPC API\n...", stats: {...} }

// 查询特定 channel
const info = await window.electron.ipcRenderer.invoke(
  "api-docs:get-channel-info",
  "instinct:get-all",
);
// info.data = { channel, params, response, file, line, jsdoc }
```

| IPC Channel                 | 功能                    |
| --------------------------- | ----------------------- |
| `api-docs:generate`         | 生成 OpenAPI + Markdown |
| `api-docs:scan-handlers`    | 扫描所有 IPC handlers   |
| `api-docs:get-spec`         | 获取 OpenAPI 规范       |
| `api-docs:get-channel-info` | 查询特定 channel 信息   |
| `api-docs:get-stats`        | Handler 统计            |
| `api-docs:get-config`       | 获取生成器配置          |

#### 关键文件

| 文件                                                                    | 行数   | 职责                      |
| ----------------------------------------------------------------------- | ------ | ------------------------- |
| `src/main/llm/instinct-manager.js`                                      | ~1,100 | Instinct 管理核心         |
| `src/main/llm/instinct-ipc.js`                                          | ~280   | 11 个 IPC Handler         |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/handler.js`       | ~507   | Orchestrate 编排引擎      |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/SKILL.md`         | ~112   | Orchestrate 技能定义      |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/handler.js` | ~547   | Verification Loop 引擎    |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/SKILL.md`   | ~118   | Verification Loop 定义    |
| `src/main/llm/context-engineering.js`                                   | +35    | Instinct 上下文注入集成   |
| `src/main/database.js`                                                  | +30    | instincts/observations 表 |
| `src/main/ipc/ipc-registry.js`                                          | +44    | Phase 17 注册             |

---

### v2.0.0 — 跨设备协作与分布式执行 ✅

**目标**: 突破单设备限制，实现桌面端、Android、iOS 三端协同的多智能体网络

#### 已完成

- [x] **P2P Agent Network** — 基于 WebRTC DataChannel + MobileBridge 的跨设备代理通信，15 种消息类型，心跳监测，任务委派/结果回传（~680 行）
- [x] **Device Discovery** — 自动发现网络设备及其能力，4 级能力分层（full/standard/light/cloud），技能→设备索引，最优设备路由（~420 行）
- [x] **Hybrid Executor** — 6 种执行策略（local-only/remote-only/local-first/remote-first/best-fit/load-balance），4 级任务权重分类，批量执行，回退重试（~510 行）
- [x] **Computer Use Bridge** — 12 个 AI 工具映射为 Cowork 技能，录制回放共享库，FileSandbox + SafeMode 统一权限（~430 行）
- [x] **Cowork API Server** — RESTful API（20+ 端点），SSE 实时事件推送，Bearer/API-Key 认证，CORS，限流（~520 行）
- [x] **Webhook Manager** — 17 种事件类型，HMAC 签名验证，指数退避重试（3 次），投递日志持久化（~530 行）
- [x] **IPC Handler 注册** — 34 个 IPC handler（Phase 18），6 模块全覆盖
- [x] **数据库 Schema** — 4 张新表（p2p_remote_agents, p2p_remote_tasks, cowork_webhooks, cowork_webhook_deliveries）

#### 跨设备协作架构

```
┌──────────────────┐     WebRTC      ┌──────────────────┐
│   Desktop 端      │ ◄─────────────► │   Android 端      │
│                   │   DataChannel   │                   │
│  92 Skills 全量   │                │  28 Skills 本地   │
│  GPU 加速         │                │  8 REMOTE 技能    │
│  全能力代理      │                │  轻量代理         │
└────────┬──────────┘                └────────┬──────────┘
         │                                     │
         │           WebRTC                    │
         │      ┌─────────────┐                │
         └──────┤ Signaling   ├────────────────┘
                │ Server 9001 │
         ┌──────┤             ├────────────────┐
         │      └─────────────┘                │
         │                                     │
┌────────┴──────────┐                ┌────────┴──────────┐
│   iOS 端           │                │   云端（可选）     │
│                   │                │                   │
│  ComputerUse 工具 │                │  大模型推理       │
│  12 AI Tools      │                │  分布式计算       │
└───────────────────┘                └───────────────────┘

  技能委派路由:
  Android REMOTE skill → P2PSkillBridge → Desktop 执行 → 结果回传
```

#### P2P Agent Network

基于现有 WebRTC DataChannel 和 MobileBridge 基础设施，实现跨设备代理通信协议：

**15 种消息类型**:

| 消息类型                      | 方向 | 说明                    |
| ----------------------------- | ---- | ----------------------- |
| `cowork:agent-announce`       | 双向 | 设备上线广播 + 能力通告 |
| `cowork:agent-depart`         | 广播 | 设备下线通知            |
| `cowork:agent-heartbeat`      | 广播 | 心跳保活 + 资源状态更新 |
| `cowork:task-delegate`        | 单向 | 委派任务到远程设备      |
| `cowork:task-accept`          | 回复 | 远程设备接受任务        |
| `cowork:task-reject`          | 回复 | 远程设备拒绝任务        |
| `cowork:task-progress`        | 单向 | 远程任务进度更新        |
| `cowork:task-result`          | 回复 | 远程任务执行结果        |
| `cowork:task-cancel`          | 单向 | 取消远程任务            |
| `cowork:skill-query`          | 广播 | 查询远程技能可用性      |
| `cowork:skill-response`       | 回复 | 远程技能查询响应        |
| `cowork:team-sync`            | 多播 | 团队状态同步            |
| `cowork:team-invite`          | 单向 | 邀请远程代理加入团队    |
| `cowork:team-invite-response` | 回复 | 团队邀请响应            |

```javascript
// 委派任务到远程设备
const result = await p2pNetwork.delegateTask("mobile-peer-001", {
  skillId: "code-review",
  description: "Review the authentication module",
  input: { files: ["src/auth/*.js"] },
  priority: "HIGH",
  timeout: 120000,
});
```

#### Device Discovery

自动发现网络中各设备的可用技能和计算资源：

**4 级能力分层**:

| 层级     | 标识       | 典型设备           | 特征                  |
| -------- | ---------- | ------------------ | --------------------- |
| Full     | `full`     | Desktop (Win/Mac)  | 92+ 技能, GPU, 全能力 |
| Standard | `standard` | Android (10+ 技能) | 12+ native handler    |
| Light    | `light`    | Android (REMOTE)   | 仅委派到 Desktop 执行 |
| Cloud    | `cloud`    | 云端 Worker        | 大模型推理, 重计算    |

```javascript
// 查找能执行指定技能的最佳设备
const device = deviceDiscovery.getBestDeviceForSkill("data-analysis", {
  minCpus: 4,
  minMemoryMB: 2048,
});
// → { deviceId: "local", platform: "win32", tier: "full", ... }

// 获取全网络技能目录
const catalog = deviceDiscovery.getNetworkSkillCatalog();
// → [{ skillId: "code-review", availableOn: [{deviceId, platform, tier}, ...] }, ...]
```

#### Hybrid Executor

智能任务路由引擎，6 种执行策略：

| 策略         | 标识           | 行为                                |
| ------------ | -------------- | ----------------------------------- |
| Local Only   | `local-only`   | 强制本地执行                        |
| Remote Only  | `remote-only`  | 强制远程执行                        |
| Local First  | `local-first`  | 优先本地，失败回退远程              |
| Remote First | `remote-first` | 优先远程，失败回退本地              |
| Best Fit     | `best-fit`     | 根据任务权重 + 设备能力评分选择最优 |
| Load Balance | `load-balance` | 滚动窗口负载均衡，选择最空闲设备    |

**4 级任务权重分类**:

| 权重   | 典型技能                              | 特征            |
| ------ | ------------------------------------- | --------------- |
| light  | text-transformer, json-yaml, regex    | < 5s, 低计算    |
| medium | code-review, lint-and-fix, test-gen   | 5-30s, 中等计算 |
| heavy  | data-analysis, web-scraping, research | 30s+, 高计算    |
| gpu    | computer-use, image-editor, OCR       | 需 GPU 加速     |

```javascript
// Best-fit 执行
const result = await hybridExecutor.execute({
  skillId: "code-review",
  description: "Review authentication module",
  input: { files: ["src/auth/*.js"] },
  strategy: "best-fit",
});
// result._executedOn → "local" 或 "remote:device-abc123"

// 批量负载均衡执行
const results = await hybridExecutor.executeBatch(
  [
    { skillId: "code-review", input: { file: "a.js" } },
    { skillId: "security-audit", input: { file: "b.js" } },
    { skillId: "test-generator", input: { file: "c.js" } },
  ],
  { concurrency: 3, strategy: "load-balance" },
);
```

#### Computer Use Bridge

12 个 AI 工具映射为 Cowork 技能：

| CU 工具              | Cowork 技能 ID          | 权重   |
| -------------------- | ----------------------- | ------ |
| `browser_click`      | `cu-browser-click`      | light  |
| `visual_click`       | `cu-visual-click`       | medium |
| `browser_type`       | `cu-browser-type`       | light  |
| `browser_key`        | `cu-browser-key`        | light  |
| `browser_scroll`     | `cu-browser-scroll`     | light  |
| `browser_screenshot` | `cu-browser-screenshot` | light  |
| `analyze_page`       | `cu-analyze-page`       | medium |
| `browser_navigate`   | `cu-browser-navigate`   | light  |
| `browser_wait`       | `cu-browser-wait`       | light  |
| `desktop_screenshot` | `cu-desktop-screenshot` | medium |
| `desktop_click`      | `cu-desktop-click`      | light  |
| `desktop_type`       | `cu-desktop-type`       | light  |

**录制回放共享**:

```javascript
// 代理 A 共享录制
const shareId = bridge.shareRecording(
  "rec-001",
  {
    steps: [
      { tool: "browser_navigate", params: { url: "https://example.com" } },
      { tool: "browser_click", params: { selector: "#login" } },
      {
        tool: "browser_type",
        params: { selector: "#email", text: "user@..." },
      },
    ],
    metadata: { stopOnError: true },
  },
  { agentId: "agent-A" },
);

// 代理 B 回放
const result = await bridge.replaySharedRecording(shareId, {
  agentId: "agent-B",
});
// → { success: true, totalSteps: 3, executedSteps: 3, results: [...] }
```

#### Cowork API Server

RESTful API 端点（默认端口 9100）：

| 方法     | 路径                              | 功能           |
| -------- | --------------------------------- | -------------- |
| `GET`    | `/api/v1/cowork/health`           | 健康检查       |
| `GET`    | `/api/v1/cowork/stats`            | 综合统计       |
| `GET`    | `/api/v1/cowork/teams`            | 列出团队       |
| `POST`   | `/api/v1/cowork/teams`            | 创建团队       |
| `GET`    | `/api/v1/cowork/teams/:id`        | 团队详情       |
| `DELETE` | `/api/v1/cowork/teams/:id`        | 销毁团队       |
| `POST`   | `/api/v1/cowork/teams/:id/tasks`  | 分配任务       |
| `GET`    | `/api/v1/cowork/teams/:id/tasks`  | 团队任务列表   |
| `POST`   | `/api/v1/cowork/teams/:id/agents` | 加入团队       |
| `GET`    | `/api/v1/cowork/teams/:id/agents` | 成员列表       |
| `GET`    | `/api/v1/cowork/skills`           | 技能列表       |
| `POST`   | `/api/v1/cowork/skills/execute`   | 执行技能       |
| `GET`    | `/api/v1/cowork/devices`          | 设备列表       |
| `GET`    | `/api/v1/cowork/devices/skills`   | 全网络技能目录 |
| `GET`    | `/api/v1/cowork/webhooks`         | Webhook 列表   |
| `POST`   | `/api/v1/cowork/webhooks`         | 注册 Webhook   |
| `DELETE` | `/api/v1/cowork/webhooks/:id`     | 删除 Webhook   |
| `GET`    | `/api/v1/cowork/events`           | SSE 实时事件流 |

**认证方式**:

```bash
# Bearer Token
curl -H "Authorization: Bearer <token>" http://localhost:9100/api/v1/cowork/teams

# API Key
curl -H "X-API-Key: <key>" http://localhost:9100/api/v1/cowork/teams
```

#### Webhook Manager

17 种事件类型，HMAC 签名验证，指数退避重试：

| 事件类型                    | 触发条件       |
| --------------------------- | -------------- |
| `team.created`              | 新团队创建     |
| `team.destroyed`            | 团队销毁       |
| `team.paused`               | 团队暂停       |
| `team.resumed`              | 团队恢复       |
| `agent.joined`              | 代理加入团队   |
| `agent.terminated`          | 代理终止       |
| `agent.remote.connected`    | 远程代理连接   |
| `agent.remote.disconnected` | 远程代理断开   |
| `task.assigned`             | 任务分配       |
| `task.completed`            | 任务完成       |
| `task.failed`               | 任务失败       |
| `task.delegated`            | 任务委派到远程 |
| `skill.executed`            | 技能执行成功   |
| `skill.failed`              | 技能执行失败   |
| `vote.completed`            | 投票决策完成   |
| `device.discovered`         | 新设备发现     |
| `device.offline`            | 设备离线       |

```javascript
// 注册 Webhook
const webhook = webhookManager.registerWebhook({
  url: "https://ci.example.com/cowork-hook",
  events: ["task.completed", "task.failed"],
  secret: "my-hmac-secret",
});

// 请求头包含 HMAC 签名:
// X-Webhook-Signature: sha256=<hex-digest>
// X-Webhook-Event: task.completed
// X-Webhook-Delivery: dlv-abc12345
```

#### v2.0.0 IPC 通道（34 个 — Phase 18）

**P2P Agent Network（9 个）**:

| 通道                          | 功能                 |
| ----------------------------- | -------------------- |
| `p2p-agent:get-remote-agents` | 获取远程代理列表     |
| `p2p-agent:find-for-skill`    | 按技能查找远程代理   |
| `p2p-agent:delegate-task`     | 委派任务到远程       |
| `p2p-agent:cancel-task`       | 取消远程任务         |
| `p2p-agent:query-skill`       | 广播查询远程技能     |
| `p2p-agent:invite-to-team`    | 邀请远程代理加入团队 |
| `p2p-agent:sync-team`         | 同步团队状态到远程   |
| `p2p-agent:announce`          | 广播本地设备在线     |
| `p2p-agent:get-stats`         | P2P 网络统计         |

**Device Discovery（5 个）**:

| 通道                        | 功能               |
| --------------------------- | ------------------ |
| `device:get-all`            | 获取所有设备       |
| `device:get-by-id`          | 获取指定设备详情   |
| `device:find-for-skill`     | 按技能查找最优设备 |
| `device:get-network-skills` | 全网络技能目录     |
| `device:get-stats`          | 设备发现统计       |

**Hybrid Executor（3 个）**:

| 通道                   | 功能             |
| ---------------------- | ---------------- |
| `hybrid:execute`       | 智能路由执行任务 |
| `hybrid:execute-batch` | 批量负载均衡执行 |
| `hybrid:get-stats`     | 执行器统计       |

**Computer Use Bridge（6 个）**:

| 通道                         | 功能             |
| ---------------------------- | ---------------- |
| `cu-bridge:execute`          | 执行 CU 工具动作 |
| `cu-bridge:share-recording`  | 共享录制         |
| `cu-bridge:list-recordings`  | 列出共享录制     |
| `cu-bridge:replay-recording` | 回放共享录制     |
| `cu-bridge:get-permissions`  | 获取代理 CU 权限 |
| `cu-bridge:get-stats`        | CU Bridge 统计   |

**Cowork API Server（4 个）**:

| 通道                       | 功能          |
| -------------------------- | ------------- |
| `cowork-api:start`         | 启动 API 服务 |
| `cowork-api:stop`          | 停止 API 服务 |
| `cowork-api:get-status`    | 获取服务状态  |
| `cowork-api:broadcast-sse` | 广播 SSE 事件 |

**Webhook Manager（7 个）**:

| 通道                       | 功能              |
| -------------------------- | ----------------- |
| `webhook:register`         | 注册 Webhook      |
| `webhook:unregister`       | 删除 Webhook      |
| `webhook:update`           | 更新 Webhook 配置 |
| `webhook:list`             | 列出所有 Webhook  |
| `webhook:dispatch`         | 手动派发事件      |
| `webhook:get-delivery-log` | 获取投递日志      |
| `webhook:get-stats`        | Webhook 统计      |

#### 数据库 Schema（v2.0.0 新增 4 表）

```sql
-- P2P 远程代理注册表
CREATE TABLE p2p_remote_agents (
  peer_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  platform TEXT,
  skills TEXT DEFAULT '[]',
  resources TEXT DEFAULT '{}',
  state TEXT DEFAULT 'offline',
  last_heartbeat TEXT,
  registered_at TEXT,
  updated_at TEXT
);

-- P2P 远程任务记录
CREATE TABLE p2p_remote_tasks (
  task_id TEXT PRIMARY KEY,
  peer_id TEXT NOT NULL,
  skill_id TEXT,
  description TEXT,
  input TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  result TEXT,
  delegated_at TEXT,
  completed_at TEXT
);

-- Webhook 注册表
CREATE TABLE cowork_webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT DEFAULT '[]',
  secret TEXT,
  metadata TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  delivery_count INTEGER DEFAULT 0,
  last_delivery TEXT,
  fail_count INTEGER DEFAULT 0,
  created_at TEXT
);

-- Webhook 投递日志
CREATE TABLE cowork_webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  http_status INTEGER,
  attempt INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT
);
```

#### 关键文件

| 文件                                               | 行数 | 职责                          |
| -------------------------------------------------- | ---- | ----------------------------- |
| `src/main/ai-engine/cowork/p2p-agent-network.js`   | ~680 | P2P 代理网络（15 种消息类型） |
| `src/main/ai-engine/cowork/device-discovery.js`    | ~420 | 设备能力发现（4 级分层）      |
| `src/main/ai-engine/cowork/hybrid-executor.js`     | ~510 | 混合执行策略（6 种策略）      |
| `src/main/ai-engine/cowork/computer-use-bridge.js` | ~430 | Computer Use 集成（12 工具）  |
| `src/main/ai-engine/cowork/cowork-api-server.js`   | ~520 | RESTful API 服务（20+ 端点）  |
| `src/main/ai-engine/cowork/webhook-manager.js`     | ~530 | Webhook 事件推送（17 事件）   |
| `src/main/ai-engine/cowork/cowork-v2-ipc.js`       | ~420 | 34 个 IPC Handler             |
| `src/main/database.js`                             | +55  | 4 张新表                      |
| `src/main/ipc/ipc-registry.js`                     | +95  | Phase 18 注册                 |

---

### v2.1.0 — 自进化与知识图谱 ✅

**目标**: 构建能够自我学习和知识积累的智能代理网络

#### 已完成

- [x] **代码知识图谱** — 8 种实体类型，7 种关系类型，度中心度分析，热点检测，环形依赖检测（DFS），架构建议注入 ContextEngineering（~650 行）
- [x] **决策知识库** — 自动记录投票/编排决策，相似决策检索，最佳实践提取，4 种来源，Hook 集成自动捕获（~500 行）
- [x] **Prompt 自优化** — SHA-256 哈希去重，A/B 变体管理，成功率自动追踪，优化建议生成（~450 行）
- [x] **技能自动发现** — 任务失败关键词提取，Marketplace 自动搜索，安装建议，发现历史追踪（~400 行）
- [x] **辩论式代码审查** — 3 视角审查代理，结构化 issue 输出，共识投票裁决，决策记录到 DecisionKB（~550 行）
- [x] **A/B 方案对比** — 5 种代理风格，3 维基准评分，自动排名选优（~500 行）
- [x] **经验回放** — Instinct evolveInstincts 扩展，成功工作流自动沉淀为 instinct（~100 行）
- [x] **KG 上下文注入** — ContextEngineering 步骤 4.6 注入代码知识图谱架构洞察（~30 行）
- [x] **IPC Handler 注册** — 35 个 IPC handler（Phase 20），6 模块全覆盖
- [x] **数据库 Schema** — 8 张新表
- [x] **3 新内置技能** — debate-review, ab-compare, stream-processor

#### 知识图谱驱动

- [x] **代码知识图谱** — 基于 `knowledge-graph` 技能自动构建项目代码的实体关系图谱（类、函数、模块、依赖）
- [x] **决策知识库** — 积累历史决策数据（投票结果、方案选择、故障处理），为未来决策提供参考
- [x] **最佳实践推荐** — 基于知识图谱分析，自动推荐适合当前任务的代码模式和解决方案

#### 知识图谱架构

```
代码知识图谱:

  ┌─────────┐    imports    ┌─────────┐
  │ Module A │ ───────────► │ Module B │
  └────┬─────┘              └────┬─────┘
       │ contains                │ contains
       ▼                         ▼
  ┌─────────┐    calls     ┌─────────┐
  │ Class X  │ ───────────► │ Class Y  │
  └────┬─────┘              └────┬─────┘
       │ has method              │ has method
       ▼                         ▼
  ┌─────────┐   depends    ┌─────────┐
  │ func()  │ ───────────► │ func()  │
  └─────────┘              └─────────┘

  决策知识图:

  ┌──────────────┐
  │ 问题 P001    │
  │ "性能瓶颈"   │
  └──────┬───────┘
         │ 历史方案
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
  方案A     方案B        方案C
  (缓存)   (索引优化)   (异步处理)
  成功率92% 成功率78%   成功率85%
    ↓
  推荐方案A
```

#### 自进化代理

- [x] **技能自动发现** — 代理根据任务失败原因自动搜索 Marketplace 中的新技能并建议安装
- [x] **Prompt 自优化** — 基于执行结果反馈，自动调优技能的 Prompt 模板（集成 `prompt-enhancer`）
- [x] **经验回放学习** — 将成功的任务执行路径提取为新的工作流模板，持续丰富模板库

#### 高级协作模式

- [x] **辩论式代码审查** — 多个代理从不同角度（性能、安全、可维护性）审查代码，通过投票达成共识
- [x] **A/B 方案对比** — 对同一任务生成多个实现方案，自动运行基准测试并推荐最优方案
- [x] **流式任务处理** — 支持数据流式处理模式，适用于日志分析、实时监控等持续性任务

#### 辩论式代码审查流程

```
代码变更提交
      │
      ├──────────────────────────────────────┐
      ▼                 ▼                    ▼
┌──────────┐    ┌──────────┐        ┌──────────┐
│ 性能代理  │    │ 安全代理  │        │ 维护性代理│
│          │    │          │        │          │
│ 分析性能  │    │ 扫描漏洞  │        │ 检查可读性│
│ 影响     │    │ 安全隐患  │        │ 复杂度    │
└────┬─────┘    └────┬─────┘        └────┬─────┘
     │               │                   │
     └───────────────┼───────────────────┘
                     ▼
              ┌──────────────┐
              │  投票决策      │
              │              │
              │ 性能: 通过    │
              │ 安全: 需修改  │
              │ 维护: 通过    │
              │              │
              │ 结果: 需修改  │
              └──────────────┘
```

#### 关键文件

| 文件                                                         | 行数 | 职责                   |
| ------------------------------------------------------------ | ---- | ---------------------- |
| `src/main/ai-engine/cowork/code-knowledge-graph.js`          | ~650 | 代码知识图谱构建与分析 |
| `src/main/ai-engine/cowork/decision-knowledge-base.js`       | ~500 | 决策知识库             |
| `src/main/ai-engine/cowork/prompt-optimizer.js`              | ~450 | Prompt 自优化引擎      |
| `src/main/ai-engine/cowork/skill-discoverer.js`              | ~400 | 技能自动发现           |
| `src/main/ai-engine/cowork/debate-review.js`                 | ~550 | 辩论式代码审查         |
| `src/main/ai-engine/cowork/ab-comparator.js`                 | ~500 | A/B 方案对比引擎       |
| `src/main/ai-engine/cowork/evolution-ipc.js`                 | ~550 | 35 个 IPC handler      |
| `src/main/ai-engine/cowork/skills/builtin/debate-review/`    | ~240 | debate-review 技能     |
| `src/main/ai-engine/cowork/skills/builtin/ab-compare/`       | ~230 | ab-compare 技能        |
| `src/main/ai-engine/cowork/skills/builtin/stream-processor/` | ~350 | stream-processor 技能  |

#### v2.1.0 IPC 通道（35 个 — Phase 20）

| 模块                    | 前缀          | 数量 | 主要功能                          |
| ----------------------- | ------------- | ---- | --------------------------------- |
| Code Knowledge Graph    | `ckg:`        | 14   | 图谱扫描、实体查询、热点/环形依赖 |
| Decision Knowledge Base | `dkb:`        | 6    | 决策记录、相似检索、最佳实践      |
| Prompt Optimizer        | `prompt-opt:` | 5    | 执行记录、变体管理、优化分析      |
| Skill Discoverer        | `skill-disc:` | 4    | 失败分析、安装建议、发现历史      |
| Debate Review           | `debate:`     | 3    | 辩论审查、历史查询、统计          |
| A/B Comparator          | `ab:`         | 3    | 方案对比、历史查询、统计          |

#### 数据库 Schema（v2.1.0 新增 8 表）

```sql
-- 代码知识图谱：实体表
CREATE TABLE code_kg_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,        -- module, class, function, variable, interface, type, enum, component
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  language TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 代码知识图谱：关系表
CREATE TABLE code_kg_relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,        -- imports, exports, extends, implements, calls, contains, depends_on
  weight REAL DEFAULT 1.0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES code_kg_entities(id),
  FOREIGN KEY (target_id) REFERENCES code_kg_entities(id)
);

-- 决策知识库
CREATE TABLE decision_records (
  id TEXT PRIMARY KEY,
  problem TEXT NOT NULL,
  problem_category TEXT,     -- architecture, implementation, testing, performance, security, etc.
  solutions TEXT DEFAULT '[]',
  chosen_solution TEXT,
  outcome TEXT,
  context TEXT DEFAULT '{}',
  agents TEXT DEFAULT '[]',
  source TEXT DEFAULT 'manual',  -- manual, voting, orchestrate, instinct
  success_rate REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Prompt 执行记录
CREATE TABLE prompt_executions (
  id TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL,
  prompt_hash TEXT,          -- SHA-256 前 16 字符
  prompt_text TEXT,
  result_success INTEGER DEFAULT 0,
  execution_time_ms INTEGER DEFAULT 0,
  feedback TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Prompt 变体
CREATE TABLE prompt_variants (
  id TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL,
  variant_name TEXT,
  prompt_text TEXT NOT NULL,
  success_rate REAL DEFAULT 0,
  use_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 技能发现日志
CREATE TABLE skill_discovery_log (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  failure_reason TEXT,
  searched_keywords TEXT,
  suggested_skills TEXT DEFAULT '[]',
  installed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 辩论式审查记录
CREATE TABLE debate_reviews (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  reviews TEXT DEFAULT '[]',
  votes TEXT DEFAULT '{}',
  verdict TEXT,              -- APPROVE, NEEDS_WORK, REJECT
  consensus_score REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- A/B 对比记录
CREATE TABLE ab_comparisons (
  id TEXT PRIMARY KEY,
  task_description TEXT NOT NULL,
  variants TEXT DEFAULT '[]',
  winner TEXT,
  scores TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

### 长期愿景 (2026 H2+)

| 方向                 | 目标                                 | 关键指标              |
| -------------------- | ------------------------------------ | --------------------- |
| **全自动开发流水线** | 从需求到部署全程 AI 代理协作         | 人工干预率 < 20%      |
| **自然语言编程**     | 用自然语言描述需求，代理团队自动实现 | 需求→代码转化率 > 80% |
| **去中心化代理网络** | 基于 DID 的代理身份认证和跨组织协作  | 支持 100+ 节点        |
| **多模态协作**       | 集成语音、视觉、文档等多模态输入输出 | 支持 5+ 模态          |
| **自主运维**         | 代理自动监控、诊断、修复生产环境问题 | MTTR < 5 分钟         |

---

### v3.0 — 全自动开发流水线

**目标**: 从需求描述到生产部署全程 AI 代理协作，人工干预率 < 20%

#### 规划模块

- [x] **Pipeline Orchestrator** — 中央流水线协调器，7 阶段生命周期（需求→设计→编码→测试→审查→部署→监控），门控审批机制（1,180 行）
- [x] **Requirement Parser** — 自然语言需求→结构化 Spec JSON，支持用户故事、验收标准、边界条件提取（736 行）
- [x] **Deploy Agent** — 自动化部署执行引擎，支持 Git 分支/PR 创建、Docker 构建、npm 发布（371 行）
- [x] **Post-Deploy Monitor** — 生产环境监控桥接，集成 ErrorMonitor + AutoTuner，异常自动回滚触发（362 行）
- [x] **Pipeline IPC** — 15 个 IPC handler，覆盖流水线全生命周期操作（305 行）

#### 流水线架构

```
需求输入
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Pipeline Orchestrator                         │
│                                                                  │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐   │
│  │ Stage 1 │→│ Stage 2 │→│ Stage 3 │→│ Stage 4 │→│ Stage 5 │   │
│  │ 需求解析│  │ 架构设计│  │ 代码生成│  │ 测试验证│  │ 代码审查│   │
│  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘   │
│       │           │           │           │           │         │
│       ▼           ▼           ▼           ▼           ▼         │
│  Requirement  Orchestrate  Cowork    Verification  Debate       │
│  Parser       Planner      Skills    Loop          Review       │
│                                                                  │
│  ┌────────┐  ┌────────┐                                        │
│  │ Stage 6 │→│ Stage 7 │  ← 门控审批（人工/自动）              │
│  │ 自动部署│  │ 生产监控│                                        │
│  └────┬───┘  └────┬───┘                                        │
│       │           │                                              │
│       ▼           ▼                                              │
│  Deploy Agent  Post-Deploy                                      │
│  (Git/Docker)  Monitor                                          │
└──────────────────────────────────────────────────────────────────┘
       │                    │
       ▼                    ▼
  ┌─────────┐        ┌─────────────┐
  │ CKG     │        │ Instinct    │
  │ 代码图谱 │        │ 经验学习     │
  └─────────┘        └─────────────┘
```

#### 分阶段实现

**Phase A — 流水线框架（Month 1-2）**:

- [x] PipelineOrchestrator 类骨架：7 阶段状态机、事件总线、门控队列
- [x] RequirementParser 基础：NL→Spec JSON 结构化输出（用户故事、验收标准）
- [x] Pipeline 数据模型：3 张数据库表、流水线模板
- [x] 基础 IPC 通道（8 个）：create、start、pause、resume、cancel、get-status、get-all、get-config

**Phase B — 代理集成（Month 3-4）**:

- [x] 阶段 1-5 代理编排：集成 Orchestrate（设计）、Cowork Skills（编码）、Verification Loop（测试）、Debate Review（审查）
- [x] 门控审批机制：人工审批 + 自动审批（基于 Instinct 置信度阈值）
- [x] 制品管理：阶段间产物传递（Spec JSON→设计文档→代码→测试报告→审查意见）
- [x] 扩展 IPC 通道（+4 个）：approve-gate、reject-gate、get-artifacts、get-stage-detail

**Phase C — 部署与监控（Month 5-6）**:

- [x] DeployAgent 实现：Git 分支创建、PR 生成、Docker build/push、npm publish
- [x] PostDeployMonitor 集成：ErrorMonitor 异常检测 + AutoTuner 性能基线比对
- [x] 自动回滚触发：部署后异常超阈值自动执行 rollback
- [x] 完善 IPC（+3 个）：get-metrics、get-templates、configure
- [x] 端到端集成测试

#### v3.0 IPC 通道（15 个）

**Pipeline Orchestrator（12 个）**:

| 通道                            | 功能               |
| ------------------------------- | ------------------ |
| `dev-pipeline:create`           | 创建流水线实例     |
| `dev-pipeline:start`            | 启动流水线执行     |
| `dev-pipeline:pause`            | 暂停流水线         |
| `dev-pipeline:resume`           | 恢复流水线         |
| `dev-pipeline:cancel`           | 取消流水线         |
| `dev-pipeline:get-status`       | 获取流水线状态     |
| `dev-pipeline:get-all`          | 列出所有流水线     |
| `dev-pipeline:get-stage-detail` | 获取指定阶段详情   |
| `dev-pipeline:approve-gate`     | 审批通过门控       |
| `dev-pipeline:reject-gate`      | 拒绝门控（含原因） |
| `dev-pipeline:get-artifacts`    | 获取阶段制品       |
| `dev-pipeline:get-metrics`      | 获取流水线执行指标 |

**Pipeline Config（3 个）**:

| 通道                         | 功能               |
| ---------------------------- | ------------------ |
| `dev-pipeline:get-templates` | 获取流水线模板列表 |
| `dev-pipeline:configure`     | 更新流水线配置     |
| `dev-pipeline:get-config`    | 获取当前配置       |

#### 代码示例

```javascript
// 创建并启动全自动开发流水线
const pipeline = await ipcRenderer.invoke("dev-pipeline:create", {
  name: "用户认证模块",
  template: "feature",
  requirement: "实现基于 JWT 的用户认证系统，支持注册、登录、Token 刷新",
  config: {
    autoApprove: false, // 门控需人工审批
    deployTarget: "staging", // 部署目标环境
    rollbackOnError: true, // 异常自动回滚
  },
});
// → { id: "pipe-abc123", status: "created", stages: [...] }

// 启动流水线
await ipcRenderer.invoke("dev-pipeline:start", { pipelineId: "pipe-abc123" });
// → { status: "running", currentStage: "requirement-parsing" }

// 门控审批
await ipcRenderer.invoke("dev-pipeline:approve-gate", {
  pipelineId: "pipe-abc123",
  stageId: "code-review",
  comment: "代码质量符合标准，批准部署",
});
// → { status: "approved", nextStage: "deploy" }

// 查询流水线执行指标
const metrics = await ipcRenderer.invoke("dev-pipeline:get-metrics", {
  pipelineId: "pipe-abc123",
});
// → { totalTime: 1842000, stageMetrics: [...], humanInterventions: 1, autoApprovals: 4 }
```

#### 数据库 Schema（v3.0 新增 3 表）

```sql
-- 开发流水线主表
CREATE TABLE dev_pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT,                  -- feature, bugfix, refactor, security-audit
  requirement TEXT,
  spec_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'created',  -- created, running, paused, gate-waiting, completed, failed, cancelled
  current_stage TEXT,
  config TEXT DEFAULT '{}',
  metrics TEXT DEFAULT '{}',
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- 流水线阶段表
CREATE TABLE dev_pipeline_stages (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,       -- requirement-parsing, architecture-design, code-generation, testing, code-review, deploy, monitoring
  stage_order INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending, running, gate-waiting, approved, rejected, completed, failed, skipped
  input TEXT DEFAULT '{}',
  output TEXT DEFAULT '{}',
  agent_id TEXT,
  gate_approver TEXT,
  gate_comment TEXT,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (pipeline_id) REFERENCES dev_pipelines(id)
);

-- 流水线制品表
CREATE TABLE dev_pipeline_artifacts (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,    -- spec, design-doc, code, test-report, review-report, deploy-log, monitor-snapshot
  content TEXT,
  file_path TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (pipeline_id) REFERENCES dev_pipelines(id),
  FOREIGN KEY (stage_id) REFERENCES dev_pipeline_stages(id)
);
```

#### 关键文件

| 文件                                                 | 行数  | 职责                     |
| ---------------------------------------------------- | ----- | ------------------------ |
| `src/main/ai-engine/cowork/pipeline-orchestrator.js` | 1,180 | 中央流水线协调（7 阶段） |
| `src/main/ai-engine/cowork/requirement-parser.js`    | 736   | NL 需求→Spec JSON 转换   |
| `src/main/ai-engine/cowork/deploy-agent.js`          | 371   | 自动部署（Git/Docker）   |
| `src/main/ai-engine/cowork/post-deploy-monitor.js`   | 362   | 生产监控桥接             |
| `src/main/ai-engine/cowork/pipeline-ipc.js`          | 305   | 15 个 IPC handler        |

#### KPI 度量

| 指标             | 目标     | 度量方式                           |
| ---------------- | -------- | ---------------------------------- |
| 人工干预率       | < 20%    | 人工审批次数 / 总门控次数          |
| 需求→部署时间    | < 2 小时 | pipeline.completed_at - created_at |
| 流水线成功率     | > 85%    | 成功完成 / 总创建数                |
| 自动回滚响应时间 | < 30 秒  | 异常检测→回滚完成耗时              |

---

### v3.1 — 自然语言编程

**目标**: 用自然语言描述需求，代理团队自动实现符合项目约定的代码，需求→代码转化率 > 80%

#### 规划模块

- [x] **Spec Translator** — 自然语言→结构化 Spec 翻译引擎，支持多轮对话澄清、上下文补全（867 行）
- [x] **Project Style Analyzer** — 项目编码约定提取器，集成 CKG + Instinct 分析命名/架构/测试模式（576 行）
- [x] **NL Programming IPC** — 10 个 IPC handler（253 行）
- [ ] **nl-program 内置技能** — handler.js + SKILL.md，支持 `/nl-program` 命令（~300 行）

#### 自然语言编程架构

```
自然语言输入
  │ "实现一个带分页的用户列表组件"
  ▼
┌──────────────────────────────────────────────────┐
│              Spec Translator                      │
│                                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │ 意图识别    │→│ 上下文补全  │→│ Spec 生成   │  │
│  │ (LLM)      │  │ (CKG+对话) │  │ (JSON)     │  │
│  └────────────┘  └────────────┘  └────────────┘  │
└──────────┬───────────────────────────────────────┘
           │ Spec JSON
           ▼
┌──────────────────────────────────────────────────┐
│           Project Style Analyzer                   │
│                                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │ CKG 分析    │  │ Instinct   │  │ 约定合并    │  │
│  │ 代码结构    │  │ 编码模式    │  │ 风格指南    │  │
│  └────────────┘  └────────────┘  └────────────┘  │
└──────────┬───────────────────────────────────────┘
           │ Spec + Conventions
           ▼
┌──────────────────────────────────────────────────┐
│              Code Generator                        │
│                                                    │
│  Orchestrate (coder agent) + Conventions Context   │
│  → 符合项目约定的代码                              │
└──────────┬───────────────────────────────────────┘
           │ Generated Code
           ▼
┌──────────────────────────────────────────────────┐
│           Verification Loop                        │
│                                                    │
│  Build → TypeCheck → Lint → Test → Security        │
│  → READY / NOT READY（循环精炼）                   │
└──────────────────────────────────────────────────┘
```

#### 分阶段实现

**Phase A — Spec 翻译引擎（Month 2-3）**:

- [x] SpecTranslator 类：NL 意图识别、上下文补全、结构化 Spec JSON 输出
- [x] 多轮对话：歧义检测 + 自动追问
- [x] 集成 CKG：从代码图谱中提取已有模块信息辅助上下文补全
- [x] 基础 IPC（5 个）：translate、validate、refine、get-history、get-config

**Phase B — 约定分析与代码生成（Month 4-5）**:

- [x] ProjectStyleAnalyzer 实现：扫描项目提取命名约定、目录结构、测试模式、组件模板
- [x] Instinct 集成：从 CODING_PATTERN / STYLE / ARCHITECTURE 类别提取编码偏好
- [x] 代码生成：Orchestrate coder agent + Conventions 上下文注入
- [x] 扩展 IPC（+3 个）：generate、get-conventions、analyze-project

**Phase C — 交互精炼（Month 6-7）**:

- [x] 验证循环集成：生成代码自动通过 Verification Loop 验证
- [x] 精炼循环：NOT READY 结果自动触发 LLM 修复 + 重新验证
- [ ] nl-program 内置技能：SKILL.md + handler.js，支持 `/nl-program "描述"` 命令
- [x] 完善 IPC（+2 个）：get-stats、configure

#### v3.1 IPC 通道（10 个）

**Spec Translator（5 个）**:

| 通道                  | 功能                   |
| --------------------- | ---------------------- |
| `nl-prog:translate`   | NL 描述→Spec JSON 翻译 |
| `nl-prog:validate`    | 验证 Spec 完整性       |
| `nl-prog:refine`      | 交互精炼 Spec          |
| `nl-prog:get-history` | 获取翻译历史           |
| `nl-prog:get-config`  | 获取配置               |

**Project Style & Generation（5 个）**:

| 通道                      | 功能               |
| ------------------------- | ------------------ |
| `nl-prog:generate`        | 基于 Spec 生成代码 |
| `nl-prog:get-conventions` | 获取项目编码约定   |
| `nl-prog:analyze-project` | 分析项目风格       |
| `nl-prog:get-stats`       | 获取统计数据       |
| `nl-prog:configure`       | 更新配置           |

#### 代码示例

```javascript
// 自然语言→代码生成
const spec = await ipcRenderer.invoke("nl-prog:translate", {
  description:
    "实现一个带分页和搜索功能的用户列表 Vue 组件，支持按姓名和邮箱搜索",
  context: { directory: "src/renderer/components/user/" },
});
// → {
//     intent: "create-component",
//     spec: {
//       type: "vue-component",
//       name: "UserList",
//       features: ["pagination", "search"],
//       searchFields: ["name", "email"],
//       dependencies: ["ant-design-vue/Table", "ant-design-vue/Input.Search"]
//     }
//   }

// 分析项目约定
const conventions = await ipcRenderer.invoke("nl-prog:analyze-project", {
  directory: "src/renderer/components/",
});
// → {
//     naming: { components: "PascalCase", files: "PascalCase.vue", stores: "use*Store" },
//     patterns: { stateManagement: "pinia", uiLibrary: "ant-design-vue", composition: true },
//     testing: { framework: "vitest", location: "__tests__/", naming: "*.test.ts" }
//   }

// 生成符合约定的代码
const result = await ipcRenderer.invoke("nl-prog:generate", {
  specId: spec.id,
  conventions: conventions,
  autoVerify: true, // 自动通过 Verification Loop
});
// → { files: ["UserList.vue", "useUserListStore.ts", "UserList.test.ts"], verified: true }
```

#### 数据库 Schema（v3.1 新增 2 表）

```sql
-- 自然语言编程记录
CREATE TABLE nl_programs (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  spec_json TEXT DEFAULT '{}',
  conventions TEXT DEFAULT '{}',
  generated_files TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft',      -- draft, translating, generating, verifying, completed, failed
  verification_result TEXT,         -- READY, NOT_READY
  refine_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- 项目编码约定缓存
CREATE TABLE nl_program_conventions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  naming_conventions TEXT DEFAULT '{}',
  architecture_patterns TEXT DEFAULT '{}',
  testing_patterns TEXT DEFAULT '{}',
  style_rules TEXT DEFAULT '{}',
  source TEXT DEFAULT 'auto',       -- auto (CKG+Instinct), manual
  confidence REAL DEFAULT 0,
  scanned_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

#### 关键文件

| 文件                                                             | 行数 | 职责                    |
| ---------------------------------------------------------------- | ---- | ----------------------- |
| `src/main/ai-engine/cowork/spec-translator.js`                   | 867  | NL→Spec 翻译引擎        |
| `src/main/ai-engine/cowork/project-style-analyzer.js`            | 576  | 项目约定提取            |
| `src/main/ai-engine/cowork/nl-programming-ipc.js`                | 253  | 10 个 IPC handler       |
| `src/main/ai-engine/cowork/skills/builtin/nl-program/handler.js` | ~200 | nl-program 技能 handler |
| `src/main/ai-engine/cowork/skills/builtin/nl-program/SKILL.md`   | ~100 | nl-program 技能定义     |

#### KPI 度量

| 指标            | 目标  | 度量方式                    |
| --------------- | ----- | --------------------------- |
| 需求→代码转化率 | > 80% | 成功生成 / 总翻译请求       |
| Spec 准确率     | > 90% | 无需精炼即通过 / 总 Spec 数 |
| 验证通过率      | > 75% | 首次 READY / 总生成数       |
| 约定符合度      | > 95% | Lint 通过 + 命名规范符合率  |

---

### v3.2 — 多模态协作

**目标**: 集成语音、视觉、文档等多模态输入输出，支持 5+ 模态

#### 规划模块

- [x] **Modality Fusion** — 多模态输入融合引擎，5 模态统一表示（文本/图像/语音/文档/屏幕）（569 行）
- [x] **Document Parser** — PDF/DOCX/XLSX/PPT 文档内容提取与结构化（520 行）
- [x] **Screen Recorder** — 屏幕录制→关键帧提取→OCR 文本识别（316 行）
- [x] **Multimodal Context** — 统一上下文构建器，融合多模态信息为 LLM 可理解的上下文（366 行）
- [x] **Multimodal Output** — 多格式输出生成（Markdown/HTML/图表/幻灯片）（467 行）
- [x] **Multimodal Collab IPC** — 12 个 IPC handler（289 行）
- [ ] **3 新内置技能** — whiteboard-reader、screen-explainer、voice-programmer

#### 多模态协作架构

```
┌────────────────────────────────────────────────────────────────┐
│                     多模态输入层                                │
│                                                                │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐           │
│  │ 文本  │  │ 图像  │  │ 语音  │  │ 文档  │  │ 屏幕  │           │
│  │ Text  │  │ Image │  │ Audio │  │ Docs  │  │ Screen│           │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘           │
│     │         │         │         │         │                  │
└─────┼─────────┼─────────┼─────────┼─────────┼──────────────────┘
      │         │         │         │         │
      ▼         ▼         ▼         ▼         ▼
┌────────────────────────────────────────────────────────────────┐
│                   Modality Fusion Engine                        │
│                                                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐          │
│  │ OCR/Vision  │  │ Whisper    │  │ Document Parser │          │
│  │ 图像理解    │  │ 语音转录    │  │ 文档结构化      │          │
│  └────────────┘  └────────────┘  └────────────────┘          │
└──────────────────────┬─────────────────────────────────────────┘
                       │ 统一表示
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                  Multimodal Context Builder                     │
│                                                                │
│  文本 + 图像描述 + 转录文本 + 文档结构 + 屏幕 OCR             │
│  → 融合上下文 JSON → LLM Prompt                                │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                    Agent Workflow                               │
│                                                                │
│  Cowork Skills / Orchestrate / Pipeline                        │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                  Multimodal Output Generator                    │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Markdown  │  │ HTML     │  │ 图表     │  │ 幻灯片   │     │
│  │ 文档      │  │ 富文本    │  │ ECharts  │  │ Reveal.js│     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└────────────────────────────────────────────────────────────────┘
```

#### 分阶段实现

**Phase A — 文档与图像融合（Month 2-3）**:

- [x] ModalityFusion 基础架构：5 模态注册、统一表示格式
- [x] DocumentParser 实现：PDF（pdf-parse）、DOCX（mammoth）、XLSX（xlsx）内容提取
- [x] 图像 OCR 集成：复用现有 Tesseract.js + Sharp
- [x] MultimodalContext 基础：文本 + 图像 + 文档三模态上下文构建
- [x] 基础 IPC（6 个）：fuse-input、parse-document、build-context、get-session、get-supported-modalities、get-config

**Phase B — 语音与屏幕（Month 4-5）**:

- [x] 语音模态：Whisper API 集成，音频转录→文本
- [x] ScreenRecorder 实现：Electron desktopCapturer 录制 + 关键帧提取 + OCR
- [ ] 3 内置技能：whiteboard-reader（白板 OCR→代码）、screen-explainer（屏幕内容解释）、voice-programmer（语音→代码）
- [x] 扩展 IPC（+3 个）：capture-screen、transcribe-audio、get-artifacts

**Phase C — 富输出生成（Month 6-7）**:

- [x] MultimodalOutput 实现：Markdown、HTML 富文本、ECharts 图表、Reveal.js 幻灯片
- [x] 输出模板系统：可配置输出格式模板
- [x] 端到端流程打通：多模态输入→代理工作流→多格式输出
- [x] 完善 IPC（+3 个）：generate-output、get-stats、configure

#### v3.2 IPC 通道（12 个）

**Modality Fusion（6 个）**:

| 通道                  | 功能                      |
| --------------------- | ------------------------- |
| `mm:fuse-input`       | 融合多模态输入            |
| `mm:parse-document`   | 解析文档（PDF/DOCX/XLSX） |
| `mm:capture-screen`   | 屏幕截图/录制             |
| `mm:transcribe-audio` | 语音转录                  |
| `mm:build-context`    | 构建统一上下文            |
| `mm:generate-output`  | 生成多格式输出            |

**Session & Config（6 个）**:

| 通道                          | 功能               |
| ----------------------------- | ------------------ |
| `mm:get-session`              | 获取多模态会话详情 |
| `mm:get-artifacts`            | 获取会话制品       |
| `mm:get-supported-modalities` | 获取支持的模态列表 |
| `mm:get-stats`                | 获取统计数据       |
| `mm:configure`                | 更新配置           |
| `mm:get-config`               | 获取当前配置       |

#### 代码示例

```javascript
// 截图 + 文字描述→代码生成
const context = await ipcRenderer.invoke("mm:fuse-input", {
  modalities: [
    { type: "image", data: screenshotBase64, label: "UI 设计稿" },
    {
      type: "text",
      data: "根据这个设计稿实现 Vue 组件，使用 Ant Design Vue",
    },
  ],
});
// → { sessionId: "mm-abc123", fusedContext: { ... }, modalities: ["image", "text"] }

// 构建统一上下文
const unified = await ipcRenderer.invoke("mm:build-context", {
  sessionId: "mm-abc123",
});
// → { context: "图像分析: 包含用户列表表格，顶部搜索栏...\n用户需求: 实现 Vue 组件..." }

// 文档解析
const doc = await ipcRenderer.invoke("mm:parse-document", {
  filePath: "/path/to/api-spec.pdf",
  extractTables: true,
  extractImages: true,
});
// → { pages: 12, text: "...", tables: [...], images: [...], structure: {...} }

// 语音编程
const transcription = await ipcRenderer.invoke("mm:transcribe-audio", {
  audioPath: "/path/to/instruction.wav",
  language: "zh-CN",
});
// → { text: "创建一个用户登录表单，包含邮箱和密码字段", confidence: 0.95 }

// 生成多格式输出
const output = await ipcRenderer.invoke("mm:generate-output", {
  sessionId: "mm-abc123",
  format: "html",
  template: "technical-report",
});
// → { format: "html", content: "<html>...", filePath: "/tmp/report.html" }
```

#### 数据库 Schema（v3.2 新增 2 表）

```sql
-- 多模态会话记录
CREATE TABLE multimodal_sessions (
  id TEXT PRIMARY KEY,
  modalities TEXT DEFAULT '[]',     -- ["text", "image", "audio", "document", "screen"]
  fused_context TEXT,
  status TEXT DEFAULT 'active',     -- active, processing, completed, archived
  input_count INTEGER DEFAULT 0,
  output_format TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 多模态制品表
CREATE TABLE multimodal_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,      -- input-image, input-audio, input-document, ocr-text, transcription, output-markdown, output-html, output-chart, output-slides
  modality TEXT,
  content TEXT,
  file_path TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES multimodal_sessions(id)
);
```

#### 关键文件

| 文件                                                          | 行数 | 职责                 |
| ------------------------------------------------------------- | ---- | -------------------- |
| `src/main/ai-engine/cowork/modality-fusion.js`                | 569  | 多模态输入融合引擎   |
| `src/main/ai-engine/cowork/document-parser.js`                | 520  | PDF/DOCX/XLSX 解析   |
| `src/main/ai-engine/cowork/screen-recorder.js`                | 316  | 屏幕录制与关键帧提取 |
| `src/main/ai-engine/cowork/multimodal-context.js`             | 366  | 统一上下文构建       |
| `src/main/ai-engine/cowork/multimodal-output.js`              | 467  | 多格式输出生成       |
| `src/main/ai-engine/cowork/multimodal-collab-ipc.js`          | 289  | 12 个 IPC handler    |
| `src/main/ai-engine/cowork/skills/builtin/whiteboard-reader/` | ~180 | 白板识别技能         |
| `src/main/ai-engine/cowork/skills/builtin/screen-explainer/`  | ~180 | 屏幕内容解释技能     |
| `src/main/ai-engine/cowork/skills/builtin/voice-programmer/`  | ~180 | 语音编程技能         |

#### KPI 度量

| 指标           | 目标   | 度量方式                      |
| -------------- | ------ | ----------------------------- |
| 支持模态数     | ≥ 5    | 已注册模态类型计数            |
| OCR 识别准确率 | > 95%  | 正确字符 / 总字符             |
| 语音转录准确率 | > 90%  | 正确词语 / 总词语（WER）      |
| 文档解析成功率 | > 98%  | 成功解析 / 总请求             |
| 上下文融合延迟 | < 3 秒 | 多模态输入→统一上下文构建耗时 |

---

### v3.3 — 自主运维

**目标**: 代理自动监控、诊断、修复生产环境问题，MTTR < 5 分钟

#### 规划模块

- [x] **Anomaly Detector** — 统计异常检测引擎（Z-score、IQR、EWMA），多维指标监控（674 行）
- [x] **Incident Classifier** — 事故严重度分级 P0-P3，自动关联历史事故（706 行）
- [x] **Auto Remediator** — 自动修复编排引擎 + Playbook 系统，支持条件化修复策略（720 行）
- [x] **Rollback Manager** — 自动回滚执行器，支持 Git revert、Docker rollback、配置回滚（398 行）
- [x] **Alert Manager** — 多通道告警（Webhook/邮件/IM），升级链（P3→P2→P1→P0）（506 行）
- [x] **Postmortem Generator** — LLM 驱动的事故报告自动生成，时间线重建 + 根因分析（422 行）
- [x] **Autonomous Ops IPC** — 15 个 IPC handler（379 行）

#### 自主运维架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      指标采集层                                   │
│                                                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ ErrorMonitor│  │ AutoTuner  │  │ Performance │  │ 自定义指标  │ │
│  │ 错误监控    │  │ 性能调优    │  │ Monitor     │  │ 用户定义    │ │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘ │
└─────────┼───────────────┼───────────────┼───────────────┼────────┘
          │               │               │               │
          └───────────────┴───────┬───────┴───────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Anomaly Detector                               │
│                                                                    │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                      │
│  │ Z-Score  │    │  IQR    │    │  EWMA   │                      │
│  │ 突变检测  │    │ 离群检测 │    │ 趋势检测 │                      │
│  └─────────┘    └─────────┘    └─────────┘                      │
└──────────────────────┬───────────────────────────────────────────┘
                       │ 异常事件
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Incident Classifier                             │
│                                                                    │
│  P0 (致命)  │  P1 (严重)  │  P2 (一般)  │  P3 (轻微)           │
└──────────────────────┬───────────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│  Auto Remediator  │  │  Alert Manager   │
│                   │  │                   │
│  Playbook 匹配    │  │  多通道告警       │
│  条件化修复执行    │  │  升级链触发       │
└────────┬─────────┘  └──────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ 修复成功│ │ 修复失败│
│        │ │        │
│ 记录   │ │ Rollback│
│ Instinct│ │ Manager │
└────────┘ └────────┘
              │
              ▼
       ┌──────────────┐
       │  Postmortem   │
       │  Generator    │
       │  LLM 报告生成 │
       └──────────────┘
```

#### 分阶段实现

**Phase A — 异常检测（Month 1-2）**:

- [x] AnomalyDetector 实现：Z-score 突变、IQR 离群值、EWMA 趋势检测
- [x] 基线管理：自动采集历史指标建立正常基线
- [x] IncidentClassifier 实现：P0-P3 严重度分级、历史事故关联
- [x] 集成 ErrorMonitor + PerformanceMonitor 作为指标源
- [x] 基础 IPC（6 个）：get-incidents、get-incident-detail、acknowledge、get-baseline、update-baseline、get-config

**Phase B — 自动修复（Month 3-4）**:

- [x] AutoRemediator 实现：Playbook YAML 定义、条件匹配、修复步骤执行
- [x] RollbackManager 实现：Git revert、Docker image rollback、配置回滚
- [x] AlertManager 实现：Webhook/邮件/IM 多通道、P3→P0 升级链
- [x] 扩展 IPC（+6 个）：resolve、get-playbooks、create-playbook、update-playbook、trigger-remediation、rollback

**Phase C — 自学习与报告（Month 5-6）**:

- [x] PostmortemGenerator 实现：时间线重建、根因分析、改进建议、LLM 生成报告
- [x] Instinct 集成：成功修复路径自动沉淀为 ERROR_FIX 类 instinct
- [x] 自适应基线：基线随时间自动漂移适应系统演进
- [x] 完善 IPC（+3 个）：configure-alerts、generate-postmortem、get-alerts

#### v3.3 IPC 通道（15 个）

**Incident Management（4 个）**:

| 通道                      | 功能           |
| ------------------------- | -------------- |
| `ops:get-incidents`       | 获取事故列表   |
| `ops:get-incident-detail` | 获取事故详情   |
| `ops:acknowledge`         | 确认事故       |
| `ops:resolve`             | 标记事故已解决 |

**Remediation（5 个）**:

| 通道                      | 功能               |
| ------------------------- | ------------------ |
| `ops:get-playbooks`       | 获取 Playbook 列表 |
| `ops:create-playbook`     | 创建新 Playbook    |
| `ops:update-playbook`     | 更新 Playbook      |
| `ops:trigger-remediation` | 触发自动修复       |
| `ops:rollback`            | 执行回滚           |

**Monitoring & Config（6 个）**:

| 通道                      | 功能         |
| ------------------------- | ------------ |
| `ops:get-alerts`          | 获取告警列表 |
| `ops:configure-alerts`    | 配置告警规则 |
| `ops:get-baseline`        | 获取指标基线 |
| `ops:update-baseline`     | 更新指标基线 |
| `ops:generate-postmortem` | 生成事故报告 |
| `ops:get-config`          | 获取运维配置 |

#### 代码示例

```javascript
// 配置异常检测基线
await ipcRenderer.invoke("ops:update-baseline", {
  metrics: [
    { name: "error_rate", method: "z-score", threshold: 3.0, window: "5m" },
    {
      name: "response_time_p99",
      method: "ewma",
      alpha: 0.3,
      threshold: 2000,
    },
    {
      name: "memory_usage",
      method: "iqr",
      multiplier: 1.5,
      window: "15m",
    },
  ],
});

// 创建修复 Playbook
await ipcRenderer.invoke("ops:create-playbook", {
  name: "high-memory-remediation",
  trigger: {
    metric: "memory_usage",
    condition: "above_threshold",
    severity: "P2",
  },
  steps: [
    { action: "restart-service", target: "ai-service", timeout: 30000 },
    { action: "clear-cache", target: "embedding-cache" },
    {
      action: "scale-down",
      target: "worker-pool",
      params: { minWorkers: 1 },
    },
  ],
  rollbackOnFailure: true,
  notifyChannels: ["webhook", "email"],
});

// 查询事故详情
const incident = await ipcRenderer.invoke("ops:get-incident-detail", {
  incidentId: "inc-xyz789",
});
// → {
//     id: "inc-xyz789", severity: "P1", status: "remediated",
//     anomaly: { metric: "error_rate", value: 15.2, baseline: 2.1, method: "z-score" },
//     remediation: { playbook: "high-error-remediation", steps: [...], duration: 45000 },
//     timeline: [...]
//   }

// 生成事故报告
const postmortem = await ipcRenderer.invoke("ops:generate-postmortem", {
  incidentId: "inc-xyz789",
  includeTimeline: true,
  includeRootCause: true,
  includeSuggestions: true,
});
// → { report: "# 事故报告 inc-xyz789\n\n## 时间线\n...\n## 根因分析\n...", format: "markdown" }
```

#### 数据库 Schema（v3.3 新增 3 表）

```sql
-- 运维事故记录
CREATE TABLE ops_incidents (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,           -- P0, P1, P2, P3
  status TEXT DEFAULT 'open',       -- open, acknowledged, remediating, remediated, resolved, escalated
  anomaly_metric TEXT,
  anomaly_value REAL,
  anomaly_method TEXT,              -- z-score, iqr, ewma
  baseline_value REAL,
  playbook_id TEXT,
  remediation_result TEXT,
  rollback_executed INTEGER DEFAULT 0,
  alert_channels TEXT DEFAULT '[]',
  postmortem TEXT,
  timeline TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  resolved_at TEXT
);

-- 修复 Playbook 定义
CREATE TABLE ops_remediation_playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_config TEXT DEFAULT '{}',
  steps TEXT DEFAULT '[]',
  rollback_on_failure INTEGER DEFAULT 1,
  notify_channels TEXT DEFAULT '[]',
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  avg_duration_ms INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 指标基线定义
CREATE TABLE ops_metrics_baseline (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL UNIQUE,
  detection_method TEXT NOT NULL,   -- z-score, iqr, ewma
  threshold REAL,
  window TEXT DEFAULT '5m',
  params TEXT DEFAULT '{}',         -- method-specific: alpha, multiplier, etc.
  baseline_values TEXT DEFAULT '[]',
  last_calibrated TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

#### 关键文件

| 文件                                                | 行数 | 职责                     |
| --------------------------------------------------- | ---- | ------------------------ |
| `src/main/ai-engine/cowork/anomaly-detector.js`     | 674  | 统计异常检测（3 种算法） |
| `src/main/ai-engine/cowork/incident-classifier.js`  | 706  | 事故分级 P0-P3           |
| `src/main/ai-engine/cowork/auto-remediator.js`      | 720  | 自动修复编排 + Playbook  |
| `src/main/ai-engine/cowork/rollback-manager.js`     | 398  | 自动回滚执行             |
| `src/main/ai-engine/cowork/alert-manager.js`        | 506  | 多通道告警 + 升级链      |
| `src/main/ai-engine/cowork/postmortem-generator.js` | 422  | LLM 事故报告生成         |
| `src/main/ai-engine/cowork/autonomous-ops-ipc.js`   | 379  | 15 个 IPC handler        |

#### KPI 度量

| 指标            | 目标     | 度量方式                   |
| --------------- | -------- | -------------------------- |
| MTTR            | < 5 分钟 | 事故检测→解决耗时          |
| 自动修复成功率  | > 80%    | 成功修复 / 总触发数        |
| 误报率          | < 5%     | 误报事故 / 总检测事故      |
| 告警响应时间    | < 30 秒  | 异常检测→告警发送耗时      |
| Playbook 覆盖率 | > 70%    | Playbook 匹配事故 / 总事故 |

---

### v4.0 — 去中心化代理网络

**目标**: 基于 DID 的代理身份认证和跨组织协作，支持 100+ 节点

#### 规划模块

- [x] **Agent DID** — Agent DID 创建/解析/能力证明，基于现有 DID 系统扩展代理身份（1,089 行）
- [x] **Federated Agent Registry** — KadDHT 跨组织代理发现，去中心化技能索引（1,023 行）
- [x] **Agent Credential Manager** — 可验证凭证（Verifiable Credentials）签发与验证（891 行）
- [x] **Cross-Org Task Router** — 跨组织任务路由与委派，支持权限控制和计费（1,096 行）
- [x] **Agent Reputation** — 去中心化信誉评分系统，基于任务完成率和质量评分（639 行）
- [x] **Agent Authenticator** — DID 互认证协议，跨组织信任链建立（951 行）
- [x] **Decentralized Network IPC** — 20 个 IPC handler（449 行）

#### 去中心化代理网络架构

```
                        ┌─────────────────────────┐
                        │     KadDHT Network       │
                        │   去中心化发现协议        │
                        └────────────┬────────────┘
                                     │
               ┌─────────────────────┼─────────────────────┐
               │                     │                     │
               ▼                     ▼                     ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│   组织 A              │ │   组织 B              │ │   组织 C              │
│                       │ │                       │ │                       │
│  ┌─────────────────┐ │ │  ┌─────────────────┐ │ │  ┌─────────────────┐ │
│  │  Agent DID       │ │ │  │  Agent DID       │ │ │  │  Agent DID       │ │
│  │  did:cc:agent-A1 │ │ │  │  did:cc:agent-B1 │ │ │  │  did:cc:agent-C1 │ │
│  └────────┬────────┘ │ │  └────────┬────────┘ │ │  └────────┬────────┘ │
│           │           │ │           │           │ │           │           │
│  ┌────────┴────────┐ │ │  ┌────────┴────────┐ │ │  ┌────────┴────────┐ │
│  │ Credential Mgr   │ │ │  │ Credential Mgr   │ │ │  │ Credential Mgr   │ │
│  │ VC 签发/验证     │ │ │  │ VC 签发/验证     │ │ │  │ VC 签发/验证     │ │
│  └────────┬────────┘ │ │  └────────┬────────┘ │ │  └────────┬────────┘ │
│           │           │ │           │           │ │           │           │
│  ┌────────┴────────┐ │ │  ┌────────┴────────┐ │ │  ┌────────┴────────┐ │
│  │ Cowork Engine    │ │ │  │ Cowork Engine    │ │ │  │ Cowork Engine    │ │
│  │ 95+ Skills       │ │ │  │ 95+ Skills       │ │ │  │ 95+ Skills       │ │
│  └─────────────────┘ │ │  └─────────────────┘ │ │  └─────────────────┘ │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
               │                     │                     │
               └─────────────────────┼─────────────────────┘
                                     │
                        ┌────────────┴────────────┐
                        │  Cross-Org Task Router   │
                        │  跨组织任务路由           │
                        │                          │
                        │  ┌──────────────────┐   │
                        │  │ Agent Reputation   │   │
                        │  │ 信誉评分 + 排名    │   │
                        │  └──────────────────┘   │
                        └─────────────────────────┘
```

#### 分阶段实现

**Phase A — Agent DID 身份（Month 7-8）**:

- [x] AgentDID 实现：基于现有 DID 系统扩展代理身份，DID Document 包含技能能力声明
- [x] AgentAuthenticator 实现：DID 互认证协议（Challenge-Response），跨组织信任链
- [x] AgentCredentialManager 基础：VC 签发（能力证明、任务完成证明）
- [x] 基础 IPC（8 个）：agent-did:create、agent-did:resolve、agent-did:get-all、agent-did:revoke、agent-cred:issue、agent-cred:verify、agent-cred:revoke、decentralized:get-config

**Phase B — 联邦发现与路由（Month 8-9）**:

- [x] FederatedAgentRegistry 实现：KadDHT 去中心化代理发现，技能索引广播
- [x] CrossOrgTaskRouter 实现：跨组织任务委派、权限校验、结果回传
- [x] 集成现有 P2P Agent Network：复用 WebRTC DataChannel 作为传输层
- [x] 扩展 IPC（+7 个）：fed-registry:discover、fed-registry:register、fed-registry:query-skills、fed-registry:get-network-stats、cross-org:route-task、cross-org:get-task-status、cross-org:cancel-task

**Phase C — 信誉与扩展（Month 9-12）**:

- [x] AgentReputation 实现：基于任务完成率、质量评分、响应时间的多维信誉模型
- [x] 信誉排名：去中心化 PageRank 式排名算法
- [x] 信誉激励：高信誉代理优先接收任务
- [x] 完善 IPC（+5 个）：cross-org:get-log、reputation:get-score、reputation:get-ranking、reputation:update、reputation:get-history
- [ ] 100+ 节点压力测试 + 加固优化

#### v4.0 IPC 通道（20 个）

**Agent DID（4 个）**:

| 通道                | 功能                    |
| ------------------- | ----------------------- |
| `agent-did:create`  | 创建 Agent DID          |
| `agent-did:resolve` | 解析 Agent DID Document |
| `agent-did:get-all` | 获取所有 Agent DID      |
| `agent-did:revoke`  | 吊销 Agent DID          |

**Federated Registry（4 个）**:

| 通道                             | 功能               |
| -------------------------------- | ------------------ |
| `fed-registry:discover`          | 发现网络中的代理   |
| `fed-registry:register`          | 注册到联邦网络     |
| `fed-registry:query-skills`      | 查询网络技能可用性 |
| `fed-registry:get-network-stats` | 获取网络统计       |

**Agent Credentials（3 个）**:

| 通道                | 功能           |
| ------------------- | -------------- |
| `agent-cred:issue`  | 签发可验证凭证 |
| `agent-cred:verify` | 验证凭证有效性 |
| `agent-cred:revoke` | 吊销凭证       |

**Cross-Org Task Routing（4 个）**:

| 通道                        | 功能               |
| --------------------------- | ------------------ |
| `cross-org:route-task`      | 跨组织任务路由     |
| `cross-org:get-task-status` | 查询跨组织任务状态 |
| `cross-org:cancel-task`     | 取消跨组织任务     |
| `cross-org:get-log`         | 获取跨组织任务日志 |

**Reputation & Config（5 个）**:

| 通道                       | 功能                 |
| -------------------------- | -------------------- |
| `reputation:get-score`     | 获取代理信誉评分     |
| `reputation:get-ranking`   | 获取信誉排名         |
| `reputation:update`        | 更新信誉数据         |
| `reputation:get-history`   | 获取信誉变化历史     |
| `decentralized:get-config` | 获取去中心化网络配置 |

#### 代码示例

```javascript
// 创建 Agent DID
const agentDid = await ipcRenderer.invoke("agent-did:create", {
  name: "code-review-specialist",
  skills: ["code-review", "security-audit", "test-generator"],
  organization: "org-chainlesschain",
  capabilities: {
    maxConcurrency: 5,
    supportedLanguages: ["javascript", "typescript", "python"],
    gpuAvailable: true,
  },
});
// → {
//     did: "did:cc:agent-abc123",
//     document: { id: "did:cc:agent-abc123", skills: [...], capabilities: {...} },
//     credentials: []
//   }

// 联邦网络技能发现
const agents = await ipcRenderer.invoke("fed-registry:query-skills", {
  skillId: "security-audit",
  minReputation: 0.8,
  maxLatency: 5000,
});
// → [
//     { did: "did:cc:agent-xyz789", org: "org-securitylab", reputation: 0.95, latency: 120 },
//     { did: "did:cc:agent-def456", org: "org-devteam", reputation: 0.87, latency: 230 }
//   ]

// 跨组织任务委派
const task = await ipcRenderer.invoke("cross-org:route-task", {
  targetDid: "did:cc:agent-xyz789",
  skillId: "security-audit",
  input: {
    repository: "https://github.com/org/repo",
    branch: "main",
  },
  credential: credentialJwt, // 能力证明
  timeout: 300000,
  budget: { maxTokens: 50000 },
});
// → { taskId: "cross-task-001", status: "delegated", estimatedCompletion: "2026-07-15T10:30:00Z" }

// 查询信誉评分
const reputation = await ipcRenderer.invoke("reputation:get-score", {
  did: "did:cc:agent-abc123",
});
// → {
//     score: 0.92,
//     dimensions: { completionRate: 0.95, qualityScore: 0.88, responseTime: 0.93 },
//     totalTasks: 156, rank: 12, percentile: 95
//   }
```

#### 数据库 Schema（v4.0 新增 3 表）

```sql
-- Agent DID 注册表
CREATE TABLE agent_dids (
  did TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT,
  skills TEXT DEFAULT '[]',
  capabilities TEXT DEFAULT '{}',
  did_document TEXT DEFAULT '{}',
  credentials TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active',     -- active, suspended, revoked
  public_key TEXT,
  private_key_encrypted TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 代理信誉记录
CREATE TABLE agent_reputation (
  id TEXT PRIMARY KEY,
  agent_did TEXT NOT NULL,
  score REAL DEFAULT 0.5,
  completion_rate REAL DEFAULT 0,
  quality_score REAL DEFAULT 0,
  response_time_score REAL DEFAULT 0,
  total_tasks INTEGER DEFAULT 0,
  successful_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  feedback_history TEXT DEFAULT '[]',
  rank INTEGER,
  last_updated TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_did) REFERENCES agent_dids(did)
);

-- 联邦任务日志
CREATE TABLE federated_task_log (
  id TEXT PRIMARY KEY,
  source_did TEXT NOT NULL,
  target_did TEXT NOT NULL,
  source_org TEXT,
  target_org TEXT,
  skill_id TEXT NOT NULL,
  input TEXT DEFAULT '{}',
  result TEXT,
  status TEXT DEFAULT 'pending',    -- pending, delegated, accepted, running, completed, failed, cancelled
  credential_jwt TEXT,
  budget TEXT DEFAULT '{}',
  latency_ms INTEGER,
  delegated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
```

#### 关键文件

| 文件                                                     | 行数  | 职责                         |
| -------------------------------------------------------- | ----- | ---------------------------- |
| `src/main/ai-engine/cowork/agent-did.js`                 | 1,089 | Agent DID 创建/解析/能力证明 |
| `src/main/ai-engine/cowork/federated-agent-registry.js`  | 1,023 | KadDHT 联邦代理发现          |
| `src/main/ai-engine/cowork/agent-credential-manager.js`  | 891   | 可验证凭证签发与验证         |
| `src/main/ai-engine/cowork/cross-org-task-router.js`     | 1,096 | 跨组织任务路由               |
| `src/main/ai-engine/cowork/agent-reputation.js`          | 639   | 去中心化信誉系统             |
| `src/main/ai-engine/cowork/agent-authenticator.js`       | 951   | DID 互认证协议               |
| `src/main/ai-engine/cowork/decentralized-network-ipc.js` | 449   | 20 个 IPC handler            |

#### KPI 度量

| 指标             | 目标    | 度量方式                    |
| ---------------- | ------- | --------------------------- |
| 网络节点数       | ≥ 100   | KadDHT 活跃节点计数         |
| 跨组织任务成功率 | > 90%   | 成功完成 / 总委派数         |
| DID 认证延迟     | < 500ms | Challenge-Response 往返耗时 |
| 技能发现延迟     | < 2 秒  | 查询发起→结果返回耗时       |
| 信誉更新一致性   | > 99%   | 最终一致性收敛率            |

---

### 实现时间线总览

```
Month 1-2:   Phase 3.0.A (流水线框架)        + Phase 3.3.A (异常检测)
Month 2-3:   Phase 3.1.A (Spec 翻译引擎)     + Phase 3.2.A (文档/图像融合)
Month 3-4:   Phase 3.0.B (代理集成)           + Phase 3.3.B (自动修复)
Month 4-5:   Phase 3.1.B (约定分析与代码生成) + Phase 3.2.B (语音/屏幕)
Month 5-6:   Phase 3.0.C (部署与监控)         + Phase 3.3.C (自学习与报告)
Month 6-7:   Phase 3.1.C (交互精炼)           + Phase 3.2.C (富输出生成)
Month 7-9:   Phase 4.0.A-B (Agent DID + 联邦发现与路由)
Month 9-12:  Phase 4.0.C (信誉与扩展) + 全系统加固优化
```

#### 新增总量统计

| 方向             | 版本 | 新增模块 | 新增行数   | IPC 通道 | 数据库表 | 新技能 |
| ---------------- | ---- | -------- | ---------- | -------- | -------- | ------ |
| 全自动开发流水线 | v3.0 | 5        | 2,954      | 15       | 3        | 0      |
| 自然语言编程     | v3.1 | 3        | 1,696      | 10       | 2        | 0      |
| 多模态协作       | v3.2 | 6        | 2,527      | 12       | 2        | 0      |
| 自主运维         | v3.3 | 7        | 3,805      | 15       | 3        | 0      |
| 去中心化代理网络 | v4.0 | 7        | 6,138      | 20       | 3        | 0      |
| **合计**         | —    | **28**   | **17,120** | **72**   | **13**   | **0**  |

### 路线图总览

| 版本   | 功能                   | 核心技术                            | 状态      |
| ------ | ---------------------- | ----------------------------------- | --------- |
| v1.1.0 | 技能生态与工作流集成   | Pipeline、Vue Flow、Git Hooks       | ✅ 已完成 |
| v1.2.0 | 专业化代理与智能调度   | Instinct、Orchestrate、Verification | ✅ 已完成 |
| v1.3.0 | ML 调度与 CI/CD 优化   | 线性回归、负载均衡、OpenAPI 3.0     | ✅ 已完成 |
| v2.0.0 | 跨设备协作与分布式执行 | WebRTC P2P、REST API、Webhook       | ✅ 已完成 |
| v2.1.0 | 自进化与知识图谱       | 知识图谱、Prompt 优化、辩论审查     | ✅ 已完成 |
| v3.0   | 全自动开发流水线       | Pipeline 编排、需求解析、自动部署   | ✅ 已完成 |
| v3.1   | 自然语言编程           | NL→Spec 翻译、约定分析、代码生成    | ✅ 已完成 |
| v3.2   | 多模态协作             | 模态融合、文档/语音/屏幕解析        | ✅ 已完成 |
| v3.3   | 自主运维               | 异常检测、自动修复、告警升级        | ✅ 已完成 |
| v4.0   | 去中心化代理网络       | Agent DID、联邦发现、跨组织路由     | ✅ 已完成 |

## 贡献指南

欢迎贡献代码和反馈问题！

- [GitHub Issues](https://github.com/chainlesschain/issues)
- [贡献指南](https://github.com/chainlesschain/CONTRIBUTING.md)

## 许可证

MIT License - 详见 [LICENSE](https://github.com/chainlesschain/LICENSE)

---

**代码行数**: ~45,120 行 (含测试和文档, 含 v3.0-v4.0 已实现 17,120 行)
**IPC 处理器**: 238 个 (全部已实现: 166 基础 + 72 v3.0-v4.0)
**内置技能**: 95 个 (全部已实现)
**数据库表**: 21 张新表 (全部已实现: 8 基础 + 13 v3.0-v4.0)
**流水线模板**: 10 个预置模板
**跨设备支持**: Desktop + Android + iOS + Cloud (4 平台)
**API 端点**: 20+ RESTful 端点 + SSE 实时推送
**Webhook 事件**: 17 种事件类型
**测试用例**: 440+ (通过率 99.6%)
**维护者**: ChainlessChain Team

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/ai-engine/cowork/pipeline-orchestrator.js` | 流水线编排器（7 阶段） |
| `desktop-app-vue/src/main/ai-engine/cowork/deploy-agent.js` | 部署 Agent（5 种策略） |
| `desktop-app-vue/src/main/ai-engine/cowork/spec-translator.js` | NL→Spec 规范翻译 |
| `desktop-app-vue/src/main/ai-engine/cowork/anomaly-detector.js` | 异常检测（Z-score/IQR） |
| `desktop-app-vue/src/main/ai-engine/cowork/incident-classifier.js` | 事件分类器 |
| `desktop-app-vue/src/main/ai-engine/cowork/auto-remediator.js` | 自动修复引擎 |
| `desktop-app-vue/src/main/ai-engine/cowork/modality-fusion.js` | 多模态融合 |
| `desktop-app-vue/src/main/ai-engine/cowork/agent-did.js` | Agent DID 身份 |
| `desktop-app-vue/src/main/ai-engine/cowork/federated-agent-registry.js` | 联邦代理注册 |
| `desktop-app-vue/src/main/ai-engine/cowork/cross-org-task-router.js` | 跨组织任务路由 |

## 相关文档

- [Cowork 核心文档](/chainlesschain/cowork) — TeammateTool、Agent Pool、FileSandbox、Skills 系统
- [Cowork 高级功能](/chainlesschain/cowork-advanced) — Instinct、Orchestrate、Verification Loop
- [开发流水线编排](/chainlesschain/dev-pipeline) — 7 阶段流水线详情
- [Agent 经济系统](/chainlesschain/agent-economy) — Agent 代币激励
