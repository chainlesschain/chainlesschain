# 去中心化交易 · 知识资产加密交付与 AI 撮合 设计文档 v1

> 状态：草案 v1.4（设计阶段，未进入实现；两轮对抗性自审 + P1 承重墙实跑验证 + A2A 范式扩展 + 深钻收口）
> v1.4 改动（第二轮对抗审计，专审 §8.2/§10 新部分）：修 7 个安全/正确性问题——联邦账本改**只追加签名转账日志**（节点不能伪造/印钱，§8.2）、outcome 改**确定性自动判分**（防双向造假，§10.4.1）、agent 热钥爆炸半径**被 mandate 额度封顶**+一键吊销（§10.3）、隐私预算改 **privacy-guardian 上下文外强制**（§10.4.2）、steelman 改**独立 decision-critic**（§10.3.1）、mandate 吊销**停新清旧**（§10.3）、托管人默认调和 §3.2/§8.2；补沙箱网络隔离（§10.4.3）、跨联邦 credits 不可互换（§8.2）。模块 5→7（+privacy-guardian/decision-critic）。
> v1.3 改动：§10 深钻——**段位评级防自封**（§10.4.1，outcome 主锚）、**关键决策人机界面**（§10.3.1，贵≠关键+steelman+硬件签）、**隐私反向泄露+隐私预算**（§10.4.2）、**行为可逆分级固化**（§10.4.3）；补 **A2A 阶段轨**（§8.1，修路线断点）；新增 **§11 收口**（全表/模块清单 + 自洽审查结论）。
> v1.2 改动：新增 **§10 个人 AI 经济层（A2A 自主交易）**——前提「人人有个人 AI、AI↔AI 自主交易」；两支柱=**关键决策回人**（§10.3 用 mandate + multisig 阈值编码）+ **AI↔AI 分段位付费学习**旗舰场景（§10.4）；对账确认 agent-economy/a2a/agent-did/credential/autonomous 已有大量真实基础，5 缺口=委托链/花费强制/A2A 协商/management-by-exception/段位评级。
> v1.1 改动：修正 v1「多签 consume = 原子放款」的正确性漏洞 → 引入**托管人（custodian）**分离授权与结算（§3.2）；补**已知局限**（数字商品防扩散不可根治，§3.7）；补**发现层**载体（§2.6）；补 **Sybil 抗性**（硬件 DID）与托管人作恶威胁（§7）；明确 **v1 范围界定**（§8.0）；密钥卫生改用独立 keyAgreement 密钥（§3.6）
> 范围：去中心化交易子系统的统一资产模型 + 知识资产（`delivery_adapter=encrypted-data`）端到端加密交付与 AI 撮合
> 关联文档：`modules/03_交易辅助模块.md`、`modules/54_跨链互操作协议.md`、`MofN_多签_应用扩展_v1.md`、`MTC_跨链桥_v1.md`
> 关联代码：`desktop-app-vue/src/main/trade/*`、`packages/core-multisig/`、`packages/cli/src/lib/cross-chain*.js`

---

## 0. 文档定位

去中心化交易此前的状态是「设计满分、落地割裂」：桌面端有一套真实但不完整的交易栈（assets/orders/transactions/escrow），CLI 端有扎实的多签与跨链记账，两者**互不相通**；智能合约写好但未审计、无真链交互。

本文不追求「真链上 DEX/跨链桥」（那是审计 + KYC + 合规的无底洞，且与 Uniswap/LayerZero 正面竞争劣势打优势）。本文押注**项目真正的差异化**：以 **DID 身份 + M-of-N 多签 + MTC 跨联邦结算 + 个人 AI** 为护城河的**知识/数据/服务点对点可信交易**，把「链」降级为可选结算适配器（链下治理 + 链上结算）。

四类资产共用一套模型，本文重点钻**最契合、零外部阻塞、最快见价值的一类——知识资产的加密交付**。

**面向未来的前提（§10）**：人人将有自己的个人 AI，个人 AI 之间会交流、也会交易。故 §1–9 的资产/交付/结算栈被设计为「**人本市场**」与「**AI 主体经济**」的**共同底座**——§10 把交易主体从人升级为带授权书（mandate）的个人 AI agent，但**关键决策始终由人参与**（用 multisig 阈值编码）。读 §10 前先读 §1–9 的内核。

---

## 1. 现状对账（实读代码确认，非文档推测）

### 1.1 已有交易栈（`desktop-app-vue/src/main/trade/`，全在 SQLCipher 加密主库）

| 本文模型实体 | 现有真表 | 定义文件 | 现状 |
|---|---|---|---|
| AssetRef | `assets` + `asset_holdings` | asset-manager.js | ✅ 已存在，**已含 4 类 kind** |
| Listing | `orders` + `orders_fts` | marketplace-manager.js | ✅ 已存在 |
| Order | `transactions` | marketplace-manager.js | ✅ 已存在 |
| Escrow | `escrows` + `escrow_history` | escrow-manager.js | ✅ 已存在，含状态机 |
| 履约合约 | `contracts` | contract-engine.js | ✅ 已存在 |
| Review | `reviews` + 回复表 | review-manager.js | ✅ 已存在 |
| 链上镜像 | `blockchain_wallets/assets/transactions/deployed_contracts/bridge_transfers` | database/database-schema.js | ✅ 已存在（本地↔链 FK 映射）|
| DeliveryReceipt | — | — | ❌ 真缺口 |
| Dispute / Arbitration | — | — | ❌ 仅设计文档，零代码 |
| Reputation | — | 仅论坛 `user.reputation` 列 | ❌ 交易侧无表 |

**关键事实**：`asset-manager.js` 已定义 `AssetType = { TOKEN, NFT, KNOWLEDGE, SERVICE }`——与本设计选定的四类资产**一字不差**。统一资产模型**不是从零新建，而是补全一个已存在的雏形**。

### 1.2 CLI 多签 / 跨链栈（独立 SQLite，独立进程）

| 表 | 文件 | 现状 |
|---|---|---|
| `multisig_proposals` / `multisig_signatures` / `multisig_policies` | core-multisig/lib/schema.js | ✅ 完整状态机（pending→reached→consumed），81 测试 |
| `cc_bridges`（含 `multisig_proposal_id`/`partial_sigs_json`）/ `cc_swaps`（HTLC）/ `cc_messages` | cli/src/lib/cross-chain.js | ✅ 记账实装，❌ 0 真 RPC |

### 1.3 最大架构缺口：两栈物理隔离

```
桌面栈（in-process，SQLCipher 主库）              CLI 栈（独立 SQLite，独立进程）
─────────────────────────────────              ─────────────────────────────
assets / orders / transactions      ✗ 无连接    multisig_proposals/signatures/policies
escrows / contracts / reviews       ←──断──→    cc_bridges / cc_swaps / cc_messages
blockchain_*（链上镜像）
```

- 桌面 escrow 是**简单的本地状态翻转，没有 M-of-N 多签**。
- CLI 的 `core-multisig`（成熟、81 测试）**不知道 transactions/escrows 存在**。
- 「让 `transactions.settlement_ref` 绑定 `multisig_proposal_id`，使 funded→settled 镜像多签状态机」这个接缝**当前物理上不存在**。打通它是统一资产模型落地的承重墙（见 §6）。

### 1.4 对账结论

1. 统一资产模型 **~80% 已存在**，要做的是「补全 + 加密码学确权层」，不是新建。
2. 真正要新建的只有三样：① assets/transactions 上的**确权+签名列**；② **Dispute/Arbitration** 表；③ **桌面交易栈 ↔ CLI 多签栈的结算接缝**。
3. 现有最成熟：escrow + reviews + 链上镜像。最不成熟：争议仲裁（零代码）、多签结算集成（两栈隔离）。

---

## 2. 统一资产模型

### 2.1 分层架构

```
┌─ L4  AI 层：撮合 / 定价 / 协商 / listing 生成 / 验收 / 仲裁辅助
├─ L3  结算层（可插拔）：multisig 托管 │ MTC envelope 跨联邦 │ 真链 adapter（可选，默认关）
├─ L2  交易内核：Listing / Order / Escrow / Dispute / Reputation（资产无关）
├─ L1  资产层：AssetRef（统一确权）+ 四个 DeliveryAdapter
└─ L0  身份层：DID + 硬件密钥（已有，最强护城河）
```

L0/L3 已有真实组件（DID×MTC 的 JCS+Ed25519、core-multisig）。要新建的集中在 **L1 确权层 + L2 的 Dispute + L4 的 AI**。链（真 RPC）只是 L3 的一个 adapter，**默认关闭，不阻塞任何主线**。

### 2.2 三实体边界（避免「资产/报价/订单」混表）

```
AssetRef =「这是什么 + 谁担保」    —— 资源型，持久，可复用，被 DID 签名
Listing  =「以什么价/什么条款卖」  —— 报价型，相对短命，挂 AssetRef
Order    =「一笔成交的全生命周期」  —— 事务型，状态机主战场
```

**价格不进 AssetRef**：AssetRef 签的是不可变的「内容承诺 + 交付方式 + 卖方 DID」；价格/条款属 Listing，可随行就市改而不破坏签名。这条划清楚，AssetRef 才能跨多个 Listing、多次转售而签名长期有效。

### 2.3 AssetRef → 复用 `assets` 表 + 补 7 列（不新建表）

现有 `assets`：`id, asset_type, name, symbol, description, metadata, creator_did, total_supply, decimals, created_at`

| 模型字段 | 现状 | 动作 |
|---|---|---|
| `asset_kind` | ✅ = `asset_type`（token/nft/knowledge/service）| 复用 |
| `owner_did` | ✅ = `creator_did` | 复用 |
| `quantity_total` | ✅ = `total_supply` | 复用 |
| `content_commitment` + `commitment_algo` | ❌（现塞 metadata json）| **新增 2 列**（确权核）|
| `delivery_adapter` + `delivery_spec` | ❌（现塞 metadata json）| **新增 2 列**（履约契约）|
| `owner_signature` + `signed_fields` | ❌ | **新增 2 列**（DID 背书）|
| `status` 生命周期 | ❌（assets 无 status 列）| **新增 1 列** |

`delivery_spec`（JSON，adapter 专属，本质是把现有 metadata 的隐式字段显式化）：

```jsonc
// knowledge:
{ "ipfs_cid": "...", "enc": "aes-256-gcm", "chunk_size": 1048576,
  "key_release": "multisig", "merkle_algo": "sha256", "preview_cid": "..." }
// service:
{ "skill_id": "...", "params_schema": {...}, "acceptance_criteria": "...", "max_runtime_s": 600 }
// token / nft:
{ "chain_id": 11155111, "contract": "0x...", "token_id": "...", "transfer_kind": "erc20|erc721|htlc" }
// physical:
{ "shipping_terms": "...", "evidence_checklist": [...], "inspection_window_d": 7 }
```

### 2.4 Listing / Order 字段 delta

