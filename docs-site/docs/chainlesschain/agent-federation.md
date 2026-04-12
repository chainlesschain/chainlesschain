# 代理联邦网络

> v1.1.0 新功能

## 概述

代理联邦网络是 ChainlessChain 的去中心化 Agent 协作基础设施，提供 DID 身份管理、联邦发现、可验证凭证和跨组织任务路由能力。它使不同组织的 AI Agent 能够通过去中心化身份互相认证、按技能发现协作伙伴，并在 SLA 保障下完成跨组织的智能任务分配。

## 核心特性

- 🪪 **DID 身份管理**: 去中心化 Agent 身份创建、解析与撤销
- 🔍 **联邦发现**: 自动注册到网络，按技能发现可用 Agent
- 📜 **可验证凭证**: 颁发、验证、撤销 Agent 能力与委托凭证
- 🌐 **跨组织路由**: 跨组织边界的智能任务分配与 SLA 保障
- ⭐ **信誉评估**: 基于任务完成质量的去中心化信誉评分系统
- 🛡️ **安全认证**: DID 挑战-响应双向认证，会话 Token 管理

## 系统架构

```
┌──────────────────────────────────────────────┐
│              代理联邦网络                       │
├──────────────────────────────────────────────┤
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Agent    │  │ Federated│  │ Credential │  │
│  │ DID      │  │ Registry │  │ Manager    │  │
│  │ (身份)   │  │ (注册表)  │  │ (凭证)    │  │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       │              │              │          │
│  ┌────▼──────────────▼──────────────▼──────┐  │
│  │        Cross-Org Task Router            │  │
│  │        (跨组织任务路由)                   │  │
│  └─────────────────┬──────────────────────┘  │
│                    │                          │
│  ┌─────────────────▼──────────────────────┐  │
│  │         Reputation System              │  │
│  │         (信誉评分与排行)                 │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

## 系统概述

代理联邦网络（Agent Federation）实现去中心化的 AI 代理协作，支持 DID 身份管理、代理发现、跨组织任务路由和信誉评估，构建可信的分布式 AI 代理网络。

### 核心能力

- **Agent DID**：去中心化身份标识，支持创建、解析、撤销
- **联邦注册与发现**：代理自动注册到联邦网络，按技能发现代理
- **可验证凭证**：颁发、验证、撤销代理能力凭证
- **跨组织任务路由**：跨组织边界的智能任务分配和执行
- **信誉系统**：基于任务完成质量的去中心化信誉评估

## IPC 通道

### Agent DID

| 通道                | 说明         |
| ------------------- | ------------ |
| `agent-did:create`  | 创建 DID     |
| `agent-did:resolve` | 解析 DID     |
| `agent-did:get-all` | 获取所有 DID |
| `agent-did:revoke`  | 撤销 DID     |

### 联邦注册

| 通道                             | 说明         |
| -------------------------------- | ------------ |
| `fed-registry:discover`          | 发现代理     |
| `fed-registry:register`          | 注册代理     |
| `fed-registry:query-skills`      | 按技能查询   |
| `fed-registry:get-network-stats` | 获取网络统计 |

### 可验证凭证

| 通道                | 说明     |
| ------------------- | -------- |
| `agent-cred:issue`  | 颁发凭证 |
| `agent-cred:verify` | 验证凭证 |
| `agent-cred:revoke` | 撤销凭证 |

### 跨组织任务

| 通道                        | 说明         |
| --------------------------- | ------------ |
| `cross-org:route-task`      | 路由任务     |
| `cross-org:get-task-status` | 获取任务状态 |
| `cross-org:cancel-task`     | 取消任务     |
| `cross-org:get-log`         | 获取任务日志 |

### 信誉系统

| 通道                     | 说明         |
| ------------------------ | ------------ |
| `reputation:get-score`   | 获取信誉分   |
| `reputation:get-ranking` | 获取排行榜   |
| `reputation:update`      | 更新信誉     |
| `reputation:get-history` | 获取信誉历史 |

### 配置

| 通道                       | 说明             |
| -------------------------- | ---------------- |
| `decentralized:get-config` | 获取去中心化配置 |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "agentFederation": {
    "enabled": true,
    "registryUrl": "https://registry.chainlesschain.io",
    "autoRegister": true,
    "autoDiscover": true,
    "discoverInterval": 300000,
    "reputation": {
      "initialScore": 5.0,
      "decayFactor": 0.95,
      "minTasksForRanking": 3
    },
    "crossOrg": {
      "maxConcurrentTasks": 5,
      "defaultTimeout": 300000,
      "slaEnforcement": true
    }
  }
}
```

## 使用示例

### 加入联邦网络

1. 打开「去中心化代理网络」页面
2. 点击「创建 DID」生成代理身份
3. 点击「注册代理」加入联邦网络
4. 系统自动广播技能到网络

### 委派跨组织任务

1. 在「代理发现」标签页搜索目标技能
2. 从在线代理列表中选择合适的代理
3. 点击「委派任务」，填写任务类型和描述
4. 在「跨组织任务」标签页跟踪任务进度

### 信誉查看

