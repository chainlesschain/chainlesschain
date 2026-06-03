# 数据库管理 (db)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

`db` 命令用于管理 ChainlessChain 的本地 SQLite 数据库，提供初始化、信息查看、备份恢复，以及完整性检查与损坏恢复（v0.157.4+）等功能。数据库支持 SQLCipher AES-256 全库加密，零配置即可使用，适合在服务器和 CI/CD 环境中自动化管理数据存储。

## 核心特性

- 🗄️ **SQLite 存储**: 轻量级嵌入式数据库，零配置
- 🔐 **可选加密**: 支持 SQLCipher AES-256 全库加密
- 💾 **备份恢复**: 一键备份和恢复完整数据库
- 📊 **信息查看**: 查看数据库驱动、表数、文件大小等元信息
- 🩺 **完整性检查**: `db check` 跑 SQLite `PRAGMA integrity_check`，损坏自动给出恢复指引
- 🛠️ **损坏抢救**: `db repair` 按行抢救坏库到新文件；`db reset` 备份原库 + 重建
- 🌐 **跨平台兜底**: 驱动级联 `better-sqlite3` → `sql.js` (WASM)，Apple Silicon / musl / 无 prebuild 环境也能用

## 系统架构

```
db 命令 → db.js (Commander) → @chainlesschain/core-db
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
                  db init          db info          db backup/restore
                     │                │                │
                     ▼                ▼                ▼
              创建表和索引       查询元信息        文件复制
                     │
                     ▼
              SQLite 数据库 (~/.chainlesschain/data/)
```

## 命令参考

```bash
chainlesschain db init                  # 初始化数据库
chainlesschain db init --path ./my.db   # 指定数据库路径
chainlesschain db info                  # 查看数据库信息（驱动、表数、大小）
chainlesschain db info --json           # JSON 格式输出
chainlesschain db backup [output]       # 创建备份
chainlesschain db restore <backup>      # 从备份恢复
chainlesschain db check                 # SQLite integrity_check（损坏退出码 2）
chainlesschain db check --quick         # quick_check（更快但覆盖较浅）
chainlesschain db check --json          # 结构化输出，便于脚本/CI
chainlesschain db repair                # 按行抢救损坏库 → ...db.recovered.<ts>
chainlesschain db repair --out <path>   # 指定恢复输出路径
chainlesschain db reset                 # 备份当前库 + 下次启动重建（含确认提示）
chainlesschain db reset --force         # 跳过确认
```

## 子命令说明

### init

初始化 SQLite 数据库，自动创建所有表和索引。

```bash
chainlesschain db init
chainlesschain db init --path ./custom.db
```

### info

显示数据库基本信息，包括驱动类型、表数量、文件大小等。

```bash
chainlesschain db info
chainlesschain db info --json
```

### backup / restore

创建数据库备份或从备份恢复。

```bash
chainlesschain db backup                    # 备份到默认位置
chainlesschain db backup ./my-backup.db     # 备份到指定路径
chainlesschain db restore ./my-backup.db    # 从备份恢复
```

### check（v0.157.4+）

只读运行 SQLite `PRAGMA integrity_check`（默认）或 `quick_check`，验证数据库页是否完好。退出码：`0` 健康，`2` 损坏，`1` 其他错误（适合 CI 直接判断）。

```bash
chainlesschain db check                  # 完整 integrity_check
chainlesschain db check --quick          # quick_check，更快但只覆盖部分页
chainlesschain db check --json           # JSON 输出（含 driver / diagnostics 字段）
```

输出示例（损坏）：

```
✘ Database is CORRUPT (integrity_check via better-sqlite3): /path/to/chainlesschain.db
  *** in database main ***
  Tree 20 page 20: btreeInitPage() returns error code 11
  ...
⚠ Recovery options:
  cc db repair   – best-effort row salvage into a new file
  cc db reset    – back up corrupt DB and start fresh
```

`via …` 后缀显示实际驱动来源（`better-sqlite3-multiple-ciphers` / `better-sqlite3` / `sql.js`），用于排查驱动级联是否走到了 WASM 兜底。

### repair（v0.157.4+）

逐表按行抢救损坏库的可读数据，写入一个全新的 sibling 文件 `chainlesschain.db.recovered.<timestamp>`。原库不会被修改。

```bash
chainlesschain db repair                 # 自动命名输出
chainlesschain db repair --out ./fixed.db
```

抢救策略：

- 先把原 schema（CREATE TABLE / INDEX / VIEW）逐条 replay 到新库，失败的计入 `Schemas failed`。
- 对每张表 `SELECT *` 流式扫描；命中坏页的行被计为 `lost`，正常的行 `INSERT OR IGNORE` 到新库。
- 一张表读爆不会影响其他表继续抢救。

输出示例：

```
ℹ Salvaging /path/to/chainlesschain.db → /path/to/chainlesschain.db.recovered.2026-04-26T13-45-00 (driver: better-sqlite3)
  permanent_memory             24 copied
  notes                        0 copied, 1 lost
  did_identities               0 copied, 1 lost
  ...
✔ Recovered DB written to /path/to/chainlesschain.db.recovered.2026-04-26T13-45-00
  Tables processed: 40
  Rows copied:      24
  Rows lost:        30
  Schemas failed:   0

ℹ To use the recovered DB:
  cc db reset --force
  cc db restore /path/to/chainlesschain.db.recovered.2026-04-26T13-45-00 --force
```