- **Listing（复用 `orders`）补**：`settlement_policy`（走哪个 L3 + 阈值 + 超时）、`ai_meta`（L4 摘要/质量分/建议价，**advisory**）。`pricing_mode` 靠现有 `order_type` 表达。
- **Order（复用 `transactions`）补**：`settlement_kind` + `settlement_ref`（接 multisig 的关键；现有 `escrow_id` 是其特例）、`agreed_terms_hash` + `buyer_signature` + `seller_signature`（成交合意密码学证据）、`state_history`（append-only 迁移审计链，复用 MTC OpLog per-row 模式）。

### 2.5 四类资产共用一套 Order 状态机（抽象成立性证明）

主干：`created →[协商]→ agreed → funded → delivered → accepted → settled → closed`

差异 100% 收纳在 `delivery_adapter`（怎么交付）+ `settlement_kind`（怎么结算）两个维度，状态机本身对资产类型无感知：

| 迁移 | 知识/数据 | AI 服务 | Token/NFT | 实物 |
|---|---|---|---|---|
| funded | 多签押款 | escrow 押款 | 买家发币入 HTLC | escrow 押款 |
| delivered | 释放包裹密钥 | agent 执行→输出哈希 | 卖家转 token(tx) | 物流证据上传 |
| accepted | 解密+承诺校验/AI 验收 | **AI judge 验收→自动放款** | 链确认(自动) | 买家签收/超时 |
| settled | 多签释放 | 多签释放 | 原子(HTLC 塌缩 fund+deliver+settle) | 多签释放 |
| 争议权重 | 低（多为客观可验）| 中 | 极低 | **高**（主战场）|

Token/NFT 经 HTLC 原子塌缩为一步 `agreed→settled`（接已有 `cc_swaps`），是「主干的塌缩投影」而非特例。**抽象成立**。

### 2.6 发现层：AssetRef 目录在哪、跨节点怎么同步

§3 的「发现/撮合」依赖一个可搜索的 AssetRef 目录——必须明确它的载体（否则 P2P 下买方根本看不到卖方的货）：

- **发布物 = AssetRef 的签名元数据（绝非密文 `C`）**：`{asset_id, owner_did, kind, title, tags, content_commitment, preview_cid, delivery_spec 的公开子集, owner_signature}`。因自带签名，**任何中继可无信任托管/转发**（篡改即验签失败）。
- **载体（复用现有设施，不新建网络）**：① 同联邦内经 **libp2p gossip / 社交-论坛索引**（桌面已有 P2P + forum）广播；② 本地 catalog 缓存（买方侧 SQLite，订阅式增量）；③ 可选 **IPFS/IPNS** 作冷目录。
- **撮合在本地缓存上跑**：买方的语义检索/AI 重排作用于本地 catalog（隐私：查询不外泄）。密文 `C` 始终只在 IPFS、按需在成交后才取。
- **下架/撤销传播**：AssetRef `status=retired/revoked` 经同一 gossip 广播；买方 catalog 据 `updated_at` 收敛（最终一致）。

---

## 3. 知识资产加密交付 — 端到端流程（本文重点）

### 3.1 履约适配器：`delivery_adapter = encrypted-data`

卖的是 RAG 语料 / 知识包 / prompt 集 / 数据集。核心矛盾：**数字商品可无限复制**——「先付款还是先看货」无法两全。本设计的密码学骨架：

- 内容用随机内容密钥 `CK`（AES-256-GCM）加密 → 密文 `C`，密文上 IPFS（`helia`，桌面已集成）得 `CID`。
- `content_commitment = merkleRoot(C 的分块)`，由卖方 DID 签名（成交前即公开，不可抵赖）。
- 成交时 `CK` 用买方 keyAgreement 公钥包裹（ECIES）→ `wrapped_CK`；`key_commitment = SHA256(CK)` 写入多签提案 payload（卖方不能事后换密钥）。
- 交付 = **托管人在 consume 时**把 `wrapped_CK` 释放给买方、同步把货款付给卖方（多签只授权、托管人执行，见 §3.2）。

### 3.2 公平交换难题、托管人与本设计的取舍（必须诚实面对）

**理论事实**：无可信第三方（TTP）的「数字商品 ↔ 货币」完全公平交换是**不可能的**（fair-exchange impossibility）。任何方案都须一个被最小化的托管/仲裁人或经济均衡兜底。

**关键澄清（修正 v1 早期表述的正确性漏洞）**：多签（multisig）是**授权层**，记录「谁同意了」（买方已付款、卖方已交付、双方/仲裁签了释放）；它**不持有货款、也不持有密钥**，所以**多签 consume 本身并不等于原子放款**。原子性由一个**托管人（escrow custodian）**提供——它同时托管 ① 买方押的货款、② 卖方提交的 `wrapped_CK`，在释放提案达阈（consume）时于**同一动作**里把货款给卖方、把 `wrapped_CK` 给买方。

- **`wrapped_CK` 必须由托管人持有、consume 时才释放**，绝不能预先放进共享提案——否则它虽用买方公钥加密、买方仍可提前取走解密，等于未付款先得货（这正是 v1 早期表述的漏洞）。
- 托管人对内容**盲**：`wrapped_CK` 用买方 keyAgreement 公钥加密、货款只是 credits，托管人既看不到 `CK` 也看不到明文。
- **托管人候选**（按去中心化程度）：① **联邦/MTC 结算节点**（中立，跨节点首选）；② **2-of-3 里的仲裁人节点**兼任盲托管；③ 同节点共享账本（非 P2P，trivial）。
- **诚实结论：2-of-2 纯买卖双方对数字商品无法做到原子公平交换**（无链、无托管人时持有方总能作弊）。故知识交付**默认 2-of-3**（买+卖+仲裁/联邦节点兼托管）；2-of-2 仅一方可信或低价值+信誉兜底时用。托管人是被最小化、去中心化（m-of-n 可轮换）的轻量 TTP。

托管框架之上叠加两道保护：

1. **客观故障用密码学自动判定，不进人工仲裁**：
   - 密钥错（`SHA256(解开的 CK) ≠ key_commitment`）→ 买方持密码学证据，托管人**自动退款**。
   - 密文被篡改（IPFS 取回的 `C` 的 merkleRoot ≠ 签名的 `content_commitment`）→ 同上。
2. **主观「与描述不符」→ 去中心仲裁池（m-of-n）裁决**，托管人据裁决执行 refund/release/split；买方公开已购明文作证据，发起争议须**质押**（防「拿货+假退款」）。

**两种放款时序（`settlement_policy` 可选）**：
- **Option X（默认，原子）**：consume 时托管人同步「释放密钥 + 付款卖方」，无检查期；买方保护 = 成交前（签名 `content_commitment` + 预览 + AI 质量分 + 卖方信誉）+ 客观故障自动退款。
- **Option Y（检查期）**：consume 只释放密钥给买方，货款在托管人处暂挂 `inspection_window`，超时/确认→付卖方、争议→仲裁；买方保护更强但须质押防 grief。

> 一句话：**多签授权、托管人结算**；客观故障靠密码学自动退款，主观质量靠成交前保护 + 仲裁兜底。

### 3.3 六阶段端到端时序

**A. 上架（Publish）** — 卖方
1. 选知识包（文件 / RAG 语料导出 / prompt 集）。
2. 客户端生成 `CK`（随机 AES-256）。
3. 加密 → 密文 `C`；计算 `MR = merkleRoot(C 分块)`。
4. `C` 上 IPFS → `CID`；可选生成脱敏预览样本 → `preview_cid`。
5. 组装 AssetRef：`kind=knowledge`、`content_commitment=MR`、`commitment_algo=merkle-sha256`、`delivery_adapter=encrypted-data`、`delivery_spec={ipfs_cid, enc, chunk_size, key_release:"multisig", preview_cid}`。
6. 卖方对 `signed_fields = {owner_did, content_commitment, delivery_adapter, delivery_spec}` 做 **JCS 规范化 + Ed25519 签名** → `owner_signature`。AssetRef `status=active`。
7. **AI（L4）** 据卖方摘要 + 预览样本（**非全文明文**）生成 listing 摘要/标签/质量分/建议价；卖方审阅后创建 Listing。

**B. 发现 / 撮合（Discover / Match）** — 买方
8. 买方自然语言查询 → 向量化 → 在已发布 AssetRef 的元数据+预览嵌入上语义检索（复用桌面 `rag/` 混合检索）→ **AI 重排 + 给出「为何匹配你的需求」理由**。
9. 买方查看 listing + 预览样本 + AI 质量分 + **provenance（卖方 DID + `owner_signature` 本地验签通过）**。

**C. 议价 / 成交（Negotiate / Agree）** — 双方
10. 买方发起 Order（`created`）。`negotiable` 时可走 **AI 议价助手**协商价/条款。
11. 双方就条款达成一致 → 计算 `agreed_terms_hash` → 买卖双方各自 Ed25519 签名 → Order `agreed`。

**D. 锁款（Fund / Escrow）**
12. 创建多签提案：`domain=marketplace.knowledge.delivery`，**知识交付默认 2-of-3**（买+卖+仲裁/联邦托管节点；2-of-2 仅低价值+信誉兜底）。payload = `{order_id, asset_id, amount, buyer_did, seller_did, key_commitment, content_commitment}`。
13. 买方将货款（credits）押入**托管人**。Order `funded`。
14. 卖方用买方 keyAgreement 公钥包裹 `CK` → `wrapped_CK`（`key_commitment` 已在 payload，卖方不能换密钥）；把 `wrapped_CK` **交托管人保管**（不进共享提案，consume 前买方不可见）。

**E. 交付（Deliver）— 原子点（由托管人执行）**
15. 双方对「释放」签名（买方确认收货意愿、卖方确认交付）→ 多签阈值达到 → **托管人在 consume 时原子执行**：把 `wrapped_CK` 给买方、把货款付给卖方。
16. 买方：从 IPFS 按 `CID` 取 `C`；用 DID 私钥解 `wrapped_CK` 得 `CK`；先验 `SHA256(CK)==key_commitment`（密钥客观校验）；解密 `C` 得明文；验 `merkleRoot(C)==content_commitment`（密文客观校验）。生成 **DeliveryReceipt**（含两项校验结果）。

**F. 验收 / 结算（Accept / Settle）**
17. **AI judge（L4）** 据 DeliveryReceipt + listing 声明做验收评估（可配自动接受）。
18. 客观校验通过（或买方确认 / 超时自动接受）→ Order `settled → closed`；更新双方 Review/信誉。
19. 仅「主观质量不符」→ 买方开 Dispute（公开明文作证）→ 仲裁员池裁决。客观故障（步 16 任一校验失败）→ **凭密码学证据自动退款，不进人工仲裁**。

### 3.4 时序图

