# 信誉优化 (reputation)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📊 **观测记录**: 记录 DID 信誉观测值（score 0~1，支持 kind 和 weight）
- 📉 **时间衰减**: 支持 exponential / linear / step / none 四种衰减模型
- 🔍 **异常检测**: z_score 和 IQR 两种异常检测方法
- 🧪 **贝叶斯优化**: 模拟贝叶斯优化搜索最优信誉算法参数
- 📈 **分析报告**: 分布直方图、异常摘要、优化建议

## 概述

ChainlessChain CLI 信誉优化模块（Phase 60）管理去中心化身份（DID）的信誉评分。`observe` 记录信誉观测，`score` 计算带衰减的聚合分数，`anomalies` 检测异常 DID，`optimize` 通过模拟贝叶斯优化搜索最佳衰减参数和阈值，`analytics` 展示优化运行的详细分析。

命令别名：`cc rep` 等价于 `cc reputation`。

## 命令参考

### reputation observe — 记录观测

```bash
chainlesschain reputation observe <did> <score>
chainlesschain reputation observe did:key:z6Mk... 0.85 -k task -w 2.0
chainlesschain rep observe did:key:z6Mk... 0.6 --kind review --json
```

记录一条信誉观测。`score` 范围 [0, 1]，`-k` 指定类型（generic / task / review / vote），`-w` 设置权重。

### reputation score — 计算聚合分数

```bash
chainlesschain reputation score <did>
chainlesschain rep score did:key:z6Mk... -d exponential --lambda 0.01
chainlesschain rep score did:key:z6Mk... -d linear --alpha 0.001 --json
```

计算指定 DID 的聚合信誉分数。`-d` 指定衰减模型：

| 衰减模型 | 说明 | 参数 |
|----------|------|------|
| `none` | 无衰减（默认） | — |
| `exponential` | 指数衰减 | `--lambda` (衰减速率) |
| `linear` | 线性衰减 | `--alpha` (衰减斜率) |
| `step` | 阶梯衰减 | — |

### reputation list — 列出所有 DID 分数

```bash
chainlesschain reputation list
chainlesschain rep list -d exponential --limit 20 --json
```

按聚合分数排序列出所有已跟踪的 DID。

### reputation anomalies — 异常检测

```bash
chainlesschain reputation anomalies
chainlesschain rep anomalies -m iqr -t 1.5 -d exponential --json
```

检测信誉分数中的异常 DID。`-m` 选择检测方法（`z_score` 默认 / `iqr`），`-t` 设置检测阈值，`-d` 在检测前应用衰减。

### reputation optimize — 参数优化

```bash
chainlesschain reputation optimize
chainlesschain rep optimize -o fairness -i 100 --json
```

运行模拟贝叶斯优化，搜索最优信誉算法参数。`-o` 指定优化目标：

| 目标 | 说明 |
|------|------|
| `accuracy` | 最大化评分准确度（默认） |
| `fairness` | 最大化公平性 |
| `resilience` | 最大化抗攻击能力 |
| `convergence_speed` | 最大化收敛速度 |

`-i` 设置迭代次数（默认 50）。

### reputation status — 优化运行状态

```bash
chainlesschain rep status <run-id>
chainlesschain rep status opt-001 --json
```

查看指定优化运行的状态、最佳分数和最优参数。

### reputation analytics — 优化分析

```bash
chainlesschain rep analytics <run-id>
chainlesschain rep analytics opt-001 --json
```

查看优化运行的详细分析：信誉分布直方图、异常摘要、优化建议。

### reputation runs — 优化历史

```bash
chainlesschain rep runs
chainlesschain rep runs --limit 20 --json
```

列出所有优化运行的历史记录。

### reputation apply — 应用优化结果

```bash
chainlesschain rep apply <run-id>
```

将指定优化运行的最优参数标记为已应用。

### reputation objectives — 优化目标列表

```bash
chainlesschain rep objectives
chainlesschain rep objectives --json
```

列出所有支持的优化目标（accuracy / fairness / resilience / convergence_speed）。

## 系统架构

