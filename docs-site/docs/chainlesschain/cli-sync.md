# 文件同步 (sync)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔄 **双向同步**: push 推送和 pull 拉取本地/远程变更
- ⚡ **冲突检测**: 自动检测版本不一致的资源
- 🔧 **冲突解决**: 支持 local/remote/manual 三种策略
- 📋 **操作日志**: 完整记录所有同步操作历史
- #️⃣ **内容哈希**: SHA-256 哈希校验数据完整性

## 系统架构

```
sync 命令 → sync.js (Commander) → sync-manager.js
                                        │
                   ┌────────────────────┼────────────────────┐
                   ▼                    ▼                    ▼
             资源注册/状态          push / pull           冲突管理
                   │                    │                    │
                   ▼                    ▼                    ▼
           sync_state 表          sync_log 表       sync_conflicts 表
                                  (操作记录)         (local/remote/manual)
```

## 概述

CLI Phase 5 — 文件与知识同步，支持冲突检测与解决。

## 命令概览

```bash
chainlesschain sync status             # 同步状态
chainlesschain sync push               # 推送本地变更
chainlesschain sync pull               # 拉取远程变更
chainlesschain sync conflicts          # 列出冲突
chainlesschain sync resolve <id> --strategy local  # 解决冲突
chainlesschain sync log                # 同步历史
chainlesschain sync clear              # 清除同步状态
```

## 功能说明

### 资源管理

- `registerResource` — 注册需同步的资源（type, version, hash）
- `getResourceState` — 查询资源同步状态
- `getAllResources` — 列出所有已注册资源

### 同步操作

- `pushResource` — 推送本地版本（更新 remote_version + 记录日志）
- `pullResource` — 拉取远程版本（更新 local_version + 记录日志）
- 自动检测版本冲突（local_version ≠ remote_version）

### 冲突管理

- `detectConflicts` — 扫描所有资源检测冲突
- `resolveConflict` — 解决冲突，支持 3 种策略：
  - `local` — 保留本地内容
  - `remote` — 保留远程内容
  - `manual` — 手动合并

### 操作日志

- `getSyncLog` — 查询同步操作历史（按时间倒序）
- `clearSyncState` — 清除所有同步状态和日志

## 数据库表

| 表名 | 说明 |
|------|------|
| `sync_state` | 资源同步状态（版本号、哈希、上次同步时间） |
| `sync_conflicts` | 冲突记录（本地/远程内容、解决策略） |
| `sync_log` | 操作日志（push/pull/resolve 记录） |

## 配置参考

```bash
# 命令选项
chainlesschain sync status                                  # 列出同步状态
chainlesschain sync push                                    # 推送本地变更
chainlesschain sync pull                                    # 拉取远程变更
chainlesschain sync conflicts                               # 列出冲突
chainlesschain sync resolve <id> --strategy local           # 解决冲突 (local/remote/manual)
chainlesschain sync log                                     # 同步历史
chainlesschain sync clear                                   # 清除同步状态

# 相关环境变量
export CHAINLESSCHAIN_DB_PATH=~/.chainlesschain/db.sqlite   # SQLite 数据库路径
```

## 性能指标

| 操作              | 目标   | 实际       | 状态 |
| ----------------- | ------ | ---------- | ---- |
| 状态查询          | < 100ms | 20–80ms    | ✅   |
| 推送单个资源      | < 200ms | 50–150ms   | ✅   |
| 拉取单个资源      | < 200ms | 50–150ms   | ✅   |
| 冲突检测（全量）  | < 500ms | 100–400ms  | ✅   |
| SHA-256 哈希计算  | < 50ms  | 10–30ms    | ✅   |

## 测试覆盖率

```
✅ sync.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 安全考虑

- 内容哈希使用 SHA-256 校验数据完整性
- `clear` 操作不可恢复，建议先备份
- 冲突解决记录完整审计日志

## 使用示例

### 场景 1：查看同步状态并推送

```bash
chainlesschain sync status
chainlesschain sync push
chainlesschain sync log
```

检查本地资源同步状态，推送变更到远程，查看同步操作历史确认成功。

### 场景 2：拉取远程变更

```bash
chainlesschain sync pull
chainlesschain sync conflicts
```

拉取远程最新变更到本地，检查是否存在版本冲突需要解决。

### 场景 3：解决同步冲突

```bash
chainlesschain sync conflicts
chainlesschain sync resolve <conflict-id> --strategy local
chainlesschain sync resolve <conflict-id> --strategy remote
```

列出所有冲突，根据实际情况选择保留本地或远程内容来解决冲突。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `push` 报冲突 | 先 `sync conflicts` 查看冲突，使用 `resolve` 解决 |
| `status` 全为空 | 需先注册同步资源 |
| `clear` 后数据丢失 | `clear` 清除所有状态，无法恢复 |

## 关键文件

- `packages/cli/src/commands/sync.js` — 命令实现
- `packages/cli/src/lib/sync-manager.js` — 同步管理库

## 相关文档

- [Git 同步](./git-sync) — 桌面端 Git 同步
- [数据库管理](./cli-db) — 数据库备份恢复
- [文件加密](./cli-encrypt) — 同步数据加密

## 依赖

- 纯 Node.js crypto（内容哈希）
- 无外部依赖
