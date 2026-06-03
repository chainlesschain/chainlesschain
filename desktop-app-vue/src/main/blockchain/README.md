# ChainlessChain 区块链模块

区块链钱包和交易管理系统，支持多链（以太坊 + Polygon）和硬件签名（U-Key）。

## 📦 模块组成

### 核心模块

1. **wallet-manager.js** (900+ 行)
   - HD 钱包生成（BIP39 + BIP44）
   - 助记词/私钥导入导出
   - AES-256-GCM 强加密存储
   - 交易和消息签名
   - U-Key 硬件签名支持
   - 余额查询

2. **blockchain-adapter.js**
   - 多链支持（以太坊、Polygon）
   - 统一的 RPC 接口
   - 合约部署和交互
   - 网络切换

3. **transaction-monitor.js** (350+ 行)
   - 交易状态监控
   - 自动确认等待
   - 数据库持久化
   - 交易历史查询

4. **external-wallet-connector.js** (420+ 行)
   - MetaMask 连接
   - WalletConnect 集成
   - 网络切换和事件监听

5. **blockchain-config.js**
   - 支持 5 个网络配置
   - RPC 端点管理
   - Gas 价格建议

## 🚀 快速开始

### 1. 安装依赖

```bash
cd desktop-app-vue

# 核心依赖
npm install --save ethers@^6.13.0 hdkey@^2.1.0 web3modal@^1.9.12 \
  @metamask/detect-provider@^2.0.0 @walletconnect/web3-provider@^1.8.0

# 开发依赖
npm install --save-dev hardhat@^2.22.0 @nomicfoundation/hardhat-toolbox@^5.0.0 \
  @openzeppelin/contracts@^5.2.0 @openzeppelin/hardhat-upgrades@^3.2.0
```

### 2. 运行测试

```bash
# 测试钱包功能
node scripts/test-blockchain-wallet.js
```

### 3. 使用示例

#### 在主进程中使用

钱包管理器已经在 `index.js` 中初始化，可以直接使用：

```javascript
// 在 IPC 处理器中
ipcMain.handle('my-custom-handler', async (_event) => {
  // 使用 this.walletManager
  const wallets = await this.walletManager.getAllWallets();
  return wallets;
});
```

#### 在渲染进程中使用

通过 IPC 与主进程通信：

```javascript
// 创建钱包
const wallet = await window.ipcRenderer.invoke('wallet:create', {
  password: 'SecurePassword123!',
  chainId: 1 // 以太坊主网
});

console.log('钱包地址:', wallet.address);
console.log('助记词:', wallet.mnemonic); // ⚠️ 请安全备份！

// 解锁钱包
await window.ipcRenderer.invoke('wallet:unlock', {
  walletId: wallet.id,
  password: 'SecurePassword123!'
});

// 签名消息
const signature = await window.ipcRenderer.invoke('wallet:sign-message', {
  walletId: wallet.id,
  message: 'Hello, Blockchain!',
  useUKey: false // 设为 true 使用 U-Key
});

// 获取余额
const balance = await window.ipcRenderer.invoke('wallet:get-balance', {
  address: wallet.address,
  chainId: 1,
  tokenAddress: null // null = 原生币 (ETH/MATIC)
});

console.log('余额:', balance, 'ETH');
```

## 📚 API 文档

### WalletManager

#### 创建和导入

```javascript
// 创建新钱包
createWallet(password, chainId = 1)
// 返回: { id, address, mnemonic, chainId, createdAt }

// 从助记词导入
importFromMnemonic(mnemonic, password, chainId = 1)
// 返回: { id, address, chainId, createdAt }

// 从私钥导入
importFromPrivateKey(privateKey, password, chainId = 1)
// 返回: { id, address, chainId, createdAt }
```

#### 钱包操作

```javascript
// 解锁钱包
unlockWallet(walletId, password)
// 返回: ethers.Wallet 实例

// 锁定钱包
lockWallet(walletId)

// 获取所有钱包
getAllWallets()
// 返回: Array<Wallet>

// 设置默认钱包
setDefaultWallet(walletId)

// 删除钱包
deleteWallet(walletId)
```

#### 签名操作

```javascript
// 签名交易
signTransaction(walletId, transaction, useUKey = false)
// 返回: 签名后的交易十六进制字符串

// 签名消息
signMessage(walletId, message, useUKey = false)
// 返回: 签名字符串

// 获取余额
getBalance(address, chainId, tokenAddress = null)
// 返回: 余额字符串
```

#### 导出操作

```javascript
// 导出私钥
exportPrivateKey(walletId, password)
// 返回: 0x开头的私钥字符串

// 导出助记词
exportMnemonic(walletId, password)
// 返回: 助记词字符串
```

### IPC 接口

所有可用的 IPC 处理器：

```javascript
// 钱包管理
'wallet:create'              // 创建钱包
'wallet:import-mnemonic'     // 从助记词导入
'wallet:import-private-key'  // 从私钥导入
'wallet:unlock'              // 解锁钱包
'wallet:lock'                // 锁定钱包
'wallet:get-all'             // 获取所有钱包
'wallet:get'                 // 获取钱包详情
'wallet:set-default'         // 设置默认钱包
'wallet:delete'              // 删除钱包
'wallet:export-private-key'  // 导出私钥
'wallet:export-mnemonic'     // 导出助记词

// 签名操作
'wallet:sign-transaction'    // 签名交易
'wallet:sign-message'        // 签名消息
'wallet:get-balance'         // 获取余额

// 外部钱包
'wallet:save-external'       // 保存外部钱包信息

// 区块链操作
'blockchain:switch-chain'    // 切换网络
'blockchain:get-tx-history'  // 获取交易历史
'blockchain:get-transaction' // 获取交易详情
```

