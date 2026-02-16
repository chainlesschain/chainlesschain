# blockchain-adapter

**Source**: `src/main/blockchain/blockchain-adapter.js`

**Generated**: 2026-02-16T13:44:34.683Z

---

## const

```javascript
const
```

* 区块链适配器
 *
 * 核心适配器，提供统一的API接口支持多链（以太坊 + Polygon）
 * 负责：
 * - 多链管理和切换
 * - 合约部署（ERC-20, ERC-721, ERC-1155）
 * - 代币转账
 * - 事件监听

---

## async initialize()

```javascript
async initialize()
```

* 初始化适配器

---

## async switchChain(chainId)

```javascript
async switchChain(chainId)
```

* 切换网络
   * @param {number} chainId - 目标链ID

---

## getProvider()

```javascript
getProvider()
```

* 获取当前提供者
   * @returns {ethers.JsonRpcProvider} 当前链的提供者

---

## async deployERC20Token(walletId, options)

```javascript
async deployERC20Token(walletId, options)
```

* 部署 ERC-20 代币
   * @param {string} walletId - 钱包ID
   * @param {object} options - 代币参数 {name, symbol, decimals, initialSupply}
   * @returns {Promise<{address: string, txHash: string}>}

---

## async deployNFT(walletId, options)

```javascript
async deployNFT(walletId, options)
```

* 部署 ERC-721 NFT
   * @param {string} walletId - 钱包ID
   * @param {object} options - NFT参数 {name, symbol, password}
   * @returns {Promise<{address: string, txHash: string}>}

---

## async deployEscrowContract(walletId, password)

```javascript
async deployEscrowContract(walletId, password)
```

* 部署托管合约 (EscrowContract)
   * @param {string} walletId - 钱包ID
   * @param {string} password - 钱包密码
   * @returns {Promise<{address: string, txHash: string, abi: Array}>}

---

## async deploySubscriptionContract(walletId, password)

```javascript
async deploySubscriptionContract(walletId, password)
```

* 部署订阅合约 (SubscriptionContract)
   * @param {string} walletId - 钱包ID
   * @param {string} password - 钱包密码
   * @returns {Promise<{address: string, txHash: string, abi: Array}>}

---

## async deployBountyContract(walletId, password)

```javascript
async deployBountyContract(walletId, password)
```

* 部署悬赏合约 (BountyContract)
   * @param {string} walletId - 钱包ID
   * @param {string} password - 钱包密码
   * @returns {Promise<{address: string, txHash: string, abi: Array}>}

---

## async mintNFT(walletId, contractAddress, to, metadataURI, password)

```javascript
async mintNFT(walletId, contractAddress, to, metadataURI, password)
```

* 铸造 NFT
   * @param {string} walletId - 钱包ID
   * @param {string} contractAddress - NFT合约地址
   * @param {string} to - 接收地址
   * @param {string} metadataURI - 元数据 URI
   * @param {string} password - 钱包密码
   * @returns {Promise<{tokenId: number, txHash: string}>}

---

## async transferToken(walletId, tokenAddress, to, amount, password)

```javascript
async transferToken(walletId, tokenAddress, to, amount, password)
```

* 转账代币
   * @param {string} walletId - 钱包ID
   * @param {string} tokenAddress - 代币合约地址
   * @param {string} to - 接收地址
   * @param {string} amount - 数量（字符串，支持大数）
   * @param {string} password - 钱包密码
   * @returns {Promise<string>} 交易哈希

---

## async transferNFT(walletId, nftAddress, from, to, tokenId, password)

```javascript
async transferNFT(walletId, nftAddress, from, to, tokenId, password)
```

* 转账 NFT (ERC-721)
   * @param {string} walletId - 钱包ID
   * @param {string} nftAddress - NFT合约地址
   * @param {string} from - 发送者地址
   * @param {string} to - 接收地址
   * @param {string} tokenId - NFT Token ID
   * @param {string} password - 钱包密码
   * @returns {Promise<string>} 交易哈希

---

## async batchTransferNFT(walletId, nftAddress, from, transfers, password)

```javascript
async batchTransferNFT(walletId, nftAddress, from, transfers, password)
```

* 批量转账 NFT (ERC-721)
   * @param {string} walletId - 钱包ID
   * @param {string} nftAddress - NFT合约地址
   * @param {string} from - 发送者地址
   * @param {Array<{to: string, tokenId: string}>} transfers - 转账列表
   * @param {string} password - 钱包密码
   * @returns {Promise<Array<{success: boolean, txHash?: string, tokenId: string, to: string, error?: string}>>}

---

## async getNFTOwner(nftAddress, tokenId)

```javascript
async getNFTOwner(nftAddress, tokenId)
```

