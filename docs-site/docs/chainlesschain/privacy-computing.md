# 隐私计算框架

> **版本: v4.2.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 2 数据库表 | Phase 91**

## 概述

隐私计算框架提供端到端的隐私保护能力，在数据不出域的前提下实现协作计算和模型训练。系统集成联邦学习（FedAvg/FedProx）、安全多方计算（Shamir 秘密共享/Beaver 三元组）、差分隐私（Laplace/Gaussian 噪声注入）、同态加密（Paillier 加法同态/BFV 全同态）和 TEE 可信执行环境五大隐私计算技术。

ChainlessChain 隐私计算框架提供端到端的隐私保护能力，支持联邦学习、安全多方计算（Shamir/Beaver）、差分隐私（Laplace/Gaussian）、同态加密（Paillier/BFV）和可信执行环境（TEE）集成，在数据不出域的前提下实现协作计算和模型训练。

## 核心特性

- 🤖 **联邦学习**: 数据不出域的分布式模型训练，支持横向/纵向联邦，自动梯度聚合
- 🔐 **安全多方计算 (MPC)**: Shamir 秘密共享 + Beaver 三元组乘法协议，支持多方联合计算
- 📊 **差分隐私**: Laplace 机制（数值查询）+ Gaussian 机制（高维数据），可配置隐私预算 ε
- 🔒 **同态加密**: Paillier 加法同态 + BFV 全同态，支持密文上的计算操作
- 🛡️ **TEE 集成**: Intel SGX / ARM TrustZone 可信执行环境，硬件级隐私保护

## 系统架构

```
┌─────────────────────────────────────────────┐
│           隐私计算框架 (Privacy Framework)    │
└──────────────────┬──────────────────────────┘
                   │
    ┌──────────────▼──────────────┐
    │        隐私计算调度器        │
    └──┬──────┬──────┬──────┬────┘
       │      │      │      │
       ▼      ▼      ▼      ▼
  ┌──────┐┌──────┐┌──────┐┌──────┐
  │联邦   ││安全   ││差分   ││同态   │
  │学习   ││多方   ││隐私   ││加密   │
  │FedAvg ││Shamir││Laplace││Paillier│
  │FedProx││Beaver││Gaussian│BFV   │
  └──┬───┘└──┬───┘└──┬───┘└──┬───┘
     │       │       │       │
     ▼       ▼       ▼       ▼
  ┌──────────────────────────────┐
  │     TEE 可信执行环境          │
  │  (Intel SGX / ARM TrustZone) │
  └──────────────┬───────────────┘
                 │
  ┌──────────────▼───────────────┐
  │  privacy_computations 表      │
  │  privacy_models 表            │
  └──────────────────────────────┘
```

## 联邦学习训练

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "privacy:federated-train",
  {
    modelId: "sentiment-classifier",
    datasetRef: "local-dataset-001",
    federationType: "horizontal", // horizontal | vertical
    config: {
      rounds: 10,
      batchSize: 32,
      learningRate: 0.01,
      aggregation: "fedavg", // fedavg | fedprox | scaffold
      minParticipants: 3,
      differentialPrivacy: { enabled: true, epsilon: 1.0, delta: 1e-5 },
    },
  },
);
// {
//   success: true,
//   trainingId: "ft-20260310-001",
//   status: "training",
//   round: 1,
//   participants: 5,
//   estimatedCompletion: 1710100000000
// }
```

## 安全多方计算

```javascript
const result = await window.electron.ipcRenderer.invoke("privacy:mpc-compute", {
  protocol: "shamir", // shamir | beaver
  operation: "sum", // sum | average | comparison | max | min
  participants: [
    { did: "did:chainless:alice", shareIndex: 1 },
    { did: "did:chainless:bob", shareIndex: 2 },
    { did: "did:chainless:carol", shareIndex: 3 },
  ],
  threshold: 2,
  inputEncrypted: true,
  localValue: 42,
});
// { success: true, computationId: "mpc-001", result: 128.5, protocol: "shamir", participantCount: 3, verified: true }
```

## 差分隐私发布

```javascript
const result = await window.electron.ipcRenderer.invoke("privacy:dp-publish", {
  datasetId: "user-analytics",
  queries: [
    { type: "count", column: "age", condition: "age > 30" },
    { type: "average", column: "income" },
  ],
  mechanism: "laplace", // laplace | gaussian
  epsilon: 0.5,
  delta: 1e-6,
  sensitivity: 1.0,
});
// {
//   success: true,
//   results: [
//     { query: "count", trueValue: null, noisyValue: 1523, mechanism: "laplace", epsilon: 0.25 },
//     { query: "average", trueValue: null, noisyValue: 65230.7, mechanism: "laplace", epsilon: 0.25 }
//   ],
//   privacyBudgetRemaining: 4.5
// }
```

## 同态加密查询

```javascript
const result = await window.electron.ipcRenderer.invoke("privacy:he-query", {
  scheme: "paillier", // paillier | bfv
  operation: "sum", // sum | multiply | compare (BFV only)
  encryptedInputs: ["enc-data-001", "enc-data-002"],
  publicKeyId: "pk-org-001",
  returnEncrypted: false,
});
// { success: true, result: 2847.5, scheme: "paillier", operationsCount: 2, decrypted: true }
```

## 获取隐私报告

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "privacy:get-privacy-report",
  {
    timeRange: { start: 1709000000000, end: 1710000000000 },
    includeDetails: true,
  },
);
// {
//   success: true,
//   report: {
//     totalComputations: 47,
//     federatedTrainings: 3,
//     mpcOperations: 12,
//     dpQueries: 28,
//     heOperations: 4,
//     privacyBudgetUsed: 5.5,
//     privacyBudgetTotal: 10.0,
//     teeAttestations: 2
//   }
// }
```

