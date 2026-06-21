# 项目管理（cc project）

> **版本: v1.3+ #21 P1 | 状态: ✅ 生产可用 | 7 集成测试全绿**
>
> `cc project` 直接读写桌面 app 的共享 SQLite（`chainlesschain.db`）来创建/管理项目：CLI 写入后**桌面 UI 立刻可见**，再经 Phase 3d sync 同步到手机端——桌面 / CLI / 手机三端零延迟一致。设计来源是 v1.2 GA 反馈「目标在手机端做 AI 项目的交互要像在电脑端那样丝滑」。

## 概述

`cc project` 提供 `init / list / show / delete` 四个子命令，不经任何中间服务层，直接打开桌面 Electron app 的 `chainlesschain.db`（按 `app.getPath("userData")` 约定解析路径）。打开时启用 **WAL 模式**，允许桌面 app 同时运行（多读单写，短查询无冲突）。新建项目自动写 `sync_status='pending'`，由 Phase 3d sync 推送到移动端。

SQLite 驱动按级联回退：`better-sqlite3-multiple-ciphers` → `better-sqlite3` → `sql.js`（WASM）。WASM 路径在 close 时整库写回文件，此时应关闭桌面 app 以避免竞态。

## 核心特性

- 🗄️ **直写桌面 DB**：无中间层，CLI 创建的项目立刻出现在桌面 UI
- 📱 **三端一致**：写入即标 `sync_status='pending'`，Phase 3d sync 自动同步手机端
- 🏷️ **10 种项目类型**：`web | document | data | app | presentation | spreadsheet | design | code | workflow | knowledge`（默认 `document`），非法类型退出码 2
- 📊 **4 种状态**：`draft | active | completed | archived`（新建即 `active`），`list --status` 可过滤
- 🧹 **软删除默认**：`delete` 置 `deleted=1` 并重新标 pending 触发同步；`--hard` 才真正删行
- 🔁 **驱动级联**：native better-sqlite3 优先，缺失时回落 sql.js（WASM）保证可用
- 🆔 **桌面同款 ID**：`crypto.randomUUID()`（UUID v4），与桌面建项目约定一致
- 📤 **`--json` 输出**：所有子命令均支持，便于脚本消费

## 系统架构

```
┌──────────────────────────────────────────────┐
│ cc project init|list|show|delete             │
└──────────────────┬───────────────────────────┘
                   │ openProjectsDb(--db 或默认路径)
                   ▼
┌──────────────────────────────────────────────┐
│ project-runtime.js                            │
│  驱动级联: bs3mc → better-sqlite3 → sql.js    │
│  WAL mode + foreign_keys=ON                   │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│ chainlesschain.db（桌面 userData/data/ 下）    │
│  projects 表（sync_status='pending'）          │
└─────────┬───────────────────────┬────────────┘
          │ 同库并发读写（WAL）      │ Phase 3d sync
          ▼                       ▼
   桌面 app UI（立刻可见）      手机端（自动同步）
```

## 命令参考

```bash
cc project init <name> [--description <text>] [--type <type>] [--user <id>] [--root <path>] [--db <path>] [--json]
cc project list [--user <id>] [--status <s>] [--limit <n>] [--db <path>] [--json]
cc project show <id> [--db <path>] [--json]
cc project delete <id> [--hard] [--db <path>] [--json]
```

| 子命令        | 选项                   | 默认             | 说明                                                          |
| ------------- | ---------------------- | ---------------- | ------------------------------------------------------------- |
| `init <name>` | `--type <type>`        | `document`       | 10 种合法类型之一，非法值退出码 2                             |
|               | `--description <text>` | —                | 项目描述                                                      |
|               | `--user <userId>`      | `default`        | 所属用户 ID                                                   |
|               | `--root <path>`        | —                | 文件系统根路径（`root_path`）                                 |
| `list`        | `--user <userId>`      | `default`        | 按用户过滤（恒过滤 `deleted=0`）                              |
|               | `--status <s>`         | —                | 按状态过滤（4 种合法值，非法值退出码 2）                      |
|               | `--limit <n>`          | `50`             | 最大行数，按 `updated_at` 倒序                                |
| `show <id>`   | —                      | —                | 完整行；不存在退出码 2                                        |
| `delete <id>` | `--hard`               | 关（软删）       | 软删置 `deleted=1` + `sync_status='pending'`；`--hard` 真删行 |
| 公共          | `--db <path>`          | 桌面默认 DB 路径 | DB 路径覆盖                                                   |
|               | `--json`               | 关               | JSON 输出                                                     |

## 配置参考

- **默认 DB 路径**（镜像 Electron `app.getPath("userData")` 约定）：
  - Windows: `%APPDATA%/chainlesschain-desktop-vue/data/chainlesschain.db`
  - macOS: `~/Library/Application Support/chainlesschain-desktop-vue/data/chainlesschain.db`
  - Linux: `$XDG_CONFIG_HOME`（缺省 `~/.config`）`/chainlesschain-desktop-vue/data/chainlesschain.db`
