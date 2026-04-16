# 审计日志 (audit)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📋 **8 种事件类型**: auth、data_access、data_modify、system、security、export、import、admin
- ⚠️ **4 个风险级别**: low、medium、high、critical 自动评估
- 🔒 **敏感数据脱敏**: 自动屏蔽密码、API Key、私钥、Token
- 🔍 **日志搜索**: 按关键词和事件类型搜索
- 📤 **多格式导出**: 支持 JSON 和 CSV 格式导出
- 🧹 **自动清理**: 按时间范围清理旧日志

## 概述

ChainlessChain CLI 提供完整的操作审计日志系统，支持风险评估和敏感数据脱敏。

- **8 种事件类型**: auth, data_access, data_modify, system, security, export, import, admin
- **4 个风险级别**: low, medium, high, critical
- **自动风险评估**: 根据操作类型自动判定风险等级
- **敏感数据脱敏**: 自动屏蔽密码、API Key 等敏感信息

## 命令参考

### audit log — 查看最近事件（默认）

```bash
chainlesschain audit log
chainlesschain audit log -n 50           # 最近50条
chainlesschain audit log --type security # 按类型过滤
chainlesschain audit                     # 等同于 audit log
```

显示最近的审计事件列表。

### audit search — 搜索事件

```bash
chainlesschain audit search <keyword>
chainlesschain audit search "delete"
chainlesschain audit search "login" -n 100
```

按关键字搜索审计日志。

### audit stats — 统计信息

```bash
chainlesschain audit stats
```

显示审计日志统计：总事件数、按类型分布、高风险事件数等。

### audit export — 导出日志

```bash
chainlesschain audit export
chainlesschain audit export --format csv    # CSV 格式
chainlesschain audit export --format json   # JSON 格式（默认）
chainlesschain audit export -o audit.json   # 指定输出路径
```

导出审计日志为 JSON 或 CSV 格式。

### audit purge — 清理旧日志

```bash
chainlesschain audit purge --before 90     # 清理90天前的日志
```

删除指定天数前的审计日志（需确认）。

### audit types — 列出事件类型

```bash
chainlesschain audit types
```

显示所有可用的事件类型及其说明。

## 事件类型

| 类型          | 说明         | 默认风险 |
| ------------- | ------------ | -------- |
| `auth`        | 认证事件     | medium   |
| `data_access` | 数据访问     | low      |
| `data_modify` | 数据修改     | medium   |
| `system`      | 系统操作     | low      |
| `security`    | 安全事件     | high     |
| `export`      | 数据导出     | medium   |
| `import`      | 数据导入     | low      |
| `admin`       | 管理操作     | high     |

## 风险级别

| 级别       | 含义         | 触发条件               |
| ---------- | ------------ | ---------------------- |
| `low`      | 低风险       | 只读操作               |
| `medium`   | 中等风险     | 数据修改               |
| `high`     | 高风险       | 安全相关、管理操作     |
| `critical` | 严重风险     | 删除操作、权限变更     |

## 敏感数据脱敏

审计日志自动脱敏以下敏感信息：

- `password` → `***`
- `apiKey` → `sk-***...xxx` (保留前3后3位)
- `privateKey` → `***`
- `secret` → `***`
- `token` → `***`

## 系统架构

```
CLI 命令执行 → audit-logger.js (自动拦截)
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   事件分类      风险评估     数据脱敏
   (8 types)   (4 levels)  (password/key/token)
        │            │            │
        └────────────┼────────────┘
                     ▼
              SQLite audit_logs 表
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
    log/search    stats       export (JSON/CSV)
```

## 配置参考

```bash
chainlesschain audit [subcommand] [options]

子命令:
  log              查看最近审计事件（默认）
  search <keyword> 按关键词搜索事件
  stats            显示统计信息（总数/类型分布/高风险数）
  export           导出审计日志
  purge            清理旧日志
  types            列出所有事件类型

选项:
  -n <num>         限制返回条数（默认: 20）
  --type <type>    按事件类型过滤（auth/security/admin 等 8 种）
  --format <fmt>   导出格式 json|csv（默认: json）
  -o <path>        导出输出路径
  --before <days>  清理多少天前的日志（purge 专用）
```

存储位置: SQLite `audit_logs` 表。敏感字段（password/apiKey/privateKey/secret/token）在写入前自动脱敏。

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 事件写入（含脱敏） | < 20ms | ~8ms | ✅ |
| log -n 20 查询 | < 50ms | ~15ms | ✅ |
| search 关键词扫描（10k 条） | < 300ms | ~120ms | ✅ |
| stats 聚合 | < 200ms | ~80ms | ✅ |
| export JSON（1k 条） | < 500ms | ~200ms | ✅ |
| purge 批量删除（90 天前） | < 1s | ~400ms | ✅ |

## 测试覆盖率

```
✅ audit.test.js  - 覆盖 audit CLI 的主要路径
  ├── 参数解析 / 选项验证（-n / --type / --format / --before）
  ├── 正常路径（log/search/stats/export/purge/types）
  ├── 错误处理 / 边界情况（空日志、无效 type、purge 确认）
  └── JSON 输出格式
```

## 安全考虑

- 审计日志自动脱敏敏感信息（密码、API Key、私钥、Token）
- `purge` 操作不可恢复，建议先 `export` 备份
- `export` 导出的文件可能包含操作记录，注意保管
- 高风险和严重风险事件应定期检查

## 使用示例

### 场景 1：查看安全相关审计日志

```bash
chainlesschain audit log --type security -n 20
chainlesschain audit search "login"
```

查看最近 20 条安全类事件，搜索登录相关操作记录，排查异常登录行为。

### 场景 2：按时间范围导出并清理

```bash
chainlesschain audit export --format csv -o audit-2026-Q1.csv
chainlesschain audit purge --before 90
```

先将审计日志导出为 CSV 归档，然后清理 90 天前的旧日志以释放空间。

### 场景 3：统计分析高风险事件

```bash
chainlesschain audit stats
chainlesschain audit log --type admin -n 50
chainlesschain audit search "delete"
```

查看审计日志统计概况，重点关注管理操作和删除类高风险事件。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `log` 为空 | 审计日志在 CLI 操作时自动记录，需先执行其他命令 |
| `search` 无结果 | 尝试更宽泛的关键词，或指定 `--type` 过滤 |
| `export` 文件过大 | 使用 `purge --before 90` 清理旧日志后重新导出 |
| 脱敏后数据无法识别 | 脱敏不可逆，原始值需从其他途径获取 |

## 关键文件

- `packages/cli/src/commands/audit.js` — 命令实现
- `packages/cli/src/lib/audit-logger.js` — 审计日志库

## 相关文档

- [RBAC 权限](./cli-auth) — 权限管理（变更自动审计）
- [DID 身份](./cli-did) — 身份操作审计
- [文件加密](./cli-encrypt) — 加密操作审计
- [审计系统](./audit) — 桌面端审计系统详情
