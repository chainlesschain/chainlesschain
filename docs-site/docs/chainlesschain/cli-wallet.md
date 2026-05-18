# 数字钱包 (wallet)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 💰 **Ed25519 钱包**: 基于 Ed25519 密钥对的数字钱包
- 🏦 **资产管理**: 创建和管理多种数字资产
- 🔄 **资产转移**: 安全的资产转账和交易记录
- 🔐 **私钥加密**: AES-256-GCM + PBKDF2 保护私钥
- 📊 **交易历史**: 完整的交易流水记录

## 系统架构

```
wallet 命令 → wallet.js (Commander) → wallet-manager.js
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  ▼                        ▼                        ▼
            钱包管理                  资产管理                  交易管理
        create/list/delete        asset/assets             transfer/history
                  │                        │                        │
                  ▼                        ▼                        ▼
          wallets 表              digital_assets 表         transactions 表
       (Ed25519 密钥对)          (类型/名称/状态)        (from/to/amount)
```

## 概述

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

## 配置参考

```bash
# 命令选项
chainlesschain wallet create --name <name>                 # 创建钱包
chainlesschain wallet list                                 # 列出钱包
chainlesschain wallet balance <address>                    # 查询余额
chainlesschain wallet set-default <address>                # 设置默认钱包
chainlesschain wallet delete <address>                     # 删除钱包
chainlesschain wallet asset <address> <type> <name>        # 创建资产
chainlesschain wallet assets [address]                     # 列出资产
chainlesschain wallet transfer <asset-id> <to-address>     # 转移资产
chainlesschain wallet history [address]                    # 交易历史
chainlesschain wallet summary                              # 总览

# 相关环境变量
export CHAINLESSCHAIN_WALLET_PASSWORD=<password>           # 钱包加密密码（谨慎）
export CHAINLESSCHAIN_DB_PATH=~/.chainlesschain/db.sqlite  # SQLite 路径
```

## 性能指标

| 操作             | 目标    | 实际       | 状态 |
| ---------------- | ------- | ---------- | ---- |
| Ed25519 密钥生成 | < 50ms  | 5–20ms     | ✅   |
| PBKDF2 派生 (100K) | < 500ms | 150–400ms | ✅   |
| AES-256-GCM 加密 | < 10ms  | 1–5ms      | ✅   |
| 创建资产         | < 100ms | 20–80ms    | ✅   |
| 转移资产         | < 200ms | 50–150ms   | ✅   |
| 交易历史查询     | < 100ms | 20–80ms    | ✅   |

## 测试覆盖率

```
✅ wallet.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 安全考虑

- 私钥使用 AES-256-GCM 加密存储，PBKDF2 派生密钥
- 每个钱包使用独立的 16 字节随机盐值
- `delete` 操作会永久删除私钥，不可恢复
- 转账操作记录完整交易日志

## 使用示例

### 场景 1：创建钱包和数字资产

```bash
chainlesschain wallet create --name "主钱包"
chainlesschain wallet asset <address> token "我的积分"
chainlesschain wallet assets
```

创建 Ed25519 钱包后在其中创建数字资产，查看资产列表确认创建成功。

### 场景 2：查看余额和交易历史

```bash
chainlesschain wallet list
chainlesschain wallet balance <address>
chainlesschain wallet history <address>
chainlesschain wallet summary
```

查看所有钱包和余额，浏览指定钱包的交易流水，获取资产总览。

### 场景 3：转移数字资产

```bash
chainlesschain wallet transfer <asset-id> <target-address>
chainlesschain wallet history
```

将数字资产转移到目标地址，查看交易历史确认转账记录已生成。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `create` 失败 | 确认数据库已初始化：`chainlesschain db init` |
| `transfer` 报余额不足 | 检查资产所有权和余额 |
| `balance` 显示 0 | 确认钱包地址正确 |

## 关键文件

- `packages/cli/src/commands/wallet.js` — 命令实现
- `packages/cli/src/lib/wallet-manager.js` — 钱包管理库

## 相关文档

- [DID 身份](./cli-did) — Ed25519 身份管理
- [文件加密](./cli-encrypt) — AES-256-GCM 加密
- [交易辅助](./trading) — 桌面端交易功能
- [Agent 经济](./agent-economy) — 代理代币化

## 依赖

- 纯 Node.js crypto（零外部依赖）
