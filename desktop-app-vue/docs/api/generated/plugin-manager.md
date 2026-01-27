# plugin-manager

**Source**: `src\main\plugins\plugin-manager.js`

**Generated**: 2026-01-27T06:44:03.829Z

---

## const

```javascript
const
```

* PluginManager - 插件管理器（核心协调器）
 *
 * 职责：
 * - 插件生命周期管理（安装、加载、启用、禁用、卸载）
 * - 扩展点管理
 * - 插件间依赖解析
 * - 事件协调

---

## setSystemContext(context)

```javascript
setSystemContext(context)
```

* 设置系统上下文（在initialize之前调用）
   * @param {Object} context - 系统服务上下文

---

## async initialize()

```javascript
async initialize()
```

* 初始化插件管理器

---

## registerBuiltInExtensionPoints()

```javascript
registerBuiltInExtensionPoints()
```

* 注册内置扩展点

---

## registerExtensionPoint(name, handler)

```javascript
registerExtensionPoint(name, handler)
```

* 注册扩展点
   * @param {string} name - 扩展点名称
   * @param {Function} handler - 处理函数

---

## async installPlugin(source, options =

```javascript
async installPlugin(source, options =
```

* 安装插件
   * @param {string} source - 插件来源
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 安装结果

---

## checkCompatibility(manifest)

```javascript
checkCompatibility(manifest)
```

* 检查兼容性
   * @param {Object} manifest - 插件manifest

---

## _getCurrentVersion()

```javascript
_getCurrentVersion()
```

* 获取当前应用版本
   * @private

---

## async resolveDependencies(manifest)

```javascript
async resolveDependencies(manifest)
```

* 解析依赖
   * @param {Object} manifest - 插件manifest

---

## async requestPermissions(manifest)

```javascript
async requestPermissions(manifest)
```

* 请求权限授权
   * @param {Object} manifest - 插件manifest
   * @returns {Promise<boolean>} 是否授予

---

## async loadPlugin(pluginId)

```javascript
async loadPlugin(pluginId)
```

* 加载插件（Phase 2实现 - 使用沙箱）
   * @param {string} pluginId - 插件ID

---

## async enablePlugin(pluginId)

```javascript
async enablePlugin(pluginId)
```

* 启用插件
   * @param {string} pluginId - 插件ID

---

## async disablePlugin(pluginId)

```javascript
async disablePlugin(pluginId)
```

* 禁用插件
   * @param {string} pluginId - 插件ID

---

## async uninstallPlugin(pluginId)

```javascript
async uninstallPlugin(pluginId)
```

* 卸载插件
   * @param {string} pluginId - 插件ID

---

## getPlugins(filters =

```javascript
getPlugins(filters =
```

* 获取所有插件
   * @param {Object} filters - 过滤条件
   * @returns {Array} 插件列表

---

## getPlugin(pluginId)

```javascript
getPlugin(pluginId)
```

* 获取单个插件信息
   * @param {string} pluginId - 插件ID
   * @returns {Object|null} 插件信息

---

## async triggerExtensionPoint(name, context =

```javascript
async triggerExtensionPoint(name, context =
```

* 触发扩展点
   * @param {string} name - 扩展点名称
   * @param {Object} context - 上下文
   * @returns {Promise<Array>} 扩展点执行结果

---

## async registerPluginExtensions(pluginId)

```javascript
async registerPluginExtensions(pluginId)
```

* 注册插件的扩展点
   * @param {string} pluginId - 插件ID

---

## async unregisterPluginExtensions(pluginId)

```javascript
async unregisterPluginExtensions(pluginId)
```

* 注销插件的扩展点
   * @param {string} pluginId - 插件ID

---

## getPluginPermissions(pluginId)

```javascript
getPluginPermissions(pluginId)
```

* 获取插件已授予的权限
   * @param {string} pluginId
   * @returns {Array}

---

## async updatePluginPermission(pluginId, permission, granted)

```javascript
async updatePluginPermission(pluginId, permission, granted)
```

* 更新插件权限
   * @param {string} pluginId
   * @param {string} permission
   * @param {boolean} granted

---

## getPluginsDirectory()

```javascript
getPluginsDirectory()
```

* 获取插件目录
   * @returns {string}

---

## function getPluginManager(database, config)

```javascript
function getPluginManager(database, config)
```

* 获取PluginManager单例
 * @param {Object} database - 数据库实例
 * @param {Object} config - 配置
 * @returns {PluginManager}

---

## function setPluginManager(manager)

```javascript
function setPluginManager(manager)
```

* 设置PluginManager单例
 * @param {PluginManager} manager - PluginManager实例

---

