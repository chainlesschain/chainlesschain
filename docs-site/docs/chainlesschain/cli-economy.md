# Agent 经济系统 (economy)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 💰 **服务定价**: 智能体服务的灵活定价机制
- ⚡ **微支付**: Agent 间即时小额支付，支持多种交易类型
- 🔗 **状态通道**: 链下支付通道，高频交易零手续费
- 🏪 **资源市场**: 计算、存储、数据等资源的去中心化交易市场
- 🎨 **NFT 铸造**: 贡献证明和数字资产的 NFT 化
- 📊 **收入分配**: 基于贡献度的自动收入分配机制

## 概述

ChainlessChain CLI Agent 经济系统为智能体网络建立了完整的经济模型。智能体可以为自己提供的服务设定价格，通过 `pay` 进行点对点支付。对于高频交易场景，`channel` 命令提供状态通道（链下支付通道），双方在通道内可以进行无限次微支付，仅在开启和关闭通道时写入主链。

资源市场允许智能体将闲置的计算能力、存储空间、数据集等资源上架交易。`nft mint` 可将重要贡献（代码提交、知识贡献、任务完成等）铸造为 NFT 形式的不可篡改证明。`revenue` 命令基于各智能体的贡献度自动计算并分配收入。

## 命令参考

### economy price — 设置服务价格

```bash
chainlesschain economy price <service-id> <price>
chainlesschain economy price "code-review" 10
chainlesschain economy price "translation" 5
```

为指定服务设置价格（单位：token）。

### economy pay — 支付

```bash
chainlesschain economy pay <from> <to> <amount>
chainlesschain economy pay agent-001 agent-002 10 --description "Code review payment"
```

从一个 Agent 向另一个 Agent 转账支付。

### economy balance — 查询余额

```bash
chainlesschain economy balance <agent-id>
chainlesschain economy balance agent-001 --json
```

查询指定 Agent 的当前余额。

### economy channel open — 开启状态通道

```bash
chainlesschain economy channel open <party-a> <party-b> <deposit>
chainlesschain economy channel open agent-001 agent-002 100
```

在两个 Agent 之间开启链下支付通道，双方各存入初始保证金。

### economy channel close — 关闭状态通道

```bash
chainlesschain economy channel close <channel-id>
chainlesschain economy channel close ch-001 --json
```

关闭状态通道，根据通道内交易记录进行最终结算。

### economy market list — 上架资源

```bash
chainlesschain economy market list <name> --type compute --price 5
chainlesschain economy market list "GPU-hours" --type compute --price 20
chainlesschain economy market list "Dataset-v2" --type data --price 50
```

将资源上架到交易市场。支持 compute（计算）、storage（存储）、data（数据）等类型。

### economy market browse — 浏览市场

```bash
chainlesschain economy market browse
chainlesschain economy market browse --type storage --json
```

浏览资源市场的所有可用商品，支持按类型过滤。

### economy trade — 交易资源

```bash
chainlesschain economy trade <listing-id> <buyer-id>
chainlesschain economy trade listing-001 agent-002 --json
```

购买市场上的指定资源，自动完成支付和交割。

### economy nft mint — 铸造 NFT

```bash
chainlesschain economy nft mint <name> --type contribution --data '{"commit":"abc123"}'
chainlesschain economy nft mint "Code Contribution #42" --owner agent-001 --json
```

将贡献或数字资产铸造为 NFT，生成不可篡改的证明记录。

### economy revenue — 收入分配

```bash
chainlesschain economy revenue <pool-amount>
chainlesschain economy revenue 1000 --json
```

根据贡献度计算并分配收入池中的资金到各贡献者。

### economy contribute — 记录贡献

```bash
chainlesschain economy contribute <agent-id> <type> <value>
chainlesschain economy contribute agent-001 "code" 15
chainlesschain economy contribute agent-002 "review" 8 --json
```

记录智能体的贡献值，用于后续收入分配权重计算。

## 数据库表

| 表名 | 说明 |
|------|------|
| `economy_balances` | Agent 余额账本（Agent ID、余额、最后更新时间） |
| `economy_transactions` | 交易记录（发送方、接收方、金额、类型、描述） |
| `economy_channels` | 状态通道（双方 ID、保证金、状态、交易计数） |
| `economy_market` | 资源市场（名称、类型、价格、卖方、状态） |
| `economy_nfts` | NFT 记录（名称、类型、所有者、元数据哈希） |
| `economy_contributions` | 贡献记录（Agent ID、贡献类型、贡献值） |

## 系统架构

