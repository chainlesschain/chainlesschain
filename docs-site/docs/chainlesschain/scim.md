# SCIM 2.0 企业用户自动化配置

> **Phase 44 | v1.1.0-alpha | 8 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔌 **RFC 7644 SCIM 2.0 服务器**: 完整实现 User/Group 资源的 CRUD 端点
- 🔄 **IdP 双向同步**: 支持 Azure AD、Okta、OneLogin 等主流 IdP 的增量同步
- ⚖️ **三种冲突策略**: IdP-First / Local-First / Latest-First 灵活选择
- 📊 **属性映射管理**: 自定义 Schema 扩展和属性映射配置
- 📜 **同步日志审计**: 完整的同步历史记录与错误分析

## 系统架构

```
┌────────────────────────────────────────┐
│   外部 IdP (Azure AD / Okta / ...)     │
└──────────────────┬─────────────────────┘
                   │ SCIM 2.0 协议
                   ▼
┌────────────────────────────────────────┐
│         SCIM 2.0 Server                │
│  /scim/v2/Users  /scim/v2/Groups       │
│  Bearer Token 认证 / 速率限制           │
└──────────┬──────────┬──────────────────┘
           │          │
           ▼          ▼
┌──────────────┐  ┌────────────────┐
│ 同步引擎      │  │ 冲突解决器      │
│ Pull/Push/   │  │ IdP-First      │
│ Bidirectional│  │ Local/Latest   │
└──────┬───────┘  └───────┬────────┘
       │                  │
       ▼                  ▼
┌───────────────────────────────────────┐
│   SQLite 用户/组存储 + 同步日志         │
└────────────────────────────────────────┘
```

## 概述

Phase 44 引入 SCIM 2.0 (System for Cross-domain Identity Management) 企业用户自动化配置系统,支持与 Azure AD、Okta、OneLogin 等 IdP 的双向同步。

**核心目标**:
- 🔌 **SCIM 2.0 Server**: RFC 7644 协议服务器
- 🔄 **IdP 双向同步**: 增量同步,冲突解决
- 📊 **Schema 管理**: 属性映射,自定义扩展
- 📜 **同步日志**: 完整的同步历史

---

## 什么是 SCIM?

SCIM (System for Cross-domain Identity Management) 是一个开放标准,用于自动化用户配置。

**优势**:
- ✅ 自动创建/更新/删除用户
- ✅ 减少手动操作错误
- ✅ 统一的用户生命周期管理
- ✅ 与主流 IdP 集成

---

## SCIM 服务器

### 支持的端点

**User 资源**:
- `GET /scim/v2/Users` - 列出用户
- `POST /scim/v2/Users` - 创建用户
- `GET /scim/v2/Users/:id` - 获取单个用户
- `PUT /scim/v2/Users/:id` - 完整更新
- `PATCH /scim/v2/Users/:id` - 部分更新
- `DELETE /scim/v2/Users/:id` - 删除用户

**Group 资源**:
- `GET /scim/v2/Groups` - 列出组
- `POST /scim/v2/Groups` - 创建组
- `PATCH /scim/v2/Groups/:id` - 更新组成员

**其他端点**:
- `GET /scim/v2/Schemas` - 获取 Schema
- `GET /scim/v2/ServiceProviderConfig` - 服务提供商配置

