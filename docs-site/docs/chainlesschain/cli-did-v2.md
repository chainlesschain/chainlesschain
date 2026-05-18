# 去中心化身份 2.0 CLI（Phase 55）

> `chainlesschain did-v2`（别名 `didv2`）— W3C DID v2.0 + VC/VP + 社交恢复 + 身份漫游 + 信誉聚合。
>
> 支持 did:key / did:web / did:chain 三种方法，Ed25519 签名。

---

## 概述

DID v2.0 在 v1.0 基础上新增：W3C Verifiable Credential/Presentation、
k-of-n 监护人社交恢复、跨设备身份漫游日志、多来源加权信誉聚合。

---

## 核心特性

- **三种 DID 方法** — `did:key`（本地 Ed25519）、`did:web`（域名托管）、`did:chain`（链上注册）
- **W3C VC v1.1 兼容** — Credential 签发/验证/吊销，支持自定义 `type` 与 `claims`
- **Verifiable Presentation** — 多凭证组合出示，单次签名，防重放 nonce
- **k-of-n 社交恢复** — 监护人列表 + 阈值，支持部分批准、超时自动过期
- **身份漫游** — 跨设备 migrate/login/logout 事件追踪，可审计
- **多源信誉聚合** — `marketplace` / `peer` / `issuer` 等来源加权，便于身份信任评估

---

## 系统架构

```
┌───────────────────────────────────────────────────────┐
│           chainlesschain didv2 (Phase 55)              │
├───────────────────────────────────────────────────────┤
│  DID Methods             │  Credentials (VC/VP)        │
│  key / web / chain       │  issue / verify / revoke    │
│  Ed25519 keypair         │  present (multi-cred bundle)│
├───────────────────────────────────────────────────────┤
│  Social Recovery         │  Identity Roaming           │
│  k-of-n guardians        │  migrate / login events     │
│  threshold voting        │  cross-device log           │
├───────────────────────────────────────────────────────┤
│  Reputation Aggregator                                 │
│  weighted merge(marketplace, peer, issuer, ...)        │
├───────────────────────────────────────────────────────┤
│  SQLite: did_identities / vc_credentials / vp_presents │
│          recoveries / roaming_events / rep_records     │
└───────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项                       | 含义                  | 默认           |
| ---------------------------- | --------------------- | -------------- |
| `DID_METHODS`                | 支持的 DID 方法       | key, web, chain |
| `VC_DEFAULT_CONTEXT`         | VC @context 默认值    | W3C VC v1      |
| `RECOVERY_TIMEOUT_MS`        | 社交恢复超时          | 86400000 ms    |
| `REP_SOURCE_WEIGHTS`         | 各来源权重            | 可自定义        |
| VP nonce TTL                 | 表示随机数有效期      | 5 min          |

查看：`chainlesschain didv2 config`、`didv2 methods`、`didv2 cred-statuses`、`didv2 recovery-statuses`。

---

## 性能指标

| 操作                          | 典型耗时          |
| ----------------------------- | ----------------- |
| DID 创建（key 方法）          | 5–15 ms           |
| cred-issue（含签名）          | < 10 ms           |
| verify（单个 VC/VP）          | < 5 ms            |
| recover-start → complete      | 异步流程，依赖监护人批准 |
| rep-aggregate（10 源）        | < 5 ms            |
| V2 治理 surface (per memory)  | 37 V2 tests, caps per-owner active identity / per-identity issuance |

---

## 测试覆盖率

```
__tests__/unit/did-v2-manager.test.js — 61 tests (638 lines)
```

覆盖：三种方法创建、VC 签发/验证/吊销、VP present/verify、k-of-n 社交恢复（包括阈值未达、已过期）、
roaming 事件写入、rep 聚合加权。
V2 surface：`did_manager_v2_cli.md`（37 V2 tests）。

---

## 安全考虑

1. **私钥安全** — 仅存 SQLite 本地库（启用 SQLCipher 时 AES-256 加密），禁止通过 CLI 参数直接读出
2. **VC 签名链** — issuer 必须为已创建且未吊销的 DID；`revoke` 后 verify 返回 `revoked`
3. **VP 防重放** — 每次 `present` 生成 nonce + challenge，verify 时校验
4. **社交恢复抗合谋** — 阈值 k 默认不低于 2，避免单监护人控制
5. **roaming 审计** — 跨设备 migrate 操作均写入 roaming_events 表，可用于入侵检测

---

## 故障排查

**Q: `cred-verify` 返回 invalid signature?**

1. issuer DID 是否被 `revoke`（已吊销 DID 签发的 VC 也会失效）
2. 凭证内容在签发后是否被篡改（重算 hash 比对）
3. 签名算法不匹配——本实现默认 Ed25519

**Q: `recover-complete` 报 threshold not met?**

1. `--approvals` 中的监护人 DID 数量需 ≥ `--threshold`
2. 每个 approval 必须是真正的监护人（在 `recover-start --guardians` 列表中）
3. 请求是否已过期（`RECOVERY_TIMEOUT_MS`）——用 `recovery-show` 查看

**Q: `resolve` did:web 失败?**

1. CLI 侧对 did:web 为本地模拟解析，不一定触网；返回 DID Document 存 SQLite
2. 生产环境需真实 DNS + `/.well-known/did.json` HTTP 托管

---

## 关键文件

- `packages/cli/src/commands/did-v2.js` — Commander 子命令（~620 行）
- `packages/cli/src/lib/did-v2-manager.js` — DID v2 管理器
- `packages/cli/src/lib/did-manager.js` — DID v1 基础（v2 继承）
- `packages/cli/__tests__/unit/did-v2-manager.test.js` — 单测（61 tests）
- 数据表：`did_identities` / `vc_credentials` / `vp_presentations` / `recoveries` / `roaming_events` / `rep_records`
- 设计文档：`docs/design/modules/55_去中心化身份2.0.md`

---

## 使用示例

```bash
# 1. 创建 DID + 颁发 VC
did=$(chainlesschain didv2 create --method key | grep "did:key" | awk '{print $NF}')
cred=$(chainlesschain didv2 cred-issue --issuer "$did" --subject "$did" --type DevCert --claims '{"role":"admin"}' --json | jq -r .id)

# 2. 组装 VP 并验证
vp=$(chainlesschain didv2 present --holder "$did" --credentials "$cred" --json | jq -r .id)
chainlesschain didv2 verify "$vp"

# 3. 社交恢复
chainlesschain didv2 recover-start "$did" --guardians "did1,did2,did3" --threshold 2

# 4. 身份漫游
chainlesschain didv2 roam "$did" --target-device "phone-2" --event migrate

# 5. 信誉聚合
chainlesschain didv2 rep-record "$did" --source marketplace --score 0.95
chainlesschain didv2 rep-aggregate "$did"
```

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
- [DID v1 →](/chainlesschain/cli-did)
- [Agent Network →](/chainlesschain/cli-agent-network)
- [SSO Manager →](/chainlesschain/cli-sso)
