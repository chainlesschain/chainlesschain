# 协作治理框架

> **Phase 64 | v3.0.0 | 5 IPC 处理器 | 2 张新数据库表**

## 概述

协作治理框架为 AI Agent 提供渐进式自主权管理机制，通过决策网关和置信度门控控制 AI 的决策权限。AI 根据审批通过率自动提升自主等级（0→10），关键决策（架构、迁移、安全）强制人工审批，所有决策记录完整审计追踪。

## 核心特性

- 🤝 **渐进式自主权**: AI 根据审批通过率自动提升自主等级（0→10），逐步获得更大决策权
- 🚦 **决策网关**: 架构、迁移、安全等关键决策强制人工审批，风险可控
- 🎯 **置信度门控**: 高置信度（≥0.95）+ 非关键类型可自动审批，减少人工负担
- 📋 **完整审计追踪**: 所有 AI 决策记录审批人、时间、意见，支持事后审计
- ⚖️ **分域管理**: 不同作用域（部署/架构/数据）独立维护自主等级和历史记录

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              协作治理框架                         │
├─────────────────────────────────────────────────┤
│  AI Agent  →  决策提交  →  ┌──────────────┐     │
│                            │  决策网关     │     │
│                            │  ┌──────────┐│     │
│                            │  │置信度检查││     │
│                            │  │类型检查  ││     │
│                            │  │等级检查  ││     │
│                            │  └──────────┘│     │
│                            └──────┬───────┘     │
│                         ┌────────┼────────┐     │
│                         ↓        ↓        ↓     │
│                    自动审批   待人工审批  拒绝    │
│                         ↓        ↓              │
│                    ┌──────────────────┐          │
│                    │  Track Record    │          │
│                    │  自主等级自动提升 │          │
│                    └──────────────────┘          │
├─────────────────────────────────────────────────┤
│  DB: governance_decisions | autonomy_levels     │
└─────────────────────────────────────────────────┘
```

## 自主等级体系

```
NONE(0) → MINIMAL(2) → LOW(4) → MEDIUM(6) → HIGH(8) → FULL(10)
```

| 等级        | 数值 | 说明                                |
| ----------- | ---- | ----------------------------------- |
| **NONE**    | 0    | 所有操作需人工审批                  |
| **MINIMAL** | 2    | 仅信息查询类操作自主                |
| **LOW**     | 4    | 非关键配置变更可自主                |
| **MEDIUM**  | 6    | 常规开发任务可自主                  |
| **HIGH**    | 8    | 除安全策略外均可自主                |
| **FULL**    | 10   | 完全自主（仍保留人工否决权）        |

**自动提升条件**: 在某作用域内，当 `track_record > 0.9` 且总决策数 `≥ 10` 时，自主等级自动 +1。

---

## 决策类型

| 类型             | 说明         | 默认需审批 |
| ---------------- | ------------ | ---------- |
| **ARCHITECTURE** | 架构决策     | 是         |
| **MIGRATION**    | 数据迁移     | 是         |
| **SECURITY**     | 安全策略     | 是         |
| **DEPLOYMENT**   | 部署操作     | 否         |
| **DATA**         | 数据操作     | 否         |
| **GENERAL**      | 通用决策     | 否         |

---

## 核心功能

### 1. 提交决策

```javascript
// AI 提交一个架构决策
const decision = await submitDecision({
  decisionType: 'ARCHITECTURE',
  title: '采用事件驱动架构重构消息模块',
  description: '当前消息模块采用同步调用，建议迁移到事件驱动以提升可扩展性',
  confidence: 0.88,
  context: { currentArch: 'sync-rpc', proposedArch: 'event-driven' },
  proposedAction: 'refactor-messaging-to-events'
});

// 置信度 0.88 < 0.95 且类型为 ARCHITECTURE（需审批）→ status: 'PENDING'
```

### 2. 审批/拒绝

```javascript
// 人工审批
await window.electronAPI.invoke('collab-governance:approve-decision', {
  decisionId: 'gd-001',
  reviewer: 'admin',
  comment: '同意，但需要在 staging 环境先验证'
});

// 拒绝
await window.electronAPI.invoke('collab-governance:reject-decision', {
  decisionId: 'gd-002',
  reviewer: 'admin',
  comment: '风险太高，建议分阶段实施'
});
```

### 3. 查看待审决策

```javascript
const pending = await window.electronAPI.invoke('collab-governance:get-pending', {
  filter: { decisionType: 'ARCHITECTURE' }
});
```

### 4. 自主等级管理

```javascript
// 查看某作用域的自主等级
const level = await window.electronAPI.invoke('collab-governance:get-autonomy-level', {
  scope: 'deployment'
});
// { scope: 'deployment', level: 6, trackRecord: 0.95, totalDecisions: 23, ... }

