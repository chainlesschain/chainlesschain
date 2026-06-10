# 同步 Provider 凭据与运行（cc sync webdav / cc sync oss）

> **版本: Phase 3c follow-up（v0.1 凭据 + v0.2 test/run） | 状态: ✅ 生产可用 | 36 单元测试全绿（凭据 24 + 引擎 12）**
>
> `cc sync webdav` / `cc sync oss` 是挂在 `cc sync` 父命令下的两个 provider 子命令组，提供**外部同步后端的凭据管理（configure / status / clear）+ 连通性探测（test）+ 单次全量同步（run）**。凭据以 AES-256-GCM 加密落 `~/.chainlesschain/sync-credentials.enc`，与桌面 secure-config 同 shape。

## 概述

CLI 没法用 Electron 的 `safeStorage`，因此这里搭了一个 file-based 等价物：32 字节随机 master key 落 `~/.chainlesschain/sync-credentials.key`（Unix mode 0600），凭据 JSON 用 AES-256-GCM 加密落 `sync-credentials.enc`（文件布局 `[iv 12B][auth tag 16B][ciphertext]`）。`status` 永远输出**脱敏后**的凭据（password / secretAccessKey 显示为 `********`）。

`test` 做真实连通性探测（WebDAV 用 PROPFIND，S3/OSS 用 HeadBucket）；`run` 对本机 CLI vault（`~/.chainlesschain/cli-vault.db`，普通 SQLite）执行一次完整同步：先排空 tombstone（远端删除），再按游标分批推送 knowledge_items 渲染出的 Markdown 文件。

## 核心特性

- 🔐 **AES-256-GCM 凭据库**：master key 自动生成（32B random），凭据加密落盘；与 desktop `secure-config-storage.js` 镜像 `SENSITIVE_FIELDS` 脱敏
- 🌐 **两个 provider**：`webdav`（Nextcloud / 坚果云 / 群晖）与 `oss`（AWS S3 / 阿里云 OSS / R2 / B2，S3 兼容协议）——`ALLOWED_PROVIDER_IDS` 白名单，其它一律拒绝
- 🩺 **真连通性探测（test）**：WebDAV 对 remotePath 发 PROPFIND；OSS 发 HeadBucket，失败给出 HTTP 状态 + 错误并以退出码 2 结束
- 🔁 **指数退避重试**：客户端层对 429 / 5xx 最多重试 3 次，退避 500ms 起步、上限 8000ms（带 jitter）
- 📦 **游标增量推送（run）**：每批 200 条，先排空 tombstone 删除队列，再 `fetchBatch → putFile → recordPushed → 推进游标`
- 📈 **进度节流**：引擎每 5 条/500ms 刷一次进度，CLI stdout 再按 ≥1000ms 节流（start / success / conflict / failed 事件即时打印）
- 🧹 **clear 幂等**：未配置时提示 "(already empty)" 不报错
- 🪪 **status 全脱敏**：原始密钥永不出现在 stdout，输出标注加密文件位置

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│ cc sync webdav|oss  configure / status / clear / test / run  │
└────────┬─────────────────────────────┬───────────────────────┘
         │ 凭据读写                      │ test / run
         ▼                             ▼
┌──────────────────────┐   ┌─────────────────────────────────┐
│ sync-credentials.js  │   │ WebDAVClient（PROPFIND/PUT/DEL） │
│ AES-256-GCM          │   │ OSSClient（HeadBucket/PutObject）│
│ ~/.chainlesschain/   │   │  429/5xx 重试 ≤3 次，退避带 jitter│
│  sync-credentials.key│   └──────────────┬──────────────────┘
│  sync-credentials.enc│                  │ run
└──────────────────────┘                  ▼
                          ┌─────────────────────────────────┐
                          │ sync-engine-cli.js               │
                          │ ① ensureCursor                   │
                          │ ② 排空 tombstones（远端删除）      │
                          │ ③ fetchBatch(200)→putFile→游标    │
                          └──────────────┬──────────────────┘
                                         ▼
                          ┌─────────────────────────────────┐
                          │ ~/.chainlesschain/cli-vault.db   │
                          │ knowledge_items + cursor +       │
                          │ tombstones（删除触发器自动入队）    │
                          └─────────────────────────────────┘
```

## 命令参考

```bash
# WebDAV
cc sync webdav configure --url <url> [--username <name>] --password <pw> [--remote-path <p>]
cc sync webdav status        # 显示脱敏凭据 + configured 标记（JSON）
cc sync webdav clear         # 擦除凭据
cc sync webdav test          # PROPFIND 连通性探测
cc sync webdav run [-v]      # 对 cli-vault.db 跑一次全量同步