## 配置隐私参数

```javascript
const result = await window.electron.ipcRenderer.invoke("privacy:configure", {
  globalEpsilon: 10.0,
  defaultMechanism: "laplace",
  federatedLearning: {
    defaultRounds: 10,
    aggregation: "fedavg",
    minParticipants: 3,
  },
  mpc: {
    defaultProtocol: "shamir",
    defaultThreshold: 2,
    timeout: 60000,
  },
  tee: {
    provider: "sgx", // sgx | trustzone
    attestationRequired: true,
  },
});
// { success: true, updated: true }
```

## 获取模型状态

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "privacy:get-model-status",
  {
    modelId: "sentiment-classifier",
  },
);
// {
//   success: true,
//   model: { id: "sentiment-classifier", status: "trained", accuracy: 0.92, rounds: 10, participants: 5 },
//   lastTrainingAt: 1710050000000
// }
```

## 导出联邦模型

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "privacy:export-model",
  {
    modelId: "sentiment-classifier",
    format: "onnx", // onnx | safetensors | pytorch
    encryptExport: true,
    recipientDid: "did:chainless:org-partner",
  },
);
// { success: true, exportPath: "/exports/sentiment-classifier.onnx.enc", checksum: "sha256:...", size: 15728640 }
```

## IPC 接口完整列表

### 隐私计算操作（8 个）

| 通道                         | 功能         | 说明                       |
| ---------------------------- | ------------ | -------------------------- |
| `privacy:federated-train`    | 联邦学习训练 | 数据不出域的分布式模型训练 |
| `privacy:mpc-compute`        | 安全多方计算 | Shamir/Beaver 协议联合计算 |
| `privacy:dp-publish`         | 差分隐私发布 | Laplace/Gaussian 噪声注入  |
| `privacy:he-query`           | 同态加密查询 | 密文上的计算操作           |
| `privacy:get-privacy-report` | 获取隐私报告 | 隐私预算使用和计算统计     |
| `privacy:configure`          | 配置隐私参数 | 全局隐私策略和参数配置     |
| `privacy:get-model-status`   | 获取模型状态 | 联邦学习模型训练状态查询   |
| `privacy:export-model`       | 导出模型     | 加密导出训练好的联邦模型   |

## 数据库 Schema

**2 张核心表**:

| 表名                   | 用途     | 关键字段                                       |
| ---------------------- | -------- | ---------------------------------------------- |
| `privacy_computations` | 计算记录 | id, type, protocol, participants, epsilon_used |
| `privacy_models`       | 联邦模型 | id, model_id, status, accuracy, rounds         |

### privacy_computations 表

```sql
CREATE TABLE IF NOT EXISTS privacy_computations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                 -- federated | mpc | dp | he
  protocol TEXT,                      -- shamir | beaver | laplace | gaussian | paillier | bfv
  operation TEXT,
  participants TEXT,                  -- JSON: participant list
  epsilon_used REAL DEFAULT 0,
  result_summary TEXT,
  status TEXT DEFAULT 'completed',    -- pending | running | completed | failed
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_privacy_comp_type ON privacy_computations(type);
CREATE INDEX IF NOT EXISTS idx_privacy_comp_status ON privacy_computations(status);
```

