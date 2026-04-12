# Nostr 桥接 (nostr)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📡 **中继管理**: 添加和管理 Nostr 中继节点
- 📝 **事件发布**: 发布文本笔记和自定义类型事件
- 🔑 **密钥生成**: 生成 Nostr 密钥对（公钥 + 私钥）
- 🆔 **DID 映射**: 将 DID 身份映射到 Nostr 公钥

## 概述

ChainlessChain CLI Nostr 桥接模块实现了与 Nostr 去中心化社交协议的集成。Nostr 使用基于 NIP-01 的事件结构，通过中继（relay）网络进行消息传播。

`relays` 和 `add-relay` 管理中继节点连接。`publish` 发布事件到所有已连接的中继，支持 NIP-01 定义的 kind 类型（kind=1 为文本笔记）。`events` 查看已接收的事件。`keygen` 生成 Nostr 密钥对。`map-did` 建立 ChainlessChain DID 身份与 Nostr 公钥的双向映射。

## 命令参考

### nostr relays — 查看中继

```bash
chainlesschain nostr relays
chainlesschain nostr relays --json
```

列出所有已配置的 Nostr 中继，显示 URL、状态和事件计数。

### nostr add-relay — 添加中继

```bash
chainlesschain nostr add-relay <url>
chainlesschain nostr add-relay wss://relay.damus.io
chainlesschain nostr add-relay wss://nos.lol
```

添加一个 Nostr 中继节点。

### nostr publish — 发布事件

```bash
chainlesschain nostr publish <content>
chainlesschain nostr publish "Hello Nostr from ChainlessChain!"
chainlesschain nostr publish "自定义事件" -k 30023 -p npub1...
```

发布一个 Nostr 事件。`--kind` 指定事件类型（默认 1 = 文本笔记），`--pubkey` 指定作者公钥。

NIP-01 事件结构：
```json
{
  "id": "<sha256 hash>",
  "pubkey": "<author public key>",
  "created_at": 1234567890,
  "kind": 1,
  "content": "Hello Nostr!",
  "tags": [],
  "sig": "<signature>"
}
```

### nostr events — 查看事件

```bash
chainlesschain nostr events
chainlesschain nostr events -k 1 -n 20
chainlesschain nostr events --json
```

列出已接收的事件，支持按 kind 过滤和限制返回数量。

### nostr keygen — 生成密钥对

```bash
chainlesschain nostr keygen
chainlesschain nostr keygen --json
```

生成一个 Nostr 密钥对，包含公钥和私钥。

### nostr map-did — DID 映射

```bash
chainlesschain nostr map-did <did> <pubkey>
chainlesschain nostr map-did "did:chainless:abc123" "npub1xyz..."
```

将 ChainlessChain DID 身份映射到 Nostr 公钥，建立跨协议身份关联。

## 数据库表

| 表名 | 说明 |
|------|------|
| `nostr_relays` | 中继节点（URL、状态、事件计数、最后连接时间） |
| `nostr_events` | 事件记录（事件 ID、公钥、类型、内容、标签、签名、时间戳） |

## 连接架构

### WebSocket 连接

Nostr 桥接使用真实 WebSocket（`ws` 模块）连接中继节点，支持：

- **自动重连**: 连接断开后使用指数退避策略自动重连（1s → 2s → 4s → ... → 60s 最大间隔）
- **NIP-01 消息处理**: 完整支持 `["EVENT", ...]`、`["EOSE", ...]`、`["OK", ...]`、`["NOTICE", ...]` 四种标准消息类型
- **多中继并发**: 事件同时发布到所有已连接的中继，统计成功/失败计数
- **连接状态管理**: 每个中继独立追踪 `connected` / `disconnected` / `error` 状态

```
连接生命周期:
1. new WebSocket(relayUrl) → ws.on("open") → status: connected
2. ws.on("message") → 解析 NIP-01 消息 → 分发到事件处理器
3. ws.on("close") → status: disconnected → 调度指数退避重连
4. ws.on("error") → status: error → 记录错误日志
```

### 事件发布流程

```
publishEvent(content, kind, tags)
  → 构造 NIP-01 事件对象
  → 序列化为 JSON
  → 遍历所有 status=connected 的中继
  → ws.send(["EVENT", event]) 
  → 统计 sentCount / failedCount
```

## 系统架构

```
用户命令 → nostr.js (Commander) → nostr-bridge.js
                                         │
                ┌───────────────────────┼───────────────────────┐
                ▼                       ▼                       ▼
          中继管理                 事件引擎                 身份桥接
     (WebSocket连接)        (发布/查询/NIP-01)        (密钥生成/DID映射)
     (指数退避重连)                  ▼                       ▼
                ▼              nostr_events           DID ↔ Nostr 映射
         nostr_relays
```

## 关键文件

- `packages/cli/src/commands/nostr.js` — 命令实现
- `packages/cli/src/lib/nostr-bridge.js` — Nostr 桥接库
- `desktop-app-vue/src/main/social/nostr-bridge.js` — Desktop Nostr 引擎（真实 WebSocket + NIP-01）

## 测试

```bash
# CLI 单元测试
cd packages/cli && npx vitest run __tests__/unit/nostr-bridge.test.js
# 22 tests, all pass

# Desktop WebSocket 单元测试
cd desktop-app-vue && npx vitest run tests/unit/social/nostr-bridge-ws
# 26 tests, all pass
```

## 使用示例

### 场景 1：连接中继并发布

```bash
# 添加中继节点
chainlesschain nostr add-relay wss://relay.damus.io
chainlesschain nostr add-relay wss://nos.lol

# 生成密钥对
chainlesschain nostr keygen --json

# 发布文本笔记
chainlesschain nostr publish "第一条 Nostr 消息！" -p npub1...

# 查看事件
chainlesschain nostr events -k 1
```

### 场景 2：DID 身份映射

```bash
# 创建 DID 身份
chainlesschain did create

# 生成 Nostr 密钥对
chainlesschain nostr keygen

# 建立 DID ↔ Nostr 映射
chainlesschain nostr map-did "did:chainless:abc123" "npub1xyz..."

# 查看中继状态
chainlesschain nostr relays --json
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "No relays configured" | 未添加中继 | 使用 `nostr add-relay <url>` |
| 发布事件后 sentCount=0 | 中继不可达 | 检查中继 URL 和网络连接 |
| 事件列表为空 | 未发布或中继无事件 | 先发布事件或更换中继 |

## 安全考虑

- **密钥安全**: 私钥存储在加密数据库中，终端输出仅显示截断的私钥
- **签名验证**: 所有事件使用 Schnorr 签名，确保事件完整性
- **DID 绑定**: DID 映射建立可验证的跨协议身份链
- **中继冗余**: 支持多中继配置，消息同步发布到所有中继

## 相关文档

- [DID 身份](./cli-did) — 去中心化身份管理
- [P2P 通信](./cli-p2p) — 点对点加密通信
- [Matrix 桥接](./cli-matrix) — Matrix 协议集成
