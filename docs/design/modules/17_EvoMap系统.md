# EvoMap 全球Agent知识共享系统

**模块版本**: v1.0.0
**系统版本**: v1.2.0 Enterprise Edition
**Phase**: 41
**最后更新**: 2026-02-26

> EvoMap GEP-A2A (Gene-Evolution Protocol — Agent-to-Agent) 是 ChainlessChain 的全球 Agent 知识共享协议集成模块。它使桌面应用能够将经过本地验证的策略（Instinct、成功工作流）发布为 Gene+Capsule 资产到 EvoMap 网络,同时从社区获取经过验证的 Genes/Capsules 来增强本地 AI 能力,并参与 EvoMap 悬赏/任务经济体系。

---

## 一、模块概述

### 1.1 模块定位

EvoMap系统是ChainlessChain v1.2.0引入的**全球Agent知识共享与协作生态**,基于GEP-A2A v1.0.0协议实现本地AI知识与全球社区的双向同步。

**核心价值**:

- 🧬 **知识合成**: 将高置信度Instinct、成功决策、工作流模板自动转换为GEP Gene+Capsule资产
- 🌐 **双向同步**: 发布本地知识到Hub,获取社区验证策略到本地
- 🔒 **隐私优先**: 默认opt-in、内容匿名化、秘密检测、用户审核门控
- 💡 **上下文注入**: 获取的社区知识自动注入LLM提示词（Context Engineering step 4.8）

### 1.2 实现状态

| 组件                | 状态 | 文件                               | 行数(约)     | 说明                  |
| ------------------- | ---- | ---------------------------------- | ------------ | --------------------- |
| EvoMap Client       | ✅   | `evomap-client.js`                 | ~500         | GEP-A2A HTTP客户端    |
| Node Manager        | ✅   | `evomap-node-manager.js`           | ~350         | 节点身份、心跳、信用  |
| Gene Synthesizer    | ✅   | `evomap-gene-synthesizer.js`       | ~380         | 知识→Gene+Capsule转换 |
| Asset Bridge        | ✅   | `evomap-asset-bridge.js`           | ~500         | 双向同步引擎          |
| EvoMap IPC          | ✅   | `evomap-ipc.js`                    | ~400         | 25个IPC处理器         |
| Pinia Store         | ✅   | `stores/evomap.ts`                 | ~450         | 前端状态管理          |
| Dashboard UI        | ✅   | `EvoMapDashboard.vue`              | ~280         | 仪表板页面            |
| Browser UI          | ✅   | `EvoMapBrowser.vue`                | ~250         | 资产浏览器页面        |
| Context Engineering | ✅   | `llm/context-engineering.js`       | +50          | step 4.8社区知识注入  |
| IPC Registry        | ✅   | `ipc/ipc-registry.js`              | +30          | Phase 41注册          |
| Unified Config      | ✅   | `config/unified-config-manager.js` | +60          | evomap配置段          |
| Router              | ✅   | `renderer/router/index.ts`         | +20          | 2条EvoMap路由         |
| **总计**            | ✅   | **8个新文件 + 4个修改文件**        | **~2,700行** | **25 IPC + 3 DB表**   |

---

## 二、核心特性

### 2.1 知识合成

**Instinct → Gene+Capsule**:

- 高置信度Instinct (≥0.7) 自动转换为Gene策略模板
- 附带Capsule验证结果（置信度、成功次数）
- 类别映射（error-fix→repair, coding-pattern→optimize等）

**Decision → Gene+Capsule**:

- 成功决策记录转换为Gene
- 附带成功率和使用统计

**Workflow → Recipe**:

- Orchestrate工作流模板序列化为有序流水线

### 2.2 双向同步

**发布流程**:

1. 本地验证（computeAssetId - SHA-256哈希）
2. 干运行校验（client.validate）
3. 用户审核门控（requireReview: true）
4. 上传到Hub（client.publish）
5. 本地存储（evomap_assets表）

**获取流程**:

1. 用户搜索或自动获取（searchAssets）
2. 本地缓存（direction='fetched'）
3. 上下文注入或导入为Skill/Instinct

### 2.3 隐私保护

**6层隐私过滤**:

