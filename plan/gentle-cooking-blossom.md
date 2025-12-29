# ChainlessChain 区块链集成实现计划

## 项目概览

将区块链功能集成到 ChainlessChain 桌面应用中，实现多链支持（以太坊 + Polygon）、混合模式（重要操作上链、高频操作本地）、完整钱包系统（内置 + 外部）。

## 用户需求

- **多链支持**: 以太坊主网 + Polygon（通过统一适配器）
- **集成模式**: 混合模式（代币发行、NFT铸造、关键合约上链；订单匹配、信用评分保持本地）
- **核心功能**: ERC-20代币发行、ERC-721/1155 NFT铸造、智能合约执行、资产跨链桥
- **钱包系统**: 内置钱包（U-Key加密签名）+ 外部钱包（MetaMask/WalletConnect）

---

## 架构设计

### 1. 多链抽象层设计

创建 `blockchain-adapter.js` 作为统一接口，支持以太坊和 Polygon 的无缝切换：

```
desktop-app-vue/src/main/blockchain/
├── blockchain-adapter.js          # 核心适配器（统一API）
├── ethereum-provider.js           # 以太坊网络提供者
├── polygon-provider.js            # Polygon网络提供者
├── wallet-manager.js              # 钱包管理（内置 + 外部）
├── contract-deployer.js           # 合约部署工具
├── bridge-manager.js              # 跨链桥管理
├── transaction-monitor.js         # 交易监控和状态同步
├── gas-optimizer.js               # Gas费用优化
└── blockchain-config.js           # 网络配置（RPC端点、链ID等）
```

### 2. 混合模式分层

**链上操作（On-Chain）**:
- ERC-20 代币发行和转账
- ERC-721/1155 NFT 铸造和交易
- 核心智能合约（托管合约、订阅合约、悬赏合约）
- 最终结算和争议解决

**链下操作（Off-Chain）**:
- 订单创建和匹配（marketplace-manager.js）
- 信用评分计算（credit-score.js）
- 评价系统（review-manager.js）
- 普通资产转账（仅更新本地数据库）
- 合约草稿和编辑

**同步策略**:
- 链上事件监听 → 更新本地数据库（transaction-monitor.js）
- 本地数据库作为缓存层，提供快速查询
- 定期同步确保数据一致性

### 3. 智能合约架构

```
desktop-app-vue/contracts/          # Solidity智能合约
├── hardhat.config.js               # Hardhat配置
├── .env.contracts                  # 合约环境变量
├── scripts/
│   ├── deploy-token.js             # 部署ERC-20脚本
│   ├── deploy-nft.js               # 部署NFT脚本
│   ├── deploy-escrow.js            # 部署托管合约脚本
│   └── verify-contracts.js         # 合约验证脚本
├── contracts/
│   ├── tokens/
│   │   ├── ChainlessToken.sol      # ERC-20代币合约
│   │   └── ChainlessNFT.sol        # ERC-721 NFT合约
│   ├── marketplace/
│   │   ├── EscrowContract.sol      # 托管合约
│   │   ├── MarketplaceV2.sol       # 市场合约
│   │   └── MultiSigEscrow.sol      # 多签托管
│   ├── payment/
│   │   ├── SubscriptionContract.sol # 订阅合约
│   │   └── BountyContract.sol       # 悬赏合约
│   └── bridge/
│       └── AssetBridge.sol          # 跨链桥合约
├── test/                            # 合约测试
└── artifacts/                       # 编译产物
```

---

## 技术选型

### NPM 依赖（新增）

```json
{
  "dependencies": {
    "ethers": "^6.13.0",                    // 以太坊交互库
    "@walletconnect/web3-provider": "^1.8.0", // WalletConnect
    "web3modal": "^1.9.12",                 // 多钱包连接
    "hdkey": "^2.1.0",                      // HD钱包密钥派生
    "@metamask/detect-provider": "^2.0.0"   // MetaMask检测
  },
  "devDependencies": {
    "hardhat": "^2.22.0",                   // 智能合约开发框架
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "@openzeppelin/contracts": "^5.2.0",    // OpenZeppelin合约库
    "@openzeppelin/hardhat-upgrades": "^3.2.0",
    "hardhat-gas-reporter": "^2.2.0",       // Gas费用报告
    "solidity-coverage": "^0.8.0"           // 测试覆盖率
  }
}
```

### 网络配置

- **以太坊主网**: RPC 通过 Infura/Alchemy
- **Polygon主网**: RPC 通过 Polygon官方或QuickNode
- **测试网**: Sepolia (以太坊), Mumbai (Polygon)
- **本地开发**: Hardhat Network

---

## 详细实施步骤

### 阶段 1: 基础设施搭建 (3-5天)

#### 1.1 初始化 Hardhat 项目
- 在 `desktop-app-vue/` 下创建 `contracts/` 目录
- 安装 Hardhat 和相关依赖
- 配置 `hardhat.config.js`（支持多网络）
- 配置环境变量 `.env.contracts`（API密钥、私钥）

#### 1.2 创建区块链模块目录结构
```bash
mkdir -p desktop-app-vue/src/main/blockchain
```
创建以下文件（空骨架）：
- blockchain-adapter.js
- ethereum-provider.js
- polygon-provider.js
- wallet-manager.js
- blockchain-config.js

