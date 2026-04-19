# ActivityPub 联邦协议 (activitypub)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 👤 **Actor 管理**: 创建和管理本地/远程 ActivityPub 行为者（Person 类型）
- 📝 **内容发布**: 发布 Create(Note) 活动到行为者的 Outbox
- 🤝 **关注图谱**: Follow / Accept / Unfollow 完整关注流程
- 👍 **社交互动**: Like（点赞）和 Announce（转发/Boost）
- 📬 **收件/发件箱**: 查看 Outbox 和 Inbox 活动流
- 🔍 **联邦搜索**: 搜索本地索引中的行为者和笔记
- 📨 **模拟投递**: 将 JSON 活动推送到本地行为者的 Inbox

## 概述

ChainlessChain CLI ActivityPub 模块实现了 W3C ActivityPub Client-to-Server (C2S) 协议表面。支持行为者创建与管理、内容发布（Create/Note）、关注图谱管理（Follow/Accept/Undo）、社交互动（Like/Announce）、以及 Outbox/Inbox 读取。

网络投递为模拟模式 — `activitypub deliver` 可将 JSON 活动推送到本地行为者的 Inbox，适用于开发测试和本地联邦场景。别名 `ap` 可简写命令。

## 命令参考

### activitypub actor create — 创建行为者

```bash
chainlesschain activitypub actor create <username>
chainlesschain activitypub actor create alice --name "Alice" --summary "开发者"
chainlesschain activitypub actor create bob --origin https://example.com --json
```

创建本地 Person 类型行为者。`--name` 设置显示名，`--summary` 设置个人简介，`--origin` 指定行为者 ID 的域名。

### activitypub actor list — 列出行为者

```bash
chainlesschain activitypub actor list
chainlesschain activitypub actor list --local
chainlesschain activitypub actor list --remote --json
```

列出已知行为者。`--local` 仅显示本地行为者，`--remote` 仅显示远程行为者。

### activitypub actor show — 查看行为者

```bash
chainlesschain activitypub actor show <username>
chainlesschain activitypub actor show alice --json
```

查看行为者详细资料，包括 ID、名称、简介、Inbox/Outbox 地址和本地/远程状态。

### activitypub publish — 发布笔记

```bash
chainlesschain activitypub publish "Hello Fediverse!" -a alice
chainlesschain activitypub publish "回复内容" -a alice --reply-to <note-id>
chainlesschain activitypub publish "Hello" -a alice --to https://example.com/users/bob --json
```

以指定行为者身份发布 Create(Note) 活动。`--to` 和 `--cc` 设置受众，`--reply-to` 回复已有笔记。

### activitypub follow — 关注

```bash
chainlesschain activitypub follow <target> -a <actor>
chainlesschain activitypub follow bob -a alice --json
```

发布 Follow 活动。`<target>` 可以是用户名或行为者 URL。

### activitypub accept — 接受关注

```bash
chainlesschain activitypub accept <follow-activity-id> -a <actor>
chainlesschain activitypub accept act-123 -a bob --json
```

接受一个待处理的 Follow 请求。`-a` 指定被关注的行为者。

### activitypub unfollow — 取消关注

```bash
chainlesschain activitypub unfollow <target> -a <actor>
chainlesschain activitypub unfollow bob -a alice --json
```

发布 Undo(Follow) 活动，取消对目标行为者的关注。

### activitypub like — 点赞

```bash
chainlesschain activitypub like <object-id> -a <actor>
chainlesschain activitypub like https://example.com/notes/1 -a alice --json
```

对指定对象发布 Like 活动。

### activitypub announce — 转发

```bash
chainlesschain activitypub announce <object-id> -a <actor>
chainlesschain activitypub announce https://example.com/notes/1 -a alice --json
```

对指定对象发布 Announce（Boost/转发）活动。

### activitypub outbox — 查看发件箱

```bash
chainlesschain activitypub outbox <username>
chainlesschain activitypub outbox alice -n 10 -t Create --json
```

列出行为者的 Outbox 活动。`-n` 限制数量，`-t` 按活动类型过滤（Create/Follow/Like 等）。

### activitypub inbox — 查看收件箱

```bash
chainlesschain activitypub inbox <username>
chainlesschain activitypub inbox bob -n 20 -t Follow --json
```

列出行为者的 Inbox 活动。支持 `-n` 和 `-t` 过滤参数。

### activitypub deliver — 模拟投递

```bash
chainlesschain activitypub deliver <username> '<activity-json>'
chainlesschain activitypub deliver bob '{"type":"Create","actor":"https://remote.example/alice","object":{"type":"Note","content":"Hi"}}' --json
```

将 JSON 活动推送到本地行为者的 Inbox，用于模拟远程服务器投递。

### activitypub followers — 粉丝列表

```bash
chainlesschain activitypub followers <username>
chainlesschain activitypub followers alice --state accepted --json
```

