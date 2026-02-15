# config-manager

**Source**: `src/main/database/config-manager.js`

**Generated**: 2026-02-15T07:37:13.840Z

---

## const

```javascript
const
```

* 数据库加密配置管理器

---

## isDevelopmentMode()

```javascript
isDevelopmentMode()
```

* 检查是否为开发模式

---

## loadConfig()

```javascript
loadConfig()
```

* 加载配置

---

## saveConfig()

```javascript
saveConfig()
```

* 保存配置

---

## get(key, defaultValue = null)

```javascript
get(key, defaultValue = null)
```

* 获取配置项

---

## set(key, value)

```javascript
set(key, value)
```

* 设置配置项

---

## setMultiple(values)

```javascript
setMultiple(values)
```

* 批量设置配置

---

## isFirstTimeSetup()

```javascript
isFirstTimeSetup()
```

* 是否已完成首次设置

---

## markFirstTimeSetupComplete()

```javascript
markFirstTimeSetupComplete()
```

* 标记首次设置已完成

---

## isEncryptionEnabled()

```javascript
isEncryptionEnabled()
```

* 是否启用加密

---

## setEncryptionEnabled(enabled)

```javascript
setEncryptionEnabled(enabled)
```

* 启用/禁用加密

---

## getEncryptionMethod()

```javascript
getEncryptionMethod()
```

* 获取加密方法

---

## setEncryptionMethod(method)

```javascript
setEncryptionMethod(method)
```

* 设置加密方法

---

## getAll()

```javascript
getAll()
```

* 获取所有配置

---

## getDevelopmentMode()

```javascript
getDevelopmentMode()
```

* 获取开发模式状态

---

## canSkipPassword()

```javascript
canSkipPassword()
```

* 是否可以跳过密码设置（仅开发模式）

---

## reset()

```javascript
reset()
```

* 重置配置

---

