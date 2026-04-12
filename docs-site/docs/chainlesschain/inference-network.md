# Inference Network 去中心化推理网络

> **版本: v3.1.0 | 状态: ✅ 生产就绪 | 6 IPC Handlers | 2 数据库表 | 分布式 AI 计算**

ChainlessChain Inference Network 是一个去中心化的推理网络，实现分布式 AI 计算的节点注册、任务调度和隐私保护。它支持 GPU/CPU 节点基准测试、延迟/成本/算力感知调度、TEE 隐私模式以及联邦学习，为多设备协同推理提供基础设施。

## 概述

去中心化推理网络为 ChainlessChain 提供分布式 AI 计算基础设施，支持 GPU/CPU 节点注册与自动基准测试、延迟/成本/算力三维感知的智能任务调度、TEE 可信执行环境隐私保护以及多节点联邦学习。系统通过 6 个 IPC 接口和 2 张数据表管理推理任务的完整生命周期。

## 核心特性

- 🖥️ **节点注册与基准**: GPU/CPU 节点注册，自动硬件基准测试和能力评估
- ⚡ **智能任务调度**: 延迟/成本/算力三维感知调度，最优节点匹配
- 🔒 **TEE 隐私模式**: 可信执行环境保护推理数据，防止模型和数据泄露
- 🧠 **联邦学习支持**: 分布式模型训练，梯度聚合与模型更新
- 📊 **网络统计**: 节点状态监控、负载均衡、全网算力统计
- 🔄 **任务生命周期**: 提交 → 调度 → 执行 → 完成，全程状态追踪

## 注册计算节点

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "inference:register-node",
  {
    nodeId: "node-gpu-01",
    capabilities: {
      gpu: "NVIDIA RTX 4090",
      vram: 24576, // MB
      cpu: "AMD Ryzen 9",
      ram: 65536, // MB
    },
    supportedModels: ["llama-3", "qwen-2", "mistral"],
    maxConcurrent: 3,
    pricePerToken: 0.001, // CCT/token
  },
);
```

## 提交推理任务

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "inference:submit-task",
  {
    model: "llama-3-70b",
    input: { prompt: "分析这段代码的性能瓶颈..." },
    requirements: {
      maxLatencyMs: 5000,
      privacyMode: "tee", // none | tee | federated
      maxCostCCT: 10,
    },
  },
);
// result.task = { id, status: "scheduled", assignedNode: "node-gpu-01", ... }
```

