# speech-config

**Source**: `src/main/speech/speech-config.js`

**Generated**: 2026-02-21T22:45:05.250Z

---

## const

```javascript
const
```

* 语音识别配置管理
 *
 * 管理语音识别系统的所有配置选项

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## class SpeechConfig

```javascript
class SpeechConfig
```

* 语音配置管理类

---

## async load()

```javascript
async load()
```

* 加载配置

---

## async save()

```javascript
async save()
```

* 保存配置

---

## getAll()

```javascript
getAll()
```

* 获取所有配置

---

## get(key)

```javascript
get(key)
```

* 获取单个配置项

---

## set(key, value)

```javascript
set(key, value)
```

* 设置配置项

---

## async update(newConfig)

```javascript
async update(newConfig)
```

* 更新配置（批量）

---

## async reset()

```javascript
async reset()
```

* 重置为默认配置

---

## getEngineConfig(engineType)

```javascript
getEngineConfig(engineType)
```

* 获取引擎配置

---

## validate()

```javascript
validate()
```

* 验证配置

---

## deepMerge(target, source)

```javascript
deepMerge(target, source)
```

* 深度合并对象

---

## isObject(item)

```javascript
isObject(item)
```

* 检查是否为对象

---

## getNestedValue(obj, key)

```javascript
getNestedValue(obj, key)
```

* 获取嵌套值

---

## setNestedValue(obj, key, value)

```javascript
setNestedValue(obj, key, value)
```

* 设置嵌套值

---

