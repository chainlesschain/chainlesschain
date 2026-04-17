# 去中心化 Agent 网络 CLI（Phase 24）

> `chainlesschain agent-network`（别名 `anet`）— Agent 节点注册、发现、认证与任务路由。
>
> Ed25519 DID + W3C VC + Kademlia k-bucket 模拟 + challenge-response 认证 + 4 维加权信誉任务路由。

---

## 概述

Agent Network 提供去中心化 Agent 节点注册与发现，基于 DID 的身份认证，
W3C Verifiable Credential 凭证颁发/验证，以及基于多维信誉评分的智能任务路由。

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
