# review-manager

**Source**: `src\main\trade\review-manager.js`

**Generated**: 2026-01-27T06:44:03.795Z

---

## class ReviewManager extends EventEmitter

```javascript
class ReviewManager extends EventEmitter
```

* 评价管理器
 * 负责交易评价、举报和统计

---

## initDatabase()

```javascript
initDatabase()
```

* 初始化数据库表

---

## setCurrentUser(did)

```javascript
setCurrentUser(did)
```

* 设置当前用户

---

## async createReview(options)

```javascript
async createReview(options)
```

* 创建评价

---

## async updateReview(reviewId, updates)

```javascript
async updateReview(reviewId, updates)
```

* 修改评价（限时）

---

## async replyToReview(reviewId, content)

```javascript
async replyToReview(reviewId, content)
```

* 回复评价

---

## async markHelpful(reviewId)

```javascript
async markHelpful(reviewId)
```

* 标记评价有帮助

---

## async reportReview(reviewId, reason, description = '')

```javascript
async reportReview(reviewId, reason, description = '')
```

* 举报评价

---

## async resolveReport(reportId, resolution, action = 'none')

```javascript
async resolveReport(reportId, resolution, action = 'none')
```

* 处理举报（管理员功能）

---

## getReviews(filters =

```javascript
getReviews(filters =
```

* 获取评价列表

---

## getReview(reviewId)

```javascript
getReview(reviewId)
```

* 获取评价详情

---

## formatReview(row)

```javascript
formatReview(row)
```

* 格式化评价数据

---

## getReviewStatistics(userDid)

```javascript
getReviewStatistics(userDid)
```

* 获取评价统计

---

## getMyReviews()

```javascript
getMyReviews()
```

* 获取我创建的评价

---

## getPendingReviews()

```javascript
getPendingReviews()
```

* 获取待评价的交易

---

## getFeaturedReviews(userDid, limit = 10)

```javascript
getFeaturedReviews(userDid, limit = 10)
```

* 获取推荐评价（高质量评价）

---

## getAvailableTags(type = 'positive')

```javascript
getAvailableTags(type = 'positive')
```

* 获取评价标签库

---

## async bulkDeleteSpamReviews(reviewIds)

```javascript
async bulkDeleteSpamReviews(reviewIds)
```

* 批量删除垃圾评价（管理员功能）

---

