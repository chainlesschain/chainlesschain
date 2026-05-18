# IPFS 去中心化存储 CLI（Phase 17）

> `chainlesschain ipfs` — IPFS 节点管理、内容存取、Pin 管理与知识附件。
>
> 模拟 CID（bafy+sha256）+ AES-256-GCM 加密 + 配额管理 + 垃圾回收。

---

## 目录

- [概述](#概述)
- [目录/枚举](#目录枚举)
- [节点生命周期](#节点生命周期)
- [内容操作](#内容操作)
- [Pin 管理](#pin-管理)
- [统计 & 配额 & GC](#统计--配额--gc)
- [知识附件](#知识附件)

---

## 概述

IPFS 模块在本地模拟去中心化内容寻址存储，所有内容通过 CID（Content Identifier）
索引。支持内容加密、Pin 持久化、配额限额与自动 GC。知识附件功能允许将 IPFS 内容
关联到知识库条目。

---

## 核心特性

- **CID 内容寻址** — `bafy` 前缀 + SHA-256 哈希，幂等存储（相同内容同一 CID）
- **三种节点模式** — `full`（完整节点）、`light`（轻节点）、`gateway`（网关模式）
- **AES-256-GCM 加密** — `--encrypt` 标志开启，密钥派生自配置的主密钥
- **Pin 管理** — Pin 的内容不被 GC 清理，unpin 后下次 GC 释放空间
- **配额控制** — `set-quota` 设置存储上限，写入超限时报错
- **知识附件** — CID ↔ 知识库 note 双向关联，便于大文件与条目解耦存储
- **V2 治理层** — 83 V2 tests 覆盖 gateway maturity + pin lifecycle（`ipfs_v2_phase17_cli.md`）

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│           chainlesschain ipfs (Phase 17)              │
├──────────────────────────────────────────────────────┤
│  Node State Machine                                   │
│  stopped → starting → running → error                 │
│  modes: full / light / gateway                        │
├──────────────────────────────────────────────────────┤
│  Content Store (CID-indexed)                          │
│  add → sha256 → CID → blob + metadata                 │
│  optional AES-256-GCM encryption                      │
├──────────────────────────────────────────────────────┤
│  Pin Registry          │  Quota & GC                  │
│  pin/unpin             │  byte count / GC unpinned    │
├──────────────────────────────────────────────────────┤
│  Knowledge Attachments                                │
│  CID ↔ note_id                                        │
├──────────────────────────────────────────────────────┤
│  SQLite: ipfs_blobs / ipfs_pins / ipfs_attachments    │
└──────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项           | 含义                   | 默认          |
| ---------------- | ---------------------- | ------------- |
| `node.mode`      | 节点模式               | full          |
| `default.quota`  | 默认配额               | 10 GB         |
| `gc.strategy`    | GC 策略                | unpinned-only |
| `encrypt.alg`    | 加密算法               | AES-256-GCM   |
| `cid.prefix`     | CID 前缀               | bafy          |
| V2 gateway caps  | per-operator active + per-owner pending-pin | 见备忘录 |

枚举：`chainlesschain ipfs modes`、`ipfs statuses`。

---

## 性能指标

| 操作                     | 典型耗时          |
| ------------------------ | ----------------- |
| add（1 KB 文本）         | < 10 ms           |
| add（1 MB 文件）         | < 50 ms           |
| add --encrypt（1 MB）    | < 80 ms           |
| get（已 pin）            | < 15 ms           |
| pin / unpin              | < 10 ms           |
| gc --dry-run（1000 obj）| < 50 ms           |
| V2 auto-offline 心跳超时 | 默认 stale 阈值见 memory 文件 |

---

## 测试覆盖率

```
__tests__/unit/ipfs-storage.test.js — 83 tests (929 lines)
```

覆盖：node 启停/mode 切换、add 幂等与哈希、encrypt 圆迹（encrypt→get→decrypt）、
pin 防 GC、quota 超限报错、gc dry-run/实际清理、attachment CID↔note 双向、
状态机非法转换拒绝。
V2 surface：83 V2 tests（见 `ipfs_v2_phase17_cli.md`）。

---

## 安全考虑

1. **加密只保护内容，不隐藏 CID** — CID 本身由内容哈希决定，对第三方仍可见
2. **密钥管理** — 加密主密钥来自配置；丢失后 encrypted 内容无法还原
3. **配额防 DoS** — 超过 quota 时 `add` 失败，防止磁盘被恶意填满
4. **GC 幂等** — `gc --dry-run` 输出待清理列表，执行后不可恢复
5. **附件权限** — attach/detach 只操作关联关系，不复制 CID 内容，不存在多份副本

---

## 故障排查

**Q: `get <cid>` 返回 "not found"?**

1. 确认 CID 拼写正确（`ipfs list` 对比）
2. 该 CID 是否已被 GC（未 pin 的内容可能已回收）
3. 节点状态是否 running（`node-status`）

**Q: `add` 返回 quota exceeded?**

1. `ipfs stats` 查看当前占用
2. `gc` 清理未 pin 内容释放空间
3. `set-quota` 调大上限

**Q: 加密内容 `get` 后显示乱码?**

1. 加密内容无法通过 CID 直读，需由本节点 decrypt
2. 若密钥已变更，旧内容无法还原——考虑重新 `add` 后 `unpin` 旧 CID
3. 用 `show <cid>` 查看元数据 `encrypted: true` 确认

---

## 关键文件

- `packages/cli/src/commands/ipfs.js` — Commander 子命令（~710 行）
- `packages/cli/src/lib/ipfs-storage.js` — CID 哈希 + 加密 + GC
- `packages/cli/__tests__/unit/ipfs-storage.test.js` — 单测（83 tests）
- 数据表：`ipfs_blobs` / `ipfs_pins` / `ipfs_attachments`
- 设计文档：`docs/design/modules/17_IPFS去中心化存储.md`

---

## 使用示例

```bash
# 1. 启动节点 + 添加加密文件
chainlesschain ipfs node-start --mode light
cid=$(chainlesschain ipfs add --file ./secret.pdf --encrypt --json | jq -r .cid)
chainlesschain ipfs pin $cid

# 2. 查看 + 统计
chainlesschain ipfs show $cid
chainlesschain ipfs stats

# 3. 关联到知识库条目
chainlesschain ipfs attach $cid --note note-001
chainlesschain ipfs attachments --note note-001

# 4. 配额 + GC
chainlesschain ipfs set-quota 5GB
chainlesschain ipfs gc --dry-run
chainlesschain ipfs gc

# 5. 停止节点
chainlesschain ipfs node-stop
```

---

## 目录/枚举

```bash
chainlesschain ipfs modes       # 列出节点模式（full / light / gateway）
chainlesschain ipfs statuses    # 列出节点状态（stopped / starting / running / error）
```

---

## 节点生命周期

```bash
# 启动 IPFS 节点
chainlesschain ipfs node-start
chainlesschain ipfs node-start --mode light

# 停止节点
chainlesschain ipfs node-stop

# 查看节点状态与运行时间
chainlesschain ipfs node-status

# 设置节点模式
chainlesschain ipfs set-mode gateway
```

---

## 内容操作

```bash
# 添加内容到存储（返回 CID）
chainlesschain ipfs add "Hello, IPFS!"
chainlesschain ipfs add --file ./document.pdf
chainlesschain ipfs add --file ./photo.jpg --encrypt    # AES-256-GCM 加密

# 根据 CID 获取内容
chainlesschain ipfs get <cid>

# 查看内容元数据
chainlesschain ipfs show <cid>

# 列出所有内容
chainlesschain ipfs list
chainlesschain ipfs list --json
```

---

## Pin 管理

```bash
# Pin 内容（防止 GC 清理）
chainlesschain ipfs pin <cid>

# 取消 Pin
chainlesschain ipfs unpin <cid>

# 列出已 Pin 内容
chainlesschain ipfs pins
```

---

## 统计 & 配额 & GC

```bash
# 存储统计
chainlesschain ipfs stats
chainlesschain ipfs stats --json

# 设置存储配额
chainlesschain ipfs set-quota 10GB

# 垃圾回收（清理未 Pin 的内容）
chainlesschain ipfs gc
chainlesschain ipfs gc --dry-run    # 仅预览将清理的内容
```

---

## 知识附件

```bash
# 将 IPFS 内容附加到知识库条目
chainlesschain ipfs attach <cid> --note <note-id>

# 列出某条目的所有附件
chainlesschain ipfs attachments --note <note-id>
```

---

## 相关文档

- 设计文档：`docs/design/modules/17_IPFS去中心化存储.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [Knowledge Exporter →](/chainlesschain/cli-export)
- [Note Versioning →](/chainlesschain/cli-note)
- [Encrypt (Crypto Manager) →](/chainlesschain/cli-encrypt)