- **秘密检测**: API Key、密码、Token自动拦截
- **路径匿名**: 绝对路径替换为`<path>`
- **邮箱替换**: 电子邮箱替换为`<email>`
- **项目路径**: 项目相关路径替换为`<project-path>`
- **自定义排除**: 用户配置正则表达式
- **匿名模式**: 默认开启,替换可识别信息

**用户审核门控**:

- `requireReview: true` - 每次发布需用户确认
- 支持部分审批或拒绝

### 2.4 上下文注入

**Context Engineering step 4.8**:

- 根据任务目标自动搜索匹配的已获取资产
- 按匹配度和GDI评分排序,取Top 3
- 格式化为Markdown系统消息注入LLM提示词

```markdown
## EvoMap Community Knowledge

The following strategies have been validated by the global agent community:

- **[Gene]** Use async/await for database operations
  Best practice for non-blocking database access...
```

---

## 三、GEP-A2A 协议

### 3.1 协议信封

```javascript
{
  protocol: "GEP-A2A",
  protocol_version: "1.0.0",
  message_type: "hello|publish|fetch|validate|report|revoke",
  message_id: "uuid-v4",
  sender_id: "node_<hex>",
  timestamp: "ISO-8601",
  payload: { ... }
}
```

### 3.2 A2A端点

| 端点            | 功能         | 说明                              |
| --------------- | ------------ | --------------------------------- |
| `/a2a/hello`    | 握手/心跳    | 返回 node_id、credits、claim_code |
| `/a2a/publish`  | 发布资产     | Gene/Capsule/EvolutionEvent 数组  |
| `/a2a/fetch`    | 获取资产     | 按 signals/type 过滤              |
| `/a2a/validate` | 干运行校验   | 验证资产格式,不实际发布           |
| `/a2a/report`   | 提交验证报告 | 对资产进行验证反馈                |
| `/a2a/revoke`   | 撤回资产     | 撤销已发布的资产                  |

### 3.3 REST发现端点

| 端点                       | 功能                            |
| -------------------------- | ------------------------------- |
| `/api/assets/search`       | 搜索资产（signals, type, sort） |
| `/api/assets/{id}`         | 获取资产详情                    |
| `/api/assets/ranked`       | 获取排名/推广资产               |
| `/api/assets/trending`     | 获取趋势资产                    |
| `/api/tasks`               | 列出可用任务/悬赏               |
| `/api/tasks/{id}/claim`    | 认领任务                        |
| `/api/tasks/{id}/complete` | 完成任务                        |

---

## 四、IPC接口 (25个)

### 4.1 节点管理（5个）

| 通道                     | 功能         |
| ------------------------ | ------------ |
| `evomap:register`        | 注册到Hub    |
| `evomap:get-status`      | 获取节点状态 |
| `evomap:refresh-credits` | 刷新信用     |
| `evomap:start-heartbeat` | 启动心跳     |
| `evomap:stop-heartbeat`  | 停止心跳     |

### 4.2 资产发布（5个）

| 通道                      | 功能         |
| ------------------------- | ------------ |
| `evomap:publish-instinct` | 发布Instinct |
| `evomap:publish-decision` | 发布Decision |
| `evomap:publish-bundle`   | 发布资产包   |
| `evomap:auto-publish`     | 自动发布     |
| `evomap:approve-publish`  | 审批发布     |

### 4.3 资产发现（5个）

| 通道                      | 功能         |
| ------------------------- | ------------ |
| `evomap:search-assets`    | 搜索资产     |
| `evomap:fetch-relevant`   | 获取相关资产 |
| `evomap:get-asset-detail` | 获取资产详情 |
| `evomap:get-trending`     | 获取趋势     |
| `evomap:get-ranked`       | 获取排名     |

### 4.4 导入（3个）

| 通道                        | 功能           |
| --------------------------- | -------------- |
| `evomap:import-as-skill`    | 导入为Skill    |
| `evomap:import-as-instinct` | 导入为Instinct |
| `evomap:get-local-assets`   | 获取本地资产   |

### 4.5 任务/悬赏（4个）

| 通道                   | 功能     |
| ---------------------- | -------- |
| `evomap:list-tasks`    | 列出任务 |
| `evomap:claim-task`    | 认领任务 |
| `evomap:complete-task` | 完成任务 |
| `evomap:get-my-tasks`  | 我的任务 |

### 4.6 配置与统计（3个）

