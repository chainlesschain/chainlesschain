# ZKP 零知识证明引擎 (zkp)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔐 **电路编译**: 自定义 DSL 到 R1CS（Rank-1 Constraint System）的编译
- 🧮 **Groth16 证明方案**: 高效的 zk-SNARK 证明生成与验证
- 🛡️ **zk-SNARK / zk-STARK**: 支持简洁非交互式零知识论证
- 🪪 **选择性身份披露**: 仅证明身份属性而不暴露原始数据
- 📊 **统计面板**: 电路数量、证明次数、验证成功率等关键指标
- ⚡ **高性能**: 优化的约束系统，毫秒级证明验证

## 概述

ChainlessChain CLI ZKP 引擎提供零知识证明的完整工具链。用户首先通过 `compile` 命令将电路定义（约束关系）编译为 R1CS 格式，生成证明密钥和验证密钥。然后使用 `prove` 命令结合私有输入和公共输入生成零知识证明，最后通过 `verify` 命令验证证明有效性。

`identity` 命令提供面向身份场景的便捷接口，允许选择性披露身份属性——例如证明"年龄大于 18 岁"而不透露具体年龄，或证明"拥有某项认证"而不暴露认证编号。这在隐私保护、合规验证、匿名投票等场景中有广泛应用。

## 命令参考

### zkp compile — 编译电路

```bash
chainlesschain zkp compile <name>
chainlesschain zkp compile "age-check" --definition '{"constraints":[{"type":"range","field":"age","min":18}]}'
chainlesschain zkp compile "balance-proof" --definition '{"constraints":[{"type":"comparison","field":"balance","op":">=","value":100}]}'
```

编译一个 ZKP 电路，将约束定义转换为 R1CS 格式。输出电路 ID、约束数量和验证密钥。

### zkp prove — 生成证明

```bash
chainlesschain zkp prove <circuit-id>
chainlesschain zkp prove circ-001 --private '{"age":25}' --public '{"minAge":18}'
chainlesschain zkp prove circ-002 --private '{"balance":500}' --public '{"threshold":100}' --json
```

基于已编译电路和输入数据生成零知识证明。`--private` 为证明者的私有输入（不公开），`--public` 为公共输入（验证者可见）。

### zkp verify — 验证证明

```bash
chainlesschain zkp verify <proof-id>
chainlesschain zkp verify proof-001 --json
```

验证零知识证明的有效性，返回验证结果（通过/失败）和验证耗时。

### zkp identity — 身份证明

```bash
chainlesschain zkp identity --claim '{"attribute":"age","predicate":">=","value":18}'
chainlesschain zkp identity --claim '{"attribute":"role","predicate":"==","value":"admin"}' --json
```

创建选择性身份披露证明。声明特定属性满足某条件，而不透露属性原始值。

### zkp stats — 统计信息

```bash
chainlesschain zkp stats
chainlesschain zkp stats --json
```

显示 ZKP 引擎的使用统计：已编译电路数、已生成证明数、验证成功率、平均证明/验证耗时。

### zkp circuits — 列出电路

```bash
chainlesschain zkp circuits
chainlesschain zkp circuits --json
```

列出所有已编译的电路及其约束数量、创建时间等信息。

### zkp proofs — 列出证明

```bash
chainlesschain zkp proofs
chainlesschain zkp proofs --circuit <circuit-id>          # 按电路过滤
chainlesschain zkp proofs --json
```

列出所有已生成的零知识证明及其验证状态。

## 证明流程

```
1. 定义电路约束
       │
       ▼
2. compile → R1CS + 证明密钥(pk) + 验证密钥(vk)
       │
       ▼
3. prove(pk, private_input, public_input) → proof
       │
       ▼
4. verify(vk, proof, public_input) → true/false
```

## 数据库表

| 表名 | 说明 |
|------|------|
| `zkp_circuits` | 电路注册表（名称、定义、约束数、证明密钥、验证密钥） |
| `zkp_proofs` | 证明记录（电路 ID、证明数据、公共输入、验证状态、时间戳） |

## 系统架构