#### 1.3 数据库 Schema 扩展
修改 `desktop-app-vue/src/main/database.js`，新增表：

```sql
-- 区块链钱包表
CREATE TABLE blockchain_wallets (
  id TEXT PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  wallet_type TEXT NOT NULL,  -- 'internal' | 'external'
  provider TEXT,               -- 'metamask' | 'walletconnect' | 'builtin'
  encrypted_private_key TEXT,  -- 仅内置钱包，AES-256加密
  mnemonic_encrypted TEXT,     -- 助记词加密（可选）
  derivation_path TEXT,        -- HD路径
  chain_id INTEGER,            -- 1 (以太坊), 137 (Polygon)
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 链上资产表
CREATE TABLE blockchain_assets (
  id TEXT PRIMARY KEY,
  local_asset_id TEXT,         -- 关联本地assets表
  contract_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  token_type TEXT,             -- 'ERC20' | 'ERC721' | 'ERC1155'
  token_id TEXT,               -- NFT ID（ERC721/1155）
  deployment_tx TEXT,          -- 部署交易哈希
  deployed_at INTEGER,
  UNIQUE(contract_address, chain_id, token_id)
);

-- 区块链交易表
CREATE TABLE blockchain_transactions (
  id TEXT PRIMARY KEY,
  tx_hash TEXT UNIQUE NOT NULL,
  chain_id INTEGER NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT,
  value TEXT,                  -- Wei单位的字符串
  gas_used TEXT,
  gas_price TEXT,
  status TEXT,                 -- 'pending' | 'confirmed' | 'failed'
  block_number INTEGER,
  tx_type TEXT,                -- 'transfer' | 'mint' | 'contract_call'
  local_ref_id TEXT,           -- 关联本地交易ID
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);

-- 智能合约部署记录
CREATE TABLE deployed_contracts (
  id TEXT PRIMARY KEY,
  contract_name TEXT NOT NULL,
  contract_type TEXT,          -- 'escrow' | 'token' | 'nft' | 'subscription'
  contract_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  deployment_tx TEXT,
  deployer_address TEXT,
  abi_json TEXT,               -- 合约ABI（JSON字符串）
  local_contract_id TEXT,      -- 关联本地contracts表
  deployed_at INTEGER NOT NULL,
  UNIQUE(contract_address, chain_id)
);

-- 跨链桥记录
CREATE TABLE bridge_transfers (
  id TEXT PRIMARY KEY,
  from_chain_id INTEGER NOT NULL,
  to_chain_id INTEGER NOT NULL,
  from_tx_hash TEXT,
  to_tx_hash TEXT,
  asset_id TEXT,
  amount TEXT,
  status TEXT,                 -- 'pending' | 'completed' | 'failed'
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

### 阶段 2: 钱包系统实现 (5-7天)

#### 2.1 内置钱包实现 (`wallet-manager.js`)

核心功能：
```javascript
class WalletManager extends EventEmitter {
  // 生成新钱包（HD钱包，BIP39助记词）
  async createWallet(password)

  // 从助记词恢复钱包
  async importFromMnemonic(mnemonic, password)

  // 从私钥导入
  async importFromPrivateKey(privateKey, password)

  // 解锁钱包（验证密码，返回Ethers.js Wallet实例）
  async unlockWallet(walletId, password)

  // 签名交易（集成U-Key）
  async signTransaction(walletId, tx, useUKey = false)

  // 签名消息
  async signMessage(walletId, message, useUKey = false)

  // 获取余额（ETH + ERC20代币）
  async getBalance(address, chainId, tokenAddress = null)
}
```

**U-Key 集成**:
- 私钥使用 SQLCipher 加密存储
- 签名时调用 `ukey-manager.js` 进行硬件签名
- 支持 PIN 码验证
- 签名流程：数据库读取加密私钥 → U-Key解密 → 签名 → 广播交易

#### 2.2 外部钱包集成

创建 `external-wallet-connector.js`:
```javascript
class ExternalWalletConnector {
  // 连接 MetaMask
  async connectMetaMask()

  // 连接 WalletConnect
  async connectWalletConnect()

  // 切换网络
  async switchChain(chainId)

  // 监听账户变化
  onAccountsChanged(callback)

  // 监听网络变化
  onChainChanged(callback)
}
```

#### 2.3 钱包 IPC 处理器

在 `desktop-app-vue/src/main/index.js` 中添加：
```javascript
ipcMain.handle('wallet:create', async (_event, password) => {
  return await this.walletManager.createWallet(password);
});

ipcMain.handle('wallet:import-mnemonic', async (_event, { mnemonic, password }) => {
  return await this.walletManager.importFromMnemonic(mnemonic, password);
});

ipcMain.handle('wallet:connect-metamask', async () => {
  return await this.externalWalletConnector.connectMetaMask();
});

ipcMain.handle('wallet:get-balance', async (_event, { address, chainId }) => {
  return await this.walletManager.getBalance(address, chainId);
});