* 获取 NFT 所有者
   * @param {string} nftAddress - NFT合约地址
   * @param {string} tokenId - Token ID
   * @returns {Promise<string>} 所有者地址

---

## async getNFTBalance(nftAddress, ownerAddress)

```javascript
async getNFTBalance(nftAddress, ownerAddress)
```

* 获取地址拥有的 NFT 数量
   * @param {string} nftAddress - NFT合约地址
   * @param {string} ownerAddress - 所有者地址
   * @returns {Promise<number>} NFT 数量

---

## async getNFTTokenURI(nftAddress, tokenId)

```javascript
async getNFTTokenURI(nftAddress, tokenId)
```

* 获取 NFT 元数据 URI
   * @param {string} nftAddress - NFT合约地址
   * @param {string} tokenId - Token ID
   * @returns {Promise<string>} 元数据 URI

---

## async getTokenBalance(tokenAddress, ownerAddress)

```javascript
async getTokenBalance(tokenAddress, ownerAddress)
```

* 获取代币余额
   * @param {string} tokenAddress - 代币合约地址
   * @param {string} ownerAddress - 拥有者地址
   * @returns {Promise<string>} 余额（字符串）

---

## async listenToEvents(contractAddress, abi, eventName, callback)

```javascript
async listenToEvents(contractAddress, abi, eventName, callback)
```

* 监听合约事件
   * @param {string} contractAddress - 合约地址
   * @param {Array} abi - 合约 ABI
   * @param {string} eventName - 事件名称
   * @param {function} callback - 回调函数

---

## async stopListening(contractAddress, abi, eventName)

```javascript
async stopListening(contractAddress, abi, eventName)
```

* 停止监听事件
   * @param {string} contractAddress - 合约地址
   * @param {Array} abi - 合约 ABI
   * @param {string} eventName - 事件名称

---

## async estimateGas(transaction)

```javascript
async estimateGas(transaction)
```

* 估算 Gas
   * @param {object} transaction - 交易对象
   * @returns {Promise<bigint>} 估算的 Gas

---

## async getGasPrice()

```javascript
async getGasPrice()
```

* 获取 Gas 价格
   * @returns {Promise<object>} Gas 价格信息

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

## async batchTransferToken(walletId, tokenAddress, transfers, password)

```javascript
async batchTransferToken(walletId, tokenAddress, transfers, password)
```

* 批量转账代币
   * @param {string} walletId - 钱包ID
   * @param {string} tokenAddress - 代币合约地址
   * @param {Array<{to: string, amount: string}>} transfers - 转账列表
   * @param {string} password - 钱包密码
   * @returns {Promise<Array<string>>} 交易哈希列表

---

## async estimateTransactionFee(transaction)

```javascript
async estimateTransactionFee(transaction)
```

* 估算交易费用（包含 L2 特殊处理）
   * @param {object} transaction - 交易对象
   * @returns {Promise<object>} 费用估算

---

## async retryTransaction(txFunction, maxRetries = 3, baseDelay = 1000)

```javascript
async retryTransaction(txFunction, maxRetries = 3, baseDelay = 1000)
```

* 交易重试（带指数退避）
   * @param {Function} txFunction - 交易函数
   * @param {number} maxRetries - 最大重试次数
   * @param {number} baseDelay - 基础延迟（毫秒）
   * @returns {Promise<any>} 交易结果

---

## async getOptimizedGasPrice(speed = "standard")

```javascript
async getOptimizedGasPrice(speed = "standard")
```

* Gas 价格优化（根据网络拥堵情况调整）
   * @param {string} speed - 速度等级 ('slow', 'standard', 'fast')
   * @returns {Promise<object>} 优化后的 Gas 价格

---

## getSupportedChains()

```javascript
getSupportedChains()
```

* 获取所有支持的链列表
   * @returns {Array<object>} 链列表

---

## getCurrentChainInfo()

```javascript
getCurrentChainInfo()
```

* 获取当前链信息
   * @returns {object} 当前链信息

---

## async monitorTransaction(txHash, confirmations = 1, onUpdate = null)

```javascript
async monitorTransaction(txHash, confirmations = 1, onUpdate = null)
```

* 监控交易状态
   * @param {string} txHash - 交易哈希
   * @param {number} confirmations - 需要的确认数
   * @param {Function} onUpdate - 状态更新回调
   * @returns {Promise<object>} 交易收据

---

## async replaceTransaction(walletId, txHash, action = "speedup", password)

```javascript
async replaceTransaction(walletId, txHash, action = "speedup", password)
```

* 取消或加速交易（通过替换交易）
   * @param {string} walletId - 钱包ID
   * @param {string} txHash - 原交易哈希
   * @param {string} action - 'cancel' 或 'speedup'
   * @param {string} password - 钱包密码
   * @returns {Promise<string>} 新交易哈希

---