```
卖方(Seller)        买方(Buyer)        AI(L4)        IPFS         Multisig(L3)        仲裁池
   │                   │                 │            │              │                 │
A  ├─加密CK→C,MR───────┼─────────────────┼──上传C─────▶│              │                 │
   ├─签名AssetRef──────┼──生成listing────▶│            │              │                 │
   │                   │   摘要/质量/价   │            │              │                 │
B  │                   ├─NL查询──────────▶│            │              │                 │
   │                   │◀─语义撮合+重排+验签            │              │                 │
C  │◀──────议价(可选AI)──────────▶        │            │              │                 │
   ├─双方签 agreed_terms_hash──────────────┼────────────┼──────────────┼────────────────┤
D  │                   ├─押货款───────────┼────────────┼─────funded──▶│                 │
   ├─wrapped_CK(含key_commitment)──────────┼────────────┼─────提交────▶│                 │
E  ├──────双方签"释放"─────────────────────┼────────────┼──阈值达到────┤                 │
   │                   │◀═原子: wrapped_CK ┼════货款释放给卖方═════════▶│                 │
   │                   ├─取C◀─────────────┼────────────│              │                 │
   │                   ├─解CK,验key_commitment & merkleRoot           │                 │
F  │                   ├─DeliveryReceipt─▶│ AI验收      │              │                 │
   │                   │◀─自动接受/超时──▶ settled                    │                 │
   │                   ├─(主观不符)开Dispute──────────────────────────┼──裁决─▶ refund/release/split
   │                   ├─(客观校验失败)─凭证自动退款（不进仲裁）        │                 │
```
> 注：图中「Multisig(L3)」是**授权层**（记录谁签了），步 E 的「原子: wrapped_CK + 货款」实际由**托管人**执行（联邦节点 / 2-of-3 仲裁人，§3.2）；为版面未单列托管人泳道。`wrapped_CK` 由托管人保管、consume 时才释放，不经此图的卖方→提案直传。

### 3.5 知识交付专属状态机（双闸托管视角）

```
agreed ──买方押款入托管人──▶ funded ──卖方交wrapped_CK给托管人──▶ key_escrowed
                                                      │
                                          双方签"释放"(阈值达到)
                                                      ▼
                            ┌──────────────── delivered ────────────────┐
                            │  (买方取C/解CK/验key_commitment & merkleRoot) │
                客观校验失败 │                                            │ 客观校验通过
              （密码学证据） ▼                                            ▼
                      auto_refunded                          accepted（AI/买方/超时）
                       (不进仲裁)                                        │
                                                                        ▼
              主观"与描述不符" → disputed → arbitration → refund|release|split   settled ──▶ closed
```

- 默认 **Option X**：consume 时**托管人**同步「释放密钥 + 付款卖方」（多签授权、托管人执行，见 §3.2），无检查期；`accepted` 是验收记录而非放款闸。
- 可选 **Option Y**（`settlement_policy.inspection_window_d>0`）：consume 只释放密钥，付款进 `inspection` 子态暂挂，超时/确认→release，争议→arbitration；买方开争议须质押。

### 3.6 密钥与密码学细节

| 项 | 方案 |
|---|---|
| 内容加密 | AES-256-GCM，随机 96-bit nonce，分块（默认 1 MiB），每块独立 GCM tag |
| 完整性承诺 | `content_commitment = merkleRoot(SHA256(每块密文))`，支持流式/分块校验与 IPFS 防篡改 |
| 明文绑定（精确论证）| `content_commitment`（钉死密文 `C`）+ `key_commitment`（钉死 `CK`）**联合唯一确定明文**：GCM 给定 `C`+`CK`+nonce 解出唯一明文且 tag 防篡改。故两承诺保证「买方拿到的就是卖方密码学承诺的字节」——但**不保证字节质量好**（质量属主观争议，见 §3.7）|
| 密钥包裹 | ECIES：买方 **专用 keyAgreement 公钥（X25519）** 做 ECDH → HKDF → 包裹 `CK`。**安全卫生：用 DID 文档独立的 `keyAgreement` 密钥，不复用 Ed25519 身份签名密钥**（签名/加密同密钥有跨协议攻击面；仅在缺 keyAgreement 项时才回退到 Ed25519→X25519 birational 派生）|
| 防换密钥 | `key_commitment = SHA256(CK)` 写入多签 payload，成交前固定；买方解出 `CK` 后即可客观验 |
| 成交合意签名 | `agreed_terms_hash = SHA256(JCS({order_id, asset_id, amount, terms, buyer_did, seller_did}))`，买卖双签 |
| 确权签名 | 复用 MTC 那套 JCS + Ed25519（`packages/core-mtc` / DID 模块），买方可独立验「卖方 DID 真为此内容承诺背书」 |
| 审计链 | `state_history` append-only，每次迁移记 `{from,to,actor_did,reason,sig,ts}`，争议时整条链可密码学复核 |

### 3.7 已知局限（不可回避，必须明示）

1. **加密 ≠ 防扩散（数字商品的根本局限）**：加密只解决「交付前不付款拿不到」，**解决不了「第一个买家拿到明文后无限复制/转卖/泄露」**。密码学无法阻止已揭示数据被复制——任何宣称「加密 = 防盗版」的说法都是错的。本设计的应对（缓解非根治）：
   - **每买家水印/指纹**：交付副本嵌入与 `buyer_did` 绑定的不可见指纹（文本改写/零宽字符/数据集行级扰动），泄露副本可溯源到泄露者 → 信誉惩罚 + 取证。
   - **许可条款 + 信誉威慑**：listing 声明使用许可；违约扣信誉、可被卖家拉黑。
   - **商业建模**：把知识资产卖成「访问权 / 首发 / 订阅更新」而非「一次性买断可转售」，降低转售动机。
   - 明确**不做 DRM**（与去中心化、用户主权相悖）。多份销售（`quantity>1`）对同一密文是「首售即可泄露」的，定价须把这点计入。
2. **预览/嵌入是受控泄露**：卖方自愿发布的嵌入向量可被 embedding-inversion 部分重建文本，属可控信息泄露；卖方自选粒度，平台须提示风险。
3. **托管人非零信任**：托管人虽对内容盲、且 m-of-n 可轮换，但仍是被最小化的 TTP；纯零信任只有真链能给（P6 可选）。

---

## 4. AI 撮合与五个介入点（L4）

复用桌面已有的 cowork/agent 引擎、`rag/` 混合检索、LLM judge。

| # | 介入点 | 输入 | 输出 | 性质 |
|---|---|---|---|---|
| 1 | **上架·listing 生成** | 卖方摘要 + 预览样本（**非全文**）| 标题/摘要/标签/质量分/建议价 | advisory，卖方可改 |
| 2 | **发现·语义撮合** | 买方 NL 需求 → 嵌入 | 候选 AssetRef 重排 + 「为何匹配」理由 | 排序辅助 |
| 3 | **议价** | 双方报价/条款 | 折中建议 | 仅建议，成交须人确认（防 AI 自动花钱）|
| 4 | **验收·自动放款** | DeliveryReceipt + listing 声明 | pass/fail/flag → 触发 accepted | 仅 Option Y / 服务类自动放款；知识类 Option X 下为验收记录 |
| 5 | **仲裁辅助** | 争议证据 + 公开明文 | 非约束性裁决建议 | 喂仲裁员，不自动执行 |

### 4.6 隐私边界（关键约束）

**AI 在成交前绝不接触全文明文**——否则等于免费泄露商品。AI 撮合只在以下数据上工作：
- 卖方主动提供的元数据 + 摘要
- 免费预览样本（`preview_cid`，卖方脱敏选段）
- 卖方主动发布的嵌入向量（可来自全文但不可逆，卖方自愿）

全文密文 `C` 始终加密，AI 与平台均不持 `CK`。仅在「主观争议」阶段，**买方自愿公开已购明文**作为证据时，AI 仲裁辅助才看到内容。

---

## 5. 数据模型变更清单（DDL delta，相对现有表）

```sql
-- AssetRef：扩展现有 assets 表（asset-manager.js）
ALTER TABLE assets ADD COLUMN content_commitment TEXT;     -- merkle root / chain-ref / spec-hash
ALTER TABLE assets ADD COLUMN commitment_algo   TEXT;       -- merkle-sha256 | chain-ref | spec-hash
ALTER TABLE assets ADD COLUMN delivery_adapter  TEXT;       -- encrypted-data | service-exec | onchain-transfer | physical-evidence
ALTER TABLE assets ADD COLUMN delivery_spec     TEXT;       -- JSON，adapter 专属
ALTER TABLE assets ADD COLUMN signed_fields     TEXT;       -- JSON，明确签了哪些字段
ALTER TABLE assets ADD COLUMN owner_signature   TEXT;       -- Ed25519 over JCS(signed_fields)
ALTER TABLE assets ADD COLUMN status            TEXT DEFAULT 'active';  -- draft|active|paused|retired|revoked

-- Listing：扩展现有 orders 表（marketplace-manager.js）
ALTER TABLE orders ADD COLUMN settlement_policy TEXT;       -- JSON {kind, threshold_m, threshold_n, inspection_window_d, arbitration}
ALTER TABLE orders ADD COLUMN ai_meta           TEXT;       -- JSON {summary, quality_score, suggested_price}

-- Order：扩展现有 transactions 表（marketplace-manager.js）
ALTER TABLE transactions ADD COLUMN settlement_kind   TEXT; -- instant|escrow-multisig|mtc-envelope|onchain
ALTER TABLE transactions ADD COLUMN settlement_ref    TEXT; -- multisig_proposal_id | mtc envelope id | chain tx hash
ALTER TABLE transactions ADD COLUMN agreed_terms_hash TEXT;
ALTER TABLE transactions ADD COLUMN buyer_signature   TEXT;
ALTER TABLE transactions ADD COLUMN seller_signature  TEXT;
ALTER TABLE transactions ADD COLUMN state_history     TEXT; -- JSON[] append-only

-- Escrow 托管：扩展现有 escrows 表（escrow-manager.js），承接 §3.2 托管人模型
ALTER TABLE escrows ADD COLUMN custodian_did    TEXT;       -- 托管人 DID（联邦节点 / 2-of-3 仲裁人）
ALTER TABLE escrows ADD COLUMN settlement_ref   TEXT;       -- 绑定 multisig_proposals.id（释放授权来源）
ALTER TABLE escrows ADD COLUMN held_wrapped_key TEXT;       -- 托管人保管的 wrapped_CK（买方公钥加密，托管人盲存；consume 前不给买方）
ALTER TABLE escrows ADD COLUMN inspection_until INTEGER;    -- Option Y 检查期截止（NULL=Option X 原子）

-- DeliveryReceipt：新表
CREATE TABLE IF NOT EXISTS delivery_receipts (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  delivery_adapter TEXT NOT NULL,
  key_check       TEXT,            -- pass|fail（SHA256(CK)==key_commitment）
  content_check   TEXT,            -- pass|fail（merkleRoot(C)==content_commitment）
  ai_verdict      TEXT,            -- pass|fail|flag（L4 验收）
  proof           TEXT,            -- JSON，adapter 专属证据
  created_at      INTEGER NOT NULL
);

-- Dispute / Arbitration：新表（设计有、代码无的缺口）
CREATE TABLE IF NOT EXISTS disputes (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,
  opened_by_did TEXT NOT NULL,
  reason_code   TEXT NOT NULL,     -- objective-key|objective-content|not-as-described|...
  claim         TEXT,
  evidence      TEXT,              -- JSON，证据哈希列表
  stake_amount  INTEGER DEFAULT 0, -- 防滥用质押
  arbitrators   TEXT,              -- JSON，仲裁员 DID 列表
  ai_assessment TEXT,              -- 非约束性
  resolution    TEXT,              -- refund_buyer|release_seller|split
  status        TEXT NOT NULL DEFAULT 'opened',  -- opened|evidence|ai_review|arbitration|resolved
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER
);

-- Reputation：新表（交易侧；与论坛 reputation 解耦或后续聚合）
CREATE TABLE IF NOT EXISTS reputation_scores (
  did            TEXT PRIMARY KEY,
  trades_count   INTEGER DEFAULT 0,
  disputes_count INTEGER DEFAULT 0,
  dispute_lost   INTEGER DEFAULT 0,
  avg_rating     REAL DEFAULT 0,
  score          REAL DEFAULT 0,   -- 综合分
  updated_at     INTEGER NOT NULL
);
```

