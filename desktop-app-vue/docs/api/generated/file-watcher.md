# file-watcher

**Source**: `src/main/file/file-watcher.js`

**Generated**: 2026-02-16T22:06:51.485Z

---

## const

```javascript
const
```

* 文件监视器
 * 监视文件系统变化

---

## watch(targetPath, options =

```javascript
watch(targetPath, options =
```

* 监视文件或目录

---

## unwatch(targetPath)

```javascript
unwatch(targetPath)
```

* 停止监视

---

## unwatchAll()

```javascript
unwatchAll()
```

* 停止所有监视

---

## handleChange(targetPath, eventType, filename)

```javascript
handleChange(targetPath, eventType, filename)
```

* 处理文件变化

---

## async processChange(targetPath, eventType, fullPath)

```javascript
async processChange(targetPath, eventType, fullPath)
```

* 处理变化

---

## getWatchList()

```javascript
getWatchList()
```

* 获取监视列表

---

## isWatching(targetPath)

```javascript
isWatching(targetPath)
```

* 检查是否正在监视

---

## getWatchCount()

```javascript
getWatchCount()
```

* 获取监视数量

---

## destroy()

```javascript
destroy()
```

* 销毁监视器

---

