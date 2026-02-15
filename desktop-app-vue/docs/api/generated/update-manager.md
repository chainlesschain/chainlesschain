# update-manager

**Source**: `src/main/plugins/update-manager.js`

**Generated**: 2026-02-15T10:10:53.390Z

---

## const

```javascript
const
```

* 插件更新管理器
 *
 * 负责检查、下载和安装插件更新
 * 支持自动更新和手动更新

---

## startAutoCheck()

```javascript
startAutoCheck()
```

* 启动自动检查

---

## stopAutoCheck()

```javascript
stopAutoCheck()
```

* 停止自动检查

---

## async checkForUpdates(force = false)

```javascript
async checkForUpdates(force = false)
```

* 检查所有插件的更新

---

## async autoInstallUpdates()

```javascript
async autoInstallUpdates()
```

* 自动安装更新

---

## async updatePlugin(pluginId, version = "latest")

```javascript
async updatePlugin(pluginId, version = "latest")
```

* 更新单个插件

---

## async updateMultiplePlugins(pluginIds)

```javascript
async updateMultiplePlugins(pluginIds)
```

* 批量更新插件

---

## async updateAllPlugins()

```javascript
async updateAllPlugins()
```

* 更新所有插件

---

## getAvailableUpdates()

```javascript
getAvailableUpdates()
```

* 获取可用更新列表

---

## hasUpdate(pluginId)

```javascript
hasUpdate(pluginId)
```

* 检查特定插件是否有更新

---

## getUpdateInfo(pluginId)

```javascript
getUpdateInfo(pluginId)
```

* 获取特定插件的更新信息

---

## compareVersions(v1, v2)

```javascript
compareVersions(v1, v2)
```

* 比较版本号

---

## setAutoCheck(enabled)

```javascript
setAutoCheck(enabled)
```

* 设置自动检查

---

## setAutoUpdate(enabled)

```javascript
setAutoUpdate(enabled)
```

* 设置自动更新

---

## getUpdateStats()

```javascript
getUpdateStats()
```

* 获取更新统计

---

## destroy()

```javascript
destroy()
```

* 清理

---