## 🔐 安全特性

### 1. 强加密存储

- **算法**: AES-256-GCM（认证加密）
- **密钥派生**: PBKDF2（100,000 次迭代）
- **随机盐**: 64 字节
- **初始化向量**: 16 字节（每次加密不同）
- **认证标签**: 16 字节（防篡改）

### 2. U-Key 硬件签名

支持使用 U-Key 进行硬件级签名：

```javascript
// 启用 U-Key 签名
await window.ipcRenderer.invoke('wallet:sign-transaction', {
  walletId: 'wallet-id',
  transaction: txObject,
  useUKey: true // 使用 U-Key
});
```

**工作流程**:
1. 序列化交易数据为哈希
2. 调用 U-Key 对哈希进行签名
3. 转换签名格式（DER → Ethereum）
4. 恢复 v 参数并验证地址
5. 组装签名后的交易

### 3. 数据库加密

- 所有钱包数据存储在 SQLCipher 加密数据库
- 私钥和助记词双重加密（密码 + 数据库）

### 4. 安全建议

⚠️ **重要提示**:

1. **助记词备份**: 创建钱包后立即备份助记词，最好使用纸质离线存储
2. **密码强度**: 使用至少 8 位包含大小写字母、数字和特殊字符的密码
3. **私钥保护**: 永远不要在网络上传输私钥
4. **测试先行**: 在测试网测试后再使用主网
5. **小额测试**: 首次使用时先转入小额资金测试

## 🌐 支持的网络

| 网络 | Chain ID | RPC | 测试币 |
|------|----------|-----|--------|
| 以太坊主网 | 1 | Infura/Alchemy | - |
| Sepolia 测试网 | 11155111 | Alchemy | [水龙头](https://sepoliafaucet.com/) |
| Polygon 主网 | 137 | Polygon RPC | - |
| Mumbai 测试网 | 80001 | Polygon RPC | [水龙头](https://faucet.polygon.technology/) |
| Hardhat 本地 | 31337 | localhost:8545 | 自动分配 |

## 📝 数据库 Schema

### blockchain_wallets

```sql
CREATE TABLE blockchain_wallets (
  id TEXT PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  wallet_type TEXT NOT NULL,        -- 'internal' | 'external'
  provider TEXT,                     -- 'builtin' | 'metamask' | 'walletconnect'
  encrypted_private_key TEXT,        -- AES-256-GCM 加密
  mnemonic_encrypted TEXT,           -- AES-256-GCM 加密
  derivation_path TEXT,              -- BIP44 路径
  chain_id INTEGER,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

### blockchain_transactions

```sql
CREATE TABLE blockchain_transactions (
  id TEXT PRIMARY KEY,
  tx_hash TEXT UNIQUE NOT NULL,
  chain_id INTEGER NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT,
  value TEXT,                        -- Wei 单位（字符串）
  gas_used TEXT,
  gas_price TEXT,
  status TEXT,                       -- 'pending' | 'confirmed' | 'failed'
  block_number INTEGER,
  tx_type TEXT,
  local_ref_id TEXT,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
```

## 🧪 测试

### 运行测试

```bash
node scripts/test-blockchain-wallet.js
```

### 测试覆盖

- ✅ 创建 HD 钱包
- ✅ 从助记词导入
- ✅ 从私钥导入
- ✅ 解锁/锁定钱包
- ✅ 签名消息（EIP-191）
- ✅ 签名验证
- ✅ 导出私钥/助记词
- ✅ 设置默认钱包
- ✅ 删除钱包
- ✅ 错误处理（错误密码、重复钱包、无效助记词）

## 🔧 故障排除

### 常见问题

#### 1. 依赖安装失败

```bash
# 清除缓存重新安装
rm -rf node_modules package-lock.json
npm install
```

#### 2. 钱包初始化失败

检查数据库是否正确初始化：

```javascript
const db = database.db;
const stmt = db.prepare('SELECT 1 FROM blockchain_wallets LIMIT 1');
stmt.get(); // 应该不抛出错误
```

#### 3. U-Key 签名失败

确保 U-Key 已连接并解锁：

```javascript
// 检测 U-Key
const status = await this.ukeyManager.detect();
console.log('U-Key 状态:', status);

// 解锁 U-Key
await this.ukeyManager.verifyPIN('123456');
```

#### 4. 余额查询失败

确保区块链适配器已正确初始化且 RPC 可用：

```javascript
// 检查提供者
const provider = this.blockchainAdapter.getProvider();
console.log('当前网络:', await provider.getNetwork());
```

## 🛣️ 路线图

### 已完成 ✅
- HD 钱包生成和导入
- 强加密存储
- 交易和消息签名
- U-Key 硬件签名
- 外部钱包集成框架

### 待完成 🔄
- 区块链适配器完整实现
- 智能合约交互
- 代币转账功能
- 跨链桥
- 前端 UI

## 📄 许可证

MIT License - 详见项目根目录 LICENSE 文件

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

如有问题，请查看：
- [系统设计文档](../../../系统设计_个人移动AI管理系统.md)
- [实现计划](../../../../.claude/plans/gentle-cooking-blossom.md)
- [进度报告](../../../../BLOCKCHAIN_INTEGRATION_PROGRESS.md)
