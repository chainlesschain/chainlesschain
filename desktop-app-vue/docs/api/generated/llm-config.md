# llm-config

**Source**: `src/main/llm/llm-config.js`

**Generated**: 2026-04-15T08:45:16.136Z

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

## async loadAsync()

```javascript
async loadAsync()
```

* 异步加载配置（M2 启动期 IO 异步化）
   * 与 load() 共享合并/迁移逻辑，但 IO 通过 fs.promises 完成。

---

## async saveAsync()

```javascript
async saveAsync()
```

* 异步保存配置

---

## _applyMergedConfig(savedConfig)

```javascript
_applyMergedConfig(savedConfig)
```

* 合并已保存配置 + 默认配置（共享逻辑）
   * @private

---

## _migrateLegacyVolcengine()

```javascript
_migrateLegacyVolcengine()
```

* 迁移旧版火山引擎模型名称（共享逻辑）
   * @private
   * @returns {boolean} 是否发生迁移

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

## async _loadSensitiveFieldsAsync()

```javascript
async _loadSensitiveFieldsAsync()
```

* 异步从安全存储加载敏感字段（M2 启动期 IO 异步化）
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

## async function prewarmLLMConfig()

```javascript
async function prewarmLLMConfig()
```

* 异步预热 LLM 配置（M2 启动期 IO 异步化）
 * 在 bootstrap 早期 await 此函数，可将 readFile/mkdir/writeFile 移出事件循环。

---