### User Resource 示例

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "2819c223-7f76-453a-919d-413861904646",
  "externalId": "user@example.com",
  "userName": "user@example.com",
  "name": {
    "formatted": "Alice Smith",
    "familyName": "Smith",
    "givenName": "Alice"
  },
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true,
  "meta": {
    "resourceType": "User",
    "created": "2026-02-27T10:00:00Z",
    "lastModified": "2026-02-27T10:00:00Z"
  }
}
```

---

## IdP 同步

### 支持的 IdP

| IdP | 状态 | 说明 |
|-----|------|------|
| **Azure AD** | ✅ 完全支持 | Microsoft Azure Active Directory |
| **Okta** | ✅ 完全支持 | Okta Identity Cloud |
| **OneLogin** | ✅ 完全支持 | OneLogin SSO |
| **Google Workspace** | 🔄 测试中 | G Suite Admin SDK |
| **Custom** | ✅ 支持 | 自定义 SCIM 2.0 兼容 IdP |

### 同步策略

**3 种冲突解决策略**:

1. **IdP-First** (IdP 优先) - 默认
   - IdP 的数据始终覆盖本地
   - 适用于 IdP 是权威数据源的场景

2. **Local-First** (本地优先)
   - 本地数据优先,仅在本地无数据时从 IdP 同步
   - 适用于本地维护用户信息的场景

3. **Latest-First** (最新优先)
   - 比较 `lastModified` 时间戳,最新的胜出
   - 适用于双向编辑的场景

### 使用示例

```javascript
// 启动 SCIM 服务器
await window.electronAPI.invoke('scim:start-server', {
  port: 9100,
  authToken: 'your-bearer-token'
})

// 同步用户
const result = await window.electronAPI.invoke('scim:sync-users', {
  direction: 'bidirectional', // pull/push/bidirectional
  strategy: 'idp-first'
})

console.log(result)
// {
//   synced: 25,
//   created: 5,
//   updated: 15,
//   deleted: 3,
//   conflicts: 2
// }

// 解决冲突
await window.electronAPI.invoke('scim:resolve-conflict', {
  conflictId: 'conflict-123',
  strategy: 'idp-first'
})

// 查看同步日志
const logs = await window.electronAPI.invoke('scim:get-sync-log', {
  limit: 50
})
```

---

## 配置 IdP

### Azure AD 配置

1. 在 Azure AD 中添加企业应用
2. 选择 "Provisioning" → "Automatic"
3. 配置 SCIM 端点:
   ```
   Tenant URL: https://your-domain.com/scim/v2
   Secret Token: your-bearer-token
   ```
4. 映射属性 (可选)
5. 启动配置

### Okta 配置

1. 创建新的应用集成
2. 选择 "SCIM 2.0"
3. 配置 SCIM 连接器:
   ```
   SCIM Base URL: https://your-domain.com/scim/v2
   Unique identifier field: userName
   Supported provisioning actions:
     ✅ Push New Users
     ✅ Push Profile Updates
     ✅ Push Groups
   ```
4. 映射属性
5. 激活

---

## 前端集成

### 前端页面

**SCIM 集成页面** (`/scim-integration`)

**功能模块**:

1. **服务器控制**
   - 启动/停止 SCIM 服务器
   - 端口和认证配置
   - 服务器状态监控

2. **IdP 配置**
   - IdP 类型选择
   - SCIM 端点配置
   - 认证凭据管理

3. **资源管理**
   - User/Group 列表
   - 资源详情查看
   - 属性映射配置

4. **同步控制**
   - 手动触发同步
   - 定时同步配置
   - 冲突可视化对比

5. **日志查看**
   - 同步历史记录
   - 错误日志分析
   - 统计报表

---

## 配置选项

```json
{
  "scim": {
    "enabled": false,
    "server": {
      "port": 9100,
      "hostname": "0.0.0.0",
      "authType": "bearer",
      "bearerToken": ""
    },
    "idp": {
      "type": "azure-ad",
      "scimBaseUrl": "",
      "authToken": "",
      "syncInterval": 3600
    },
    "sync": {
      "conflictStrategy": "idp-first",
      "enableAutoSync": false,
      "retryAttempts": 3
    }
  }
}
```

---

## 使用场景

### 场景 1: 从 Azure AD 同步用户

```javascript
// 1. 配置 Azure AD 连接
await window.electronAPI.invoke('scim:configure-idp', {
  type: 'azure-ad',
  scimBaseUrl: 'https://graph.microsoft.com/v1.0',
  authToken: 'your-token'
})

// 2. 执行首次全量同步
const result = await window.electronAPI.invoke('scim:sync-users', {
  direction: 'pull',
  fullSync: true
})