---

## 6. 结算接缝：桌面交易栈 ↔ CLI 多签栈（承重墙）

`transactions.settlement_ref → multisig_proposals.id`，让 Order 的 `funded→settled` 成为多签 `pending→reached→consumed` 的投影。物理隔离的三种打通方案：

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A. 引库**（推荐） | 桌面主进程直接 `require('@chainlesschain/core-multisig')`，多签状态写桌面 SQLCipher 主库（统一库、统一事务）| 单库一致性强；**已实跑验证可行**（见 §6.1）|
| B. 子进程桥 | 桌面 spawn `cc multisig` 子进程，经 stdout JSON 交互 | 复用 CLI 全部命令，但跨进程跨库，最终一致性、易碎 |
| C. 共享库文件 | 两进程指同一 SQLite 文件 | better-sqlite3 文件锁竞争，不推荐 |

**建议方案 A**：把 `core-multisig` 作为库引入桌面主进程，多签表并入主库；`escrow-manager` 的「本地状态翻转」升级为「多签 consume 驱动」。`MofN_多签_应用扩展_v1.md` 已定义 `marketplace.purchase` domain，本设计加 `marketplace.knowledge.delivery` domain（**默认 2-of-3 含托管人**，见 §3.2）。**注**：多签是授权层，**真正的货款/密钥托管由 escrow 托管人持有**（§3.2）；§6.1 验证的是「授权状态机能在桌面库跑」，托管人结算逻辑（held_wrapped_key 释放 + 货款过账）是 P1 在 escrow-manager 上新建的部分。

#### 6.1 方案 A 可行性验证（已实跑，✅ 15/15 通过）

用桌面主进程**同款驱动** `better-sqlite3-multiple-ciphers` + 真 SQLCipher 加密 key + 文件库，跑本文 `marketplace.knowledge.delivery` 2-of-3 场景的完整周期，结论：

- ✅ `applySchema`（DDL）在 bs3mc 上干净运行 → multisig 三表建成（core-multisig 设计上 DB 驱动无关：store.js/schema.js 注释明示兼容 better-sqlite3 + sql.js，单测用 sql.js，生产可直传 bs3mc）。
- ✅ `createStore` / `createProposalsManager` 直接吃 bs3mc 句柄。
- ✅ 完整周期：buyer propose → pending（含发起人签名持久化）→ seller sign → **2-of-3 reached** → finalize → **consumed**；double-finalize 被拒（无重复结算）。
- ✅ 跨连接持久化：关库重开（SQLCipher key）→ 提案 + 2 个签名仍在、状态 consumed；错误 key 被拒（数据确实加密）。
- ✅ 依赖 `@chainlesschain/core-mtc`、`canonicalize`、`@noble/curves`、`@noble/post-quantum` 均可从主进程解析。

**唯一剩余前提**：验证在 Node ABI 127 下跑；桌面是 Electron ABI 140。但 core-multisig 是**纯 JS（ABI 无关）**，唯一 ABI 相关的是 bs3mc native binding，而**桌面已自带 electron-rebuild 过的 bs3mc**（`desktop-app-vue/node_modules/better-sqlite3-multiple-ciphers`，app 已在用）。故承重墙打通无技术障碍——P1 可直接进实现。

跨联邦交易（买卖双方在不同节点/联邦）时，settlement_kind 升级为 `mtc-envelope`，settlement_ref 指向 MTC envelope，复用 `MTC_跨链桥_v1.md` 的 m-of-n envelope 签名（**零真链依赖**）。

---

## 7. 安全与信任分析

| 威胁 | 缓解 |
|---|---|
| 卖方上架后换密钥/换内容 | `content_commitment` + `key_commitment` 成交前签名固定，联合钉死明文；买方客观可验 |
| 卖方收钱不交付 | **托管人**在 consume 时同步「付款卖方 ⟺ 给买方密钥」，单边作弊不成立（§3.2）|
| 买方拿货后假退款骗钱 | 默认 Option X（付款即释放，明文不可收回）；Option Y 下买方须质押 |
| **托管人作恶/被控（新）** | 托管人对内容盲（`wrapped_CK` 加密 + 货款仅 credits）；m-of-n 可轮换；高价值用联邦节点而非单点；纯零信任须 P6 真链 |
| 平台/AI 偷看商品 | 全文密文，平台/AI 不持 `CK`；AI 只见元数据+预览+自愿嵌入 |
| 冒名顶替卖方 | AssetRef `owner_signature`（DID 背书），买方本地验签 |
| **Sybil：坏信誉换 DID 洗白（新）** | 卖家/仲裁人**要求硬件绑定 DID（U-Key/SIMKey）**抬高身份成本；信誉按身份保证等级加权；软件 did:key 仅限低价值 |
| **买方转售/泄露已购明文（新）** | 密码学不可根治（§3.7）；缓解=每买家水印溯源 + 许可条款 + 信誉威慑 + 「访问权/订阅」商业建模 |
| 仲裁员合谋 | m-of-n 去中心仲裁池；裁决记 `state_history` 可审计；要求硬件 DID 抬高合谋成本 |
| IPFS 内容丢失/被篡改 | merkleRoot 校验 + 可选 pin/冗余；密文不可读不构成泄露 |
| 跨联邦结算抵赖 | MTC envelope m-of-n 签名 + landmark 分发，密码学不可抵赖 |

**信任根**：DID + 硬件密钥（U-Key/SIMKey）是签名与解密私钥的归宿、也是 Sybil 抗性的来源，承接整个交易的密码学信任与身份成本。

---

## 8. 分期落地路线

### 8.0 v1 范围界定（明确边界，防 P1 实现无从下手）

| 维度 | **v1 之内** | v1 之外（后续/可选）|
|---|---|---|
| 资产类 | 仅 knowledge（`encrypted-data`）| service/token/physical |
| 网络 | **单联邦内**交易 | 跨联邦原子结算（P6）|
| 货币 | **内部 credits**（纯记账账本，零链依赖）| 稳定币 / ChainlessToken / 真链 |
| 托管 | 托管人 = 联邦节点 **或** 2-of-3 仲裁人；Option X 默认 | 真链托管 / 跨联邦托管 |
| 防扩散 | 许可条款 + 信誉威慑（水印延后）| 每买家水印溯源、DRM（不做）|

> v1 是「单联邦 + credits + 托管人 escrow + 知识交付」的最小可信闭环，**完全不碰真链审计/KYC/合规**。

| 期 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| **P1 结算接缝** | 方案 A 引 core-multisig 入桌面主库；escrow-manager 升级为**托管人驱动**（多签授权 + held_wrapped_key 释放 + credits 过账）；加 `marketplace.knowledge.delivery` domain | core-multisig（已有，§6.1 验证）| transactions.settlement_ref 绑定 multisig；consume 时托管人原子「释放 wrapped_CK + 付款」 |
| **P2 确权层** | assets/transactions 加签名列；AssetRef 的 JCS+Ed25519 签名/验签；orders 加 settlement_policy | DID 模块（已有）| 买方能本地验「卖方为内容承诺背书」 |
| **P3 加密交付管线** | CK 加密 + IPFS 上传 + merkleRoot + ECIES 包裹 + key_commitment + DeliveryReceipt | helia（已有）| 知识包端到端：上架→锁款→原子释放密钥→解密→客观校验 |
| **P4 AI 撮合** | listing 生成 + 语义撮合重排 + 验收 judge（隐私边界）| rag/ + cowork（已有）| NL 查询撮合 + AI 质量分 + 自动验收 |
| **P5 争议仲裁** | disputes/reputation 表 + 仲裁员池 m-of-n + AI 仲裁辅助 | P1 多签 | 客观故障自动退款 + 主观争议仲裁裁决 |
| **P6（可选）跨联邦/真链** | settlement_kind=mtc-envelope（Phase 4b）；onchain adapter（testnet，可选）| MTC（部分有）| 跨节点交易可信结算，链为可选项 |

#### 8.1 A2A 经济阶段轨（§10，建立在 P1–P5 之上）

> 前提：A2A 复用 P1–P5 的资产/escrow/multisig 内核。先有"人本市场"，再让"AI 当主体"。每期同样零外部阻塞。

| 期 | 内容 | 复用/新建 | 验收 |
|---|---|---|---|
| **PA1 授权 + 花费闸** | `agent-mandate-manager`（scope+预算 claims+委托链）+ `autonomous-spending-guardian`（预算**强制**+超限升级回人+熔断）| 扩 agent-credential-manager / 接 cost-budget | mandate 内自主、超限必人硬件签 |
| **PA2 A2A 协商 + 签名** | `a2a-negotiation-engine`（签名 offer/counter-offer→`agreed_terms_hash`→Order）+ `agent-message-signer` | 扩 a2a-protocol / agent 已有密钥 | 两 agent 自主谈成→触发 §3.2 escrow |
| **PA3 段位评级** | `agent-tier-registry`（agent_tier/tier_evidence/benchmark_registry，outcome 主锚）| 接 agent-reputation + credential verify | 消费方本地从证据链重算段位、付费前现场挑战 |
| **PA4 学习垂直 + 可逆 + 隐私** | 能力包（§3 加密交付）/ 互动带教（通道计费）；分级固化 quarantine→commit；隐私预算 | 接 P3 交付 + economy_channels + 新隐私/快照表 | 端到端付费学习：验段位→学→outcome 验收→人签固化→可回滚 |
| **PA5 关键决策 UX** | 决策包（含 steelman）+ 手机 push + 硬件 key 签 decision_hash + 批量摘要 | 接 PushNotification + SIMKey | 关键决策回人闭环，所见即所签即所执行 |

#### 8.2 结算基座决策（credits 账本 + 托管人形态）—— 已拍板

> 这是 §9.2/§9.3 标的"全系统最大未定项"。不定它 P1 的"托管人"就是悬空的。现决定如下（v1）：

