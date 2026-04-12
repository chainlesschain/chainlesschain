# v1.1.0 实施计划

> **目标版本**: v1.1.0 | **计划周期**: 2026 Q1-Q2 | **最后更新**: 2026-02-27

## 概述

v1.1.0 实施计划是 ChainlessChain v3.0-v4.0 后端模块（28 个模块、72 个 IPC 通道）的前端集成与发布路线图，规划为 6 个 Sprint（12 周），涵盖 5 个新前端页面开发、全链路 E2E 测试、安全审查和灰度发布。当前后端模块、单元测试、前端页面和文档均已完成，集成测试和生产加固待启动。

## 核心特性

- 📋 **6 个 Sprint 规划**: 12 周迭代，覆盖前端集成、测试加固、文档完善、发布准备
- 🖥️ **5 个新前端页面**: 部署监控、NL 编程、多模态协作、自主运维、联邦网络
- 🧪 **全链路验证**: 6 个 E2E 测试 + 联邦网络压测 + 性能基线采集
- 🔒 **安全审查**: DID 密钥安全、跨组织认证、部署代理权限、数据隔离四项审查
- 📊 **72 个 IPC 通道**: v3.0-v4.0 全部 28 个后端模块的前端集成

## 系统架构

```
┌──────────────────────────────────────────────┐
│          v1.1.0 实施计划架构                   │
│                                              │
│  Sprint 1-2          Sprint 3-4              │
│  ┌──────────┐        ┌──────────────┐        │
│  │v3.0 流水线│        │v3.2 多模态   │        │
│  │v3.1 NL编程│        │v3.3 自主运维 │        │
│  └────┬─────┘        │v4.0 联邦网络 │        │
│       │              └──────┬───────┘        │
│       └──────────┬──────────┘                │
│                  ▼                            │
│  Sprint 5: 集成测试 + 生产加固               │
│  ┌──────────────────────────────────────┐    │
│  │ E2E 测试 | 性能基线 | 安全审查      │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  Sprint 6: 文档完善 + 版本发布               │
│  ┌──────────────────────────────────────┐    │
│  │ 5 篇功能文档 | 侧边栏 | 灰度发布   │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/renderer/pages/DeploymentMonitorPage.vue` | 部署监控页面 |
| `desktop-app-vue/src/renderer/pages/NLProgrammingPage.vue` | NL 编程页面 |
| `desktop-app-vue/src/renderer/pages/MultimodalCollabPage.vue` | 多模态协作页面 |
| `desktop-app-vue/src/renderer/pages/AutonomousOpsPage.vue` | 自主运维页面 |
| `desktop-app-vue/src/renderer/pages/FederatedNetworkPage.vue` | 联邦网络页面 |

## 相关文档

- [产品演进路线图](/chainlesschain/product-roadmap)
- [Cowork 路线图](/chainlesschain/cowork-roadmap)
- [更新日志](/changelog)

本文档为 ChainlessChain v1.1.0 版本的详细实施计划。v3.0-v4.0 后端核心模块已全部实现（28 个模块，~13,200 行代码，72 个 IPC 处理器），本计划聚焦于前端集成、文档完善、测试加固和发布准备。

> 产品路线图请参阅 [产品演进路线图](/chainlesschain/product-roadmap) | 模块详情请参阅 [Cowork 路线图](/chainlesschain/cowork-roadmap)

---

## 完成度总览

| 维度          | 完成度    | 说明                                    |
| ------------- | --------- | --------------------------------------- |
| 后端模块      | ✅ 100%   | 28 个模块全部实现，56 个 cowork 文件    |
| 单元测试      | ✅ 100%   | 19 个关键模块均有测试文件               |
| 集成测试      | ✅ 100%   | E2E pipeline + cross-org 测试已有       |
| 数据库 Schema | ✅ 100%   | 13 张新表 + 索引已创建                  |
| 技能定义      | ✅ 100%   | 95 个 SKILL.md 已完成                   |
| 前端页面      | ✅ 100%   | 5 个新页面已创建（Sprint 1-4 合并交付） |
| 前端 Store    | ✅ 100%   | 5 个新 Store 已创建                     |
| 路由注册      | ✅ 100%   | 5 条新路由已注册                        |
| 用户文档      | ✅ 100%   | 5 篇功能文档 + 侧边栏已更新             |
| 生产加固      | 📋 待开始 | 需压测、监控、灰度方案                  |