// 3. 启用自动增量同步
await window.electronAPI.invoke('scim:enable-auto-sync', {
  interval: 3600 // 每小时
})
```

### 场景 2: 处理同步冲突

```javascript
// 1. 检查冲突
const conflicts = await window.electronAPI.invoke('scim:get-conflicts')

// 2. 查看冲突详情
conflicts.forEach(conflict => {
  console.log(`User: ${conflict.userName}`)
  console.log(`Local: ${conflict.localData}`)
  console.log(`Remote: ${conflict.remoteData}`)
})

// 3. 批量解决冲突
await window.electronAPI.invoke('scim:resolve-all-conflicts', {
  strategy: 'idp-first'
})
```

---

## 配置参考

### 完整配置字段说明

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `scim.enabled` | `boolean` | `false` | 启用/禁用 SCIM 2.0 服务器模块 |
| `scim.server.port` | `number` | `9100` | SCIM 服务器监听端口 |
| `scim.server.hostname` | `string` | `"0.0.0.0"` | 监听地址；生产环境建议绑定具体 IP |
| `scim.server.authType` | `"bearer"` | `"bearer"` | 认证方式，当前仅支持 Bearer Token |
| `scim.server.bearerToken` | `string` | `""` | IdP 调用 SCIM 端点时携带的 Token；建议 32 字符以上随机串 |
| `scim.idp.type` | `string` | `"azure-ad"` | IdP 类型：`azure-ad` / `okta` / `onelogin` / `google` / `custom` |
| `scim.idp.scimBaseUrl` | `string` | `""` | IdP 侧的 SCIM Base URL（Pull 同步时使用） |
| `scim.idp.authToken` | `string` | `""` | 访问 IdP SCIM API 的 Bearer Token |
| `scim.idp.syncInterval` | `number` | `3600` | 自动同步间隔（秒）；设为 `0` 禁用自动同步 |
| `scim.sync.conflictStrategy` | `string` | `"idp-first"` | 冲突解决策略：`idp-first` / `local-first` / `latest-first` |
| `scim.sync.enableAutoSync` | `boolean` | `false` | 启用按 `syncInterval` 自动周期同步 |
| `scim.sync.retryAttempts` | `number` | `3` | 同步失败后的最大重试次数，指数退避 |

### SCIM 端点认证配置示例

```json
{
  "scim": {
    "enabled": true,
    "server": {
      "port": 9100,
      "hostname": "0.0.0.0",
      "authType": "bearer",
      "bearerToken": "your-32-char-random-token-here"
    },
    "idp": {
      "type": "okta",
      "scimBaseUrl": "https://your-org.okta.com/scim/v2",
      "authToken": "okta-api-token",
      "syncInterval": 1800
    },
    "sync": {
      "conflictStrategy": "idp-first",
      "enableAutoSync": true,
      "retryAttempts": 3
    }
  }
}
```

---

## 性能指标

| 指标 | 目标 | 实测 | 说明 |
| --- | --- | --- | --- |
| 用户创建 (单条 POST) | <200ms | ~80ms | 含数据库写入和同步日志 |
| 用户列表查询 (GET /Users) | <300ms | ~120ms | 1000 用户，无过滤 |
| 增量同步 (100 条变更) | <5s | ~2s | Azure AD Pull，含冲突检测 |
| 全量同步 (10000 用户) | <120s | ~55s | 首次全量 Pull，批量写入 |
| 冲突解决 (批量 50 条) | <1s | ~400ms | `idp-first` 策略，全内存操作 |
| SCIM 服务器启动 | <500ms | ~180ms | 含端口绑定和 Token 验证初始化 |
| 速率限制检查 | <5ms | ~1ms | 内存计数器，100 req/min 窗口 |

**测试环境**: Node.js 20, SQLite WAL 模式, Windows 10 i7-12700K 16GB RAM

---

## 测试覆盖率

### 测试文件

| 文件 | 测试数 | 覆盖内容 |
| --- | --- | --- |
| `tests/unit/enterprise/scim-server.test.js` | 32 | RFC 7644 端点、Bearer Token 认证、速率限制 |
| `tests/unit/enterprise/scim-sync-engine.test.js` | 28 | Pull/Push/双向同步、增量检测、重试逻辑 |
| `tests/unit/enterprise/scim-conflict-resolver.test.js` | 22 | 三种冲突策略、时间戳比较、批量解决 |
| `tests/unit/ipc/ipc-scim.test.js` | 18 | 8 个 IPC 通道参数校验与权限检查 |

**总计**: 100 个单元测试，行覆盖率 ~91%

### 关键测试场景

```javascript
// Bearer Token 认证：无效 Token 应返回 401
it('rejects requests with invalid bearer token', async () => {
  const res = await request(scimServer.app)
    .get('/scim/v2/Users')
    .set('Authorization', 'Bearer wrong-token');
  expect(res.status).toBe(401);
});

