# 跨链互操作 (crosschain)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔗 **资产桥接**: 在不同链之间桥接资产（lock-and-mint 模式）
- 🔄 **原子交换**: HTLC 哈希时间锁原子交换（发起/领取/退款）
- 📨 **跨链消息**: 发送和追踪跨链消息
- 💰 **手续费估算**: 预估跨链桥接费用明细
- 📊 **统计报告**: 查看桥接、交换、消息的汇总统计

## 概述

ChainlessChain CLI 跨链互操作模块（Phase 89）提供完整的跨链资产桥接、HTLC 原子交换和跨链消息传递功能。支持查看支持的链列表、各状态目录，以及手续费估算。

桥接流程采用 lock-and-mint 模式：源链锁定资产 → 目标链铸造等值代币。原子交换采用 HTLC（哈希时间锁合约）机制：发起 → 领取（reveal secret）→ 或超时退款。跨链消息支持向目标链合约发送任意 payload。

## 命令参考

### crosschain chains — 支持的链

```bash
chainlesschain crosschain chains
chainlesschain crosschain chains --json
```

列出所有支持的区块链，显示链 ID、名称、符号和 chainId。

### crosschain bridge — 桥接资产

```bash
chainlesschain crosschain bridge <from-chain> <to-chain> <amount>
chainlesschain crosschain bridge ethereum polygon 1.5 -a USDC -s 0xABC -r 0xDEF
chainlesschain crosschain bridge bsc ethereum 10 --json
```

在链之间桥接资产。`-a` 指定资产（默认 native），`-s` 发送方地址，`-r` 接收方地址。返回 bridgeId 和手续费。

### crosschain bridge-status — 更新桥接状态

```bash
chainlesschain crosschain bridge-status <bridge-id> <status>
chainlesschain crosschain bridge-status br-001 confirmed -t 0xTxHash
chainlesschain crosschain bridge-status br-001 failed -e "超时" --json
```

更新桥接交易的状态。`-t` 附加交易哈希，`-e` 附加错误消息。

### crosschain bridge-show — 查看桥接详情

```bash
chainlesschain crosschain bridge-show <bridge-id>
chainlesschain crosschain bridge-show br-001 --json
```

查看桥接交易完整详情：路由、资产、金额、手续费、状态、交易哈希等。

### crosschain bridges — 列出桥接

```bash
chainlesschain crosschain bridges
chainlesschain crosschain bridges -f ethereum -t polygon -s confirmed --limit 20 --json
```

列出桥接交易。支持按源链 `-f`、目标链 `-t`、状态 `-s` 过滤，`--limit` 限制数量。

### crosschain swap — 发起原子交换

```bash
chainlesschain crosschain swap <from-chain> <to-chain> <amount>
chainlesschain crosschain swap ethereum bsc 2.0 -a ETH -b BNB -c 0xCounterparty -t 3600000
chainlesschain crosschain swap polygon ethereum 100 --json
```

发起 HTLC 原子交换。`-a` 源资产，`-b` 目标资产，`-c` 对手方地址，`-t` 超时毫秒数。返回 swapId、hashLock 和过期时间。

### crosschain swap-claim — 领取交换

```bash
chainlesschain crosschain swap-claim <swap-id>
chainlesschain crosschain swap-claim sw-001 -s 0xSecret -t 0xTxHash --json
```

使用 HTLC secret 领取交换。`-s` 提供秘密值，`-t` 附加领取交易哈希。

### crosschain swap-refund — 退款交换

```bash
chainlesschain crosschain swap-refund <swap-id>
chainlesschain crosschain swap-refund sw-001 -t 0xTxHash --json
```

对过期的交换执行退款。`-t` 附加退款交易哈希。

### crosschain swap-show — 查看交换详情

```bash
chainlesschain crosschain swap-show <swap-id>
chainlesschain crosschain swap-show sw-001 --json
```

查看交换的完整详情：路由、资产、金额、hashLock、状态和过期时间。

### crosschain swap-secret — 揭示秘密

```bash
chainlesschain crosschain swap-secret <swap-id>
chainlesschain crosschain swap-secret sw-001 --json
```

揭示已领取交换的 HTLC secret。仅在交换被领取后可用。

### crosschain swaps — 列出交换

```bash
chainlesschain crosschain swaps
chainlesschain crosschain swaps -f ethereum -s claimed --limit 10 --json
```

列出原子交换。支持按源链 `-f`、状态 `-s` 过滤。

### crosschain send — 发送跨链消息

```bash
chainlesschain crosschain send <from-chain> <to-chain>
chainlesschain crosschain send ethereum polygon -p "Hello cross-chain" -c 0xContract --json
```

发送跨链消息。`-p` 指定消息 payload，`-c` 指定目标合约地址。

### crosschain msg-status — 更新消息状态

```bash
chainlesschain crosschain msg-status <message-id> <status>
chainlesschain crosschain msg-status msg-001 delivered -t 0xTxHash --json
```

更新跨链消息的状态。

### crosschain msg-show — 查看消息详情

