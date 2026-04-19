# 去中心化 Agent 网络 CLI（Phase 24）

> `chainlesschain agent-network`（别名 `anet`）— Agent 节点注册、发现、认证与任务路由。
>
> Ed25519 DID + W3C VC + Kademlia k-bucket 模拟 + challenge-response 认证 + 4 维加权信誉任务路由。

---

## 概述

Agent Network 提供去中心化 Agent 节点注册与发现，基于 DID 的身份认证，
W3C Verifiable Credential 凭证颁发/验证，以及基于多维信誉评分的智能任务路由。

---

## 核心特性

- **Ed25519 DID 身份** — `did:key` 方法，本地密钥对生成、签名、验证，支持停用
- **Kademlia k-bucket 模拟** — 对等节点管理，按能力发现，支持心跳超时清扫
- **Challenge-Response 认证** — 签名挑战 + 会话令牌，防重放，认证会话审计
- **W3C Verifiable Credentials** — 凭证颁发、验证、吊销，支持 `AgentCapability`/`Delegation` 等类型
- **4 维加权信誉评分** — quality / speed / availability / security，分数范围 0-1，带历史与衰减
- **智能任务路由** — 基于信誉与能力匹配选取最优节点，任务状态机 `queued → routed → running → completed/failed/cancelled`
- **V2 治理层** — `-v2` 后缀的 governance 表面，per-owner active-agent cap + per-agent pending-task cap，auto-suspend-idle / auto-fail-stuck

---

## 系统架构

```
┌───────────────────────────────────────────────────────────┐
│                    chainlesschain anet                     │
├───────────────────────────────────────────────────────────┤
│  DID Layer        │  Discovery    │  Credentials          │
│  Ed25519 keys     │  k-bucket +   │  VC Issue / Verify /  │
│  sign / verify    │  capabilities │  Revoke               │
├───────────────────────────────────────────────────────────┤
│  Auth Layer       │  Reputation   │  Routing              │
│  Challenge →      │  4 dim × node │  Capability +         │
│  Response         │  (weighted)   │  Reputation → pick    │
├───────────────────────────────────────────────────────────┤
│                 SQLite (_agent_network_*)                  │
│  agents  │  peers  │  sessions  │  creds  │  tasks  │ rep │
└───────────────────────────────────────────────────────────┘
```

数据流：`did-create` → `register` (node + capabilities) → `credential-issue` → `task-route`
（按能力筛选 → 按 4 维加权评分排序 → 选中后置 `routed`）→ `task-status completed` → `rep-update`。

---

## 配置参考

| 常量                           | 含义               | 默认            |
| ------------------------------ | ------------------ | --------------- |
| `HEARTBEAT_TIMEOUT_MS`         | 心跳超时阈值       | 60000 ms        |
| `MAX_PEERS_PER_BUCKET`         | k-bucket 容量      | 20              |
| `AUTH_CHALLENGE_TTL_MS`        | 认证挑战有效期     | 300000 ms       |
| `REPUTATION_DECAY_PER_DAY`     | 每日信誉衰减系数   | 0.99            |
| `REPUTATION_DIMENSIONS`        | 信誉维度           | quality/speed/availability/security |
| V2 `perOwnerActiveAgentCap`    | 每 owner 活跃 agent 上限 | 12          |
| V2 `perAgentPendingTaskCap`    | 每 agent 待执行任务上限  | 20          |
| V2 `autoSuspendIdleAfterMs`    | 闲置自动 suspend 阈值  | 600000 ms     |

查看：`chainlesschain anet config`、`anet dimensions`、`anet task-statuses`。

---

## 性能指标

| 指标                         | 典型值              |
| ---------------------------- | ------------------- |
| DID 创建（Ed25519 keygen）   | 5–15 ms             |
| 签名/验证                    | < 2 ms              |
| 节点注册                     | < 10 ms             |
| 能力发现（100 节点）         | < 20 ms             |
| 任务路由决策（含信誉加权）   | < 30 ms             |
| V2 createTaskV2 dispatch     | < 50 ms             |
| 典型网络规模（单进程模拟）   | 1000+ 节点          |

---

## 测试覆盖率

```
__tests__/unit/agent-network.test.js — 96 tests (1064 lines)
```

覆盖：DID 生命周期、节点 register/discover/sweep、peer k-bucket、auth challenge、
VC issue/verify/revoke、task 路由与状态机、reputation 4 维更新/历史/排名、
V2 治理层（52 V2 tests 覆盖 4 态 agent maturity + 5 态 task lifecycle 并行在 agent-network-v2）。

---

## 安全考虑

1. **私钥本地保管** — Ed25519 私钥仅存 SQLite 本地库，不在网络中传输；`did-deactivate` 不删除历史记录，只标记停用
2. **Challenge-Response 防重放** — 每次挑战随机生成，TTL 5 分钟，一次性使用
3. **VC 签名链** — 每条凭证由 issuer DID 签名，验证时重算签名，`credential-revoke` 后 verify 返回 revoked
4. **信誉操纵防护** — 单次 `rep-update` 限幅，加权评分包含近期活跃度；历史可审计
5. **任务路由降级** — 若命中节点离线超 `HEARTBEAT_TIMEOUT_MS`，路由器自动跳过；V2 下 auto-fail-stuck 将长期停滞的任务标记 failed

