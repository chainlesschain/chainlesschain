# iOS区块链钱包模块

## 📋 Phase 1.1 完成总结

**实施日期**: 2026-01-25
**状态**: ✅ 基础框架完成（需集成WalletCore）
**完成度**: 85%

---

## 🎯 已完成内容

### 1. 数据模型层 (100%)

| 文件                | 功能                    | 状态 |
| ------------------- | ----------------------- | ---- |
| `ChainConfig.swift` | 15条区块链网络配置      | ✅   |
| `Wallet.swift`      | 钱包模型 + 加密数据结构 | ✅   |
| `Transaction.swift` | 交易模型 + Gas估算      | ✅   |

**支持的区块链**:

- ✅ Ethereum (主网 + Sepolia测试网)
- ✅ Polygon (主网 + Mumbai测试网)
- ✅ BSC (主网 + 测试网)
- ✅ Arbitrum (One + Sepolia)
- ✅ Optimism (主网 + Sepolia)
- ✅ Avalanche (C-Chain + Fuji)
- ✅ Base (主网 + Sepolia)
- ✅ Hardhat本地测试网

### 2. 服务层 (90%)

| 文件                          | 功能                               | 状态 |
| ----------------------------- | ---------------------------------- | ---- |
| `KeychainWalletStorage.swift` | Keychain安全存储 + AES-256-GCM加密 | ✅   |
| `WalletManager.swift`         | HD钱包管理器（需集成WalletCore）   | ⚠️   |
| `BiometricSigner.swift`       | Face ID/Touch ID签名               | ✅   |

**安全特性**:

- ✅ AES-256-GCM加密
- ✅ PBKDF2密钥派生（100,000次迭代）
- ✅ iOS Keychain安全存储
- ✅ Secure Enclave支持
- ✅ 生物识别认证

### 3. UI层 (100%)

| 文件                     | 功能                    | 状态 |
| ------------------------ | ----------------------- | ---- |
| `WalletViewModel.swift`  | 钱包视图模型            | ✅   |
| `WalletListView.swift`   | 钱包列表界面            | ✅   |
| `CreateWalletView.swift` | 创建钱包 + 助记词备份   | ✅   |
| `ImportWalletView.swift` | 导入钱包（助记词/私钥） | ✅   |
| `WalletDetailView.swift` | 钱包详情 + QR码         | ✅   |

**UI特性**:

- ✅ SwiftUI原生界面
- ✅ 钱包列表 + 余额显示
- ✅ 创建钱包 + 密码强度指示
- ✅ 助记词备份界面
- ✅ 导入钱包（助记词/私钥）
- ✅ 生物识别解锁
- ✅ 钱包详情 + 操作菜单

---

## ⚠️ 待完成工作

### 1. 集成WalletCore（高优先级）

**需要安装**:

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/trustwallet/wallet-core", from: "3.0.0")
]
```

**待实现功能**:

- [ ] BIP39助记词生成和验证
- [ ] BIP44 HD钱包派生
- [ ] 私钥生成地址
- [ ] 交易签名

**代码位置**:

- `WalletManager.swift` - 搜索 `// TODO: 集成 WalletCore`

### 2. 数据库表结构

需要在DatabaseManager中添加以下表：

```sql
-- 钱包表
CREATE TABLE IF NOT EXISTS blockchain_wallets (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    wallet_type TEXT NOT NULL,  -- 'internal' or 'external'
    provider TEXT NOT NULL,     -- 'builtin', 'metamask', etc.
    derivation_path TEXT,
    chain_id INTEGER NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- 余额表
CREATE TABLE IF NOT EXISTS wallet_balances (
    wallet_id TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    balance TEXT NOT NULL,  -- Wei (string for precision)
    symbol TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (wallet_id, chain_id),
    FOREIGN KEY (wallet_id) REFERENCES blockchain_wallets(id)
);

-- 交易表
CREATE TABLE IF NOT EXISTS blockchain_transactions (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    value TEXT NOT NULL,  -- Wei
    gas_price TEXT NOT NULL,
    gas_limit TEXT NOT NULL,
    data TEXT,
    nonce INTEGER NOT NULL,
    chain_id INTEGER NOT NULL,
    status TEXT NOT NULL,  -- 'pending', 'confirmed', 'failed'
    type TEXT NOT NULL,    -- 'send', 'receive', 'contract'
    block_number INTEGER,
    timestamp INTEGER NOT NULL,
    confirmations INTEGER DEFAULT 0
);
```

