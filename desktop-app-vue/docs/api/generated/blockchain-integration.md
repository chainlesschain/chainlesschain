# blockchain-integration

**Source**: `src/main/blockchain/blockchain-integration.js`

**Generated**: 2026-02-15T07:37:13.859Z

---

## const

```javascript
const
```

* 区块链集成模块
 *
 * Phase 5: 将区块链适配器集成到现有交易系统
 *
 * 功能：
 * - 将链上资产与本地资产管理器同步
 * - 将链上交易与本地交易记录同步
 * - 将链上托管与本地托管管理器同步
 * - 提供统一的API接口

---

## async initialize()

```javascript
async initialize()
```

* 初始化集成模块

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async createOnChainToken(localAssetId, options)

```javascript
async createOnChainToken(localAssetId, options)
```

* 创建链上资产（ERC-20 Token）
   * @param {string} localAssetId - 本地资产ID
   * @param {object} options - 部署参数
   * @returns {Promise<object>} 部署结果

---

## async createOnChainNFT(localAssetId, options)

```javascript
async createOnChainNFT(localAssetId, options)
```

* 创建链上NFT
   * @param {string} localAssetId - 本地资产ID
   * @param {object} options - 部署参数
   * @returns {Promise<object>} 部署结果

---

## async transferOnChainAsset(localAssetId, options)

```javascript
async transferOnChainAsset(localAssetId, options)
```

* 转账链上资产
   * @param {string} localAssetId - 本地资产ID
   * @param {object} options - 转账参数
   * @returns {Promise<string>} 交易哈希

---

## async syncAssetBalance(localAssetId, ownerAddress)

```javascript
async syncAssetBalance(localAssetId, ownerAddress)
```

* 同步链上资产余额到本地
   * @param {string} localAssetId - 本地资产ID
   * @param {string} ownerAddress - 拥有者地址
   * @returns {Promise<string>} 余额

---

## async createOnChainEscrow(localEscrowId, options)

```javascript
async createOnChainEscrow(localEscrowId, options)
```

* 创建链上托管
   * @param {string} localEscrowId - 本地托管ID
   * @param {object} options - 托管参数
   * @returns {Promise<object>} 创建结果

---

## async syncEscrowStatus(localEscrowId)

```javascript
async syncEscrowStatus(localEscrowId)
```

* 同步托管状态
   * @param {string} localEscrowId - 本地托管ID
   * @returns {Promise<object>} 托管状态

---

## async monitorTransaction(txHash, confirmations = 1)

```javascript
async monitorTransaction(txHash, confirmations = 1)
```

* 监控交易状态
   * @param {string} txHash - 交易哈希
   * @param {number} confirmations - 需要的确认数
   * @returns {Promise<object>} 交易收据

---

## getAssetMapping(localAssetId)

```javascript
getAssetMapping(localAssetId)
```

* 获取资产映射
   * @param {string} localAssetId - 本地资产ID
   * @returns {object|null} 映射信息

---

## getEscrowMapping(localEscrowId)

```javascript
getEscrowMapping(localEscrowId)
```

* 获取托管映射
   * @param {string} localEscrowId - 本地托管ID
   * @returns {object|null} 映射信息

---

## getTransactionMapping(localTxId)

```javascript
getTransactionMapping(localTxId)
```

* 获取交易映射
   * @param {string} localTxId - 本地交易ID
   * @returns {object|null} 映射信息

---

## getAllOnChainAssets()

```javascript
getAllOnChainAssets()
```

* 获取所有链上资产
   * @returns {Array<object>} 资产列表

---

## getPendingTransactions()

```javascript
getPendingTransactions()
```

* 获取待确认交易
   * @returns {Array<object>} 交易列表

---

## startAutoSync(interval = 5 * 60 * 1000)

```javascript
startAutoSync(interval = 5 * 60 * 1000)
```

* 启动自动同步
   * @param {number} interval - 同步间隔（毫秒）

---

## stopAutoSync()

```javascript
stopAutoSync()
```

* 停止自动同步

---

## async syncAll()

```javascript
async syncAll()
```

* 同步所有数据

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

