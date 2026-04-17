# 去中心化 Agent 网络

## 模块概述

**版本**: v4.0.0
**状态**: ✅ 已实现 | CLI Phase 24 ✅
**IPC处理器**: 20个
**最后更新**: 2026-04-17

基于 W3C DID 和可验证凭证的去中心化 Agent 网络。支持 Agent 身份管理、声誉系统、联邦注册中心、跨组织任务路由和凭证管理，实现多组织间的可信 Agent 协作。

### 核心特性

- **Agent DID**: W3C DID 格式 (`did:chainless:{uuid}`)，Ed25519 密钥
- **声誉系统**: 多维度评分 + 衰减机制
- **联邦注册**: Kademlia DHT (160 k-buckets, k=20) 分布式注册
- **跨组织路由**: 跨组织任务分配 + 能力匹配
- **凭证管理**: W3C VC + AES-256-CBC 加密 + HMAC-SHA256 证明
- **认证会话**: 挑战-响应认证 + 会话管理

---

## 1. 架构设计

### 1.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端 (Vue3)                                │
├──────────────────────────────────────────────────────────────────┤
│                     Agent 网络管理界面                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │
│  │ DID管理   │ │ 声誉面板  │ │ 注册中心  │ │ 跨组织任务         │   │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                              ↕ IPC (20个通道)
┌──────────────────────────────────────────────────────────────────┐
│                        主进程 (Electron)                          │
├──────────────────────────────────────────────────────────────────┤
│              decentralized-network-ipc.js (521行)                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  AgentDID (1,128行)              │  AgentReputation (639行) │  │
│  │  W3C DID 身份管理                │  多维声誉评分            │  │
│  │  Ed25519 密钥对                  │  衰减 + 加权聚合         │  │
│  │  DID Document 生成               │                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  FederatedAgentRegistry (1,090行) │ AgentAuthenticator(941) │  │
│  │  Kademlia DHT                    │  挑战-响应认证           │  │
│  │  160 k-buckets, k=20            │  会话管理 + 清理         │  │
│  │  Peer 同步                       │                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  AgentCredentialManager (978行)  │ CrossOrgTaskRouter(1,090)│  │
│  │  W3C VC 凭证                    │  跨组织任务路由           │  │
│  │  AES-256-CBC 加密               │  能力匹配 + 负载均衡     │  │
│  │  HMAC-SHA256 证明               │  任务追踪 + 超时         │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    SQLite Database (7 tables)               │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Agent 认证流程

```
Agent A → 请求认证
    ↓
AgentAuthenticator → 生成 challenge (随机字节)
    ↓
Agent A → 用私钥签名 challenge
    ↓
AgentAuthenticator → 验证签名 (Ed25519 公钥)
    ↓
创建 session → 返回 sessionToken
    ↓
后续请求携带 sessionToken → 验证会话有效性
```

### 1.3 Kademlia DHT 结构

```
┌─────────────────────────────────────┐
│     FederatedAgentRegistry          │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Kademlia Routing Table     │    │
│  │  160 k-buckets              │    │
│  │  每桶最多 k=20 个节点       │    │
│  │  XOR 距离度量               │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Peer 同步                  │    │
│  │  心跳检测 (60s 间隔)        │    │
│  │  超时清理 (300s)            │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### 1.4 核心组件

| 组件                   | 文件                           | 行数  | 说明              |
| ---------------------- | ------------------------------ | ----- | ----------------- |
| AgentDID               | `agent-did.js`                 | 1,128 | W3C DID 身份管理  |
| AgentReputation        | `agent-reputation.js`          | 639   | 多维声誉系统      |
| FederatedAgentRegistry | `federated-agent-registry.js`  | 1,090 | Kademlia DHT 注册 |
| AgentAuthenticator     | `agent-authenticator.js`       | 941   | 挑战-响应认证     |
| AgentCredentialManager | `agent-credential-manager.js`  | 978   | W3C VC 凭证管理   |
| CrossOrgTaskRouter     | `cross-org-task-router.js`     | 1,090 | 跨组织任务路由    |
| Network IPC            | `decentralized-network-ipc.js` | 521   | 20个IPC处理器     |

---

## 2. 核心模块

### 2.1 AgentDID

```javascript
class AgentDID extends EventEmitter {
  async initialize(database)