### privacy_models 表

```sql
CREATE TABLE IF NOT EXISTS privacy_models (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  status TEXT DEFAULT 'initializing', -- initializing | training | trained | exported | failed
  federation_type TEXT,               -- horizontal | vertical
  accuracy REAL,
  rounds INTEGER DEFAULT 0,
  participants_count INTEGER DEFAULT 0,
  aggregation TEXT DEFAULT 'fedavg',
  privacy_config TEXT,                -- JSON: DP config
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_privacy_model_id ON privacy_models(model_id);
CREATE INDEX IF NOT EXISTS idx_privacy_model_status ON privacy_models(status);
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "privacyComputing": {
    "enabled": true,
    "globalEpsilonBudget": 10.0,
    "defaultMechanism": "laplace",
    "federatedLearning": {
      "enabled": true,
      "defaultRounds": 10,
      "aggregation": "fedavg",
      "minParticipants": 3,
      "differentialPrivacy": {
        "enabled": true,
        "defaultEpsilon": 1.0,
        "defaultDelta": 1e-5
      }
    },
    "mpc": {
      "defaultProtocol": "shamir",
      "defaultThreshold": 2,
      "timeout": 60000
    },
    "homomorphicEncryption": {
      "defaultScheme": "paillier",
      "keySize": 2048
    },
    "tee": {
      "provider": "sgx",
      "attestationRequired": true,
      "enclaveTimeout": 30000
    }
  }
}
```

## 故障排除

| 问题               | 解决方案                                              |
| ------------------ | ----------------------------------------------------- |
| 联邦训练参与者不足 | 确保至少 minParticipants 个节点在线                   |
| MPC 计算超时       | 增大 timeout 配置或减少参与方数量                     |
| 隐私预算耗尽       | 重置预算周期或增大 globalEpsilonBudget                |
| 同态加密性能慢     | 优先使用 Paillier（加法），BFV 仅用于必须全同态的场景 |
| TEE 远程证明失败   | 检查 SGX 驱动版本和 BIOS 设置                         |

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/crypto/privacy-computing-manager.js` | 隐私计算核心引擎 |
| `src/main/crypto/privacy-computing-ipc.js` | IPC 处理器（8 个） |
| `src/main/crypto/federated-learning.js` | 联邦学习训练引擎 |
| `src/main/crypto/mpc-engine.js` | 安全多方计算（Shamir/Beaver） |
| `src/main/crypto/differential-privacy.js` | 差分隐私机制（Laplace/Gaussian） |
| `src/main/crypto/homomorphic-encryption.js` | 同态加密（Paillier/BFV） |
| `src/renderer/stores/privacyComputing.ts` | Pinia 隐私计算状态管理 |

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 联邦学习收敛慢 | 数据分布不均匀或学习率设置不当 | 启用 `federated-averaging` 加权策略，调整学习率 |
| MPC 通信超时 | 参与方网络延迟高或消息体过大 | 优化网络路由，启用消息压缩 `mpc compress-enable` |
| 差分隐私噪声过大影响结果 | epsilon 值过小隐私保护过强 | 适当增大 `epsilon` 值，平衡隐私与可用性 |
| 安全多方计算结果不一致 | 参与方掉线导致协议中断 | 启用容错模式 `mpc fault-tolerant`，增加冗余参与方 |
| 隐私预算耗尽 | 查询次数过多消耗完隐私预算 | 查看预算使用情况 `privacy budget-status`，申请重置 |

### 常见错误修复

**错误: `FL_CONVERGENCE_SLOW` 联邦学习收敛缓慢**

```bash
# 查看训练进度和损失曲线
chainlesschain privacy fl-status --task-id <id>

# 调整聚合策略
chainlesschain privacy fl-config --strategy weighted-avg --lr 0.01
```

**错误: `MPC_COMM_TIMEOUT` MPC 通信超时**

```bash
# 检查参与方连接状态
chainlesschain privacy mpc-peers --task-id <id>

# 启用消息压缩并增大超时
chainlesschain privacy mpc-config --compress true --timeout 120s
```

**错误: `DP_NOISE_EXCESSIVE` 差分隐私噪声过大**

```bash
# 查看当前隐私参数
chainlesschain privacy dp-params

