# 隐私计算 (privacy)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🤖 **联邦学习**: 创建模型、训练轮次、状态管理（Phase 91）
- 🔐 **安全多方计算**: MPC 计算创建、秘密份额提交（Shamir/Beaver/GMW）
- 🎲 **差分隐私**: 使用 Laplace/Gaussian/Exponential 机制发布带噪声的数据
- 🔒 **同态加密**: 在加密数据上执行聚合查询（Paillier/BFV/CKKS）
- 📊 **隐私报告**: 查看隐私预算消耗和各模块统计

## 概述

ChainlessChain CLI 隐私计算模块（Phase 91）提供四大隐私保护技术的完整 CLI 接口：联邦学习（FL）、安全多方计算（MPC）、差分隐私（DP）和同态加密（HE）。

联邦学习支持模型创建、轮次训练和生命周期管理。MPC 支持 Shamir 秘密共享、Beaver 三元组和 GMW 协议。差分隐私支持三种噪声机制并追踪隐私预算消耗。同态加密支持在加密数据上执行 sum/product/mean/count 聚合操作。

## 命令参考

### privacy protocols — MPC 协议目录

```bash
chainlesschain privacy protocols
chainlesschain privacy protocols --json
```

列出支持的安全多方计算协议：Shamir 秘密共享、Beaver 三元组、GMW 协议。

### privacy dp-mechanisms — 差分隐私机制

```bash
chainlesschain privacy dp-mechanisms
chainlesschain privacy dp-mechanisms --json
```

列出支持的差分隐私噪声机制：Laplace、Gaussian、Exponential。

### privacy he-schemes — 同态加密方案

```bash
chainlesschain privacy he-schemes
chainlesschain privacy he-schemes --json
```

列出支持的同态加密方案：Paillier（部分同态）、BFV（整数 FHE）、CKKS（近似 FHE）。

### privacy create-model — 创建联邦学习模型

```bash
chainlesschain privacy create-model <name>
chainlesschain privacy create-model "sentiment-classifier" -t neural_network -a mlp -r 10 -l 0.01 -p 5
chainlesschain privacy create-model "my-model" --json
```

创建联邦学习模型。`-t` 模型类型，`-a` 架构，`-r` 总训练轮次，`-l` 学习率，`-p` 参与方数量。

### privacy train — 训练一轮

```bash
chainlesschain privacy train <model-id>
chainlesschain privacy train mdl-001 --json
```

对指定模型执行一轮联邦训练。返回当前轮次、准确率和模型状态。

### privacy fail-model — 标记模型失败

```bash
chainlesschain privacy fail-model <model-id>
chainlesschain privacy fail-model mdl-001 -r "收敛失败"
chainlesschain privacy fail-model mdl-001 --json
```

将模型标记为失败状态。`-r` 附加失败原因。

### privacy show-model — 查看模型详情

```bash
chainlesschain privacy show-model <model-id>
chainlesschain privacy show-model mdl-001 --json
```

查看模型完整信息：名称、类型、架构、状态、训练进度、准确率、损失和隐私预算消耗。

### privacy models — 列出模型

```bash
chainlesschain privacy models
chainlesschain privacy models -s training --limit 10 --json
```

列出联邦学习模型。`-s` 按状态过滤，`--limit` 限制数量。

### privacy create-computation — 创建 MPC 计算

```bash
chainlesschain privacy create-computation <type>
chainlesschain privacy create-computation sum -p shamir -i "alice,bob,charlie" -t 2
chainlesschain privacy create-computation average -p beaver --json
```

创建安全多方计算。`<type>` 为计算类型，`-p` 指定协议（shamir/beaver/gmw），`-i` 参与方 ID（逗号分隔），`-t` 需要的份额阈值。

### privacy submit-share — 提交份额

```bash
chainlesschain privacy submit-share <computation-id>
chainlesschain privacy submit-share comp-001 --json
```

向 MPC 计算提交一个秘密份额。返回已接收份额数和当前状态。

### privacy show-computation — 查看计算详情

```bash
chainlesschain privacy show-computation <computation-id>
chainlesschain privacy show-computation comp-001 --json
```

查看 MPC 计算详情：类型、协议、状态、份额进度、结果哈希和计算耗时。

### privacy computations — 列出计算

```bash
chainlesschain privacy computations
chainlesschain privacy computations -p shamir -s completed --limit 20 --json
```

列出 MPC 计算。支持按协议 `-p` 和状态 `-s` 过滤。

### privacy dp-publish — 差分隐私发布

```bash
chainlesschain privacy dp-publish -d 42 -e 1.0 -m laplace
chainlesschain privacy dp-publish -d "[1,2,3,4,5]" -e 0.5 --delta 1e-5 -m gaussian -s 1.0
chainlesschain privacy dp-publish -d 100 --json
```

使用差分隐私噪声发布数据。`-d` 原始数据（数值或 JSON 数组），`-e` epsilon 参数，`--delta` delta 参数，`-m` 噪声机制，`-s` 灵敏度。返回加噪后的数据和隐私预算消耗。