// 设置自主策略
await window.electronAPI.invoke('collab-governance:set-autonomy-policy', {
  scope: 'deployment',
  level: 8,
  requireApprovalFor: ['ARCHITECTURE', 'MIGRATION', 'SECURITY']
});
```

---

## 自动审批规则

决策在满足以下条件时自动审批（`AUTO_APPROVED`）：

1. 置信度 ≥ 0.95
2. 决策类型不在 `requireApprovalFor` 列表中
3. 当前作用域自主等级 ≥ 该操作所需最低等级

否则进入 `PENDING` 状态等待人工审批。

---

## IPC 通道

| 通道                                     | 参数                                              | 返回值       |
| ---------------------------------------- | ------------------------------------------------- | ------------ |
| `collab-governance:get-pending`          | `{ filter? }`                                     | 待审决策列表 |
| `collab-governance:approve-decision`     | `{ decisionId, reviewer, comment? }`              | 操作结果     |
| `collab-governance:reject-decision`      | `{ decisionId, reviewer, comment? }`              | 操作结果     |
| `collab-governance:get-autonomy-level`   | `{ scope }`                                       | 自主等级     |
| `collab-governance:set-autonomy-policy`  | `{ scope, level?, requireApprovalFor? }`          | 操作结果     |

---

## 数据库表

### governance_decisions

| 字段            | 类型    | 说明                                      |
| --------------- | ------- | ----------------------------------------- |
| id              | TEXT PK | 决策 ID                                  |
| decision_type   | TEXT    | ARCHITECTURE/MIGRATION/SECURITY/...       |
| title           | TEXT    | 决策标题                                  |
| description     | TEXT    | 详细描述                                  |
| confidence      | REAL    | AI 置信度（0-1）                          |
| status          | TEXT    | PENDING/APPROVED/REJECTED/AUTO_APPROVED   |
| context         | JSON    | 决策上下文                                |
| proposed_action | TEXT    | 建议操作                                  |
| reviewer        | TEXT    | 审批人                                    |
| review_comment  | TEXT    | 审批意见                                  |
| created_at      | INTEGER | 创建时间                                  |
| reviewed_at     | INTEGER | 审批时间                                  |

### autonomy_levels

| 字段               | 类型    | 说明               |
| ------------------ | ------- | ------------------ |
| id                 | TEXT PK | 记录 ID            |
| scope              | TEXT    | 作用域（唯一）     |
| level              | INTEGER | 自主等级（0-10）   |
| total_decisions    | INTEGER | 总决策数           |
| approved_decisions | INTEGER | 通过数             |
| rejected_decisions | INTEGER | 拒绝数             |
| track_record       | REAL    | 通过率             |
| updated_at         | INTEGER | 更新时间           |

---

## 相关链接

- [自主开发者](/chainlesschain/autonomous-developer)
- [自主技术学习](/chainlesschain/tech-learning)
- [自主运维](/chainlesschain/autonomous-ops)
- [权限系统](/chainlesschain/permissions)

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `desktop-app-vue/src/main/ai-engine/autonomous/collaboration-governance.js` | 协作治理框架核心实现 |
| `desktop-app-vue/src/main/ai-engine/autonomous/decision-gateway.js` | 决策网关与自动审批逻辑 |
| `desktop-app-vue/src/main/ai-engine/autonomous/autonomy-manager.js` | 自主等级管理与自动提升 |
| `desktop-app-vue/src/renderer/stores/collaborationGovernance.ts` | 协作治理 Pinia Store |

## 使用示例

### 配置自主策略

1. 打开「协作治理」页面，进入「自主等级」标签
2. 选择作用域（如 deployment / architecture / data）
3. 设置目标自主等级和需强制审批的决策类型
4. 保存策略后，AI 在该作用域内按新规则运行

### 审批 AI 决策

1. 切换到「待审决策」列表
2. 查看决策标题、类型、置信度和上下文描述
3. 点击「批准」或「拒绝」，填写审批意见
4. 系统自动更新 track_record，符合条件时等级自动提升

### 查看审计追踪

1. 进入「决策历史」标签页
2. 按决策类型或状态筛选历史记录
3. 查看每条决策的审批人、时间、意见等完整审计信息

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 决策提交后无响应 | 数据库写入失败 | 检查 `governance_decisions` 表状态，确认磁盘空间充足 |
| 自动审批不生效 | 置信度未达阈值或类型在审批列表中 | 确认置信度 >= 0.95 且决策类型不在 `requireApprovalFor` 中 |
| 自主等级未自动提升 | track_record 未达 0.9 或总决策数不足 | 需在该作用域累计 10+ 决策且通过率 > 90% |
| 审批操作返回错误 | 决策已被处理或 ID 无效 | 刷新列表获取最新状态，确认决策处于 PENDING 状态 |
| 待审列表为空 | 所有决策被自动审批 | 检查当前自主等级是否过高，必要时降低等级 |
| 决策上下文丢失 | context 字段 JSON 格式错误 | 确认提交时 context 为有效 JSON 对象 |

## 配置参考

在 `.chainlesschain/config.json` 中可调整以下协作治理参数：

| 配置键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `governance.enabled` | boolean | `true` | 是否启用协作治理框架 |
| `governance.defaultScope` | string | `"general"` | 未指定 scope 时的默认作用域 |
| `governance.autoApproveThreshold` | number | `0.95` | 自动审批的最低置信度阈值（0-1） |
| `governance.autoEscalateTypes` | string[] | `["ARCHITECTURE","MIGRATION","SECURITY"]` | 强制人工审批的决策类型 |
| `governance.trackRecordThreshold` | number | `0.9` | 触发自主等级自动提升所需的通过率 |
| `governance.minDecisionsForPromotion` | number | `10` | 触发自动提升所需的最少决策数 |
| `governance.maxAutonomyLevel` | number | `10` | 允许的最高自主等级上限 |
| `governance.auditRetentionDays` | number | `365` | 审计记录保留天数（0 = 永久） |
| `governance.pendingExpiryHours` | number | `72` | PENDING 决策超时自动拒绝时间（0 = 不超时） |

**示例配置**（保守策略，所有非通用决策需人工审批）：

```json
{
  "governance": {
    "enabled": true,
    "autoApproveThreshold": 0.98,
    "autoEscalateTypes": ["ARCHITECTURE", "MIGRATION", "SECURITY", "DEPLOYMENT"],
    "trackRecordThreshold": 0.95,
    "minDecisionsForPromotion": 20
  }
}
```

## 性能指标

以下基准数据基于 SQLite WAL 模式，运行于本地 Electron 主进程：

| 操作 | 典型耗时 | P95 耗时 | 说明 |
| --- | --- | --- | --- |
| 提交决策（submitDecision） | < 5 ms | 15 ms | 含置信度判断和 DB 写入 |
| 自动审批路径 | < 2 ms | 5 ms | 无 LLM 调用，纯规则判断 |
| 查询待审列表（getpending） | < 3 ms | 10 ms | 带 filter 的索引查询 |
| 审批/拒绝操作 | < 5 ms | 12 ms | DB 更新 + track_record 重算 |
| 自主等级查询 | < 2 ms | 5 ms | 单行 SELECT，内存缓存命中 |
| 等级自动提升检查 | < 3 ms | 8 ms | 聚合查询，每次审批后触发 |
| 决策历史分页查询（100条） | < 10 ms | 20 ms | 按 created_at 降序索引 |

**并发能力**：

- 决策提交：支持多 Agent 并发写入（SQLite WAL 模式，写锁粒度为行级）
- 推荐在高频场景（>50 次/分钟）启用批量提交（`batchSubmit`）以减少锁竞争

**存储占用参考**：

- 每条 `governance_decisions` 记录约 0.5–2 KB（含 context JSON）
- 每条 `autonomy_levels` 记录约 200 B
- 10,000 条决策历史约占 5–20 MB 磁盘空间

## 测试覆盖率

协作治理框架测试套件覆盖决策生命周期、自动审批规则和等级提升逻辑：

| 测试文件 | 用例数 | 覆盖范围 |
| --- | --- | --- |
| `collaboration-governance.test.js` | 41 | IPC 入口、决策提交、审批/拒绝流程 |
| `decision-gateway.test.js` | 35 | 自动审批规则、置信度门控、类型路由 |
| `autonomy-manager.test.js` | 28 | 等级查询、自动提升、阈值边界条件 |
| `collab-governance-store.test.ts` | 22 | Pinia Store 状态管理、响应式更新 |
| **合计** | **126** | **全路径覆盖** |

运行方式：

```bash
cd desktop-app-vue
npx vitest run tests/unit/ai-engine/autonomous/
```

关键覆盖指标：

- **决策状态机**: PENDING → APPROVED / REJECTED / AUTO_APPROVED 全路径均有用例
- **自动提升边界**: track_record = 0.9 临界值、decisions = 9 vs 10 边界均有测试
- **并发安全**: 并发提交同一 scope 下多条决策，验证 track_record 计算无竞态
- **错误路径**: 无效 decisionId、重复审批、DB 写入失败均有独立用例

## 安全考虑

- **关键决策强制审批**: ARCHITECTURE、MIGRATION、SECURITY 类型默认需人工审批
- **置信度门控**: 高风险决策即使置信度高也需二次确认，防止 AI 误判
- **完整审计日志**: 所有决策操作记录审批人、时间、意见，支持合规审计
- **渐进式授权**: 自主等级从 0 逐步提升，AI 需通过实际表现获得信任
- **人工否决权**: 即使 FULL 自主等级（10），人工仍保留否决权
- **作用域隔离**: 不同作用域的自主等级和历史记录独立管理，互不影响
- **防篡改记录**: 决策记录一旦写入不可修改，保证审计追踪的完整性

## 相关文档

- [自主开发者](/chainlesschain/autonomous-developer) - AI 自主开发能力
- [自主运维](/chainlesschain/autonomous-ops) - AI 运维自动化
- [权限系统](/chainlesschain/permissions) - RBAC 权限管理
- [企业审计日志](/chainlesschain/audit) - 审计日志系统
