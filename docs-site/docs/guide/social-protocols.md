# 社交协议用户指南

> v5.0.2.10 引入的去中心化社交协议功能实操指南。
>
> 涵盖 Nostr (NIP-04/09/25)、Matrix (Threads/Spaces)、ActivityPub C2S、
> 进程内社交图谱以及多语言主题分类。
>
> **最后更新**: 2026-04-16 · 另见: `docs/CLI_COMMANDS_REFERENCE.md`

---

## 1. 适用人群

- 希望通过 CLI 与 Fediverse / Nostr / Matrix 联邦互通的高级用户
- 需要无桌面 GUI 的可编程社交表面的 Agent
- 将 ChainlessChain 集成为社交身份层的开发者

以下所有命令均为 Headless 模式运行，无需桌面应用。

---

## 2. Nostr — 扩展 NIP 支持

ChainlessChain 实现了 NIP-01（事件）、NIP-04（加密 DM）、NIP-09（删除）、
NIP-19（bech32 编码）和 NIP-25（反应/点赞）。签名和密钥编码基于真实的
BIP-340 schnorr + bech32 实现，与桌面主进程共享
`@chainlesschain/session-core/nostr-crypto`。

### 2.1 密钥生成

```bash
# 生成新密钥对 (npub / nsec + hex)
chainlesschain nostr keygen

# 绑定到已有 DID（双向查找）
chainlesschain nostr map-did --did did:key:z6Mk... --npub npub1... --nsec nsec1...
```

### 2.2 中继节点 + 公开帖子

```bash
chainlesschain nostr relays                            # 列出已配置中继
chainlesschain nostr publish --kind 1 --content "你好"  # 公开文本笔记
```

### 2.3 NIP-04 加密私信

```bash
# 发送 — recipient-pubkey 为对方 hex 公钥（非 npub）
chainlesschain nostr dm \
  --sender-nsec nsec1... \
  --recipient-pubkey 02ab... \
  --plaintext "晚上8点见"

# 解密收到的 DM（从本地事件存储读取密文）
chainlesschain nostr dm-decrypt \
  --recipient-nsec nsec1... \
  --sender-pubkey 02ab... \
  --ciphertext "AES-CBC-BASE64?iv=IV-BASE64"
```

加密方式：x-only-pubkey ECDH（公钥前缀 `0x02`）→ AES-256-CBC，
每条消息使用独立的 16 字节 IV。密文格式遵循 NIP-04 标准编码
（`<ct>?iv=<iv>`）。

### 2.4 NIP-09 删除请求

事件所有者可请求删除自己的事件。订阅的客户端会将匹配的 id 标记为已删除。

```bash
chainlesschain nostr delete \
  --author-nsec nsec1... \
  --event-ids evt1,evt2 \
  --reason "发错了"
```

kind-5 事件为每个被删除事件携带一个 `["e", <id>]` 标签，加上可选的
`content` 字段说明删除原因。

### 2.5 NIP-25 反应/点赞

```bash
chainlesschain nostr react \
  --author-nsec nsec1... \
  --target-event-id evt-to-like \
  --target-author-pubkey 02ab... \
  --content "+"                                     # 或 "-" 或 ":emoji:"
```

kind-7 事件同时携带 `["e", <target>]` 和 `["p", <target-author>]` 标签。

---

## 3. Matrix — 线程 + 空间

### 3.1 线程 (MSC3440 / `m.thread`)

```bash
chainlesschain matrix thread send   --room !abc:server --root $eventId --body "回复"
chainlesschain matrix thread list   --room !abc:server --root $eventId
chainlesschain matrix thread roots  --room !abc:server
```

底层实现：在发送的事件上附加 `rel_type: m.thread`，并在 `matrix_threads`
表中索引收到的关系，使得 list 命令无需网络往返即可响应。

### 3.2 空间 (`m.space` / `m.space.child`)

```bash
chainlesschain matrix space create      --name "Acme 公司"
chainlesschain matrix space add-child   --space !space:s --child !room:s
chainlesschain matrix space children    --space !space:s
chainlesschain matrix space list
```

---

## 4. ActivityPub C2S

支持 Create (Note)、Follow / Accept / Undo、Like、Announce。Inbox
轮询可配置的 Actor；Outbox 是本地队列，通过 `POST /deliver` 投递。