---

## Sprint 规划

### Sprint 1（第 1-2 周）：v3.0 全自动流水线前端集成 ✅ 已完成

**目标**: 流水线编排功能可在前端完整操作

#### 1.1 前端页面开发

| 任务               | 文件                                            | 预估  | 优先级 |
| ------------------ | ----------------------------------------------- | ----- | ------ |
| 部署监控页面       | `renderer/pages/DeploymentMonitorPage.vue`      | 3天   | P0     |
| 部署状态时间线组件 | `renderer/components/deploy/DeployTimeline.vue` | 1天   | P0     |
| 部署环境切换组件   | `renderer/components/deploy/EnvSelector.vue`    | 0.5天 | P0     |
| 回滚确认对话框     | `renderer/components/deploy/RollbackDialog.vue` | 0.5天 | P0     |

**DeploymentMonitorPage.vue 功能清单**:

```
┌──────────────────────────────────────────────┐
│  DeploymentMonitorPage                       │
│  ┌────────────────────────────────────────┐  │
│  │ 环境选择: [dev] [staging] [prod]       │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ 部署时间线                              │  │
│  │  ● Build ✅ → Deploy ✅ → Health ⏳    │  │
│  │  开始: 14:30  |  耗时: 2m30s           │  │
│  └────────────────────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ KPI 基线偏差 │  │ 回滚操作              │  │
│  │  CPU: +2%    │  │ [Git Revert]          │  │
│  │  Mem: -1%    │  │ [Docker Rollback]     │  │
│  │  Err: 0%  ✅ │  │ [Config Restore]      │  │
│  └──────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────┘
```

#### 1.2 Pinia Store 扩展

| 任务           | 文件                            | 预估 |
| -------------- | ------------------------------- | ---- |
| 部署状态 Store | `renderer/stores/deployment.ts` | 1天  |

**Store 接口设计**:

```typescript
// deployment.ts
interface DeploymentState {
  currentDeployment: Deployment | null;
  deployHistory: Deployment[];
  healthStatus: HealthReport | null;
  rollbackAvailable: boolean;
}

// IPC 映射
// pipeline:start → startPipeline()
// pipeline:get-status → refreshStatus()
// pipeline:approve-gate → approveGate()
// deploy-monitor:get-health → checkHealth()
```

#### 1.3 路由注册

```typescript
// router/index.ts 新增
{ path: '/deployment-monitor', component: DeploymentMonitorPage }
```

#### 1.4 文档

| 任务           | 文件                                        | 预估 |
| -------------- | ------------------------------------------- | ---- |
| 流水线编排文档 | `docs-site/docs/chainlesschain/pipeline.md` | 1天  |

**文档结构**: 系统概述 → 7 阶段生命周期 → 门控审批 → 10 个预置模板 → 15 个 IPC 通道 → 配置 → 使用示例 → 故障排除

---

### Sprint 2（第 3-4 周）：v3.1 自然语言编程前端 ✅ 已完成

**目标**: 用户可通过自然语言描述需求并生成代码

#### 2.1 前端页面开发

| 任务              | 文件                                          | 预估  | 优先级 |
| ----------------- | --------------------------------------------- | ----- | ------ |
| NL 编程编辑器页面 | `renderer/pages/NLProgrammingPage.vue`        | 4天   | P0     |
| Spec 预览面板     | `renderer/components/nl/SpecPreview.vue`      | 1天   | P0     |
| 代码约定检视器    | `renderer/components/nl/ConventionViewer.vue` | 1天   | P1     |
| 意图分类标签      | `renderer/components/nl/IntentTag.vue`        | 0.5天 | P1     |

**NLProgrammingPage.vue 功能清单**:

```
┌──────────────────────────────────────────────┐
│  NLProgrammingPage                           │
│  ┌────────────────────────────────────────┐  │
│  │ 自然语言输入区                          │  │
│  │ "创建一个用户注册表单，包含邮箱验证     │  │
│  │  和密码强度检查"                        │  │
│  │                        [翻译为 Spec]    │  │
│  └────────────────────────────────────────┘  │
│  ┌───────────────────┐ ┌──────────────────┐  │
│  │ Spec 结构化预览   │ │ 项目约定          │  │
│  │ 意图: [新功能]    │ │ 命名: camelCase  │  │
│  │ 实体: User, Form  │ │ 框架: Vue3 SFC   │  │
│  │ 验收: 3 条        │ │ 测试: Vitest     │  │
│  │ 完整度: 85%       │ │                  │  │
│  │ [补充细节] [生成]  │ │ [重新分析]       │  │
│  └───────────────────┘ └──────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ 生成代码预览                            │  │
│  │  UserRegisterForm.vue  (diff view)     │  │
│  │  [应用到工作区]  [修改]  [取消]          │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

#### 2.2 Store + 路由

| 任务          | 文件                           | 预估  |
| ------------- | ------------------------------ | ----- |
| NL 编程 Store | `renderer/stores/nlProgram.ts` | 1天   |
| 路由注册      | `router/index.ts` 新增         | 0.5天 |

#### 2.3 文档

| 任务             | 文件                                              | 预估 |
| ---------------- | ------------------------------------------------- | ---- |
| 自然语言编程指南 | `docs-site/docs/chainlesschain/nl-programming.md` | 1天  |

---

### Sprint 3（第 5-6 周）：v3.2 多模态协作 + v3.3 自主运维前端 ✅ 已完成

**目标**: 多模态输入/输出可视化 + 运维监控告警面板

#### 3.1 多模态前端

| 任务             | 文件                                                    | 预估 | 优先级 |
| ---------------- | ------------------------------------------------------- | ---- | ------ |
| 多模态协作页面   | `renderer/pages/MultimodalCollabPage.vue`               | 4天  | P0     |
| 模态输入选择器   | `renderer/components/multimodal/ModalityPicker.vue`     | 1天  | P0     |
| 富媒体输出渲染器 | `renderer/components/multimodal/RichOutputRenderer.vue` | 2天  | P0     |
| 文档解析预览     | `renderer/components/multimodal/DocParsePreview.vue`    | 1天  | P1     |

**MultimodalCollabPage.vue 功能清单**:

```
┌──────────────────────────────────────────────┐
│  MultimodalCollabPage                        │
│  ┌────────────────────────────────────────┐  │
│  │ 输入模态: [文本] [文档] [图像] [屏幕]  │  │
│  │                                        │  │
│  │ 📄 拖拽上传 PDF/Word/Excel             │  │
│  │ 📸 截图 / 粘贴图片                     │  │
│  │ 🖥️ 屏幕录制区域选择                    │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ 融合上下文预览                          │  │
│  │ Token 预算: 4,200 / 8,000              │  │
│  │ ████████░░░░░ 52.5%                    │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ 输出: [Markdown] [HTML] [ECharts] [PPT]│  │
│  │ ┌──────────────────────────────────┐   │  │
│  │ │ (富媒体渲染区)                    │   │  │
│  │ └──────────────────────────────────┘   │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

#### 3.2 自主运维前端（扩展已有 ErrorMonitorPage）

| 任务            | 文件                                           | 预估 | 优先级 |
| --------------- | ---------------------------------------------- | ---- | ------ |
| 运维控制台页面  | `renderer/pages/AutonomousOpsPage.vue`         | 3天  | P0     |
| 告警面板组件    | `renderer/components/ops/AlertPanel.vue`       | 1天  | P0     |
| Playbook 编辑器 | `renderer/components/ops/PlaybookEditor.vue`   | 2天  | P1     |
| 事故报告查看器  | `renderer/components/ops/PostmortemViewer.vue` | 1天  | P1     |

#### 3.3 Store + 路由

| 任务         | 文件                               | 预估  |
| ------------ | ---------------------------------- | ----- |
| 多模态 Store | `renderer/stores/multimodal.ts`    | 1天   |
| 运维 Store   | `renderer/stores/autonomousOps.ts` | 1天   |
| 路由注册     | `router/index.ts` 新增 2 条        | 0.5天 |

#### 3.4 文档

| 任务           | 文件                                              | 预估 |
| -------------- | ------------------------------------------------- | ---- |
| 多模态协作文档 | `docs-site/docs/chainlesschain/multimodal.md`     | 1天  |
| 自主运维文档   | `docs-site/docs/chainlesschain/autonomous-ops.md` | 1天  |

---

### Sprint 4（第 7-8 周）：v4.0 去中心化代理网络前端 ✅ 已完成

**目标**: 联邦代理发现、跨组织任务管理、信誉系统可视化