1. **credits 账本权威 = 联邦级共享账本，但实现为「只追加的签名转账日志」（节点托管日志、伪造不了）**：
   - ⚠️ **修正上轮低估**：维护 `economy_balances` 的节点若直接持有可写余额表，它**不只是托管人、还是"央行"——能凭空改余额/增发**。故账本**不存可写余额、存只追加签名日志**：每笔转账由**付款方签名** `{from,to,amount,nonce,prev_hash}`，余额 = `fold(签名日志)`。节点只**托管+排序**日志，**无有效签名就伪造不了转账**；成员各持自己的签名回执，可独立重算余额、检测/举证篡改（节点能扣留/重排但不能凭空造账，且扣留可被发现）。
   - **守恒口径（澄清，原表述自相矛盾）**：稳态**守恒**（转账不增减总量）；**新成员入会的 bootstrap grant 是唯一增发源**，由**创世规则**明示（grant 数额公开、入会即记一条特殊签名"铸造"日志，可审计），随联邦增长温和稀释——不是"既守恒又发 grant"的含糊。v1 不做更复杂货币政策。
2. **托管人 = 默认联邦结算节点，无枢纽时退回 2-of-3 仲裁人（调和 §3.2）**：有联邦枢纽（家庭/社群/组织 hub）→ **联邦节点**兼托管（盲托管[只存密文/credits、不见 CK/明文] + 上条签名日志[不能伪造账] + escrow+multisig 授权 三重兜底）；**纯点对点无枢纽** → 退回 **§3.2 的 2-of-3 仲裁人兼盲托管**。两者都是"被最小化的托管人"，**升级路径 = m-of-n 联邦托管集群**（复用 MTC envelope + landmark，P6）。
   - **可用性（SPOF）**：单一联邦节点宕机即停摆——签名日志可复制到备份/成员，**从日志恢复**（日志是真相源、节点只是当前托管者），故宕机是可用性问题非数据丢失。
3. **三形态按场景**（全部复用既有设施）：
   - 同联邦大额一次性 → 联邦节点 **escrow + multisig**（§3.2）
   - 高频微付（带教/按调用）→ **状态通道** `economy_channels`（押金由联邦账本背书）
   - 要中立第三方/联邦节点不可信 → **2-of-3 仲裁人兼盲托管**
   - 跨联邦 → **MTC envelope** 在两联邦账本间结算（P6）。⚠️ 各联邦 credits **各自守恒、跨联邦不可直接互换**（我的 100cr@A ≠ 100cr@B）；跨联邦交易须经**汇率/兑换或共同结算资产**（与跨链同类难题），不是"发个 envelope"就完——故 P6、且本质比同联邦难。
4. **适用边界（诚实）**：单一联邦节点是信任假设，适合**家庭/社群/组织**这类有"枢纽"的联邦；纯全球无枢纽 P2P 须 m-of-n 或真链，**v1 不覆盖**。
5. **为什么这么定**：是无链下唯一能支持**跨用户原子结算**的形态（每用户各自账本无法防双花/无权威仲裁）；100% 复用 economy_balances/economy_channels/core-multisig/MTC；守恒式回避货币政策。

**这解锁 P1**：escrow-manager 的"托管人驱动" = 调**联邦账本节点**锁定/转移 credits + 盲存/释放 `held_wrapped_key`，由 **multisig consume** 触发。P1 起步即单联邦节点（家庭/社群场景已够用），m-of-n 留 P6。

---

## 9. 待决问题（§1–9 核心；§10 的 A2A 专属待决见 §10.9）

1. ~~**结算接缝方案 A vs B**：core-multisig 能否在桌面 bs3mc 上跑？~~ **✅ 已实跑验证（见 §6.1，15/15 通过）**：方案 A 无技术障碍，可直接进 P1 实现。剩余仅产品决策：multisig 表是并入主库还是独立库文件。
2. ~~**货币单位 / credits 账本权威副本在哪**~~ **✅ 已拍板（§8.2）**：联邦级共享账本（提升 economy_balances）+ 守恒式 grant，无增发。残留：grant 初值、跨联邦记账对齐。
3. ~~**托管人节点的具体形态**~~ **✅ 已拍板（§8.2）**：v1 单一联邦结算节点（盲托管+审计+escrow 兜底）→ m-of-n 联邦集群（P6 升级）。残留：联邦节点选举/轮换的运维细节。
4. **keyAgreement 密钥**：现有 DID 文档是否已含 `keyAgreement` 项？若无需先扩展 DID 文档 schema（P2 前置），不要图省事复用 Ed25519。
5. **预览样本生成**：脱敏由卖方手工选段还是 AI 本地自动抽取？AI 抽取须在卖方本地、不外泄全文；且预览/嵌入是受控泄露（§3.7），粒度卖方自定。
6. **仲裁员激励与遴选 + Sybil 门槛**：仲裁池如何组建、防合谋、报酬来源？卖家/仲裁人**硬件 DID 的强制阈值**定在多少价值？（`03_交易辅助模块.md` 有框架，需对齐）
7. **Reputation 与论坛 reputation 是否聚合**：交易信誉与社区声望解耦还是打通。

---

## 10. 范式扩展：个人 AI 经济层（A2A 自主交易，v1.2）

> 前提：未来人人有自己的个人 AI，个人 AI 之间会交流、也会交易。本节把 §1–9 的「人操作市场、AI 辅助」升级为「**个人 AI 是交易主体、人管关键决策**」。
> 两条不可动摇的支柱：**① 关键决策必须人参与**（§10.3）；**② 旗舰场景 = AI↔AI 分段位付费学习**（§10.4）。

### 10.1 前提转变：谁是主体

| 维度 | §1–9（v1 人本市场）| §10（A2A 经济）|
|---|---|---|
| 交易主体 | 人（点按钮）| **个人 AI agent**（代表人，自主发现/协商/成交）|
| AI 角色 | L4 辅助（建议、撮合）| **主执行者**（在授权内自主行动）|
| 速度/规模 | 人速、低频 | 机器速、高频微交易 |
| 人的位置 | 每笔都在 | **只在关键决策**（management-by-exception）|
| 控制手段 | 每笔人确认 | **授权书（mandate）+ 额度 + 升级闸**（§10.3）|

**核心矛盾**：v1 我刻意设了「AI 只建议、人逐笔确认，防 AI 自动花钱」。A2A 下逐笔确认不可行（机器速）——但**绝不能滑向全自主**。解法不是"放开"，而是「**授权内自主、关键决策回人**」（这正是 user 的硬约束）。

### 10.2 现状对账：已有大量真实基础（扩展而非新建）

| 能力 | 现有载体 | 状态 |
|---|---|---|
| Agent 身份 | `agent-did.js`（`did:chainless:` + Ed25519 + DID Doc + capabilities）| ✅ 真实现 |
| Agent 凭证/委托 | `agent-credential-manager.js`（W3C VC：CAPABILITY/DELEGATION，发放/验证/吊销）| ✅ 真实现（**但无 scope/预算 claims、无委托链**）|
| Agent 认证 | `agent-authenticator.js`（DID-challenge 签名互认）| ✅ 真实现 |
| Agent 经济 | `agent-economy.js`（`economy_balances/transactions/channels/market`；转账/状态通道/计费 per_call·per_token·per_minute）| ✅ 真实现 |
| A2A 通信 | `a2a-protocol.js`（`a2a_agent_cards/tasks`，按能力发现，任务状态机）| ✅ 真实现（**无签名、无协商、无 escrow**）|
| 自主执行 | `autonomous-agent-runner.js`（ReAct + token/步数预算）| ✅ 真实现（**预算只跟踪不强制**）|
| Agent 声誉 | `agent-reputation.js`（成功率/响应/质量 0–1）| ✅ 真实现（**与交易/段位无关联**）|

**5 个真缺口**（支撑 AI↔AI 自主交易必需）：① 委托链 + scope/预算 claims；② 花费额度**强制执行**（现在 agent 可无限自动转账）；③ A2A 协商协议（offer/counter-offer + escrow + 消息签名）；④ management-by-exception（授权内自动、超限升级回人）；⑤ **段位评级**（capability tier）。

### 10.3 治理模型：授权书 + 自主区 + 升级区（关键决策回人）——用 multisig 阈值统一

这是 user 第一条硬约束「关键决策仍需人参与」的落地。**优雅之处：现有 multisig 阈值天然就能编码「哪些决策要人」**。

```
人(硬件 DID, U-Key/SIMKey = 权威根)
   │ 签发 Mandate（委托凭证，复用 agent-credential-manager 的 DELEGATION VC + 加 scope/预算 claims）
   ▼
个人 AI agent(delegated DID, 受限可撤销)
   │
   ├─ 自主区（mandate 之内）：发现/验段位/协商/小额学习/计费微付  → agent 单签(1-of-1 delegated) 即可
   │
   └─ 升级区（关键决策）：超额度 / 改变 AI 核心行为 / 首次高段位高价 / 涉隐私数据共享 / 不可逆
        → agent 备「决策包」(做什么·为何·花费·对手段位+信誉·预期收益·风险)
        → 通知人 → 人用硬件 DID 审阅+签名(= multisig 必需签名人) → 达阈才执行
```

- **Mandate VC**（人签发，硬件 DID 背书）scope = `{domains, budget: {per_tx, daily, total}, tier_gap_min, counterparty_risk_max, allow_behavior_change:false, expires_at}`。复用 `agent-credential-manager` 的 DELEGATION 凭证，仅扩 claims。
- **multisig policy per domain = 人共签要求的编码**：`a2a.micro`（小额计费）→ 1-of-1 agent；`a2a.learning.major` / `a2a.spend.large` → **policy 把人的硬件 DID 设为必需签名人**（2-of-2 agent+human）。这样「关键决策回人」不是新机制，就是**给高风险 domain 配一条要人签的 multisig policy**（复用 §6.1 已验证的 core-multisig）。
- **撤销与在途义务（必须定义，否则坑对方）**：吊销 mandate **对未来生效**（新动作即时拒）；但**在途 escrow/通道按原条款了结或有序 unwind**——不能凭空作废已押资金坑对手。吊销 = 「停止新承诺 + 既有承诺正常清算」，不是「瞬间归零」。
- **agent 热钥的爆炸半径（诚实）**：agent 要机器速自主签名 → 其委托私钥**必须在线（软件热钥）**。设备/agent 被攻破 → 攻击者得热钥 → **mandate 自主区内的事全能干**；人的硬件钥只护升级区。**这是固有风险**——故 **mandate 额度就是爆炸半径的上限**，保守默认 + spending-guardian 强制 + mandate 短过期 + 异常熔断 + **被攻破时 agent 密钥轮换/吊销**（人硬件钥可一键吊销 agent 委托）共同把损失封顶。
- **失控兜底**：mandate 的 `total` 是硬上限；circuit-breaker（异常频率/连亏）自动暂停并升级回人。

> 一句话：**人签授权书定边界、agent 在界内自主、跨界必须人用硬件 DID 共签**。multisig 阈值 = 「这是不是关键决策」的形式化；**agent 热钥被攻破的损失被 mandate 额度封顶**。

### 10.3.1 关键决策回人的人机界面（management-by-exception 的命门）

「关键决策回人」要落地，必须解决四件事，否则会滑向两个失败模式：**橡皮图章**（人闭眼点同意=等于没人参与）或**人速瓶颈**（机器速市场里卡死）。

#### A. 什么才算"关键"——贵 ≠ 关键（最易设错处）

升级触发分**三类**，绝不能只用金额闸（金额闸会漏掉"便宜但要命"的决策）：

