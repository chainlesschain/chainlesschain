---
name: log-analyzer
display-name: Log Analyzer
description: 日志分析（解析、过滤、统计、错误提取、时间线分析、模式检测）
version: 1.0.0
category: devops
user-invocable: true
tags: [log, analyze, parse, filter, error, debug, pattern, timeline]
capabilities: [log_parse, log_filter, log_stats, log_errors, log_timeline]
tools:
  - log_parse
  - log_filter
  - log_stats
  - log_errors
instructions: |
  Use this skill to analyze log files. Auto-detects common log formats (JSON, Apache,
  nginx, syslog, application logs). Supports filtering by level/time/pattern, error
  extraction, frequency analysis, timeline visualization, and anomaly detection.
examples:
  - input: "/log-analyzer --analyze app.log"
    output: "1234 lines: 1100 INFO, 89 WARN, 45 ERROR. Peak: 14:00-15:00"
  - input: "/log-analyzer --errors app.log"
    output: "45 errors found. Top: NullPointerException (12), Timeout (8)"
  - input: '/log-analyzer --filter app.log --level error --after "2026-02-17 10:00"'
    output: "15 entries match criteria"
  - input: "/log-analyzer --stats app.log"
    output: "Lines: 5000, Levels: INFO 80%, WARN 15%, ERROR 5%"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.log, .txt, .json]
---

# Log Analyzer

日志分析技能。

## 功能

| 操作 | 命令                                               | 说明                                     |
| ---- | -------------------------------------------------- | ---------------------------------------- |
| 分析 | `--analyze <file>`                                 | 全面日志分析（行数、级别分布、时间范围） |
| 错误 | `--errors <file>`                                  | 提取所有错误和异常                       |
| 过滤 | `--filter <file> --level <level> --after "<time>"` | 按级别/时间过滤                          |
| 统计 | `--stats <file>`                                   | 统计信息（级别分布、频率）               |
| 搜索 | `--search <file> --pattern "<regex>"`              | 正则搜索日志                             |
| 尾部 | `--tail <file> --lines N`                          | 查看最后N行                              |