ipcMain.handle('wallet:sign-transaction', async (_event, { walletId, tx, useUKey }) => {
  return await this.walletManager.signTransaction(walletId, tx, useUKey);
});
```

### 阶段 3: 智能合约开发 (7-10天)

#### 3.1 ERC-20 代币合约 (`ChainlessToken.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ChainlessToken is ERC20, Ownable {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
```

#### 3.2 ERC-721 NFT 合约 (`ChainlessNFT.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ChainlessNFT is ERC721URIStorage, Ownable {
    uint256 private _tokenIdCounter;

    constructor(string memory name, string memory symbol)
        ERC721(name, symbol)
        Ownable(msg.sender)
    {}

    function mint(address to, string memory uri) public returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }
}
```

#### 3.3 托管合约 (`EscrowContract.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract EscrowContract is ReentrancyGuard {
    enum State { Created, Funded, Delivered, Completed, Refunded, Disputed }

    struct Escrow {
        address buyer;
        address seller;
        uint256 amount;
        State state;
        uint256 createdAt;
    }

    mapping(bytes32 => Escrow) public escrows;

    event EscrowCreated(bytes32 indexed escrowId, address buyer, address seller, uint256 amount);
    event EscrowCompleted(bytes32 indexed escrowId);
    event EscrowRefunded(bytes32 indexed escrowId);

    function createEscrow(bytes32 escrowId, address seller) public payable {
        require(msg.value > 0, "Must send ETH");
        require(escrows[escrowId].buyer == address(0), "Escrow exists");

        escrows[escrowId] = Escrow({
            buyer: msg.sender,
            seller: seller,
            amount: msg.value,
            state: State.Funded,
            createdAt: block.timestamp
        });

        emit EscrowCreated(escrowId, msg.sender, seller, msg.value);
    }

    function release(bytes32 escrowId) public nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.buyer == msg.sender, "Only buyer");
        require(escrow.state == State.Funded, "Invalid state");

        escrow.state = State.Completed;
        payable(escrow.seller).transfer(escrow.amount);

        emit EscrowCompleted(escrowId);
    }

    function refund(bytes32 escrowId) public nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.seller == msg.sender || escrow.buyer == msg.sender, "Unauthorized");
        require(escrow.state == State.Funded, "Invalid state");

        escrow.state = State.Refunded;
        payable(escrow.buyer).transfer(escrow.amount);

        emit EscrowRefunded(escrowId);
    }
}
```

#### 3.4 订阅合约 (`SubscriptionContract.sol`)

支持按月订阅知识付费内容。

#### 3.5 悬赏合约 (`BountyContract.sol`)

支持任务悬赏和奖金分配。

### 阶段 4: 区块链适配器实现 (5-7天)

#### 4.1 核心适配器 (`blockchain-adapter.js`)

```javascript
class BlockchainAdapter extends EventEmitter {
  constructor(database, walletManager) {
    super();
    this.database = database;
    this.walletManager = walletManager;
    this.providers = new Map(); // chainId => Provider
    this.currentChainId = 1; // 默认以太坊主网
  }

  async initialize() {
    // 初始化以太坊和 Polygon 提供者
    const ethProvider = new EthereumProvider(config.ethereum);
    const polygonProvider = new PolygonProvider(config.polygon);

    this.providers.set(1, ethProvider);      // 以太坊主网
    this.providers.set(137, polygonProvider); // Polygon主网

    await ethProvider.initialize();
    await polygonProvider.initialize();
  }

  // 切换网络
  async switchChain(chainId) {
    if (!this.providers.has(chainId)) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }
    this.currentChainId = chainId;
    this.emit('chain:switched', chainId);
  }

  // 获取当前提供者
  getProvider() {
    return this.providers.get(this.currentChainId);
  }

  // 部署 ERC-20 代币
  async deployERC20Token(walletId, { name, symbol, decimals, initialSupply }) {
    const provider = this.getProvider();
    const wallet = await this.walletManager.unlockWallet(walletId);

    // 使用 ethers.js ContractFactory 部署合约
    // 返回合约地址和交易哈希
  }

  // 部署 NFT
  async deployNFT(walletId, { name, symbol }) {
    // 类似 deployERC20Token
  }

  // 铸造 NFT
  async mintNFT(walletId, contractAddress, to, metadataURI) {
    const provider = this.getProvider();
    const contract = new ethers.Contract(contractAddress, NFT_ABI, provider);
    // 调用 mint 方法
  }

  // 发送代币
  async transferToken(walletId, tokenAddress, to, amount) {
    // ERC-20 transfer
  }

  // 监听区块链事件
  async listenToEvents(contractAddress, eventName, callback) {
    const provider = this.getProvider();
    const contract = new ethers.Contract(contractAddress, ABI, provider);
    contract.on(eventName, callback);
  }
}
```

#### 4.2 交易监控器 (`transaction-monitor.js`)

```javascript
class TransactionMonitor extends EventEmitter {
  constructor(blockchainAdapter, database) {
    super();
    this.adapter = blockchainAdapter;
    this.database = database;
    this.pendingTxs = new Map(); // txHash => { retries, callback }
  }

  // 提交交易并监控状态
  async submitAndMonitor(tx, options = {}) {
    const txResponse = await tx.send();
    const txHash = txResponse.hash;

    // 保存到数据库（状态: pending）
    await this.saveTx(txHash, 'pending');

    // 启动监控
    this.monitorTx(txHash, options.onConfirmed, options.onFailed);

    return txHash;
  }

