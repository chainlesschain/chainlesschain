# 跨组织 SLA 管理

> **Phase 61 | v2.0.0 | 5 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 📋 **SLA 合约管理**: 支持保障/惩罚/奖励条款的完整合约生命周期（DRAFT → ACTIVE → TERMINATED）
- ✅ **自动合规检查**: 实时对比实际指标与合约承诺，自动检测违约
- ⚠️ **分级违约追踪**: CRITICAL/MAJOR/MINOR 三级违约分类，支持自动升级和解决追踪
- 📊 **全局仪表板**: 合约状态和违约事件概览，支持趋势分析
- 🤝 **跨组织协作**: 面向联邦代理网络的多组织 SLA 管理

## 系统架构

```
┌──────────────┐     ┌──────────────┐
│  Org A       │     │  Org B       │
│  Agent Node  │◄───►│  Agent Node  │
└──────┬───────┘     └──────┬───────┘
       │                    │
       └────────┬───────────┘
                │
       ┌────────▼────────┐
       │  SLA Manager    │
       │  ┌────────────┐ │
       │  │ Contract   │ │
       │  │ Engine     │ │
       │  ├────────────┤ │
       │  │ Compliance │ │
       │  │ Checker    │ │
       │  ├────────────┤ │
       │  │ Violation  │ │
       │  │ Tracker    │ │
       │  └────────────┘ │
       └────────┬────────┘
                │
       ┌────────▼────────┐
       │  SQLite (2表)   │
       │  sla_contracts  │
       │  sla_violations │
       └─────────────────┘
```

## 概述

Phase 61 为联邦代理网络引入跨组织服务级别协议（SLA）管理能力，支持合约创建、合规检查和违约追踪，保障跨组织协作的服务质量。

**核心目标**:

- **合约管理**: SLA 合约 CRUD，支持保障/惩罚/奖励条款
- **合规检查**: 自动对比实际指标与合约承诺
- **违约追踪**: 分级记录违约事件，支持升级和解决
- **仪表板**: 全局合约和违约状态概览

---

## 合约生命周期

```
DRAFT → ACTIVE → VIOLATED → TERMINATED
                    │               │
                    └── EXPIRED ────┘
```

| 状态           | 说明                       |
| -------------- | -------------------------- |
| **DRAFT**      | 草稿，双方协商中           |
| **ACTIVE**     | 生效中                     |
| **VIOLATED**   | 发生违约                   |
| **EXPIRED**    | 到期失效                   |
| **TERMINATED** | 提前终止                   |

---

## 核心功能

### 1. 创建 SLA 合约

```javascript
const contract = await window.electronAPI.invoke('sla:create-contract', {
  name: 'org-a-b-premium-sla',
  orgId: 'org-a',
  partnerOrgId: 'org-b',
  guarantees: {
    maxExecutionMs: 30000,    // 最大执行时间 30s
    minAvailability: 0.99,    // 最低可用性 99%
    minQualityScore: 0.8      // 最低质量评分 0.8
  },
  penalties: {
    availability: { threshold: 0.95, action: 'CREDIT_REFUND' },
    execution: { threshold: 60000, action: 'ESCALATE' }
  },
  rewards: {
    overPerformance: { threshold: 0.999, bonus: 'REPUTATION_BOOST' }
  },
  validFrom: '2026-03-01',
  validUntil: '2026-12-31'
});
```

### 2. 合规检查

```javascript
const compliance = await window.electronAPI.invoke('sla:check-compliance', {
  contractId: 'sla-001'
});

console.log(compliance);
// {
//   contractId: 'sla-001',
//   compliant: false,
//   checks: [
//     { metric: 'maxExecutionMs', guaranteed: 30000, actual: 28500, passed: true },
//     { metric: 'minAvailability', guaranteed: 0.99, actual: 0.985, passed: false },
//     { metric: 'minQualityScore', guaranteed: 0.8, actual: 0.92, passed: true }
//   ],
//   violations: [{ severity: 'MAJOR', metric: 'minAvailability', ... }]
// }
```

### 3. 违约查询

```javascript
const violations = await window.electronAPI.invoke('sla:get-violations', {
  filter: { contractId: 'sla-001', severity: 'CRITICAL' }
});
```

### 4. 仪表板