列出行为者的粉丝。`--state` 按状态过滤（pending / accepted）。

### activitypub following — 关注列表

```bash
chainlesschain activitypub following <username>
chainlesschain activitypub following alice --state accepted --json
```

列出行为者正在关注的人。`--state` 按状态过滤。

### activitypub search — 联邦搜索

```bash
chainlesschain activitypub search "keyword"
chainlesschain activitypub search "dev" -t actors --scope local
chainlesschain activitypub search "hello" -t notes -a alice --since 2026-01-01 --json
```

搜索本地联邦索引中的行为者和/或笔记。`-t` 指定搜索目标（actors/notes/all），`-s` 指定范围（local/remote/all），`-a` 按作者过滤，`--since`/`--until` 按时间过滤。

## 系统架构

```
用户命令 → activitypub.js (Commander) → activitypub-bridge.js
                                               │
              ┌────────────────────────────────┼──────────────────────┐
              ▼                                ▼                      ▼
        Actor 管理                       活动发布/互动            Inbox/Outbox
   (create/list/show)        (publish/follow/like/announce)    (inbox/outbox/deliver)
              ▼                                ▼                      ▼
                            SQLite (activitypub_* 表)
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/activitypub.js` | activitypub 命令主入口（别名 `ap`） |
| `packages/cli/src/lib/activitypub-bridge.js` | C2S 桥接核心实现（Actor/Activity/Follow 图谱） |

## 配置参考

| 配置项 | 含义 | 默认 |
| ------ | ---- | ---- |
| `actor.kind` | 行为者类型 | Person / Service / Application |
| `publish.to` | 投递目标 | `followers` / 显式 URI 列表 |
| `deliver.queueSize` | 出站投递并发 | 8 |
| `search.scope` | 搜索范围 | `local` / `remote` / `all` |
| `search.indexBM25` | 索引算法 | `bm25`（默认） |
| V2 per-owner active cap | 见 `activitypub_bridge_v2_cli.md` | 15/25 |

## 性能指标

| 操作 | 典型耗时 | 备注 |
| ---- | -------- | ---- |
| `actor create` | < 20 ms | 本地 SQLite 写入 |
| `publish note` | < 30 ms（本地） | 远端投递异步化 |
| `follow` / `like` / `announce` | < 20 ms | 写入 activity + 事件 |
| `inbox list` / `outbox list` | < 50 ms | 带索引分页 |
| `search` | < 100 ms | BM25 本地联邦索引 |
| V2 createActivityV2 dispatch | < 50 ms | `activitypub_bridge_v2_cli.md` |

对公网实例投递耗时取决于远端 ActivityPub 服务器。

## 测试覆盖率

```
__tests__/unit/activitypub-bridge.test.js — 58 tests
```

覆盖：Actor CRUD、Note/Follow/Like/Announce 发布、Inbox/Outbox 分页、联邦搜索（actors/notes/all）、远端拉取与本地索引落库。V2 surface：39 V2 tests（见 `activitypub_bridge_v2_cli.md`）。

## 安全考虑

1. **远端身份验证**：接收入站活动时应校验 HTTP Signatures，CLI 当前以本地桥接为主，生产部署需叠加网关验签
2. **投递权限**：`publish to` 为 `followers` 时避免回环 URI；public 投递请人工确认
3. **索引脱敏**：`search` 默认只索引本地 + 已接收数据，不主动抓取第三方服务器
4. **速率限制**：大规模 `follow` 可能触发远端反垃圾；建议搭配外部 rate-limit 中间件
5. **审计**：所有活动写入 `activitypub_activities` 表，可追溯

## 使用示例

### 场景 1：创建行为者并发布内容

```bash
# 创建本地行为者
chainlesschain activitypub actor create alice --name "Alice" --summary "ChainlessChain 用户"

# 发布笔记
chainlesschain activitypub publish "Hello from ChainlessChain!" -a alice

# 查看发件箱
chainlesschain activitypub outbox alice
```

### 场景 2：关注与互动

```bash
# Alice 关注 Bob
chainlesschain activitypub follow bob -a alice

# Bob 接受关注请求
chainlesschain activitypub accept <follow-activity-id> -a bob

# Alice 点赞 Bob 的笔记
chainlesschain activitypub like <note-id> -a alice

# 查看粉丝列表
chainlesschain activitypub followers bob
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Actor not found" | 行为者未创建 | 使用 `actor create` 先创建 |
| "Database not available" | 数据库未初始化 | 运行 `chainlesschain db init` |
| JSON 解析失败 | deliver 的 JSON 格式错误 | 检查 JSON 字符串引号 |

## 相关文档

- [Nostr 协议](./cli-nostr) — Nostr NIP-04/09/25 协议集成
- [Matrix 协议](./cli-matrix) — Matrix 房间/线程/空间
- [社交图谱](./cli-social) — 社交关系与话题分析
