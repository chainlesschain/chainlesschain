# 权限系统

> **版本: v0.29.0 | 企业级RBAC | 细粒度权限控制**

权限系统提供企业级的角色访问控制（RBAC），支持资源级权限、权限继承、权限委托和团队权限管理。

## 核心特性

- 🔐 **RBAC 权限引擎**: 基于角色的访问控制，5 种内置角色 + 自定义角色，权限检查 <3ms
- 🏢 **团队权限管理**: 多层级团队结构，团队成员自动继承权限，支持父子团队嵌套
- 🔗 **权限继承链**: 组织→团队→项目→文件夹→文件，父级权限自动传播到子级
- 🤝 **权限委托机制**: 临时授权给其他用户，支持过期时间和范围限定
- ✅ **审批工作流**: 敏感资源访问需经审批，支持超时和多审批人
- 📋 **完整审计日志**: 所有权限变更自动记录，支持 90 天回溯查询

## 系统架构

```
权限系统
├── PermissionEngine    # RBAC权限引擎
├── TeamManager         # 团队管理
├── DelegationManager   # 权限委托
└── ApprovalWorkflow    # 审批工作流
```

---

## 角色管理

### 内置角色

| 角色     | 权限 | 说明                     |
| -------- | ---- | ------------------------ |
| `owner`  | 全部 | 资源所有者，最高权限     |
| `admin`  | 管理 | 管理员，可管理用户和权限 |
| `editor` | 编辑 | 可创建和编辑内容         |
| `viewer` | 只读 | 只能查看内容             |
| `guest`  | 受限 | 访客，受限访问           |

### 自定义角色

```javascript
// 创建自定义角色
await permissionEngine.createRole({
  name: "reviewer",
  description: "代码审查员",
  permissions: ["code:read", "code:comment", "pr:approve", "pr:reject"],
});

// 分配角色
await permissionEngine.assignRole(userId, "reviewer", {
  scope: "project:123", // 限定范围
});
```

---

## 权限类型

### 基础权限

| 权限 | 代码      | 说明           |
| ---- | --------- | -------------- |
| 读取 | `read`    | 查看资源       |
| 写入 | `write`   | 创建和修改资源 |
| 删除 | `delete`  | 删除资源       |
| 执行 | `execute` | 执行操作       |
| 管理 | `admin`   | 管理权限       |

### 权限格式

```
<资源类型>:<操作>

示例:
- note:read      # 读取笔记
- note:write     # 编辑笔记
- project:*      # 项目全部权限
- *:read         # 所有资源的读取权限
```

---

## 资源级权限

### 设置资源权限

```javascript
// 设置单个资源的权限
await permissionEngine.setResourcePermission({
  resourceType: "note",
  resourceId: "note-123",
  userId: "user-456",
  permissions: ["read", "write"],
});

// 设置资源对团队的权限
await permissionEngine.setResourcePermission({
  resourceType: "folder",
  resourceId: "folder-789",
  teamId: "team-dev",
  permissions: ["read", "write", "delete"],
});
```

### 检查权限

```javascript
// 检查用户是否有权限
const hasPermission = await permissionEngine.check({
  userId: "user-456",
  resourceType: "note",
  resourceId: "note-123",
  action: "write",
});

if (!hasPermission) {
  throw new Error("Permission denied");
}
```

---

## 权限继承

### 继承规则

```
组织 → 团队 → 项目 → 文件夹 → 文件

父级权限自动继承到子级
```

### 配置继承

```javascript
// 设置文件夹权限，子文件自动继承
await permissionEngine.setResourcePermission({
  resourceType: "folder",
  resourceId: "folder-parent",
  userId: "user-123",
  permissions: ["read", "write"],
  inherit: true, // 启用继承
});

// 子资源可以覆盖继承的权限
await permissionEngine.setResourcePermission({
  resourceType: "file",
  resourceId: "file-confidential",
  userId: "user-123",
  permissions: ["read"], // 覆盖为只读
  override: true,
});
```

---

## 权限委托

### 临时授权

```javascript
// 委托权限给其他用户
await delegationManager.delegate({
  fromUserId: "user-owner",
  toUserId: "user-delegate",
  permissions: ["note:write", "note:delete"],
  resourceScope: "project:123",
  expiresAt: new Date("2026-02-18"), // 一周后过期
  reason: "休假期间代理",
});
```

### 查看委托

```javascript
// 查看我委托出去的权限
const delegated = await delegationManager.getDelegatedByMe(userId);

// 查看我被委托的权限
const received = await delegationManager.getDelegatedToMe(userId);
```

### 撤销委托

```javascript
// 撤销委托
await delegationManager.revoke(delegationId);

// 委托自动过期后也会失效
```

---

## 团队权限

### 创建团队

```javascript
// 创建团队
const team = await teamManager.create({
  name: "开发团队",
  description: "核心开发人员",
  leaderId: "user-lead",
  parentTeamId: "team-engineering", // 父团队
});
```

