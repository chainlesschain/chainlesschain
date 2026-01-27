# cowork-ipc

**Source**: `src\main\ai-engine\cowork\cowork-ipc.js`

**Generated**: 2026-01-27T06:44:03.887Z

---

## const

```javascript
const
```

* Cowork IPC 处理器
 *
 * 提供 Cowork 多代理协作系统的 IPC 接口。
 *
 * @module ai-engine/cowork/cowork-ipc

---

## function initializeCoworkComponents(dependencies)

```javascript
function initializeCoworkComponents(dependencies)
```

* 初始化 Cowork 组件
 * @param {Object} dependencies - 依赖对象
 * @private

---

## function registerCoworkIPC(dependencies =

```javascript
function registerCoworkIPC(dependencies =
```

* 注册 Cowork IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.mainWindow - 主窗口

---

## ipcMain.handle('cowork:create-team', async (event,

```javascript
ipcMain.handle('cowork:create-team', async (event,
```

* 创建团队

---

## ipcMain.handle('cowork:discover-teams', async (event,

```javascript
ipcMain.handle('cowork:discover-teams', async (event,
```

* 发现团队

---

## ipcMain.handle('cowork:request-join', async (event,

```javascript
ipcMain.handle('cowork:request-join', async (event,
```

* 请求加入团队

---

## ipcMain.handle('cowork:assign-task', async (event,

```javascript
ipcMain.handle('cowork:assign-task', async (event,
```

* 分配任务

---

## ipcMain.handle('cowork:broadcast-message', async (event,

```javascript
ipcMain.handle('cowork:broadcast-message', async (event,
```

* 广播消息

---

## ipcMain.handle('cowork:send-message', async (event,

```javascript
ipcMain.handle('cowork:send-message', async (event,
```

* 发送消息

---

## ipcMain.handle('cowork:vote-on-decision', async (event,

```javascript
ipcMain.handle('cowork:vote-on-decision', async (event,
```

* 投票决策

---

## ipcMain.handle('cowork:get-team-status', async (event,

```javascript
ipcMain.handle('cowork:get-team-status', async (event,
```

* 获取团队状态

---

## ipcMain.handle('cowork:terminate-agent', async (event,

```javascript
ipcMain.handle('cowork:terminate-agent', async (event,
```

* 终止代理

---

## ipcMain.handle('cowork:merge-results', async (event,

```javascript
ipcMain.handle('cowork:merge-results', async (event,
```

* 合并结果

---

## ipcMain.handle('cowork:create-checkpoint', async (event,

```javascript
ipcMain.handle('cowork:create-checkpoint', async (event,
```

* 创建检查点

---

## ipcMain.handle('cowork:list-members', async (event,

```javascript
ipcMain.handle('cowork:list-members', async (event,
```

* 列出团队成员

---

## ipcMain.handle('cowork:update-team-config', async (event,

```javascript
ipcMain.handle('cowork:update-team-config', async (event,
```

* 更新团队配置

---

## ipcMain.handle('cowork:destroy-team', async (event,

```javascript
ipcMain.handle('cowork:destroy-team', async (event,
```

* 销毁团队

---

## ipcMain.handle('cowork:get-stats', async (event) =>

```javascript
ipcMain.handle('cowork:get-stats', async (event) =>
```

* 获取统计信息

---

## ipcMain.handle('cowork:request-file-access', async (event,

```javascript
ipcMain.handle('cowork:request-file-access', async (event,
```

* 请求文件访问权限

---

## ipcMain.handle('cowork:grant-file-access', async (event,

```javascript
ipcMain.handle('cowork:grant-file-access', async (event,
```

* 授予文件访问权限

---

## ipcMain.handle('cowork:revoke-file-access', async (event,

```javascript
ipcMain.handle('cowork:revoke-file-access', async (event,
```

* 撤销文件访问权限

---

## ipcMain.handle('cowork:validate-file-access', async (event,

```javascript
ipcMain.handle('cowork:validate-file-access', async (event,
```

