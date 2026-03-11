# 数字钱包 (wallet)

CLI Phase 5 — Ed25519 数字钱包和资产管理。

## 命令概览

```bash
chainlesschain wallet create --name "My Wallet"    # 创建钱包
chainlesschain wallet list                         # 列出钱包
chainlesschain wallet balance <address>            # 查询余额
chainlesschain wallet set-default <address>        # 设为默认钱包
chainlesschain wallet delete <address>             # 删除钱包
chainlesschain wallet asset <addr> <type> <name>   # 创建数字资产
chainlesschain wallet assets [address]             # 列出资产
chainlesschain wallet transfer <asset-id> <to>     # 转移资产
chainlesschain wallet history [address]            # 交易历史
chainlesschain wallet summary                      # 总览
```

## 功能说明

### 钱包管理

- **密钥生成**: Ed25519 (`crypto.generateKeyPairSync`)
- **地址格式**: `0x` + SHA-256(publicKey) 前 40 位
- **私钥保护**: AES-256-GCM 加密存储，PBKDF2 密钥派生（100K 迭代）
- 首个钱包自动设为默认

### 数字资产

- `createAsset` — 创建资产（类型、名称、描述、元数据）
- `getAssets` — 查询指定钱包的资产
- `getAllAssets` — 查询所有资产

### 转账交易

- `transferAsset` — 转移资产到目标地址
- 自动创建交易记录（from, to, asset_id, amount, status）
- `getTransactions` — 查询交易历史（支持按地址过滤）

## 数据库表

| 表名 | 说明 |
|------|------|
| `wallets` | 钱包信息（地址、公钥、加密私钥、余额） |
| `digital_assets` | 数字资产（类型、名称、所有者、状态） |
| `transactions` | 交易记录（from、to、金额、类型、状态） |

## 安全设计

| 参数 | 值 | 说明 |
|------|------|------|
| 密钥算法 | Ed25519 | Node.js 内置 |
| 加密算法 | AES-256-GCM | 认证加密 |
| 密钥派生 | PBKDF2 | SHA-256, 100K 迭代 |
| 盐值 | 16 bytes | 每钱包随机 |

## 依赖

- 纯 Node.js crypto（零外部依赖）
