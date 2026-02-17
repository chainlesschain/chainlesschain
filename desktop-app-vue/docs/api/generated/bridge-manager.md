# bridge-manager

**Source**: `src/main/blockchain/bridge-manager.js`

**Generated**: 2026-02-17T10:13:18.269Z

---

## class BridgeManager extends EventEmitter

```javascript
class BridgeManager extends EventEmitter
```

* 跨链桥管理器 - 生产级实现
 *
 * 功能：
 * - 资产跨链转移（锁定-铸造模式）
 * - 桥接记录管理
 * - 交易监控和状态同步
 * - 多重签名安全验证
 * - 速率限制和风险控制
 * - 自动化中继系统
 * - LayerZero协议集成
 *
 * 生产级特性：
 * - 多重安全防护（黑名单、速率限制、多签）
 * - 自动化中继器（监控、验证、执行）
 * - 费用优化和Gas估算
 * - 全面监控和告警
 * - 支持多种跨链协议

---

## constructor(blockchainAdapter, database)

```javascript
constructor(blockchainAdapter, database)
```

* 构造函数
   * @param {Object} blockchainAdapter - 区块链适配器
   * @param {Object} database - 数据库实例

---

## _loadABIs()

```javascript
_loadABIs()
```

* 加载合约 ABI
   * @private

---

## async initialize()

```javascript
async initialize()
```

* 初始化

---

## setupEventListeners()

```javascript
setupEventListeners()
```

* 设置事件监听

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async loadBridgeContracts()

```javascript
async loadBridgeContracts()
```

* 加载桥接合约地址

---

## registerBridgeContract(chainId, contractAddress)

```javascript
registerBridgeContract(chainId, contractAddress)
```

* 注册桥接合约
   * @param {number} chainId - 链 ID
   * @param {string} contractAddress - 合约地址

---

## async bridgeAsset(options)

```javascript
async bridgeAsset(options)
```

* 桥接资产（跨链转移）- 生产级实现
   * @param {Object} options - 桥接选项
   * @param {string} options.assetId - 本地资产 ID
   * @param {number} options.fromChainId - 源链 ID
   * @param {number} options.toChainId - 目标链 ID
   * @param {string} options.amount - 转移数量
   * @param {string} options.walletId - 钱包 ID
   * @param {string} options.password - 钱包密码
   * @param {string} options.recipientAddress - 接收地址（可选，默认使用同一地址）
   * @param {boolean} options.useLayerZero - 是否使用LayerZero协议（可选）
   * @returns {Promise<Object>} 桥接记录

---

## async _lockOnSourceChain(options)

```javascript
async _lockOnSourceChain(options)
```

* 在源链锁定资产
   * @private

---

## async _waitForLockConfirmation(chainId, txHash)

```javascript
async _waitForLockConfirmation(chainId, txHash)
```

* 等待锁定确认
   * @private

---

## async _mintOnTargetChain(options)

```javascript
async _mintOnTargetChain(options)
```

* 在目标链铸造资产
   * @private

---

## async _getAssetInfo(assetId)

```javascript
async _getAssetInfo(assetId)
```

* 获取资产信息
   * @private

---

## async getAssetBalance(address, tokenAddress, chainId)

```javascript
async getAssetBalance(address, tokenAddress, chainId)
```

* 查询链上资产余额
   * @param {string} address - 钱包地址
   * @param {string} tokenAddress - 代币合约地址
   * @param {number} chainId - 链 ID
   * @returns {Promise<string>} 余额（字符串格式）

---

## async getBatchBalances(address, assets)

```javascript
async getBatchBalances(address, assets)
```

* 批量查询多个资产的余额
   * @param {string} address - 钱包地址
   * @param {Array} assets - 资产列表 [{tokenAddress, chainId}]
   * @returns {Promise<Object>} 余额映射 {tokenAddress_chainId: balance}

---

## async getLockedBalance(tokenAddress, chainId)

```javascript
async getLockedBalance(tokenAddress, chainId)
```

* 查询桥接合约中的锁定余额
   * @param {string} tokenAddress - 代币合约地址
   * @param {number} chainId - 链 ID
   * @returns {Promise<string>} 锁定余额

---

## async _saveBridgeRecord(record)

```javascript
async _saveBridgeRecord(record)
```

* 保存桥接记录
   * @private

---

## async _updateBridgeRecord(bridgeId, updates)

```javascript
async _updateBridgeRecord(bridgeId, updates)
```

* 更新桥接记录
   * @private

---

## async getBridgeRecord(bridgeId)

```javascript
async getBridgeRecord(bridgeId)
```

* 获取桥接记录
   * @param {string} bridgeId - 桥接 ID
   * @returns {Promise<Object>} 桥接记录

---

## async getBridgeHistory(filters =

```javascript
async getBridgeHistory(filters =
```

* 获取桥接历史
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 桥接记录列表

---

## async bridgeViaLayerZero(options, wallet)

```javascript
async bridgeViaLayerZero(options, wallet)
```

* 使用LayerZero桥接资产

---

## async startRelayer()

```javascript
async startRelayer()
```

* 启动自动中继器

---

## async stopRelayer()

```javascript
async stopRelayer()
```

* 停止自动中继器

---

## getRelayerStats()

```javascript
getRelayerStats()
```

* 获取中继器统计信息

---

## async getSecurityEvents(filters =

```javascript
async getSecurityEvents(filters =
```

* 获取安全事件

---

## async pauseBridge(duration, reason)

```javascript
async pauseBridge(duration, reason)
```

* 暂停桥接

---

## async resumeBridge()

```javascript
async resumeBridge()
```

* 恢复桥接

---

## async blacklistAddress(address, reason)

```javascript
async blacklistAddress(address, reason)
```

* 添加地址到黑名单

---

## async unblacklistAddress(address)

```javascript
async unblacklistAddress(address)
```

* 从黑名单移除地址

---

## async addMultiSigSignature(txId, signature, signer)

```javascript
async addMultiSigSignature(txId, signature, signer)
```

* 添加多签签名

---

## async estimateBridgeFee(options)

```javascript
async estimateBridgeFee(options)
```

* 估算桥接费用

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