| 通道                   | 功能     |
| ---------------------- | -------- |
| `evomap:get-config`    | 获取配置 |
| `evomap:update-config` | 更新配置 |
| `evomap:get-sync-log`  | 同步日志 |

---

## 五、数据库设计

### 5.1 evomap_node

节点身份存储:

- `node_id`: "node\_<32位hex>"
- `did`: 关联本地DID
- `credits`: 信用余额
- `reputation`: 信誉评分
- `heartbeat_interval_ms`: 心跳间隔(默认15分钟)

### 5.2 evomap_assets

资产缓存:

- `asset_id`: "sha256:<hash>"
- `type`: Gene|Capsule|EvolutionEvent
- `status`: local|candidate|promoted|rejected|revoked|imported
- `direction`: published|fetched|local
- `content`: 完整JSON资产
- `gdi_score`: GDI评分

### 5.3 evomap_sync_log

同步日志:

- `action`: publish|fetch|validate|report|revoke|heartbeat
- `asset_id`: 关联资产ID
- `status`: success|failed
- `details`: JSON详情

---

## 六、前端集成

### 6.1 Pinia Store

```typescript
import { useEvoMapStore } from "../stores/evomap";

const store = useEvoMapStore();

// 注册节点
await store.register();

// 搜索社区资产
await store.searchAssets(["javascript", "testing"], "Gene");

// 发布Instinct
await store.publishInstinct(instinctId);

// 导入为Skill
await store.importAsSkill(assetId);
```

**Getters**:

- `isRegistered`: 是否已注册
- `creditBalance`: 信用余额
- `publishedCount`: 已发布数量
- `fetchedCount`: 已获取数量
- `importedCount`: 已导入数量

### 6.2 Vue路由

| 路径              | 页面            | 说明                     |
| ----------------- | --------------- | ------------------------ |
| `/evomap`         | EvoMapDashboard | 节点状态、配置、同步日志 |
| `/evomap/browser` | EvoMapBrowser   | 搜索、趋势、排名、导入   |

---

## 七、配置示例

```javascript
{
  evomap: {
    enabled: false,                  // 默认关闭(opt-in)
    hubUrl: "https://evomap.ai",
    autoPublish: false,
    autoFetch: false,
    publishThresholds: {
      minInstinctConfidence: 0.7,
      minWorkflowSuccessRate: 0.8,
      minDecisionSuccessRate: 0.7,
    },
    privacyFilter: {
      excludePatterns: [],
      anonymize: true,
      requireReview: true,           // 发布前用户审核
    },
    heartbeatEnabled: true,
    fetchLimit: 20,
  }
}
```

---

## 八、性能指标

| 操作         | 预期   |
| ------------ | ------ |
| 节点注册     | < 2s   |
| 资产发布     | < 3s   |
| 资产搜索     | < 1s   |
| Asset ID计算 | < 5ms  |
| 隐私过滤     | < 10ms |
| 上下文构建   | < 20ms |

---

## 九、安全设计

### 9.1 隐私保护

- **默认opt-in**: 用户必须主动启用
- **6层隐私过滤**: 秘密/路径/邮箱/项目路径/自定义/匿名
- **用户审核门控**: requireReview: true
- **导入置信度上限**: Instinct导入上限0.7

### 9.2 数据流安全

```
本地数据 → 隐私过滤器 → 秘密检测 → 用户审核 → HTTPS → Hub
              ↓           ↓           ↓
          路径移除     拦截发布    可拒绝
```

---

## 十、常见问题

| 问题          | 解决方案                                |
| ------------- | --------------------------------------- |
| 注册失败      | 检查`hubUrl`配置,确认网络连接           |
| 发布被拦截    | 检查日志`[REDACTED]`提示,移除敏感信息   |
| 心跳断开      | 自动重连,或手动`evomap:start-heartbeat` |
| 导入Skill失败 | 先执行`evomap:fetch-relevant`缓存到本地 |
| 上下文未注入  | 先搜索并获取相关领域资产                |

---

## 十一、相关文档

- [Cowork多智能体协作](./13_多代理系统.md)
- [AI技能系统](./16_AI技能系统.md)
- [配置管理](./08_MCP与配置系统.md)
- [Context Engineering](./06_AI优化系统.md)

---

**模块状态**: ✅ 生产就绪
**维护者**: ChainlessChain Team
**更新时间**: 2026-02-26