- **`--db <path>`**：每个子命令均可覆盖 DB 路径（测试 / 多实例场景）。
- **DB 不存在即报错**：`DB_NOT_FOUND` ——桌面 app 首次启动时才会创建 DB，CLI 不会替它建库。
- **PRAGMA**：native 驱动下设置 `journal_mode=WAL` + `foreign_keys=ON`；sql.js（WASM）路径下 pragma 静默忽略。
- **无独立配置文件**：本命令不读 `config.json`，所有行为由 flag 控制。

## 性能指标

- **`list` 默认上限 50 行**（`--limit` 可调），按 `updated_at DESC` 排序。
- **WAL 并发**：与运行中的桌面 app 共库——多读单写，短查询无锁冲突。
- **WASM 回退成本**：sql.js 路径整库读入内存、close 时整库写回，仅作兜底；大库 / 桌面并发场景应保证 native 驱动可用。
- 单次操作均为短查询（单条 INSERT/SELECT/UPDATE/DELETE），基准数据待补。

## 测试覆盖

`packages/cli/__tests__/integration/project-cli.test.js` —— **7** 个集成测试（`it(` 计数）：

- init 创建 + list 返回 + show 全行
- init 非法 `project_type` 退出码 2
- show 未知 id 退出码 2 + 清晰报错
- delete 默认软删 + list 隐藏该行
- `delete --hard` 真删行
- list `--status` 过滤生效
- `init --json` 输出 shape 稳定

```bash
cd packages/cli
npx vitest run __tests__/integration/project-cli.test.js
```

## 安全考虑

- **输入白名单**：`project_type` / `status` 均按白名单常量（`VALID_PROJECT_TYPES` / `VALID_PROJECT_STATUSES`）校验，与 projects 表的 CHECK 约束一致，非法值直接退出码 2。
- **参数化 SQL**：所有查询走 prepared statement 占位符，无字符串拼接注入面。
- **软删可恢复**：默认软删只置 `deleted=1`，数据仍在库中；`--hard` 为显式破坏性操作（同时级联移除 project_files）。
- **不建库**：DB 缺失时报错而非静默新建，避免在错误路径生成孤儿库。
- **WASM 写回竞态提示**：sql.js 路径 close 时整库覆盖写回，桌面同时运行可能互相覆盖——该路径仅兜底，文档与代码注释均要求此时关闭桌面。

## 故障排除

| 现象                                           | 可能原因                                         | 处理                                                                                    |
| ---------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `Desktop DB not found at: …`（`DB_NOT_FOUND`） | 桌面 app 从未启动过，DB 未创建                   | 先启动一次桌面 app（首次运行建库），或用 `--db` 指向已有库                              |
| `Invalid type "…"`（退出码 2）                 | `--type` 不在 10 种白名单内                      | 用 `web/document/data/app/presentation/spreadsheet/design/code/workflow/knowledge` 之一 |
| `Invalid status "…"`（退出码 2）               | `list --status` 值非法                           | 用 `draft/active/completed/archived` 之一                                               |
| `Project not found: <id>`（退出码 2）          | id 不存在（或 show 一个 hard 删掉的项目）        | `cc project list` 确认 id；软删的项目 list 不显示但 show 仍可查                         |
| 桌面 UI 没看到新项目                           | 用了 `--db` 指到别的库 / 桌面读的是另一 userData | 不带 `--db` 用默认路径；确认桌面与 CLI 同一用户 profile                                 |
| native 驱动加载失败、行为变慢                  | better-sqlite3(-mc) 缺 prebuild，回落 sql.js     | `npm rebuild better-sqlite3`；WASM 路径下先关桌面再操作                                 |

## 关键文件

| 文件                                                     | 说明                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/cli/src/commands/project.js`                   | `cc project` 四个子命令（init/list/show/delete）+ 表格/着色输出           |
| `packages/cli/src/lib/project-runtime.js`                | DB 路径解析、驱动级联（bs3mc → bs3 → sql.js）、WAL、UUID、类型/状态白名单 |
| `packages/cli/__tests__/integration/project-cli.test.js` | 7 集成测试                                                                |
| `chainlesschain.db`（桌面 userData/data/）               | 与桌面 app 共享的 SQLite 库（projects 表）                                |

## 使用示例

```bash
# 1) 创建一个代码类项目（立刻出现在桌面 UI）
cc project init "支付重构" --type code --description "拆分支付模块" --root D:/work/pay

# 2) 列出当前用户的项目（默认 50 条，按更新时间倒序）
cc project list

# 3) 只看进行中的项目
cc project list --status active

# 4) 查看详情 / JSON 输出
cc project show <id>
cc project show <id> --json

# 5) 软删除（手机端经 Phase 3d 同步消失，数据仍在库中）
cc project delete <id>

# 6) 硬删除（不可恢复，级联 project_files）
cc project delete <id> --hard

# 7) 指向测试库
cc project init demo --db ./tmp/test.db --json
```

## 相关文档

- [移动端同步](./mobile-sync.md)
- [CLI 同步](./cli-sync.md)
- [数据库工具](./cli-db.md)
- [总览](./overview.md)