  // 监控交易确认
  async monitorTx(txHash, onConfirmed, onFailed) {
    const provider = this.adapter.getProvider();

    try {
      const receipt = await provider.waitForTransaction(txHash, 1); // 等待1个确认

      if (receipt.status === 1) {
        await this.updateTxStatus(txHash, 'confirmed', receipt);
        onConfirmed?.(receipt);
        this.emit('tx:confirmed', { txHash, receipt });
      } else {
        await this.updateTxStatus(txHash, 'failed', receipt);
        onFailed?.(receipt);
        this.emit('tx:failed', { txHash, receipt });
      }
    } catch (error) {
      await this.updateTxStatus(txHash, 'failed');
      onFailed?.(error);
      this.emit('tx:failed', { txHash, error });
    }
  }

  async saveTx(txHash, status) {
    // 保存到 blockchain_transactions 表
  }

  async updateTxStatus(txHash, status, receipt = null) {
    // 更新数据库
  }
}
```

### 阶段 5: 集成到现有模块 (7-10天)

#### 5.1 扩展 AssetManager (`asset-manager.js`)

修改现有的 `createAsset` 方法，支持链上资产：

```javascript
class AssetManager extends EventEmitter {
  constructor(database, didManager, p2pManager, blockchainAdapter) {
    super();
    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;
    this.blockchainAdapter = blockchainAdapter; // 新增
  }

  /**
   * 创建资产（扩展版本）
   * @param {Object} options - 资产选项
   * @param {boolean} options.onChain - 是否部署到区块链
   */
  async createAsset(options) {
    const { onChain = false, chainId, walletId, ...assetData } = options;

    // 1. 创建本地资产记录（原有逻辑）
    const localAsset = await this._createLocalAsset(assetData);

    // 2. 如果需要上链，部署智能合约
    if (onChain) {
      try {
        let contractAddress, deployTx;

        if (assetData.asset_type === AssetType.TOKEN) {
          // 部署 ERC-20
          const result = await this.blockchainAdapter.deployERC20Token(walletId, {
            name: assetData.name,
            symbol: assetData.symbol,
            decimals: assetData.decimals,
            initialSupply: assetData.total_supply,
          });
          contractAddress = result.address;
          deployTx = result.txHash;
        } else if (assetData.asset_type === AssetType.NFT) {
          // 部署 ERC-721
          const result = await this.blockchainAdapter.deployNFT(walletId, {
            name: assetData.name,
            symbol: assetData.symbol,
          });
          contractAddress = result.address;
          deployTx = result.txHash;
        }

        // 3. 保存区块链资产记录
        await this._saveBlockchainAsset({
          local_asset_id: localAsset.id,
          contract_address: contractAddress,
          chain_id: chainId,
          token_type: assetData.asset_type === AssetType.TOKEN ? 'ERC20' : 'ERC721',
          deployment_tx: deployTx,
        });

        this.emit('asset:deployed', { localAsset, contractAddress });
      } catch (error) {
        console.error('[AssetManager] 部署失败:', error);
        throw error;
      }
    }

    return localAsset;
  }

  /**
   * 转账资产（扩展版本）
   */
  async transferAsset(options) {
    const { assetId, fromDid, toDid, amount, onChain = false } = options;

    // 1. 执行本地转账（原有逻辑）
    const localTransfer = await this._transferLocal(assetId, fromDid, toDid, amount);

    // 2. 如果需要上链
    if (onChain) {
      const blockchainAsset = await this._getBlockchainAsset(assetId);
      if (blockchainAsset) {
        // 调用区块链转账
        const txHash = await this.blockchainAdapter.transferToken(
          options.walletId,
          blockchainAsset.contract_address,
          options.toAddress,
          amount
        );

        localTransfer.blockchain_tx = txHash;
        this.emit('transfer:onchain', { localTransfer, txHash });
      }
    }

    return localTransfer;
  }
}
```

**关键文件**: `desktop-app-vue/src/main/trade/asset-manager.js` (修改)

#### 5.2 扩展 SmartContractEngine (`contract-engine.js`)

修改 `createContract` 方法，支持链上合约部署：

```javascript
class SmartContractEngine extends EventEmitter {
  constructor(database, didManager, assetManager, escrowManager, blockchainAdapter) {
    super();
    this.blockchainAdapter = blockchainAdapter; // 新增
    // ... 其他初始化
  }

  async createContract(options) {
    const { onChain = false, chainId, walletId, ...contractData } = options;

    // 1. 创建本地合约记录
    const localContract = await this._createLocalContract(contractData);

    // 2. 如果需要上链
    if (onChain) {
      let deployedAddress;

      switch (contractData.contract_type) {
        case ContractType.SIMPLE_TRADE:
          // 部署托管合约
          deployedAddress = await this._deployEscrowContract(walletId, chainId, contractData);
          break;
        case ContractType.SUBSCRIPTION:
          // 部署订阅合约
          deployedAddress = await this._deploySubscriptionContract(walletId, chainId, contractData);
          break;
        // ... 其他类型
      }

      // 保存部署记录
      await this._saveDeployedContract({
        local_contract_id: localContract.id,
        contract_address: deployedAddress,
        chain_id: chainId,
        contract_type: contractData.contract_type,
      });
    }

    return localContract;
  }