```
用户命令 → zkp.js (Commander) → zkp-engine.js
                                      │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
             电路编译器          证明生成器          身份证明器
           (DSL → R1CS)      (Fiat-Shamir)      (选择性披露)
              BN254域             SHA-256          Commitment
                    │                │                │
                    ▼                ▼                ▼
            zkp_circuits       zkp_proofs        身份属性缓存
```

### 技术细节

- **有限域**: BN254 曲线阶 (256-bit 素数 `2188824287...5808495617`)
- **R1CS 约束**: 每个约束 `A[i] · w × B[i] · w = C[i] · w`，其中 w 为 witness 向量
- **证明元素**: `pi_a = H(witness, vk.alpha)`, `pi_b = H(witness, vk.beta)`, `pi_c = H(pi_a, pi_b, public_inputs, vk.delta)`
- **验证**: 重新计算 `expected_pi_c` 并与提交的 `pi_c` 比较，篡改任何元素均可检测
- **身份证明**: 基于 SHA-256 的承诺方案，对所有 claim 排序后计算全局承诺

## 使用示例

### 场景 1：年龄证明（不泄露具体年龄）

```bash
# 编译年龄验证电路
chainlesschain zkp compile --name "age-over-18" \
  --definition '{
    "constraints": [{"type":"range","field":"age","min":18,"max":150}],
    "inputs": ["age"],
    "outputs": ["isAdult"]
  }'

# 使用真实数据生成证明（不暴露 age 值）
chainlesschain zkp prove <circuit-id> \
  --witness '{"age": 25}'

# 验证方只需验证证明，无法获知具体年龄
chainlesschain zkp verify <circuit-id> <proof-id>
```

### 场景 2：DID 身份选择性披露

```bash
# 创建身份证明（只披露 "role" 字段）
chainlesschain zkp identity \
  --claims '{"name":"Alice","role":"developer","salary":80000}' \
  --disclose '["role"]'

# 结果：验证方可确认 role=developer，但无法获知 name 和 salary
```

### 场景 3：批量验证

```bash
# 查看所有已编译的电路
chainlesschain zkp circuits

# 查看所有生成的证明
chainlesschain zkp proofs

# 查看统计信息（电路数、证明数、验证次数）
chainlesschain zkp stats --json
```

## 故障排查

### 电路编译与证明问题

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Circuit compilation failed" | 约束定义 JSON 格式错误 | 检查 `--definition` 的 JSON 语法，确保有 constraints/inputs/outputs |
| "Invalid witness" | witness 数据与电路输入不匹配 | 确保 witness 包含电路定义中所有 inputs 字段 |
| "Proof verification failed" | 证明已损坏或 public inputs 不匹配 | 重新生成证明或检查 circuit-id 是否对应 |
| "Circuit not found" | circuit-id 不存在 | 使用 `zkp circuits` 查看可用电路 |
| 选择性披露结果为空 | `--disclose` 字段名不在 claims 中 | 确认披露字段名与 claims 的 key 完全一致 |

### 常见错误

```bash
# 错误: "No circuits compiled"
# 原因: 未编译任何电路
# 修复:
chainlesschain zkp compile --name "my-circuit" --definition '...'

# 错误: "Proof scheme not supported"
# 原因: 使用了不支持的证明方案
# 修复: 当前支持 groth16（默认）

# 错误: "Database not available"
# 修复:
chainlesschain db init
```

## 安全考虑

- 证明密钥（pk）包含电路秘密参数，不应公开分享
- 验证密钥（vk）可安全公开，任何人都可验证证明
- 私有输入仅在证明生成时使用，不会包含在证明数据中
- 身份证明使用 commitment 方案，属性原始值无法从证明中反推
- **可信设置安全**: 电路编译阶段的可信设置参数（toxic waste）在生成后立即销毁，防止伪造证明

## 关键文件

- `packages/cli/src/commands/zkp.js` — 命令实现
- `packages/cli/src/lib/zkp-engine.js` — ZKP 引擎库

## 相关文档

- [DID 身份](./cli-did) — 去中心化身份管理
- [文件加密](./cli-encrypt) — AES-256-GCM 加密
- [Agent 经济](./cli-economy) — 隐私交易支持