# S3 / OSS
cc sync oss configure --endpoint <url> [--region <r>] --bucket <name> \
    --access-key-id <id> --secret-access-key <secret> \
    [--remote-path <p>] [--force-path-style]
cc sync oss status
cc sync oss clear
cc sync oss test             # HeadBucket 连通性探测
cc sync oss run [-v]
```

| 选项 | 适用 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `--url <url>` | webdav | ✅ | — | WebDAV 端点 URL |
| `--username <name>` | webdav | | `""` | WebDAV 用户名 |
| `--password <pw>` | webdav | ✅ | — | 密码（v0.1 仅 flag，**会留 shell history**；stdin 提示留 v0.2） |
| `--remote-path <p>` | 两者 | | webdav `/`，oss `""` | 远端目录 / object key 前缀 |
| `--endpoint <url>` | oss | ✅ | — | S3 兼容端点（如 `https://oss-cn-hangzhou.aliyuncs.com`） |
| `--region <r>` | oss | | `auto` | R2 用 auto；AWS / 阿里云填显式 region |
| `--bucket <name>` | oss | ✅ | — | 目标 bucket |
| `--access-key-id <id>` | oss | ✅ | — | access key id |
| `--secret-access-key <secret>` | oss | ✅ | — | secret（同样会留 shell history，stdin 留 v0.2） |
| `--force-path-style` | oss | | 关 | path-style URL（R2 / MinIO 需要） |
| `-v, --verbose` | run | | 关 | 显示 vault 路径 + 详细进度 |

所有失败路径统一 `process.exitCode = 2`。

## 配置参考

- **凭据目录**：`CHAINLESSCHAIN_HOME` 环境变量优先，否则 `~/.chainlesschain/`。
- **`sync-credentials.key`**：32 字节随机 master key，自动生成，Unix `chmod 0600`（NTFS 上 chmod 容错不致命）。长度不对（被截断/篡改）直接报错拒载。
- **`sync-credentials.enc`**：AES-256-GCM 加密的凭据 JSON，文件布局 `[iv 12B][tag 16B][ciphertext]`。解密失败给出「库损坏或 master key 已换，删除后重新 configure」指引。
- **脱敏字段**：`sync.webdav.password`、`sync.oss.secretAccessKey`（镜像 desktop `secure-config-storage.js`），status 输出一律 `********`。
- **CLI vault**：`~/.chainlesschain/cli-vault.db`，普通 SQLite（无 SQLCipher）——加密在 OS 文件权限层；要强加密用桌面 + 硬件 U-Key。首次打开自动建 3 张同步表 + 删除触发器（knowledge_items / sync_external_provider_cursor / sync_external_tombstones）。
- **注册顺序约束**：`registerSyncProviderCommands` 必须在 `registerSyncCommand` 之后调用（它在已注册的 `sync` 父命令上挂子命令，找不到父命令直接抛错）。

## 性能指标

- **重试策略（WebDAV / OSS 客户端共用）**：仅 429 与 5xx 可重试，最多 **3 次**（`RETRY_MAX=3`），指数退避 **500ms × 2^(n-1)**、上限 **8000ms**、带 jitter。
- **推送批量**：`fetchBatch` 每批 **200** 条，按游标（时间戳 + id）增量推进。
- **tombstone 排空上限**：单次 run 最多取 **1000** 条删除队列（`listTombstones limit=1000`）。
- **进度节流**：引擎每 **5 条 / 500ms** 刷一次（`PROGRESS_FLUSH_EVERY=5` / `PROGRESS_FLUSH_MS=500`）；CLI stdout 额外按 **≥1000ms** 节流，避免 TTY 刷屏。
- **错误信息截断**：失败项 `last_error` 截前 **500** 字符入库。
- run 结束打印 `pushed / skipped / deleted / durationMs` 实测统计；端到端吞吐取决于远端，基准数据待补。

## 测试覆盖

共 **36** 个单元测试（`it(` 计数）：

| 文件 | 数量 | 覆盖 |
|------|------|------|
| `packages/cli/src/lib/__tests__/sync-credentials.test.js` | 24 | 加解密往返、master key 生成/长度校验、脱敏、provider 白名单、clear 幂等等 |
| `packages/cli/src/lib/__tests__/sync-engine-cli.test.js` | 12 | 游标推进、tombstone 排空、批量推送、失败记录等引擎流程 |

```bash
cd packages/cli
npx vitest run src/lib/__tests__/sync-credentials.test.js src/lib/__tests__/sync-engine-cli.test.js
```

> 命令层（`sync-providers.js` 的 flag 解析/接线）目前没有独立的命令级测试文件，行为由上述两个 lib 测试 + commander 声明保障。

## 安全考虑