  async _deployEscrowContract(walletId, chainId, contractData) {
    // 使用 contract-deployer.js 部署托管合约
    const deployer = new ContractDeployer(this.blockchainAdapter);
    const result = await deployer.deployEscrow({
      walletId,
      chainId,
      buyer: contractData.parties.buyer,
      seller: contractData.parties.seller,
      amount: contractData.amount,
    });
    return result.address;
  }
}
```

**关键文件**: `desktop-app-vue/src/main/trade/contract-engine.js` (修改)

#### 5.3 创建合约部署器 (`contract-deployer.js`)

```javascript
class ContractDeployer {
  constructor(blockchainAdapter) {
    this.adapter = blockchainAdapter;
  }

  async deployEscrow(options) {
    const { walletId, chainId, buyer, seller } = options;

    // 切换到目标链
    await this.adapter.switchChain(chainId);

    // 获取钱包
    const wallet = await this.adapter.walletManager.unlockWallet(walletId);

    // 加载合约 ABI 和 Bytecode
    const factory = new ethers.ContractFactory(ESCROW_ABI, ESCROW_BYTECODE, wallet);

    // 部署
    const contract = await factory.deploy(/* constructor args */);
    await contract.waitForDeployment();

    return {
      address: await contract.getAddress(),
      txHash: contract.deploymentTransaction().hash,
    };
  }

  async deploySubscription(options) {
    // 类似 deployEscrow
  }
}
```

**关键文件**: `desktop-app-vue/src/main/blockchain/contract-deployer.js` (新建)

### 阶段 6: 前端 UI 适配 (5-7天)

#### 6.1 新增钱包管理页面

**文件**: `desktop-app-vue/src/renderer/pages/Wallet.vue`

```vue
<template>
  <div class="wallet-page">
    <a-card title="钱包管理">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 内置钱包 -->
        <a-tab-pane key="internal" tab="内置钱包">
          <a-button @click="showCreateWallet = true">创建钱包</a-button>
          <a-button @click="showImportWallet = true">导入钱包</a-button>

          <a-list :data-source="internalWallets">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.address"
                  :description="`余额: ${item.balance} ETH`"
                />
                <template #actions>
                  <a-button @click="selectWallet(item)">使用</a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>

        <!-- 外部钱包 -->
        <a-tab-pane key="external" tab="外部钱包">
          <a-button @click="connectMetaMask">连接 MetaMask</a-button>
          <a-button @click="connectWalletConnect">连接 WalletConnect</a-button>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 创建钱包对话框 -->
    <CreateWalletModal v-model:visible="showCreateWallet" @created="onWalletCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useBlockchainStore } from '@/stores/blockchain';

const blockchainStore = useBlockchainStore();
const activeTab = ref('internal');
const internalWallets = ref([]);
const showCreateWallet = ref(false);

onMounted(async () => {
  await blockchainStore.loadWallets();
  internalWallets.value = blockchainStore.wallets;
});

async function connectMetaMask() {
  await blockchainStore.connectExternalWallet('metamask');
}

// ...
</script>
```

#### 6.2 扩展资产创建组件

**文件**: `desktop-app-vue/src/renderer/components/trade/AssetCreate.vue` (修改)

添加"是否上链"选项：

```vue
<template>
  <a-form :model="form" @finish="handleSubmit">
    <!-- 现有字段 -->
    <a-form-item label="资产名称" name="name">
      <a-input v-model:value="form.name" />
    </a-form-item>

    <!-- 新增：是否上链 -->
    <a-form-item label="部署到区块链" name="onChain">
      <a-switch v-model:checked="form.onChain" />
    </a-form-item>

    <!-- 如果上链，显示链选择和钱包选择 -->
    <template v-if="form.onChain">
      <a-form-item label="目标链" name="chainId">
        <a-select v-model:value="form.chainId">
          <a-select-option :value="1">以太坊主网</a-select-option>
          <a-select-option :value="137">Polygon</a-select-option>
          <a-select-option :value="11155111">Sepolia测试网</a-select-option>
        </a-select>
      </a-form-item>

      <a-form-item label="钱包" name="walletId">
        <a-select v-model:value="form.walletId">
          <a-select-option v-for="w in wallets" :key="w.id" :value="w.id">
            {{ w.address }}
          </a-select-option>
        </a-select>
      </a-form-item>
    </template>

    <a-button type="primary" html-type="submit">创建资产</a-button>
  </a-form>
</template>

<script setup>
import { ref } from 'vue';
import { useTradeStore } from '@/stores/trade';
import { useBlockchainStore } from '@/stores/blockchain';

const tradeStore = useTradeStore();
const blockchainStore = useBlockchainStore();

const form = ref({
  name: '',
  onChain: false,
  chainId: 1,
  walletId: '',
});

const wallets = ref(blockchainStore.wallets);

async function handleSubmit() {
  await tradeStore.createAsset(form.value);
}
</script>
```

#### 6.3 新增 Pinia Store

**文件**: `desktop-app-vue/src/renderer/stores/blockchain.js` (新建)

```javascript
import { defineStore } from 'pinia';

