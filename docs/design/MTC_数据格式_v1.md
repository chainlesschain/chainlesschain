# MTC 数据格式规范 v1

> 版本：v0.1（数据格式首版草案）
> 日期：2026-04-26
> 作者：longfa
> 状态：**草案 / Draft** — 与 `默克尔树证书_MTC_落地方案.md` v0.1 同步
> 关联：
> - 上层方案：`docs/design/默克尔树证书_MTC_落地方案.md`
> - 上游协议：`draft-ietf-plants-merkle-tree-certs-02`、RFC 6962 §2.1（Merkle 树构造）、RFC 8785（JCS 规范化 JSON）
> - 算法依赖：FIPS 180-4（SHA-256）、FIPS 205（SLH-DSA）
>
> **本文档定位**：协议级字节规范。任何两个独立实现按本文档构造的 envelope / landmark 必须**逐字节相同**（除签名随机数），否则视为实现 bug。

---

## 1. 设计原则

1. **规范化优先**：所有进入哈希 / 签名的 JSON 必须先经 RFC 8785 JCS 规范化为字节串
2. **域分离**：叶子哈希、内部节点哈希、树头签名各自有独立的 domain separator 前缀字节
3. **版本字段必须显式**：所有顶层结构体携带 `schema` 字段；解析器拒绝未知 schema 而非"宽松接受"
4. **零隐式默认**：所有字段都必须显式出现（即使是默认值）— 简化规范化
5. **时间用 RFC 3339 UTC**：`2026-04-26T10:00:00Z`，禁止时区偏移
6. **二进制用 base64url（无 padding）**：与 JOSE / DID 生态一致
7. **哈希字符串前缀**：所有哈希值带算法前缀 `sha256:` — 便于将来扩展

---

## 2. 命名空间 (Namespace)

### 2.1 字符串规则

```
namespace ::= "mtc/v1/" <kind> ("/" <scope>)? ("/" <batch-seq>)
kind      ::= "did" | "skill" | "audit" | <future-extension>
scope     ::= [a-zA-Z0-9_-]{1,64}            ; 可选；audit 用 org-id
batch-seq ::= [0-9]{6,}                       ; 单调递增，零填充至少 6 位
```

合法示例：
- `mtc/v1/did/000142`
- `mtc/v1/skill/000007`
- `mtc/v1/audit/acme-corp/004821`

非法（实现必须拒绝）：
- `mtc/v2/did/000001`（schema 跃迁，本文档只覆盖 v1）
- `mtc/v1/DID/000001`（kind 必须小写）
- `mtc/v1/did/142`（batch-seq 不足 6 位）
- `mtc/v1/audit/acme corp/000001`（scope 含空格）

### 2.2 命名空间唯一性

每个 `(kind, scope)` 组合对应**一棵生长树**。`batch-seq` 不是新树的 ID，而是**该树某次关批时的快照编号**。例：
- `mtc/v1/did/000142` 和 `mtc/v1/did/000143` 是同一棵 DID 树的两个时间点快照
- `mtc/v1/audit/acme-corp/000001` 和 `mtc/v1/audit/globex/000001` 是**两棵独立的树**

---

## 3. 哈希构造（RFC 6962 兼容）

### 3.1 域分离前缀

```
LEAF_PREFIX = 0x00
NODE_PREFIX = 0x01
TREE_HEAD_SIG_PREFIX = "mtc/v1/tree-head\n"  (UTF-8, 17 bytes)
```

### 3.2 叶子哈希

```
leaf_hash(leaf) = SHA-256(LEAF_PREFIX || JCS(leaf))
```

其中 `leaf` 是 §5.2 定义的 JSON 对象，`JCS()` 是 RFC 8785 规范化输出（UTF-8 字节）。

### 3.3 内部节点哈希

```
node_hash(left, right) = SHA-256(NODE_PREFIX || left || right)
```

`left` 和 `right` 都是 32 字节哈希。

### 3.4 树根计算

