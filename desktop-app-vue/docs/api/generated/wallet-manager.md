# wallet-manager

**Source**: `src\main\blockchain\wallet-manager.js`

**Generated**: 2026-01-27T06:44:03.870Z

---

## const

```javascript
const
```

* 钱包管理器
 *
 * 负责管理内置钱包和外部钱包的所有操作
 * 功能：
 * - 生成HD钱包（BIP39助记词）
 * - 从助记词/私钥导入钱包
 * - 解锁钱包（验证密码）
 * - 签名交易（支持U-Key硬件签名）
 * - 余额查询

---

## const WalletType =

```javascript
const WalletType =
```

* 钱包类型

---

## const WalletProvider =

```javascript
const WalletProvider =
```

* 钱包提供者

---

## const ENCRYPTION_CONFIG =

```javascript
const ENCRYPTION_CONFIG =
```

* 加密算法配置

---

## async initialize()

```javascript
async initialize()
```

* 初始化钱包管理器

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async createWallet(password, chainId = 1)

```javascript
async createWallet(password, chainId = 1)
```

* 生成新钱包（HD钱包）
   * @param {string} password - 密码（用于加密私钥）
   * @param {string} chainId - 链ID（默认以太坊主网）
   * @returns {Promise<object>} 钱包信息 {id, address, mnemonic}

---

## async importFromMnemonic(mnemonic, password, chainId = 1)

```javascript
async importFromMnemonic(mnemonic, password, chainId = 1)
```

* 从助记词导入钱包
   * @param {string} mnemonic - 助记词
   * @param {string} password - 密码
   * @param {number} chainId - 链ID
   * @returns {Promise<object>} 钱包信息

---

## async importFromPrivateKey(privateKey, password, chainId = 1)

```javascript
async importFromPrivateKey(privateKey, password, chainId = 1)
```

* 从私钥导入钱包
   * @param {string} privateKey - 私钥（带或不带 0x 前缀）
   * @param {string} password - 密码
   * @param {number} chainId - 链ID
   * @returns {Promise<object>} 钱包信息

---

## async unlockWallet(walletId, password)

```javascript
async unlockWallet(walletId, password)
```

* 解锁钱包
   * @param {string} walletId - 钱包ID
   * @param {string} password - 密码
   * @returns {Promise<ethers.Wallet>} 解锁的钱包实例

---

## lockWallet(walletId)

```javascript
lockWallet(walletId)
```

* 锁定钱包
   * @param {string} walletId - 钱包ID

---

## async signTransaction(walletId, transaction, useUKey = false)

```javascript
async signTransaction(walletId, transaction, useUKey = false)
```

* 签名交易
   * @param {string} walletId - 钱包ID
   * @param {object} transaction - 交易对象
   * @param {boolean} useUKey - 是否使用U-Key签名
   * @returns {Promise<string>} 签名后的交易

---

## async signMessage(walletId, message, useUKey = false)

```javascript
async signMessage(walletId, message, useUKey = false)
```

* 签名消息
   * @param {string} walletId - 钱包ID
   * @param {string} message - 消息
   * @param {boolean} useUKey - 是否使用U-Key签名
   * @returns {Promise<string>} 签名

---

## async _signWithUKey(walletId, transaction)

```javascript
async _signWithUKey(walletId, transaction)
```

* 使用 U-Key 签名交易
   * @private

---

## async _signMessageWithUKey(walletId, message)

```javascript
async _signMessageWithUKey(walletId, message)
```

* 使用 U-Key 签名消息
   * @private

---

## async getBalance(address, chainId, tokenAddress = null)

```javascript
async getBalance(address, chainId, tokenAddress = null)
```

* 获取余额
   * @param {string} address - 地址
   * @param {number} chainId - 链ID
   * @param {string|null} tokenAddress - 代币合约地址（null表示原生币）
   * @returns {Promise<string>} 余额（字符串）

---

## async getAllWallets()

```javascript
async getAllWallets()
```

* 获取所有钱包
   * @returns {Promise<array>} 钱包列表

---

## async getWallet(walletId)

```javascript
async getWallet(walletId)
```

* 获取钱包详情
   * @param {string} walletId - 钱包ID
   * @returns {Promise<object>} 钱包详情

---

## async getWalletByAddress(address)

```javascript
async getWalletByAddress(address)
```

* 根据地址获取钱包
   * @param {string} address - 地址
   * @returns {Promise<object>} 钱包详情

---

## async setDefaultWallet(walletId)

```javascript
async setDefaultWallet(walletId)
```

* 设置默认钱包
   * @param {string} walletId - 钱包ID

---

## async deleteWallet(walletId)

```javascript
async deleteWallet(walletId)
```

* 删除钱包
   * @param {string} walletId - 钱包ID

---

## async exportPrivateKey(walletId, password)

```javascript
async exportPrivateKey(walletId, password)
```

* 导出私钥
   * @param {string} walletId - 钱包ID
   * @param {string} password - 密码
   * @returns {Promise<string>} 私钥（带 0x 前缀）

---

## async exportMnemonic(walletId, password)

```javascript
async exportMnemonic(walletId, password)
```

* 导出助记词
   * @param {string} walletId - 钱包ID
   * @param {string} password - 密码
   * @returns {Promise<string>} 助记词

---

## _encryptData(data, password)

```javascript
_encryptData(data, password)
```

* 加密数据
   * @param {string} data - 原始数据
   * @param {string} password - 密码
   * @returns {string} 加密后的数据（Base64）

---

## _decryptData(encryptedData, password)

```javascript
_decryptData(encryptedData, password)
```

* 解密数据
   * @param {string} encryptedData - 加密数据（Base64）
   * @param {string} password - 密码
   * @returns {string} 解密后的数据

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

