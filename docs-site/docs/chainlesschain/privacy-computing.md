# 隐私计算框架

> **版本: v4.2.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 2 数据库表 | Phase 91**

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

## 相关文档

- [去中心化身份 2.0](/chainlesschain/did-v2)
- [DAO 治理 2.0](/chainlesschain/dao-governance-v2)
- [代理联邦网络](/chainlesschain/agent-federation)
