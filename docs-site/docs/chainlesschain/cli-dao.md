# DAO 治理 v2 (dao)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📜 **提案管理**: 创建和管理治理提案，支持描述和投票周期配置
- 🗳️ **二次方投票**: 支持 simple 和 quadratic 两种投票模式，二次方投票成本 = Math.sqrt(weight)
- 🤝 **投票委托**: 将投票权委托给其他参与者，支持权重分配
- ⚙️ **自动执行**: 通过的提案可自动执行，支持执行延迟配置
- 💰 **国库管理**: 查看国库余额和资金分配记录
- 📊 **治理统计**: 提案总数、活跃提案、执行率、委托关系等指标

## 概述

ChainlessChain CLI DAO 治理 v2 系统为去中心化社区提供了完整的链上治理能力。通过 `propose` 创建治理提案，社区成员可以使用 `vote` 进行投票。系统支持两种投票模式：简单多数投票（simple）和二次方投票（quadratic）。二次方投票中，投票成本按 `Math.sqrt(weight)` 计算，有效防止投票权集中。

`delegate` 允许将投票权委托给信任的代表。当提案通过后，`execute` 触发自动执行。`treasury` 和 `allocate` 管理社区国库资金的查看和分配。`configure` 可调整投票周期、法定人数和执行延迟等治理参数。

## 命令参考

### dao propose — 创建治理提案

```bash
chainlesschain dao propose <title>
chainlesschain dao propose "增加开发基金" -d "将国库 20% 分配给核心开发" -p alice
chainlesschain dao propose "升级协议" --voting-type quadratic
```

创建一个治理提案。支持 `--voting-type` 选择投票模式（simple 或 quadratic）。

### dao vote — 投票

```bash
chainlesschain dao vote <proposal-id> <direction>
chainlesschain dao vote prop-001 for -v alice -w 5
chainlesschain dao vote prop-001 against --voter bob --weight 3
```

对指定提案投票，direction 为 `for` 或 `against`。`--weight` 设置投票权重。

### dao delegate — 委托投票权

```bash
chainlesschain dao delegate <delegator> <delegate-to>
chainlesschain dao delegate alice bob -w 2
```

将 delegator 的投票权委托给 delegate-to，支持 `--weight` 指定委托权重。

### dao execute — 执行提案

```bash
chainlesschain dao execute <proposal-id>
chainlesschain dao execute prop-001
```

执行已通过的提案。提案须满足法定人数且投票周期已结束。

### dao treasury — 查看国库

```bash
chainlesschain dao treasury
chainlesschain dao treasury --json
```

显示国库余额和历史资金分配记录。

### dao allocate — 分配国库资金

```bash
chainlesschain dao allocate <proposal-id> <amount>
chainlesschain dao allocate prop-001 500 -d "核心开发基金第一期"
```

将国库资金分配给指定提案，需附带分配说明。

### dao stats — 治理统计

```bash
chainlesschain dao stats
chainlesschain dao stats --json
```

显示治理统计信息：提案总数、活跃提案、已执行提案、委托数量、国库余额。

### dao configure — 配置治理参数

```bash
chainlesschain dao configure --voting-period 604800000 --quorum 0.5 --execution-delay 86400000
```

更新治理配置：投票周期（毫秒）、法定人数比例（0-1）、执行延迟（毫秒）。

## 数据库表

| 表名 | 说明 |
|------|------|
| `dao_v2_proposals` | 提案（标题、描述、提议者、状态、投票类型、结束时间） |
| `dao_v2_votes` | 投票记录（提案 ID、投票者、方向、权重） |
| `dao_v2_treasury` | 国库（余额、分配记录、描述） |
| `dao_v2_delegations` | 委托记录（委托方、受委托方、权重） |

## 系统架构

```
用户命令 → dao.js (Commander) → dao-governance.js
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
          提案管理                  投票引擎                国库管理
      (创建/执行)          (simple/quadratic)        (余额/分配)
                ▼                      ▼                      ▼
     dao_v2_proposals          dao_v2_votes           dao_v2_treasury
                               dao_v2_delegations
```

## 关键文件

- `packages/cli/src/commands/dao.js` — 命令实现
- `packages/cli/src/lib/dao-governance.js` — DAO 治理库

## 测试

```bash
npx vitest run __tests__/unit/dao-governance.test.js
# 33 tests, all pass
```

## 使用示例

### 场景 1：创建提案并投票

```bash
# 创建二次方投票提案
chainlesschain dao propose "社区基金分配方案" \
  -d "将国库 30% 分配至生态建设" \
  --voting-type quadratic

# 社区成员投票
chainlesschain dao vote prop-001 for -v alice -w 4
chainlesschain dao vote prop-001 for -v bob -w 9
chainlesschain dao vote prop-001 against -v carol -w 1

# 查看统计
chainlesschain dao stats
```

### 场景 2：委托投票与执行

```bash
# Alice 将投票权委托给 Bob
chainlesschain dao delegate alice bob -w 3

# 执行通过的提案
chainlesschain dao execute prop-001

# 分配国库资金
chainlesschain dao allocate prop-001 1000 -d "生态建设基金"

# 查看国库
chainlesschain dao treasury --json
```

## 安全考虑

- **投票唯一性**: 同一投票者对同一提案只能投票一次
- **二次方投票防操控**: 投票成本随权重非线性增长，防止鲸鱼操纵
- **国库审计**: 所有资金分配记录不可删除，支持完整审计轨迹
- **执行延迟**: 提案通过后有执行延迟窗口期，给社区时间审查
- **法定人数**: 提案必须达到法定投票人数才能生效

## 相关文档

- [Agent 经济系统](./cli-economy) — 微支付与资源市场
- [钱包管理](./cli-wallet) — 数字资产钱包
- [组织管理](./cli-org) — 企业组织架构
