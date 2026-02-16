# data-cleanup

**Source**: `src/main/api/data-cleanup.js`

**Generated**: 2026-02-16T22:06:51.513Z

---

## const

```javascript
const
```

* Data Cleanup Manager
 * 定期清理旧的 RSS 和邮件数据
 *
 * v0.20.1: 新增数据清理功能

---

## startAutoCleanup(intervalMs = 24 * 60 * 60 * 1000)

```javascript
startAutoCleanup(intervalMs = 24 * 60 * 60 * 1000)
```

* 启动自动清理任务
   * @param {number} intervalMs - 清理间隔（毫秒），默认24小时

---

## stopAutoCleanup()

```javascript
stopAutoCleanup()
```

* 停止自动清理任务

---

## async runCleanup()

```javascript
async runCleanup()
```

* 执行清理任务

---

## async cleanupOldRSSItems(retentionDays = this.defaultRetentionDays)

```javascript
async cleanupOldRSSItems(retentionDays = this.defaultRetentionDays)
```

* 清理旧的 RSS 文章
   * @param {number} retentionDays - 保留天数，默认30天

---

## async cleanupOldEmails(retentionDays = this.defaultRetentionDays)

```javascript
async cleanupOldEmails(retentionDays = this.defaultRetentionDays)
```

* 清理旧的邮件
   * @param {number} retentionDays - 保留天数，默认30天

---

## async cleanupOrphanedAttachments()

```javascript
async cleanupOrphanedAttachments()
```

* 清理孤立的附件（邮件已删除但附件仍存在）

---

## async getDataStats()

```javascript
async getDataStats()
```

* 获取数据统计信息

---

## setRetentionDays(days)

```javascript
setRetentionDays(days)
```

* 设置保留天数

---