### privacy he-query — 同态加密查询

```bash
chainlesschain privacy he-query -d "[10,20,30]" -o sum -s paillier
chainlesschain privacy he-query -d "[1.5,2.5,3.5]" -o mean -s ckks --json
chainlesschain privacy he-query -d "[1,2,3,4]" -o product -s bfv
```

在加密数据上执行聚合查询（模拟 HE）。`-d` 数据数组（JSON），`-o` 运算（sum/product/mean/count），`-s` HE 方案。

### privacy report — 隐私报告

```bash
chainlesschain privacy report
chainlesschain privacy report --json
```

查看隐私计算综合报告：隐私预算（已用/剩余/上限）、联邦学习统计（模型数/完成数/平均准确率）、MPC 统计（计算数/完成数/待处理数）。

## 系统架构

```
用户命令 → privacy.js (Commander) → privacy-computing.js
                                          │
           ┌──────────────────────────────┼──────────────────────┐
           ▼                              ▼                      ▼
      联邦学习 (FL)                安全多方计算 (MPC)        DP / HE
  (create/train/fail)         (create/submit-share)    (dp-publish/he-query)
           ▼                              ▼                      ▼
                         SQLite (privacy_* 表)
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/privacy.js` | privacy 命令主入口 |
| `packages/cli/src/lib/privacy-computing.js` | 联邦学习、MPC、差分隐私、同态加密核心实现 |

## 配置参考

| 配置项 | 含义 | 默认 |
| ------ | ---- | ---- |
| `fl.rounds` | 联邦训练轮数 | 5 |
| `fl.participants` | 默认参与方 | 3 |
| `fl.aggregation` | 聚合方式 | `fedavg` |
| `dp.epsilon` | 差分隐私 ε | 1.0 |
| `dp.delta` | 差分隐私 δ | 1e-5 |
| `mpc.protocol` | MPC 协议 | `shamir` |
| `he.scheme` | 同态加密方案 | `paillier` |

## 性能指标

| 操作 | 典型耗时 | 备注 |
| ---- | -------- | ---- |
| `create-model` | < 50 ms | 本地注册 |
| `train` 单轮 | 依赖数据规模 | 合成路径用于冒烟/回归 |
| `aggregate` | < 100 ms | FedAvg 合并 |
| `mpc compute` | < 200 ms | Shamir 3-方 |
| `dp-noise` | < 20 ms | 一次加噪 |
| `he encrypt/decrypt` | < 100 ms | Paillier 2048-bit |

合成指标仅供管线搭建回归，真实性能取决于底层数值库。

## 测试覆盖率

```
__tests__/unit/privacy-computing.test.js — 90 tests
```

覆盖：FL create-model / train / aggregate、MPC Shamir split/combine/compute、差分隐私拉普拉斯 / 高斯加噪、Paillier 加解密与同态加法、隐私预算管理。

## 安全考虑

1. **ε/δ 预算**：差分隐私一旦耗尽预算应拒绝发布；CLI 会在 `dp-status` 提示剩余预算
2. **密钥管理**：MPC 份额与 HE 密钥使用 AES-256-GCM 加密存于 SQLite，派生自环境 secret
3. **参与方验证**：联邦学习默认信任本地参与方列表；跨组织场景需叠加 DID/签名
4. **恶意输入防护**：`aggregate` 自带异常值裁剪（clipping）防止投毒
5. **算法选择**：Paillier 仅支持加法同态，乘法请切换 CKKS/BFV（当前为 roadmap）

## 使用示例

### 场景 1：联邦学习

```bash
# 创建模型
chainlesschain privacy create-model "classifier" -t neural_network -r 5 -p 3

# 训练多轮
chainlesschain privacy train mdl-001
chainlesschain privacy train mdl-001
chainlesschain privacy train mdl-001

# 查看进度
chainlesschain privacy show-model mdl-001
```

### 场景 2：安全多方计算

```bash
# 创建计算
chainlesschain privacy create-computation sum -p shamir -i "a,b,c" -t 2

# 各方提交份额
chainlesschain privacy submit-share comp-001
chainlesschain privacy submit-share comp-001

# 查看结果
chainlesschain privacy show-computation comp-001
```

### 场景 3：差分隐私数据发布

```bash
# 使用 Laplace 机制发布单个值
chainlesschain privacy dp-publish -d 42 -e 1.0 -m laplace

# 查看隐私预算消耗
chainlesschain privacy report --json
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "budget exceeded" | 隐私预算用尽 | 增大 epsilon 或减少查询次数 |
| "Model not found" | 模型 ID 错误 | 使用 `models` 查看已有模型 |
| HE 查询结果为 null | 操作或数据无效 | 检查 `-d` JSON 格式和 `-o` 操作 |

## 相关文档

- [ZKP 零知识证明](./cli-zkp) — 零知识证明编译与验证
- [PQC 后量子密码](./cli-pqc) — 后量子密钥管理
- [DLP 数据防泄漏](./cli-dlp) — 数据泄漏扫描与策略
