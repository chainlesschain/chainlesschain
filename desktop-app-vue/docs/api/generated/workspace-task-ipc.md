# workspace-task-ipc

**Source**: `src/main/ipc/workspace-task-ipc.js`

**Generated**: 2026-02-17T10:13:18.235Z

---

## const

```javascript
const
```

* 工作区与任务管理 IPC 处理器
 * Phase 1 - v0.17.0
 *
 * 注册所有工作区和任务相关的IPC接口（22个）

---

## function registerWorkspaceTaskIPC(app)

```javascript
function registerWorkspaceTaskIPC(app)
```

* 注册工作区与任务管理IPC处理器
 * @param {Object} app - ChainlessChainApp实例

---

## ipcMain.handle('organization:workspace:create', async (event,

```javascript
ipcMain.handle('organization:workspace:create', async (event,
```

* 创建工作区

---

## ipcMain.handle('organization:workspace:list', async (event,

```javascript
ipcMain.handle('organization:workspace:list', async (event,
```

* 获取组织工作区列表

---

## ipcMain.handle('organization:workspace:update', async (event,

```javascript
ipcMain.handle('organization:workspace:update', async (event,
```

* 更新工作区

---

## ipcMain.handle('organization:workspace:delete', async (event,

```javascript
ipcMain.handle('organization:workspace:delete', async (event,
```

* 删除工作区

---

## ipcMain.handle('organization:workspace:restore', async (event,

```javascript
ipcMain.handle('organization:workspace:restore', async (event,
```

* 恢复工作区

---

## ipcMain.handle('organization:workspace:permanentDelete', async (event,

```javascript
ipcMain.handle('organization:workspace:permanentDelete', async (event,
```

* 永久删除工作区

---

## ipcMain.handle('organization:workspace:addMember', async (event,

```javascript
ipcMain.handle('organization:workspace:addMember', async (event,
```

* 添加工作区成员

---

## ipcMain.handle('organization:workspace:removeMember', async (event,

```javascript
ipcMain.handle('organization:workspace:removeMember', async (event,
```

* 移除工作区成员

---

## ipcMain.handle('organization:workspace:addResource', async (event,

```javascript
ipcMain.handle('organization:workspace:addResource', async (event,
```

* 添加资源到工作区

---

## ipcMain.handle('tasks:create', async (event,

```javascript
ipcMain.handle('tasks:create', async (event,
```

* 创建任务

---

## ipcMain.handle('tasks:update', async (event,

```javascript
ipcMain.handle('tasks:update', async (event,
```

* 更新任务

---

## ipcMain.handle('tasks:delete', async (event,

```javascript
ipcMain.handle('tasks:delete', async (event,
```

* 删除任务

---

## ipcMain.handle('tasks:list', async (event,

```javascript
ipcMain.handle('tasks:list', async (event,
```

* 获取任务列表

---

## ipcMain.handle('tasks:detail', async (event,

```javascript
ipcMain.handle('tasks:detail', async (event,
```

* 获取任务详情

---

## ipcMain.handle('tasks:assign', async (event,

```javascript
ipcMain.handle('tasks:assign', async (event,
```

* 分配任务

---

## ipcMain.handle('tasks:changeStatus', async (event,

```javascript
ipcMain.handle('tasks:changeStatus', async (event,
```

* 变更任务状态

---

## ipcMain.handle('tasks:comment:add', async (event,

```javascript
ipcMain.handle('tasks:comment:add', async (event,
```

* 添加任务评论

---

## ipcMain.handle('tasks:comment:list', async (event,

```javascript
ipcMain.handle('tasks:comment:list', async (event,
```

* 获取任务评论列表

---

## ipcMain.handle('tasks:comment:delete', async (event,

```javascript
ipcMain.handle('tasks:comment:delete', async (event,
```

* 删除任务评论

---

## ipcMain.handle('tasks:board:create', async (event,

```javascript
ipcMain.handle('tasks:board:create', async (event,
```

* 创建任务看板

---

## ipcMain.handle('tasks:board:list', async (event,

```javascript
ipcMain.handle('tasks:board:list', async (event,
```

* 获取任务看板列表

---

## ipcMain.handle('tasks:board:update', async (event,

```javascript
ipcMain.handle('tasks:board:update', async (event,
```

* 更新任务看板

---

## ipcMain.handle('tasks:board:delete', async (event,

```javascript
ipcMain.handle('tasks:board:delete', async (event,
```

* 删除任务看板

---

## ipcMain.handle('tasks:board:get', async (event,

```javascript
ipcMain.handle('tasks:board:get', async (event,
```

* 获取任务看板详情

---

## ipcMain.handle('tasks:getHistory', async (event,

```javascript
ipcMain.handle('tasks:getHistory', async (event,
```

* 获取任务变更历史

---