```bash
chainlesschain activitypub actor create     --name alice --summary "建设者"
chainlesschain activitypub publish          --actor alice --content "你好联邦宇宙"
chainlesschain activitypub follow           --actor alice --target https://...
chainlesschain activitypub accept           --actor alice --follow-id <id>
chainlesschain activitypub unfollow         --actor alice --target https://...
chainlesschain activitypub like             --actor alice --target https://...
chainlesschain activitypub announce         --actor alice --target https://...
chainlesschain activitypub outbox           --actor alice
chainlesschain activitypub inbox            --actor alice
chainlesschain activitypub deliver          --actor alice
chainlesschain activitypub followers        --actor alice
chainlesschain activitypub following        --actor alice
```

`ap` 可作为 `activitypub` 的简写别名。

---

## 5. 社交图谱

带类型的有向边，支持权重和元数据，以及实时事件流。
支持的边类型：`follow`、`friend`、`like`、`mention`、`block`。

```bash
# 变更操作
chainlesschain social graph add-edge alice bob -t follow -w 1.0 -m '{"note":"线下认识"}'
chainlesschain social graph remove-edge alice bob -t follow

# 查询
chainlesschain social graph neighbors bob -d both --json
chainlesschain social graph snapshot -t follow

# 订阅 — 以 NDJSON 格式输出 edge:added/edge:removed/node:* 事件
chainlesschain social graph watch -e edge:added,edge:removed
chainlesschain social graph watch --once              # 收到第一个事件后退出
```

图谱默认存储在内存中，CLI 启动时从 `social_graph_edges` SQLite 表加载。
边操作具有幂等性 — 重复添加会就地更新权重和元数据。

---

## 6. 主题分类

多语言主题评分系统，支持可插拔词库。默认内置中文/英文/日文三语词库，
覆盖 8 个主题（`tech`、`finance`、`sports`、`food`、`travel`、
`music`、`politics`、`health`）。CJK 文本逐字分词，因此多字词组
（如"人工智能"）通过子串匹配实现。

```bash
chainlesschain social detect-lang "今日のサッカーの試合は素晴らしかった"
# → { "language": "ja" }

chainlesschain social analyze "AI and cloud computing" --top-k 3 --json
# → { language: "en", topics: [{topic:"tech", score:0.82, rawScore:5}, ...] }

chainlesschain social analyze "人工智能和云计算" --lang zh        # 强制指定语言
```

可通过 `topic-classifier` 库以编程方式注册自定义词库；
详见 `packages/cli/src/lib/topic-classifier.js`。

---

## 7. 数据存储位置

| 范围 | 存储位置 |
| --- | --- |
| Nostr 中继 + 事件 | SQLite `nostr_relays`、`nostr_events` |
| NIP-04 加密私信 | 存储在 `nostr_events` 中（kind 4，加密内容） |
| NIP-09 删除事件 | `nostr_events` kind 5（订阅时标记为墓碑） |
| Matrix 线程 | `matrix_threads` 索引表 |
| Matrix 空间 | `matrix_spaces`、`matrix_space_children` |
| ActivityPub | `ap_actors`、`ap_objects`、`ap_outbox`、`ap_inbox`、`ap_followers` |
| 社交图谱 | `social_graph_edges`（启动时加载到内存） |

所有表存储在 SQLCipher 加密的应用数据库中。

---

## 8. 故障排查

- **"Invalid checksum in npubXXX"** — 传入了手工输入或占位符字符串。
  npub/nsec 是 bech32 校验编码，请使用 `nostr keygen` 生成。
- **`dm` 时报 "ECDH failed"** — `--recipient-pubkey` 必须是 32 字节
  x-only hex 公钥（即 `nostr keygen` 输出的 `publicKeyHex`），
  **不是** npub bech32 格式。
- **`social graph watch` 挂起不退出** — 这是设计行为；
  使用 `--once` 获取单条事件后退出，或管道传给 `jq` 后用 Ctrl-C 退出。
- **`social analyze` 在强制 `--lang zh` 时仍返回英文主题** — 
  这是预期行为；当指定语言没有对应词条时，词库查找会回退到英文。