export const useBlockchainStore = defineStore('blockchain', {
  state: () => ({
    wallets: [],
    currentWallet: null,
    currentChainId: 1,
    transactions: [],
    deployedContracts: [],
  }),

  actions: {
    async loadWallets() {
      this.wallets = await window.ipcRenderer.invoke('wallet:get-all');
    },

    async createWallet(password) {
      const wallet = await window.ipcRenderer.invoke('wallet:create', password);
      this.wallets.push(wallet);
      return wallet;
    },

    async connectExternalWallet(provider) {
      if (provider === 'metamask') {
        this.currentWallet = await window.ipcRenderer.invoke('wallet:connect-metamask');
      }
    },

    async switchChain(chainId) {
      await window.ipcRenderer.invoke('blockchain:switch-chain', chainId);
      this.currentChainId = chainId;
    },

    async getBalance(address) {
      return await window.ipcRenderer.invoke('wallet:get-balance', {
        address,
        chainId: this.currentChainId,
      });
    },
  },
});
```

#### 6.4 添加路由

**文件**: `desktop-app-vue/src/renderer/router/index.js` (修改)

```javascript
{
  path: '/app/wallet',
  component: () => import('@/pages/Wallet.vue'),
  meta: { requiresAuth: true },
},
{
  path: '/app/blockchain-explorer',
  component: () => import('@/pages/BlockchainExplorer.vue'),
  meta: { requiresAuth: true },
},
```

### 阶段 7: 跨链桥实现 (5-7天)

#### 7.1 跨链桥管理器 (`bridge-manager.js`)

```javascript
class BridgeManager extends EventEmitter {
  constructor(blockchainAdapter, database) {
    super();
    this.adapter = blockchainAdapter;
    this.database = database;
  }

  /**
   * 桥接资产（从一条链转移到另一条链）
   * 使用锁定-铸造模式
   */
  async bridgeAsset(options) {
    const { assetId, fromChainId, toChainId, amount, walletId } = options;

    // 1. 在源链锁定资产
    const lockTx = await this._lockOnSourceChain(fromChainId, assetId, amount, walletId);

    // 2. 监听锁定事件
    await this._waitForLockConfirmation(lockTx);

    // 3. 在目标链铸造资产
    const mintTx = await this._mintOnTargetChain(toChainId, assetId, amount, walletId);

    // 4. 保存桥接记录
    await this._saveBridgeRecord({
      from_chain_id: fromChainId,
      to_chain_id: toChainId,
      from_tx_hash: lockTx,
      to_tx_hash: mintTx,
      asset_id: assetId,
      amount,
      status: 'completed',
    });

    this.emit('bridge:completed', { fromChainId, toChainId, assetId });
  }

  async _lockOnSourceChain(chainId, assetId, amount, walletId) {
    // 调用源链的 AssetBridge 合约的 lock 方法
  }

  async _mintOnTargetChain(chainId, assetId, amount, walletId) {
    // 调用目标链的 AssetBridge 合约的 mint 方法
  }
}
```

**关键文件**: `desktop-app-vue/src/main/blockchain/bridge-manager.js` (新建)

#### 7.2 跨链桥合约 (`AssetBridge.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AssetBridge is Ownable {
    mapping(address => uint256) public lockedBalances;

    event AssetLocked(address indexed token, address indexed user, uint256 amount, uint256 targetChainId);
    event AssetMinted(address indexed token, address indexed user, uint256 amount, uint256 sourceChainId);

    function lock(address token, uint256 amount, uint256 targetChainId) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        lockedBalances[token] += amount;
        emit AssetLocked(token, msg.sender, amount, targetChainId);
    }

    function mint(address token, address user, uint256 amount, uint256 sourceChainId) external onlyOwner {
        // 这里需要验证源链的锁定事件（通过预言机或中继者）
        // 为简化，这里只做铸造
        IERC20(token).transfer(user, amount);
        emit AssetMinted(token, user, amount, sourceChainId);
    }
}
```

**注**: 生产环境需要使用 Chainlink CCIP 或 LayerZero 等成熟的跨链方案。

### 阶段 8: IPC 扩展和模块集成 (3-5天)

在 `desktop-app-vue/src/main/index.js` 中添加所有区块链相关的 IPC 处理器：

```javascript
// 钱包相关（已在阶段2列出）
ipcMain.handle('wallet:create', ...);
ipcMain.handle('wallet:import-mnemonic', ...);
ipcMain.handle('wallet:connect-metamask', ...);
ipcMain.handle('wallet:get-balance', ...);

// 区块链适配器
ipcMain.handle('blockchain:switch-chain', async (_event, chainId) => {
  await this.blockchainAdapter.switchChain(chainId);
});

ipcMain.handle('blockchain:deploy-token', async (_event, options) => {
  return await this.blockchainAdapter.deployERC20Token(options.walletId, options);
});

ipcMain.handle('blockchain:deploy-nft', async (_event, options) => {
  return await this.blockchainAdapter.deployNFT(options.walletId, options);
});

ipcMain.handle('blockchain:mint-nft', async (_event, { walletId, contractAddress, to, uri }) => {
  return await this.blockchainAdapter.mintNFT(walletId, contractAddress, to, uri);
});