> 抢救能拿回的数据取决于损坏面积。坏页越分散，丢失越多。`db check` 的诊断行能帮你预估。

### reset（v0.157.4+）

把当前数据库（含 `.db-wal` / `.db-shm` 边车文件）重命名为 `<file>.bak.<timestamp>`，下次任何 CLI 命令运行时会自动建一个全新空库。原始坏库被保留，方便后续二次抢救。

```bash
chainlesschain db reset            # 弹出确认提示
chainlesschain db reset --force    # 跳过确认（脚本/CI 用）
```

输出示例：

```
✔ Database reset. Backups created:
  /path/to/chainlesschain.db.bak.2026-04-26T13-45-00
  /path/to/chainlesschain.db-wal.bak.2026-04-26T13-45-00
  /path/to/chainlesschain.db-shm.bak.2026-04-26T13-45-00
```

## 配置参考

```bash
chainlesschain db init [--path <db-file>]
chainlesschain db info [--json]
chainlesschain db backup [output]
chainlesschain db restore <backup> [--force]
chainlesschain db check [--quick] [--json]
chainlesschain db repair [--out <path>]
chainlesschain db reset [--force]
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| db init（创建表 + 索引） | < 500ms | ~ 200ms | ✅ |
| db info（元数据查询） | < 100ms | ~ 30ms | ✅ |
| db backup（本地文件复制） | < 2s / 100MB | ~ 1.2s | ✅ |
| db restore（覆盖恢复） | < 2s / 100MB | ~ 1.5s | ✅ |
| JSON 输出序列化 | < 50ms | ~ 10ms | ✅ |

## 测试覆盖率

```
✅ db.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/db.js` — 命令实现
- `@chainlesschain/core-db` — 数据库核心包（48 个测试）

## 安全考虑

- 数据库文件支持 SQLCipher AES-256 加密
- 备份文件包含完整数据，应妥善保管
- `restore` 操作会覆盖当前数据库，建议先备份

## 使用示例

### 场景 1：首次初始化数据库

```bash
chainlesschain db init
chainlesschain db info
```

初始化 SQLite 数据库并创建所有表和索引，随后查看数据库驱动、表数量和文件大小等信息。

### 场景 2：备份与恢复

```bash
chainlesschain db backup ./backup-20260312.db
chainlesschain db restore ./backup-20260312.db
```

在进行重大操作前创建数据库备份，出问题时可以从备份恢复。

### 场景 3：CI/CD 中自动初始化

```bash
chainlesschain db init --path ./test.db
chainlesschain db info --json
```

在测试流水线中使用指定路径初始化数据库，JSON 输出便于脚本解析验证。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `init` 失败报权限错误 | 检查数据目录写入权限 |
| `info` 显示 0 tables | 数据库未初始化，运行 `db init` |
| `restore` 后数据不一致 | 确认备份文件未损坏，重新备份恢复 |
| `database disk image is malformed` | 跑 `cc db check` 确认范围；`cc db repair` 抢救 → `cc db reset --force` 备份原库 → 可选 `cc db restore <recovered>` 把抢救出的数据切回去 |
| `cc db check / repair` 报 "No SQLite driver available" | 极少见——通常 `better-sqlite3` 装得上就走原生路径。装不上时升级到 `chainlesschain@0.157.4+` 会自动回落 `sql.js` WASM；如还报错，确认 `npm i -g chainlesschain@latest` 真的更新成功 |
| 频繁出现损坏 | 多半是 Desktop + CLI 长期共写同一个 `.db`。短暂并存可以（WAL 模式），但请避免同时长时间持有写连接；另请检查是否有进程被强杀的历史 |

### 数据库损坏完整恢复流程

```bash
# 1) 诊断（只读，安全）
cc db check                          # 报告坏页数量 + 显示当前驱动
cc db check --json                   # CI/脚本用

# 2) 抢救（非破坏性，原库不变）
cc db repair                         # 写到 ...db.recovered.<ts>

# 3) 备份 + 重建
cc db reset --force                  # rename .db / -wal / -shm → .bak.<ts>

# 4) 切换到抢救出来的库（可选）
cc db restore <recovered-path> --force

# 5) 验证
cc db check                          # 应回到 OK
cc ui                                # 正常启动
```

### 驱动级联（v0.157.4+）

`db check / repair` 会按顺序尝试：

1. `better-sqlite3-multiple-ciphers`（带 SQLCipher 加密）
2. `better-sqlite3`（无加密原生）
3. `sql.js`（纯 JS + WASM，~1.4MB，永远可用）

输出里 `via xxx` 字样标明实际走的哪个驱动。在 Apple Silicon 无 prebuild、Alpine/musl Linux、Node 主版本漂移导致原生不可用等场景下，WASM 路径自动接管，整套 `check / repair / reset` 仍可完整跑完。

## 相关文档

- [CLI 命令行工具](./cli) — 完整命令参考
- [文件加密](./cli-encrypt) — 数据库加密管理
- [配置说明](./configuration) — 数据库路径配置
