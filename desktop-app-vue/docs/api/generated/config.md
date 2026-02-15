# config

**Source**: `src/main/ukey/config.js`

**Generated**: 2026-02-15T07:37:13.766Z

---

## const

```javascript
const
```

* U盾配置管理
 *
 * 负责读取、保存和管理U盾配置

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## class UKeyConfig

```javascript
class UKeyConfig
```

* U盾配置管理器

---

## getConfigPath()

```javascript
getConfigPath()
```

* 获取配置文件路径

---

## load()

```javascript
load()
```

* 加载配置

---

## save()

```javascript
save()
```

* 保存配置

---

## get(key, defaultValue = null)

```javascript
get(key, defaultValue = null)
```

* 获取配置项
   * @param {string} key - 配置键
   * @param {*} defaultValue - 默认值

---

## set(key, value)

```javascript
set(key, value)
```

* 设置配置项
   * @param {string} key - 配置键
   * @param {*} value - 配置值

---

## getAll()

```javascript
getAll()
```

* 获取全部配置

---

## reset()

```javascript
reset()
```

* 重置为默认配置

---

## getDriverType()

```javascript
getDriverType()
```

* 获取驱动类型

---

## setDriverType(driverType)

```javascript
setDriverType(driverType)
```

* 设置驱动类型

---

## getDriverOptions(driverType)

```javascript
getDriverOptions(driverType)
```

* 获取驱动特定选项

---

## setDriverOptions(driverType, options)

```javascript
setDriverOptions(driverType, options)
```

* 设置驱动特定选项

---

## isAutoLockEnabled()

```javascript
isAutoLockEnabled()
```

* 是否启用自动锁定

---

## getAutoLockTimeout()

```javascript
getAutoLockTimeout()
```

* 获取自动锁定超时（秒）

---

## setAutoLock(enabled, timeout = null)

```javascript
setAutoLock(enabled, timeout = null)
```

* 设置自动锁定

---

## isDebugEnabled()

```javascript
isDebugEnabled()
```

* 是否启用调试模式

---

## setDebug(enabled)

```javascript
setDebug(enabled)
```

* 设置调试模式

---

## isSimulationMode()

```javascript
isSimulationMode()
```

* 是否使用模拟模式

---

## setSimulationMode(enabled)

```javascript
setSimulationMode(enabled)
```

* 设置模拟模式

---

## getMonitorInterval()

```javascript
getMonitorInterval()
```

* 获取监听间隔

---

## setMonitorInterval(interval)

```javascript
setMonitorInterval(interval)
```

* 设置监听间隔

---

## getTimeout()

```javascript
getTimeout()
```

* 获取超时时间

---

## setTimeout(timeout)

```javascript
setTimeout(timeout)
```

* 设置超时时间

---

## export()

```javascript
export()
```

* 导出配置（JSON字符串）

---

## import(jsonString)

```javascript
import(jsonString)
```

* 导入配置（从JSON字符串）

---

## function getUKeyConfig()

```javascript
function getUKeyConfig()
```

* 获取配置管理器实例

---

