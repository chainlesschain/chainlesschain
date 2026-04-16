# 企业组织管理

> **版本: v1.0.0+ | 组织层级 | 审批工作流 | 多租户**

企业组织管理模块为企业用户提供完整的组织架构管理，包括部门层级、成员管理、审批工作流等功能。

## 概述

企业组织管理模块提供无限层级的树形部门架构、成员全生命周期管理（邀请/审批/角色分配/批量导入）以及自定义多级审批工作流引擎。系统实现组织间数据完全隔离的多租户架构，支持子组织独立管理，并通过组织仪表盘实时展示部门人数、角色分布和审批待办等关键指标。

## 核心特性

- 🏢 **部门层级管理**: 支持无限层级的树形组织架构，灵活构建企业结构
- 👥 **成员全生命周期**: 邀请加入、审批通过、角色分配、批量导入一站式管理
- 📋 **审批工作流引擎**: 自定义多级审批链，支持加入/权限/资源等多种审批类型
- 🔐 **多租户隔离**: 组织间数据完全隔离，支持子组织与分公司独立管理
- 📊 **组织仪表盘**: 实时统计部门人数、角色分布、审批待办等关键指标

## 系统架构

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Vue3 前端   │────→│  IPC 处理器       │────→│  组织管理核心    │
│  组织管理页面 │     │  enterprise-org   │     │  OrgManager      │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                              ┌─────────────┬──────────┼──────────┐
                              ▼             ▼          ▼          ▼
                        ┌──────────┐  ┌──────────┐ ┌───────┐ ┌────────┐
                        │ org_teams│  │ approval  │ │ RBAC  │ │ Audit  │
                        │ 部门表    │  │ workflows │ │ 权限  │ │ 日志   │
                        └──────────┘  └──────────┘ └───────┘ └────────┘
```

## 系统概述

### 组织架构

```
企业组织
├─ 总部 (根部门)
│   ├─ 技术部
│   │   ├─ 前端组
│   │   ├─ 后端组
│   │   └─ 运维组
│   ├─ 产品部
│   │   ├─ 产品设计组
│   │   └─ 用户研究组
│   ├─ 市场部
│   └─ 人力资源部
└─ 分公司 (子组织)
    └─ ...
```

### 核心特性

- **部门层级**: 支持无限层级的部门树结构
- **成员管理**: 批量导入、加入审批、角色分配
- **部门主管**: 指定部门负责人，拥有管理权限
- **审批工作流**: 自定义多级审批链
- **仪表盘**: 组织统计数据概览

---

## 部门管理

### 部门 CRUD

- **创建部门**: 设置名称、描述、上级部门
- **编辑部门**: 修改部门信息、调整层级
- **删除部门**: 需先移出或转移所有成员
- **查看部门**: 部门详情、成员列表、子部门

### 部门属性

```json
{
  "id": "dept-uuid",
  "name": "技术部",
  "description": "负责产品研发",
  "parent_team_id": "root-dept-id",
  "settings": {
    "team_type": "department",
    "lead_user_id": "user-uuid",
    "max_members": 50
  }
}
```

---

## 成员管理

### 加入流程

```
1. 邀请/申请加入部门
2. 部门主管审批
3. 审批通过 → 加入部门
4. 分配角色和权限
```

### 角色体系

| 角色       | 权限           |
| ---------- | -------------- |
| 组织管理员 | 全部管理权限   |
| 部门主管   | 部门内管理权限 |
| 组长       | 小组内管理权限 |
| 普通成员   | 基础使用权限   |

### 批量导入

支持通过 CSV/Excel 批量导入成员：

```csv
姓名,邮箱,部门,角色
张三,zhangsan@example.com,技术部/前端组,成员
李四,lisi@example.com,技术部/后端组,组长
```

---

## 审批工作流

### 工作流类型

| 类型     | 说明               |
| -------- | ------------------ |
| 加入审批 | 成员加入部门需审批 |
| 权限审批 | 权限提升需审批     |
| 资源审批 | 资源分配需审批     |
| 自定义   | 自定义审批流程     |

### 审批链

```
申请 → 直属主管审批 → 部门主管审批 → 完成
                        ↓
                   拒绝 → 退回申请人
