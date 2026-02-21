# plugin-lazy-ipc

**Source**: `src/main/plugins/plugin-lazy-ipc.js`

**Generated**: 2026-02-21T20:04:16.222Z

---

## const

```javascript
const
```

* 插件系统懒加载 IPC 包装器
 * 在首次访问时才初始化插件系统，节省启动时间 2-3 秒

---

## async function ensurePluginInitialized(app)

```javascript
async function ensurePluginInitialized(app)
```

* 确保插件系统已初始化
 * @param {Object} app - 应用实例
 * @returns {Promise<void>}

---

## function registerLazyPluginIPC(

```javascript
function registerLazyPluginIPC(
```

* 注册懒加载的插件 IPC 处理器
 * @param {Object} options
 * @param {Object} options.app - 应用实例
 * @param {Object} options.mainWindow - 主窗口实例

---

