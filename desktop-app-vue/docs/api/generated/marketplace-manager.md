# marketplace-manager

**Source**: `src\main\trade\marketplace-manager.js`

**Generated**: 2026-01-27T06:44:03.796Z

---

## const

```javascript
const
```

* 交易市场管理器
 *
 * 负责交易市场的管理，包括：
 * - 订单创建和管理
 * - 交易匹配
 * - 交易流程管理
 * - 托管集成

---

## const OrderType =

```javascript
const OrderType =
```

* 订单类型

---

## const OrderStatus =

```javascript
const OrderStatus =
```

* 订单状态

---

## const TransactionStatus =

```javascript
const TransactionStatus =
```

* 交易状态

---

## class MarketplaceManager extends EventEmitter

```javascript
class MarketplaceManager extends EventEmitter
```

* 交易市场管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化交易市场管理器

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async createOrder(

```javascript
async createOrder(
```

* 创建订单
   * @param {Object} options - 订单选项

---

## async cancelOrder(orderId)

```javascript
async cancelOrder(orderId)
```

* 取消订单
   * @param {string} orderId - 订单 ID

---

## async getOrders(filters =

```javascript
async getOrders(filters =
```

* 获取订单列表（支持高级筛选和分页）
   * @param {Object} filters - 筛选条件
   * @param {string} [filters.type] - 订单类型
   * @param {string} [filters.status] - 订单状态
   * @param {string} [filters.creatorDid] - 创建者 DID
   * @param {string} [filters.assetId] - 资产 ID
   * @param {string} [filters.search] - 搜索关键词（全文搜索）
   * @param {number} [filters.priceMin] - 最低价格
   * @param {number} [filters.priceMax] - 最高价格
   * @param {number} [filters.createdAfter] - 创建时间起始（时间戳）
   * @param {number} [filters.createdBefore] - 创建时间结束（时间戳）
   * @param {string} [filters.sortBy='created_at'] - 排序字段
   * @param {string} [filters.sortOrder='desc'] - 排序方向
   * @param {number} [filters.page=1] - 页码（从 1 开始）
   * @param {number} [filters.pageSize=20] - 每页数量
   * @param {number} [filters.limit] - 限制数量（向后兼容）
   * @returns {Promise<Object>} 分页结果 { items, total, page, pageSize, totalPages }

---

## async searchOrders(keyword, options =

```javascript
async searchOrders(keyword, options =
```

* 搜索订单（便捷方法）
   * @param {string} keyword - 搜索关键词
   * @param {Object} options - 其他选项
   * @returns {Promise<Object>} 搜索结果

---

## async getSearchSuggestions(prefix, limit = 10)

```javascript
async getSearchSuggestions(prefix, limit = 10)
```

* 获取搜索建议（自动补全）
   * @param {string} prefix - 搜索前缀
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>} 建议列表

---

## async getOrder(orderId)

```javascript
async getOrder(orderId)
```

* 获取订单详情
   * @param {string} orderId - 订单 ID

---

## async matchOrder(orderId, quantity = null)

```javascript
async matchOrder(orderId, quantity = null)
```

* 匹配订单（购买）
   * @param {string} orderId - 订单 ID
   * @param {number} quantity - 数量（可选，默认全部）

---

## async createTransaction(

```javascript
async createTransaction(
```

* 创建交易
   * @param {Object} options - 交易选项

---

## async confirmDelivery(transactionId)

```javascript
async confirmDelivery(transactionId)
```

* 确认交付
   * @param {string} transactionId - 交易 ID

---

## async requestRefund(transactionId, reason)

```javascript
async requestRefund(transactionId, reason)
```

* 申请退款
   * @param {string} transactionId - 交易 ID
   * @param {string} reason - 退款原因

---

## async getTransactions(filters =

```javascript
async getTransactions(filters =
```

* 获取交易列表
   * @param {Object} filters - 筛选条件

---

## async getMyOrders(userDid)

```javascript
async getMyOrders(userDid)
```

* 获取我的订单（买家或卖家）
   * @param {string} userDid - 用户 DID

---

## async updateOrder(orderId, updates)

```javascript
async updateOrder(orderId, updates)
```

* 更新订单
   * @param {string} orderId - 订单 ID
   * @param {Object} updates - 更新内容

---

## async close()

```javascript
async close()
```

* 关闭交易市场管理器

---