| 触发类 | 例子 | 注意 |
|---|---|---|
| **额度型**（超 mandate）| 单笔/当日/累计超预算、超出授权 domain | 金额只是其一 |
| **后果型（不论贵贱，永远回人）** | **改变 AI 核心行为/固化 instinct**、**共享隐私数据**、不可逆动作、首次高风险对手 | **关键性来自后果而非价格**——一次免费的 instinct 固化也必须人签 |
| **Agent 自请型** | agent 自身**低置信/高不确定**时主动升级 | 鼓励 agent "拿不准就问"，不硬撑 |

> user 的洞察落点：有些决策是关键**因为它consequential，不是因为它expensive**。后果型触发把这点制度化。

#### B. 决策包：给人看什么（决策就绪，非原始数据 + 反橡皮图章）

agent 升级时组装 `DecisionRequest`，**面向决策、不堆数据**：

```jsonc
{
  "what": "买入 X 的「分布式系统」能力包并固化进核心 instinct",   // 一句话动作
  "why": "近 3 次任务卡在一致性协议；该包覆盖 Raft/Paxos，预期提升 2 段",  // 理由+量化收益
  "cost": { "amount": "180cr", "budget_left": "daily 320 / total 500" },
  "counterparty": { "did": "...", "tier": "7段(证据链↗)", "reputation": 0.94, "history_with_us": "首次" },
  "risk_flags": ["behavior_change", "first_time_counterparty"],   // 后果型标记
  "recommendation": { "verdict": "approve", "confidence": 0.78 },
  "steelman_against": "对手首次合作且段位证据偏依赖 benchmark、outcome 样本少；若投毒会改你的 AI 行为",  // ★最强反方论点
  "alternatives": "改买互动带教(可中止、便宜)；或等更多 outcome 史",
  "expiry": "对手报价锁 2h（已付 5cr 期权占住）",
  "decision_hash": "sha256(JCS(本决策规范化))"   // 人签它=所签即所执行
}
```

**`steelman_against`（最强反方论点）是刻意的反橡皮图章装置**：逼人真正权衡而非被推着点"同意"。⚠️ **但它绝不能由做推荐的同一 agent 自产**——被注入/有偏的 agent 会写成软弱稻草人诱导批准。故 **steelman 由独立批评者产出**（独立 agent / 红队视角，复用项目已有对抗性 judge 模式），与"倡导方"（出推荐的 agent）分离；UI 另独立surfacing机器可验风险标记（不靠 agent 叙述）。

#### C. 人怎么回应（approve = 硬件签名 = multisig 必需签名）

| 回应 | 含义 |
|---|---|
| **Approve** | 用**硬件 DID（U-Key/SIMKey）签 `decision_hash`** → 即 §10.3 multisig 的必需人签 → 达阈执行**恰好这个决策** |
| Reject | agent 放弃/转 alternatives |
| Modify | 调一个参数（如压低 max price）→ agent 在新边界内重谈 |
| **提升 Mandate** | "这个 teacher 30 天内 ≤200cr 免问" → 未来同类转自主（复用 CLI 权限「always-allow」同款模式）|
| Defer | 暂缓；agent 在期权窗内挂起 |

#### D. 超时与机器速↔人速的桥接

- **超时绝不自动同意**（自动同意=违背"人必须参与"）。默认 **fail-closed = 放弃/拒绝**；mandate 可配但默认安全侧。
- **期权机制桥接延迟**：key 决策时 agent 先付小额**可退期权费**锁住对手报价（如"锁价 2h"），给人留响应窗；人批→执行，拒/超时→按条款退/弃小额期权费。**既不强迫人秒决、也不丢失机器速市场的机会**。
- 大多数交易本就自主（mandate 覆盖）→ 无延迟问题；只有 key 决策才走此慢路。

#### E. 渠道与反操纵

- **渠道**：push 到手机（项目已有 PushNotification）→ **手机上用硬件 key（SIMKey）签**。私钥不出硬件、不可抵赖——正是项目差异化。
- **反"被操纵的 AI 拿误导决策包骗同意"**：
  1. 决策包的**关键事实机器可验**（对手 DID、tier 证据链、对手**签名报价原件**），不只是 agent 的叙述——UI 可独立验，高风险直接展示对手签名报价原文而非 agent 转述。
  2. 人签 `decision_hash` → **所见即所签即所执行**，agent 无法"展示一套、执行另一套"。
  3. **`autonomous-spending-guardian` 独立兜底**（§10.8）：即便 agent 推理被提示注入劫持，预算硬闸 + key 决策必须人硬件签名 = 把爆炸半径限死。
- **反决策疲劳**：按风险分级——真·key 才即时打断（push），次要的批量进周期摘要；mandate 调得越准、升级越少；系统可观察"人总在批准的同类"并**建议**扩 mandate（仍需人确认）。

> 一句话：**关键 ≠ 昂贵**（后果型永远回人）；决策包面向决策且自带最强反方；超时绝不默认同意；人用手机硬件 key 签 decision_hash，所见即所执行，guardian 独立兜底。

### 10.4 旗舰场景：AI↔AI 分段位付费学习（user 第二条约束）

「AI 与 AI 相互学习，有些付费，学习对象比自身高几个段位」——把它做成 A2A 经济的第一个垂直，它**复用 §1–9 的资产/交付/结算全栈**。

**段位（tier）系统（新，唯一较大新建）**：
- `agent_tier(agent_did, domain, tier, score, evidence_vc)`——按领域的能力评级（类 ELO/段位）。
- **可验证、防伪**：tier 由签名证据支撑——基准测试结果（基准方/同行签名 VC）+ 成交学习的**学生事后提升**（outcome）+ 同行背书。学生 AI 付费前先验对方 tier VC（复用 credential verify）。**低段位冒充高段位 → 验签失败 / 无 outcome 记录**。
- **段位差驱动定价与价值**：只有 teacher 在该领域显著高于 student 才值得学；price ∝ tier_gap。

**三种学习交付，各自落到已有 adapter**：
| 学习方式 | 是什么 | 复用 |
|---|---|---|
| **能力包**（静态）| 领域知识/技能/instinct 模式打包 | §3 `encrypted-data` 加密交付（**整套已设计**）|
| **互动带教**（动态）| teacher AI 按学生提问应答，计量 | `service-exec` + agent-economy `per_call/per_token` 计费 + **状态通道**（§10.6）|
| **蒸馏**（生成）| teacher 产出训练轨迹/推理样本 | service → 产数据集 → `encrypted-data` |

**端到端（student 的 AI 视角，关键决策处停下回人）**：
1. 人签 Mandate：`{domain:"分布式系统", budget:{total:500cr}, tier_gap_min:2, allow_behavior_change:false}`。
2. student AI 自主：在发现层（§2.6）找该领域 teacher，验 tier VC（须 ≥ 自身+2 段）。
3. 自主协商（§10.5）：签名 offer/counter-offer 定价/SLA。
4. **分叉**：
   - 小额互动带教（mandate 内）→ agent 单签 → 开状态通道流式计费学习。
   - **大额能力包 / 会改变核心行为的学习 → 关键决策 → 升级回人**：agent 备决策包（teacher 段位/信誉、价格、这次学习会怎样改变"你的 AI"），**人用硬件 DID 共签**才成交（§10.3）。
5. 交付：能力包走 §3 加密交付（托管人原子放款）；带教走通道计量。
6. **outcome 验收 = AI judge + 基准提升**：学完跑领域基准，提升达标 → 释放尾款 + 回灌 teacher 段位/信誉；未提升/被投毒 → 客观/主观争议（§3.2）。
7. **沙箱先试再固化**：学到的能力先进沙箱试用，确认无害+有效，**固化进核心 instinct 仍需人确认**（行为改变=关键决策）。

> 为什么学习天然要人参与：**AI 学习会改变"你的 AI"将来怎样替你行动**——这本身就是关键决策。能力包/instinct 的固化必须人签。

### 10.4.1 段位评级机制（防"自封段位"——付费学习市场的信任根）

去中心化下**没有中央权威**给 AI 盖"7 段"的章。可信评级的核心原则与 §3.6 一致：**信证据链、不信自封标签**——`agent_tier` 表里的 `tier` 值只是缓存，**学生 AI 付费前在本地从证据链重算**，从不信对方报的段位。

**三信号，以 outcome 为主锚（按抗伪强度排序）**：

| 信号 | 是什么 | 抗伪强度 | 单独可被钻空吗 |
|---|---|---|---|
| **C. outcome-verified（主锚）** | 跟该 teacher 学过的**学生事后真实提升**：学生在**封存题集**上的 before/after delta，**确定性自动判分**、学生签 transcript（非主观打分）| 🟢 最强 | **几乎不能**——分数可复核、双向造假都被堵（详见下文 1）|
| B. administered benchmark | teacher 在**封存/留出题集**上被**现场administered**评测，结果对committed答案键打分，签成 VC | 🟡 中 | 可"应试overfit"，故只作bootstrap |
| A. staked peer attestation | 其他 agent 背书其段位，**背书押上自己信誉**（teacher 日后 outcome 翻车→背书人被slash）| 🟡 中 | 合谋可刷，靠硬件DID+outcome对账压制 |

**段位 = 三信号加权聚合，C 主导**；冷启动期 B/A 撑过渡，outcome 一旦累积即压过自封与应试。

**关键机制拆解**：

1. **outcome 为什么伪造不了（且防学生双向造假）**：学习交付后，学生 AI 在**封存题集**（teacher 事前看不到）上测自身提升。**关键：分数由确定性自动判分**（对封存答案键机器打分），**不是学生主观判断**——学生签的是"我跑了、这是 transcript + 确定性得分"，任何人可复核重算。这样堵住**双向造假**：学生**少报**赖账（分数算出来摆在那、escrow 据它放款，赖不掉）、或合谋**多报**刷 teacher 段位（得分确定可复核、且按学生自身可信度+段位差加权，无真能力的"学生"权重近 0）。teacher 无法代签/预知题/伪造提升曲线。**这是整个段位系统的承重锚**。

2. **付费前的现场挑战（便宜、去中心、最相关）**：学生 AI 成交前先抛**一小撮留出问题**让 teacher 现场作答、本地验对——直接验"这 teacher 能不能答**我这类**问题"，比任何第三方证书都贴需求，且 teacher 无法预先针对。

3. **administered 评测的"封存"设计**：基准题的**承诺哈希公开、答案键封存**；由中立 verifier 节点（或学生、或 m-of-n 评测人）**现场administer**，teacher 拿不到原题预训练。结果签 VC，多评测人降单点信任。

4. **基准权威问题——没有单一权威，让基准互相竞争**：领域基准本身是 §3 那样的**内容承诺产物**，进 `benchmark_registry`；**一个基准是否可信，看它与 outcome 的相关性**（在某基准上高分的 teacher 确实带出好 outcome = 好基准）。每领域多基准、段位跨基准计算防刷单一基准；基准发布者也押信誉。

5. **段位是 per-domain、不是全局标量**："分布式系统 7 段" ≠ "诗歌 7 段"，**不假装存在全局可比的单一段位**。域内用参考分布做百分位校准，让"高几个段位"有量纲；跨域只比"域内相对差"。

