# plugin-manager

**Source**: `src/main/plugins/plugin-manager.js`

**Generated**: 2026-04-21T06:10:31.139Z

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

## async loadFirstPartyPlugins()

```javascript
async loadFirstPartyPlugins()
```

* 加载 first-party 内置插件
   *
   * 扫描多个目录，顺序：
   *   1. src/main/plugins-builtin/       — 应用内置默认（最低优先级）
   *   2. 注入的 mdmExtractDir（可选）     — MDM Profile 解包目录（最高优先级）
   *
   * 同 id 的插件后注册者胜出；但贡献本身由 priority 决定最终生效项，
   * 因此 Profile 里的高 priority 贡献会自动覆盖默认值。
   *
   * first-party 插件是受信代码，不走 DB / sandbox / permission 流程。

---

## setMDMExtractDir(dir)

```javascript
setMDMExtractDir(dir)
```

* 设置 MDM profile 解包目录；在 initialize() 之前调用才生效

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

## async handleUIPageExtension(context)

```javascript
async handleUIPageExtension(context)
```

* 处理UI页面扩展
   * @param {Object} context - 扩展上下文
   * @param {string} context.pluginId - 插件ID
   * @param {Object} context.config - 页面配置

---

## async handleUIMenuExtension(context)

```javascript
async handleUIMenuExtension(context)
```

* 处理UI菜单扩展
   * @param {Object} context - 扩展上下文
   * @param {string} context.pluginId - 插件ID
   * @param {Object} context.config - 菜单配置

---

## async handleUIComponentExtension(context)

```javascript
async handleUIComponentExtension(context)
```

* 处理UI组件扩展
   * @param {Object} context - 扩展上下文
   * @param {string} context.pluginId - 插件ID
   * @param {Object} context.config - 组件配置

---

## async handleUISpaceExtension(context)

```javascript
async handleUISpaceExtension(context)
```

* 处理 Space 扩展：注册个人空间模板
   * config: { id, name, icon, description, ragPreset, systemPrompt, contactsGroup, permissions }

---

## async handleUIArtifactExtension(context)

```javascript
async handleUIArtifactExtension(context)
```

* 处理 Artifact 扩展：注册 Artifact 类型与渲染器
   * config: { type, renderer, rendererPath, actions, icon, label }

---

## async handleUISlashExtension(context)

```javascript
async handleUISlashExtension(context)
```

* 处理 Slash 命令扩展：注册 / 命令
   * config: { trigger, handler, description, icon, requirePermissions }

---

## async handleUIMentionExtension(context)

```javascript
async handleUIMentionExtension(context)
```

* 处理 Mention 源扩展：注册 @ 自动补全源
   * config: { prefix, source, label, icon }

---

## async handleUIStatusBarExtension(context)

```javascript
async handleUIStatusBarExtension(context)
```

* 处理 StatusBar 小组件扩展
   * config: { id, component, componentPath, position, order, tooltip }

---

## async handleUIHomeWidgetExtension(context)

```javascript
async handleUIHomeWidgetExtension(context)
```

* 处理 HomeWidget 扩展：Today 页卡片
   * config: { id, component, componentPath, size, order, title }

---

## async handleUIComposerSlotExtension(context)

```javascript
async handleUIComposerSlotExtension(context)
```

* 处理 ComposerSlot 扩展：输入框行内槽
   * config: { id, component, componentPath, position, order }

---

## async handleBrandThemeExtension(context)

```javascript
async handleBrandThemeExtension(context)
```

* 处理 brand.theme 扩展：企业主题
   * config: { id, name, mode: "light"|"dark"|"auto", tokens: { ... }, priority }

---

## async handleBrandIdentityExtension(context)

```javascript
async handleBrandIdentityExtension(context)
```

* 处理 brand.identity 扩展：企业品牌标识
   * config: { id, productName, logo, splash, eula, links, priority }

---

## getRegisteredPages(pluginId = null)

```javascript
getRegisteredPages(pluginId = null)
```