按 RFC 6962 §2.1.1 标准算法：
- 空树：`MTH({}) = SHA-256()`（但本协议**禁止空树关批**，关批前 `tree_size ≥ 1`）
- 单元素：`MTH({d0}) = leaf_hash(d0)`
- N > 1：取最大的 `k = 2^⌈log₂(N)⌉ / 2`，递归
  ```
  MTH(D[0:n]) = node_hash(MTH(D[0:k]), MTH(D[k:n]))
  ```

> **关键**：树**不要求**是满二叉树。N 不是 2 的幂时左子树仍取 2 的幂，右子树继续递归。这与 RFC 6962 一致，且不同于"补 padding 到 2 幂"的实现 — **不要补 padding**。

### 3.5 审计路径（Inclusion Proof）

按 RFC 6962 §2.1.1 PATH 算法：
- 输入：叶子下标 `m`，树大小 `n`，叶子集合 `D[0:n]`
- 输出：从叶子上推到根所需的兄弟节点哈希列表，长度 = `⌈log₂(n)⌉` 或更少（不平衡树时偏少）

实现**必须**有 RFC 6962 §2.1 的标准测试向量过测，见 §10。

---

## 4. JCS 规范化（RFC 8785）

所有进入哈希 / 签名的 JSON **必须**经 JCS：
1. UTF-8 编码
2. 对象键按 Unicode 码点升序
3. 数字按 ECMA-262 §7.1.12.1（整数无小数点；浮点用最短表示）
4. 字符串只允许 RFC 8259 转义（`\"` `\\` `\/` `\b` `\f` `\n` `\r` `\t` `\uXXXX`）
5. 不允许尾随空白 / 缩进
6. 数组顺序保留原序

**实现要求**：直接使用 `canonicalize` npm 包（已在 `packages/cli/package.json` 间接依赖中），不要自己写。

---

## 5. 数据结构

### 5.1 MTCEnvelope（顶层载荷）

