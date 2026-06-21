# M-of-N 多重签名提案（cc multisig）

> **版本: v1.2 m-of-n Phase 1-2 | 状态: ✅ 生产可用 | Ed25519 + SLH-DSA 异构签名 | core-multisig 86 单测 + 32 CLI 集成测试**
>
> `cc multisig` 提供超越 MTC `publisher_signature` 的 **M-of-N 多签提案系统**：按 domain 配置策略（成员集合 + 阈值 M），发起提案后由各成员独立加签，凑满 M 个有效签名进入 `reached`，业务方执行操作后 `finalize` 标记 `consumed`。底座是独立包 `@chainlesschain/core-multisig`（policy / signing / proposals / store / governance-log 五模块），CLI 端持 SQLite DB + append-only 治理日志。

## 概述

单签名足以表达「我同意」，但高价值操作（大额市场购买、跨链桥出账、DID 轮换等）需要「我们中的 M 个人同意」。`cc multisig` 把这件事做成一个独立、可审计的状态机：

- **策略（policy）**：每个 domain（如 `marketplace.purchase`、`crosschain.bridge.outbound`）一份策略，定义成员（DID + 算法 + JWK 公钥）、阈值 M、是否强制 PQC 签名、提案默认过期窗口。
- **提案（proposal）**：发起人（必须是策略成员）创建提案并立即签下首签；其余成员 out-of-band 收到提案 ID 后各自 `cc multisig sign`。
- **状态机**：`pending → reached → consumed`；`pending/reached` 可 `cancelled`；过期的 `pending` 被 sweeper 标 `expired`。`consumed / cancelled / expired` 为终态，不可回退。
- **双写审计**：每次状态转移（proposed / signed / reached / consumed / cancelled / expired）同步追加到 JSONL 治理日志。

业务集成已落地两处：`cc marketplace purchase`（大额订单 ≥ 阈值强制走多签）与 `cc crosschain bridge --require-multisig`。

## 核心特性

- 🧮 **M-of-N 阈值签名**：每个 signer 只计一次（去重），凑满 M 个验签通过的成员签名即 `reached`
- 🔀 **异构算法**：成员可混用 `Ed25519`（64 字节签名）与 `SLH-DSA-SHA2-128F`（后量子，PQC）
- 🛡️ **`requirePqc` 过渡期约束**：策略可要求至少 1 个 SLH-DSA 签名才算达阈
- 📐 **JCS 规范化（RFC 8785）+ 域分隔**：签名输入 = `"MULTISIG:" || JCS({domain, payload, nonce, expiresAtMs, m, members})`，成员集合本身进 canonical hash，防签后篡改成员
- 🔁 **nonce 防回放**：每个提案生成 timestamp + random nonce
- ✅ **入库前自验（fail-fast）**：每个签名先用成员公钥 self-verify，验不过直接拒收（防 caller 误传 secretKey）
- 🔌 **外部签名回调**（`signWithExternal`，库级 API）：renderer / U-Key / TEE 场景私钥不出边界，调用方只回传签名字节
- 📜 **append-only 治理日志**：JSONL，每行一个事件，永不改写既往行
- 🗄️ **SQLite 驱动三级级联**：`better-sqlite3-multiple-ciphers` → `better-sqlite3` → `sql.js`（WASM，close 时落盘）
- 📤 **`--json` 输出**：所有子命令支持，便于脚本消费

## 命令参考

```bash
# 策略管理
cc multisig policy set <domain> --m <M> --members <json|file> \
    [--require-pqc] [--expiry-ms <ms>]            # 设置/更新策略（normalizePolicy 校验）
cc multisig policy show <domain> [--json]          # 查看策略

# 提案生命周期
cc multisig propose <domain> --payload-file <path> \
    --initiator <did> [--alg <alg>] [--key <hex|path>] [--json]
cc multisig sign <proposalId> --signer <did> [--alg <alg>] [--key <hex|path>] [--json]
cc multisig cancel <proposalId> [--reason <text>] [--json]
cc multisig finalize <proposalId> [--json]         # reached → consumed
cc multisig sweep [--json]                          # 批量过期超时的 pending

# 查询
cc multisig list [--state <s>] [--domain <d>] [--limit <n>] [--json]
cc multisig show <proposalId> [--json]              # 含 payload + 全部签名
```

