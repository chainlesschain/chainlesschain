# llm-config

**Source**: `src/main/llm/llm-config.js`

**Generated**: 2026-02-16T13:44:34.655Z

---

## const

```javascript
const
```

* LLM配置管理
 * 支持敏感信息（API Keys）加密存储

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## class LLMConfig

```javascript
class LLMConfig
```

* LLM配置管理器

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

## _loadSensitiveFields()

```javascript
_loadSensitiveFields()
```

* 从安全存储加载敏感字段
   * @private

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

---

## set(key, value)

```javascript
set(key, value)
```

* 设置配置项

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

## validate()

```javascript
validate()
```

* 验证配置

---

## getManagerConfig()

```javascript
getManagerConfig()
```

* 获取管理器配置

---

