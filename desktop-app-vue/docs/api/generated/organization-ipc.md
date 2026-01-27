# organization-ipc

**Source**: `src\main\organization\organization-ipc.js`

**Generated**: 2026-01-27T06:44:03.836Z

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

## ipcMain.handle('org:create-organization', async (_event, orgData) =>

```javascript
ipcMain.handle('org:create-organization', async (_event, orgData) =>
```

* 创建组织
   * Channel: 'org:create-organization'

---

## ipcMain.handle('org:join-organization', async (_event, inviteCode) =>

```javascript
ipcMain.handle('org:join-organization', async (_event, inviteCode) =>
```

* 通过邀请码加入组织
   * Channel: 'org:join-organization'

---

## ipcMain.handle('org:get-organization', async (_event, orgId) =>

```javascript
ipcMain.handle('org:get-organization', async (_event, orgId) =>
```

* 获取组织信息
   * Channel: 'org:get-organization'

---

## ipcMain.handle('org:update-organization', async (_event, params) =>

```javascript
ipcMain.handle('org:update-organization', async (_event, params) =>
```

* 更新组织信息
   * Channel: 'org:update-organization'

---

## ipcMain.handle('org:get-user-organizations', async (_event, userDID) =>

```javascript
ipcMain.handle('org:get-user-organizations', async (_event, userDID) =>
```

* 获取用户所属组织列表
   * Channel: 'org:get-user-organizations'

---

## ipcMain.handle('org:leave-organization', async (_event, orgId, userDID) =>

```javascript
ipcMain.handle('org:leave-organization', async (_event, orgId, userDID) =>
```

* 离开组织
   * Channel: 'org:leave-organization'

---

## ipcMain.handle('org:delete-organization', async (_event, orgId, userDID) =>

```javascript
ipcMain.handle('org:delete-organization', async (_event, orgId, userDID) =>
```

* 删除组织
   * Channel: 'org:delete-organization'

---

## ipcMain.handle('org:get-members', async (_event, orgId) =>

```javascript
ipcMain.handle('org:get-members', async (_event, orgId) =>
```

* 获取组织成员列表
   * Channel: 'org:get-members'

---

## ipcMain.handle('org:update-member-role', async (_event, orgId, memberDID, newRole) =>

```javascript
ipcMain.handle('org:update-member-role', async (_event, orgId, memberDID, newRole) =>
```

* 更新成员角色
   * Channel: 'org:update-member-role'

---

## ipcMain.handle('org:remove-member', async (_event, orgId, memberDID) =>

```javascript
ipcMain.handle('org:remove-member', async (_event, orgId, memberDID) =>
```

* 移除成员
   * Channel: 'org:remove-member'

---

## ipcMain.handle('org:check-permission', async (_event, orgId, userDID, permission) =>

```javascript
ipcMain.handle('org:check-permission', async (_event, orgId, userDID, permission) =>
```

* 检查权限
   * Channel: 'org:check-permission'

---

## ipcMain.handle('org:get-member-activities', async (_event, params) =>

```javascript
ipcMain.handle('org:get-member-activities', async (_event, params) =>
```

* 获取成员活动历史
   * Channel: 'org:get-member-activities'

---

## ipcMain.handle('org:create-invitation', async (_event, orgId, inviteData) =>

```javascript
ipcMain.handle('org:create-invitation', async (_event, orgId, inviteData) =>
```

* 创建邀请
   * Channel: 'org:create-invitation'

---

## ipcMain.handle('org:invite-by-did', async (_event, orgId, inviteData) =>

```javascript
ipcMain.handle('org:invite-by-did', async (_event, orgId, inviteData) =>
```

* 通过DID邀请用户
   * Channel: 'org:invite-by-did'

---

## ipcMain.handle('org:accept-did-invitation', async (_event, invitationId) =>

```javascript
ipcMain.handle('org:accept-did-invitation', async (_event, invitationId) =>
```

* 接受DID邀请
   * Channel: 'org:accept-did-invitation'

---

## ipcMain.handle('org:reject-did-invitation', async (_event, invitationId) =>

