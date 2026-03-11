# 文件同步 (sync)

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

## 依赖

- 纯 Node.js crypto（内容哈希）
- 无外部依赖