公共 flag：`--db <path>`（SQLite 路径）、`--log <path>`（治理日志路径）、`--json`。`--alg` 默认 `Ed25519`。

`--members` 接受内联 JSON 或文件路径，元素形如 `{ "did": "did:cc:alice", "alg": "Ed25519", "pubkeyJwk": {...} }`。

## 系统架构

```
┌────────────────────────────────────────────────────────────────────┐
│ cc multisig propose|sign|cancel|finalize|list|show|sweep|policy      │
│ cc marketplace purchase (≥阈值)   cc crosschain bridge --require-multisig │
└───────────────────────────┬────────────────────────────────────────┘
                            │ openMultisigManager(dbPath, logPath)
              ┌─────────────▼─────────────────┐
              │ src/lib/multisig-runtime.js    │  SQLite 驱动级联:
              │  _openDatabase + sql.js 适配器 │  bs3mc → bs3 → sql.js(WASM)
              └─────────────┬─────────────────┘
                            │
        ┌───────────────────▼──────────────────────────┐
        │ @chainlesschain/core-multisig                 │
        │  policy.js     validatePolicy/normalizePolicy │
        │  signing.js    JCS + "MULTISIG:" 前缀 +       │
        │                Ed25519 / SLH-DSA sign+verify  │
        │  proposals.js  propose/sign/cancel/finalize/  │
        │                expireStale + _checkReached    │
        │  store.js      SQLite 读写包装                │
        │  governance-log.js  appendEvent (JSONL)       │
        └───────┬──────────────────────┬────────────────┘
                │                      │
     ~/.chainlesschain/multisig.db   ~/.chainlesschain/multisig.governance.log
     (proposals/signatures/policies)  (append-only 审计事件)
```

### 提案状态机

```
            sign×M (验签通过)            finalize
 pending ───────────────────► reached ───────────► consumed (终态)
    │                            │
    │ cancel                     │ cancel
    ▼                            ▼
 cancelled (终态)            cancelled (终态)
    │
    │ sweep / 加签时发现已超时
    ▼
 expired (终态, 仅 pending 可过期)
```

## 配置参考

