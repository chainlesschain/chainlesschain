# 去中心化 Agent 网络

> **版本: v1.1.0+ | W3C DID 身份 | Ed25519 认证 | VC 凭证 | 信誉评分 | 联邦 DHT 注册表 | 跨组织路由 (20 IPC)**

去中心化 Agent 网络为自治 Agent 提供完整的身份、认证、信誉和协作基础设施，支持跨组织的 Agent 发现、认证和任务路由。

## 概述

去中心化 Agent 网络是 ChainlessChain 的 Agent 身份与协作底层，包含 W3C DID 身份、挑战-响应认证、可验证凭证（VC）、四维信誉评分、Kademlia DHT 联邦注册表和跨组织任务路由六大模块。系统通过 20 个 IPC 接口对外暴露能力，支持本地/联邦/广播三种 Agent 发现模式和四种路由策略。

## 核心特性

- 🪪 **W3C DID 身份**: Ed25519 密钥对，`did:chainless:{uuid}` 格式标识
- 🔐 **挑战-响应认证**: DID 私钥签名验证，支持会话管理与自动挂起
- 📜 **VC 凭证系统**: CAPABILITY / DELEGATION / MEMBERSHIP 三类凭证
- ⭐ **信誉评分**: 成功率/响应时间/质量/活跃度四维加权评估
- 🌐 **Kademlia DHT**: 160-bit 地址空间，支持本地/联邦/广播三种发现模式
- 🔀 **跨组织路由**: nearest / best-reputation / round-robin / capability-match 四种策略

## 系统架构

```
┌──────────────────────────────────────────────────┐
│            去中心化 Agent 网络 (6 模块)             │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ AgentDID │  │ Authenticator│  │ Credential │  │
│  │ (身份)   │  │ (认证器)      │  │ Manager    │  │
│  └────┬─────┘  └──────┬───────┘  └─────┬──────┘  │
│       │                │                │          │
│  ┌────▼────────────────▼────────────────▼──────┐  │
│  │       Federated Agent Registry (DHT)        │  │
│  │       本地注册表 | 联邦查询 | 广播发现        │  │
│  └─────────────────────┬──────────────────────┘  │
│                        │                          │
│  ┌──────────┐  ┌───────▼──────┐  ┌────────────┐  │
│  │Reputation│  │ CrossOrg     │  │ SQLite     │  │
│  │ System   │←→│ TaskRouter   │  │ (4 tables) │  │
│  └──────────┘  └──────────────┘  └────────────┘  │
└──────────────────────────────────────────────────┘
```

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
7. 返回结果 → completed / failed
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

| 表名                  | 说明                                 |
| --------------------- | ------------------------------------ |
| `agent_dids`          | Agent DID 身份（公私钥、能力、状态） |
| `agent_auth_sessions` | 认证会话                             |
| `agent_credentials`   | VC 凭证（颁发者/持有者/声明/证明）   |
| `agent_reputation`    | 信誉评分及历史                       |

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

## 使用示例

### 创建 Agent 身份并加入网络

1. 打开「去中心化 Agent 网络」页面
2. 点击「创建 DID」，系统自动生成 Ed25519 密钥对
3. 填写 Agent 能力声明（如 code-review、unit-test）
4. 点击「注册到联邦网络」，Agent 信息广播到 DHT

### 发起跨组织任务

1. 在「Agent 发现」面板中按能力搜索目标 Agent
2. 查看候选 Agent 的信誉评分和在线状态
3. 选择路由策略（推荐 `best-reputation`）并提交任务
4. 在「任务追踪」面板查看执行进度和结果

### 颁发能力凭证

