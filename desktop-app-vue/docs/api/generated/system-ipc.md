# system-ipc

**Source**: `src/main/system/system-ipc.js`

**Generated**: 2026-02-15T08:42:37.177Z

---

## const

```javascript
const
```

* 系统窗口控制 IPC 处理器
 * 负责处理窗口最大化、最小化、关闭等系统级操作
 *
 * @module system-ipc
 * @description 提供系统窗口控制的 IPC 接口

---

## function registerSystemIPC(

```javascript
function registerSystemIPC(
```

* 注册所有系统 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.mainWindow - 主窗口实例

---

## registerHandler("system:maximize", async () =>

```javascript
registerHandler("system:maximize", async () =>
```

* 最大化窗口
   * Channel: 'system:maximize'

---

## registerHandler("system:minimize", async () =>

```javascript
registerHandler("system:minimize", async () =>
```

* 最小化窗口
   * Channel: 'system:minimize'

---

## registerHandler("system:close", async () =>

```javascript
registerHandler("system:close", async () =>
```

* 关闭窗口
   * Channel: 'system:close'

---

## registerHandler("system:restart", async () =>

```javascript
registerHandler("system:restart", async () =>
```

* 重启应用
   * Channel: 'system:restart'

---

## registerHandler("system:get-window-state", async () =>

```javascript
registerHandler("system:get-window-state", async () =>
```

* 获取窗口状态
   * Channel: 'system:get-window-state'

---

## registerHandler("system:set-always-on-top", async (_event, flag) =>

```javascript
registerHandler("system:set-always-on-top", async (_event, flag) =>
```

* 设置窗口总在最前
   * Channel: 'system:set-always-on-top'

---

## registerHandler("system:get-system-info", async () =>

```javascript
registerHandler("system:get-system-info", async () =>
```

* 获取系统信息
   * Channel: 'system:get-system-info'

---

## registerHandler("system:get-app-info", async () =>

```javascript
registerHandler("system:get-app-info", async () =>
```

* 获取应用信息
   * Channel: 'system:get-app-info'

---

## registerHandler("system:get-platform", async () =>

```javascript
registerHandler("system:get-platform", async () =>
```

* 获取平台信息
   * Channel: 'system:get-platform'

---

## registerHandler("system:get-version", async () =>

```javascript
registerHandler("system:get-version", async () =>
```

* 获取版本信息
   * Channel: 'system:get-version'

---

## registerHandler("system:get-path", async (_event, name) =>

```javascript
registerHandler("system:get-path", async (_event, name) =>
```

* 获取路径
   * Channel: 'system:get-path'

---

## registerHandler("system:open-external", async (_event, url) =>

```javascript
registerHandler("system:open-external", async (_event, url) =>
```

* 打开外部链接
   * Channel: 'system:open-external'

---

## registerHandler("system:show-item-in-folder", async (_event, path) =>

```javascript
registerHandler("system:show-item-in-folder", async (_event, path) =>
```

* 在文件夹中显示文件
   * Channel: 'system:show-item-in-folder'

---

## registerHandler("system:select-directory", async () =>

```javascript
registerHandler("system:select-directory", async () =>
```

* 选择目录
   * Channel: 'system:select-directory'

---

## registerHandler("system:select-file", async (_event, options =

```javascript
registerHandler("system:select-file", async (_event, options =
```

* 选择文件
   * Channel: 'system:select-file'

---

## registerHandler("system:quit", async () =>

```javascript
registerHandler("system:quit", async () =>
```

* 退出应用
   * Channel: 'system:quit'

---

## registerHandler("dialog:select-folder", async (_event, options =

```javascript
registerHandler("dialog:select-folder", async (_event, options =
```

* 选择文件夹（通用对话框）
   * Channel: 'dialog:select-folder'

---

## registerHandler("dialog:showOpenDialog", async (_event, options =

```javascript
registerHandler("dialog:showOpenDialog", async (_event, options =
```

* 显示打开文件对话框
   * Channel: 'dialog:showOpenDialog'

---

## registerHandler("dialog:showSaveDialog", async (_event, options =

```javascript
registerHandler("dialog:showSaveDialog", async (_event, options =
```

* 显示保存文件对话框
   * Channel: 'dialog:showSaveDialog'

---

## registerHandler("dialog:showMessageBox", async (_event, options =

```javascript
registerHandler("dialog:showMessageBox", async (_event, options =
```

* 显示消息框
   * Channel: 'dialog:showMessageBox'

---

