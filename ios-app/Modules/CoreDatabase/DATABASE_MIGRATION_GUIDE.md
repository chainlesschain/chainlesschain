# 数据库迁移指南

## 新增区块链表（Migration v2）

**日期**: 2026-01-25
**版本**: v2
**状态**: ✅ SQL脚本已创建

---

## 📋 迁移内容

### 新增表（9张）

| 表名                      | 用途       | 行数   |
| ------------------------- | ---------- | ------ |
| `blockchain_wallets`      | 钱包存储   | 主表   |
| `wallet_balances`         | 余额缓存   | 关联表 |
| `blockchain_transactions` | 交易记录   | 主表   |
| `erc20_tokens`            | Token配置  | 配置表 |
| `nft_assets`              | NFT资产    | 资产表 |
| `contract_abis`           | 合约ABI    | 配置表 |
| `address_book`            | 地址簿     | 辅助表 |
| `gas_price_history`       | Gas价格    | 历史表 |
| `pending_transactions`    | 待处理交易 | 队列表 |

### 索引（28个）

完整索引列表见 `BlockchainMigration.swift`

---

## 🔧 集成步骤

### Step 1: 更新 `DatabaseManager.runMigration()`

在 `DatabaseManager.swift` 的 `runMigration()` 方法中添加：

```swift
private func runMigration(version: Int) throws {
    logger.database("Running migration v\(version)")

    switch version {
    case 1:
        try migration_v1()
    case 2:  // 👈 新增
        try migration_v2()
    default:
        break
    }

    // 记录迁移
    try execute("INSERT INTO migrations (version, applied_at) VALUES (\(version), \(Date().timestampMs));")
    logger.database("Migration v\(version) completed")
}
```

### Step 2: 更新数据库版本

在 `AppConstants.swift` 中更新数据库版本：

```swift
public struct Database {
    public static let name = "chainlesschain.db"
    public static let version = 2  // 👈 从1改为2
    public static let pbkdf2Iterations = 256000
    public static let encryptionKeySize = 32
}
```

### Step 3: 验证迁移

```swift
// 在应用启动后检查
let currentVersion = try DatabaseManager.shared.getCurrentVersion()
print("当前数据库版本: \(currentVersion)")  // 应该是 2
```

---

## 📊 表结构详解

### 1. blockchain_wallets（钱包表）

```sql
CREATE TABLE blockchain_wallets (
    id TEXT PRIMARY KEY,                    -- UUID
    address TEXT NOT NULL UNIQUE,           -- 钱包地址（0x...）
    wallet_type TEXT NOT NULL,              -- 'internal' | 'external'
    provider TEXT NOT NULL,                 -- 'builtin' | 'metamask' | 'walletconnect'
    derivation_path TEXT,                   -- BIP44路径（如 "m/44'/60'/0'/0/0"）
    chain_id INTEGER NOT NULL,              -- 链ID（1=Ethereum, 137=Polygon等）
    is_default INTEGER NOT NULL DEFAULT 0,  -- 是否默认钱包
    created_at INTEGER NOT NULL,            -- 创建时间（毫秒）
    updated_at INTEGER NOT NULL DEFAULT 0   -- 更新时间（毫秒）
);
```

**约束**:

- `wallet_type` 只能是 'internal' 或 'external'
- `provider` 只能是 'builtin', 'metamask', 'walletconnect'
- `address` 必须唯一

**索引**:

- `idx_wallets_address` - 地址查询
- `idx_wallets_chain_id` - 链ID查询
- `idx_wallets_is_default` - 默认钱包查询

### 2. wallet_balances（余额表）

```sql
CREATE TABLE wallet_balances (
    wallet_id TEXT NOT NULL,                -- 钱包ID
    chain_id INTEGER NOT NULL,              -- 链ID
    balance TEXT NOT NULL,                  -- 余额（Wei，字符串防精度损失）
    symbol TEXT NOT NULL,                   -- 币种符号（ETH/MATIC等）
    decimals INTEGER NOT NULL DEFAULT 18,   -- 小数位数
    token_address TEXT,                     -- Token地址（NULL=原生币）
    updated_at INTEGER NOT NULL,            -- 更新时间
    PRIMARY KEY (wallet_id, chain_id, COALESCE(token_address, '')),
    FOREIGN KEY (wallet_id) REFERENCES blockchain_wallets(id) ON DELETE CASCADE
);
```

**说明**:

- 原生币（ETH/MATIC）：`token_address` 为 NULL
- ERC-20 Token：`token_address` 为合约地址
- 余额使用字符串存储，避免大数精度问题

### 3. blockchain_transactions（交易表）

```sql
CREATE TABLE blockchain_transactions (
    id TEXT PRIMARY KEY,                    -- UUID
    hash TEXT NOT NULL UNIQUE,              -- 交易哈希
    from_address TEXT NOT NULL,             -- 发送方
    to_address TEXT NOT NULL,               -- 接收方
    value TEXT NOT NULL,                    -- 金额（Wei）
    gas_price TEXT NOT NULL,                -- Gas价格（Wei）
    gas_limit TEXT NOT NULL,                -- Gas限制
    gas_used TEXT,                          -- 实际使用的Gas
    data TEXT,                              -- 合约调用数据
    nonce INTEGER NOT NULL,                 -- Nonce
    chain_id INTEGER NOT NULL,              -- 链ID
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'failed'
    type TEXT NOT NULL,                     -- 'send' | 'receive' | 'contract'
    block_number INTEGER,                   -- 区块号
    block_hash TEXT,                        -- 区块哈希
    timestamp INTEGER NOT NULL,             -- 时间戳
    confirmations INTEGER DEFAULT 0,        -- 确认数
    error_message TEXT,                     -- 错误信息
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
);
```