# 调整 epsilon 值（需权衡隐私风险）
chainlesschain privacy dp-config --epsilon 1.0 --delta 1e-5
```

## 安全考虑

### 隐私预算管理
- **Epsilon 控制**: 差分隐私的隐私预算 ε 是有限资源，每次查询消耗一部分；`globalEpsilonBudget` 耗尽后系统拒绝新的 DP 查询，防止通过大量查询推断原始数据
- **预算分配策略**: 建议为高频查询分配较小的 ε 值，为关键业务查询预留较大预算，避免预算过早耗尽
- **预算重置周期**: 定期重置隐私预算时应评估历史查询的累积信息泄露风险，不建议频繁重置

### 联邦学习安全
- **梯度隐私**: 联邦学习中共享的模型梯度可能泄露训练数据信息，务必启用差分隐私噪声注入（`differentialPrivacy.enabled: true`）
- **模型投毒防护**: 验证参与方提交的梯度更新是否异常，恶意参与者可能通过投毒攻击降低全局模型质量
- **模型导出加密**: 导出联邦模型时使用 `encryptExport: true`，并指定接收方 DID 进行端到端加密

### 安全多方计算
- **参与方认证**: MPC 计算中所有参与方必须通过 DID 身份验证，防止未授权节点参与联合计算
- **秘密共享阈值**: Shamir 秘密共享的 `threshold` 应大于参与方总数的一半，防止少数合谋方恢复秘密
- **TEE 远程证明**: 启用 `attestationRequired` 确保 TEE 环境未被篡改，定期验证 SGX/TrustZone 的完整性

### 同态加密注意事项
- **密钥长度**: Paillier 密钥建议至少 2048 位，BFV 方案根据安全参数选择合适的多项式模数
- **计算深度限制**: BFV 全同态加密的计算深度有限，超出深度需要 bootstrapping，显著增加延迟

## 使用示例

### 联邦学习完整流程

```bash
# 1. 发起横向联邦训练（至少 3 个参与方在线）
# IPC: privacy:federated-train { modelId: "sentiment", federationType: "horizontal", config: { rounds: 10, aggregation: "fedavg", differentialPrivacy: { enabled: true, epsilon: 1.0 } } }

# 2. 查询训练状态
# IPC: privacy:get-model-status { modelId: "sentiment" }
# → status: "trained", accuracy: 0.92, rounds: 10

# 3. 导出训练完成的模型（加密传输给合作方）
# IPC: privacy:export-model { modelId: "sentiment", format: "onnx", encryptExport: true, recipientDid: "did:chainless:partner" }
```

### 安全多方计算示例

```bash
# 三方联合计算平均薪资（任何一方都不知道其他人的薪资）
# IPC: privacy:mpc-compute { protocol: "shamir", operation: "average", participants: [alice, bob, carol], threshold: 2, localValue: 15000 }
# → result: 18500 (三方平均值)
```

### 差分隐私查询

```bash
# 查询用户年龄分布（注入 Laplace 噪声保护个体隐私）
# IPC: privacy:dp-publish { datasetId: "analytics", queries: [{ type: "count", column: "age", condition: "age > 30" }], epsilon: 0.5 }
# → noisyValue: 1523, privacyBudgetRemaining: 4.5
```

## 故障深度排查

### 参与方连接失败

1. **DID 认证**: 确认所有参与方已通过 DID 身份验证，使用 `chainlesschain did list` 检查身份状态
2. **网络连通性**: MPC/联邦学习需要参与方之间 P2P 直连，检查防火墙和 NAT 穿透配置
3. **最小参与方**: 联邦训练要求 `minParticipants`（默认 3）个节点在线，不足时训练无法启动
4. **超时调整**: 网络延迟高时增大 `mpc.timeout`（默认 60 秒），避免计算中途超时断开

### 精度损失

| 现象 | 原因与解决方案 |
|------|--------------|
| 联邦模型精度低于集中训练 | 数据分布不均匀（non-IID），尝试切换到 `fedprox` 或 `scaffold` 聚合算法 |
| 差分隐私查询偏差大 | `epsilon` 值过小导致噪声过大，适当增大 ε（但会降低隐私保护强度） |
| 同态加密计算结果错误 | BFV 方案的计算深度有限，超出深度后结果不可靠；减少连续乘法次数或使用 Paillier 加法方案 |

## 相关文档

- [去中心化身份 2.0](/chainlesschain/did-v2)
- [DAO 治理 2.0](/chainlesschain/dao-governance-v2)
- [代理联邦网络](/chainlesschain/agent-federation)