// IdP-First 冲突策略：IdP 数据应覆盖本地
it('resolves conflict with idp-first strategy', async () => {
  const result = await resolver.resolve(conflict, 'idp-first');
  expect(result.userName).toBe(conflict.remoteData.userName);
});

// 全量同步后用户数应与 IdP 一致
it('syncs all users from IdP on full pull', async () => {
  mockIdp.setUsers(generateUsers(500));
  const result = await engine.sync({ direction: 'pull', fullSync: true });
  expect(result.synced).toBe(500);
  expect(result.conflicts).toBe(0);
});
```

---

## 安全考虑

1. **Bearer Token**: 支持 Bearer Token 认证
2. **TLS 加密**: 生产环境强制 HTTPS
3. **RBAC 集成**: 仅管理员可访问 SCIM 端点
4. **速率限制**: 100 req/min 防止滥用
5. **审计日志**: 所有 SCIM 操作记录到 audit_logs

---

## 故障排查

### IdP 同步失败

- **认证错误**: 检查 Bearer Token 是否正确且未过期，Azure AD 的 Token 有有效期限制
- **网络连接**: 确认 SCIM 服务器端口（默认 9100）可从 IdP 访问，检查防火墙规则
- **Schema 不匹配**: 确认 IdP 端的属性映射与 SCIM 服务器 Schema 一致

```javascript
// 检查同步日志定位错误原因
const logs = await window.electronAPI.invoke('scim:get-sync-log', {
  limit: 20,
  status: 'error'
});
```

### 冲突解决不符合预期

- 确认 `conflictStrategy` 配置正确（`idp-first` / `local-first` / `latest-first`）
- 检查冲突记录中的 `lastModified` 时间戳是否准确（时区问题可能导致 `latest-first` 判断错误）
- 对高危冲突建议使用手动解决而非自动策略

### SCIM 服务器启动失败

- **端口占用**: 检查 9100 端口是否被其他服务占用，尝试更换端口
- **权限不足**: 确认当前用户有 SCIM 管理员权限（RBAC `admin` 角色）
- **数据库锁**: 重启应用释放 SQLite 数据库锁

### 用户同步后权限异常

- SCIM 同步仅处理用户和组的基本属性，RBAC 角色需要在本地单独配置
- 确认组成员关系同步正确，用户的权限继承自所属组的角色

---

## 相关文档

- [企业合规](/chainlesschain/compliance)
- [权限管理](/chainlesschain/permissions)
- [SSO 认证](/chainlesschain/simkey-enterprise)
- [产品路线图](/chainlesschain/product-roadmap)

---

## 关键文件

| 文件                                              | 职责                     |
| ------------------------------------------------- | ------------------------ |
| `src/main/enterprise/scim-server.js`              | SCIM 2.0 协议服务器     |
| `src/main/enterprise/scim-sync-engine.js`         | IdP 双向同步引擎        |
| `src/main/enterprise/scim-conflict-resolver.js`   | 冲突检测与解决          |
| `src/main/enterprise/scim-ipc.js`                 | IPC 处理器（8 个）      |
| `src/renderer/pages/enterprise/SCIMPage.vue`      | SCIM 集成管理页面       |
| `src/renderer/stores/scim.ts`                     | Pinia 状态管理          |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
