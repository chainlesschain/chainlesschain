# 区块链功能部署指南

本指南介绍如何部署 ChainlessChain 的区块链功能到测试网和主网。

---

## 📋 前置要求

### 1. 环境准备

```bash
# Node.js 版本要求
node >= 18.0.0
npm >= 9.0.0

# 安装依赖
cd desktop-app-vue/contracts
npm install
```

### 2. 必需的 API 密钥

创建 `desktop-app-vue/contracts/.env.contracts` 文件：

```bash
# 私钥（部署者账户）
DEPLOYER_PRIVATE_KEY=你的私钥

# Etherscan API 密钥（用于合约验证）
ETHERSCAN_API_KEY=你的Etherscan密钥

# Polygonscan API 密钥
POLYGONSCAN_API_KEY=你的Polygonscan密钥

# Infura 项目 ID（可选，用于以太坊）
INFURA_PROJECT_ID=你的Infura项目ID

# Alchemy API 密钥（可选）
ALCHEMY_API_KEY=你的Alchemy密钥
```

### 3. 获取测试币

#### Sepolia（以太坊测试网）
- 水龙头: https://sepoliafaucet.com/
- 备用: https://www.alchemy.com/faucets/ethereum-sepolia

#### Mumbai（Polygon 测试网）
- 水龙头: https://faucet.polygon.technology/
- 备用: https://mumbaifaucet.com/

---

## 🚀 部署流程

### 方式 1: 一键部署所有合约

```bash
cd desktop-app-vue/contracts

# 部署到 Sepolia 测试网
npx hardhat run scripts/deploy-all.js --network sepolia

# 部署到 Mumbai 测试网
npx hardhat run scripts/deploy-all.js --network mumbai

# 部署到本地 Hardhat 网络（开发测试）
npx hardhat run scripts/deploy-all.js --network hardhat
```

**部署内容**:
- ChainlessToken (ERC-20)
- ChainlessNFT (ERC-721)
- EscrowContract
- SubscriptionContract
- BountyContract
- AssetBridge

**输出**:
```
==================================================
Deploying All ChainlessChain Contracts
==================================================

Network: sepolia
Deployer: 0x1234...abcd
Balance: 0.5 ETH

[1/6] Deploying ChainlessToken...
✅ ChainlessToken deployed to: 0xToken123...
...

Deployment Complete!
Contract Addresses:
  ChainlessToken:        0xToken123...
  ChainlessNFT:          0xNFT456...
  EscrowContract:        0xEscrow789...
  SubscriptionContract:  0xSub012...
  BountyContract:        0xBounty345...
  AssetBridge:           0xBridge678...

✅ Deployment data saved to: deployments/sepolia.json
```

### 方式 2: 单独部署合约

```bash
# 仅部署代币
npx hardhat run scripts/deploy-token.js --network sepolia

# 仅部署 NFT
npx hardhat run scripts/deploy-nft.js --network sepolia

# 仅部署托管合约
npx hardhat run scripts/deploy-escrow.js --network sepolia
```

---

## 🔍 验证合约

### 自动验证（推荐）

部署脚本会自动在 Etherscan/Polygonscan 上验证合约。如果自动验证失败，可以手动验证：

```bash
# 验证 ChainlessToken
npx hardhat verify --network sepolia 0xTokenAddress "ChainlessChain Token" "CCT" 18 "1000000000000000000000000"

# 验证 ChainlessNFT
npx hardhat verify --network sepolia 0xNFTAddress "ChainlessChain NFT" "CCNFT"

# 验证 AssetBridge
npx hardhat verify --network sepolia 0xBridgeAddress
```

### 验证状态查询

访问区块浏览器：
- Sepolia: https://sepolia.etherscan.io/address/0xYourContract
- Mumbai: https://mumbai.polygonscan.com/address/0xYourContract

---

## ⚙️ 配置应用

### 1. 注册合约地址

部署完成后，需要在应用中注册合约地址：

```javascript
// 在应用启动时注册
await window.electronAPI.bridge.registerContract({
  chainId: 11155111, // Sepolia
  contractAddress: '0xBridge123...'
});

await window.electronAPI.bridge.registerContract({
  chainId: 80001, // Mumbai
  contractAddress: '0xBridge456...'
});
```

### 2. 配置网络

确保应用中配置了正确的 RPC 端点（已在 `blockchain-config.js` 中配置）：