```
用户命令 → reputation.js (Commander) → reputation-optimizer.js
                                              │
              ┌───────────────────────────────┼──────────────────────┐
              ▼                               ▼                      ▼
         观测管理                         分数计算                 优化引擎
   (observe/list)                  (score/anomalies)       (optimize/analytics)
              ▼                               ▼                      ▼
     reputation_observations          衰减模型应用           模拟贝叶斯搜索
                                   (exp/linear/step)        (参数空间探索)
```

## 配置参考

```bash
# observe
<did>                          # DID 标识符（必填）
<score>                        # 分数 0~1（必填）
-k, --kind <kind>              # 类型: generic|task|review|vote
-w, --weight <n>               # 权重 (默认 1)

# score / list / anomalies
-d, --decay <model>            # 衰减模型: none|exponential|linear|step
--lambda <n>                   # 指数衰减 lambda
--alpha <n>                    # 线性衰减 alpha

# anomalies
-m, --method <method>          # 检测方法: z_score|iqr
-t, --threshold <n>            # 检测阈值

# optimize
-o, --objective <name>         # 目标: accuracy|fairness|resilience|convergence_speed
-i, --iterations <n>           # 迭代次数 (默认 50)

# 通用
--json                         # JSON 输出
--limit <n>                    # 最大条目数
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/reputation.js` | reputation 命令主入口（含 `rep` 别名） |
| `packages/cli/src/lib/reputation-optimizer.js` | 观测存储、衰减计算、异常检测、贝叶斯优化核心实现 |

## 性能指标

| 操作 | 典型耗时 | 备注 |
| ---- | -------- | ---- |
| `observe` | < 15 ms | 单行 INSERT |
| `score` | < 30 ms | 聚合 + 衰减计算 |
| `list` | < 50 ms | 带索引 LIMIT |
| `anomalies` (z_score/iqr) | < 100 ms | 基于最近窗口 |
| `optimize` 50 iter | 典型 1–3 s | 简化贝叶斯，全程在 JS 侧 |

## 测试覆盖率

```
__tests__/unit/reputation-optimizer.test.js — 79 tests
```

覆盖 observe 写入、none/exponential/linear/step 四种衰减、z_score/iqr 异常检测、accuracy/fairness/resilience/convergence_speed 四种目标下的 optimize 循环、参数 clipping、JSON 输出形状。

## 安全考虑

1. **观测来源**：`observe` 不做签名验证；生产部署建议封装为 signed event 后入库
2. **DID 去重**：相同 DID 的多次 observe 按 `ts` 聚合，防止双花刷分
3. **异常阈值**：`z_score` 默认 3σ；过于宽松会漏报，过严会误报
4. **优化发散**：`optimize` 设置 `iterations` 上限（默认 50）+ 容忍度提前终止，避免无限循环
5. **隐私**：`score/list` 不输出原始观测时间戳明文，仅聚合值；需调试请 `--json` 显式请求

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| `score` 始终为 0 | `observe` 未落库（未指定 `-k`） | 检查 `list` 是否有数据 |
| 异常检测误报 | 样本量不足 / 分布偏斜 | 增大窗口或切换 `iqr` |
| `optimize` 不收敛 | 目标冲突 / `iterations` 过小 | 放宽目标或升高 iter |
| `observe` 拒绝 | score 越界 (非 0–1) | 在调用前做 clamp |

## 测试

```bash
cd packages/cli
npx vitest run __tests__/unit/reputation-optimizer.test.js
# 45 tests, all pass
```

## 使用示例

### 场景：信誉评估与优化

```bash
# 1. 记录多次观测
chainlesschain rep observe did:key:z6MkA... 0.9 -k task
chainlesschain rep observe did:key:z6MkA... 0.85 -k review
chainlesschain rep observe did:key:z6MkB... 0.3 -k vote

# 2. 查看分数（带指数衰减）
chainlesschain rep score did:key:z6MkA... -d exponential

# 3. 异常检测
chainlesschain rep anomalies -m z_score -d exponential

# 4. 运行优化
chainlesschain rep optimize -o accuracy -i 100

# 5. 查看分析并应用
chainlesschain rep analytics <run-id>
chainlesschain rep apply <run-id>
```

## 相关文档

- [SLA 管理](./cli-sla) — 跨组织服务等级协议
- [安全加固](./cli-hardening) — 性能基线与安全审计
- [合规管理](./cli-compliance) — 合规框架与扫描