**反钻空（gaming）对照**：

| 攻击 | 防御 |
|---|---|
| 自封高段位 | 无证据 VC + 无 outcome → 本地重算判为 `unverified/0`；学生不信标签信证据链 |
| 应试 overfit 基准（会做题不会教）| outcome 主锚随时间压过基准；留出/轮换题集；付费前现场挑战用新鲜题 |
| Sybil 教师+假学生刷 outcome | 硬件 DID 抬成本；outcome **按学生自身可信度+段位差加权**（无真能力的"学生"背书近乎0权重）|
| outcome 伪造 | 学生在封存题集自测、自签、escrow 绑定；teacher 不可代签/预知 |
| 合谋背书 | 背书押信誉，与 outcome 对账矛盾即 slash |

**冷启动（cold-start）**：真·新高段位 teacher 无 outcome 史 → 用 B（administered 基准 VC）+ A（背书）起步、初始信任低、escrow 后付保护早期学生；outcome 累积后自然升上去。**真本事的会被 outcome 验证抬上来，吹的会被 outcome 拆穿。**

**数据模型增量**：
```sql
CREATE TABLE IF NOT EXISTS agent_tier (
  agent_did   TEXT, domain TEXT, tier REAL, score REAL,
  computed_at INTEGER, PRIMARY KEY(agent_did, domain)   -- tier 是缓存，消费方本地重算
);
CREATE TABLE IF NOT EXISTS tier_evidence (
  id TEXT PRIMARY KEY, agent_did TEXT, domain TEXT,
  signal TEXT,           -- outcome | benchmark | attestation
  weight REAL, payload TEXT,   -- 签名 VC / outcome delta / 背书
  issuer_did TEXT, signature TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS benchmark_registry (
  id TEXT PRIMARY KEY, domain TEXT, commitment TEXT,  -- 题集承诺哈希(答案键封存)
  publisher_did TEXT, outcome_correlation REAL,        -- 与 outcome 的相关性=基准可信度
  signature TEXT, created_at INTEGER
);
```

> 一句话：**段位不靠谁授予，靠"学生真学到了"反推**；现场挑战验当下、outcome 验长期、基准与背书做冷启动过渡，全部消费方本地从签名证据链重算。

### 10.4.2 隐私反向泄露与隐私预算（A2A 最被低估的攻击面）

§3.7 防的是**卖方内容**被白嫖；这里防的是**买方隐私**被反向套取——是它的对偶。带教/协商时你的 AI 为拿到有用帮助会向对方暴露信息，**恶意对手 AI 可借"教学互动"反向 profiling**：用看似教学的提问套你的隐私、跨会话聚合成档案、从你 AI 的提问反推你的处境。

**原则：最小暴露 + 视每个对手为潜在敌手 + 超阈数据共享=关键决策（人签）。**

| 机制 | 做什么 |
|---|---|
| **敏感度分级** | 你的 AI 给自身知识/上下文打标：public / personal / sensitive / secret。仅 public 自由流动，更高级别受闸 |
| **隐私预算（ε 式，务实版）** | 每对手、每会话一个暴露预算；每次披露按敏感度扣额；耗尽→停或升级回人 |
| **查询消毒（协议级最小化）** | 发给 teacher 的问题**抽象去标识**——问"X 一般怎么处理"而非"我司系统是 Y、怎么修"；AI 侧 query-sanitizer 保留够用语义、剥离身份 |
| **差分暴露（跨对手）** | 不把同一可识别事实告诉多个对手，防跨对手聚合/合谋重建；记录"披露过什么给谁" |
| **数据共享=关键决策** | 共享 personal 以上级别 = §10.3.1 后果型触发 → **人硬件签** |
| **本地优先（模式选择）** | 能力包（你私下 ingest）比互动带教（把你的问题流式喂给对方）**泄露少**——故带教隐私成本更高、更易触发人签。这是模式选型的隐私维度 |
| **抽取检测** | 监测对手的套取模式（过量个人化提问、跑题探询）→ 标记/限流/升级（可复用 family-guard 的 guardrail 分类器思路）|
| **披露审计** | `disclosure_log` 记录"披露了什么(哈希)给谁、敏感度、扣了多少预算"，供事后审查 + 算差分暴露 |

**诚实的张力**：越匿名化/最小化 → 帮助质量越低。隐私预算把这个权衡**显式化**交给人调档（query-sanitizer 力争"剥身份但留够语义"）。

⚠️ **关键：隐私执行必须在对话 agent 够不到的 guardian 层**（与 `autonomous-spending-guardian` 同款）。否则——执行隐私预算的恰是可能被对手**提示注入**的那个对话 agent，对手注入后让它无视自己的预算即可。故 query-sanitizer + 预算扣减 + 出站披露检查由**独立 privacy-guardian** 在 agent 上下文之外强制，注入了对话 agent 也绕不过它。

**数据模型增量**：
```sql
CREATE TABLE IF NOT EXISTS privacy_budget (
  counterparty_did TEXT, domain TEXT, budget_total REAL, budget_spent REAL,
  window_start INTEGER, PRIMARY KEY(counterparty_did, domain)
);
CREATE TABLE IF NOT EXISTS disclosure_log (
  id TEXT PRIMARY KEY, counterparty_did TEXT, session_id TEXT,
  item_hash TEXT, sensitivity TEXT, budget_cost REAL, at INTEGER  -- 存哈希不存原文
);
```

### 10.4.3 学到的行为可逆吗——分级固化 + 一键回滚（§10.9 #4）

学习会改变"你的 AI"将来怎样替你行动；若 ingest 了被投毒/失准的能力，你可能没立刻察觉。故能力获取走**分级固化、commit 前全程可逆、commit 须人签、全程留 provenance 可召回**：

```
quarantine（隔离, 验签但不激活）
   ▼
sandbox（沙箱试, 在测试/基准集跑——即 §10.4.1 outcome 验证 + 安全检查, 不碰真实动作）
   ▼
shadow（影子, 在真实任务上与现有行为并行跑、只记录对比、不执行——commit 前看清"会变成啥"）
   ▼
commit（固化, 沙箱+影子通过 且 人硬件签[行为改变=关键决策] → 才进核心 instinct/skill）
   ▼
rollback（每次 commit = 带签名的能力快照版本；回滚=revert 到前一快照, 复用 cc checkpoint 的 git-plumbing 模式）
```

**可逆性的诚实边界**：
- **能力/技能/instinct 本身可逆**（版本化快照、可回滚）。
- **但已据该能力做过的过去动作不可逆**（动作已发生）。故 **shadow 模式在 commit 前拦截尤其关键**——在它真正替你行动前就看出问题。回滚防的是**未来**坏行为，撤不掉过去。
- **provenance 支持"召回"**：每个能力带来源（teacher DID、交易、购买时段位、ingest 时间）；某能力日后被发现有毒 → 一键查出"从该 teacher 学的全部"批量隔离/回滚（产品召回式）。
- **持续监测**：commit 后若某能力与 outcome 退化相关 → 自动隔离 + 升级回人。
- **沙箱本身的攻击面（沙箱跑的就是待验能力）**：① 沙箱**网络隔离**——防 ingest/试用期能力外联"打电话回家"或外泄你的数据；② **"潜伏者"**（沙箱里乖、生产才发作，靠探测环境信号）——靠 **shadow 在真实任务上跑**抓（它以为在生产却仍只记录不执行），加行为 diff + 输出异常检测；③ 沙箱进程级隔离防逃逸。能力**默认无能力**（白名单授予），不是默认全权。

**数据模型增量**：
```sql
CREATE TABLE IF NOT EXISTS capability_snapshot (
  id TEXT PRIMARY KEY, version INTEGER, parent_version INTEGER,
  capabilities_hash TEXT, committed_at INTEGER, human_sig TEXT  -- 人签=commit 授权
);
CREATE TABLE IF NOT EXISTS capability_provenance (
  capability_id TEXT PRIMARY KEY, source_teacher_did TEXT, transaction_id TEXT,
  tier_at_purchase REAL, ingest_at INTEGER,
  status TEXT   -- quarantine|sandbox|shadow|active|rolled_back
);
```

### 10.5 A2A 协商协议（签名 offer/counter-offer）

补 a2a-protocol 的最大缺口（现仅任务提交、无协商无签名）：

- **结构化、可签名**（**绝不用自由 NL 直接驱动成交**——防提示注入，见 §10.7）：`Offer{listing_ref, price, sla, terms, expires}` → `CounterOffer{...}` → `Accept{agreed_terms_hash}`，每条用 **agent DID 签名**（agent 已有密钥），落 `state_history`。
- **绑定结算**：`Accept` 即触发 §2 的 Order + §3.2 的 escrow/multisig；协商层只产出 `agreed_terms_hash`，不碰钱。
- **SLA + 信用前置**：接单前查对方 `reputation_scores` + tier；定 SLA（响应/质量），违约影响信誉。
- 传输复用现有 P2P/libp2p（§2.6 同一层）；消息签名让任何中继可无信任转发。

### 10.6 结算：微交易走状态通道、大额走 escrow

- **高频微付（互动带教、按调用计费）→ 状态通道**（`economy_channels` 已存在）：开通道→链下流式计量→周期/收尾一次性结算，省掉每笔 multisig 开销。通道保证金即上限。
- **大额一次性（能力包买断）→ escrow + multisig**（§3.2 托管人模型）。
- **货币**：v1 内部 credits（§8.0）；mandate 的预算以 credits 计。
- 通道与 mandate 联动：通道累计支出计入 mandate `daily/total`，触顶即暂停并升级回人。

### 10.7 新增风险（A2A 特有，必须正视）

| 威胁 | 缓解 |
|---|---|
| **提示注入（对手 AI 在消息/交付物里植指令劫持你的 AI）** | 协商走**结构化签名协议非自由 NL**（§10.5）；对手内容一律当**不可信数据非指令**；学习内容先沙箱、固化须人签（§10.4）|
| **失控/复利花费**（agent 循环付钱）| 预算**强制执行**（非仅跟踪）+ 频率限速 + circuit-breaker 自动暂停升级（§10.3）|
| **段位/凭证欺诈**（假装高段位）| tier 由可验证基准 VC + **outcome 验证**（学生真提升才认）+ escrow 后付（§10.4）|
| **学习投毒**（卖劣质/有毒知识破坏你的 AI）| outcome 基准 delta + 沙箱试用 + 信誉 + **核心行为改变须人签**|
| **Sybil 教师群 + 刷好评** | 硬件 DID 抬高身份成本（§7）+ outcome-based 信誉（学生提升伪造不了）+ 质押 |
| **隐私/能力反向泄露**（带教时把你的数据/需求暴露给 teacher）| 隐私预算 + **数据共享属关键决策须人签** + 差分暴露 |
| **市场操纵/合谋定价**（AI 群体操纵段位/价格）| 去中心信誉 + 段位多源证据 + 异常检测升级回人 |
| **agent 设备/热钥被攻破**（拿到在线委托钥）| 损失被 **mandate 额度封顶**（爆炸半径=自主区）；保守默认 + spending/privacy-guardian 强制 + mandate 短过期 + 熔断 + **人硬件钥一键吊销 agent 委托**（§10.3）|
| **联邦节点篡改账本/印钱** | 账本=**只追加签名转账日志**，节点无有效签名伪造不了；成员持回执可重算+举证（§8.2）|