```javascript
// desktop-app-vue/src/main/blockchain/blockchain-config.js
const networks = {
  1: {
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://mainnet.infura.io/v3/YOUR-PROJECT-ID',
    explorer: 'https://etherscan.io',
  },
  11155111: {
    name: 'Sepolia',
    rpcUrl: 'https://sepolia.infura.io/v3/YOUR-PROJECT-ID',
    explorer: 'https://sepolia.etherscan.io',
  },
  137: {
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com',
  },
  80001: {
    name: 'Mumbai',
    rpcUrl: 'https://rpc-mumbai.maticvigil.com',
    explorer: 'https://mumbai.polygonscan.com',
  },
};
```

### 3. 添加中继者（可选）

如果需要额外的中继者来处理跨链桥接：

```javascript
// 使用 owner 账户添加中继者
const bridgeContract = new ethers.Contract(
  bridgeAddress,
  AssetBridgeABI,
  ownerSigner
);

await bridgeContract.addRelayer('0xRelayerAddress');
```

---

## 🧪 测试部署

### 1. 运行合约测试

```bash
cd desktop-app-vue/contracts

# 运行所有测试
npx hardhat test

# 运行特定测试
npx hardhat test test/AssetBridge.test.js

# 查看测试覆盖率
npx hardhat coverage
```

**预期输出**:
```
  AssetBridge
    Deployment
      ✓ should set the right owner
      ✓ should set deployer as relayer
    Lock Assets
      ✓ should lock assets successfully
      ✓ should emit AssetLocked event
    Mint Assets
      ✓ should mint assets successfully by relayer
      ...

  45 passing (5s)
```

### 2. 本地测试流程

启动本地 Hardhat 节点：

```bash
# 终端 1: 启动节点
npx hardhat node

# 终端 2: 部署到本地网络
npx hardhat run scripts/deploy-all.js --network localhost

# 终端 3: 运行应用
cd ..
npm run dev
```

### 3. 测试网测试清单

- [ ] 创建钱包
- [ ] 获取测试币
- [ ] 部署 ERC-20 代币
- [ ] 铸造代币
- [ ] 转账代币
- [ ] 部署 NFT
- [ ] 铸造 NFT
- [ ] 跨链桥接资产
- [ ] 查询余额
- [ ] 查看交易历史

---

## 📊 Gas 费用估算

### Sepolia 测试网（以太坊）

| 操作 | Gas 消耗 | 费用 (30 Gwei) |
|------|---------|---------------|
| 部署 ChainlessToken | ~800,000 | ~0.024 ETH |
| 部署 ChainlessNFT | ~1,200,000 | ~0.036 ETH |
| 部署 AssetBridge | ~1,500,000 | ~0.045 ETH |
| 锁定资产 | ~100,000 | ~0.003 ETH |
| 铸造资产 | ~80,000 | ~0.0024 ETH |
| ERC-20 转账 | ~50,000 | ~0.0015 ETH |
| NFT 铸造 | ~150,000 | ~0.0045 ETH |

**总计（部署所有合约）**: ~0.15 ETH

### Mumbai 测试网（Polygon）

| 操作 | Gas 消耗 | 费用 (30 Gwei) |
|------|---------|---------------|
| 部署所有合约 | ~5,000,000 | ~0.15 MATIC |
| 单次桥接 | ~180,000 | ~0.0054 MATIC |

**成本优势**: Polygon 费用约为以太坊的 1/100

---

## 🔐 安全建议

### 1. 私钥管理

**开发/测试环境**:
```bash
# 使用环境变量
export DEPLOYER_PRIVATE_KEY=0x...

# 或使用 .env 文件（确保在 .gitignore 中）
echo ".env.contracts" >> .gitignore
```

**生产环境**:
- 使用硬件钱包（Ledger/Trezor）
- 使用 Gnosis Safe 多签钱包
- 永远不要提交私钥到代码仓库

### 2. 合约安全

- ✅ 使用 OpenZeppelin 经过审计的合约库
- ✅ 启用 ReentrancyGuard 防重入攻击
- ✅ 使用 Ownable 控制权限
- ✅ 在主网部署前进行审计

### 3. 中继者安全

```javascript
// 推荐：使用多签钱包作为 owner
const GNOSIS_SAFE_ADDRESS = '0x...';

// 配置多个中继者实现去中心化
await bridgeContract.addRelayer(relayer1);
await bridgeContract.addRelayer(relayer2);
await bridgeContract.addRelayer(relayer3);
```