```
用户命令 → economy.js (Commander) → agent-economy.js
                                          │
                ┌────────────────────────┼────────────────────────┐
                ▼                        ▼                        ▼
         支付引擎                  状态通道管理器              资源市场
      (余额+交易)              (链下高频支付)           (上架/浏览/交易)
                ▼                        ▼                        ▼
     economy_balances          economy_channels           economy_market
     economy_transactions                                 economy_nfts
```

## 配置参考

```bash
chainlesschain economy price <service-id> <price>
chainlesschain economy pay <from> <to> <amount> [--description <desc>]
chainlesschain economy balance <agent-id> [--json]
chainlesschain economy channel open <party-a> <party-b> <deposit>
chainlesschain economy channel close <channel-id> [--json]
chainlesschain economy market list <name> --type compute|storage|data --price <p>
chainlesschain economy market browse [--type <t>] [--json]
chainlesschain economy trade <listing-id> <buyer-id> [--json]
chainlesschain economy nft mint <name> [--type contribution] [--owner <agent>] [--data <json>] [--json]
chainlesschain economy revenue <pool-amount> [--json]
chainlesschain economy contribute <agent-id> <type> <value> [--json]
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| economy pay 转账（含事务） | < 100ms | ~ 30ms | ✅ |
| balance 查询 | < 50ms | ~ 10ms | ✅ |
| channel open/close | < 200ms | ~ 80ms | ✅ |
| market browse（含过滤） | < 150ms | ~ 40ms | ✅ |
| nft mint（哈希绑定） | < 100ms | ~ 40ms | ✅ |
| revenue 分配计算 | < 200ms | ~ 60ms | ✅ |

## 测试覆盖率

```
✅ economy.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/economy.js` — 命令实现
- `packages/cli/src/lib/agent-economy.js` — Agent 经济库

## 使用示例

### 场景 1：Agent 间支付

```bash
# 设置服务定价
chainlesschain economy price code-review 10.5

# Agent 间转账支付
chainlesschain economy pay agent-alice agent-bob 10.5 \
  --description "代码审查服务费"

# 查看余额
chainlesschain economy balance agent-alice
```

### 场景 2：状态通道（链下高频交易）

```bash
# 开启支付通道（双方各锁定 100 token）
chainlesschain economy channel open agent-alice agent-bob 100

# 通过通道进行多次小额交易（无需上链）
chainlesschain economy trade <channel-id> agent-alice agent-bob 5
chainlesschain economy trade <channel-id> agent-alice agent-bob 3

# 关闭通道，结算余额
chainlesschain economy channel close <channel-id>
```

### 场景 3：NFT 铸造与资源市场

```bash
# 记录 Agent 贡献
chainlesschain economy contribute agent-alice \
  --type code --value 85

# 铸造贡献证明 NFT
chainlesschain economy nft mint agent-alice \
  --name "Code Contributor Q3"

# 浏览资源市场
chainlesschain economy market list

# 查看收入分配
chainlesschain economy revenue --json
```

## 故障排查

### 支付与通道问题

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Insufficient balance" | 发送方余额不足 | 先充值或检查余额：`economy balance <agent>` |
| "Channel not found" | 通道 ID 不存在或已关闭 | 使用 `economy market list` 查看活跃通道 |
| "Channel already closed" | 尝试在已关闭通道中交易 | 重新开启新通道 |
| NFT 铸造失败 | Agent 无贡献记录 | 先记录贡献：`economy contribute <agent>` |
| 交易记录缺失 | 链下交易未同步到数据库 | 关闭通道触发链上结算后记录才会持久化 |

### 常见错误

```bash
# 错误: "Agent not registered in economy"
# 原因: Agent 未在经济系统中注册余额
# 修复: 首次支付或收款时自动创建余额记录

# 错误: "Invalid trade: parties mismatch"
# 原因: 交易双方与通道参与方不匹配
# 修复: 确认通道的 party_a 和 party_b
chainlesschain economy market list --json

# 错误: "Price not set for service"
# 原因: 服务未定价
# 修复:
chainlesschain economy price <service-name> <amount>
```

## 安全考虑

- **余额保护**: 转账操作使用数据库事务保证原子性，防止双花攻击
- **通道锁定**: 状态通道中的资金锁定在通道中，只有双方都可以触发结算
- **价格操纵防护**: 服务定价历史记录不可删除，支持审计价格变更
- **NFT 不可伪造**: NFT 铸造基于密码学哈希绑定 Agent 身份和贡献记录
- **收入分配透明**: 所有交易和分配记录可通过 `--json` 导出完整审计轨迹
- **资源市场准入**: 市场上架的资源需要有效的 Agent 身份，防止匿名滥用

## 相关文档

- [A2A 协议](./cli-a2a) — 智能体间任务协作
- [ZKP 引擎](./cli-zkp) — 零知识证明（隐私交易）
- [钱包管理](./cli-wallet) — 数字资产钱包
