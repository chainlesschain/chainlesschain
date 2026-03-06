# 去中心化 Agent 网络

> **版本: v1.1.0+ | W3C DID 身份 | Ed25519 认证 | VC 凭证 | 信誉评分 | 联邦 DHT 注册表 | 跨组织路由 (20 IPC)**

去中心化 Agent 网络为自治 Agent 提供完整的身份、认证、信誉和协作基础设施，支持跨组织的 Agent 发现、认证和任务路由。

## 系统概述

### 模块架构

```
去中心化 Agent 网络 (6 模块)
├─ AgentDID                    — W3C DID 身份管理
├─ AgentAuthenticator          — DID 挑战-响应认证
├─ AgentCredentialManager      — VC 凭证发行/验证
├─ AgentReputation             — 信誉评分系统
├─ FederatedAgentRegistry      — 联邦 DHT 注册表
└─ CrossOrgTaskRouter          — 跨组织任务路由
```

---

## Agent DID 身份

### DID 格式

```
did:chainless:{uuid}
│    │         │
│    │         └─ 唯一标识符 (UUID)
│    └────────── DID 方法名
└─────────────── DID 前缀
```

### 密钥管理

- **算法**: Ed25519（椭圆曲线签名）
- **密钥对**: 每个 Agent 拥有独立的公钥/私钥
- **能力声明**: DID 文档中声明 Agent 的能力（技能列表）

### DID 生命周期

```
创建 → active ←→ suspended → revoked
```

| 状态        | 说明                                  |
| ----------- | ------------------------------------- |
| `active`    | 正常活跃状态                          |
| `suspended` | 临时挂起（连续认证失败 5 次自动触发） |
| `revoked`   | 永久吊销，不可恢复                    |

### 配置

```json
{
  "agentDID": {
    "keyAlgorithm": "ed25519",
    "challengeExpiryMs": 300000,
    "maxDIDsPerOrganization": 1000,
    "autoSuspendOnFailedAuth": 5
  }
}
```

---

## Agent 认证

### 认证方式

| 方式               | 说明                  | 安全级别 |
| ------------------ | --------------------- | -------- |
| `did-challenge`    | DID 挑战-响应（默认） | 高       |
| `credential-proof` | VC 凭证证明           | 高       |
| `mutual-tls`       | 双向 TLS              | 最高     |

### 挑战-响应流程

```
Agent A                              Agent B
  │                                     │
  ├── 请求认证 ──────────────────────→  │
  │                                     ├── 生成随机挑战
  │  ←────── 返回挑战 ──────────────── ├
  ├── 用私钥签名挑战                     │
  ├── 发送签名 ──────────────────────→  │
  │                                     ├── 用 A 的公钥验证签名
  │  ←────── 认证成功 / 会话 Token ──── ├
  │                                     │
```

### 会话管理

- 会话 TTL: 1 小时（可配置）
- 定期清理过期会话和挑战
- 会话持久化到 `agent_auth_sessions` 表

---

## VC 凭证系统

### 凭证类型

| 类型         | 说明                                |
| ------------ | ----------------------------------- |
| `CAPABILITY` | 能力凭证（声明 Agent 具有某项技能） |
| `DELEGATION` | 委托凭证（授权 Agent 代理执行）     |
| `MEMBERSHIP` | 成员凭证（证明属于某个组织）        |

### 凭证结构

```json
{
  "id": "cred-uuid",
  "issuer": "did:chainless:issuer-uuid",
  "subject": "did:chainless:subject-uuid",
  "type": "CAPABILITY",
  "claims": {
    "skill": "code-review",
    "level": "expert"
  },
  "issuedAt": "2026-01-15T10:00:00Z",
  "expiresAt": "2027-01-15T10:00:00Z",
  "proof": "ed25519-signature..."
}
```

### 凭证生命周期

```
颁发 → VALID → EXPIRED (自动过期)
              → REVOKED (主动吊销)
```

- 每个 Agent 最多持有 100 个凭证
- 支持凭证链验证（A 颁发给 B，B 委托给 C）
- 吊销注册表实现即时失效

---

## 信誉评分

### 评分维度