### 4. 限额控制

考虑为桥接合约添加每日限额：

```solidity
// 在合约中添加（未来版本）
uint256 public dailyLimit = 100000 * 10**18; // 100,000 tokens
mapping(uint256 => uint256) public dailyVolume; // day => volume
```

---

## 🐛 故障排除

### 问题 1: 部署失败 - Gas 不足

**错误**: `Error: insufficient funds for gas * price + value`

**解决方案**:
```bash
# 检查账户余额
npx hardhat run scripts/check-balance.js --network sepolia

# 从水龙头获取更多测试币
```

### 问题 2: 合约验证失败

**错误**: `Error: Etherscan API returned an error`

**解决方案**:
```bash
# 等待 30 秒后重试
sleep 30
npx hardhat verify --network sepolia 0xAddress ...

# 检查 API 密钥是否正确
echo $ETHERSCAN_API_KEY
```

### 问题 3: 交易卡住

**错误**: 交易长时间 pending

**解决方案**:
```bash
# 检查网络状态
curl https://sepolia.infura.io/v3/YOUR-PROJECT-ID \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# 提高 Gas 价格重新发送
# 在 hardhat.config.js 中增加 gasPrice
```

### 问题 4: ABI 未加载

**错误**: `BridgeManager: AssetBridge ABI 文件不存在`

**解决方案**:
```bash
# 重新编译合约
cd desktop-app-vue/contracts
npx hardhat compile

# 检查 artifacts 目录
ls -la artifacts/contracts/bridge/AssetBridge.sol/
```

---

## 📚 相关资源

### 文档
- [Hardhat 文档](https://hardhat.org/docs)
- [OpenZeppelin 合约](https://docs.openzeppelin.com/contracts)
- [Ethers.js 文档](https://docs.ethers.org/v6/)

### 区块浏览器
- [Sepolia Etherscan](https://sepolia.etherscan.io/)
- [Mumbai Polygonscan](https://mumbai.polygonscan.com/)
- [Ethereum Mainnet](https://etherscan.io/)
- [Polygon Mainnet](https://polygonscan.com/)

### 水龙头
- [Sepolia Faucet](https://sepoliafaucet.com/)
- [Mumbai Faucet](https://faucet.polygon.technology/)
- [Alchemy Faucets](https://www.alchemy.com/faucets)

### API 服务
- [Infura](https://infura.io/)
- [Alchemy](https://www.alchemy.com/)
- [QuickNode](https://www.quicknode.com/)

---

## ✅ 部署检查清单

### 测试网部署

- [ ] 准备好部署者账户和私钥
- [ ] 获取足够的测试币
- [ ] 配置 .env.contracts 文件
- [ ] 运行合约测试（`npx hardhat test`）
- [ ] 部署到 Sepolia (`deploy-all.js --network sepolia`)
- [ ] 部署到 Mumbai (`deploy-all.js --network mumbai`)
- [ ] 验证所有合约
- [ ] 在应用中注册合约地址
- [ ] 测试完整功能流程
- [ ] 记录所有合约地址

### 主网部署

- [ ] 完成测试网充分测试
- [ ] 代码审计（推荐）
- [ ] 准备生产环境私钥（硬件钱包）
- [ ] 确认 Gas 价格合理
- [ ] 准备足够的 ETH/MATIC
- [ ] 部署到以太坊主网
- [ ] 部署到 Polygon 主网
- [ ] 验证所有合约
- [ ] 配置中继者（多签）
- [ ] 设置监控和告警
- [ ] 更新应用配置

---

## 🚨 紧急响应

### 暂停合约

如果发现安全问题，立即执行：

```javascript
// 使用 owner 账户调用
await bridgeContract.pause(); // 如果实现了 Pausable

// 或移除所有中继者
await bridgeContract.removeRelayer(relayer1);
await bridgeContract.removeRelayer(relayer2);
```

### 紧急提现

```javascript
// 仅 owner 可以调用
await bridgeContract.emergencyWithdraw(tokenAddress, amount);
```

### 联系方式

- GitHub Issues: https://github.com/chainlesschain/issues
- 技术支持邮箱: support@chainlesschain.com

---

**完成部署后，请保存好 `deployments/` 目录中的部署信息文件！**
