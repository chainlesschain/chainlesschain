# P2P 消息系统 (p2p)

CLI Phase 5 — P2P 点对点消息和设备配对。

## 命令概览

```bash
chainlesschain p2p status              # P2P 网络状态
chainlesschain p2p peers               # 列出已知 peer
chainlesschain p2p send <peer> "msg"   # 发送消息
chainlesschain p2p inbox               # 查看收件箱
chainlesschain p2p pair <device-name>  # 配对设备
chainlesschain p2p devices             # 列出已配对设备
chainlesschain p2p unpair <device-id>  # 解除配对
```

## 功能说明

### Peer 管理

- `registerPeer` — 注册新 peer（peer_id, 显示名, DID, 公钥, 设备类型）
- `getAllPeers` / `getOnlinePeers` — 查询 peer 列表
- `updatePeerStatus` — 更新 peer 在线状态

### 消息收发

- `sendMessage` — 发送文本消息，支持加密标记
- `getInbox` — 获取收件箱（支持仅未读过滤、分页）
- `markMessageRead` — 标记消息已读
- `getMessageCount` — 统计总消息/未读消息数

### 设备配对

- `pairDevice` — 生成 6 位配对码
- `confirmPairing` — 验证配对码确认配对
- `getPairedDevices` / `unpairDevice` — 设备管理

### 桌面桥接 (P2PBridge)

P2PBridge 类通过 HTTP 连接到桌面应用（默认 `localhost:9001`），支持：

- `checkBridge()` — 健康检查（5s 超时）
- `getStatus()` — 获取桥接状态

## 数据库表

| 表名 | 说明 |
|------|------|
| `p2p_peers` | peer 注册信息 |
| `p2p_messages` | 消息存储 |
| `p2p_paired_devices` | 已配对设备 |

## 依赖

- 纯 Node.js crypto（无外部依赖）
- 桌面桥接通过 HTTP fetch