ipcMain.handle('blockchain:transfer-token', async (_event, options) => {
  return await this.blockchainAdapter.transferToken(
    options.walletId,
    options.tokenAddress,
    options.to,
    options.amount
  );
});

// 跨链桥
ipcMain.handle('bridge:transfer', async (_event, options) => {
  return await this.bridgeManager.bridgeAsset(options);
});

ipcMain.handle('bridge:get-history', async () => {
  return await this.bridgeManager.getBridgeHistory();
});

// 交易查询
ipcMain.handle('blockchain:get-transaction', async (_event, txHash) => {
  return await this.transactionMonitor.getTxStatus(txHash);
});

ipcMain.handle('blockchain:get-tx-history', async (_event, { address, chainId }) => {
  // 从数据库查询交易历史
});
```

### 阶段 9: 测试和部署 (7-10天)

#### 9.1 单元测试

创建 `desktop-app-vue/tests/blockchain/` 目录：

```
tests/blockchain/
├── wallet-manager.test.js
├── blockchain-adapter.test.js
├── transaction-monitor.test.js
└── contract-deployer.test.js
```

#### 9.2 智能合约测试

```
desktop-app-vue/contracts/test/
├── ChainlessToken.test.js
├── ChainlessNFT.test.js
├── EscrowContract.test.js
└── SubscriptionContract.test.js
```

运行测试：
```bash
cd desktop-app-vue/contracts
npx hardhat test
```

#### 9.3 部署到测试网

```bash
# 部署到 Sepolia 测试网
npx hardhat run scripts/deploy-token.js --network sepolia