  // DID 管理
  async createDID(metadata?)                 // 创建 DID (did:chainless:{uuid})
  async resolveDID(did)                      // 解析 DID Document
  async updateDIDDocument(did, updates)      // 更新 DID Document
  async deactivateDID(did)                   // 停用 DID
  async listDIDs(options?)                   // 列出所有 DID

  // 密钥管理
  async getKeyPair(did)                      // 获取 Ed25519 密钥对
  async rotateKeys(did)                      // 轮换密钥
  async sign(did, data)                      // 使用私钥签名
  async verify(did, data, signature)         // 验证签名
}
```

**DID Document 格式**:

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:chainless:550e8400-e29b-41d4-a716-446655440000",
  "verificationMethod": [
    {
      "id": "did:chainless:...#key-1",
      "type": "Ed25519VerificationKey2020",
      "publicKeyMultibase": "z6Mk..."
    }
  ],
  "authentication": ["did:chainless:...#key-1"],
  "service": [
    {
      "id": "did:chainless:...#agent-service",
      "type": "AgentService",
      "serviceEndpoint": "..."
    }
  ]
}
```

### 2.2 AgentReputation

```javascript
class AgentReputation extends EventEmitter {
  async initialize(database)

  // 声誉操作
  async getReputation(agentDid)              // 获取声誉
  async updateReputation(agentDid, dimension, score, evidence?)
  async getReputationHistory(agentDid, limit?)
  async getTopAgents(dimension?, limit?)

  // 维度
  // reliability: 可靠性 (任务完成率)
  // quality: 质量 (输出质量评分)
  // speed: 速度 (响应时间)
  // cooperation: 合作性 (协作评价)
}
```

**声誉计算**:

```
总分 = Σ(dimension_score × dimension_weight) / Σ(weights)
衰减: score *= 0.95 (每周)
范围: 0.0 ~ 5.0
```

### 2.3 FederatedAgentRegistry

```javascript
class FederatedAgentRegistry extends EventEmitter {
  async initialize(database)

  // 注册/发现
  async register(agentInfo)                  // 注册 Agent
  async unregister(agentDid)                 // 注销 Agent
  async discover(query)                      // 发现 Agent (能力匹配)
  async getAgent(agentDid)                   // 获取 Agent 信息

  // DHT 操作
  async addPeer(peerInfo)                    // 添加 Peer 节点
  async removePeer(peerId)                   // 移除 Peer
  async syncWithPeer(peerId)                 // 同步数据

  // 心跳
  async heartbeat(agentDid)                  // 心跳更新
  _startCleanupTimer()                       // 启动清理定时器
}
```

### 2.4 AgentCredentialManager

```javascript
class AgentCredentialManager extends EventEmitter {
  async initialize(database)

  // 凭证管理
  async issueCredential(issuerDid, subjectDid, claims) // 签发凭证
  async verifyCredential(credential)                    // 验证凭证
  async revokeCredential(credentialId)                  // 撤销凭证
  async listCredentials(agentDid, options?)              // 列出凭证
  async getCredential(credentialId)                     // 获取凭证

  // 加密
  _encrypt(data, key)            // AES-256-CBC 加密
  _decrypt(data, key)            // AES-256-CBC 解密
  _createProof(data, key)        // HMAC-SHA256 证明
}
```

### 2.5 CrossOrgTaskRouter

```javascript
class CrossOrgTaskRouter extends EventEmitter {
  async initialize(database)

  // 任务路由
  async routeTask(task)                      // 路由任务到合适 Agent
  async getTaskStatus(taskId)                // 获取任务状态
  async cancelTask(taskId)                   // 取消任务
  async listTasks(orgId, options?)           // 列出任务

  // 能力匹配
  async findCapableAgents(requirements)      // 查找匹配 Agent
  async updateCapabilities(agentDid, capabilities) // 更新能力

  // 负载均衡
  _selectAgent(candidates)                   // 选择最优 Agent
  _checkLoad(agentDid)                       // 检查 Agent 负载
}
```

