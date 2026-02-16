# credit-score

**Source**: `src/main/trade/credit-score.js`

**Generated**: 2026-02-16T13:44:34.603Z

---

## class CreditScoreManager extends EventEmitter

```javascript
class CreditScoreManager extends EventEmitter
```

* 信用评分管理器
 * 负责计算和管理用户信用评分

---

## initDatabase()

```javascript
initDatabase()
```

* 初始化数据库表

---

## initUserCredit(userDid)

```javascript
initUserCredit(userDid)
```

* 初始化用户信用记录

---

## getUserCredit(userDid)

```javascript
getUserCredit(userDid)
```

* 获取用户信用信息

---

## async calculateCreditScore(userDid)

```javascript
async calculateCreditScore(userDid)
```

* 计算信用评分

---

## getCreditLevel(score)

```javascript
getCreditLevel(score)
```

* 根据分数获取信用等级

---

## async onTransactionCompleted(userDid, transactionId, amount)

```javascript
async onTransactionCompleted(userDid, transactionId, amount)
```

* 更新信用记录（交易完成）

---

## async onTransactionCancelled(userDid, transactionId)

```javascript
async onTransactionCancelled(userDid, transactionId)
```

* 更新信用记录（交易取消）

---

## async onPositiveReview(userDid, reviewId, rating)

```javascript
async onPositiveReview(userDid, reviewId, rating)
```

* 更新信用记录（收到好评）

---

## async onNegativeReview(userDid, reviewId, rating)

```javascript
async onNegativeReview(userDid, reviewId, rating)
```

* 更新信用记录（收到差评）

---

## async onDisputeInitiated(userDid, disputeId)

```javascript
async onDisputeInitiated(userDid, disputeId)
```

* 更新信用记录（发生纠纷）

---

## async onDisputeResolved(userDid, disputeId, resolution)

```javascript
async onDisputeResolved(userDid, disputeId, resolution)
```

* 更新信用记录（纠纷解决）

---

## async onRefund(userDid, refundId)

```javascript
async onRefund(userDid, refundId)
```

* 更新信用记录（退款）

---

## async updateResponseTime(userDid, responseTime)

```javascript
async updateResponseTime(userDid, responseTime)
```

* 更新响应时间

---

## async addCreditRecord(userDid, eventType, eventId, scoreChange, reason)

```javascript
async addCreditRecord(userDid, eventType, eventId, scoreChange, reason)
```

* 添加信用记录

---

## getCreditRecords(userDid, limit = 50)

```javascript
getCreditRecords(userDid, limit = 50)
```

* 获取信用记录

---

## getCreditReport(userDid)

```javascript
getCreditReport(userDid)
```

* 获取信用报告

---

## verifyCreditLevel(userDid, requiredLevel)

```javascript
verifyCreditLevel(userDid, requiredLevel)
```

* 验证信用等级

---

## getLeaderboard(limit = 50)

```javascript
getLeaderboard(limit = 50)
```

* 获取信用排行榜

---

## createSnapshot(userDid)

```javascript
createSnapshot(userDid)
```

* 创建信用快照

---

## getCreditTrend(userDid, days = 30)

```javascript
getCreditTrend(userDid, days = 30)
```

* 获取信用历史趋势

---

## async recalculateAllScores()

```javascript
async recalculateAllScores()
```

* 批量计算信用评分（定时任务）

---

