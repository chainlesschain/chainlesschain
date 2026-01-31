# auto-save-manager

**Source**: `src\main\system\auto-save-manager.js`

**Generated**: 2026-01-27T06:44:03.802Z

---

## const

```javascript
const
```

* 自动保存管理器
 * 管理文档和数据的自动保存

---

## register(documentId, saveHandler, options =

```javascript
register(documentId, saveHandler, options =
```

* 注册文档

---

## unregister(documentId)

```javascript
unregister(documentId)
```

* 注销文档

---

## markDirty(documentId)

```javascript
markDirty(documentId)
```

* 标记文档为已修改

---

## debounceSave(documentId)

```javascript
debounceSave(documentId)
```

* 防抖保存

---

## startAutoSave(documentId)

```javascript
startAutoSave(documentId)
```

* 启动自动保存

---

## stopAutoSave(documentId)

```javascript
stopAutoSave(documentId)
```

* 停止自动保存

---

## async save(documentId, force = false)

```javascript
async save(documentId, force = false)
```

* 保存文档

---

## async processQueue()

```javascript
async processQueue()
```

* 处理保存队列

---

## async saveAll()

```javascript
async saveAll()
```

* 保存所有文档

---

## enable()

```javascript
enable()
```

* 启用自动保存

---

## disable()

```javascript
disable()
```

* 禁用自动保存

---

## getStatus(documentId)

```javascript
getStatus(documentId)
```

* 获取文档状态

---

## getAllStatus()

```javascript
getAllStatus()
```

* 获取所有文档状态

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计信息

---

## destroy()

```javascript
destroy()
```

* 销毁管理器

---

