# event-listener

**Source**: `src/main/blockchain/event-listener.js`

**Generated**: 2026-02-22T01:23:36.754Z

---

## const

```javascript
const
```

* 区块链事件监听器
 *
 * 负责监听链上事件并同步到本地数据库
 * 支持：
 * - 资产转账事件
 * - 托管合约事件
 * - 订阅合约事件
 * - 悬赏合约事件

---

## async initialize()

```javascript
async initialize()
```

* 初始化事件监听器

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async addListener(options)

```javascript
async addListener(options)
```

* 添加事件监听器
   * @param {Object} options - 监听器配置

---

## async handleEvent(options)

```javascript
async handleEvent(options)
```

* 处理事件
   * @param {Object} options - 事件信息

---

## async processEventByType(contractType, eventName, eventData)

```javascript
async processEventByType(contractType, eventName, eventData)
```

* 根据合约类型处理事件
   * @param {string} contractType - 合约类型
   * @param {string} eventName - 事件名称
   * @param {Object} eventData - 事件数据

---

## async processERC20Event(eventName, eventData)

```javascript
async processERC20Event(eventName, eventData)
```

* 处理 ERC-20 事件

---

## async processERC721Event(eventName, eventData)

```javascript
async processERC721Event(eventName, eventData)
```

* 处理 ERC-721 事件

---

## async processEscrowEvent(eventName, eventData)

```javascript
async processEscrowEvent(eventName, eventData)
```

* 处理托管合约事件

---

## async processSubscriptionEvent(eventName, eventData)

```javascript
async processSubscriptionEvent(eventName, eventData)
```

* 处理订阅合约事件

---

## async processBountyEvent(eventName, eventData)

```javascript
async processBountyEvent(eventName, eventData)
```

* 处理悬赏合约事件

---

## async removeListener(contractAddress, chainId, eventName)

```javascript
async removeListener(contractAddress, chainId, eventName)
```

* 移除事件监听器
   * @param {string} contractAddress - 合约地址
   * @param {number} chainId - 链 ID
   * @param {string} eventName - 事件名称

---

## async restoreListeners()

```javascript
async restoreListeners()
```

* 恢复之前的监听器

---

## async getProcessedEvents(filters =

```javascript
async getProcessedEvents(filters =
```

* 获取已处理的事件
   * @param {Object} filters - 筛选条件

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