* 验证文件访问

---

## ipcMain.handle('cowork:read-file', async (event,

```javascript
ipcMain.handle('cowork:read-file', async (event,
```

* 读取文件

---

## ipcMain.handle('cowork:write-file', async (event,

```javascript
ipcMain.handle('cowork:write-file', async (event,
```

* 写入文件

---

## ipcMain.handle('cowork:delete-file', async (event,

```javascript
ipcMain.handle('cowork:delete-file', async (event,
```

* 删除文件

---

## ipcMain.handle('cowork:list-directory', async (event,

```javascript
ipcMain.handle('cowork:list-directory', async (event,
```

* 列出目录

---

## ipcMain.handle('cowork:get-allowed-paths', async (event,

```javascript
ipcMain.handle('cowork:get-allowed-paths', async (event,
```

* 获取允许的路径

---

## ipcMain.handle('cowork:get-audit-log', async (event,

```javascript
ipcMain.handle('cowork:get-audit-log', async (event,
```

* 获取审计日志

---

## ipcMain.handle('cowork:get-sandbox-stats', async (event) =>

```javascript
ipcMain.handle('cowork:get-sandbox-stats', async (event) =>
```

* 获取沙箱统计

---

## ipcMain.handle('cowork:create-long-task', async (event,

```javascript
ipcMain.handle('cowork:create-long-task', async (event,
```

* 创建长时运行任务

---

## ipcMain.handle('cowork:start-task', async (event,

```javascript
ipcMain.handle('cowork:start-task', async (event,
```

* 启动任务

---

## ipcMain.handle('cowork:pause-task', async (event,

```javascript
ipcMain.handle('cowork:pause-task', async (event,
```

* 暂停任务

---

## ipcMain.handle('cowork:resume-task', async (event,

```javascript
ipcMain.handle('cowork:resume-task', async (event,
```

* 继续任务

---

## ipcMain.handle('cowork:cancel-task', async (event,

```javascript
ipcMain.handle('cowork:cancel-task', async (event,
```

* 取消任务

---

## ipcMain.handle('cowork:get-task-status', async (event,

```javascript
ipcMain.handle('cowork:get-task-status', async (event,
```

* 获取任务状态

---

## ipcMain.handle('cowork:get-active-tasks', async (event) =>

```javascript
ipcMain.handle('cowork:get-active-tasks', async (event) =>
```

* 获取所有活跃任务

---

## ipcMain.handle('cowork:restore-from-checkpoint', async (event,

```javascript
ipcMain.handle('cowork:restore-from-checkpoint', async (event,
```

* 从检查点恢复

---

## ipcMain.handle('cowork:get-task-manager-stats', async (event) =>

```javascript
ipcMain.handle('cowork:get-task-manager-stats', async (event) =>
```

* 获取任务管理器统计

---

## ipcMain.handle('cowork:execute-skill', async (event,

```javascript
ipcMain.handle('cowork:execute-skill', async (event,
```

* 执行技能

---

## ipcMain.handle('cowork:auto-execute-task', async (event,

```javascript
ipcMain.handle('cowork:auto-execute-task', async (event,
```

* 自动执行任务（选择最佳技能）

---

## ipcMain.handle('cowork:find-skills-for-task', async (event,

```javascript
ipcMain.handle('cowork:find-skills-for-task', async (event,
```

* 查找适合任务的技能

---

## ipcMain.handle('cowork:get-all-skills', async (event) =>

```javascript
ipcMain.handle('cowork:get-all-skills', async (event) =>
```

* 获取所有技能

---

## ipcMain.handle('cowork:get-skill-stats', async (event) =>

```javascript
ipcMain.handle('cowork:get-skill-stats', async (event) =>
```

* 获取技能统计

---

## ipcMain.handle('cowork:get-analytics', async (event, data) =>

```javascript
ipcMain.handle('cowork:get-analytics', async (event, data) =>
```

* 获取分析数据

---