```javascript
ipcMain.handle('org:reject-did-invitation', async (_event, invitationId) =>
```

* 拒绝DID邀请
   * Channel: 'org:reject-did-invitation'

---

## ipcMain.handle('org:get-pending-did-invitations', async (_event) =>

```javascript
ipcMain.handle('org:get-pending-did-invitations', async (_event) =>
```

* 获取待处理的DID邀请
   * Channel: 'org:get-pending-did-invitations'

---

## ipcMain.handle('org:get-did-invitations', async (_event, orgId, options) =>

```javascript
ipcMain.handle('org:get-did-invitations', async (_event, orgId, options) =>
```

* 获取组织的DID邀请列表
   * Channel: 'org:get-did-invitations'

---

## ipcMain.handle('org:get-invitations', async (_event, orgId) =>

```javascript
ipcMain.handle('org:get-invitations', async (_event, orgId) =>
```

* 获取邀请列表（包括邀请码和DID邀请）
   * Channel: 'org:get-invitations'

---

## ipcMain.handle('org:revoke-invitation', async (_event, params) =>

```javascript
ipcMain.handle('org:revoke-invitation', async (_event, params) =>
```

* 撤销邀请
   * Channel: 'org:revoke-invitation'

---

## ipcMain.handle('org:delete-invitation', async (_event, params) =>

```javascript
ipcMain.handle('org:delete-invitation', async (_event, params) =>
```

* 删除邀请
   * Channel: 'org:delete-invitation'

---

## ipcMain.handle('org:create-invitation-link', async (_event, params) =>

```javascript
ipcMain.handle('org:create-invitation-link', async (_event, params) =>
```

* 创建邀请链接
   * Channel: 'org:create-invitation-link'

---

## ipcMain.handle('org:validate-invitation-token', async (_event, token) =>

```javascript
ipcMain.handle('org:validate-invitation-token', async (_event, token) =>
```

* 验证邀请令牌
   * Channel: 'org:validate-invitation-token'

---

## ipcMain.handle('org:accept-invitation-link', async (_event, token, options) =>

```javascript
ipcMain.handle('org:accept-invitation-link', async (_event, token, options) =>
```

* 通过邀请链接加入组织
   * Channel: 'org:accept-invitation-link'

---

## ipcMain.handle('org:get-invitation-links', async (_event, orgId, options) =>

```javascript
ipcMain.handle('org:get-invitation-links', async (_event, orgId, options) =>
```

* 获取邀请链接列表
   * Channel: 'org:get-invitation-links'

---

## ipcMain.handle('org:get-invitation-link', async (_event, linkId) =>

```javascript
ipcMain.handle('org:get-invitation-link', async (_event, linkId) =>
```

* 获取邀请链接详情
   * Channel: 'org:get-invitation-link'

---

## ipcMain.handle('org:revoke-invitation-link', async (_event, linkId) =>

```javascript
ipcMain.handle('org:revoke-invitation-link', async (_event, linkId) =>
```

* 撤销邀请链接
   * Channel: 'org:revoke-invitation-link'

---

## ipcMain.handle('org:delete-invitation-link', async (_event, linkId) =>

```javascript
ipcMain.handle('org:delete-invitation-link', async (_event, linkId) =>
```

* 删除邀请链接
   * Channel: 'org:delete-invitation-link'

---

## ipcMain.handle('org:get-invitation-link-stats', async (_event, orgId) =>

```javascript
ipcMain.handle('org:get-invitation-link-stats', async (_event, orgId) =>
```

* 获取邀请链接统计信息
   * Channel: 'org:get-invitation-link-stats'

---

## ipcMain.handle('org:copy-invitation-link', async (_event, invitationUrl) =>

```javascript
ipcMain.handle('org:copy-invitation-link', async (_event, invitationUrl) =>
```

* 复制邀请链接到剪贴板
   * Channel: 'org:copy-invitation-link'

---

## ipcMain.handle('org:generate-invitation-qrcode', async (_event, linkId, options) =>

```javascript
ipcMain.handle('org:generate-invitation-qrcode', async (_event, linkId, options) =>
```

