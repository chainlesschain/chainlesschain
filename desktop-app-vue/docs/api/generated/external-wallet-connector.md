# external-wallet-connector

**Source**: `src/main/blockchain/external-wallet-connector.js`

**Generated**: 2026-02-21T20:04:16.271Z

---

## const

```javascript
const
```

* 外部钱包连接器
 *
 * 负责连接和管理外部钱包（MetaMask、WalletConnect）
 * 功能：
 * - 连接 MetaMask
 * - 连接 WalletConnect
 * - 切换网络
 * - 监听账户变化
 * - 监听网络变化

---

## const ExternalWalletType =

```javascript
const ExternalWalletType =
```

* 外部钱包类型

---

## async initialize()

```javascript
async initialize()
```

* 初始化连接器

---

## async connectMetaMask()

```javascript
async connectMetaMask()
```

* 连接 MetaMask
   * @returns {Promise<object>} 连接信息 {address, chainId}

---

## async connectWalletConnect()

```javascript
async connectWalletConnect()
```

* 连接 WalletConnect
   * @returns {Promise<object>} 连接信息 {address, chainId}

---

## async disconnect()

```javascript
async disconnect()
```

* 断开连接

---

## async switchChain(chainId)

```javascript
async switchChain(chainId)
```

* 切换网络
   * @param {number} chainId - 目标链ID

---

## async addChain(chainId)

```javascript
async addChain(chainId)
```

* 添加网络
   * @param {number} chainId - 链ID

---

## async signMessage(message)

```javascript
async signMessage(message)
```

* 请求签名
   * @param {string} message - 消息
   * @returns {Promise<string>} 签名

---

## async sendTransaction(transaction)

```javascript
async sendTransaction(transaction)
```

* 发送交易
   * @param {object} transaction - 交易参数
   * @returns {Promise<string>} 交易哈希

---

## _setupMetaMaskListeners()

```javascript
_setupMetaMaskListeners()
```

* 设置 MetaMask 监听器
   * @private

---

## _setupWalletConnectListeners()

```javascript
_setupWalletConnectListeners()
```

* 设置 WalletConnect 监听器
   * @private

---

## async _saveExternalWallet(

```javascript
async _saveExternalWallet(
```

* 保存外部钱包到数据库
   * @private

---

## getConnectionStatus()

```javascript
getConnectionStatus()
```

* 获取当前连接状态

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

