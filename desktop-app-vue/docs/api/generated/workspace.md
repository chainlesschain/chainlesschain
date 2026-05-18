# workspace

**Source**: `src\renderer\stores\workspace.js`

**Generated**: 2026-01-27T06:44:03.889Z

---

## export const useWorkspaceStore = defineStore('workspace', () =>

```javascript
export const useWorkspaceStore = defineStore('workspace', () =>
```

* 工作区管理Store - Phase 1
 * 负责管理组织工作区的CRUD操作和成员管理

---

## const defaultWorkspace = computed(() =>

```javascript
const defaultWorkspace = computed(() =>
```

* 获取默认工作区

---

## const workspacesByType = computed(() =>

```javascript
const workspacesByType = computed(() =>
```

* 按类型分组的工作区

---

## const activeWorkspaces = computed(() =>

```javascript
const activeWorkspaces = computed(() =>
```

* 未归档的工作区

---

## const archivedWorkspaces = computed(() =>

```javascript
const archivedWorkspaces = computed(() =>
```

* 归档的工作区

---

## const currentWorkspaceId = computed(() =>

```javascript
const currentWorkspaceId = computed(() =>
```

* 当前工作区ID

---

## const currentUserRole = computed(() =>

```javascript
const currentUserRole = computed(() =>
```

* 当前用户在当前工作区的角色

---

## async function loadWorkspaces(orgId, includeArchived = false)

```javascript
async function loadWorkspaces(orgId, includeArchived = false)
```

* 加载组织工作区列表
   * @param {string} orgId - 组织ID
   * @param {boolean} includeArchived - 是否包含归档的工作区

---

## async function createWorkspace(orgId, workspaceData)

```javascript
async function createWorkspace(orgId, workspaceData)
```

* 创建工作区
   * @param {string} orgId - 组织ID
   * @param {object} workspaceData - 工作区数据

---

## async function updateWorkspace(workspaceId, updates)

```javascript
async function updateWorkspace(workspaceId, updates)
```

* 更新工作区
   * @param {string} workspaceId - 工作区ID
   * @param {object} updates - 更新数据

---

## async function deleteWorkspace(workspaceId)

```javascript
async function deleteWorkspace(workspaceId)
```

* 删除（归档）工作区
   * @param {string} workspaceId - 工作区ID

---

## async function selectWorkspace(workspaceId)

```javascript
async function selectWorkspace(workspaceId)
```

* 选中工作区
   * @param {string} workspaceId - 工作区ID

---

## async function loadWorkspaceMembers(workspaceId)

```javascript
async function loadWorkspaceMembers(workspaceId)
```

* 加载工作区成员
   * @param {string} workspaceId - 工作区ID

---

## async function loadWorkspaceResources(workspaceId)

```javascript
async function loadWorkspaceResources(workspaceId)
```

* 加载工作区资源
   * @param {string} workspaceId - 工作区ID

---

## async function addMember(workspaceId, memberDID, role)

```javascript
async function addMember(workspaceId, memberDID, role)
```

* 添加工作区成员
   * @param {string} workspaceId - 工作区ID
   * @param {string} memberDID - 成员DID
   * @param {string} role - 角色 (admin/member/viewer)

---

## async function removeMember(workspaceId, memberDID)

```javascript
async function removeMember(workspaceId, memberDID)
```

* 移除工作区成员
   * @param {string} workspaceId - 工作区ID
   * @param {string} memberDID - 成员DID

---

## async function addResource(workspaceId, resourceType, resourceId)

```javascript
async function addResource(workspaceId, resourceType, resourceId)
```

* 添加资源到工作区
   * @param {string} workspaceId - 工作区ID
   * @param {string} resourceType - 资源类型 (knowledge/project/conversation)
   * @param {string} resourceId - 资源ID

---

## function reset()

```javascript
function reset()
```

* 重置Store

---