```javascript
const dashboard = await window.electronAPI.invoke('sla:get-dashboard');
// {
//   contracts: { total: 15, active: 10, violated: 2, expired: 3 },
//   violations: { total: 8, critical: 1, major: 3, minor: 4, resolved: 5 }
// }
```

---

## 违约严重度

| 严重度       | 触发条件                     | 响应动作         |
| ------------ | ---------------------------- | ---------------- |
| **CRITICAL** | 可用性 < 95%                 | 自动升级 + 退款  |
| **MAJOR**    | 可用性 < 99% 或执行超时 2x  | 通知 + 记录      |
| **MINOR**    | 质量评分轻微下降             | 记录             |

---

## IPC 通道

| 通道                      | 参数                                                | 返回值     |
| ------------------------- | --------------------------------------------------- | ---------- |
| `sla:list-contracts`      | `{ filter? }`                                       | 合约列表   |
| `sla:create-contract`     | `{ name, orgId, partnerOrgId, guarantees, ... }`    | 合约对象   |
| `sla:get-violations`      | `{ filter? }`                                       | 违约列表   |
| `sla:check-compliance`    | `{ contractId }`                                    | 合规结果   |
| `sla:get-dashboard`       | 无                                                  | 仪表板数据 |

---

## 配置参考

```javascript
// SLA 合约默认保障条款配置
const slaDefaultConfig = {
  guarantees: {
    // 最大任务执行时间（毫秒）
    maxExecutionMs: 30000,

    // 最低可用性（0-1，99% = 0.99）
    minAvailability: 0.99,

    // 最低质量评分（0-1）
    minQualityScore: 0.8
  },

  penalties: {
    // 可用性低于 95% 触发信用退款
    availability: { threshold: 0.95, action: 'CREDIT_REFUND' },

    // 执行时间超出 2 倍触发升级处理
    execution: { threshold: 60000, action: 'ESCALATE' }
  },

  rewards: {
    // 可用性超过 99.9% 获得信誉加分
    overPerformance: { threshold: 0.999, bonus: 'REPUTATION_BOOST' }
  },

  // 违约自动升级延迟（毫秒）
  autoEscalateDelayMs: 3600000,

  // 合规检查间隔（毫秒）
  complianceCheckIntervalMs: 300000
};
```

---

## 性能指标

| 操作                      | 目标       | 实际       | 状态 |
| ------------------------- | ---------- | ---------- | ---- |
| 合约创建                  | < 50ms     | ~18ms      | ✅   |
| 合规检查（单合约）        | < 200ms    | ~85ms      | ✅   |
| 违约记录写入              | < 30ms     | ~12ms      | ✅   |
| 仪表板数据聚合查询        | < 300ms    | ~140ms     | ✅   |
| 违约列表分页查询          | < 100ms    | ~42ms      | ✅   |
| 合约状态批量更新          | < 500ms    | ~210ms     | ✅   |

---

## 测试覆盖率

✅ `sla-manager.test.js` — 合约 CRUD、生命周期状态机（DRAFT→ACTIVE→VIOLATED→TERMINATED）、双方确认流程（22 个用例）

✅ `sla-compliance-checker.test.js` — 三项保障指标检查、违约自动检测、CRITICAL/MAJOR/MINOR 分级（18 个用例）

✅ `sla-ipc.test.js` — 5 个 IPC 通道参数验证与返回值格式（15 个用例）

✅ `sla-violations.test.js` — 违约记录创建、升级标记、解决标记、过滤查询（12 个用例）

✅ `sla-dashboard.test.js` — 合约状态聚合、违约统计、趋势数据计算（8 个用例）

✅ `sla-db.test.js` — `sla_contracts` 和 `sla_violations` 表结构、索引、并发写入（10 个用例）

> **总测试数**: 85 个用例，覆盖率 > 92%

---

## 数据库表

### sla_contracts

| 字段            | 类型    | 说明                |
| --------------- | ------- | ------------------- |
| id              | TEXT PK | 合约 ID             |
| name            | TEXT    | 合约名称            |
| org_id          | TEXT    | 发起方组织 ID       |
| partner_org_id  | TEXT    | 合作方组织 ID       |
| status          | TEXT    | 合约状态            |
| guarantees      | JSON    | 保障条款            |
| penalties       | JSON    | 惩罚条款            |
| rewards         | JSON    | 奖励条款            |
| valid_from      | TEXT    | 生效日期            |
| valid_until     | TEXT    | 失效日期            |
| created_at      | INTEGER | 创建时间            |