## 启动联邦学习

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "inference:start-federated-round",
  {
    modelId: "custom-classifier",
    participantNodes: ["node-01", "node-02", "node-03"],
    aggregationStrategy: "fedavg", // fedavg | fedprox | scaffold
    rounds: 10,
  },
);
```

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              Inference Network                    │
│                                                   │
│  ┌──────────────┐    ┌─────────────────────────┐ │
│  │ Node Registry │    │   Inference Scheduler    │ │
│  │              │    │                          │ │
│  │ GPU/CPU 注册  │    │ 延迟/成本/算力调度       │ │
│  │ 基准测试      │    │ TEE 隐私模式             │ │
│  │ 能力评估      │    │ 联邦学习编排             │ │
│  └──────┬───────┘    └──────────┬───────────────┘ │
│         │                       │                  │
│  ┌──────┴───────────────────────┴───────────────┐ │
│  │              IPC Layer (6 handlers)            │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## IPC 接口完整列表

### Inference 操作（6 个）

| 通道                              | 功能         | 说明                         |
| --------------------------------- | ------------ | ---------------------------- |
| `inference:register-node`         | 注册计算节点 | GPU/CPU 信息、支持模型、定价 |
| `inference:list-nodes`            | 列出网络节点 | 含状态、负载、能力信息       |
| `inference:submit-task`           | 提交推理任务 | 智能调度到最优节点           |
| `inference:get-task-status`       | 查询任务状态 | 进度、结果、耗时             |
| `inference:start-federated-round` | 启动联邦学习 | 多节点协同训练               |
| `inference:get-network-stats`     | 获取网络统计 | 节点数、总算力、任务统计     |

## 数据库 Schema

**2 张核心表**:

| 表名              | 用途       | 关键字段                                                  |
| ----------------- | ---------- | --------------------------------------------------------- |
| `inference_nodes` | 节点注册表 | id, capabilities (JSON), status, supported_models, price  |
| `inference_tasks` | 任务追踪   | id, model, status, assigned_node, input, output, duration |

### inference_nodes 表

```sql
CREATE TABLE IF NOT EXISTS inference_nodes (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  capabilities TEXT,              -- JSON: GPU/CPU/RAM 信息
  supported_models TEXT,          -- JSON: 支持的模型列表
  status TEXT DEFAULT 'offline',  -- online | offline | busy
  max_concurrent INTEGER DEFAULT 1,
  current_load INTEGER DEFAULT 0,
  price_per_token REAL DEFAULT 0.001,
  benchmark_score REAL DEFAULT 0.0,
  last_heartbeat INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_inference_nodes_status ON inference_nodes(status);
```

### inference_tasks 表

```sql
CREATE TABLE IF NOT EXISTS inference_tasks (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  input TEXT,                      -- JSON
  output TEXT,                     -- JSON
  assigned_node TEXT,
  status TEXT DEFAULT 'pending',   -- pending | scheduled | running | completed | failed
  privacy_mode TEXT DEFAULT 'none',
  duration_ms INTEGER,
  tokens_used INTEGER,
  cost_cct REAL,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_inference_tasks_status ON inference_tasks(status);
```

## 前端集成

### InferenceNetworkPage 页面

**功能模块**:

- **统计卡片**: 在线节点数 / 运行中任务 / 总算力
- **节点列表**: 展示节点状态、GPU 信息、负载、价格
- **任务提交表单**: 选择模型、输入 prompt、设置隐私模式
- **联邦学习面板**: 启动联邦训练轮次

### Pinia Store (inferenceNetwork.ts)

```typescript
const useInferenceNetworkStore = defineStore("inferenceNetwork", {
  state: () => ({
    nodes: [],
    tasks: [],
    networkStats: null,
    loading: false,
    error: null,
  }),
  actions: {
    fetchNodes, // → inference:list-nodes
    registerNode, // → inference:register-node
    submitTask, // → inference:submit-task
    fetchTaskStatus, // → inference:get-task-status
    startFederatedRound, // → inference:start-federated-round
    fetchNetworkStats, // → inference:get-network-stats
  },
});
```

## 关键文件

| 文件                                                      | 职责               | 行数 |
| --------------------------------------------------------- | ------------------ | ---- |
| `src/main/ai-engine/inference/inference-node-registry.js` | 节点注册与基准测试 | ~240 |
| `src/main/ai-engine/inference/inference-scheduler.js`     | 智能任务调度器     | ~280 |
| `src/main/ai-engine/inference/inference-ipc.js`           | IPC 处理器（6 个） | ~150 |
| `src/renderer/stores/inferenceNetwork.ts`                 | Pinia 状态管理     | ~120 |
| `src/renderer/pages/ai/InferenceNetworkPage.vue`          | 推理网络页面       | ~100 |

## 测试覆盖率

```
✅ inference-node-registry.test.js    - 节点注册/基准/心跳测试
✅ inference-scheduler.test.js        - 调度算法/TEE/联邦学习测试
✅ stores/inferenceNetwork.test.ts    - Store 状态管理测试
✅ e2e/ai/inference-network.e2e.test.ts - 端到端用户流程测试
```

## 使用示例

### 注册计算节点

1. 打开「推理网络」页面，点击「注册节点」
2. 填写节点 ID、GPU/CPU 信息和支持的模型列表
3. 设置最大并发任务数和每 Token 价格（CCT）
4. 系统自动运行硬件基准测试并评估节点能力
5. 注册成功后节点进入 online 状态

### 提交推理任务

1. 在「任务提交」表单中选择目标模型（如 llama-3-70b）
2. 输入推理 prompt，设置最大延迟和成本限制
3. 选择隐私模式（none / tee / federated）
4. 提交后系统智能调度到最优节点
5. 在「任务列表」中查看执行进度和结果

### 启动联邦学习

1. 切换到「联邦学习」面板
2. 选择训练模型和参与节点
3. 配置聚合策略（fedavg / fedprox / scaffold）
4. 设置训练轮次，点击启动
5. 实时查看各轮梯度聚合和模型更新进度

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 节点注册失败 | 节点 ID 已存在或参数不完整 | 使用唯一节点 ID，确认所有必填字段已提供 |
| 任务调度无可用节点 | 所有节点离线或负载已满 | 检查节点列表状态，等待节点空闲或注册新节点 |
| 推理结果为空 | 目标模型未在节点上安装 | 确认 `supportedModels` 列表包含所需模型 |
| TEE 模式不可用 | 节点硬件不支持可信执行环境 | 切换到普通模式，或选择支持 TEE 的节点 |
| 联邦学习收敛缓慢 | 参与节点数据分布差异大 | 尝试 fedprox 策略替代 fedavg |
| 任务成本超出预算 | 节点定价过高 | 调整 `maxCostCCT` 或选择更低价格的节点 |

## 安全考虑

- **TEE 隐私保护**: 可信执行环境确保推理数据在加密飞地中处理，节点无法窥探
- **联邦学习隐私**: 仅传输模型梯度，不暴露原始训练数据
- **节点身份认证**: 注册节点需 DID 身份验证，防止恶意节点加入
- **任务数据加密**: 推理输入和输出在传输过程中端到端加密
- **计费透明**: 每个任务的 Token 使用量和费用明细完整记录
- **负载保护**: 节点并发限制防止资源耗尽和拒绝服务
- **基准测试验证**: 节点能力通过实际基准测试验证，防止虚报硬件信息

## 相关文档

- [Skill Marketplace 技能市场 →](/chainlesschain/skill-marketplace)
- [Token Incentive 代币激励 →](/chainlesschain/token-incentive)
- [Cowork 多智能体协作 →](/chainlesschain/cowork)