| 项                             | 默认值                                      | 说明                                                                                                             |
| ------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--db`                         | `~/.chainlesschain/multisig.db`             | SQLite（表：`multisig_proposals` / `multisig_signatures` / `multisig_policies`）                                 |
| `--log`                        | `~/.chainlesschain/multisig.governance.log` | JSONL 治理日志                                                                                                   |
| `--key`                        | （必填）                                    | 十六进制私钥字符串，或指向 hex 文件的路径（`readSecretKey` 自动判别）                                            |
| `policy.m`                     | （必填）                                    | 阈值，整数 ≥1 且 ≤ n                                                                                             |
| `policy.members[].alg`         | —                                           | 仅 `Ed25519` / `SLH-DSA-SHA2-128F`（`SUPPORTED_ALGS` 白名单）                                                    |
| `policy.requirePqc`            | `false`                                     | 为 true 时成员中必须有 SLH-DSA 成员，且达阈需至少 1 个 SLH-DSA 有效签名                                          |
| `policy.defaultExpiryMs`       | `86400000`（24h）                           | 提案过期窗口（`--expiry-ms` 覆盖）                                                                               |
| `list --limit`                 | `50`                                        | store 层内部默认 100                                                                                             |
| `LARGE_PURCHASE_THRESHOLD_FEN` | `100000`（分，即 ¥1000）                    | `cc marketplace purchase` 大额订单强制走多签的阈值（`--threshold-fen` 覆盖），domain 固定 `marketplace.purchase` |

环境变量：无专用变量；DB/日志位置由 `getHomeDir()`（`~/.chainlesschain/`）推导。Phase 1d 内 keystore 集成（core-did/UnifiedKeyStore）留待 v1.3 —— 目前私钥只能经 `--key` 提供。

## 性能指标

来自代码的运行时常量（无独立基准，基准数据待补）：

- **提案默认过期窗口**：24 小时（`DEFAULT_EXPIRY_MS = 24*60*60*1000`）
- **签名长度硬校验**：Ed25519 = 64 字节；SLH-DSA-SHA2-128F = `SIGNATURE_LEN`（noble post-quantum 实现），长度不符直接验签失败
- **治理日志**：`fs.appendFileSync` 同步逐条写，不缓冲不批量（crash 安全优先于吞吐）
- **`sweep`**：单条 UPDATE 批量过期（`state='pending' AND expires_at_ms < now`），O(1) SQL
- **WASM 兜底**：sql.js 路径在 `close()` 时整库导出落盘 —— 大库下 close 成本随库体积增长

## 测试覆盖

**core-multisig 单元测试 86 个**（`packages/core-multisig/__tests__/`）：

| 文件                     | 用例数 |
| ------------------------ | ------ |
| `proposals.test.js`      | 31     |
| `signing.test.js`        | 19     |
| `policy.test.js`         | 15     |
| `store.test.js`          | 14     |
| `governance-log.test.js` | 7      |

**CLI 集成/E2E 测试 32 个**（`packages/cli/__tests__/integration/`，subprocess 跑真 CLI bin）：

| 文件                               | 用例数 | 覆盖                                                                                                           |
| ---------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `multisig-cli.test.js`             | 10     | policy set + propose + sign + show + list + cancel + finalize + sweep 端到端、`--json` 形状、失败路径          |
| `crosschain-multisig-e2e.test.js`  | 14     | `cc crosschain bridge --require-multisig`（2-of-2，domain `crosschain.bridge.outbound`）+ 桥记录持久化多签溯源 |
| `marketplace-multisig-e2e.test.js` | 8      | 大额购买强制路由多签、`purchase-consume` 域校验                                                                |

```bash
cd packages/core-multisig && npx vitest run
cd packages/cli && npx vitest run __tests__/integration/multisig-cli.test.js
```

## 安全考虑

- **域分隔防跨协议回放**：签名输入前缀 `"MULTISIG:"`，与 MTC tree-head 等其它协议签名不可互换
- **nonce + 过期窗口防重放**：每提案唯一 nonce；过期 `pending` 提案加签时即时标 `expired` 并拒收
- **成员集合进 canonical hash**：签后改 member set 会令所有既有签名失效
- **入库前自验（fail-closed）**：`verifyOne` 不通过的签名不落库（`sig_self_verify_failed`）
- **逐项拒绝原因**：`not_a_member` / `alg_mismatch` / `duplicate_signer` / `expired` / `proposal_state_*` —— 未知 signer 在阈值验证时静默忽略，不计数
- **每 signer 只计一次**：`verifyThreshold` 按 DID 去重；`validSigners` 排序输出防重排攻击
- **终态不可逆**：`consumed / cancelled / expired` 后任何转移被拒，`finalize` 仅接受 `reached`（防 double-consume）
- **PQC 过渡**：`requirePqc=true` 时纯 Ed25519 签名集合即使数量达 M 也不算 reached
- **私钥不出边界（库级）**：`signWithExternal` 以 `signCallback(canonicalBytes, alg)` 替代 secretKey 入参，适配 U-Key / TEE / renderer
- **审计日志 append-only**：单行损坏只跳过该行，不影响其余事件解析

## 故障排除

| 现象                                           | 可能原因                                                               | 处理                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `No policy set for domain "..."`（exit 2）     | 该 domain 未配置策略                                                   | 先 `cc multisig policy set <domain> --m <M> --members <json>`                            |
| `✗ Signature rejected: not_a_member`           | `--signer` DID 不在提案快照的 memberSet 中                             | 用 `cc multisig show <id>` 核对成员；策略改动不影响已建提案（成员集合在 propose 时快照） |
| `✗ Signature rejected: alg_mismatch`           | `--alg` 与策略中该成员登记的算法不一致                                 | 按 `policy show` 中该成员的 alg 传参                                                     |
| `✗ Signature rejected: duplicate_signer`       | 同一 DID 重复加签                                                      | 预期行为；每个成员只计一次                                                               |
| `✗ Signature rejected: sig_self_verify_failed` | `--key` 与该成员登记的公钥不配对                                       | 核对私钥 hex / 文件内容                                                                  |
| `✗ Signature rejected: expired`                | 提案已过 `expiresAtMs`                                                 | 重新 propose；可在 policy 上调大 `--expiry-ms`                                           |
| `✗ Finalize rejected: proposal_state_pending`  | 尚未凑满 M 个有效签名                                                  | `show` 查看 `Sigs x/M`，先补签                                                           |
| `validatePolicy: m must be ≤ n` 等抛错         | 策略形状非法（m>n、重复 DID、不支持的 alg、requirePqc 但无 PQC 成员…） | 按报错修 members JSON；`policy set` 是 fail-fast 的                                      |
| `--key: not hex and not an existing file path` | `--key` 既不是合法 hex 也不是存在的文件                                | 检查路径或 hex 串                                                                        |
| 原生 SQLite 模块加载失败但命令仍可用           | 驱动级联落到 sql.js（WASM）                                            | 功能等价；注意 WASM 模式在进程退出（close）时才落盘                                      |

## 关键文件

| 文件                                           | 说明                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/cli/src/commands/multisig.js`        | `cc multisig` 全部子命令                                                             |
| `packages/cli/src/lib/multisig-runtime.js`     | DB 级联打开（bs3mc→bs3→sql.js 适配器）+ manager 装配 + `readSecretKey`/`readJsonArg` |
| `packages/core-multisig/lib/policy.js`         | 策略校验/归一化（`SUPPORTED_ALGS`、`DEFAULT_EXPIRY_MS`）                             |
| `packages/core-multisig/lib/signing.js`        | JCS 规范化 + `MULTISIG:` 域前缀 + signRaw/verifyOne/verifyThreshold                  |
| `packages/core-multisig/lib/proposals.js`      | 提案状态机（propose/sign/signWithExternal/cancel/finalize/expireStale）              |
| `packages/core-multisig/lib/store.js`          | SQLite 读写包装（proposals/signatures/policies）                                     |
| `packages/core-multisig/lib/schema.js`         | DDL（幂等 CREATE TABLE/INDEX IF NOT EXISTS）                                         |
| `packages/core-multisig/lib/governance-log.js` | append-only JSONL 审计日志                                                           |
| `packages/cli/src/commands/marketplace.js`     | 大额购买多签集成（`LARGE_PURCHASE_THRESHOLD_FEN`、domain `marketplace.purchase`）    |