```

---

## 数据库表

### `org_teams`

| 字段             | 类型     | 说明             |
| ---------------- | -------- | ---------------- |
| `id`             | TEXT     | 部门 ID          |
| `name`           | TEXT     | 部门名称         |
| `description`    | TEXT     | 部门描述         |
| `parent_team_id` | TEXT     | 上级部门 ID      |
| `settings`       | TEXT     | 配置信息（JSON） |
| `created_at`     | DATETIME | 创建时间         |

### `approval_workflows`

审批工作流定义和实例记录。

---

## 关键文件

| 文件                                            | 职责                |
| ----------------------------------------------- | ------------------- |
| `src/main/enterprise/enterprise-org-manager.js` | 企业组织管理核心    |
| `src/main/enterprise/enterprise-org-ipc.js`     | 组织管理 IPC 处理器 |

## 使用示例

### CLI 组织管理

```bash
# 创建组织
chainlesschain org create "Acme Corp"

# 邀请成员
chainlesschain org invite org-001 did:chainlesschain:QmXXXX

# 审批加入请求
chainlesschain org approve request-001

# 查看组织列表
chainlesschain org list
```

### 桌面端组织操作

```javascript
// 创建部门层级
const techDept = await orgManager.createDepartment({
  orgId: 'org-001',
  name: '技术部',
  description: '负责产品研发',
  parentId: 'root-dept-id'
});

// 批量导入成员（CSV 格式）
await orgManager.importMembers('org-001', {
  file: './members.csv',
  format: 'csv'
});

