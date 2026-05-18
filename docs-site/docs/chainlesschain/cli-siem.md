# 安全信息事件管理 (siem)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🎯 **目标管理**: 查看已配置的 SIEM 导出目标及其状态
- ➕ **添加目标**: 添加 Splunk HEC、Elasticsearch、Azure Sentinel 等 SIEM 目标
- 📤 **日志导出**: 将安全日志批量导出到指定 SIEM 目标
- 📊 **导出统计**: 查看各目标的导出计数和运行状态

## 概述

ChainlessChain CLI SIEM 集成模块将系统安全日志导出到企业级 SIEM 平台。通过 `add-target` 配置导出目标，支持 Splunk HEC（HTTP Event Collector）、Elasticsearch 和 Azure Sentinel 三种目标类型。

日志导出支持 JSON、CEF（Common Event Format）和 LEEF（Log Event Extended Format）三种标准格式。`export` 命令将日志批量推送到指定目标。`targets` 和 `stats` 提供目标管理和导出统计。

## 命令参考

### siem targets — 查看导出目标

```bash
chainlesschain siem targets
chainlesschain siem targets --json
```

列出所有已配置的 SIEM 导出目标，显示类型、URL、格式和已导出数量。

### siem add-target — 添加导出目标

```bash
chainlesschain siem add-target <type> <url>
chainlesschain siem add-target splunk_hec "https://splunk.example.com:8088/services/collector" -f json
chainlesschain siem add-target elasticsearch "https://es.example.com:9200/_bulk" -f cef
chainlesschain siem add-target azure_sentinel "https://sentinel.azure.com/api/logs" -f leef
```

添加 SIEM 导出目标。支持的类型：`splunk_hec`、`elasticsearch`、`azure_sentinel`。支持的格式：`json`（默认）、`cef`、`leef`。

### siem export — 导出日志

```bash
chainlesschain siem export <target-id>
chainlesschain siem export tgt-001
```

将安全日志导出到指定 SIEM 目标。

### siem stats — 导出统计

```bash
chainlesschain siem stats
chainlesschain siem stats --json
```

显示各目标的导出统计：类型、格式、已导出数量、运行状态。

## 数据库表

| 表名 | 说明 |
|------|------|
| `siem_exports` | SIEM 导出记录（目标 ID、类型、URL、格式、导出计数、状态、最后导出时间） |

## 系统架构

```
用户命令 → siem.js (Commander) → siem-exporter.js
                                        │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
          目标管理                日志导出引擎              统计汇总
    (添加/列出目标)          (JSON/CEF/LEEF)          (计数/状态)
                                       ▼
                               siem_exports
```

## 配置参考

```bash
# CLI 标志
-f, --format <format>    # 日志格式：json (默认) / cef / leef
--json                   # JSON 格式输出

# 支持的目标类型
splunk_hec               # Splunk HTTP Event Collector
elasticsearch            # Elasticsearch Bulk API
azure_sentinel           # Azure Sentinel HTTP API

# 配置路径
~/.chainlesschain/chainlesschain.db    # siem_exports 表
# SIEM 目标凭证存储在系统 KeyStore 或 config.json 的 siem.targets 字段
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| targets 列表 | < 30ms | ~15ms | ✅ |
| add-target | < 50ms | ~25ms | ✅ |
| export (1k 事件) | < 2s | ~1s | ✅ |
| export (10k 事件，批量) | < 10s | ~5s | ✅ |
| stats 汇总 | < 50ms | ~20ms | ✅ |

## 测试覆盖率

```
✅ siem-exporter.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/siem.js` — 命令实现
- `packages/cli/src/lib/siem-exporter.js` — SIEM 导出库

## 测试

```bash
npx vitest run __tests__/unit/siem-exporter.test.js
# 16 tests, all pass
```

## 使用示例

### 场景 1：配置 Splunk HEC 导出

```bash
# 添加 Splunk HEC 目标
chainlesschain siem add-target splunk_hec \
  "https://splunk.corp.com:8088/services/collector" \
  -f json

# 导出日志
chainlesschain siem export tgt-001

# 查看导出统计
chainlesschain siem stats --json
```

### 场景 2：多目标配置

```bash
# 添加 Elasticsearch 目标
chainlesschain siem add-target elasticsearch \
  "https://es.corp.com:9200/_bulk" -f cef

# 添加 Azure Sentinel 目标
chainlesschain siem add-target azure_sentinel \
  "https://sentinel.azure.com/api/logs" -f leef

# 查看所有目标
chainlesschain siem targets --json

# 分别导出
chainlesschain siem export tgt-001
chainlesschain siem export tgt-002
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "No SIEM targets configured" | 未添加目标 | 使用 `siem add-target` 添加目标 |
| 导出失败 | 目标 URL 不可达 | 检查网络连接和目标 URL |
| 格式不匹配 | SIEM 平台不支持指定格式 | 更换为目标平台支持的格式（json/cef/leef） |

## 安全考虑

- **传输加密**: 日志导出使用 HTTPS 加密传输
- **格式标准**: 支持 CEF 和 LEEF 国际标准安全日志格式
- **批量导出**: 日志批量推送，减少网络开销
- **状态跟踪**: 记录每个目标的导出计数和最后导出时间

## 相关文档

- [审计日志](./cli-audit) — 审计事件记录
- [合规管理](./cli-compliance) — 合规框架
- [安全加固](./cli-hardening) — 安全基线与审计
