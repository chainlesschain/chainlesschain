# Skill Marketplace 技能市场

> **版本: v3.1.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | Skill-as-a-Service 协议**

ChainlessChain Skill Marketplace 是一个去中心化的技能即服务（Skill-as-a-Service）协议，实现了标准化的技能发布、发现和远程调用能力。它支持 EvoMap Gene 格式集成、版本管理、SLA 约束以及 DAG 流水线组合，为跨节点技能协作提供完整的基础设施。

## 概述

技能市场是 ChainlessChain 的去中心化技能交易与协作平台，允许用户发布、发现和远程调用标准化技能。技能通过输入/输出/依赖/SLA 四维描述格式注册到分布式注册表，支持语义化版本管理和 DAG 流水线组合，可将多个技能串联或并行编排为复杂工作流，并与 EvoMap Gene 进化网络深度集成。

## 核心特性

- 📦 **标准化技能描述**: 输入/输出/依赖/SLA 四维描述格式，统一技能元数据
- 🧬 **EvoMap Gene 集成**: 技能可发布为 Gene 格式，融入进化网络
- 🔍 **技能发现注册**: 分布式技能注册表，支持按名称/标签/能力搜索
- 📋 **版本管理**: 语义化版本控制，支持版本历史查询
- 🔗 **流水线 DAG 组合**: 多技能串联/并行组合，构建复杂工作流
- 🌐 **远程调用协议**: 跨节点技能调用，支持超时和并发控制

## 系统架构

```
┌──────────────────┐     ┌──────────────────┐
│  Renderer (Vue)  │     │  Remote Nodes    │
│  SkillMarketplace│     │  (P2P Network)   │
│  Page + Store    │     └────────┬─────────┘
└────────┬─────────┘              │
         │ IPC                    │ gRPC/HTTP
         ▼                        ▼
┌─────────────────────────────────────────┐
│         Skill Service Protocol          │
│  ┌───────────┐  ┌────────────────────┐  │
│  │ Registry  │  │  Remote Invoker    │  │
│  │ (SQLite)  │  │  (Timeout/Retry)   │  │
│  └───────────┘  └────────────────────┘  │
│  ┌───────────┐  ┌────────────────────┐  │
│  │ Version   │  │  Pipeline DAG      │  │
│  │ Manager   │  │  Composer          │  │
│  └───────────┘  └────────────────────┘  │
└──────────────────┬──────────────────────┘
                   │
          ┌────────▼────────┐
          │  EvoMap Gene    │
          │  Integration    │
          └─────────────────┘
```

## 技能发布

```javascript
// 发布新技能到市场
const result = await window.electron.ipcRenderer.invoke(
  "skill-service:publish-skill",
  {
    name: "data-analysis",
    description: "智能数据分析与可视化",
    version: "1.0.0",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" } },
    },
    outputSchema: {
      type: "object",
      properties: { report: { type: "string" } },
    },
    sla: { maxLatencyMs: 30000, availability: 0.99 },
  },
);
// result.skill = { id, name, version, status: "published", ... }
```

## 远程技能调用

```javascript
// 调用远程技能
const result = await window.electron.ipcRenderer.invoke(
  "skill-service:invoke-remote",
  {
    skillId: "skill-001",
    input: { filePath: "/data/sales.csv" },
    timeout: 30000,
  },
);
// result = { output: { report: "..." }, duration: 1234, ... }
```

## 技能流水线组合

```javascript
// 组合多个技能为流水线
const pipeline = await window.electron.ipcRenderer.invoke(
  "skill-service:compose-pipeline",
  {
    steps: [
      { skillId: "data-loader", input: { path: "/data" } },
      { skillId: "data-analysis", input: { mode: "trend" } },
      { skillId: "chart-creator", input: { type: "line" } },
    ],
  },
);
```

## IPC 接口完整列表

### Skill Service 操作（5 个）

| 通道                             | 功能           | 说明                     |
| -------------------------------- | -------------- | ------------------------ |
| `skill-service:list-skills`      | 列出已注册技能 | 支持过滤和分页           |
| `skill-service:publish-skill`    | 发布新技能     | 注册技能元数据和 SLA     |
| `skill-service:invoke-remote`    | 远程调用技能   | 跨节点执行，支持超时控制 |
| `skill-service:get-versions`     | 获取版本历史   | 查询指定技能的版本列表   |
| `skill-service:compose-pipeline` | 组合技能流水线 | DAG 方式组合多个技能     |

## 数据库 Schema

**2 张核心表**:

| 表名                     | 用途           | 关键字段                                         |
| ------------------------ | -------------- | ------------------------------------------------ |
| `skill_service_registry` | 技能注册元数据 | id, name, version, status, owner_did, sla (JSON) |
| `skill_invocations`      | 调用历史与指标 | id, skill_id, caller_did, duration_ms, success   |

## 配置参考

```javascript
{
  skillService: {
    enabled: false,                    // 是否启用技能市场
    maxConcurrentInvocations: 10,      // 最大并发调用数
    defaultTimeout: 30000,             // 默认调用超时（30秒）
    publishRequiresApproval: true,     // 发布是否需要审批
  }
}
```

## 性能指标

### 响应时间

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 技能注册（本地） | < 50ms | < 30ms | ✅ |
| 技能列表查询 | < 100ms | < 60ms | ✅ |
| 远程技能调用（局域网） | < 500ms | < 300ms | ✅ |
| 远程技能调用（跨节点） | < 5000ms | < 3000ms | ✅ |
| 流水线 DAG 组合（3 步骤） | < 10000ms | < 7000ms | ✅ |
| 版本历史查询 | < 100ms | < 50ms | ✅ |