- **凭据静态加密**：AES-256-GCM（认证加密，篡改即解密失败），master key 文件 0600。威胁模型：root/admin 能读 key 文件即破——与 `~/.netrc`、`~/.aws/credentials` 同 baseline；OS keyring 强加密留 v0.2。
- **status 永远脱敏**：`getCredentialsSanitized` 深拷贝后按 `SENSITIVE_FIELDS` 点路径打码，原始 secret 不出现在任何 stdout。
- **⚠️ shell history 留痕**：v0.1 的 `--password` / `--secret-access-key` 是命令行 flag，**会进 shell history**——configure 后建议清理 history；stdin 提示在 v0.2 规划中（flag 描述里已明示该风险）。
- **provider 白名单**：仅 `webdav` / `oss` 两个 id 合法，其它一律抛错，防止任意键写入凭据库。
- **损坏即拒**：master key 长度不符或 enc 文件解密失败都会硬报错并给出恢复指引，不会静默用坏数据。

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `--password required` / `--secret-access-key required` | v0.1 仅支持 flag 传入 | 用 flag 提供（注意 history 留痕）；stdin 留 v0.2 |
| `decrypt failed … Vault may be corrupted or master key changed` | enc 文件损坏或 key 被换 | `rm ~/.chainlesschain/sync-credentials.enc` 后重新 configure |
| `master key file … has wrong length` | key 文件被截断/篡改 | 确认无并发写坏；确属故意则删 key + enc 重新生成 |
| `凭据未配置，先跑 cc sync <provider> configure` | test/run 前没 configure | 先跑对应 `configure` |
| `✗ webdav 连接失败 (401/403)` | 账号密码错 / 应用专用密码未启用 | 坚果云等需在网页端生成应用密码；核对 `--url` 与 `--username` |
| `✗ oss 连接失败` | endpoint/region/bucket 不匹配，或 R2/MinIO 未开 path-style | 核对 endpoint；R2 / MinIO 加 `--force-path-style` |
| run 报 `BETTER_SQLITE3_MISSING` | native better-sqlite3 不可用（run 必须 native vault） | `npm rebuild better-sqlite3` 后重试 |
| 进度长时间无输出 | stdout 节流（≥1000ms）+ 批内静默 | 加 `-v` 看 vault 路径；start/success/failed 事件总会打印 |
| `parent sync command not registered yet` | 注册顺序错误（开发场景） | `registerSyncProviderCommands` 必须在 `registerSyncCommand` 之后调用 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/sync-providers.js` | `cc sync webdav/oss` 子命令组（configure/status/clear/test/run 接线） |
| `packages/cli/src/lib/sync-credentials.js` | AES-256-GCM 凭据库（master key、加解密、脱敏、白名单） |
| `packages/cli/src/lib/sync-webdav-client.js` | WebDAV 客户端（PROPFIND 探测、PUT/DELETE，429/5xx 重试） |
| `packages/cli/src/lib/sync-oss-client.js` | S3/OSS 客户端（HeadBucket 探测、PutObject，相同重试策略） |
| `packages/cli/src/lib/sync-engine-cli.js` | 同步引擎（游标、tombstone 排空、批量 200 推送、Markdown 渲染） |
| `packages/cli/src/lib/sync-cli-db.js` | CLI vault（`~/.chainlesschain/cli-vault.db`，自动建表 + 删除触发器） |
| `packages/cli/src/lib/__tests__/sync-credentials.test.js` | 24 单元测试 |
| `packages/cli/src/lib/__tests__/sync-engine-cli.test.js` | 12 单元测试 |

## 使用示例

```bash
# 1) 配置 WebDAV（坚果云示例）
cc sync webdav configure \
  --url https://dav.jianguoyun.com/dav/ \
  --username me@example.com \
  --password "<应用专用密码>" \
  --remote-path /chainlesschain

# 2) 查看脱敏凭据（password 显示 ********）
cc sync webdav status

# 3) 探测连通性（PROPFIND）
cc sync webdav test

# 4) 跑一次全量同步（笔记渲染为 Markdown 推到远端）
cc sync webdav run -v
# → ✓ webdav sync done (success) — pushed=42 skipped=3 deleted=1 duration=8123ms

# 5) 配置 Cloudflare R2（S3 兼容，需 path-style）
cc sync oss configure \
  --endpoint https://<account>.r2.cloudflarestorage.com \
  --bucket my-notes --access-key-id <id> --secret-access-key <secret> \
  --force-path-style

# 6) 探测 + 同步
cc sync oss test && cc sync oss run

# 7) 换设备 / 泄露后擦除凭据
cc sync webdav clear
cc sync oss clear
```

## 相关文档

- [CLI 同步](./cli-sync.md)
- [移动端同步](./mobile-sync.md)
- [加密](./encryption.md)
- [总览](./overview.md)