# 部署到 Polygon Mumbai 测试网
npx hardhat run scripts/deploy-token.js --network mumbai
```

#### 9.4 集成测试

在桌面应用中测试完整流程：
1. 创建内置钱包
2. 部署 ERC-20 代币
3. 铸造代币
4. 转账代币
5. 部署 NFT
6. 铸造 NFT
7. 创建托管合约
8. 桥接资产

---

## 关键文件清单

### 新建文件

#### 区块链模块（Main Process）
- `desktop-app-vue/src/main/blockchain/blockchain-adapter.js`
- `desktop-app-vue/src/main/blockchain/ethereum-provider.js`
- `desktop-app-vue/src/main/blockchain/polygon-provider.js`
- `desktop-app-vue/src/main/blockchain/wallet-manager.js`
- `desktop-app-vue/src/main/blockchain/external-wallet-connector.js`
- `desktop-app-vue/src/main/blockchain/contract-deployer.js`
- `desktop-app-vue/src/main/blockchain/bridge-manager.js`
- `desktop-app-vue/src/main/blockchain/transaction-monitor.js`
- `desktop-app-vue/src/main/blockchain/gas-optimizer.js`
- `desktop-app-vue/src/main/blockchain/blockchain-config.js`

#### 智能合约
- `desktop-app-vue/contracts/hardhat.config.js`
- `desktop-app-vue/contracts/.env.contracts`
- `desktop-app-vue/contracts/contracts/tokens/ChainlessToken.sol`
- `desktop-app-vue/contracts/contracts/tokens/ChainlessNFT.sol`
- `desktop-app-vue/contracts/contracts/marketplace/EscrowContract.sol`
- `desktop-app-vue/contracts/contracts/marketplace/MultiSigEscrow.sol`
- `desktop-app-vue/contracts/contracts/payment/SubscriptionContract.sol`
- `desktop-app-vue/contracts/contracts/payment/BountyContract.sol`
- `desktop-app-vue/contracts/contracts/bridge/AssetBridge.sol`
- `desktop-app-vue/contracts/scripts/deploy-token.js`
- `desktop-app-vue/contracts/scripts/deploy-nft.js`
- `desktop-app-vue/contracts/scripts/deploy-escrow.js`

#### 前端
- `desktop-app-vue/src/renderer/pages/Wallet.vue`
- `desktop-app-vue/src/renderer/pages/BlockchainExplorer.vue`
- `desktop-app-vue/src/renderer/components/wallet/CreateWalletModal.vue`
- `desktop-app-vue/src/renderer/components/wallet/ImportWalletModal.vue`
- `desktop-app-vue/src/renderer/components/wallet/WalletSelector.vue`
- `desktop-app-vue/src/renderer/components/blockchain/ChainSelector.vue`
- `desktop-app-vue/src/renderer/components/blockchain/TransactionList.vue`
- `desktop-app-vue/src/renderer/stores/blockchain.js`

#### 测试
- `desktop-app-vue/tests/blockchain/wallet-manager.test.js`
- `desktop-app-vue/tests/blockchain/blockchain-adapter.test.js`
- `desktop-app-vue/contracts/test/ChainlessToken.test.js`
- `desktop-app-vue/contracts/test/EscrowContract.test.js`

### 修改文件

- `desktop-app-vue/package.json` - 添加区块链依赖
- `desktop-app-vue/src/main/database.js` - 添加新表
- `desktop-app-vue/src/main/index.js` - 初始化区块链模块，添加 IPC 处理器
- `desktop-app-vue/src/main/trade/asset-manager.js` - 支持链上资产
- `desktop-app-vue/src/main/trade/contract-engine.js` - 支持链上合约
- `desktop-app-vue/src/renderer/components/trade/AssetCreate.vue` - 添加上链选项
- `desktop-app-vue/src/renderer/components/trade/ContractCreate.vue` - 添加上链选项
- `desktop-app-vue/src/renderer/router/index.js` - 添加钱包路由

---

## 风险和注意事项

### 1. Gas 费用优化
- **问题**: 以太坊主网 Gas 费用高昂
- **解决方案**:
  - 优先使用 Polygon（低 Gas）
  - 实现 Gas 估算和费用预览
  - 批量操作（批量铸造、批量转账）
  - 使用 EIP-1559 动态费用

### 2. 交易失败处理
- **问题**: 交易可能因 Gas 不足、网络拥堵等原因失败
- **解决方案**:
  - 实现交易重试机制
  - 提供清晰的错误提示
  - 支持交易加速（提高 Gas Price）
  - 保存失败交易记录供后续处理

### 3. 网络切换
- **问题**: 用户切换网络后，合约地址不同
- **解决方案**:
  - 数据库中记录每个资产/合约的链 ID
  - 前端显示当前链
  - 切换链时自动过滤对应的资产

### 4. 私钥安全
- **问题**: 私钥泄露导致资产损失
- **解决方案**:
  - 私钥用 SQLCipher AES-256 加密存储
  - 结合 U-Key 硬件签名
  - 助记词离线备份（纸质）
  - 不在日志中输出私钥
  - 交易前二次确认

### 5. 合约安全
- **问题**: 智能合约可能存在漏洞
- **解决方案**:
  - 使用 OpenZeppelin 经过审计的合约库
  - 添加 ReentrancyGuard 防重入攻击
  - 使用 Ownable 控制权限
  - 在测试网充分测试后再部署主网
  - 可选：使用可升级合约模式（OpenZeppelin Upgrades）

### 6. 区块链同步延迟
- **问题**: 交易确认需要时间，用户体验差
- **解决方案**:
  - 前端显示"待确认"状态
  - 后台持续监控交易状态
  - 提供交易进度通知
  - 本地数据库先更新，链上确认后同步

### 7. RPC 节点可用性
- **问题**: 公共 RPC 节点可能限流或不稳定
- **解决方案**:
  - 使用多个 RPC 提供商（Infura, Alchemy, QuickNode）
  - 实现自动故障转移
  - 可选：允许用户配置自定义 RPC

### 8. 跨链桥风险
- **问题**: 跨链桥可能被攻击或资金损失
- **解决方案**:
  - 初期使用成熟的第三方桥（Chainlink CCIP, LayerZero）
  - 自建桥需要多重签名和时间锁
  - 限制单次桥接金额
  - 充分测试

---

## 实施时间表

| 阶段 | 任务 | 预计时间 | 依赖 |
|------|------|---------|------|
| 1 | 基础设施搭建 | 3-5天 | - |
| 2 | 钱包系统实现 | 5-7天 | 阶段1 |
| 3 | 智能合约开发 | 7-10天 | 阶段1 |
| 4 | 区块链适配器实现 | 5-7天 | 阶段2, 3 |
| 5 | 集成到现有模块 | 7-10天 | 阶段4 |
| 6 | 前端 UI 适配 | 5-7天 | 阶段5 |
| 7 | 跨链桥实现 | 5-7天 | 阶段4 |
| 8 | IPC 扩展和模块集成 | 3-5天 | 阶段5, 6, 7 |
| 9 | 测试和部署 | 7-10天 | 所有阶段 |

**总计**: 47-68 天（约 7-10 周）

---

## 下一步行动

1. **立即开始**: 阶段 1（基础设施搭建）
   - 安装 Hardhat 和依赖
   - 创建目录结构
   - 配置 hardhat.config.js

2. **并行开发**:
   - 后端团队: 钱包系统 + 区块链适配器
   - 合约团队: 智能合约开发和测试
   - 前端团队: UI 设计和 Pinia Store

3. **里程碑**:
   - 第2周结束: 完成钱包系统和基础合约
   - 第5周结束: 完成区块链适配器和模块集成
   - 第8周结束: 完成前端 UI 和跨链桥
   - 第10周结束: 完成测试和部署到测试网

---

## 技术债务和未来扩展

- **Layer 2 支持**: Arbitrum, Optimism
- **更多合约类型**: DAO 治理、流动性挖矿
- **NFT 市场**: 集成 OpenSea API
- **DeFi 集成**: Uniswap, Aave
- **合约可升级**: 使用 UUPS 或 Transparent Proxy
- **预言机**: Chainlink 价格喂送
- **去中心化存储**: IPFS for NFT metadata

---

## 结论

本计划提供了一个完整、可执行的区块链集成方案，充分利用 ChainlessChain 现有的架构（事件驱动、模块化、加密存储），通过混合模式平衡去中心化和性能，通过统一适配器支持多链，通过内置+外部钱包满足不同用户需求。

核心优势：
- **架构兼容**: 最小化对现有代码的侵入
- **渐进式集成**: 可以按阶段逐步实施
- **安全优先**: 结合 SQLCipher、U-Key 和 OpenZeppelin
- **用户友好**: 混合模式降低使用门槛

立即开始阶段 1，7-10 周后即可完成完整的区块链功能集成。