1. 切换到「VC 凭证」标签页
2. 选择凭证类型（CAPABILITY / DELEGATION / MEMBERSHIP）
3. 填写持有者 DID 和能力声明
4. 确认颁发，凭证自动签名并存储

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| DID 创建失败 | Ed25519 密钥生成环境异常 | 检查 Node.js crypto 模块可用性，重启应用重试 |
| Agent 注册后无法被发现 | DHT 路由表未同步 | 等待 2-3 分钟心跳周期，确认网络连接正常 |
| 认证挑战超时 | 挑战有效期过短或网络延迟高 | 调大 `challengeExpiryMs` 配置（默认 300000ms） |
| 凭证验证失败 | 颁发者 DID 已被吊销或凭证过期 | 检查颁发者 DID 状态和凭证 `expiresAt` 字段 |
| 信誉评分异常偏低 | 时间衰减因子导致长期不活跃降分 | 增加任务执行频率，检查近期失败任务原因 |
| 跨组织路由找不到 Agent | 目标组织节点离线或能力不匹配 | 确认目标 Agent 在线状态，放宽 `minReputationScore` |
| 心跳超时被标记离线 | 网络抖动或进程被系统挂起 | 检查网络稳定性，确认后台进程未被休眠 |

## 配置参考

各模块完整配置项说明：

### Agent DID 配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `agentDID.keyAlgorithm` | string | `"ed25519"` | 密钥算法（目前仅支持 ed25519） |
| `agentDID.challengeExpiryMs` | number | `300000` | 认证挑战有效期（ms） |
| `agentDID.maxDIDsPerOrganization` | number | `1000` | 每个组织最多创建的 DID 数量 |
| `agentDID.autoSuspendOnFailedAuth` | number | `5` | 连续认证失败多少次后自动挂起 DID |

### 联邦 DHT 配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `federatedRegistry.heartbeatIntervalMs` | number | `120000` | Agent 心跳发送间隔（ms） |
| `federatedRegistry.offlineThresholdMs` | number | `600000` | 无心跳超过此时间标记为 OFFLINE |
| `federatedRegistry.kBucketSize` | number | `20` | DHT K-bucket 每桶最大节点数 |
| `federatedRegistry.discoveryMode` | string | `"federated"` | 默认发现模式（local/federated/broadcast） |

### 信誉系统配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `reputation.decayFactor` | number | `0.98` | 每 24 小时信誉衰减系数 |
| `reputation.maxHistoryRecords` | number | `200` | 每个 Agent 保留的最大历史条数 |
| `reputation.minReputationScore` | number | `0.3` | 跨组织路由的最低信誉准入分 |

### 跨组织路由配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `crossOrg.maxConcurrentTasks` | number | `50` | 系统级最大并发跨组织任务数 |
| `crossOrg.routingStrategy` | string | `"best-reputation"` | 默认路由策略 |
| `crossOrg.taskTimeoutMs` | number | `300000` | 任务执行超时时间（ms） |

### 完整配置示例

```json
{
  "agentDID": {
    "keyAlgorithm": "ed25519",
    "challengeExpiryMs": 300000,
    "maxDIDsPerOrganization": 1000,
    "autoSuspendOnFailedAuth": 5
  },
  "federatedRegistry": {
    "heartbeatIntervalMs": 120000,
    "offlineThresholdMs": 600000,
    "discoveryMode": "federated"
  },
  "reputation": {
    "decayFactor": 0.98,
    "maxHistoryRecords": 200,
    "minReputationScore": 0.3
  },
  "crossOrg": {
    "maxConcurrentTasks": 50,
    "routingStrategy": "best-reputation",
    "taskTimeoutMs": 300000
  }
}
```

## 性能指标

### 基准测试数据（v1.1.0，单节点，16 GB RAM）

| 操作 | P50 延迟 | P99 延迟 | 吞吐量 |
| --- | --- | --- | --- |
| DID 创建（Ed25519 密钥对生成） | 10 ms | 40 ms | 100 ops/s |
| DID 解析（本地 SQLite 查询） | < 1 ms | 5 ms | 8000 ops/s |
| 认证挑战生成 | 2 ms | 8 ms | 3000 ops/s |
| 挑战-响应验证（Ed25519 验签） | 4 ms | 15 ms | 1500 ops/s |
| VC 凭证颁发（含签名） | 6 ms | 25 ms | 150 ops/s |
| VC 凭证链式验证（3 层委托） | 15 ms | 60 ms | 200 ops/s |
| Agent 本地注册表查询 | 1 ms | 5 ms | 5000 ops/s |
| 联邦 DHT 发现（10 跳以内） | 60 ms | 280 ms | 250 ops/s |
| 信誉评分更新 | 5 ms | 20 ms | 600 ops/s |
| 跨组织任务路由（含凭证验证） | 40 ms | 180 ms | 120 ops/s |