1. 切换到「信誉排行」标签页
2. 查看全网代理信誉排行榜
3. 点击代理查看详细信誉历史

## 故障排除

| 问题         | 解决方案                        |
| ------------ | ------------------------------- |
| DID 创建失败 | 检查密钥生成环境和权限          |
| 发现不到代理 | 确认网络连接和注册中心地址      |
| 任务路由失败 | 检查目标代理在线状态和 SLA 配置 |
| 信誉分异常   | 查看信誉历史确认是否有负面事件  |

### 联邦节点不可达

**现象**: 调用 `fed-registry:discover` 或 `fed-registry:register` 超时或返回连接失败。

**排查步骤**:
1. 确认 `registryUrl` 配置地址正确且可访问（`curl` 或浏览器测试）
2. 检查本地网络代理/防火墙设置是否阻断了外部请求
3. 确认 `autoDiscover` 和 `autoRegister` 是否为 `true`
4. 查看日志中是否有 DNS 解析或 TLS 证书校验错误

### DID 认证失败（挑战-响应错误）

**现象**: 跨组织调用时返回认证失败，Agent 被拒绝访问。

**排查步骤**:
1. 确认本地 Agent DID 的 Ed25519 密钥未过期或被撤销
2. 检查双方系统时间差是否在允许范围内（时间戳验证依赖时钟同步）
3. 确认会话 Token 未过期（默认 TTL 1 小时），过期后需重新认证
4. 查看 `agent-did:resolve` 是否能正常解析对方 DID 文档

### 跨组织任务超时

**现象**: `cross-org:route-task` 长时间无响应或返回超时错误。

**排查步骤**:
1. 检查 `crossOrg.defaultTimeout` 配置是否设置过短（默认 300000ms）
2. 确认目标 Agent 在线并有空闲处理能力（`maxConcurrentTasks` 未超限）
3. 查看 `cross-org:get-task-status` 确认任务是否卡在某个中间状态
4. 若目标 Agent 持续不响应，检查其心跳状态或尝试更换目标 Agent

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 节点注册失败 | DID 格式错误或注册服务不可达 | 验证 DID 格式，检查联邦注册中心网络连通性 |
| 跨组织路由超时 | 目标组织防火墙阻断或路由表过期 | 检查网络策略，执行 `federation route-refresh` |
| 认证令牌过期 | Token TTL 过短或时钟偏移 | 增大 `tokenTTL` 配置，同步系统时钟（NTP） |
| Agent 心跳丢失 | 网络抖动或心跳间隔过长 | 缩短 `heartbeatInterval`，检查网络稳定性 |
| 联邦发现服务无响应 | 发现服务未启动或端口被占用 | 重启发现服务，确认端口未冲突 |

### 常见错误修复

**错误: `REGISTRATION_FAILED` 节点注册被拒**

```bash
# 检查 DID 有效性
chainlesschain did list --verbose

# 重新注册节点
chainlesschain a2a register --force --did <your-did>
```

**错误: `ROUTE_TIMEOUT` 跨组织路由超时**

```bash
# 刷新路由表
chainlesschain a2a route-refresh

# 测试目标组织连通性
chainlesschain a2a ping --org <target-org-id>
```

**错误: `AUTH_TOKEN_EXPIRED` 认证过期**

```bash
# 重新获取认证令牌
chainlesschain a2a auth-renew --agent-did <your-did>

# 检查系统时钟同步状态
chainlesschain doctor --check ntp
```

## 安全考虑

- **DID 密钥隔离**: 每个 Agent 的 Ed25519 私钥存储在本地加密数据库，不随网络传播
- **挑战-响应认证**: 双向 DID 认证采用随机挑战+时间戳，防止中间人和重放攻击
- **凭证有效期**: 所有 VC 凭证设有过期时间，吊销注册表支持即时失效
- **信誉防篡改**: 信誉评分由本地计算引擎生成，基于实际任务执行结果，不可外部注入
- **跨组织隔离**: 不同组织的 Agent 注册表逻辑隔离，联邦查询需经认证授权
- **任务路由鉴权**: 跨组织任务分配前验证目标 Agent 的在线状态和 SLA 合规性
- **会话 Token 管理**: 认证会话设有 TTL（默认 1 小时），过期自动清理
- **数据传输加密**: 所有联邦网络通信使用端到端加密，防止数据窃听

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/ai-engine/cowork/agent-did.js` | Agent DID 身份管理 |
| `desktop-app-vue/src/main/ai-engine/cowork/federated-agent-registry.js` | 联邦注册表与发现 |
| `desktop-app-vue/src/main/ai-engine/cowork/agent-credential-manager.js` | 可验证凭证管理 |
| `desktop-app-vue/src/main/ai-engine/cowork/cross-org-task-router.js` | 跨组织任务路由 |
| `desktop-app-vue/src/main/ai-engine/cowork/agent-reputation.js` | 信誉评分系统 |

## 相关文档

- [DID 身份系统](/chainlesschain/social)
- [EvoMap GEP 协议](/chainlesschain/evomap)
- [Cowork 多智能体协作](/chainlesschain/cowork)