* 为邀请链接生成QR码
   * Channel: 'org:generate-invitation-qrcode'

---

## ipcMain.handle('org:generate-did-invitation-qrcode', async (_event, invitationId, options) =>

```javascript
ipcMain.handle('org:generate-did-invitation-qrcode', async (_event, invitationId, options) =>
```

* 为DID邀请生成QR码
   * Channel: 'org:generate-did-invitation-qrcode'

---

## ipcMain.handle('org:generate-batch-invitation-qrcodes', async (_event, orgId, options) =>

```javascript
ipcMain.handle('org:generate-batch-invitation-qrcodes', async (_event, orgId, options) =>
```

* 批量生成邀请QR码
   * Channel: 'org:generate-batch-invitation-qrcodes'

---

## ipcMain.handle('org:parse-invitation-qrcode', async (_event, qrData) =>

```javascript
ipcMain.handle('org:parse-invitation-qrcode', async (_event, qrData) =>
```

* 解析邀请QR码
   * Channel: 'org:parse-invitation-qrcode'

---

## ipcMain.handle('org:download-qrcode', async (_event, qrCodeDataURL, filename) =>

```javascript
ipcMain.handle('org:download-qrcode', async (_event, qrCodeDataURL, filename) =>
```

* 下载QR码图片
   * Channel: 'org:download-qrcode'

---

## ipcMain.handle('org:get-roles', async (_event, orgId) =>

```javascript
ipcMain.handle('org:get-roles', async (_event, orgId) =>
```

* 获取组织所有角色
   * Channel: 'org:get-roles'

---

## ipcMain.handle('org:get-role', async (_event, roleId) =>

```javascript
ipcMain.handle('org:get-role', async (_event, roleId) =>
```

* 获取单个角色
   * Channel: 'org:get-role'

---

## ipcMain.handle('org:create-custom-role', async (_event, orgId, roleData, creatorDID) =>

```javascript
ipcMain.handle('org:create-custom-role', async (_event, orgId, roleData, creatorDID) =>
```

* 创建自定义角色
   * Channel: 'org:create-custom-role'

---

## ipcMain.handle('org:update-role', async (_event, roleId, updates, updaterDID) =>

```javascript
ipcMain.handle('org:update-role', async (_event, roleId, updates, updaterDID) =>
```

* 更新角色
   * Channel: 'org:update-role'

---

## ipcMain.handle('org:delete-role', async (_event, roleId, deleterDID) =>

```javascript
ipcMain.handle('org:delete-role', async (_event, roleId, deleterDID) =>
```

* 删除角色
   * Channel: 'org:delete-role'

---

## ipcMain.handle('org:get-all-permissions', async (_event) =>

```javascript
ipcMain.handle('org:get-all-permissions', async (_event) =>
```

* 获取所有可用权限列表
   * Channel: 'org:get-all-permissions'

---

## ipcMain.handle('org:get-activities', async (_event, options) =>

```javascript
ipcMain.handle('org:get-activities', async (_event, options) =>
```

* 获取组织活动日志
   * Channel: 'org:get-activities'

---

## ipcMain.handle('org:export-activities', async (_event, options) =>

```javascript
ipcMain.handle('org:export-activities', async (_event, options) =>
```

* 导出组织活动日志
   * Channel: 'org:export-activities'

---

## ipcMain.handle('org:get-knowledge-items', async (_event, params) =>

```javascript
ipcMain.handle('org:get-knowledge-items', async (_event, params) =>
```

* 获取组织知识列表
   * Channel: 'org:get-knowledge-items'

---

## ipcMain.handle('org:create-knowledge', async (_event, params) =>

```javascript
ipcMain.handle('org:create-knowledge', async (_event, params) =>
```

* 创建组织知识
   * Channel: 'org:create-knowledge'

---

## ipcMain.handle('org:delete-knowledge', async (_event, params) =>

```javascript
ipcMain.handle('org:delete-knowledge', async (_event, params) =>
```

* 删除组织知识
   * Channel: 'org:delete-knowledge'

---