## 使用示例

```bash
# 1) 配一个 2-of-3 策略（members.json 含 3 个 {did, alg, pubkeyJwk}）
cc multisig policy set marketplace.purchase --m 2 --members ./members.json
#    → ✓ Policy set: marketplace.purchase (2-of-3)

# 2) 发起人创建提案（自动签下第 1 签）
cc multisig propose marketplace.purchase \
  --payload-file ./order.json \
  --initiator did:cc:alice --key ./alice.key.hex --json
#    → { "proposalId": "msp_...", "reachedThreshold": false }

# 3) 第二个成员加签 —— 达到 2-of-3 阈值
cc multisig sign msp_xxx --signer did:cc:bob --key ./bob.key.hex
#    → ✓ Signature accepted
#    → ✓ Threshold reached — proposal ready for finalize

# 4) 查看提案详情（payload + 签名列表）
cc multisig show msp_xxx

# 5) 业务操作执行完毕后收口
cc multisig finalize msp_xxx
#    → ✓ Proposal finalized (state=consumed)

# 6) 列出 pending 提案 / 批量过期超时提案
cc multisig list --state pending
cc multisig sweep

# 7) PQC 强化策略：至少 1 个 SLH-DSA 签名才算达阈
cc multisig policy set did.rotate --m 2 --members ./members-pqc.json --require-pqc
```

## 相关文档

- [MTC 信任链](./mtc.md)
- [门限安全](./threshold-security.md)
- [CLI 市场（cc marketplace）](./cli-marketplace.md)
- [CLI 跨链（cc crosschain）](./cli-crosschain.md)
- [PQC 迁移](./pqc-migration.md)
- [CLI DID 身份](./cli-did.md)