```jsonc
{
  "schema": "mtc-envelope/v1",
  "namespace": "mtc/v1/did/000142",
  "tree_head_id": "sha256:abc123...",      // §6 定义
  "leaf": { ... },                          // §5.2
  "inclusion_proof": { ... },               // §5.3
  "fallback_signature": { ... }             // §5.5（可选）
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|:-:|---|
| `schema` | string | ✅ | 固定 `"mtc-envelope/v1"` |
| `namespace` | string | ✅ | 见 §2.1 |
| `tree_head_id` | string | ✅ | `sha256:` 前缀 + base64url 编码的 32 字节 = `SHA-256(JCS(tree_head))` |
| `leaf` | object | ✅ | §5.2 |
| `inclusion_proof` | object | ✅ | §5.3 |
| `fallback_signature` | object | 可选 | §5.5；landmark 不可达时启用 |

> Envelope **不内嵌** `tree_head` 全文 — 只放 ID。Verifier 通过 ID 反查本地 landmark cache。这是把单证书压到 ~450 B 的核心设计。

### 5.2 Leaf（叶子内容，按 kind 分形）

#### 5.2.1 通用形

```jsonc
{
  "kind": "did-document" | "skill-manifest" | "audit-event",
  "content_hash": "sha256:...",      // 实际内容的哈希
  "issued_at": "2026-04-26T10:00:00Z",
  "subject": "...",                  // kind-specific
  "metadata": { ... }                // kind-specific，规范化必备
}
```

#### 5.2.2 `kind = "did-document"`

```jsonc
{
  "kind": "did-document",
  "content_hash": "sha256:...",       // 完整 DID 文档 JSON 的 SHA-256
  "issued_at": "2026-04-26T10:00:00Z",
  "subject": "did:cc:zQ3sh...",       // DID 字符串
  "metadata": {
    "version": "1.2.0",               // DID 文档自身版本
    "supersedes": "sha256:..." | null // 上一版 content_hash，首版为 null
  }
}
```

#### 5.2.3 `kind = "skill-manifest"`

```jsonc
{
  "kind": "skill-manifest",
  "content_hash": "sha256:...",       // skill 包 IPFS CID 对应内容的 SHA-256
  "issued_at": "2026-04-26T10:00:00Z",
  "subject": "skill:cc:medical-triage@1.0.0",
  "metadata": {
    "publisher": "did:cc:zQ3sh...",
    "ipfs_cid": "bafy...",            // 可执行包的 IPFS CID
    "size_bytes": 152843
  }
}
```

#### 5.2.4 `kind = "audit-event"`

```jsonc
{
  "kind": "audit-event",
  "content_hash": "sha256:...",       // 事件原文 JSON 的 SHA-256
  "issued_at": "2026-04-26T10:00:00Z",
  "subject": "audit:acme-corp:004821:000777",  // org:batch:seq
  "metadata": {
    "actor_did": "did:cc:zQ3sh...",
    "action": "rbac.role.granted",
    "realtime_sig_id": "sha256:..."   // 实时落盘时 Ed25519 签名的哈希（双轨锚定）
  }
}
```

### 5.3 InclusionProof

```jsonc
{
  "leaf_index": 4271,
  "tree_size": 8192,
  "audit_path": [
    "sha256:abc...",
    "sha256:def...",
    "..."
  ]
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `leaf_index` | integer | `0 ≤ leaf_index < tree_size` |
| `tree_size` | integer | `tree_size ≥ 1` |
| `audit_path` | string[] | 长度 = RFC 6962 PATH 算法输出长度；元素为 `sha256:` 前缀字符串 |

### 5.4 TreeHead

```jsonc
{
  "schema": "mtc-tree-head/v1",
  "namespace": "mtc/v1/did/000142",
  "tree_size": 8192,
  "root_hash": "sha256:...",
  "issued_at": "2026-04-26T12:00:00Z",
  "expires_at": "2026-05-03T12:00:00Z",
  "issuer": "mtca:cc:zQ3sh..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|:-:|---|
| `schema` | string | ✅ | 固定 `"mtc-tree-head/v1"` |
| `namespace` | string | ✅ | 见 §2.1 |
| `tree_size` | integer | ✅ | 当前树的叶子总数 |
| `root_hash` | string | ✅ | `sha256:` + base64url(32 字节) |
| `issued_at` | string | ✅ | RFC 3339 UTC |
| `expires_at` | string | ✅ | RFC 3339 UTC；建议 ≤ `issued_at + 7 days` |
| `issuer` | string | ✅ | MTCA 标识 — `mtca:cc:<did-suffix>` 或 `mtca:fed:<federation-id>` |

### 5.5 FallbackSignature（envelope 内嵌可选）

```jsonc
{
  "alg": "Ed25519",
  "key_id": "did:cc:zQ3sh...#key-1",
  "sig": "base64url(...)"
}
```

签名输入：`canonicalize(leaf)` 的 JCS 字节。

> Phase 1 仅支持 `alg = "Ed25519"`；Phase 2 起允许 `"SLH-DSA-128f"` 等 PQC 算法。

---

## 6. tree_head_id 计算

```
tree_head_id = "sha256:" + base64url(SHA-256(JCS(tree_head)))
```

**关键**：
- `tree_head` 必须**先**经 JCS 规范化再喂 SHA-256
- 不掺任何前缀字节（区别于叶子 / 节点哈希 — tree_head_id 只是引用键，不参与树构造）
- base64url 不带 padding（`=` 字符禁止出现）

---

## 7. 树头签名

### 7.1 待签字节

```
signing_input = TREE_HEAD_SIG_PREFIX || JCS(tree_head)
              = "mtc/v1/tree-head\n" || JCS(tree_head)
```

域分离前缀确保树头签名**不会被重放**到任何其他签名场景。

### 7.2 签名结构

```jsonc
{
  "alg": "SLH-DSA-128f" | "SLH-DSA-128s" | "SLH-DSA-256f" | "Ed25519",
  "issuer": "mtca:cc:zQ3sh...",
  "sig": "base64url(...)",
  "pubkey_id": "sha256:..."          // pubkey 的 SHA-256；用于 verifier 反查公钥
}
```

| 字段 | 必填 | 说明 |
|---|:-:|---|
| `alg` | ✅ | Phase 1 默认 `"SLH-DSA-128f"`；列入 IANA 待定 |
| `issuer` | ✅ | 与 `TreeHead.issuer` 必须相同；不同则视为伪造 |
| `sig` | ✅ | base64url(签名字节) |
| `pubkey_id` | ✅ | `sha256:` + base64url(SHA-256(JCS(pubkey-jwk))) |

公钥本体不内嵌签名结构；通过 landmark 或预装信任锚分发（§8）。

---

## 8. Landmark（树头分发载荷）

```jsonc
{
  "schema": "mtc-landmark/v1",
  "namespace": "mtc/v1/did",          // 注意：landmark 用 (kind, scope)，不含 batch-seq
  "snapshots": [
    {
      "tree_head": { ... },           // §5.4
      "tree_head_id": "sha256:...",   // 冗余但便于检索
      "signature": { ... }            // §7.2
    },
    { ... }
  ],
  "trust_anchors": [
    {
      "issuer": "mtca:cc:zQ3sh...",
      "alg": "SLH-DSA-128f",
      "pubkey_id": "sha256:...",
      "pubkey_jwk": { ... }
    }
  ],
  "published_at": "2026-04-26T12:00:00Z",
  "publisher_signature": {
    "alg": "Ed25519",
    "key_id": "did:cc:zQ3sh...#key-1",
    "sig": "base64url(...)"
  }
}
```

### 8.1 字段约束

| 字段 | 类型 | 说明 |
|---|---|---|
| `snapshots` | array | 至少 1 项；按 `tree_head.tree_size` 升序排列 |
| `snapshots[*].tree_head_id` | string | 必须等于 §6 计算结果，verifier 必须重算校验 |
| `trust_anchors` | array | 该 landmark 引用的 MTCA 公钥；至少 1 项 |
| `publisher_signature` | object | landmark 自身的签名（防止 IPFS 节点篡改聚合） |

### 8.2 publisher_signature 待签字节

```
signing_input = "mtc/v1/landmark\n" || JCS({schema, namespace, snapshots, trust_anchors, published_at})
```

注意：签名输入**不包含** `publisher_signature` 字段本身（自引用）。

### 8.3 IPFS / DHT 分发

- Landmark 文件以**完整 JCS 字节**存入 IPFS，得到 CID
- libp2p gossipsub topic：`mtc-landmark/<kind>/<scope?>` （scope 可省略，全网公共树用）
- gossip 消息格式：
  ```jsonc
  {
    "namespace": "mtc/v1/did",
    "ipfs_cid": "bafy...",
    "tree_size": 8192,
    "published_at": "2026-04-26T12:00:00Z"
  }
  ```
- 订阅者比对本地最大 `tree_size`，落后则从 IPFS 拉 landmark 全文 + 校验 publisher_signature

### 8.4 单调性检查

Verifier 接受新 landmark 前**必须**校验：
1. `new_landmark.snapshots` 中所有 `tree_size` ≥ 已缓存 landmark 中同 namespace 的最大 `tree_size`
2. 对于 `tree_size` 相同的快照，`root_hash` 必须相同（否则视为 MTCA 双花，记录并告警）

不通过的 landmark 必须**拒绝**且**不更新本地缓存**。

---

## 9. 验证算法（伪代码）

```
function verify(envelope: MTCEnvelope, cache: LandmarkCache) -> Result:
    # 1. schema 检查
    if envelope.schema != "mtc-envelope/v1":
        return REJECT("UNKNOWN_SCHEMA")

    # 2. 反查 tree_head
    th = cache.lookup(envelope.namespace, envelope.tree_head_id)
    if th == null:
        return DEFER("LANDMARK_MISS")    # 可恢复，触发 IPFS 拉取后重试

    # 3. tree_head 时效性
    if now() > th.tree_head.expires_at:
        return REJECT("LANDMARK_EXPIRED")

    # 4. tree_head 签名（已在 landmark 入库时验过；此处可略，但实现允许重验）

    # 5. inclusion_proof 边界
    p = envelope.inclusion_proof
    if !(0 <= p.leaf_index < p.tree_size):
        return REJECT("BAD_PROOF_INDEX")
    if p.tree_size != th.tree_head.tree_size:
        return REJECT("PROOF_TREE_SIZE_MISMATCH")

    # 6. 审计路径长度
    expected_len = ceil_log2_path_length(p.leaf_index, p.tree_size)
    if len(p.audit_path) != expected_len:
        return REJECT("BAD_PROOF_LENGTH")

    # 7. 重算根
    leaf_h = SHA-256(LEAF_PREFIX || JCS(envelope.leaf))
    root = compute_root_from_path(leaf_h, p.leaf_index, p.tree_size, p.audit_path)
    if root != decode(th.tree_head.root_hash):
        return REJECT("ROOT_MISMATCH")

    return ACCEPT(envelope.leaf)
```

`compute_root_from_path` 必须严格按 RFC 6962 §2.1.1 实现，参考实现见 `packages/core-mtc/src/merkle.ts`（待 Phase 1 落地）。

---

## 10. 测试向量

### 10.1 RFC 6962 标准测试向量（必过）

实现必须在以下输入上得到完全一致的输出：

#### 树根（empty / single / multiple leaves）

```
D = []        ; MTH = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
D = [""]      ; MTH = 6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d
D = ["0", "1", ..., "7"]  (8 leaves) ; MTH = 5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328
```

> 完整测试向量见 RFC 6962 §A.1，本项目 `packages/core-mtc/test/fixtures/rfc6962.json` 复刻全部。

### 10.2 项目自有测试向量

#### 向量 #1 — 单叶子 DID 文档

```jsonc
// 输入 leaf
{
  "kind": "did-document",
  "content_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "issued_at": "2026-01-01T00:00:00Z",
  "subject": "did:cc:zQ3shTestVector001",
  "metadata": { "version": "1.0.0", "supersedes": null }
}

// 期望
JCS(leaf)            = (待生成 — 由 Phase 0 实施时锁定字节)
leaf_hash            = sha256:<待生成>
tree_size = 1, root_hash = leaf_hash
```

#### 向量 #2 — 8 叶子树的 inclusion proof

固定 8 个 leaf（同 §10.1），验证 leaf_index = 3 的 audit_path 长度为 3，且重算根 = 标准 MTH。

> 详细字节级测试向量在 Phase 0 锁定后追加 `docs/design/MTC_数据格式_v1_测试向量.md` 单独文件。

---

## 11. 错误码

| Code | HTTP/IPC | 描述 | 可恢复 |
|---|---|---|:-:|
| `UNKNOWN_SCHEMA` | 400 | envelope.schema 不识别 | ❌ |
| `BAD_NAMESPACE` | 400 | namespace 不符合 §2.1 | ❌ |
| `LANDMARK_MISS` | 404 | 本地 cache 无对应 tree_head | ✅ |
| `LANDMARK_EXPIRED` | 410 | tree_head 已过期 | ❌（除非应用层允许 fallback） |
| `BAD_PROOF_INDEX` | 400 | leaf_index 越界 | ❌ |
| `BAD_PROOF_LENGTH` | 400 | audit_path 长度异常 | ❌ |
| `PROOF_TREE_SIZE_MISMATCH` | 409 | proof.tree_size ≠ landmark.tree_size | ✅（重拉 landmark） |
| `ROOT_MISMATCH` | 401 | 重算根 ≠ landmark root | ❌（视为伪造） |
| `BAD_TREE_HEAD_SIG` | 401 | tree_head 签名验证失败 | ❌ |
| `BAD_LANDMARK_SIG` | 401 | publisher_signature 失败 | ❌ |
| `MTCA_DOUBLE_SIGNED` | 409 | 同 tree_size 出现两个不同 root_hash | ❌（告警） |

---

## 12. 兼容性与版本演进

### 12.1 严格兼容

- v1 解析器**必须**拒绝任何 `schema` 不匹配的载荷
- 不支持"宽松向前兼容"（lenient parsing）— 防止类型混淆攻击
- 字段顺序由 JCS 强制，实现不得依赖输入顺序

### 12.2 v2 演进路径（保留位）

预留以下扩展点供 v2：
- 树头签名算法切换（`alg` 枚举可扩）
- 多重 inclusion proof（一次证明多叶子，节省体积）
- 透明日志的"一致性证明"（consistency proof，证明新树是旧树的扩展）

v2 启用时，`schema` 字段会切到 `"mtc-envelope/v2"` — v1 实现会直接拒收，**不会**误处理。

---

## 13. 已知未决项

1. **`pubkey_jwk` 的 SLH-DSA JWK 编码**：IETF COSE/JOSE 还在草案阶段（`draft-ietf-cose-dilithium`、`draft-ietf-cose-sphincs-plus`）。Phase 1 暂用自定义编码 `{"kty":"slh-dsa","alg":"SLH-DSA-128f","x":"base64url(...)"}`，待标准敲定后切换。
2. **landmark 的"分代"机制**：单棵树长到 2³² 后单 landmark 文件会很大。Phase 3 引入 "checkpoint shard"，本文档暂不规范。
3. **批次关闭信号的链上锚定**：审计场景的"上链 hash" Phase 2 才接入；本文档先不规范字段位置。
4. **leaf 的 `kind` 扩展**：Phase 1 只定义 3 个；新增 kind（如 `cross-chain-bridge-message`）走单独 ADR。

---

## 附录 A — 字节级最小示例

> 占位：Phase 0 实施时 `packages/core-mtc/test/fixtures/minimal.json` 的字节序列（hex dump）将复制到此处，供任何独立实现交叉验证。

```
TODO: Phase 0 锁定后补完
- envelope.json (JCS) hex dump
- leaf_hash hex
- tree_head.json (JCS) hex dump
- tree_head_id base64url
- 单叶子树的签名待签字节 hex
```

## 附录 B — 与 IETF MTC v0 的字段对照

| 本文档字段 | IETF MTC 草案对应 | 差异说明 |
|---|---|---|
| `MTCEnvelope.namespace` | `BatchID` (struct) | 我们用字符串而非二进制 struct，便于日志 / 调试 |
| `Leaf.content_hash` | `Assertion.subject_info` | 本协议 leaf 是抽象内容，IETF 是 TLS 证书 |
| `TreeHead.issuer` | `SignedTreeHead.batch_number` | 我们引入 `mtca:` URI 形式标识签发方 |
| 域分离前缀 | `LeafType` enum (0x01 ...) | 我们用 0x00/0x01 与 RFC 6962 完全一致 |
| `Landmark` | `IssuerCertificateLog` | 本协议 landmark 是聚合载荷，IETF 是日志条目流 |

> 完整对照在 v0.2 草案中补全；目标是上层数据模型对齐 IETF，但下层字节布局保持 RFC 6962 严格兼容。

## 附录 C — 参考资料

- [RFC 6962 — Certificate Transparency](https://datatracker.ietf.org/doc/html/rfc6962) §2.1（树构造、审计路径算法）
- [RFC 8785 — JCS](https://datatracker.ietf.org/doc/html/rfc8785)
- [RFC 3339 — Date and Time on the Internet](https://datatracker.ietf.org/doc/html/rfc3339)
- [FIPS 180-4 — SHA-256](https://csrc.nist.gov/pubs/fips/180/4/final)
- [FIPS 205 — SLH-DSA](https://csrc.nist.gov/pubs/fips/205/final)
- [draft-ietf-plants-merkle-tree-certs-02](https://datatracker.ietf.org/doc/draft-ietf-plants-merkle-tree-certs/)
- 项目内：`docs/design/默克尔树证书_MTC_落地方案.md`、memory `pqc_slh_dsa.md`
