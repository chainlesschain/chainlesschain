# asset-manager

**Source**: `src/main/trade/asset-manager.js`

**Generated**: 2026-02-22T01:23:36.663Z

---

## const

```javascript
const
```

* 资产管理器
 *
 * 负责数字资产的管理，包括：
 * - 资产创建（Token、NFT、知识产品等）
 * - 资产转账
 * - 资产销毁
 * - 资产查询
 * - 余额管理

---

## const AssetType =

```javascript
const AssetType =
```

* 资产类型

---

## const TransactionType =

```javascript
const TransactionType =
```

* 转账类型

---

## class AssetManager extends EventEmitter

```javascript
class AssetManager extends EventEmitter
```

* 资产管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化资产管理器

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async createAsset(

```javascript
async createAsset(
```

* 创建资产
   * @param {Object} options - 资产选项
   * @param {string} options.type - 资产类型
   * @param {string} options.name - 资产名称
   * @param {string} options.symbol - 资产符号
   * @param {string} options.description - 描述
   * @param {Object} options.metadata - 元数据
   * @param {number} options.totalSupply - 总供应量
   * @param {number} options.decimals - 小数位数
   * @param {boolean} options.onChain - 是否部署到区块链
   * @param {number} options.chainId - 目标链 ID
   * @param {string} options.walletId - 钱包 ID
   * @param {string} options.password - 钱包密码

---

## async mintAsset(assetId, toDid, amount)

```javascript
async mintAsset(assetId, toDid, amount)
```

* 铸造资产（增发）
   * @param {string} assetId - 资产 ID
   * @param {string} toDid - 接收者 DID
   * @param {number} amount - 数量

---

## async transferAsset(assetId, toDid, amount, memo = "", onChainOptions =

```javascript
async transferAsset(assetId, toDid, amount, memo = "", onChainOptions =
```

* 转账资产
   * @param {string} assetId - 资产 ID
   * @param {string} toDid - 接收者 DID
   * @param {number} amount - 数量
   * @param {string} memo - 备注
   * @param {Object} onChainOptions - 链上转账选项（可选）
   * @param {boolean} onChainOptions.onChain - 是否执行链上转账
   * @param {string} onChainOptions.toAddress - 接收者区块链地址
   * @param {string} onChainOptions.walletId - 钱包 ID
   * @param {string} onChainOptions.password - 钱包密码

---

## async burnAsset(assetId, amount)

```javascript
async burnAsset(assetId, amount)
```

* 销毁资产
   * @param {string} assetId - 资产 ID
   * @param {number} amount - 数量

---

## async transferNFTOnChain(

```javascript
async transferNFTOnChain(
```

* 转账 NFT（链上）
   * @param {string} assetId - 资产 ID
   * @param {string} toDid - 接收者 DID
   * @param {string} toAddress - 接收者区块链地址
   * @param {string} walletId - 钱包 ID
   * @param {string} password - 钱包密码
   * @param {string} memo - 备注

---

## async getAsset(assetId)

```javascript
async getAsset(assetId)
```

* 获取资产信息
   * @param {string} assetId - 资产 ID

---

## async getAssetsByOwner(ownerDid)

```javascript
async getAssetsByOwner(ownerDid)
```

* 获取用户的所有资产
   * @param {string} ownerDid - 所有者 DID

---

## async getAssetHistory(assetId, limit = 100)

```javascript
async getAssetHistory(assetId, limit = 100)
```

* 获取资产历史记录
   * @param {string} assetId - 资产 ID
   * @param {number} limit - 限制数量

---

## async getBalance(ownerDid, assetId)

```javascript
async getBalance(ownerDid, assetId)
```

* 获取用户余额
   * @param {string} ownerDid - 所有者 DID
   * @param {string} assetId - 资产 ID

---

## async getAllAssets(filters =

```javascript
async getAllAssets(filters =
```

* 获取所有资产列表
   * @param {Object} filters - 筛选条件

---

## async _deployAssetToBlockchain(assetId, options)

```javascript
async _deployAssetToBlockchain(assetId, options)
```

* 部署资产到区块链（私有方法）
   * @param {string} assetId - 资产 ID
   * @param {Object} options - 部署选项

---

## async _saveBlockchainAsset(options)

```javascript
async _saveBlockchainAsset(options)
```

* 保存区块链资产记录（私有方法）
   * @param {Object} options - 区块链资产信息

---

## async _getBlockchainAsset(assetId)

```javascript
async _getBlockchainAsset(assetId)
```

* 获取资产的区块链信息（私有方法）
   * @param {string} assetId - 资产 ID

---

## async close()

```javascript
async close()
```

* 关闭资产管理器

---

