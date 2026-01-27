# settings-manager

**Source**: `src\main\config\settings-manager.js`

**Generated**: 2026-01-27T06:44:03.867Z

---

## const

```javascript
const
```

* 应用设置管理器
 * 统一管理应用配置和用户偏好设置

---

## getDefaultSettings()

```javascript
getDefaultSettings()
```

* 获取默认设置

---

## loadSettings()

```javascript
loadSettings()
```

* 加载设置

---

## saveSettings()

```javascript
saveSettings()
```

* 保存设置

---

## mergeSettings(defaults, loaded)

```javascript
mergeSettings(defaults, loaded)
```

* 合并设置

---

## get(key, defaultValue = undefined)

```javascript
get(key, defaultValue = undefined)
```

* 获取设置值

---

## set(key, value)

```javascript
set(key, value)
```

* 设置值

---

## delete(key)

```javascript
delete(key)
```

* 删除设置

---

## has(key)

```javascript
has(key)
```

* 检查设置是否存在

---

## getAll()

```javascript
getAll()
```

* 获取所有设置

---

## setMultiple(settings)

```javascript
setMultiple(settings)
```

* 批量设置

---

## reset()

```javascript
reset()
```

* 重置为默认设置

---

## resetCategory(category)

```javascript
resetCategory(category)
```

* 重置特定分类

---

## watch(key, callback)

```javascript
watch(key, callback)
```

* 监听设置变化

---

## notifyWatchers(key, newValue, oldValue)

```javascript
notifyWatchers(key, newValue, oldValue)
```

* 通知监听器

---

## watchSettingsFile()

```javascript
watchSettingsFile()
```

* 监听设置文件变化

---

## export(outputPath)

```javascript
export(outputPath)
```

* 导出设置

---

## import(inputPath)

```javascript
import(inputPath)
```

* 导入设置

---

## validate()

```javascript
validate()
```

* 验证设置

---

## getSummary()

```javascript
getSummary()
```

* 获取设置摘要

---