---

## 故障排查

**Q: `discover` 返回空?**

1. 检查目标节点是否已 `register` 且 capability 拼写一致
2. 节点是否心跳超时（运行 `anet sweep` 看清理计数）
3. 尝试 `anet peers <node-id>` 确认 k-bucket 已加入对等关系

**Q: `auth-complete` 返回 invalid signature?**

1. 确认 `--response` 是对 challenge 的 DID 签名（用 `anet sign` 生成）
2. 检查 session 是否过期（`AUTH_CHALLENGE_TTL_MS`）
3. 确保签名方 DID 与注册时一致

**Q: `task-route` 返回 no eligible nodes?**

1. 检查是否至少有一个节点声明了 `--capability`
2. 所有候选节点 reputation 是否过低（评分不足阈值）
3. V2 下检查是否命中 `perAgentPendingTaskCap`（用 `anet gov-stats-v2` 查看）

**Q: V2 命令报 "parent preAction bypass failed"?**

子命令必须以 `-v2` 结尾，parent preAction 通过 `actionCommand.name().endsWith("-v2")` 放行。

---

## 关键文件

- `packages/cli/src/commands/agent-network.js` — Commander 子命令（~1038 行）
- `packages/cli/src/lib/agent-network.js` — 核心管理器
- `packages/cli/__tests__/unit/agent-network.test.js` — 单测
- 数据表：`_agent_network_agents` / `_peers` / `_sessions` / `_credentials` / `_tasks` / `_reputation`
- 设计文档：`docs/design/modules/24_去中心化Agent网络.md`

---

## 使用示例

```bash
# 1. 创建 DID 并注册节点
did=$(chainlesschain anet did-create --method key | grep did:)
chainlesschain anet register --did "$did" --capabilities "nlp,translation"

# 2. 发现节点并路由任务
chainlesschain anet discover --capability nlp
chainlesschain anet task-route --capability nlp --input "翻译文档 A"

# 3. 认证握手
sess=$(chainlesschain anet auth-start <node-id> | grep session-id)
sig=$(chainlesschain anet sign "$did" --message "<challenge>")
chainlesschain anet auth-complete "$sess" --response "$sig"

# 4. 颁发凭证
chainlesschain anet credential-issue --issuer "$did" --subject "<peer-did>" --type AgentCapability

# 5. V2 治理视图
chainlesschain anet gov-stats-v2
chainlesschain anet stats --json
```

---

## DID 身份管理

```bash
chainlesschain anet did-create --method key                # 创建 Ed25519 DID
chainlesschain anet did-resolve <did>                       # 解析 DID Document
chainlesschain anet dids                                    # 列出本地 DID
chainlesschain anet did-deactivate <did>                    # 停用 DID
chainlesschain anet sign <did> --message "hello"            # DID 签名
chainlesschain anet verify <did> --message "hello" --sig <hex>  # 验证签名
```

---

## 节点注册与发现

```bash
chainlesschain anet register --did <did> --capabilities "nlp,vision"  # 注册节点
chainlesschain anet unregister <node-id>                               # 注销节点
chainlesschain anet heartbeat <node-id>                                # 发送心跳
chainlesschain anet discover --capability nlp                          # 按能力发现
chainlesschain anet sweep                                              # 清理过期节点
chainlesschain anet peer-add <node-id> <peer-id>                       # 添加对等节点
chainlesschain anet peer-remove <node-id> <peer-id>                    # 移除对等节点
chainlesschain anet peers <node-id>                                    # 列出对等节点
```

---

## 认证与凭证

```bash
# Challenge-Response 认证
chainlesschain anet auth-start <node-id>                    # 发起认证挑战
chainlesschain anet auth-complete <session-id> --response <hex>  # 完成认证
chainlesschain anet auth-validate <session-id>              # 验证会话
chainlesschain anet auth-sessions                           # 列出认证会话

# W3C Verifiable Credentials
chainlesschain anet credential-issue --issuer <did> --subject <did> --type "AgentCapability"
chainlesschain anet credential-verify <credential-id>
chainlesschain anet credential-revoke <credential-id>
chainlesschain anet credential-show <credential-id>
chainlesschain anet credentials
```

---

## 任务路由

```bash
# 基于信誉的智能路由
chainlesschain anet task-route --capability nlp --input "翻译文档"
chainlesschain anet task-show <task-id>
chainlesschain anet task-status <task-id> completed
chainlesschain anet task-cancel <task-id>
chainlesschain anet tasks

# 信誉管理（4 维：质量/速度/可用性/安全）
chainlesschain anet rep-update <node-id> --dimension quality --score 0.95
chainlesschain anet rep-show <node-id>
chainlesschain anet rep-history <node-id>
chainlesschain anet rep-top --limit 10
```

---

## 统计与配置

```bash
chainlesschain anet config         # 查看配置常量
chainlesschain anet dimensions     # 列出信誉维度
chainlesschain anet task-statuses  # 列出任务状态
chainlesschain anet stats          # 网络统计
chainlesschain anet stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/24_去中心化Agent网络.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [DID v2.0 →](/chainlesschain/cli-did-v2)
- [A2A Protocol →](/chainlesschain/cli-a2a)
- [Agent Federation →](/chainlesschain/cli-federation)