```
总分 = 成功率 × 0.4 + 响应时间 × 0.2 + 质量 × 0.3 + 活跃度 × 0.1
```

| 维度     | 权重 | 说明             |
| -------- | ---- | ---------------- |
| 成功率   | 40%  | 任务完成成功比例 |
| 响应时间 | 20%  | 平均响应速度     |
| 质量     | 30%  | 任务输出质量评分 |
| 活跃度   | 10%  | 近期活跃程度     |

### 信誉等级

| 等级      | 分数范围 | 说明     |
| --------- | -------- | -------- |
| TRUSTED   | >= 0.8   | 高度信任 |
| RELIABLE  | >= 0.6   | 可靠     |
| NEUTRAL   | >= 0.3   | 中立     |
| UNTRUSTED | < 0.3    | 不信任   |

### 时间衰减

- 衰减因子: 0.98 / 24小时
- 长期不活跃的 Agent 信誉自动降低
- 每个 Agent 保留最近 200 条历史记录

---

## 联邦 DHT 注册表

### Kademlia 风格 DHT

```
注册表架构:
├─ 本地注册表 (单机发现)
├─ 联邦查询 (向 Peer 节点查询)
└─ 广播发现 (全网广播)

路由表:
  160-bit 空间, 20 个 K-bucket
  每个 bucket 最多容纳 20 个节点
```

### Agent 注册

```json
{
  "did": "did:chainless:agent-uuid",
  "capabilities": ["code-review", "unit-test", "deploy"],
  "organization": "org-uuid",
  "status": "ONLINE",
  "lastHeartbeat": "2026-01-15T10:00:00Z"
}
```

### 发现模式

| 模式        | 说明           | 延迟 |
| ----------- | -------------- | ---- |
| `local`     | 仅本地注册表   | 低   |
| `federated` | 向邻居节点查询 | 中   |
| `broadcast` | 全网广播       | 高   |

### 心跳机制

- Agent 定期发送心跳（建议每 2 分钟）
- 10 分钟无心跳 → 标记为 OFFLINE
- 支持按能力索引快速反向查询

---

## 跨组织任务路由

### 路由策略

| 策略               | 说明                 |
| ------------------ | -------------------- |
| `nearest`          | 选择延迟最低的 Agent |
| `best-reputation`  | 选择信誉最高的 Agent |
| `round-robin`      | 轮询分配             |
| `capability-match` | 能力最匹配的 Agent   |

### 路由流程

```
1. 任务创建 → pending
2. 从联邦注册表发现候选 Agent → routing
3. 按策略筛选和排序
4. 验证候选 Agent 的凭证
5. 分配给最优 Agent → executing
6. Agent 执行任务
7. 返回结��� → completed / failed
```

### 任务配置

```json
{
  "maxConcurrentTasks": 50,
  "routingStrategy": "best-reputation",
  "taskTimeoutMs": 300000,
  "minReputationScore": 0.3
}
```

---

## 数据库表

| 表名                  | 说明                                  |
| --------------------- | ------------------------------------- |
| `agent_dids`          | Agent DID 身份（���私钥、能力、状态） |
| `agent_auth_sessions` | 认证会话                              |
| `agent_credentials`   | VC 凭证（颁发者/持有者/声明/证明）    |
| `agent_reputation`    | 信誉评分及历史                        |

---

## 关键文件

| 文件                                                    | 职责                            |
| ------------------------------------------------------- | ------------------------------- |
| `src/main/ai-engine/cowork/agent-did.js`                | Agent DID 身份管理              |
| `src/main/ai-engine/cowork/agent-authenticator.js`      | DID 认证器                      |
| `src/main/ai-engine/cowork/agent-credential-manager.js` | VC 凭证管理                     |
| `src/main/ai-engine/cowork/agent-reputation.js`         | 信誉评分系统                    |
| `src/main/ai-engine/cowork/federated-agent-registry.js` | 联邦 DHT 注册表                 |
| `src/main/ai-engine/cowork/cross-org-task-router.js`    | 跨组织任务路由                  |
| `src/main/ai-engine/cowork/evolution-ipc.js`            | IPC 处理器（含 Agent 网络相关） |
