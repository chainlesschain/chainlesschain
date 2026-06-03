# 社交平台 (social)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 👤 **联系人管理**: 添加、查看、列出和删除联系人，支持 DID 和邮箱
- 🤝 **好友系统**: 发送好友请求、管理好友列表、查看待处理请求
- 📝 **动态发布**: 发布社交动态、浏览动态流、点赞互动
- 💬 **即时聊天**: 点对点消息发送、会话线程管理
- 📊 **社交统计**: 联系人数、好友数、动态数、消息数等指标

## 概述

ChainlessChain CLI 社交平台模块提供完整的去中心化社交功能。`contact` 子命令管理联系人，支持绑定 DID 身份和邮箱。`friend` 子命令实现好友请求和管理，包括发送请求、接受、移除和查看待处理请求。

`post` 子命令支持发布社交动态、浏览动态流和点赞。`chat` 子命令提供点对点即时消息，自动创建会话线程。`stats` 汇总社交活动数据。

## 命令参考

### social contact add — 添加联系人

```bash
chainlesschain social contact add <name>
chainlesschain social contact add "Alice" -d "did:chainless:abc123" -e "alice@example.com"
chainlesschain social contact add "Bob" -n "同事，开发团队"
```

添加联系人，可附带 DID、邮箱和备注。

### social contact list — 联系人列表

```bash
chainlesschain social contact list
chainlesschain social contact list --json
```

列出所有联系人。

### social contact show — 查看联系人

```bash
chainlesschain social contact show <contact-id>
chainlesschain social contact show ct-001 --json
```

查看联系人详细信息。

### social contact delete — 删除联系人

```bash
chainlesschain social contact delete <contact-id>
chainlesschain social contact delete ct-001
```

删除指定联系人。

### social friend add — 发送好友请求

```bash
chainlesschain social friend add <contact-id>
chainlesschain social friend add ct-001
```

向指定联系人发送好友请求。

### social friend list — 好友列表

```bash
chainlesschain social friend list
chainlesschain social friend list --json
```

列出所有好友及其状态。

### social friend remove — 移除好友

```bash
chainlesschain social friend remove <contact-id>
chainlesschain social friend remove ct-001
```

移除指定好友。

### social friend pending — 待处理请求

```bash
chainlesschain social friend pending
chainlesschain social friend pending --json
```

列出所有待处理的好友请求。

### social post publish — 发布动态

```bash
chainlesschain social post publish <content>
chainlesschain social post publish "今天完成了新功能的开发！" -a alice
```

发布社交动态。`--author` 指定作者（默认 cli-user）。

### social post list — 动态列表

```bash
chainlesschain social post list
chainlesschain social post list -a alice --json
```

列出动态流，支持按作者过滤。

### social post like — 点赞

```bash
chainlesschain social post like <post-id>
chainlesschain social post like post-001
```

为指定动态点赞。

### social chat send — 发送消息

```bash
chainlesschain social chat send <recipient> <message>
chainlesschain social chat send bob "你好，明天有空开会吗？" -s alice
```

向指定接收者发送消息。`--sender` 指定发送者（默认 cli-user）。

### social chat messages — 会话消息

```bash
chainlesschain social chat messages <thread-id>
chainlesschain social chat messages thr-001 -n 20
chainlesschain social chat messages thr-001 --json
```

获取指定会话线程的消息历史。

### social chat threads — 会话列表

```bash
chainlesschain social chat threads
chainlesschain social chat threads --json
```

列出所有聊天会话线程。

### social stats — 社交统计

```bash
chainlesschain social stats
chainlesschain social stats --json
```

显示社交统计：联系人数、好友数、动态数、消息数、待处理请求数。

## 数据库表

| 表名 | 说明 |
|------|------|
| `social_contacts` | 联系人（名称、DID、邮箱、备注、创建时间） |
| `social_friends` | 好友关系（联系人 ID、状态、创建时间） |
| `social_posts` | 社交动态（内容、作者、点赞数、创建时间） |
| `social_messages` | 聊天消息（线程 ID、发送者、接收者、内容、时间戳） |

## 系统架构

```
用户命令 → social.js (Commander) → social-manager.js
                                          │
           ┌─────────────┬───────────────┼───────────────┬─────────────┐
           ▼             ▼               ▼               ▼             ▼
      联系人管理      好友系统        动态发布        即时聊天        统计
   (CRUD 操作)   (请求/接受)    (发布/点赞)    (消息/线程)      (汇总)
           ▼             ▼               ▼               ▼
   social_contacts  social_friends  social_posts  social_messages
```

## 配置参考

```bash
# CLI 标志
-d, --did <did>        # DID 身份绑定 (contact add)
-e, --email <email>    # 邮箱绑定 (contact add)
-n, --note <note>      # 联系人备注 (contact add)
-a, --author <name>    # 动态作者 (post publish / list)
-s, --sender <name>    # 消息发送者 (chat send)
-n, --limit <n>        # 消息条数 (chat messages)
--json                 # JSON 格式输出

# 配置路径
~/.chainlesschain/chainlesschain.db    # social_contacts / social_friends / social_posts / social_messages 表
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| contact list (100 条) | < 50ms | ~25ms | ✅ |
| friend add (请求) | < 30ms | ~15ms | ✅ |
| post publish | < 30ms | ~15ms | ✅ |
| chat send (单条) | < 50ms | ~25ms | ✅ |
| chat messages (20 条) | < 40ms | ~20ms | ✅ |
| stats 汇总 | < 30ms | ~15ms | ✅ |

## 测试覆盖率

```
✅ social-manager.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/social.js` — 命令实现
- `packages/cli/src/lib/social-manager.js` — 社交管理库

## 测试

```bash
npx vitest run __tests__/unit/social-manager.test.js
# 41 tests, all pass
```

## 使用示例

### 场景 1：联系人与好友

```bash
# 添加联系人
chainlesschain social contact add "Alice" \
  -d "did:chainless:abc123" \
  -e "alice@example.com" \
  -n "技术团队核心成员"

chainlesschain social contact add "Bob" \
  -e "bob@example.com"

# 发送好友请求
chainlesschain social friend add ct-001

# 查看待处理请求
chainlesschain social friend pending

# 查看好友列表
chainlesschain social friend list --json
```

### 场景 2：动态与聊天

```bash
# 发布动态
chainlesschain social post publish "ChainlessChain v5.0 发布！" -a alice

# 点赞
chainlesschain social post like post-001

# 查看动态流
chainlesschain social post list

# 发送消息
chainlesschain social chat send bob "恭喜新版本发布！"

# 查看聊天线程
chainlesschain social chat threads

# 查看消息历史
chainlesschain social chat messages thr-001

# 查看统计
chainlesschain social stats --json
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "No contacts" | 未添加联系人 | 使用 `social contact add` |
| "No friends" | 无好友关系 | 先添加联系人再发送好友请求 |
| "No posts" | 无动态 | 使用 `social post publish` 发布 |
| 消息发送后找不到线程 | 线程 ID 变化 | 使用 `social chat threads` 查看最新线程 |

## 安全考虑

- **DID 绑定**: 联系人可绑定 DID 身份，确保身份可验证
- **消息加密**: 聊天消息存储在加密数据库中
- **隐私保护**: 动态和消息仅在本地存储，不自动同步
- **好友审核**: 好友关系需双方确认，防止骚扰

## 相关文档

- [DID 身份](./cli-did) — 去中心化身份管理
- [P2P 通信](./cli-p2p) — 点对点加密通信
- [Nostr 桥接](./cli-nostr) — Nostr 去中心化社交