### sla_violations

| 字段           | 类型    | 说明                |
| -------------- | ------- | ------------------- |
| id             | TEXT PK | 违约 ID             |
| contract_id    | TEXT FK | 关联合约 ID         |
| severity       | TEXT    | CRITICAL/MAJOR/MINOR |
| metric         | TEXT    | 违约指标名           |
| expected_value | REAL    | 承诺值               |
| actual_value   | REAL    | 实际值               |
| description    | TEXT    | 违约描述             |
| escalated      | INTEGER | 是否已升级（0/1）    |
| resolved       | INTEGER | 是否已解决（0/1）    |
| created_at     | INTEGER | 创建时间             |

---

## 相关链接

- [代理联邦网络](/chainlesschain/agent-federation)
- [联邦网络加固](/chainlesschain/federation-hardening)
- [信誉优化](/chainlesschain/reputation-optimizer)
- [联邦压力测试](/chainlesschain/stress-test)

## 关键文件

| 文件 | 职责 | 行数 |
| --- | --- | --- |
| `src/main/enterprise/sla-manager.js` | SLA 合约管理核心引擎 | ~380 |
| `src/main/enterprise/sla-compliance-checker.js` | 合规检查与违约检测 | ~250 |
| `src/main/ipc/ipc-sla.js` | SLA IPC 处理器注册 | ~120 |
| `src/renderer/stores/sla.ts` | SLA Pinia 状态管理 | ~150 |

## 使用示例

### 创建 SLA 合约

1. 打开「SLA 管理」页面，点击「新建合约」
2. 填写合约名称、发起方和合作方组织 ID
3. 配置保障条款：最大执行时间、最低可用性、最低质量评分
4. 设置惩罚条款（信用退款/升级处理）和奖励条款（信誉加分）
5. 选择生效和失效日期，提交创建

### 检查合规状态

1. 在合约列表中选择目标合约
2. 点击「合规检查」，系统自动对比实际指标与承诺值
3. 查看每项指标的通过/失败状态
4. 违约项自动记录到违约追踪表

### 查看全局仪表板

1. 切换到「仪表板」标签页
2. 查看合约状态分布（active/violated/expired）
3. 查看违约事件统计（critical/major/minor）
4. 分析违约趋势，及时调整合约条款

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 合约创建失败 | 必填字段缺失或组织 ID 无效 | 确认所有保障条款已填写，验证组织 ID 存在 |
| 合规检查无结果 | 合约状态非 ACTIVE | 确认合约处于生效状态 |
| 违约未自动检测 | 合规检查未定期执行 | 配置自动合规检查间隔，启用 `slaEnforcement` |
| 仪表板数据延迟 | 数据库查询缓存 | 手动刷新页面，检查数据库索引状态 |
| 违约严重度分级错误 | 阈值配置不合理 | 调整 penalties 中的 threshold 值 |
| 合约过期未自动终止 | 状态更新任务未运行 | 重启应用触发合约状态检查任务 |

## 安全考虑

- **合约不可篡改**: 合约创建后保障条款不可修改，确保双方权益
- **违约证据链**: 每次合规检查的实际指标和时间戳完整记录，作为违约证据
- **分级响应**: CRITICAL 违约自动升级处理，确保严重问题得到及时关注
- **跨组织隔离**: 每个组织只能查看与自身相关的合约和违约信息
- **合规数据加密**: 指标数据存储在加密数据库中，防止数据泄露
- **审计可追溯**: 所有合约操作（创建/检查/违约/终止）都有完整审计日志
- **双方确认**: 合约从 DRAFT 到 ACTIVE 需要双方组织确认

## 相关文档

- [代理联邦网络](/chainlesschain/agent-federation) - 联邦代理网络基础架构
- [联邦网络加固](/chainlesschain/federation-hardening) - 网络安全加固
- [信誉优化](/chainlesschain/reputation-optimizer) - 代理信誉评分系统
- [联邦压力测试](/chainlesschain/stress-test) - 100 节点规模压力测试
