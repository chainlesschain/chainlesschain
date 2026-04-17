# 去中心化身份 2.0 CLI（Phase 55）

> `chainlesschain did-v2`（别名 `didv2`）— W3C DID v2.0 + VC/VP + 社交恢复 + 身份漫游 + 信誉聚合。
>
> 支持 did:key / did:web / did:chain 三种方法，Ed25519 签名。

---

## 概述

DID v2.0 在 v1.0 基础上新增：W3C Verifiable Credential/Presentation、
k-of-n 监护人社交恢复、跨设备身份漫游日志、多来源加权信誉聚合。

---

## 目录/枚举

```bash
chainlesschain didv2 config            # 查看配置常量
chainlesschain didv2 methods           # 列出支持的 DID 方法（key/web/chain）
chainlesschain didv2 cred-statuses     # 凭证状态
chainlesschain didv2 recovery-statuses # 恢复请求状态
```

---

## DID 生命周期

```bash
# 创建 DID（默认 did:key + Ed25519）
chainlesschain didv2 create
chainlesschain didv2 create --method web --domain example.com

# 解析 DID Document
chainlesschain didv2 resolve <did>

# 列出本地 DID
chainlesschain didv2 list

# 吊销 DID
chainlesschain didv2 revoke <did>
```

---

## 可验证凭证（VC）与表示（VP）

```bash
# 颁发凭证
chainlesschain didv2 cred-issue --issuer <did> --subject <did> --type AgentCert --claims '{"role":"admin"}'

# 查看 / 列出 / 吊销
chainlesschain didv2 cred-show <cred-id>
chainlesschain didv2 creds
chainlesschain didv2 cred-revoke <cred-id>

# 生成 Verifiable Presentation
chainlesschain didv2 present --holder <did> --credentials <cred-id1,cred-id2>

# 验证 VP
chainlesschain didv2 verify <vp-id>

# 查看 / 列出 VP
chainlesschain didv2 vp-show <vp-id>
chainlesschain didv2 presentations
```

---

## 社交恢复

```bash
# 发起恢复（k-of-n 监护人）
chainlesschain didv2 recover-start <did> --guardians <did1,did2,did3> --threshold 2

# 完成恢复
chainlesschain didv2 recover-complete <recovery-id> --approvals <guardian-did1,guardian-did2>

# 查看恢复请求
chainlesschain didv2 recoveries
chainlesschain didv2 recovery-show <recovery-id>
```

---

## 身份漫游 & 信誉

```bash
# 记录身份漫游事件
chainlesschain didv2 roam <did> --target-device "phone-2" --event migrate

# 查看漫游日志
chainlesschain didv2 roaming-log <did>

# 信誉记录与聚合
chainlesschain didv2 rep-record <did> --source marketplace --score 0.95
chainlesschain didv2 rep-aggregate <did>
```

---

## 导出 & 统计

```bash
chainlesschain didv2 export <did> --format json
chainlesschain didv2 stats
chainlesschain didv2 stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/55_去中心化身份2.0.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
