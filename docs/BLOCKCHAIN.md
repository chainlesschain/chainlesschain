# ChainlessChain 区块链文档

本文档详细说明 ChainlessChain 的区块链集成和跨链功能。

## 目录

- [概述](#概述)
- [支持的区块链](#支持的区块链)
- [智能合约](#智能合约)
- [钱包系统](#钱包系统)
- [区块链适配器](#区块链适配器)
- [跨链桥系统](#跨链桥系统)
- [使用指南](#使用指南)

---

## 概述

ChainlessChain 实现了完整的区块链集成，支持15条区块链网络，提供统一的多链交互接口。

### 核心特性

- ✅ **15链支持** - 以太坊、Polygon、BSC、Arbitrum等
- ✅ **6个智能合约** - ERC-20/ERC-721、托管、订阅、悬赏、跨链桥
- ✅ **HD钱包系统** - BIP39/BIP44标准，AES-256加密
- ✅ **外部钱包集成** - MetaMask、WalletConnect
- ✅ **跨链桥** - LayerZero协议，锁定-铸造模式
- ✅ **RPC管理** - 智能切换、故障转移
- ✅ **事件监听** - 实时链上事件同步

---

## 支持的区块链

### 主网

| 区块链                | Chain ID | 说明         |
| --------------------- | -------- | ------------ |
| **Ethereum**          | 1        | 以太坊主网   |
| **Polygon**           | 137      | Polygon主网  |
| **BSC**               | 56       | 币安智能链   |
| **Arbitrum One**      | 42161    | Arbitrum主网 |
| **Optimism**          | 10       | Optimism主网 |
| **Avalanche C-Chain** | 43114    | 雪崩C链      |
| **Base**              | 8453     | Base主网     |

### 测试网

| 区块链               | Chain ID | 说明           |
| -------------------- | -------- | -------------- |
| **Ethereum Sepolia** | 11155111 | 以太坊测试网   |
| **Polygon Mumbai**   | 80001    | Polygon测试网  |
| **BSC Testnet**      | 97       | BSC测试网      |
| **Arbitrum Sepolia** | 421614   | Arbitrum测试网 |
| **Optimism Sepolia** | 11155420 | Optimism测试网 |
| **Avalanche Fuji**   | 43113    | 雪崩测试网     |
| **Base Sepolia**     | 84532    | Base测试网     |

### 本地开发网络

| 网络                | Chain ID | 说明         |
| ------------------- | -------- | ------------ |
| **Hardhat Network** | 31337    | 本地开发网络 |

---

## 智能合约

### 代币合约

#### 1. ChainlessToken (ERC-20)

**功能特性**:

- 标准 ERC-20 代币
- 自定义名称、符号、小数位
- Mint/Burn 功能
- Ownable 权限控制

**部署参数**:

```javascript
{
  name: "Chainless Token",
  symbol: "CLT",
  decimals: 18,
  initialSupply: 1000000
}
```

#### 2. ChainlessNFT (ERC-721)

**功能特性**:

- 标准 ERC-721 NFT
- 元数据 URI 支持
- 批量铸造
- ERC721Enumerable 可枚举扩展
- 安全转账 (safeTransferFrom)

**核心功能**:

- 所有权验证 (ownerOf)
- 余额查询 (balanceOf)
- 元数据 URI 查询 (tokenURI)
- 批量转账支持

### 业务合约

#### 3. EscrowContract (托管合约)

**功能特性**:

- 支持 ETH/MATIC + ERC20 代币
- 争议解决机制
- 仲裁者功能
- ReentrancyGuard 防重入攻击

**工作流程**:

1. 买家创建托管
2. 卖家确认订单
3. 买家确认收货/提出争议
4. 仲裁者解决争议（如有）
5. 资金释放

#### 4. SubscriptionContract (订阅合约)

**功能特性**:

- 按月/按季/按年订阅
- 自动续订机制
- 订阅管理
- 取消订阅

**订阅周期**:

- Monthly (30天)
- Quarterly (90天)
- Yearly (365天)

#### 5. BountyContract (悬赏合约)

**功能特性**:

- 任务发布
- 任务申领
- 提交审核
- 奖金分配
- 支持多人完成

**工作流程**:

1. 发布者创建悬赏任务
2. 参与者申领任务
3. 参与者提交成果
4. 发布者审核
5. 奖金分配给完成者

#### 6. AssetBridge (跨链桥合约)

**功能特性**:

- 锁定-铸造模式
- 中继者权限管理
- 防重复铸造
- 跨链资产转移

**桥接流程**:

1. 源链锁定资产
2. 中继者验证
3. 目标链铸造等量资产

---

## 钱包系统

### HD钱包（内置）

**核心特性**:

- BIP39 助记词生成（12个单词）
- BIP44 派生路径 (m/44'/60'/0'/0/0)
- AES-256-GCM 加密存储
- PBKDF2 密钥派生（100,000次迭代）
- U-Key 硬件签名支持

**功能**:

```javascript
// 创建钱包
const wallet = await walletManager.createWallet(password, chainId);

// 从助记词导入
const wallet = await walletManager.importFromMnemonic(
  mnemonic,
  password,
  chainId,
);

// 从私钥导入
const wallet = await walletManager.importFromPrivateKey(
  privateKey,
  password,
  chainId,
);
```

### 外部钱包

**MetaMask 集成**:

- 自动检测 MetaMask
- 网络切换
- 账户切换
- 交易签名

**WalletConnect 支持**:

- WalletConnect v1 协议
- 移动端钱包连接
- 二维码扫描

---

## 区块链适配器

### 核心功能

**智能合约部署**:

```javascript
// 部署 ERC-20 代币
const { address, txHash } = await blockchainAdapter.deployERC20Token(walletId, {
  name: "My Token",
  symbol: "MTK",
  decimals: 18,
  initialSupply: 1000000,
  password: "your-password",
});

// 部署 NFT 合约
const { address, txHash } = await blockchainAdapter.deployNFT(walletId, {
  name: "My NFT",
  symbol: "MNFT",
  password: "your-password",
});
```

**资产操作**:

```javascript
// 转账代币
const txHash = await blockchainAdapter.transferToken(
  walletId,
  tokenAddress,
  toAddress,
  amount,
  password,
);

// 转账 NFT
const txHash = await blockchainAdapter.transferNFT(
  walletId,
  nftAddress,
  fromAddress,
  toAddress,
  tokenId,
  password,
);

// 查询余额
const balance = await blockchainAdapter.getTokenBalance(
  tokenAddress,
  ownerAddress,
);
```

**网络切换**:

```javascript
// 切换到 Polygon 主网
await blockchainAdapter.switchChain(137);

// 获取当前链信息
const chainInfo = blockchainAdapter.getCurrentChainInfo();
```

### Gas 优化

**三档 Gas 价格**:

- **Slow** - 节省费用
- **Standard** - 平衡选择
- **Fast** - 快速确认

**EIP-1559 支持**:

- maxFeePerGas
- maxPriorityFeePerGas
- 动态 Gas 调整

---

## 跨链桥系统

### 核心特性

**多重安全防护**:

- 多重签名验证（大额转账需2+签名）
- 速率限制（每小时最多10笔）
- 日交易量限制（每日最高10000代币）
- 黑名单系统
- 紧急暂停机制

**自动化中继系统**:

- 12秒轮询间隔
- 12个区块确认
- 自动执行铸造
- 智能重试（最多3次）
- Gas 优化

**费用优化**:

- 动态 Gas 估算
- L2 特殊处理（Arbitrum/Optimism/Base）
- 费用预估

### 桥接模式

#### 1. 锁定-铸造模式（默认）

**流程**:

1. 源链锁定资产到桥接合约
2. 中继者监听锁定事件
3. 验证交易（12个区块确认）
4. 目标链铸造等量包装资产

**适用场景**:

- 大多数 ERC-20 代币
- 标准跨链转账

#### 2. LayerZero 协议（可选）

**特性**:

- 使用 LayerZero 全链互操作协议
- 更快的跨链消息传递
- 支持更多链
- 支持更复杂的跨链操作

**使用示例**:

```javascript
const result = await bridgeManager.bridgeAsset({
  assetId: "asset-uuid",
  fromChainId: 1, // Ethereum
  toChainId: 137, // Polygon
  amount: "100",
  walletId: "wallet-id",
  password: "password",
  useLayerZero: true, // 启用 LayerZero
});
```

### 安全配置

```javascript
// 速率限制
MAX_TRANSFERS_PER_HOUR: 10
MAX_AMOUNT_PER_TRANSFER: 1000
MAX_DAILY_VOLUME: 10000

// 多重签名
MIN_SIGNATURES_REQUIRED: 2
SIGNATURE_TIMEOUT: 5分钟

// 监控阈值
SUSPICIOUS_AMOUNT_THRESHOLD: 100
MAX_RAPID_TRANSFERS: 3
```

### 桥接历史查询

```javascript
// 查询桥接历史
const history = await bridgeManager.getBridgeHistory({
  status: "completed",
  fromChainId: 1,
  limit: 50,
});

// 获取中继统计
const stats = bridgeManager.getRelayerStats();
console.log(`成功中继: ${stats.successfulRelays}`);
console.log(`总费用: ${stats.totalFeesEarned}`);
```

---

## 使用指南

### 快速开始

#### 1. 创建钱包

```javascript
// 生成新钱包
const wallet = await walletManager.createWallet(
  "your-password",
  1, // Ethereum Mainnet
);

// 保存助记词（重要！）
console.log(wallet.mnemonic);
```

#### 2. 部署代币

```javascript
const { address } = await blockchainAdapter.deployERC20Token(walletId, {
  name: "My Token",
  symbol: "MTK",
  decimals: 18,
  initialSupply: 1000000,
  password: "your-password",
});

console.log(`Token deployed at: ${address}`);
```

#### 3. 转账

```javascript
const txHash = await blockchainAdapter.transferToken(
  walletId,
  tokenAddress,
  recipientAddress,
  "100",
  "your-password",
);

console.log(`Transaction: ${txHash}`);
```

#### 4. 跨链转账

```javascript
await bridgeManager.bridgeAsset({
  assetId: "your-asset-id",
  fromChainId: 1, // Ethereum
  toChainId: 137, // Polygon
  amount: "100",
  walletId: walletId,
  password: "your-password",
});
```

### 最佳实践

1. **私钥安全**
   - 妥善保管助记词
   - 使用强密码
   - 启用 U-Key（如有）

2. **Gas 管理**
   - 选择合适的 Gas 档位
   - 避免网络拥堵时交易

3. **跨链转账**
   - 小额测试后再大额转账
   - 确认目标地址正确
   - 注意跨链手续费

4. **合约交互**
   - 验证合约地址
   - 测试网测试后再主网部署
   - 审计智能合约代码

---

## 常见问题

### Q: 如何备份钱包？

A:

1. 导出助记词并妥善保管
2. 导出私钥（可选）
3. 记录钱包地址

### Q: 交易失败怎么办？

A:

1. 检查 Gas 费用是否足够
2. 确认网络连接
3. 查看交易详情和错误信息
4. 在区块浏览器查询交易状态

### Q: 跨链转账需要多久？

A:

- 源链确认: ~12个区块（约3-5分钟）
- 中继处理: ~1-2分钟
- 目标链铸造: ~1-2分钟
- **总计**: 通常5-10分钟

### Q: 如何查看交易记录？

A:

1. 在应用内查看交易历史
2. 使用区块浏览器（Etherscan、Polygonscan等）
3. 导出交易记录为 CSV

---

## 技术支持

### 区块浏览器

- **Ethereum**: https://etherscan.io
- **Polygon**: https://polygonscan.com
- **BSC**: https://bscscan.com
- **Arbitrum**: https://arbiscan.io
- **Optimism**: https://optimistic.etherscan.io
- **Avalanche**: https://snowtrace.io
- **Base**: https://basescan.org

### 获取测试币

- **Sepolia**: https://sepoliafaucet.com
- **Mumbai**: https://faucet.polygon.technology
- **BSC Testnet**: https://testnet.binance.org/faucet-smart

---

## 相关文档

- [返回主文档](../README.md)
- [功能详解](./FEATURES.md)
- [架构文档](./ARCHITECTURE.md)
- [开发指南](./DEVELOPMENT.md)