#### 4.1 前端页面开发

| 任务           | 文件                                                 | 预估 | 优先级 |
| -------------- | ---------------------------------------------------- | ---- | ------ |
| 联邦网络总览页 | `renderer/pages/FederatedNetworkPage.vue`            | 4天  | P0     |
| 代理信誉页面   | `renderer/pages/AgentReputationPage.vue`             | 2天  | P0     |
| 跨组织任务页面 | `renderer/pages/CrossOrgTaskPage.vue`                | 3天  | P0     |
| 网络拓扑图组件 | `renderer/components/federation/NetworkTopology.vue` | 2天  | P1     |
| DID 身份卡片   | `renderer/components/federation/AgentDIDCard.vue`    | 1天  | P1     |
| 信誉雷达图     | `renderer/components/federation/ReputationRadar.vue` | 1天  | P1     |

**FederatedNetworkPage.vue 功能清单**:

```
┌──────────────────────────────────────────────┐
│  FederatedNetworkPage                        │
│  ┌────────────────────────────────────────┐  │
│  │ 网络拓扑                                │  │
│  │       [Org-A]───[Org-B]                │  │
│  │          │    ╲    │                    │  │
│  │          │     ╲   │                    │  │
│  │       [Org-C]───[Org-D]                │  │
│  │  在线节点: 12  |  总技能: 340          │  │
│  └────────────────────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 我的 Agent   │  │ 发现的代理            │  │
│  │ DID:cc:a-xxx │  │ ┌──────────────────┐ │  │
│  │ 技能: 95     │  │ │ Agent-β (Org-B)  │ │  │
│  │ 信誉: 0.92   │  │ │ 信誉: 0.88       │ │  │
│  │ 等级: Expert │  │ │ 技能: code-review│ │  │
│  │              │  │ │ [委派任务]        │ │  │
│  └──────────────┘  │ └──────────────────┘ │  │
│                    └──────────────────────┘  │
└──────────────────────────────────────────────┘
```

#### 4.2 Store + 路由

| 任务           | 文件                                 | 预估  |
| -------------- | ------------------------------------ | ----- |
| 联邦网络 Store | `renderer/stores/agentNetwork.ts`    | 1.5天 |
| 信誉 Store     | `renderer/stores/agentReputation.ts` | 1天   |
| 路由注册       | `router/index.ts` 新增 3 条          | 0.5天 |

#### 4.3 文档

| 任务         | 文件                                                | 预估  |
| ------------ | --------------------------------------------------- | ----- |
| 代理联邦文档 | `docs-site/docs/chainlesschain/agent-federation.md` | 1.5天 |

---

### Sprint 5（第 9-10 周）：集成测试 + 生产加固

**目标**: 全链路验证 + 性能基线 + 灰度发布方案

#### 5.1 集成测试补充

| 任务               | 文件                                                | 预估 | 优先级 |
| ------------------ | --------------------------------------------------- | ---- | ------ |
| 流水线端到端测试   | `__tests__/e2e/pipeline-full-lifecycle.e2e.test.js` | 2天  | P0     |
| NL→代码全链路测试  | `__tests__/e2e/nl-to-code.e2e.test.js`              | 2天  | P0     |
| 多模态融合测试     | `__tests__/e2e/multimodal-fusion.e2e.test.js`       | 1天  | P0     |
| 自主运维场景测试   | `__tests__/e2e/autonomous-ops-scenario.e2e.test.js` | 1天  | P0     |
| 联邦网络压力测试   | `__tests__/stress/federation-load.test.js`          | 2天  | P0     |
| 跨组织任务路由测试 | `__tests__/e2e/cross-org-routing.e2e.test.js`       | 1天  | P1     |

**测试场景设计**:

```
流水线端到端 (pipeline-full-lifecycle):
  1. 创建 feature 类型流水线
  2. 提交自然语言需求 → Requirement Parser
  3. 自动分配 Orchestrate 编排
  4. 代码生成 → Verification Loop
  5. 门控审批 → 部署 → 健康检查
  6. 模拟异常 → 自动回滚
  预期: 全流程 < 5 分钟，回滚 < 30 秒

联邦网络压力 (federation-load):
  1. 模拟 100 个 Agent DID 注册
  2. 并发 50 个跨组织任务委派
  3. 信誉评分实时更新
  4. 技能发现延迟测量
  预期: DID 认证 < 500ms，发现 < 2s
```