### 容量规划

| 指标 | 单节点上限 | 集群推荐上限 |
| --- | --- | --- |
| 在线 Agent 数 | 10,000 | 100,000 |
| 每秒认证请求 | 1,500 | 15,000 |
| 并发跨组织任务 | 50 | 500 |
| DHT 路由表节点 | 20 × 160 = 3,200 | 按分片扩展 |
| VC 凭证总量（含过期） | 100,000 | 无限制（按需分库） |

### SQLite 表容量参考

- `agent_dids`: 1 万条记录 < 10 MB
- `agent_auth_sessions`: 活跃会话通常 < 1000 条，自动清理过期会话
- `agent_credentials`: 每 Agent 上限 100 条，10 万 Agent 约 80 MB
- `agent_reputation`: 每 Agent 保留 200 条历史，10 万 Agent 约 400 MB

## 测试覆盖率

### 测试文件

| 文件 | 测试数 | 覆盖模块 |
| --- | --- | --- |
| `tests/unit/ai-engine/agent-did.test.js` | 30 | DID 创建/解析/撤销、状态机（active→suspended→revoked） |
| `tests/unit/ai-engine/agent-authenticator.test.js` | 25 | 挑战生成、Ed25519 验签、会话管理、自动挂起 |
| `tests/unit/ai-engine/agent-credential-manager.test.js` | 24 | CAPABILITY/DELEGATION/MEMBERSHIP 凭证、链式委托、吊销 |
| `tests/unit/ai-engine/agent-reputation.test.js` | 22 | 四维评分公式、时间衰减、等级阈值、排行榜 |
| `tests/unit/ai-engine/federated-agent-registry.test.js` | 32 | 本地/联邦/广播三种发现模式、DHT K-bucket、心跳超时 |
| `tests/unit/ai-engine/cross-org-task-router.test.js` | 28 | 四种路由策略、任务状态机、超时、SLA 执行 |
| `tests/integration/agent-network-e2e.test.js` | 18 | 完整注册→认证→委派→执行→信誉更新端到端流程 |

**合计**: 179 个测试用例，行覆盖率 ≥ 89%

### 运行测试

```bash
# 全量 Agent 网络单元测试（建议分批避免 OOM）
cd desktop-app-vue && npx vitest run tests/unit/ai-engine/agent-did tests/unit/ai-engine/agent-authenticator tests/unit/ai-engine/agent-credential-manager

cd desktop-app-vue && npx vitest run tests/unit/ai-engine/agent-reputation tests/unit/ai-engine/federated-agent-registry tests/unit/ai-engine/cross-org-task-router

# 集成端到端测试
cd desktop-app-vue && npx vitest run tests/integration/agent-network-e2e

# 快速冒烟（DID + 认证核心路径）
cd desktop-app-vue && npx vitest run tests/unit/ai-engine/agent-did tests/unit/ai-engine/agent-authenticator
```

## 安全考虑

- **密钥保护**: Agent 私钥仅存储在本地 SQLite（SQLCipher 加密），不通过网络传输
- **挑战-响应防重放**: 每次认证生成唯一随机挑战，签名包含时间戳防止重放攻击
- **凭证链验证**: 支持多层委托验证（A→B→C），吊销注册表实现即时失效
- **信誉防刷**: 信誉评分基于实际任务完成质量，单次任务权重有上限防止刷分
- **DID 自动挂起**: 连续认证失败 5 次自动挂起 DID，防止暴力破解
- **DHT 隔离**: 每个组织维护独立的本地注册表，联邦查询需经过认证
- **任务路由鉴权**: 跨组织任务分配前验证候选 Agent 的 VC 凭证有效性
- **数据最小化**: DHT 中仅存储 Agent 公钥和能力声明，不包含敏感业务数据

## 相关文档

- [代理联邦网络](/chainlesschain/agent-federation)
- [A2A 协议引擎](/chainlesschain/a2a-protocol)
- [Agent 经济系统](/chainlesschain/agent-economy)
- [Cowork 多智能体协作](/chainlesschain/cowork)
