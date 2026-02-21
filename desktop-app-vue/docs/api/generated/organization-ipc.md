# organization-ipc

**Source**: `src/main/organization/organization-ipc.js`

**Generated**: 2026-02-21T20:04:16.229Z

---

## const

```javascript
const
```

* Organization IPC 处理器
 * 负责处理组织管理相关的前后端通信（企业版功能）
 *
 * @module organization-ipc
 * @description 提供组织创建、成员管理、权限控制、邀请管理、知识库等完整的企业协作功能 IPC 接口

---

## function registerOrganizationIPC(

```javascript
function registerOrganizationIPC(
```

* 注册所有 Organization IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.organizationManager - 组织管理器
 * @param {Object} dependencies.dbManager - 数据库管理器（用于知识库操作）
 * @param {Object} dependencies.versionManager - 版本管理器（用于知识库版本）
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} dependencies.dialog - Dialog对象（可选，用于测试注入）
 * @param {Object} dependencies.app - App对象（可选，用于测试注入）

---

## safeHandle("org:create-organization", async (_event, orgData) =>

```javascript
safeHandle("org:create-organization", async (_event, orgData) =>
```

* 创建组织
   * Channel: 'org:create-organization'

---

## safeHandle("org:join-organization", async (_event, inviteCode) =>

```javascript
safeHandle("org:join-organization", async (_event, inviteCode) =>
```

* 通过邀请码加入组织
   * Channel: 'org:join-organization'

---

## safeHandle("org:get-organization", async (_event, orgId) =>

```javascript
safeHandle("org:get-organization", async (_event, orgId) =>
```

* 获取组织信息
   * Channel: 'org:get-organization'

---

## safeHandle("organization:get-info", async (_event, params) =>

```javascript
safeHandle("organization:get-info", async (_event, params) =>
```

* 获取组织信息（前端友好格式）
   * Channel: 'organization:get-info'
   *
   * 这是 org:get-organization 的别名，返回格式为 { success: true, organization: {...} }
   * 用于 EnterpriseDashboard 等页面

---

## safeHandle("org:update-organization", async (_event, params) =>

```javascript
safeHandle("org:update-organization", async (_event, params) =>
```

* 更新组织信息
   * Channel: 'org:update-organization'

---

## safeHandle("org:get-user-organizations", async (_event, userDID) =>

```javascript
safeHandle("org:get-user-organizations", async (_event, userDID) =>
```

* 获取用户所属组织列表
   * Channel: 'org:get-user-organizations'

---

## safeHandle("org:leave-organization", async (_event, orgId, userDID) =>

```javascript
safeHandle("org:leave-organization", async (_event, orgId, userDID) =>
```

* 离开组织
   * Channel: 'org:leave-organization'

---

## safeHandle("org:delete-organization", async (_event, orgId, userDID) =>

```javascript
safeHandle("org:delete-organization", async (_event, orgId, userDID) =>
```

* 删除组织
   * Channel: 'org:delete-organization'

---

## safeHandle("org:get-members", async (_event, orgId) =>

```javascript
safeHandle("org:get-members", async (_event, orgId) =>
```

* 获取组织成员列表
   * Channel: 'org:get-members'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新成员角色
   * Channel: 'org:update-member-role'

---

## safeHandle("org:remove-member", async (_event, orgId, memberDID) =>

```javascript
safeHandle("org:remove-member", async (_event, orgId, memberDID) =>
```

* 移除成员
   * Channel: 'org:remove-member'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 检查权限
   * Channel: 'org:check-permission'

---

## safeHandle("org:get-member-activities", async (_event, params) =>

```javascript
safeHandle("org:get-member-activities", async (_event, params) =>
```

* 获取成员活动历史
   * Channel: 'org:get-member-activities'

---

## safeHandle("org:create-invitation", async (_event, orgId, inviteData) =>

```javascript
safeHandle("org:create-invitation", async (_event, orgId, inviteData) =>
```

* 创建邀请
   * Channel: 'org:create-invitation'

---

## safeHandle("org:invite-by-did", async (_event, orgId, inviteData) =>

```javascript
safeHandle("org:invite-by-did", async (_event, orgId, inviteData) =>
```

* 通过DID邀请用户
   * Channel: 'org:invite-by-did'

---

## safeHandle("org:accept-did-invitation", async (_event, invitationId) =>

```javascript
safeHandle("org:accept-did-invitation", async (_event, invitationId) =>
```

* 接受DID邀请
   * Channel: 'org:accept-did-invitation'

---

## safeHandle("org:reject-did-invitation", async (_event, invitationId) =>

```javascript
safeHandle("org:reject-did-invitation", async (_event, invitationId) =>
```

* 拒绝DID邀请
   * Channel: 'org:reject-did-invitation'

---

## safeHandle("org:get-pending-did-invitations", async (_event) =>

```javascript
safeHandle("org:get-pending-did-invitations", async (_event) =>
```

* 获取待处理的DID邀请
   * Channel: 'org:get-pending-did-invitations'

---

## safeHandle("org:get-did-invitation-history", async (_event, options) =>

```javascript
safeHandle("org:get-did-invitation-history", async (_event, options) =>
```

* 获取当前用户的DID邀请历史（已接受、已拒绝、已过期）
   * Channel: 'org:get-did-invitation-history'

---

## safeHandle("org:get-did-invitations", async (_event, orgId, options) =>

```javascript
safeHandle("org:get-did-invitations", async (_event, orgId, options) =>
```

* 获取组织的DID邀请列表
   * Channel: 'org:get-did-invitations'