```bash
chainlesschain crosschain msg-show <message-id>
chainlesschain crosschain msg-show msg-001 --json
```

查看跨链消息的完整详情：路由、payload、状态、重试次数和目标合约。

### crosschain messages — 列出消息

```bash
chainlesschain crosschain messages
chainlesschain crosschain messages -f ethereum -t polygon -s pending --limit 20 --json
```

列出跨链消息。支持按源链、目标链、状态过滤。

### crosschain estimate-fee — 估算手续费

```bash
chainlesschain crosschain estimate-fee <from-chain> <to-chain> <amount>
chainlesschain crosschain estimate-fee ethereum polygon 10 --json
```

预估跨链桥接手续费，返回总费用及明细（源链费、目标链费、桥接费）。

### crosschain stats — 统计数据

```bash
chainlesschain crosschain stats
chainlesschain crosschain stats --json
```

查看跨链操作汇总统计：桥接数量/交易量/手续费、交换数量、消息数量。

## 系统架构

```
用户命令 → crosschain.js (Commander) → cross-chain.js
                                            │
              ┌─────────────────────────────┼──────────────────────┐
              ▼                             ▼                      ▼
         资产桥接                      HTLC 原子交换           跨链消息
   (bridge/bridge-status)       (swap/claim/refund)      (send/msg-status)
              ▼                             ▼                      ▼
                           SQLite (cross_chain_* 表)
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/crosschain.js` | crosschain 命令主入口 |
| `packages/cli/src/lib/cross-chain.js` | 跨链桥接、原子交换、消息传递核心实现 |

## 配置参考

| 配置项 | 含义 | 默认 |
| ------ | ---- | ---- |
| `chains` | 支持的链列表 | ethereum / bsc / polygon / arbitrum / clc |
| `bridge.confirmations` | 确认数 | 依链而定（以太坊 12） |
| `swap.timelock` | 原子交换时间锁（秒） | 3600 |
| `swap.hashAlgo` | HTLC 哈希算法 | `sha256` |
| `message.maxSize` | 跨链消息最大字节 | 8192 |
| V2 channel cap / transfer cap | 见 `cross_chain_v2_cli.md` | 10 / 20 |

## 性能指标

| 操作 | 典型耗时 | 备注 |
| ---- | -------- | ---- |
| `chains` / `tokens` | < 20 ms | 内置枚举 |
| `bridge` 发起 | < 50 ms（本地） | 真实确认依赖目标链 |
| `bridge-status` | < 30 ms | 本地索引查询 |
| `swap` 创建 | < 50 ms | HTLC 写入 SQLite |
| `claim` / `refund` | < 50 ms（本地） | 实际上链由外部执行 |
| `send` 跨链消息 | < 50 ms | 异步投递 |
| V2 transfer dispatch | < 50 ms | `cross_chain_v2_cli.md` |

## 测试覆盖率

```
__tests__/unit/cross-chain.test.js — 83 tests
```

覆盖：链/代币枚举、bridge 全路径、HTLC 原子交换（lock/claim/refund + 超时）、跨链消息 send/status、错误码、幂等。V2 surface：40 V2 tests（见 `cross_chain_v2_cli.md`）。

## 安全考虑

1. **HTLC 时间锁**：`timelock` 必须足够大以覆盖目标链确认时间；过短会被 refund
2. **哈希原像保护**：`swap` 的 preimage 只在 `claim` 前短暂暴露，CLI 端不持久化明文
3. **重放防护**：消息带有 `nonce` + 源链 chainId，避免跨链重放
4. **资产桥接风险**：CLI 仅完成本地状态与意图记录，真实上链由外部 signer/relayer 执行，需配置白名单
5. **V2 pending cap**：`gov-stats-v2` 查看 per-channel pending-transfer 数，防止单通道堆积

## 使用示例

### 场景 1：资产桥接

```bash
# 查看支持的链
chainlesschain crosschain chains

# 估算手续费
chainlesschain crosschain estimate-fee ethereum polygon 10

# 发起桥接
chainlesschain crosschain bridge ethereum polygon 10 -a USDC -s 0xSender -r 0xRecipient

# 确认桥接
chainlesschain crosschain bridge-status br-001 confirmed -t 0xTxHash
```

### 场景 2：HTLC 原子交换

```bash
# 发起交换
chainlesschain crosschain swap ethereum bsc 1.0 -a ETH -b BNB -c 0xCounterparty

# 对手方领取（需要 secret）
chainlesschain crosschain swap-claim sw-001 -s 0xSecret

# 或超时退款
chainlesschain crosschain swap-refund sw-001
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Failed: unsupported chain" | 链 ID 不在支持列表 | 运行 `chains` 查看支持列表 |
| "Secret unavailable" | 交换未领取 | 仅领取后才可揭示 secret |
| 手续费估算失败 | 链对不支持 | 检查 from/to 链是否有效 |

## 相关文档

- [钱包管理](./cli-wallet) — 数字资产钱包
- [ZKP 零知识证明](./cli-zkp) — 零知识证明编译与验证
- [经济系统](./cli-economy) — 支付与 NFT