// 创建审批工作流
await orgManager.createApprovalWorkflow({
  name: '敏感资源访问审批',
  type: 'resource',
  approvers: ['dept-lead', 'security-admin'],
  timeout: 24 * 60 * 60 * 1000
});
```

---

## 故障排查

### 成员加入审批超时

- **审批人离线**: 检查审批链中的审批人是否在线，考虑添加备选审批人
- **超时配置**: 默认审批超时为 24 小时，可在工作流设置中调整
- **通知未送达**: 确认审批人的通知渠道（应用内/邮件）配置正确

### 部门层级显示异常

- **循环引用**: 检查 `parent_team_id` 是否存在循环引用
- **数据不一致**: 使用组织仪表盘检查部门树完整性
- **缓存过期**: 刷新页面或重启应用清除前端缓存

### 批量导入失败

- **CSV 格式**: 确认 CSV 文件包含必要字段（姓名、邮箱、部门、角色）
- **编码问题**: CSV 文件需使用 UTF-8 编码，Excel 导出时选择 UTF-8 格式
- **部门不存在**: 导入前确认 CSV 中引用的部门路径已在系统中创建

### 多租户数据泄露

- **隔离检查**: 确认所有查询都带有 `orgId` 条件过滤
- **权限验证**: 跨组织操作会被权限引擎自动拒绝
- **审计日志**: 检查审计日志中是否有异常的跨组织访问记录

---

## 配置参考

在 `.chainlesschain/config.json` 中配置企业组织管理模块：

```javascript
{
  "enterpriseOrg": {
    // 全局开关
    "enabled": true,

    // 组织架构
    "org": {
      "maxDeptDepth": 10,              // 部门树最大层级深度
      "maxMembersPerDept": 500,        // 单部门最大成员数（0 = 不限制）
      "allowSubOrgs": true,            // 是否支持创建子组织（分公司）
      "rootDeptName": "总部"           // 根部门默认名称
    },

    // 成员管理
    "member": {
      "requireApproval": true,         // 成员加入是否需要审批
      "inviteExpireDays": 7,           // 邀请链接有效期（天）
      "batchImportMaxRows": 1000,      // 单次批量导入最大行数
      "importFormats": ["csv", "xlsx"] // 支持的批量导入格式
    },

    // 审批工作流
    "approval": {
      "defaultTimeoutHours": 24,       // 默认审批超时时间（小时）
      "autoExpireOnTimeout": true,     // 超时后自动过期拒绝
      "maxApproverLevels": 5,          // 审批链最大级数
      "notifyChannels": ["in-app", "email"], // 审批通知渠道
      "reminderIntervalHours": 8       // 审批提醒间隔（小时）
    },

    // 多租户
    "multiTenant": {
      "isolationLevel": "strict",      // "strict"（完全隔离）| "shared-readonly"（只读共享）
      "crossOrgQueryEnabled": false,   // 是否允许跨组织联合查询（需超级管理员）
      "auditCrossOrgAccess": true      // 跨组织操作强制审计
    },

    // 仪表盘
    "dashboard": {
      "refreshIntervalSeconds": 60,    // 仪表盘数据刷新周期
      "cacheEnabled": true,            // 统计数据缓存开关
      "cacheTTLSeconds": 300           // 统计缓存 TTL（5 分钟）
    }
  }
}
```

### 关键配置项速查

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `org.maxDeptDepth` | `10` | 部门树层级上限，超出时创建操作被拒绝 |
| `member.inviteExpireDays` | `7` | 邀请链接过期天数，过期需重新邀请 |
| `approval.defaultTimeoutHours` | `24` | 审批超时后自动过期，防止僵尸审批请求 |
| `approval.maxApproverLevels` | `5` | 审批链最大层级，超出时工作流创建失败 |
| `multiTenant.isolationLevel` | `"strict"` | 严格模式下所有查询强制携带 `orgId` 过滤 |
| `dashboard.cacheTTLSeconds` | `300` | 统计缓存有效期，降低高并发下的 DB 压力 |

---

## 性能指标

### 典型场景基准（4 核 / 8 GB RAM）

| 操作 | 数据规模 | 典型耗时 | 说明 |
| --- | --- | --- | --- |
| 创建部门 | 单次写入 | < 10 ms | 含权限校验 + 审计日志写入 |
| 查询部门树 | 100 部门 / 5 层 | < 30 ms | 递归 CTE 查询，有索引 |
| 查询部门树 | 1000 部门 / 10 层 | < 150 ms | 建议启用仪表盘缓存 |
| 成员列表分页 | 单部门 500 人 | < 20 ms | page size = 50，有 `dept_id` 索引 |
| 批量导入成员 | 1000 行 CSV | 3–8 s | 含校验 + 去重 + 审批请求创建 |
| 审批工作流创建 | 5 级审批链 | < 50 ms | |
| 审批状态查询 | 单条 | < 5 ms | |
| 组织仪表盘统计 | 1 万成员 / 200 部门 | < 100 ms | 有缓存时 < 5 ms |

### 容量建议

| 组织规模 | 推荐配置 | 备注 |
| --- | --- | --- |
| < 500 成员 | 2 核 / 4 GB | 默认配置，无需调优 |
| 500–5000 成员 | 4 核 / 8 GB | 启用仪表盘缓存，`cacheTTLSeconds: 300` |
| > 5000 成员 | 8 核 / 16 GB | 开启 SQLite WAL 模式，考虑分库分部门 |

### 性能调优建议

- **仪表盘缓存**: 开启 `dashboard.cacheEnabled: true`，高并发场景可降低 DB 读压力 10–50 倍
- **批量导入分批**: 超过 500 行时建议拆分为多次导入（每批 ≤ 500），避免单事务过大导致锁等待
- **审批通知异步化**: 邮件通知走异步队列，不阻塞审批创建响应
- **部门树懒加载**: 前端仅加载前 3 层，用户展开时按需请求子部门，避免全树一次性加载

---

## 测试覆盖率

### 测试文件结构

```
desktop-app-vue/tests/unit/enterprise/
├── enterprise-org-manager.test.js    # 组织 / 部门 / 成员管理核心逻辑
├── approval-workflow.test.js         # 审批工作流引擎（多级链、超时、通知）
├── org-multi-tenant.test.js          # 多租户隔离策略测试
├── org-import.test.js                # CSV/Excel 批量导入解析和校验
└── enterprise-org-ipc.test.js        # IPC Handler 集成测试
```

### 测试覆盖列表

| 测试文件 | 覆盖功能 | 测试数 |
| --- | --- | --- |
| `enterprise-org-manager.test.js` | 部门 CRUD、成员加入/移除、角色分配、层级调整 | 42 |
| `approval-workflow.test.js` | 工作流创建、多级审批流转、超时自动过期、拒绝回退 | 35 |
| `org-multi-tenant.test.js` | 跨组织查询被拒绝、orgId 过滤、子组织隔离 | 18 |
| `org-import.test.js` | CSV 字段校验、编码处理、部门路径解析、错误行跳过 | 22 |
| `enterprise-org-ipc.test.js` | IPC 参数校验、错误格式、权限拦截 | 16 |
| **合计** | | **133** |

### 关键测试场景

✅ 创建部门时 `parent_team_id` 不存在返回 `DEPT_NOT_FOUND` 错误  
✅ 部门层级超过 `maxDeptDepth` 时创建被拒绝，返回 `DEPT_DEPTH_EXCEEDED`  
✅ 循环引用检测：将部门 A 设为其子部门 B 的子部门时拒绝操作  
✅ 成员加入审批全流程：申请 → 多级审批 → 通过 → 角色自动分配  
✅ 审批超时后请求状态自动变为 `expired`，不再可被审批人操作  
✅ 审批拒绝后申请人收到通知，状态回退为 `rejected`  
✅ 多租户隔离：组织 A 的成员查询不返回组织 B 的数据（`orgId` 强制过滤）  
✅ 跨组织操作在 `isolationLevel: "strict"` 下抛出 `CROSS_ORG_FORBIDDEN`  
✅ CSV 批量导入：缺少必填字段的行跳过并记录错误行号，不中断整批导入  
✅ CSV 批量导入：部门路径 `技术部/前端组` 正确解析为层级关系  
✅ 成员移除后其 RBAC 权限立即失效（同一事务内完成）  
✅ 仪表盘统计缓存：TTL 内重复请求命中缓存，不触发 DB 查询  
✅ 组织仪表盘 `pendingApprovals` 数量与实际待审批记录数一致  

---

## 安全考虑

### 数据隔离

- 不同组织间数据 **完全隔离**，所有数据库查询强制携带 `orgId` 过滤
- 子组织和分公司支持独立管理，数据不与父组织共享（除非显式授权）
- API 层强制校验请求者的组织归属，防止越权访问其他组织数据

### 成员管理安全

- 成员加入需经过 **审批工作流**，防止未授权人员进入组织
- 角色分配遵循最小权限原则，普通成员仅获得基础使用权限
- 成员离职或移除后，权限立即失效，相关会话密钥自动更新

### 审批安全

- 审批链支持多级审批，敏感操作需经过多人确认
- 审批记录完整保存在审计日志中，支持事后追溯
- 审批超时自动过期，防止长期悬挂的审批请求被滥用

### 合规要求

- 组织结构变更自动触发审计事件记录
- 支持组织级别的数据保留策略和合规报告生成
- 成员数据导出符合 GDPR 数据主体请求（DSR）要求

---

## 相关文档

- [权限系统 (RBAC) →](/chainlesschain/permissions)
- [审计日志 →](/chainlesschain/audit)
- [SSO 单点登录 →](/chainlesschain/sso)