---

## safeHandle("org:get-invitations", async (_event, orgId) =>

```javascript
safeHandle("org:get-invitations", async (_event, orgId) =>
```

* 获取邀请列表（包括邀请码和DID邀请）
   * Channel: 'org:get-invitations'

---

## safeHandle("org:revoke-invitation", async (_event, params) =>

```javascript
safeHandle("org:revoke-invitation", async (_event, params) =>
```

* 撤销邀请
   * Channel: 'org:revoke-invitation'

---

## safeHandle("org:delete-invitation", async (_event, params) =>

```javascript
safeHandle("org:delete-invitation", async (_event, params) =>
```

* 删除邀请
   * Channel: 'org:delete-invitation'

---

## safeHandle("org:create-invitation-link", async (_event, params) =>

```javascript
safeHandle("org:create-invitation-link", async (_event, params) =>
```

* 创建邀请链接
   * Channel: 'org:create-invitation-link'

---

## safeHandle("org:validate-invitation-token", async (_event, token) =>

```javascript
safeHandle("org:validate-invitation-token", async (_event, token) =>
```

* 验证邀请令牌
   * Channel: 'org:validate-invitation-token'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 通过邀请链接加入组织
   * Channel: 'org:accept-invitation-link'

---

## safeHandle("org:get-invitation-links", async (_event, orgId, options) =>

```javascript
safeHandle("org:get-invitation-links", async (_event, orgId, options) =>
```

* 获取邀请链接列表
   * Channel: 'org:get-invitation-links'

---

## safeHandle("org:get-invitation-link", async (_event, linkId) =>

```javascript
safeHandle("org:get-invitation-link", async (_event, linkId) =>
```

* 获取邀请链接详情
   * Channel: 'org:get-invitation-link'

---

## safeHandle("org:revoke-invitation-link", async (_event, linkId) =>

```javascript
safeHandle("org:revoke-invitation-link", async (_event, linkId) =>
```

* 撤销邀请链接
   * Channel: 'org:revoke-invitation-link'

---

## safeHandle("org:delete-invitation-link", async (_event, linkId) =>

```javascript
safeHandle("org:delete-invitation-link", async (_event, linkId) =>
```

* 删除邀请链接
   * Channel: 'org:delete-invitation-link'

---

## safeHandle("org:get-invitation-link-stats", async (_event, orgId) =>

```javascript
safeHandle("org:get-invitation-link-stats", async (_event, orgId) =>
```

* 获取邀请链接统计信息
   * Channel: 'org:get-invitation-link-stats'

---

## safeHandle("org:copy-invitation-link", async (_event, invitationUrl) =>

```javascript
safeHandle("org:copy-invitation-link", async (_event, invitationUrl) =>
```

* 复制邀请链接到剪贴板
   * Channel: 'org:copy-invitation-link'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 为邀请链接生成QR码
   * Channel: 'org:generate-invitation-qrcode'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 为DID邀请生成QR码
   * Channel: 'org:generate-did-invitation-qrcode'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 批量生成邀请QR码
   * Channel: 'org:generate-batch-invitation-qrcodes'

---

## safeHandle("org:parse-invitation-qrcode", async (_event, qrData) =>

```javascript
safeHandle("org:parse-invitation-qrcode", async (_event, qrData) =>
```

* 解析邀请QR码
   * Channel: 'org:parse-invitation-qrcode'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 下载QR码图片
   * Channel: 'org:download-qrcode'

---

## safeHandle("org:get-roles", async (_event, orgId) =>

```javascript
safeHandle("org:get-roles", async (_event, orgId) =>
```

* 获取组织所有角色
   * Channel: 'org:get-roles'

---

## safeHandle("org:get-role", async (_event, roleId) =>

```javascript
safeHandle("org:get-role", async (_event, roleId) =>
```

* 获取单个角色
   * Channel: 'org:get-role'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 创建自定义角色
   * Channel: 'org:create-custom-role'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新角色
   * Channel: 'org:update-role'

---

## safeHandle("org:delete-role", async (_event, roleId, deleterDID) =>

```javascript
safeHandle("org:delete-role", async (_event, roleId, deleterDID) =>
```

* 删除角色
   * Channel: 'org:delete-role'

---

## safeHandle("org:get-all-permissions", async (_event) =>

```javascript
safeHandle("org:get-all-permissions", async (_event) =>
```

* 获取所有可用权限列表
   * Channel: 'org:get-all-permissions'

---

## safeHandle("org:get-activities", async (_event, options) =>

```javascript
safeHandle("org:get-activities", async (_event, options) =>
```

* 获取组织活动日志
   * Channel: 'org:get-activities'

---

## safeHandle("org:export-activities", async (_event, options) =>

```javascript
safeHandle("org:export-activities", async (_event, options) =>
```

* 导出组织活动日志
   * Channel: 'org:export-activities'

---

## safeHandle("org:get-knowledge-items", async (_event, params) =>

```javascript
safeHandle("org:get-knowledge-items", async (_event, params) =>
```

* 获取组织知识列表
   * Channel: 'org:get-knowledge-items'

---

## safeHandle("org:create-knowledge", async (_event, params) =>

```javascript
safeHandle("org:create-knowledge", async (_event, params) =>
```

* 创建组织知识
   * Channel: 'org:create-knowledge'

---

## safeHandle("org:delete-knowledge", async (_event, params) =>

```javascript
safeHandle("org:delete-knowledge", async (_event, params) =>
```

* 删除组织知识
   * Channel: 'org:delete-knowledge'

---

