# field-mapper

**Source**: `src/main/sync/field-mapper.js`

**Generated**: 2026-02-21T20:04:16.199Z

---

## class FieldMapper

```javascript
class FieldMapper
```

* 字段映射工具
 * 用于本地 SQLite 与后端 PostgreSQL 之间的数据格式转换

---

## toISO8601(milliseconds)

```javascript
toISO8601(milliseconds)
```

* 时间戳转换：毫秒 → ISO 8601

---

## toMillis(isoString)

```javascript
toMillis(isoString)
```

* 时间戳转换：ISO 8601 → 毫秒

---

## validateRequiredFields(record, tableName)

```javascript
validateRequiredFields(record, tableName)
```

* 验证记录是否包含所有必填字段
   * @param {Object} record - 待验证的记录
   * @param {string} tableName - 表名
   * @returns {Object} { valid: boolean, missingFields: string[] }

---

## toBackend(localRecord, tableName)

```javascript
toBackend(localRecord, tableName)
```

* 本地记录 → 后端格式

---

## toLocal(backendRecord, tableName, options =

```javascript
toLocal(backendRecord, tableName, options =
```

* 后端格式 → 本地记录
   * @param {Object} backendRecord - 后端记录
   * @param {string} tableName - 表名
   * @param {Object} options - 转换选项
   * @param {Object} options.existingRecord - 已存在的本地记录（用于保留本地状态）
   * @param {boolean} options.preserveLocalStatus - 是否保留本地同步状态（默认false）
   * @param {string} options.forceSyncStatus - 强制设置的同步状态（优先级最高）

---

## toLocalAsNew(backendRecord, tableName)

```javascript
toLocalAsNew(backendRecord, tableName)
```

* 将后端记录转换为本地记录（新记录场景）
   * 明确标记为synced状态

---

## toLocalForUpdate(backendRecord, tableName, existingRecord)

```javascript
toLocalForUpdate(backendRecord, tableName, existingRecord)
```

* 将后端记录转换为本地记录（更新场景）
   * 保留本地的同步状态

---

## toLocalAsConflict(backendRecord, tableName)

```javascript
toLocalAsConflict(backendRecord, tableName)
```

* 将后端记录转换为本地记录（冲突标记）
   * 标记为conflict状态

---

