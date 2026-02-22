# blockchain-config

**Source**: `src/main/blockchain/blockchain-config.js`

**Generated**: 2026-02-22T01:23:36.756Z

---

## const SupportedChains =

```javascript
const SupportedChains =
```

* 区块链网络配置
 *
 * 定义支持的区块链网络、RPC端点、链ID等配置

---

## const SupportedChains =

```javascript
const SupportedChains =
```

* 支持的区块链网络

---

## const NetworkConfigs =

```javascript
const NetworkConfigs =
```

* 网络配置

---

## const GasConfigs =

```javascript
const GasConfigs =
```

* Gas 价格配置（Gwei）

---

## const ContractAddresses =

```javascript
const ContractAddresses =
```

* 合约地址配置（部署后填写）

---

## function getNetworkConfig(chainId)

```javascript
function getNetworkConfig(chainId)
```

* 获取网络配置
 * @param {number} chainId - 链ID
 * @returns {object} 网络配置

---

## function getRpcUrl(chainId)

```javascript
function getRpcUrl(chainId)
```

* 获取RPC URL
 * @param {number} chainId - 链ID
 * @returns {string} RPC URL

---

## function isChainSupported(chainId)

```javascript
function isChainSupported(chainId)
```

* 检查链是否支持
 * @param {number} chainId - 链ID
 * @returns {boolean} 是否支持

---

## function getExplorerUrl(chainId, txHash)

```javascript
function getExplorerUrl(chainId, txHash)
```

* 获取区块浏览器 URL
 * @param {number} chainId - 链ID
 * @param {string} txHash - 交易哈希
 * @returns {string} 区块浏览器 URL

---

## function getAddressExplorerUrl(chainId, address)

```javascript
function getAddressExplorerUrl(chainId, address)
```

* 获取地址浏览器 URL
 * @param {number} chainId - 链ID
 * @param {string} address - 地址
 * @returns {string} 区块浏览器 URL

---

