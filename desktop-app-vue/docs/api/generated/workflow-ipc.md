# workflow-ipc

**Source**: `src\main\workflow\workflow-ipc.js`

**Generated**: 2026-01-27T06:44:03.776Z

---

## const

```javascript
const
```

* 工作流 IPC 通信
 *
 * 处理渲染进程与工作流管理器之间的通信
 *
 * IPC 通道:
 * - workflow:create - 创建工作流
 * - workflow:start - 启动工作流
 * - workflow:pause - 暂停工作流
 * - workflow:resume - 恢复工作流
 * - workflow:cancel - 取消工作流
 * - workflow:retry - 重试失败阶段
 * - workflow:get-status - 获取工作流状态
 * - workflow:get-stages - 获取阶段列表
 * - workflow:get-logs - 获取执行日志
 * - workflow:get-gates - 获取门禁状态
 * - workflow:override-gate - 手动通过门禁
 * - workflow:get-all - 获取所有工作流
 * - workflow:delete - 删除工作流
 *
 * v0.27.0: 新建文件

---

## class WorkflowIPC

```javascript
class WorkflowIPC
```

* 工作流 IPC 处理器类

---

## _setupIPCHandlers()

```javascript
_setupIPCHandlers()
```

* 设置 IPC 处理器
   * @private

---

## _setupEventForwarding()

```javascript
_setupEventForwarding()
```

* 设置事件转发
   * @private

---

## broadcast(channel, data)

```javascript
broadcast(channel, data)
```

* 广播到所有窗口
   * @param {string} channel - 通道名
   * @param {any} data - 数据

---

## dispose()

```javascript
dispose()
```

* 注销所有处理器

---

## function registerWorkflowIPC(dependencies)

```javascript
function registerWorkflowIPC(dependencies)
```

* 注册工作流 IPC
 * @param {Object} dependencies - 依赖项
 * @returns {WorkflowIPC} IPC 实例

---

