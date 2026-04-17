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
