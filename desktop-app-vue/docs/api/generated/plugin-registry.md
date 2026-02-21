# plugin-registry

**Source**: `src/main/plugins/plugin-registry.js`

**Generated**: 2026-02-21T20:04:16.222Z

---

## class PluginRegistry

```javascript
class PluginRegistry
```

* PluginRegistry - 插件注册表
 *
 * 职责：
 * - 管理插件的元数据
 * - 与数据库交互
 * - 提供插件查询和管理接口

---

## async initialize()

```javascript
async initialize()
```

* 初始化插件注册表
   * 创建必要的数据库表

---

## async register(manifest, installedPath)

```javascript
async register(manifest, installedPath)
```

* 注册插件
   * @param {Object} manifest - 插件manifest
   * @param {string} installedPath - 安装路径
   * @returns {Object} 注册的插件信息

---

## async registerPermissions(pluginId, permissions)

```javascript
async registerPermissions(pluginId, permissions)
```

* 注册插件权限

---

## async registerDependencies(pluginId, dependencies)

```javascript
async registerDependencies(pluginId, dependencies)
```

* 注册插件依赖

---

## getPlugin(pluginId)

```javascript
getPlugin(pluginId)
```

* 获取插件信息
   * @param {string} pluginId - 插件ID
   * @returns {Object|null} 插件信息

---

## getInstalledPlugins(filters =

```javascript
getInstalledPlugins(filters =
```

* 获取所有已安装的插件
   * @param {Object} filters - 过滤条件
   * @returns {Array} 插件列表

---

## async updatePluginState(pluginId, state)

```javascript
async updatePluginState(pluginId, state)
```

* 更新插件状态
   * @param {string} pluginId - 插件ID
   * @param {string} state - 新状态

---

## async updateEnabled(pluginId, enabled)

```javascript
async updateEnabled(pluginId, enabled)
```

* 更新启用状态
   * @param {string} pluginId - 插件ID
   * @param {boolean} enabled - 是否启用

---

## async unregister(pluginId)

```javascript
async unregister(pluginId)
```

* 注销插件
   * @param {string} pluginId - 插件ID

---

## async recordError(pluginId, error)

```javascript
async recordError(pluginId, error)
```

* 记录错误
   * @param {string} pluginId - 插件ID
   * @param {Error} error - 错误对象

---

## async logEvent(pluginId, eventType, eventData =

```javascript
async logEvent(pluginId, eventType, eventData =
```

* 记录事件日志
   * @param {string} pluginId - 插件ID
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   * @param {string} level - 日志级别

---

## getPluginPermissions(pluginId)

```javascript
getPluginPermissions(pluginId)
```

* 获取插件的权限
   * @param {string} pluginId - 插件ID
   * @returns {Array} 权限列表

---

## async updatePermission(pluginId, permission, granted)

```javascript
async updatePermission(pluginId, permission, granted)
```

* 更新权限授予状态
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @param {boolean} granted - 是否授予

---

## getPluginExtensions(pluginId)

```javascript
getPluginExtensions(pluginId)
```

* 获取插件的扩展点
   * @param {string} pluginId - 插件ID
   * @returns {Array} 扩展点列表

---

## async registerExtension(pluginId, extensionPoint, config, priority = 100)

```javascript
async registerExtension(pluginId, extensionPoint, config, priority = 100)
```

* 注册扩展点
   * @param {string} pluginId - 插件ID
   * @param {string} extensionPoint - 扩展点名称
   * @param {Object} config - 配置
   * @param {number} priority - 优先级

---

## async unregisterExtensions(pluginId)

```javascript
async unregisterExtensions(pluginId)
```

* 注销扩展点
   * @param {string} pluginId - 插件ID

---

## getExtensionsByPoint(extensionPoint)

```javascript
getExtensionsByPoint(extensionPoint)
```

* 获取指定扩展点的所有扩展
   * @param {string} extensionPoint - 扩展点名称
   * @returns {Array} 扩展列表

---

## async cleanupLogs()

```javascript
async cleanupLogs()
```

* 清理旧的日志（保留最近30天）

---

