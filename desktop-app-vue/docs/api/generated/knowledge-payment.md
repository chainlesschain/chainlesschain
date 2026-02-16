# knowledge-payment

**Source**: `src/main/trade/knowledge-payment.js`

**Generated**: 2026-02-16T13:44:34.602Z

---

## class KnowledgePaymentManager extends EventEmitter

```javascript
class KnowledgePaymentManager extends EventEmitter
```

* 知识付费管理器
 * 负责付费内容创建、购买、访问控制和加密保护

---

## async initialize()

```javascript
async initialize()
```

* 初始化知识付费管理器

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

## async createPaidContent(options)

```javascript
async createPaidContent(options)
```

* 创建付费内容

---

## async purchaseContent(contentId, buyerDid)

```javascript
async purchaseContent(contentId, buyerDid)
```

* 购买内容

---

## async verifyAccess(contentId, userDid)

```javascript
async verifyAccess(contentId, userDid)
```

* 验证访问权限

---

## async getDecryptedContent(contentId, userDid)

```javascript
async getDecryptedContent(contentId, userDid)
```

* 获取解密内容

---

## async createSubscriptionPlan(options)

```javascript
async createSubscriptionPlan(options)
```

* 创建订阅计划

---

## async subscribe(planId, subscriberDid, autoRenew = false)

```javascript
async subscribe(planId, subscriberDid, autoRenew = false)
```

* 订阅计划

---

## async cancelSubscription(subscriptionId)

```javascript
async cancelSubscription(subscriptionId)
```

* 取消订阅

---

## getMyContents(filters =

```javascript
getMyContents(filters =
```

* 获取我的内容列表

---

## getMyPurchases()

```javascript
getMyPurchases()
```

* 获取我的购买列表

---

## getMySubscriptions()

```javascript
getMySubscriptions()
```

* 获取订阅列表

---

## searchContents(keyword, filters =

```javascript
searchContents(keyword, filters =
```

* 搜索内容

---

## logAccess(contentId, userDid, accessType)

```javascript
logAccess(contentId, userDid, accessType)
```

* 记录访问日志

---

## encryptContent(content, key)

```javascript
encryptContent(content, key)
```

* 加密内容

---

## decryptContent(encryptedData, key)

```javascript
decryptContent(encryptedData, key)
```

* 解密内容

---

## listContents(filters =

```javascript
listContents(filters =
```

* 列出付费内容
   * @param {Object} filters - 筛选条件
   * @param {string} filters.contentType - 内容类型
   * @param {string} filters.status - 状态
   * @param {number} filters.limit - 限制数量
   * @param {number} filters.offset - 偏移量
   * @returns {Array} 内容列表

---

## getStatistics(creatorDid)

```javascript
getStatistics(creatorDid)
```

* 获取统计信息

---

