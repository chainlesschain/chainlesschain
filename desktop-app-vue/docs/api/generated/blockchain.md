# blockchain

**Source**: `src\renderer\stores\blockchain.js`

**Generated**: 2026-01-27T06:44:03.893Z

---

## export const useBlockchainStore = defineStore('blockchain',

```javascript
export const useBlockchainStore = defineStore('blockchain',
```

* 区块链模块 Store
 *
 * 管理区块链相关功能:
 * 1. 钱包管理 (内置 + 外部)
 * 2. 网络切换 (以太坊、Polygon 等)
 * 3. 交易监控
 * 4. 合约部署记录
 * 5. 余额查询

---

## internalWallets: (state) =>

```javascript
internalWallets: (state) =>
```

* 内置钱包列表（非外部钱包）

---

## currentAddress: (state) =>

```javascript
currentAddress: (state) =>
```

* 当前钱包地址

---

## currentWalletType: (state) =>

```javascript
currentWalletType: (state) =>
```

* 当前钱包类型

---

## hasWallet: (state) =>

```javascript
hasWallet: (state) =>
```

* 是否有可用钱包

---

## currentNetwork: (state) =>

```javascript
currentNetwork: (state) =>
```

* 当前网络信息

---

## mainnetNetworks: (state) =>

```javascript
mainnetNetworks: (state) =>
```

* 主网列表

---

## testnetNetworks: (state) =>

```javascript
testnetNetworks: (state) =>
```

* 测试网列表

---

## isTestnet: (state) =>

```javascript
isTestnet: (state) =>
```

* 当前网络是否为测试网

---

## pendingTransactionCount: (state) =>

```javascript
pendingTransactionCount: (state) =>
```

* 待确认交易数量

---

## recentTransactions: (state) =>

```javascript
recentTransactions: (state) =>
```

* 最近交易（前10条）

---

## getTransactionByHash: (state) => (txHash) =>

```javascript
getTransactionByHash: (state) => (txHash) =>
```

* 根据哈希获取交易

---

## contractsOnCurrentChain: (state) =>

```javascript
contractsOnCurrentChain: (state) =>
```

* 当前链上已部署的合约

---

## assetsOnCurrentChain: (state) =>

```javascript
assetsOnCurrentChain: (state) =>
```

* 当前链上已部署的资产

---

## getBlockchainAssetByLocalId: (state) => (localAssetId) =>

```javascript
getBlockchainAssetByLocalId: (state) => (localAssetId) =>
```

* 根据本地资产 ID 获取链上资产信息

---

## getBlockchainContractByLocalId: (state) => (localContractId) =>

```javascript
getBlockchainContractByLocalId: (state) => (localContractId) =>
```

* 根据本地合约 ID 获取链上合约信息

---

## getBalance: (state) => (address, chainId, tokenAddress = null) =>

```javascript
getBalance: (state) => (address, chainId, tokenAddress = null) =>
```

* 获取指定地址、链、代币的余额

---

## async loadWallets()

```javascript
async loadWallets()
```

* 加载所有钱包

---

## async createWallet(password)

```javascript
async createWallet(password)
```

* 创建新钱包

---

## async importFromMnemonic(mnemonic, password)

```javascript
async importFromMnemonic(mnemonic, password)
```

* 从助记词导入钱包

---

## async importFromPrivateKey(privateKey, password)

```javascript
async importFromPrivateKey(privateKey, password)
```

* 从私钥导入钱包

---

## async connectMetaMask()

```javascript
async connectMetaMask()
```

* 连接 MetaMask

---

## async connectWalletConnect()

```javascript
async connectWalletConnect()
```

* 连接 WalletConnect

---

## disconnectExternalWallet()

```javascript
disconnectExternalWallet()
```

* 断开外部钱包

---

## selectWallet(wallet)

```javascript
selectWallet(wallet)
```

* 选择钱包

---

## async deleteWallet(walletId)

```javascript
async deleteWallet(walletId)
```

* 删除钱包

---

## async setDefaultWallet(walletId)

```javascript
async setDefaultWallet(walletId)
```

* 设置默认钱包

---

## async switchChain(chainId)

```javascript
async switchChain(chainId)
```

* 切换网络

---

## async fetchBalance(address, chainId = null, tokenAddress = null)

```javascript
async fetchBalance(address, chainId = null, tokenAddress = null)
```

* 获取余额

---

## async refreshCurrentBalance()

```javascript
async refreshCurrentBalance()
```

* 刷新当前钱包的余额

---

## async loadTransactions(filters =

```javascript
async loadTransactions(filters =
```

* 加载交易历史

---

## async getTransaction(txHash)

```javascript
async getTransaction(txHash)
```

* 获取交易详情

---

## async monitorTransaction(txHash)

```javascript
async monitorTransaction(txHash)
```

* 监控交易状态（用于实时更新）

---

## removeConfirmedTransaction(txHash)

```javascript
removeConfirmedTransaction(txHash)
```

* 移除已确认的交易

---

## async loadDeployedContracts(chainId = null)

```javascript
async loadDeployedContracts(chainId = null)
```

* 加载已部署的合约

---

## async loadDeployedAssets(chainId = null)

```javascript
async loadDeployedAssets(chainId = null)
```

* 加载已部署的资产

---

## async getAssetBlockchainInfo(assetId)

```javascript
async getAssetBlockchainInfo(assetId)
```

* 获取资产的链上信息

---

## async getContractBlockchainInfo(contractId)

```javascript
async getContractBlockchainInfo(contractId)
```

* 获取合约的链上信息

---

## async fetchGasPrice()

```javascript
async fetchGasPrice()
```

* 获取 Gas 价格

---

## async estimateGas(transaction)

```javascript
async estimateGas(transaction)
```

* 估算 Gas

---

## showWalletModal()

```javascript
showWalletModal()
```

* 显示钱包模态框

---

## hideWalletModal()

```javascript
hideWalletModal()
```

* 隐藏钱包模态框

---

## showNetworkModal()

```javascript
showNetworkModal()
```

* 显示网络切换模态框

---

## hideNetworkModal()

```javascript
hideNetworkModal()
```

* 隐藏网络切换模态框

---

## showTransactionModal(transaction)

```javascript
showTransactionModal(transaction)
```

* 显示交易详情模态框

---

## hideTransactionModal()

```javascript
hideTransactionModal()
```

* 隐藏交易详情模态框

---

## async initialize()

```javascript
async initialize()
```

* 初始化

---