#### 5.2 性能基线

| 任务             | 说明                                | 预估 |
| ---------------- | ----------------------------------- | ---- |
| 流水线性能基线   | 记录各阶段耗时基线，设置告警阈值    | 1天  |
| IPC 通道延迟测试 | 72 个新 IPC 的 p50/p95/p99 延迟     | 1天  |
| 内存泄漏检测     | 长时间运行流水线/联邦网络的内存监控 | 1天  |
| SQLite 性能      | 13 张新表在 10 万行级别的查询性能   | 1天  |

#### 5.3 安全审查

| 任务             | 说明                                            | 预估  |
| ---------------- | ----------------------------------------------- | ----- |
| DID 密钥安全审查 | Ed25519 密钥生成、存储、轮换的安全性            | 1天   |
| 跨组织认证审查   | Challenge-Response 协议、凭证验证的抗攻击性     | 1天   |
| 部署代理权限审查 | Deploy Agent 的文件系统/Git/Docker 操作权限边界 | 0.5天 |
| 数据隔离审查     | 跨组织数据是否严格隔离                          | 0.5天 |

#### 5.4 生产加固

| 任务         | 说明                                   | 预估  |
| ------------ | -------------------------------------- | ----- |
| 错误恢复机制 | 流水线中断后的断点续传                 | 1天   |
| 优雅降级     | 联邦网络不可用时的本地回退             | 1天   |
| 日志增强     | v3.0-v4.0 模块的结构化日志（审计集成） | 1天   |
| 配置校验     | 新模块配置项的 schema 校验和默认值     | 0.5天 |

---

### Sprint 6（第 11-12 周）：文档完善 + 侧边栏 + 发布 ✅ 文档部分已完成

**目标**: 用户文档齐全，版本发布

#### 6.1 文档站更新

| 任务             | 文件                                                   | 预估   |
| ---------------- | ------------------------------------------------------ | ------ |
| 流水线编排文档   | `docs-site/docs/chainlesschain/pipeline.md`            | 1天    |
| 自然语言编程文档 | `docs-site/docs/chainlesschain/nl-programming.md`      | 1天    |
| 多模态协作文档   | `docs-site/docs/chainlesschain/multimodal.md`          | 1天    |
| 自主运维文档     | `docs-site/docs/chainlesschain/autonomous-ops.md`      | 1天    |
| 代理联邦文档     | `docs-site/docs/chainlesschain/agent-federation.md`    | 1.5天  |
| 实施计划文档     | `docs-site/docs/chainlesschain/implementation-plan.md` | 已创建 |

**每篇文档结构**: 版本标注 → 系统概述 → 核心功能 → IPC 接口 → 配置参考 → 使用示例 → 故障排除 → 相关文档

#### 6.2 侧边栏配置更新

```javascript
// config.js 新增分组
{
  text: "v1.1.0 新功能",
  items: [
    { text: "流水线编排", link: "/chainlesschain/pipeline" },
    { text: "自然语言编程", link: "/chainlesschain/nl-programming" },
    { text: "多模态协作", link: "/chainlesschain/multimodal" },
    { text: "自主运维", link: "/chainlesschain/autonomous-ops" },
    { text: "代理联邦网络", link: "/chainlesschain/agent-federation" },
  ],
},
```

#### 6.3 发布准备

| 任务              | 说明                              | 预估  |
| ----------------- | --------------------------------- | ----- |
| 更新 CHANGELOG.md | v1.1.0 正式发布说明               | 0.5天 |
| 更新 CLAUDE.md    | Feature Index 新增 v3.0-v4.0 模块 | 0.5天 |
| 更新 package.json | 版本号升至 1.1.0                  | 0.5天 |
| 灰度发布方案      | 内部测试 → 10% 用户 → 50% → 全量  | 1天   |
| 回滚预案          | 版本回退 SOP                      | 0.5天 |

---

## 里程碑与交付物