---

## 3. 数据模型

### 3.1 agent_dids

| 字段                  | 类型       | 说明                              |
| --------------------- | ---------- | --------------------------------- |
| did                   | TEXT PK    | DID 标识符 (did:chainless:{uuid}) |
| public_key            | TEXT       | Ed25519 公钥 (hex)                |
| private_key_encrypted | TEXT       | 加密的私钥 (AES-256-CBC)          |
| did_document          | TEXT(JSON) | DID Document                      |
| metadata              | TEXT(JSON) | 附加元数据                        |
| status                | TEXT       | 状态 (active/deactivated)         |
| created_at            | INTEGER    | 创建时间                          |
| updated_at            | INTEGER    | 更新时间                          |

### 3.2 agent_reputation

| 字段       | 类型    | 说明           |
| ---------- | ------- | -------------- |
| id         | TEXT PK | 记录ID         |
| agent_did  | TEXT    | Agent DID      |
| dimension  | TEXT    | 评分维度       |
| score      | REAL    | 评分 (0.0-5.0) |
| evidence   | TEXT    | 评分依据       |
| created_at | INTEGER | 创建时间       |

### 3.3 federated_agent_registry

| 字段           | 类型       | 说明                  |
| -------------- | ---------- | --------------------- |
| agent_did      | TEXT PK    | Agent DID             |
| org_id         | TEXT       | 组织ID                |
| capabilities   | TEXT(JSON) | 能力列表              |
| endpoint       | TEXT       | 服务端点              |
| status         | TEXT       | 状态 (online/offline) |
| last_heartbeat | INTEGER    | 最后心跳              |
| created_at     | INTEGER    | 创建时间              |

### 3.4 federated_registry_peers

| 字段       | 类型    | 说明          |
| ---------- | ------- | ------------- |
| peer_id    | TEXT PK | Peer 节点ID   |
| endpoint   | TEXT    | Peer 端点     |
| k_bucket   | INTEGER | 所属 k-bucket |
| last_seen  | INTEGER | 最后活跃      |
| created_at | INTEGER | 创建时间      |

### 3.5 agent_auth_sessions

| 字段       | 类型    | 说明                          |
| ---------- | ------- | ----------------------------- |
| session_id | TEXT PK | 会话ID                        |
| agent_did  | TEXT    | Agent DID                     |
| token      | TEXT    | 会话 Token                    |
| challenge  | TEXT    | 认证挑战                      |
| status     | TEXT    | 状态 (pending/active/expired) |
| expires_at | INTEGER | 过期时间                      |
| created_at | INTEGER | 创建时间                      |

### 3.6 agent_credentials

| 字段        | 类型       | 说明                  |
| ----------- | ---------- | --------------------- |
| id          | TEXT PK    | 凭证ID                |
| issuer_did  | TEXT       | 签发者 DID            |
| subject_did | TEXT       | 持有者 DID            |
| type        | TEXT       | 凭证类型              |
| claims      | TEXT(JSON) | 凭证声明              |
| proof       | TEXT       | HMAC-SHA256 证明      |
| status      | TEXT       | 状态 (active/revoked) |
| issued_at   | INTEGER    | 签发时间              |
| expires_at  | INTEGER    | 过期时间              |

### 3.7 federated_task_log

| 字段         | 类型       | 说明                                    |
| ------------ | ---------- | --------------------------------------- |
| task_id      | TEXT PK    | 任务ID                                  |
| source_org   | TEXT       | 发起组织                                |
| target_org   | TEXT       | 目标组织                                |
| agent_did    | TEXT       | 执行 Agent                              |
| task_type    | TEXT       | 任务类型                                |
| status       | TEXT       | 状态 (pending/running/completed/failed) |
| result       | TEXT(JSON) | 执行结果                                |
| created_at   | INTEGER    | 创建时间                                |
| completed_at | INTEGER    | 完成时间                                |

---