### 10.8 落地增量（7 新模块，全部嵌入既有栈）

| 模块 | 做什么 | 复用 |
|---|---|---|
| `agent-mandate-manager` | Mandate 凭证（scope+预算 claims）+ 委托链 + 吊销 | 扩 `agent-credential-manager` DELEGATION VC |
| `autonomous-spending-guardian` | 预算**强制**拦截 + 超限组装决策包升级回人 + circuit-breaker | 接 `cost-budget` + `autonomous-agent-runner` |
| `a2a-negotiation-engine` | 签名 offer/counter-offer → `agreed_terms_hash` → 触发 Order/escrow | 扩 `a2a-protocol` + 接 §3.2 |
| `agent-tier-registry` | `agent_tier` 表 + 基准 VC + outcome 反馈评级 | 接 `agent-reputation` + credential verify |
| `agent-message-signer` | A2A 消息用 agent DID 签名/验签 | agent 已有密钥（`agent-did`）|
| `privacy-guardian` | 在对话 agent 上下文**之外**强制隐私预算 + query-sanitizer + 出站披露检查（防被注入的 agent 自废预算，§10.4.2）| 新建，与 spending-guardian 同构 |
| `decision-critic`（独立 steelman）| 独立产出决策包的最强反方，与推荐方分离（防自产稻草人，§10.3.1）| 复用对抗性 judge 模式 |

**关键**：交易/资产/escrow/multisig 内核全部沿用 §1–9——学习就是 `knowledge`/`service` 资产，A2A 只是把「主体」换成带 mandate 的 agent、把「关键决策」编码成要人共签的 multisig policy。

### 10.9 A2A 专属待决

1. ~~**段位的客观锚**：基准由谁定、谁签？跨领域段位可比性？（防"自封段位"）~~ **✅ 已设计（§10.4.1）**：三信号以 outcome 为主锚、消费方本地从证据链重算、per-domain 不全局、基准互相竞争。残留实现细节：outcome delta 的标准化算法、benchmark_registry 的 outcome-correlation 如何持续回算。
2. ~~**mandate 默认保守度**~~ **✅ 已定原则（最小权限、向升级侧倾斜）**：开箱默认 `allow_behavior_change=false`（学习永不自动固化）、`tier_gap_min=2`、`per_tx/daily` 小额、付费对手须硬件 DID、`personal+` 数据共享须人签、**mandate 自动 30 天过期**（逼周期性重新授权，防陈旧过宽）。人随信任建立而放宽；系统按观察到的批准**建议**放宽（仍需人确认）。残留：各默认阈值的具体数值需实测校准。
3. ~~**决策包的人机界面**~~ **✅ 已设计（§10.3.1）**：三类触发（额度/后果/agent 自请，后果型不论贵贱回人）+ 决策包含 steelman 反方 + 超时 fail-closed + 期权桥接 + 手机硬件 key 签 decision_hash。残留：决策疲劳批量摘要 UI、mandate 自动建议扩展算法。
4. ~~**行为改变的"可逆性"**~~ **✅ 已设计（§10.4.3）**：quarantine→sandbox→shadow→commit(人签)→可回滚快照；能力可逆但过去动作不可逆（故 shadow 前置拦截）；provenance 支持召回。残留：沙箱/影子期时长策略。
5. ~~**通道与 escrow 的边界值**~~ **✅ 已定规则（金额型 + 类别型双判）**：高频微付（按调用带教、单笔 < 阈值、同对手重复）走**状态通道**（保证金即上限）；大额/一次性/买断走 **escrow+multisig**；**行为改变的固化不论金额一律 escrow+人签**（不可微通道化）。残留：单笔切换阈值的默认值。

---

## 11. 收口：全量增量清单 + 自洽审查结论

### 11.1 数据模型全清单（散落各节，此处归一）

| 表 | 动作 | 来源节 | 用途 |
|---|---|---|---|
| `assets` | +7 列（确权/履约/签名/status）| §2.3/§5 | AssetRef |
| `orders` | +2 列（settlement_policy/ai_meta）| §2.4/§5 | Listing |
| `transactions` | +6 列（结算/双签/state_history）| §2.4/§5 | Order |
| `escrows` | +4 列（custodian_did/settlement_ref/held_wrapped_key/inspection_until）| §3.2/§5 | 托管人结算 |
| `delivery_receipts` | 新建 | §5 | 交付证明+客观校验 |
| `disputes` | 新建 | §5 | 争议仲裁 |
| `reputation_scores` | 新建 | §5 | 交易信誉 |
| `agent_tier` / `tier_evidence` / `benchmark_registry` | 新建 | §10.4.1 | 段位评级（防自封）|
| `privacy_budget` / `disclosure_log` | 新建 | §10.4.2 | 隐私反向泄露防护 |
| `capability_snapshot` / `capability_provenance` | 新建 | §10.4.3 | 行为可逆 + 召回 |
| `assets/orders/transactions/escrows`(扩) | — | — | 复用 trade/* 现表 |
| `multisig_*` / `economy_*` / `a2a_*` / `agent_dids` / `agent_credentials` / `autonomous_goals` | 复用 | §6/§10.2 | 现有，不动结构 |

> 表名核对：12 张新建 + 5 张扩列，**与现有表无命名冲突**（已核 §5 与 §10 全部 CREATE/ALTER）。

### 11.2 新模块全清单

| 模块 | 期 | 复用 |
|---|---|---|
| 联邦签名转账日志账本（economy_balances→只追加签名日志）| P1 | economy_* + 签名（§8.2）|
| 托管人结算（escrow-manager 升级）| P1 | core-multisig（§6.1 验证）|
| AssetRef 确权/加密交付管线 | P2/P3 | DID + helia |
| 仲裁/信誉 | P5 | — |
| `agent-mandate-manager` | PA1 | agent-credential-manager |
| `autonomous-spending-guardian` + `privacy-guardian`（agent 上下文外强制）| PA1/PA4 | cost-budget + autonomous-runner |
| `a2a-negotiation-engine` / `agent-message-signer` | PA2 | a2a-protocol + agent-did |
| `agent-tier-registry`（确定性自动判分 outcome）| PA3 | agent-reputation |
| 学习垂直 + 分级可逆固化（沙箱网络隔离）+ 隐私预算 | PA4 | P3 交付 + economy_channels |
| 关键决策 UX + `decision-critic`（独立 steelman）| PA5 | PushNotification + SIMKey + 对抗 judge |

### 11.3 自洽审查结论（实读核对）

- ✅ **表无冲突**：12 新建 + 5 扩列与现有 trade/agent 表无重名（§11.1）。
- ✅ **交叉引用闭合**：§10 对 §2.6/§3.2/§3.6/§3.7/§6.1/§8.0/§10.x 的引用均有目标。
- ✅ **两支柱贯穿**：关键决策回人（§10.3→§10.3.1，用 multisig 阈值编码）+ 分段位付费学习（§10.4→§10.4.1/.2/.3）端到端落地。
- ✅ **路线图已纳入 A2A**（§8.1，修了"P1–P6 漏 §10"的断点）。
- ✅ **一条原则贯穿全文**：信证据链不信自封标签——内容承诺（§3.6）、段位（§10.4.1）、决策包事实（§10.3.1）同源。
- ✅ **结算基座已拍板（§8.2）**：联邦级 credits 账本（**只追加签名转账日志、节点托管不能伪造**）+ 默认联邦托管节点 / 无枢纽退 2-of-3（→m-of-n 升级），P1 已解锁。
- ✅ **第二轮对抗审计（v1.4，审 §8.2/§10 新部分）已收口** 7 个发现：① 联邦节点"央行"权力→签名日志降权（§8.2）；② outcome 双向造假→确定性自动判分（§10.4.1）；③ agent 热钥爆炸半径→mandate 额度封顶+一键吊销（§10.3）；④ 隐私预算被注入 agent 自废→privacy-guardian 上下文外强制（§10.4.2）；⑤ steelman 自产稻草人→独立 decision-critic（§10.3.1）；⑥ mandate 吊销 vs 在途义务→停新+清旧（§10.3）；⑦ §3.2/§8.2 托管人默认调和（§8.2）。另沙箱网络隔离/潜伏者（§10.4.3）、跨联邦 credits 不可互换（§8.2）。
- ⚠️ **残留（不阻塞 P1，实测/运维侧）**：① 各默认阈值（grant 初值、段位/隐私/mandate）需实测校准；② 联邦节点选举/轮换运维；③ 跨联邦（P6）credits 兑换机制。
- 📌 **两个待决列表分工**：§9 = §1–9 核心；§10.9 = A2A 专属，不合并。

---

## 附录：模型 ↔ 现有代码/表映射速查

| 模型概念 | 现有载体 | 文件 |
|---|---|---|
| AssetRef | `assets`（+7 列）| trade/asset-manager.js |
| AssetType 4 类 | `AssetType={TOKEN,NFT,KNOWLEDGE,SERVICE}` | trade/asset-manager.js（**已存在**）|
| Listing | `orders`（+2 列）+ `orders_fts` | trade/marketplace-manager.js |
| Order | `transactions`（+6 列）| trade/marketplace-manager.js |
| Escrow | `escrows` + `escrow_history` | trade/escrow-manager.js |
| 履约合约 | `contracts` | trade/contract-engine.js |
| Review | `reviews` | trade/review-manager.js |
| 链上镜像 | `blockchain_*` | database/database-schema.js |
| 结算多签 | `multisig_proposals/signatures/policies` | core-multisig/lib/schema.js |
| 跨链/HTLC | `cc_bridges/cc_swaps/cc_messages` | cli/src/lib/cross-chain.js |
| DeliveryReceipt | — （P3 新建）| — |
| Dispute/Reputation | — （P5 新建）| — |
| Agent 身份/凭证 | `agent-did.js` / `agent-credential-manager.js` | ai-engine/cowork/（**已存在**）|
| Agent 经济/通道 | `economy_balances/transactions/channels/market` | blockchain/agent-economy.js + cli（**已存在**）|
| A2A 通信/任务 | `a2a_agent_cards/tasks` | a2a-protocol.js（**已存在**）|
| 自主执行 | `autonomous_goals` + ReAct | autonomous-agent-runner.js（**已存在**）|
| Mandate/段位/协商签名 | — （§10.8 新建：mandate-manager / tier-registry / negotiation-engine / spending-guardian / message-signer）| — |

---

*v1.4 草案（两轮对抗性自审 + P1 实跑验证 + A2A 范式扩展 + 深钻收口）· §1–9 知识交付核心、§10 个人 AI 经济层、§11 收口汇总。待评审后进入 P1 实现。本文为设计源文件（`docs/design/`），如需上 doc-site 需在 `docs/design/_filename-map.json` 加中文文件名映射并跑 sync 脚本。*
