# git-config

**Source**: `src/main/git/git-config.js`

**Generated**: 2026-02-15T10:10:53.421Z

---

## const

```javascript
const
```

* Git配置管理

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## class GitConfig

```javascript
class GitConfig
```

* Git配置管理器

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

## function gitLog(tag, ...args)

```javascript
function gitLog(tag, ...args)
```

* Git日志工具函数
 * 根据配置决定是否输出日志

---

