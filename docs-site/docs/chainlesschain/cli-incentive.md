# 代币激励 (incentive)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **代币账本**: 管理账户余额、铸造 (mint)、转账 (transfer)
- **贡献记录**: 记录七种贡献类型，每种有基础奖励值
- **自动奖励**: 贡献记录时可自动发放代币奖励，支持倍率调节
- **交易历史**: 完整的交易记录（转账、奖励、铸造、销毁）
- **贡献排行榜**: 按总奖励排名的贡献者排行

## 概述

ChainlessChain CLI 代币激励模块 (Phase 66) 提供技能市场经济层的代币管理。`mint` 铸造代币到账户，`transfer` 在账户间转账，`balance` 查询余额。`contribute` 记录贡献（技能发布、调用提供、代码贡献等），每种贡献有预设基础奖励。`reward` 对已记录的贡献发放代币，支持 `--auto-reward` 和 `--multiplier` 自动调节。`leaderboard` 展示贡献者排行。

## 命令参考

### incentive contribution-types — 贡献类型

```bash
chainlesschain incentive contribution-types
chainlesschain incentive contribution-types --json
```

列出贡献类型及其基础奖励：skill_publication、invocation_provided、skill_review、bug_report、code_contribution、documentation、community_support。

### incentive tx-types — 交易类型

```bash
chainlesschain incentive tx-types --json
```

列出交易类型：transfer、reward、mint、burn。

### incentive balance — 查询余额

```bash
chainlesschain incentive balance alice
chainlesschain incentive balance alice --json
```

查询账户代币余额、总收入、总支出。

### incentive accounts — 列出账户

```bash
chainlesschain incentive accounts
chainlesschain incentive accounts --limit 20 --json
```

列出所有账户（按余额降序）。

### incentive mint — 铸造代币

```bash
chainlesschain incentive mint alice 1000 -r "初始发放"
chainlesschain incentive mint bob 500 --json
```

铸造代币到指定账户（管理员操作）。`-r` 附加原因。

### incentive transfer — 转账

```bash
chainlesschain incentive transfer alice bob 100 -r "服务费用"
chainlesschain incentive transfer alice bob 50 --json
```

在账户间转移代币。`-r` 附加原因。

### incentive history — 交易历史

```bash
chainlesschain incentive history
chainlesschain incentive history -a alice -t reward --limit 20 --json
```

查看交易历史。`-a` 按账户过滤（from 或 to），`-t` 按交易类型过滤。

### incentive contribute — 记录贡献

```bash
chainlesschain incentive contribute alice skill_publication 1
chainlesschain incentive contribute bob code_contribution 5 -m '{"pr":"#123"}' -a -M 1.5 --json
```

记录贡献。type 为七种贡献类型之一，value 默认 1。`-m` 元数据 JSON，`-a` 自动奖励，`-M` 奖励倍率 (默认 1.0)。

### incentive reward — 手动奖励

```bash
chainlesschain incentive reward <contribution-id>
chainlesschain incentive reward <contribution-id> -M 2.0 --json
```

对已记录的贡献发放代币奖励。`-M` 倍率 (默认 1.0)。

### incentive contributions — 列出贡献

```bash
chainlesschain incentive contributions
chainlesschain incentive contributions -u alice -t code_contribution --rewarded --limit 20 --json
```

列出贡献。`-u` 按用户过滤，`-t` 按类型过滤，`--rewarded` / `--unrewarded` 过滤已/未奖励。

### incentive leaderboard — 贡献排行榜

```bash
chainlesschain incentive leaderboard
chainlesschain incentive leaderboard --limit 20 --json
```

按总奖励排名的贡献者排行，显示总奖励、总贡献值、贡献次数。

## 数据库表

| 表名 | 说明 |
|------|------|
| `token_accounts` | 账户（余额、总收入、总支出） |
| `token_transactions` | 交易记录（类型、金额、来源、目标、原因） |
| `token_contributions` | 贡献记录（用户、类型、值、元数据、奖励状态、奖励金额） |

## 系统架构

```
用户命令 → incentive.js (Commander) → token-incentive.js
                                            │
              ┌────────────────────────────┼──────────────────┐
              ▼                            ▼                   ▼
          账本管理                      贡献管理             排行榜
   (mint/transfer/balance/       (contribute/reward/       (leaderboard)
    accounts/history)             contributions)
              ▼                            ▼                   ▼
    token_accounts +             token_contributions      聚合查询
    token_transactions
```

## 配置参考

```bash
# incentive mint
<to> <amount>                  # 目标账户和金额（必填）
-r, --reason <text>            # 原因

# incentive transfer
<from> <to> <amount>           # 来源、目标、金额（必填）
-r, --reason <text>            # 原因

# incentive contribute
<user-id> <type> [value]       # 用户、贡献类型、值 (默认 1)
-m, --metadata <json>          # 元数据 JSON
-a, --auto-reward              # 自动奖励
-M, --multiplier <n>           # 奖励倍率 (默认 1.0)

# incentive reward
<contribution-id>              # 贡献 ID（必填）
-M, --multiplier <n>           # 奖励倍率 (默认 1.0)
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| mint 铸造 | < 200ms | ~90ms | OK |
| transfer 转账 | < 200ms | ~100ms | OK |
| contribute 记录 | < 200ms | ~110ms | OK |
| history 查询 (50 条) | < 300ms | ~150ms | OK |
| leaderboard (10 条) | < 300ms | ~120ms | OK |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/incentive.js` | incentive 命令主入口 (Phase 66) |
| `packages/cli/src/lib/token-incentive.js` | 账本、贡献、奖励、排行榜核心实现 |