### 资源使用

| 指标 | 数值 |
|------|------|
| 最大并发调用数（默认） | 10 |
| 单次调用默认超时 | 30,000ms |
| 技能注册元数据大小（平均） | ~2 KB |
| 调用历史记录保留条数 | 无上限（SQLite） |
| 内存占用（空闲） | ~5 MB |
| 内存占用（10 并发调用） | ~40 MB |

## 前端集成

### SkillMarketplacePage 页面

**功能模块**:

- **统计卡片**: 总技能数 / 已发布 / 版本数
- **技能列表**: Ant Design Table，含名称、版本、状态徽章、发布者
- **发布弹窗**: Modal 表单，输入名称/描述/版本
- **错误提示**: Alert 组件展示错误信息

### Pinia Store (skillService.ts)

```typescript
const useSkillServiceStore = defineStore("skillService", {
  state: () => ({
    skills: [],
    versions: [],
    loading: false,
    error: null,
  }),
  getters: {
    skillCount, // 技能总数
    publishedSkills, // 已发布技能列表
  },
  actions: {
    fetchSkills, // → skill-service:list-skills
    publishSkill, // → skill-service:publish-skill
    invokeRemote, // → skill-service:invoke-remote
    fetchVersions, // → skill-service:get-versions
    composePipeline, // → skill-service:compose-pipeline
  },
});
```

## 关键文件

| 文件                                             | 职责             | 行数 |
| ------------------------------------------------ | ---------------- | ---- |
| `src/main/marketplace/skill-service-protocol.js` | 技能服务协议引擎 | ~280 |
| `src/main/marketplace/skill-invoker.js`          | 远程技能调用器   | ~180 |
| `src/renderer/stores/skillService.ts`            | Pinia 状态管理   | ~120 |
| `src/renderer/pages/ai/SkillMarketplacePage.vue` | 技能市场页面     | ~110 |

## 测试覆盖率

```
✅ skill-service-protocol.test.js    - 技能注册/发布/查询测试
✅ skill-invoker.test.js             - 远程调用/超时/重试测试
✅ stores/skillService.test.ts       - Store 状态管理测试
✅ e2e/ai/skill-marketplace.e2e.test.ts - 端到端用户流程测试
```

## 使用示例

### 示例 1: 发布技能并远程调用

```javascript
// 1. 发布数据分析技能
const skill = await window.electron.ipcRenderer.invoke("skill-service:publish-skill", {
  name: "data-analysis",
  description: "智能数据分析与趋势预测",
  version: "1.0.0",
  inputSchema: { type: "object", properties: { filePath: { type: "string" } } },
  outputSchema: { type: "object", properties: { report: { type: "string" } } },
  sla: { maxLatencyMs: 30000, availability: 0.99 },
});
console.log(`技能已发布: ${skill.skill.id}, 状态: ${skill.skill.status}`);

// 2. 远程调用该技能
const result = await window.electron.ipcRenderer.invoke("skill-service:invoke-remote", {
  skillId: skill.skill.id,
  input: { filePath: "/data/monthly-sales.csv" },
  timeout: 30000,
});
console.log(`执行耗时: ${result.duration}ms`);
```

### 示例 2: 组合技能为 DAG 流水线

```javascript
// 将数据加载、分析、图表生成三个技能串联
const pipeline = await window.electron.ipcRenderer.invoke("skill-service:compose-pipeline", {
  steps: [
    { skillId: "data-loader", input: { path: "/data" } },
    { skillId: "data-analysis", input: { mode: "trend" } },
    { skillId: "chart-creator", input: { type: "bar", title: "月度销售趋势" } },
  ],
});

// 查看技能版本历史
const versions = await window.electron.ipcRenderer.invoke("skill-service:get-versions", {
  skillName: "data-analysis",
});
versions.forEach(v => console.log(`v${v.version} - ${v.status}`));
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 技能发布失败 | 名称重复或 Schema 格式错误 | 检查技能名称唯一性，确认 inputSchema/outputSchema 为有效 JSON Schema |
| 远程调用超时 | 目标节点离线或网络延迟高 | 增大 `timeout` 值，确认目标节点在线且网络可达 |
| 流水线执行中断 | 某个步骤的技能不可用 | 检查流水线中所有 `skillId` 是否已注册且状态为 `published` |
| 并发调用被限制 | 超过 `maxConcurrentInvocations` | 调整配置中的最大并发数（默认 10），或等待当前调用完成 |
| 版本查询为空 | 技能名称拼写错误 | 使用 `skill-service:list-skills` 确认已注册的技能列表 |
| SLA 违规告警 | 技能执行延迟超过承诺值 | 优化技能实现性能，或放宽 `sla.maxLatencyMs` 约束 |

---

## 安全考虑

1. **发布审批**: `publishRequiresApproval: true` 时技能发布需管理员审批，防止恶意技能上架
2. **输入校验**: 远程调用自动根据 `inputSchema` 校验输入参数，拒绝非法请求
3. **调用隔离**: 每次远程调用在独立上下文中执行，防止技能间状态污染
4. **DID 认证**: 技能发布和调用均绑定 DID 身份，可追溯操作者
5. **超时保护**: 所有远程调用强制超时限制，防止资源耗尽

---

## 相关文档

- [Cowork 多智能体协作 →](/chainlesschain/cowork)
- [Token Incentive 代币激励 →](/chainlesschain/token-incentive)
- [Inference Network 推理网络 →](/chainlesschain/inference-network)
- [EvoMap 进化图谱 →](/chainlesschain/evomap)
