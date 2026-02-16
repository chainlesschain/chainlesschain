# transaction-monitor

**Source**: `src/main/blockchain/transaction-monitor.js`

**Generated**: 2026-02-16T22:06:51.508Z

---

## const

```javascript
const
```

* 交易监控器
 *
 * 负责监控区块链交易状态，自动更新本地数据库
 * 功能：
 * - 提交交易并监控
 * - 等待交易确认
 * - 更新数据库状态
 * - 交易重试机制

---

## const TransactionStatus =

```javascript
const TransactionStatus =
```

* 交易状态

---

## async initialize()

```javascript
async initialize()
```

* 初始化监控器

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async submitAndMonitor(txResponse, options =

```javascript
async submitAndMonitor(txResponse, options =
```

* 提交交易并监控状态
   * @param {object} txResponse - ethers.js 交易响应
   * @param {object} options - 选项 {onConfirmed, onFailed, txType, localRefId}
   * @returns {Promise<string>} 交易哈希

---

## async monitorTx(txHash, onConfirmed, onFailed)

```javascript
async monitorTx(txHash, onConfirmed, onFailed)
```

* 监控交易确认
   * @param {string} txHash - 交易哈希
   * @param {function} onConfirmed - 确认回调
   * @param {function} onFailed - 失败回调

---

## async saveTx(txData)

```javascript
async saveTx(txData)
```

* 保存交易到数据库
   * @param {object} txData - 交易数据

---

## async updateTxStatus(txHash, status, receipt = null)

```javascript
async updateTxStatus(txHash, status, receipt = null)
```

* 更新交易状态
   * @param {string} txHash - 交易哈希
   * @param {string} status - 新状态
   * @param {object|null} receipt - 交易收据

---

## startMonitoring()

```javascript
startMonitoring()
```

* 启动监控定时器

---

## stopMonitoring()

```javascript
stopMonitoring()
```

* 停止监控定时器

---

## async checkPendingTransactions()

```javascript
async checkPendingTransactions()
```

* 检查待处理交易

---

## async recoverPendingTransactions()

```javascript
async recoverPendingTransactions()
```

* 恢复未完成的交易监控

---

## async getTxHistory(filters =

```javascript
async getTxHistory(filters =
```

* 获取交易历史
   * @param {object} filters - 过滤条件 {address, chainId, limit, offset}
   * @returns {Promise<array>} 交易列表

---

## async getTxDetail(txHash)

```javascript
async getTxDetail(txHash)
```

* 获取交易详情
   * @param {string} txHash - 交易哈希
   * @returns {Promise<object>} 交易详情

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

