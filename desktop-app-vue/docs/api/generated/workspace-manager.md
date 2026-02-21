# workspace-manager

**Source**: `src/main/workspace/workspace-manager.js`

**Generated**: 2026-02-21T20:04:16.183Z

---

## class WorkspaceManager

```javascript
class WorkspaceManager
```

* 工作区管理器 - 企业协作工作区核心模块
 * Phase 1 - v0.17.0
 *
 * 功能:
 * - 工作区CRUD
 * - 工作区成员管理
 * - 工作区资源管理
 * - 工作区权限控制
 *
 * @class WorkspaceManager

---

## constructor(db, organizationManager)

```javascript
constructor(db, organizationManager)
```

* @param {Object} db - 数据库实例
   * @param {Object} organizationManager - 组织管理器实例

---

## async createWorkspace(orgId, workspaceData, creatorDID)

```javascript
async createWorkspace(orgId, workspaceData, creatorDID)
```

* 创建工作区
   * @param {string} orgId - 组织ID
   * @param {Object} workspaceData - 工作区数据
   * @param {string} workspaceData.name - 工作区名称
   * @param {string} workspaceData.description - 描述
   * @param {string} workspaceData.type - 类型 (default|development|testing|production)
   * @param {string} workspaceData.color - 颜色标识
   * @param {string} workspaceData.icon - 图标
   * @param {string} workspaceData.visibility - 可见性 (members|admins|specific_roles)
   * @param {Array<string>} workspaceData.allowedRoles - 允许访问的角色列表
   * @param {string} creatorDID - 创建者DID
   * @returns {Promise<Object>} 创建的工作区信息

---

## async getWorkspaces(orgId, options =

```javascript
async getWorkspaces(orgId, options =
```

* 获取组织的所有工作区
   * @param {string} orgId - 组织ID
   * @param {Object} options - 查询选项
   * @param {boolean} options.includeArchived - 是否包含已归档的工作区
   * @returns {Promise<Array>} 工作区列表

---

## async getWorkspace(workspaceId)

```javascript
async getWorkspace(workspaceId)
```

* 获取单个工作区详情
   * @param {string} workspaceId - 工作区ID
   * @returns {Promise<Object|null>} 工作区信息

---

## async updateWorkspace(workspaceId, updates, updaterDID)

```javascript
async updateWorkspace(workspaceId, updates, updaterDID)
```

* 更新工作区
   * @param {string} workspaceId - 工作区ID
   * @param {Object} updates - 更新字段
   * @param {string} updaterDID - 更新者DID
   * @returns {Promise<Object>} 更新结果

---

## async deleteWorkspace(workspaceId, deleterDID)

```javascript
async deleteWorkspace(workspaceId, deleterDID)
```

* 删除工作区（归档）
   * @param {string} workspaceId - 工作区ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<Object>} 删除结果

---

## async restoreWorkspace(workspaceId, restorerDID)

```javascript
async restoreWorkspace(workspaceId, restorerDID)
```

* 恢复已归档的工作区
   * @param {string} workspaceId - 工作区ID
   * @param {string} restorerDID - 恢复者DID
   * @returns {Promise<Object>} 恢复结果

---

## async permanentDeleteWorkspace(workspaceId, deleterDID)

```javascript
async permanentDeleteWorkspace(workspaceId, deleterDID)
```

* 永久删除工作区
   * @param {string} workspaceId - 工作区ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<Object>} 删除结果

---

## async addWorkspaceMember(workspaceId, memberDID, role = "member")

```javascript
async addWorkspaceMember(workspaceId, memberDID, role = "member")
```

* 添加工作区成员
   * @param {string} workspaceId - 工作区ID
   * @param {string} memberDID - 成员DID
   * @param {string} role - 角色 (admin|member|viewer)
   * @returns {Promise<Object>} 添加结果

---

## async removeWorkspaceMember(workspaceId, memberDID)

```javascript
async removeWorkspaceMember(workspaceId, memberDID)
```

* 移除工作区成员
   * @param {string} workspaceId - 工作区ID
   * @param {string} memberDID - 成员DID
   * @returns {Promise<Object>} 移除结果

---

## async getWorkspaceMembers(workspaceId)

```javascript
async getWorkspaceMembers(workspaceId)
```

* 获取工作区成员列表
   * @param {string} workspaceId - 工作区ID
   * @returns {Promise<Array>} 成员列表

---

## async addResource(workspaceId, resourceType, resourceId, adderDID)

```javascript
async addResource(workspaceId, resourceType, resourceId, adderDID)
```

* 添加资源到工作区
   * @param {string} workspaceId - 工作区ID
   * @param {string} resourceType - 资源类型 (knowledge|project|conversation)
   * @param {string} resourceId - 资源ID
   * @param {string} adderDID - 添加者DID
   * @returns {Promise<Object>} 添加结果

---

## async removeResource(workspaceId, resourceType, resourceId)

```javascript
async removeResource(workspaceId, resourceType, resourceId)
```

* 从工作区移除资源
   * @param {string} workspaceId - 工作区ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @returns {Promise<Object>} 移除结果

---

## async getWorkspaceResources(workspaceId, resourceType = null)

```javascript
async getWorkspaceResources(workspaceId, resourceType = null)
```

* 获取工作区的所有资源
   * @param {string} workspaceId - 工作区ID
   * @param {string} resourceType - 资源类型（可选）
   * @returns {Promise<Array>} 资源列表

---

