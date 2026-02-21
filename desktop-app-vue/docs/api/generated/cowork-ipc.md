# cowork-ipc

**Source**: `src/main/ai-engine/cowork/cowork-ipc.js`

**Generated**: 2026-02-21T22:45:05.335Z

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

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 创建团队

---

## ipcMain.handle("cowork:discover-teams", async (event,

```javascript
ipcMain.handle("cowork:discover-teams", async (event,
```

* 发现团队

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 请求加入团队

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 分配任务

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 广播消息

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 发送消息

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 投票决策

---

## ipcMain.handle("cowork:get-team-status", async (event,

```javascript
ipcMain.handle("cowork:get-team-status", async (event,
```

* 获取团队状态

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 终止代理

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 合并结果

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 创建检查点

---

## ipcMain.handle("cowork:list-members", async (event,

```javascript
ipcMain.handle("cowork:list-members", async (event,
```

* 列出团队成员

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新团队配置

---

## ipcMain.handle("cowork:destroy-team", async (event,

```javascript
ipcMain.handle("cowork:destroy-team", async (event,
```

* 销毁团队

---

## ipcMain.handle("cowork:pause-team", async (event,

```javascript
ipcMain.handle("cowork:pause-team", async (event,
```

* 暂停团队

---

## ipcMain.handle("cowork:resume-team", async (event,

```javascript
ipcMain.handle("cowork:resume-team", async (event,
```

* 恢复团队

---

## ipcMain.handle("cowork:get-stats", async (event) =>

```javascript
ipcMain.handle("cowork:get-stats", async (event) =>
```

* 获取统计信息

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 请求文件访问权限

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 授予文件访问权限

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 撤销文件访问权限

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 验证文件访问

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 读取文件

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 写入文件

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 删除文件

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 列出目录

---

## ipcMain.handle("cowork:get-allowed-paths", async (event,

```javascript
ipcMain.handle("cowork:get-allowed-paths", async (event,
```

* 获取允许的路径

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取审计日志

---

## ipcMain.handle("cowork:get-sandbox-stats", async (event) =>

```javascript
ipcMain.handle("cowork:get-sandbox-stats", async (event) =>
```

* 获取沙箱统计

---

## ipcMain.handle("cowork:create-long-task", async (event,

```javascript
ipcMain.handle("cowork:create-long-task", async (event,
```

* 创建长时运行任务

---

## ipcMain.handle("cowork:start-task", async (event,

```javascript
ipcMain.handle("cowork:start-task", async (event,
```

* 启动任务

---

## ipcMain.handle("cowork:pause-task", async (event,

```javascript
ipcMain.handle("cowork:pause-task", async (event,
```

* 暂停任务

---

## ipcMain.handle("cowork:resume-task", async (event,

```javascript
ipcMain.handle("cowork:resume-task", async (event,
```

* 继续任务

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 取消任务

---

## ipcMain.handle("cowork:get-task-status", async (event,

```javascript
ipcMain.handle("cowork:get-task-status", async (event,
```

* 获取任务状态

---

## ipcMain.handle("cowork:get-active-tasks", async (event) =>

```javascript
ipcMain.handle("cowork:get-active-tasks", async (event) =>
```

* 获取所有活跃任务

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 从检查点恢复

---

## ipcMain.handle("cowork:get-task-manager-stats", async (event) =>

```javascript
ipcMain.handle("cowork:get-task-manager-stats", async (event) =>
```

* 获取任务管理器统计

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 执行技能

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 自动执行任务（选择最佳技能）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 查找适合任务的技能

---

## ipcMain.handle("cowork:get-all-skills", async (event) =>

```javascript
ipcMain.handle("cowork:get-all-skills", async (event) =>
```

* 获取所有技能

---

## ipcMain.handle("cowork:get-skill-stats", async (event) =>

```javascript
ipcMain.handle("cowork:get-skill-stats", async (event) =>
```

* 获取技能统计

---

## ipcMain.handle("cowork:get-skill-sources", async (event) =>

```javascript
ipcMain.handle("cowork:get-skill-sources", async (event) =>
```

* 获取三层目录信息

---

## ipcMain.handle("cowork:reload-skills", async (event) =>

```javascript
ipcMain.handle("cowork:reload-skills", async (event) =>
```

* 重新加载全部技能

---

## ipcMain.handle("cowork:get-invocable-skills", async (event) =>

```javascript
ipcMain.handle("cowork:get-invocable-skills", async (event) =>
```

* 获取用户可调用技能

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 检查技能门控要求

---

## ipcMain.handle("cowork:get-skill-definition", async (event,

```javascript
ipcMain.handle("cowork:get-skill-definition", async (event,
```

* 获取技能原始定义

---

## ipcMain.handle("cowork:get-analytics", async (event, data) =>

```javascript
ipcMain.handle("cowork:get-analytics", async (event, data) =>
```

* 获取分析数据

---