```
Week 1-2   Sprint 1  ──── v3.0 流水线前端                    ✅ 已完成
                           ✦ DeploymentMonitorPage.vue        ✅
                           ✦ deployment.ts Store              ✅
                           ✦ pipeline.md 文档                 ✅

Week 3-4   Sprint 2  ──── v3.1 NL 编程前端                   ✅ 已完成
                           ✦ NLProgrammingPage.vue            ✅
                           ✦ nlProgram.ts Store               ✅
                           ✦ nl-programming.md 文档           ✅

Week 5-6   Sprint 3  ──── v3.2 多模态 + v3.3 运维前端        ✅ 已完成
                           ✦ MultimodalCollabPage.vue         ✅
                           ✦ AutonomousOpsPage.vue            ✅
                           ✦ multimodal.md + autonomous-ops.md ✅

Week 7-8   Sprint 4  ──── v4.0 联邦网络前端                  ✅ 已完成
                           ✦ FederatedNetworkPage.vue         ✅（含信誉+跨组织 Tab）
                           ✦ agentNetwork.ts Store            ✅
                           ✦ agent-federation.md              ✅

Week 9-10  Sprint 5  ──── 集成测试 + 生产加固                📋 待开始
                           ✦ 6 个 E2E 测试
                           ✦ 性能基线报告
                           ✦ 安全审查报告

Week 11-12 Sprint 6  ──── 文档 + 发布                        🔄 文档已完成
                           ✦ 5 篇功能文档                     ✅
                           ✦ 侧边栏更新                      ✅
                           ✦ v1.1.0 正式发布                  📋 待发布
```

---

## 工作量统计

| 类别        | 工作项                  | 预估人天      |
| ----------- | ----------------------- | ------------- |
| 前端页面    | 6 个新页面 + 15 个组件  | 32 天         |
| Pinia Store | 5 个新 Store            | 5.5 天        |
| 路由注册    | 8 条新路由              | 1 天          |
| 集成测试    | 6 个 E2E + 1 个压力测试 | 9 天          |
| 性能测试    | 4 项基线测试            | 4 天          |
| 安全审查    | 4 项审查                | 3 天          |
| 生产加固    | 4 项加固                | 3.5 天        |
| 用户文档    | 5 篇功能文档            | 5.5 天        |
| 发布准备    | 配置 + 灰度 + 预案      | 3 天          |
| **合计**    |                         | **66.5 人天** |

**按 1 人全职估算**: 约 13 周（含缓冲）
**按 2 人并行估算**: 约 7 周

---

## 风险与应对

| 风险                | 影响               | 概率 | 应对                                                                    |
| ------------------- | ------------------ | ---- | ----------------------------------------------------------------------- |
| 联邦网络性能不达标  | 跨组织任务延迟超标 | 中   | Sprint 5 提前压测，预留优化 buffer                                      |
| NL 编程准确率不足   | 用户体验差         | 中   | 多轮对话澄清 + 项目约定强化 + 人工确认门控                              |
| 多模态 Token 超预算 | 模态融合成本高     | 低   | Token 预算控制已实现，降级为单模态                                      |
| 部署代理操作风险    | 误操作影响生产     | 低   | 门控审批 + 回滚预案 + 权限最小化                                        |
| 前端开发周期延长    | 延期发布           | 中   | 分批发布：v1.1.0-alpha (v3.0) → v1.1.0-beta (v3.1-v3.3) → v1.1.0 (v4.0) |

---

## 验收标准

### 功能验收

- [x] 5 个新前端页面已创建（Sprint 4 合并为单页 Tab 布局）
- [x] 5 个 Pinia Store 覆盖 72 个 IPC 通道
- [x] 流水线全流程 UI：创建→执行→审批→部署→监控
- [x] NL 编程 UI：自然语言→Spec→代码生成
- [x] 多模态 UI：文档/图像/屏幕输入→融合→多格式输出
- [x] 运维 UI：告警/事故/Playbook 修复/事故报告
- [x] 联邦网络 UI：DID 管理/代理发现/任务委派
- [x] 信誉排行 UI：排行榜 + 信誉详情

### 非功能验收

- [ ] 所有 E2E 测试通过
- [ ] IPC 通道 p95 延迟 < 200ms
- [ ] 联邦网络 100 节点压测通过
- [ ] DID 认证 < 500ms
- [ ] 无 P0/P1 安全漏洞
- [ ] 5 篇功能文档齐全并通过 review
- [ ] 灰度 10% 用户 48 小时无 P0 故障

---

> 本计划为动态文档，随开发进展持续更新。
> 相关参考：[产品演进路线图](/chainlesschain/product-roadmap) | [Cowork 路线图](/chainlesschain/cowork-roadmap) | [更新日志](/changelog)