**索引**:

- 6个索引用于高效查询（hash, from, to, chain_id, status, timestamp）

### 4. erc20_tokens（Token配置表）

```sql
CREATE TABLE erc20_tokens (
    id TEXT PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    address TEXT NOT NULL,          -- 合约地址
    name TEXT NOT NULL,             -- Token名称
    symbol TEXT NOT NULL,           -- Token符号
    decimals INTEGER NOT NULL,      -- 小数位数
    logo_url TEXT,                  -- Logo URL
    is_custom INTEGER DEFAULT 0,    -- 是否用户自定义
    created_at INTEGER NOT NULL,
    UNIQUE(chain_id, address)
);
```

### 5. nft_assets（NFT资产表）

```sql
CREATE TABLE nft_assets (
    id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    contract_address TEXT NOT NULL,
    token_id TEXT NOT NULL,
    name TEXT,
    description TEXT,
    image_url TEXT,
    metadata_url TEXT,
    collection_name TEXT,
    token_standard TEXT DEFAULT 'ERC721',  -- 'ERC721' | 'ERC1155'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE(chain_id, contract_address, token_id),
    FOREIGN KEY (wallet_id) REFERENCES blockchain_wallets(id) ON DELETE CASCADE
);
```

### 6. contract_abis（合约ABI表）

用于存储已验证的智能合约ABI，支持合约交互。

### 7. address_book（地址簿）

用户保存的常用地址，支持备注和标记收藏。

### 8. gas_price_history（Gas价格历史）

记录各链的Gas价格历史，用于智能Gas估算。

### 9. pending_transactions（待处理交易队列）

存储待广播或待确认的交易，支持重试机制。

---

## 🧪 测试 SQL

### 插入测试钱包

```sql
INSERT INTO blockchain_wallets (
    id, address, wallet_type, provider, derivation_path,
    chain_id, is_default, created_at, updated_at
) VALUES (
    'test-wallet-1',
    '0x1234567890123456789012345678901234567890',
    'internal',
    'builtin',
    "m/44'/60'/0'/0/0",
    1,
    1,
    1706169600000,
    1706169600000
);
```

### 插入测试余额

```sql
INSERT INTO wallet_balances (
    wallet_id, chain_id, balance, symbol, decimals, updated_at
) VALUES (
    'test-wallet-1',
    1,
    '1000000000000000000',  -- 1 ETH
    'ETH',
    18,
    1706169600000
);
```

### 查询钱包及余额

```sql
SELECT
    w.address,
    w.chain_id,
    b.balance,
    b.symbol
FROM blockchain_wallets w
LEFT JOIN wallet_balances b ON w.id = b.wallet_id
WHERE w.is_default = 1;
```

---

## ⚠️ 注意事项

### 1. 级联删除

- 删除钱包时，自动删除关联的余额、NFT、待处理交易
- 使用 `ON DELETE CASCADE` 实现

### 2. 大数存储

所有金额相关字段（balance, value, gas_price等）使用 `TEXT` 类型存储，避免精度损失。

### 3. 唯一约束

- 钱包地址：全局唯一
- Token配置：(chain_id, address) 唯一
- NFT：(chain_id, contract_address, token_id) 唯一

### 4. 索引策略

- 高频查询字段都创建了索引
- 外键字段都有索引
- 时间戳字段使用 DESC 索引（最新记录优先）

---

## 🔄 回滚（如需要）

如果需要回滚迁移：

```sql
-- 删除所有区块链表
DROP TABLE IF EXISTS pending_transactions;
DROP TABLE IF EXISTS gas_price_history;
DROP TABLE IF EXISTS address_book;
DROP TABLE IF EXISTS contract_abis;
DROP TABLE IF EXISTS nft_assets;
DROP TABLE IF EXISTS erc20_tokens;
DROP TABLE IF EXISTS blockchain_transactions;
DROP TABLE IF EXISTS wallet_balances;
DROP TABLE IF EXISTS blockchain_wallets;

-- 删除迁移记录
DELETE FROM migrations WHERE version = 2;
```

---

## 📚 相关文件

- **迁移脚本**: `Migrations/BlockchainMigration.swift`
- **数据库管理器**: `Manager/DatabaseManager.swift`
- **钱包模型**: `Features/Blockchain/Models/Wallet.swift`
- **交易模型**: `Features/Blockchain/Models/Transaction.swift`

---

## ✅ 验收清单

- [x] ✅ SQL脚本已创建
- [ ] ⚠️ DatabaseManager已更新（需手动添加case 2）
- [ ] ⚠️ AppConstants版本已更新（需改为2）
- [ ] ⚠️ 迁移已测试
- [ ] ⚠️ 数据查询已验证

---

**创建时间**: 2026-01-25
**最后更新**: 2026-01-25
