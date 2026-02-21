# ui-extension-manager

**Source**: `src/main/plugins/ui-extension-manager.js`

**Generated**: 2026-02-21T22:04:25.800Z

---

## const

```javascript
const
```

* UIExtensionManager - UI扩展点管理器
 *
 * 职责：
 * - 管理插件的UI扩展点（页面、菜单、组件）
 * - 维护扩展点注册表
 * - 提供扩展点查询接口

---

## registerPage(pluginId, pageConfig)

```javascript
registerPage(pluginId, pageConfig)
```

* 注册页面扩展
   * @param {string} pluginId - 插件ID
   * @param {Object} pageConfig - 页面配置
   * @returns {string} 页面扩展ID

---

## registerMenu(pluginId, menuConfig)

```javascript
registerMenu(pluginId, menuConfig)
```

* 注册菜单扩展
   * @param {string} pluginId - 插件ID
   * @param {Object} menuConfig - 菜单配置
   * @returns {string} 菜单扩展ID

---

## registerComponent(pluginId, componentConfig)

```javascript
registerComponent(pluginId, componentConfig)
```

* 注册组件扩展
   * @param {string} pluginId - 插件ID
   * @param {Object} componentConfig - 组件配置
   * @returns {string} 组件扩展ID

---

## getPageExtensions()

```javascript
getPageExtensions()
```

* 获取所有页面扩展
   * @returns {Array} 页面扩展列表

---

## getMenuExtensions(parent = null)

```javascript
getMenuExtensions(parent = null)
```

* 获取所有菜单扩展
   * @param {string} parent - 父菜单ID（可选，用于获取子菜单）
   * @returns {Array} 菜单扩展列表

---

## getComponentExtensions(slotName)

```javascript
getComponentExtensions(slotName)
```

* 获取指定插槽的组件扩展
   * @param {string} slotName - 插槽名称
   * @returns {Array} 组件扩展列表

---

## getAvailableSlots()

```javascript
getAvailableSlots()
```

* 获取所有可用的插槽
   * @returns {Array} 插槽名称列表

---

## unregisterPlugin(pluginId)

```javascript
unregisterPlugin(pluginId)
```

* 注销插件的所有扩展
   * @param {string} pluginId - 插件ID

---

## getPluginExtensions(pluginId)

```javascript
getPluginExtensions(pluginId)
```

* 获取插件的所有扩展
   * @param {string} pluginId - 插件ID
   * @returns {Object} 扩展列表 { pages, menus, components }

---

## isPagePathOccupied(pagePath)

```javascript
isPagePathOccupied(pagePath)
```

* 检查页面路径是否已被占用
   * @param {string} pagePath - 页面路径
   * @returns {boolean}

---

## generateRoutes()

```javascript
generateRoutes()
```

* 生成Vue Router路由配置
   * @returns {Array} 路由配置数组

---

## generateMenuConfig()

```javascript
generateMenuConfig()
```

* 生成侧边栏菜单配置
   * @returns {Array} 菜单配置数组

---

## clear()

```javascript
clear()
```

* 清空所有扩展

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object}

---

## _addToPluginExtensions(pluginId, type, extensionId)

```javascript
_addToPluginExtensions(pluginId, type, extensionId)
```

* 添加扩展到插件映射
   * @private

---

## function getUIExtensionManager()

```javascript
function getUIExtensionManager()
```

* 获取UIExtensionManager单例
 * @returns {UIExtensionManager}

---

