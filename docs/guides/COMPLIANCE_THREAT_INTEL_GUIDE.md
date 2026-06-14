# Compliance, Threat Intelligence & UEBA User Guide

> Hands-on guide for the compliance surface introduced in v5.0.2.10.
>
> Covers STIX 2.1 threat intelligence, UEBA (User & Entity Behavior Analytics),
> and templated framework reports for SOC 2 / ISO 27001 / GDPR.
>
> **Last updated**: 2026-04-16 · See also: `docs/CLI_COMMANDS_REFERENCE.md`,
> `docs/design/modules/19_合规分类系统.md`

---

## 1. Who this guide is for

- Security / compliance engineers who need SOC 2 / ISO 27001 / GDPR evidence
- SOC analysts ingesting STIX 2.1 feeds and matching observables
- Operations teams running baseline behavior profiles and anomaly detection

All commands below run headless and never require the desktop app.

---

## 2. STIX 2.1 threat intelligence

ChainlessChain parses [STIX 2.1](https://docs.oasis-open.org/cti/stix/v2.1/stix-v2.1.html)
bundles and stores indicators locally. Supported observable types: `ipv4-addr`,
`ipv6-addr`, `domain-name`, `url`, `file-sha256`, `file-sha1`, `file-md5`,
`email-addr`, `windows-registry-key`.

### 2.1 Import a feed

```bash
# STIX 2.1 bundle — either file path or stdin
chainlesschain compliance threat-intel import feed.stix.json

# Import from a URL (JSON response)
curl -s https://example.com/feed | chainlesschain compliance threat-intel import -
```

The parser accepts both `indicator` and `observed-data` SDOs; pattern
extraction handles multi-condition STIX patterns like
`[ipv4-addr:value = '1.2.3.4' OR domain-name:value = 'evil.example']`.

### 2.2 List / inspect indicators

```bash
chainlesschain compliance threat-intel list                      # all types
chainlesschain compliance threat-intel list -t ipv4              # single type
chainlesschain compliance threat-intel list -t domain-name --json

chainlesschain compliance threat-intel stats                     # counts per type
chainlesschain compliance threat-intel stats --json
```

### 2.3 Match observables

```bash
# Exit code 0 = no hit, 2 = hit (CI-friendly)
chainlesschain compliance threat-intel match 1.2.3.4
chainlesschain compliance threat-intel match evil.example.com
chainlesschain compliance threat-intel match "https://attacker.test/path"
```

`match` normalizes the observable (`tolower`, trim trailing dots on domains)
before lookup — you don't need to canonicalize before calling.

### 2.4 Remove stale indicators

```bash
chainlesschain compliance threat-intel remove ipv4 1.2.3.4
chainlesschain compliance threat-intel remove domain-name evil.example.com
```

---

## 3. UEBA — User & Entity Behavior Analytics

UEBA learns a baseline from past events and flags deviations. The baseline is
per-entity (user, agent, host…) and rebuilt incrementally.

### 3.1 Baseline

```bash
# Build baseline from the last N days of audit/stream events
chainlesschain compliance ueba baseline --entity user --days 30
chainlesschain compliance ueba baseline --entity user:alice --days 90 --json
```

Features tracked: login hour histogram, distinct source IPs, session duration
p50/p95, tool-call rate, failed-login count.

### 3.2 Detect anomalies

```bash
# Z-score detection against the stored baseline
chainlesschain compliance ueba detect --entity user:alice --window 24h
chainlesschain compliance ueba detect --entity user:alice --window 24h --threshold 3.0 --json
```

Scores above threshold (default 2.5) are written to the alerts queue.

### 3.3 Score / profile / alerts

```bash
# Single event scoring (ad-hoc)
chainlesschain compliance ueba score --entity user:alice --event '{"type":"login","hour":3,"ip":"1.2.3.4"}'

# Entity profile (current state, top features, recent alerts)
chainlesschain compliance ueba profile user:alice
chainlesschain compliance ueba profile user:alice --json

# Alerts feed
chainlesschain compliance ueba alerts --limit 50
chainlesschain compliance ueba alerts --since 2026-04-01 --json
```

---

## 4. Framework reports — SOC 2 / ISO 27001 / GDPR

Templated reporter pulls evidence from the audit log and renders per-control
findings for auditors.

### 4.1 List available frameworks

```bash
chainlesschain compliance frameworks            # human-readable
chainlesschain compliance frameworks --json     # machine-readable
```

### 4.2 Generate a report

```bash
# Markdown (default)
chainlesschain compliance report soc2 --format md

# HTML with output file
chainlesschain compliance report gdpr --format html -o gdpr-2026-Q1.html

# JSON for downstream processing
chainlesschain compliance report iso27001 --format json > iso.json

# Force the template reporter (skip detection heuristics)
chainlesschain compliance report iso27001 --detailed
```

Each report includes: framework metadata, per-control status (`pass` /
`warn` / `fail` / `not-applicable`), evidence references, and the
timestamp range of the audit scan.

### 4.3 Evidence & classification (existing)

```bash
chainlesschain compliance evidence              # collect evidence bundle
chainlesschain compliance classify ./path       # data classification scan
chainlesschain compliance scan                  # combined scan
```

---

## 5. Persistence

| Scope | Location |
| --- | --- |
| Threat indicators | SQLite `threat_indicators` |
| UEBA baselines | SQLite `ueba_baselines` (per-entity JSON blob) |
| UEBA alerts | SQLite `ueba_alerts` |
| Framework reports | Emitted to stdout or `--output` file (not persisted) |
| Audit evidence | Pulled live from `audit_logs` |

All tables live in the SQLCipher-encrypted application database.

---

## 6. Troubleshooting

- **`Invalid STIX bundle`** — the reader only accepts top-level `{type:"bundle"}`
  with `objects[]`. If your feed is a bare array, wrap it in a bundle envelope.
- **`match` returns no hit for known-bad domain** — check case + trailing dot
  (`evil.example.com.` and `Evil.Example.com` both match, but `evil.example`
  without TLD does not).
- **UEBA `detect` returns empty** — ensure `baseline` has been run for that
  entity first. A fresh entity has no baseline, so every event looks novel
  and is skipped rather than fired as a false positive.
- **Framework report has empty evidence sections** — the reporter requires a
  populated `audit_logs` table. Run `chainlesschain audit log` to confirm
  events exist before generating a report.
- **STIX import via pipe fails on Windows** — use a file path instead; PowerShell's
  default encoding can mangle JSON. `chainlesschain compliance threat-intel import feed.json`
  is always safe.

---

## 7. See also

- Design doc: `docs/design/modules/19_合规分类系统.md`
- CLI reference: `docs/CLI_COMMANDS_REFERENCE.md` (Phase 8 section)
- Audit / SIEM: `chainlesschain audit log`, `chainlesschain siem export`
- DLP: `chainlesschain dlp scan` — complementary to UEBA for data flows

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。Compliance / Threat Intelligence / UEBA 用户指南：合规 + 威胁情报 + UEBA。

### 2. 核心特性
合规 / 威胁情报 / UEBA / 审计。

### 3. 系统架构
见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位
ChainlessChain 的「合规与威胁情报指南」。

### 5. 核心功能
见正文各节。

### 6. 技术架构
见正文技术 / 环境章节。

### 7. 系统特点
见正文（步骤 / 版本 / 注意事项）。

### 8. 应用场景
见正文使用场景。

### 9. 竞品对比
见正文对比（如有）。

### 10. 配置参考
见正文配置 / 环境变量章节；`.chainlesschain/config.json`。

### 11. 性能指标
见正文性能 / 资源要求（如有）。

### 12. 测试覆盖
见正文验证 / 测试步骤（如有）。

### 13. 安全考虑
见正文安全 / 密钥章节（如适用）。

### 14. 故障排除
见正文故障排查 / 常见问题章节。

### 15. 关键文件
见正文涉及的文件 / 目录 / 脚本。

### 16. 使用示例
见正文命令 / 操作示例。

### 17. 相关文档
[用户指南索引](./README.md)、[快速开始](../quick-start/QUICK_START.md)、其它用户文档。
