# realtime-trading-engine

**Source**: `src/main/trade/realtime-trading-engine.js`

**Generated**: 2026-02-21T22:04:25.768Z

---

## const

```javascript
const
```

* 实时交易引擎
 *
 * 提供实时交易功能，包括：
 * - 实时订单匹配
 * - 实时价格更新
 * - 订单簿管理
 * - 交易执行
 * - WebSocket通信

---

## const OrderType =

```javascript
const OrderType =
```

* 订单类型

---

## const OrderSide =

```javascript
const OrderSide =
```

* 订单方向

---

## const OrderStatus =

```javascript
const OrderStatus =
```

* 订单状态

---

## class RealtimeTradingEngine extends EventEmitter

```javascript
class RealtimeTradingEngine extends EventEmitter
```

* 实时交易引擎类

---

## async initialize()

```javascript
async initialize()
```

* 初始化交易引擎

---

## async loadActiveOrders()

```javascript
async loadActiveOrders()
```

* 加载活跃订单

---

## async initializeOrderBooks()

```javascript
async initializeOrderBooks()
```

* 初始化订单簿

---

## async submitOrder(orderData)

```javascript
async submitOrder(orderData)
```

* 提交订单
   * @param {Object} orderData - 订单数据
   * @returns {Promise<Object>} 订单结果

---

## validateOrder(orderData)

```javascript
validateOrder(orderData)
```

* 验证订单

---

## async checkBalance(order)

```javascript
async checkBalance(order)
```

* 检查余额

---

## async getUserFundBalance(userDid)

```javascript
async getUserFundBalance(userDid)
```

* 获取用户资金账户余额
   * @param {string} userDid - 用户DID
   * @returns {Promise<number>} 余额

---

## async getLockedFunds(userDid)

```javascript
async getLockedFunds(userDid)
```

* 获取用户已锁定的资金（未成交的买单占用）
   * @param {string} userDid - 用户DID
   * @returns {Promise<number>} 锁定金额

---

## async saveOrder(order)

```javascript
async saveOrder(order)
```

* 保存订单

---

## async updateOrder(order)

```javascript
async updateOrder(order)
```

* 更新订单

---

## async cancelOrder(orderId)

```javascript
async cancelOrder(orderId)
```

* 取消订单
   * @param {string} orderId - 订单ID
   * @returns {Promise<boolean>}

---

## startMatching(interval)

```javascript
startMatching(interval)
```

* 启动订单匹配

---

## async matchAllOrders()

```javascript
async matchAllOrders()
```

* 匹配所有订单

---

## async matchOrderBook(orderBook)

```javascript
async matchOrderBook(orderBook)
```

* 匹配订单簿

---

## async matchOrder(order)

```javascript
async matchOrder(order)
```

* 匹配单个订单

---

## async executeMatch(match)

```javascript
async executeMatch(match)
```

* 执行匹配

---

## async createTrade(tradeData)

```javascript
async createTrade(tradeData)
```

* 创建交易记录

---

## startPriceUpdates(interval)

```javascript
startPriceUpdates(interval)
```

* 启动价格更新

---

## async updateAllPrices()

```javascript
async updateAllPrices()
```

* 更新所有价格

---

## async updatePrice(assetId, price)

```javascript
async updatePrice(assetId, price)
```

* 更新价格

---

## getOrderBook(assetId)

```javascript
getOrderBook(assetId)
```

* 获取订单簿

---

## getPriceFeed(assetId)

```javascript
getPriceFeed(assetId)
```

* 获取价格源

---

## getActiveOrders(assetId = null)

```javascript
getActiveOrders(assetId = null)
```

* 获取活跃订单

---

## async destroy()

```javascript
async destroy()
```

* 销毁交易引擎

---

## class OrderBook

```javascript
class OrderBook
```

* 订单簿类

---

## addOrder(order)

```javascript
addOrder(order)
```

* 添加订单

---

## removeOrder(order)

```javascript
removeOrder(order)
```

* 移除订单

---

## findMatches()

```javascript
findMatches()
```

* 查找匹配

---

## findMatchesForOrder(order)

```javascript
findMatchesForOrder(order)
```

* 为特定订单查找匹配

---

## getCurrentPrice()

```javascript
getCurrentPrice()
```

* 获取当前价格（最新成交价）

---

## getSnapshot(depth = 10)

```javascript
getSnapshot(depth = 10)
```

* 获取订单簿快照

---