* 获取所有注册的页面
   * @param {string} pluginId - 可选，按插件ID过滤
   * @returns {Array} 页面列表

---

## getRegisteredMenus(position = null, pluginId = null)

```javascript
getRegisteredMenus(position = null, pluginId = null)
```

* 获取所有注册的菜单
   * @param {string} position - 可选，按位置过滤 (sidebar/header/context)
   * @param {string} pluginId - 可选，按插件ID过滤
   * @returns {Array} 菜单列表

---

## getRegisteredComponents(slot = null, pluginId = null)

```javascript
getRegisteredComponents(slot = null, pluginId = null)
```

* 获取所有注册的组件
   * @param {string} slot - 可选，按插槽过滤
   * @param {string} pluginId - 可选，按插件ID过滤
   * @returns {Array} 组件列表

---

## getRegisteredBrandThemes(pluginId = null)

```javascript
getRegisteredBrandThemes(pluginId = null)
```

* 获取全部已注册的 brand.theme 贡献（按 priority 降序）

---

## getActiveBrandTheme()

```javascript
getActiveBrandTheme()
```

* 获取当前激活的 brand.theme（最高 priority；后续 Profile 会显式 pin）

---

## getRegisteredBrandIdentities(pluginId = null)

```javascript
getRegisteredBrandIdentities(pluginId = null)
```

* 获取全部已注册的 brand.identity 贡献（按 priority 降序）

---

## getActiveBrandIdentity()

```javascript
getActiveBrandIdentity()
```

* 获取当前激活的 brand.identity（最高 priority）

---

## getRegisteredLLMProviders(pluginId = null)

```javascript
getRegisteredLLMProviders(pluginId = null)
```

* P4 能力点 getters：按 priority 降序；空列表返回 null 的 active-getter

---

## unregisterPluginUI(pluginId)

```javascript
unregisterPluginUI(pluginId)
```

* 注销插件的所有UI扩展
   * @param {string} pluginId - 插件ID

---

## async handleAILLMProviderExtension(context)

```javascript
async handleAILLMProviderExtension(context)
```

* 处理 ai.llm-provider 扩展：LLM 推理后端
   * config: { id, name, models, endpoint, priority, capabilities }

---

## async handleAuthProviderExtension(context)

```javascript
async handleAuthProviderExtension(context)
```

* 处理 auth.provider 扩展：认证/单点登录提供方
   * config: { id, name, kind: "local"|"oidc"|"saml"|"ldap"|"did", endpoints, scopes, priority }

---

## async handleDataStorageExtension(context)

```javascript
async handleDataStorageExtension(context)
```

* 处理 data.storage 扩展：数据存储后端
   * config: { id, name, kind: "sqlite"|"postgres"|"ipfs"|"s3"|"custom", capabilities, priority }

---

## async handleDataCryptoExtension(context)

```javascript
async handleDataCryptoExtension(context)
```

* 处理 data.crypto 扩展：加密服务提供方
   * config: { id, name, algs, capabilities: { sign, encrypt, hash, pqc }, priority }

---

## async handleComplianceAuditExtension(context)

```javascript
async handleComplianceAuditExtension(context)
```

* 处理 compliance.audit 扩展：审计/合规输出端
   * config: { id, name, kind: "syslog"|"file"|"splunk"|"siem"|"custom", sinks, priority }

---

## async registerPluginExtensions(pluginId)

```javascript
async registerPluginExtensions(pluginId)
```

* 注册插件的扩展点
   * @param {string} pluginId - 插件ID

---

## async applyExtension(pluginId, point, config, priority = 100)

```javascript
async applyExtension(pluginId, point, config, priority = 100)
```

* 应用单个扩展：调用扩展点 handler 并将其记入 extensions 数组，
   * 以便 uiRegistry 同步更新，triggerExtensionPoint 可遍历执行。
   * @param {string} pluginId
   * @param {string} point - 扩展点名
   * @param {Object} config - 扩展配置
   * @param {number} priority

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