### 管理成员

```javascript
// 添加成员
await teamManager.addMember(teamId, userId, {
  role: "member", // 或 'lead'
});

// 移除成员
await teamManager.removeMember(teamId, userId);

// 获取团队成员
const members = await teamManager.getMembers(teamId);
```

### 团队权限

```javascript
// 为团队设置权限
await permissionEngine.setTeamPermission({
  teamId: "team-dev",
  resourceType: "project",
  resourceId: "project-123",
  permissions: ["read", "write", "execute"],
});

// 团队成员自动获得这些权限
```

---

## 审批工作流

### 创建审批流程

```javascript
// 定义审批工作流
await approvalWorkflow.create({
  name: "敏感数据访问审批",
  trigger: {
    resourceType: "sensitive-data",
    action: "read",
  },
  approvers: ["user-security-lead"],
  timeout: 24 * 60 * 60 * 1000, // 24小时
});
```

### 发起审批

```javascript
// 请求需要审批的权限
const request = await approvalWorkflow.request({
  userId: "user-123",
  permission: "sensitive-data:read",
  resourceId: "data-456",
  reason: "调查客户问题需要查看日志",
});
```

### 处理审批

```javascript
// 审批人批准
await approvalWorkflow.approve(requestId, {
  approverId: "user-security-lead",
  comment: "已确认合理用途",
});

// 或拒绝
await approvalWorkflow.reject(requestId, {
  approverId: "user-security-lead",
  comment: "需要更多信息",
});
```

---

## 审计日志

### 权限变更记录

所有权限变更都会记录：

```javascript
{
  "timestamp": "2026-02-11T10:30:00Z",
  "action": "permission.grant",
  "actor": "user-admin",
  "target": "user-123",
  "details": {
    "permissions": ["note:write"],
    "resourceId": "note-456"
  }
}
```

### 查看审计日志

```javascript
// 获取审计日志
const logs = await permissionEngine.getAuditLogs({
  startTime: Date.now() - 7 * 24 * 60 * 60 * 1000, // 最近7天
  actions: ["permission.grant", "permission.revoke"],
});
```

---

## API 参考

### PermissionEngine

```javascript
// 检查权限
permissionEngine.check({ userId, resourceType, resourceId, action });

// 授予权限
permissionEngine.grant({ userId, permissions, resourceScope });

// 撤销权限
permissionEngine.revoke({ userId, permissions, resourceScope });

// 获取用户权限
permissionEngine.getUserPermissions(userId);

// 获取资源权限
permissionEngine.getResourcePermissions(resourceType, resourceId);
```

### TeamManager

```javascript
// 团队CRUD
teamManager.create(teamData);
teamManager.get(teamId);
teamManager.update(teamId, updates);
teamManager.delete(teamId);

// 成员管理
teamManager.addMember(teamId, userId, options);
teamManager.removeMember(teamId, userId);
teamManager.getMembers(teamId);

// 层级管理
teamManager.getSubTeams(teamId);
teamManager.getParentTeam(teamId);
```

---

## 配置选项

```javascript
// 权限系统配置
{
  "permission": {
    // 默认权限
    "defaultPermissions": ["read"],

    // 继承设置
    "inheritance": {
      "enabled": true,
      "maxDepth": 5
    },

    // 委托设置
    "delegation": {
      "enabled": true,
      "maxDuration": 30 * 24 * 60 * 60 * 1000  // 30天
    },

    // 审计设置
    "audit": {
      "enabled": true,
      "retentionDays": 90
    }
  }
}
```

---

## 性能指标

| 操作         | 响应时间 |
| ------------ | -------- |
| 权限检查     | <3ms     |
| 权限授予     | <15ms    |
| 获取用户权限 | <20ms    |
| 团队成员查询 | <30ms    |

---

## 下一步

- [团队管理](/chainlesschain/team-manager) - 详细团队管理
- [Cowork系统](/chainlesschain/cowork) - 多智能体协作
- [审计日志](/chainlesschain/audit) - 完整审计功能

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/permission/permission-engine.js` | RBAC 权限引擎核心实现 |
| `src/main/permission/team-manager.js` | 团队管理与成员权限 |
| `src/main/permission/delegation-manager.js` | 权限委托管理 |
| `src/main/permission/approval-workflow.js` | 审批工作流引擎 |
| `src/main/ipc/permission-ipc.js` | 权限系统 IPC 处理器 |
| `src/renderer/stores/permission.ts` | Pinia 权限状态管理 |

## 相关文档

- [SSO 企业认证](/chainlesschain/sso) - SAML/OAuth/OIDC 身份认证
- [审计与合规](/chainlesschain/audit) - 企业审计日志系统
- [Cowork 多智能体](/chainlesschain/cowork) - 多智能体协作权限

---

**安全可控，权限分明** 🔐