## 4. IPC接口 (20个)

### 4.1 DID管理 (4个)

| 通道                           | 说明             | 参数      |
| ------------------------------ | ---------------- | --------- |
| `agent-network:create-did`     | 创建Agent DID    | metadata? |
| `agent-network:resolve-did`    | 解析DID Document | did       |
| `agent-network:list-dids`      | 列出所有DID      | options?  |
| `agent-network:deactivate-did` | 停用DID          | did       |

### 4.2 联邦注册 (4个)

| 通道                       | 说明      | 参数      |
| -------------------------- | --------- | --------- |
| `agent-network:register`   | 注册Agent | agentInfo |
| `agent-network:unregister` | 注销Agent | agentDid  |
| `agent-network:discover`   | 发现Agent | query     |
| `agent-network:heartbeat`  | 心跳更新  | agentDid  |

### 4.3 凭证管理 (3个)

| 通道                              | 说明     | 参数                          |
| --------------------------------- | -------- | ----------------------------- |
| `agent-network:issue-credential`  | 签发凭证 | issuerDid, subjectDid, claims |
| `agent-network:verify-credential` | 验证凭证 | credential                    |
| `agent-network:list-credentials`  | 列出凭证 | agentDid, options?            |

### 4.4 跨组织路由 (4个)

| 通道                            | 说明     | 参数            |
| ------------------------------- | -------- | --------------- |
| `agent-network:route-task`      | 路由任务 | task            |
| `agent-network:get-task-status` | 任务状态 | taskId          |
| `agent-network:cancel-task`     | 取消任务 | taskId          |
| `agent-network:list-tasks`      | 列出任务 | orgId, options? |

### 4.5 声誉系统 (4个)

| 通道                                   | 说明     | 参数                       |
| -------------------------------------- | -------- | -------------------------- |
| `agent-network:get-reputation`         | 获取声誉 | agentDid                   |
| `agent-network:update-reputation`      | 更新声誉 | agentDid, dimension, score |
| `agent-network:get-top-agents`         | 排行榜   | dimension?, limit?         |
| `agent-network:get-reputation-history` | 声誉历史 | agentDid, limit?           |

### 4.6 配置 (1个)

| 通道                       | 说明         | 参数 |
| -------------------------- | ------------ | ---- |
| `agent-network:get-config` | 获取网络配置 | -    |

---

## 5. 事件

| 事件                 | 负载                           | 说明       |
| -------------------- | ------------------------------ | ---------- |
| `did:created`        | { did }                        | DID 创建   |
| `agent:registered`   | { agentDid, capabilities }     | Agent 注册 |
| `agent:offline`      | { agentDid }                   | Agent 离线 |
| `credential:issued`  | { credentialId, subjectDid }   | 凭证签发   |
| `credential:revoked` | { credentialId }               | 凭证撤销   |
| `task:routed`        | { taskId, agentDid }           | 任务路由   |
| `task:completed`     | { taskId, result }             | 任务完成   |
| `reputation:updated` | { agentDid, dimension, score } | 声誉更新   |

---

## 6. 文件结构

```
desktop-app-vue/src/main/ai-engine/cowork/
├── agent-did.js                     # W3C DID 身份管理 (1,128行)
├── agent-reputation.js              # 多维声誉系统 (639行)
├── federated-agent-registry.js      # Kademlia DHT 注册 (1,090行)
├── agent-authenticator.js           # 挑战-响应认证 (941行)
├── agent-credential-manager.js      # W3C VC 凭证管理 (978行)
├── cross-org-task-router.js         # 跨组织任务路由 (1,090行)
└── decentralized-network-ipc.js     # 20个IPC处理器 (521行)
```

---

## 7. 相关文档

- [多代理系统](13_多代理系统.md) (8种专业代理)
- [自治Agent Runner](19_自治Agent_Runner.md) (ReAct执行引擎)
- [去中心化社交模块](02_去中心化社交模块.md) (DID/P2P)
- [安全机制设计](../安全机制设计.md) (密钥管理)

---

**文档版本**: 1.0
**最后更新**: 2026-03-05
