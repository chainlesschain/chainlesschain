# Skill Marketplace 技能市场

> **版本: v3.1.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | Skill-as-a-Service 协议**

ChainlessChain Skill Marketplace 是一个去中心化的技能即服务（Skill-as-a-Service）协议，实现了标准化的技能发布、发现和远程调用能力。它支持 EvoMap Gene 格式集成、版本管理、SLA 约束以及 DAG 流水线组合，为跨节点技能协作提供完整的基础设施。

## 核心特性

- 📦 **标准化技能描述**: 输入/输出/依赖/SLA 四维描述格式，统一技能元数据
- 🧬 **EvoMap Gene 集成**: 技能可发布为 Gene 格式，融入进化网络
- 🔍 **技能发现注册**: 分布式技能注册表，支持按名称/标签/能力搜索
- 📋 **版本管理**: 语义化版本控制，支持版本历史查询
- 🔗 **流水线 DAG 组合**: 多技能串联/并行组合，构建复杂工作流
- 🌐 **远程调用协议**: 跨节点技能调用，支持超时和并发控制

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

## 相关文档

- [Cowork 多智能体协作 →](/chainlesschain/cowork)
- [Token Incentive 代币激励 →](/chainlesschain/token-incentive)
- [Inference Network 推理网络 →](/chainlesschain/inference-network)
- [EvoMap 进化图谱 →](/chainlesschain/evomap)