### 3. RPC客户端集成（中优先级）

- [ ] 实现区块链RPC客户端
- [ ] 余额查询
- [ ] 交易广播
- [ ] Gas估算
- [ ] 交易历史查询

### 4. QR码生成（低优先级）

```swift
import CoreImage.CIFilterBuiltins

func generateQRCode(from string: String) -> UIImage {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(string.utf8)

    if let outputImage = filter.outputImage {
        let transform = CGAffineTransform(scaleX: 10, y: 10)
        let scaledImage = outputImage.transformed(by: transform)
        return UIImage(ciImage: scaledImage)
    }
    return UIImage()
}
```

---

## 📊 与PC端对比

| 功能       | PC端 (v0.26.0) | iOS端 (v0.6.0)      | 差距             |
| ---------- | -------------- | ------------------- | ---------------- |
| HD钱包创建 | ✅ BIP39/BIP44 | ⚠️ 框架已完成       | 需集成WalletCore |
| 助记词导入 | ✅             | ⚠️ 框架已完成       | 需集成WalletCore |
| 私钥导入   | ✅             | ⚠️ 框架已完成       | 需集成WalletCore |
| 多链支持   | ✅ 15条链      | ✅ 15条链配置       | 配置已完成       |
| 生物识别   | ❌             | ✅ Face ID/Touch ID | iOS优势          |
| U-Key签名  | ✅ Windows     | ❌                  | iOS不支持        |
| 余额查询   | ✅             | ⚠️ UI已完成         | 需实现RPC        |
| 交易签名   | ✅             | ⚠️ 框架已完成       | 需集成WalletCore |
| 交易历史   | ✅             | ⚠️ 数据库表已设计   | 需实现查询       |

---

## 🚀 下一步行动

### 立即执行（本周）

1. **集成WalletCore**（最高优先级）

   ```bash
   # 添加Swift Package Dependency
   https://github.com/trustwallet/wallet-core
   ```

2. **实现HD钱包核心功能**
   - BIP39助记词生成
   - BIP44密钥派生
   - 地址生成
   - 交易签名

3. **添加数据库表**
   - 在DatabaseManager中执行SQL
   - 创建索引

### 短期（下周）

4. **实现RPC客户端**（Phase 1.2准备）
   - URLSession网络层
   - JSON-RPC调用
   - 多端点容错

5. **余额查询功能**
   - ETH余额
   - ERC-20 Token余额
   - 缓存机制

### 中期（2周内）

6. **交易功能**
   - 发送交易
   - Gas估算
   - 交易历史
   - 交易状态追踪

---

## 🛠️ 技术栈

### 已使用

- **语言**: Swift 5.9+
- **UI**: SwiftUI
- **架构**: MVVM + Clean Architecture
- **加密**: CryptoKit (AES-256-GCM)
- **存储**: iOS Keychain + Core Data
- **安全**: LocalAuthentication (生物识别)

### 待集成

- **区块链**: WalletCore 3.0+ (Trust Wallet)
- **网络**: URLSession + Combine
- **QR码**: CoreImage

---

## 📚 参考文档

### 内部文档

- [PC端钱包管理器](../../../../desktop-app-vue/src/main/blockchain/wallet-manager.js)
- [PC端区块链配置](../../../../desktop-app-vue/src/main/blockchain/blockchain-config.js)
- [iOS实施计划](../../IOS_PC_ALIGNMENT_PLAN.md)

### 外部资源

- [Trust Wallet Core](https://github.com/trustwallet/wallet-core)
- [BIP39规范](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
- [BIP44规范](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)
- [以太坊JSON-RPC](https://ethereum.org/en/developers/docs/apis/json-rpc/)

---

## ✅ 验收标准

Phase 1.1 视为完成需满足：

- [x] ✅ 完整的数据模型层
- [x] ✅ Keychain安全存储
- [ ] ⚠️ WalletCore集成（核心待完成）
- [x] ✅ 生物识别认证
- [x] ✅ 完整的UI界面
- [ ] ⚠️ 数据库表创建
- [ ] ⚠️ 实际可用的创建/导入钱包

**当前完成度**: 85% (框架100% + 核心功能待集成)

**预计剩余工作量**: 1-2天（集成WalletCore + 数据库 + 测试）

---

**最后更新**: 2026-01-25
**下次审查**: 集成WalletCore后
