# 合规、威胁情报与 UEBA 用户指南

> v5.0.2.10 引入的合规功能实操指南。
>
> 涵盖 STIX 2.1 威胁情报、UEBA（用户与实体行为分析）以及
> SOC 2 / ISO 27001 / GDPR 模板化合规报告。
>
> **最后更新**: 2026-04-17 · 另见: `docs/CLI_COMMANDS_REFERENCE.md`、
> `docs/design/modules/19_合规分类系统.md`

---

## 1. 适用人群

- 需要 SOC 2 / ISO 27001 / GDPR 合规证据的安全/合规工程师
- 需要导入 STIX 2.1 订阅源并匹配可观测指标的 SOC 分析师
- 运行行为基线建模和异常检测的运维团队

以下所有命令均为 Headless 模式运行，无需桌面应用。

---

## 2. STIX 2.1 威胁情报

ChainlessChain 解析 [STIX 2.1](https://docs.oasis-open.org/cti/stix/v2.1/stix-v2.1.html)
Bundle 并将指标本地存储。支持的可观测类型：`ipv4-addr`、`ipv6-addr`、
`domain-name`、`url`、`file-sha256`、`file-sha1`、`file-md5`、
`email-addr`、`windows-registry-key`。

### 2.1 导入订阅源

```bash
# STIX 2.1 bundle — 支持文件路径或标准输入
chainlesschain compliance threat-intel import feed.stix.json

# 从 URL 导入（JSON 响应）
curl -s https://example.com/feed | chainlesschain compliance threat-intel import -
```

解析器同时支持 `indicator` 和 `observed-data` SDO；模式提取可处理
多条件 STIX 模式，如
`[ipv4-addr:value = '1.2.3.4' OR domain-name:value = 'evil.example']`。

### 2.2 列出 / 查看指标

```bash
chainlesschain compliance threat-intel list                      # 所有类型
chainlesschain compliance threat-intel list -t ipv4              # 单一类型
chainlesschain compliance threat-intel list -t domain-name --json

chainlesschain compliance threat-intel stats                     # 各类型计数
chainlesschain compliance threat-intel stats --json
```

### 2.3 匹配可观测指标

```bash
# 退出码 0 = 未命中，2 = 命中（CI 友好）
chainlesschain compliance threat-intel match 1.2.3.4
chainlesschain compliance threat-intel match evil.example.com
chainlesschain compliance threat-intel match "https://attacker.test/path"
```

`match` 在查找前会对可观测指标进行规范化（转小写、去除域名末尾的点号），
调用方无需预处理。

### 2.4 移除过期指标

```bash
chainlesschain compliance threat-intel remove ipv4 1.2.3.4
chainlesschain compliance threat-intel remove domain-name evil.example.com
```

---

## 3. UEBA — 用户与实体行为分析

UEBA 从历史事件中学习行为基线，并标记偏离。基线按实体（用户、Agent、
主机等）划分，支持增量重建。

### 3.1 建立基线

```bash
# 从最近 N 天的审计/流事件建立基线
chainlesschain compliance ueba baseline --entity user --days 30
chainlesschain compliance ueba baseline --entity user:alice --days 90 --json
```

追踪的特征：登录时段直方图、独立来源 IP 数、会话时长 p50/p95、
工具调用频率、登录失败次数。

### 3.2 异常检测

```bash
# 基于存储基线的 Z-score 检测
chainlesschain compliance ueba detect --entity user:alice --window 24h
chainlesschain compliance ueba detect --entity user:alice --window 24h --threshold 3.0 --json
```

得分超过阈值（默认 2.5）的事件会写入告警队列。

### 3.3 评分 / 画像 / 告警

```bash
# 单事件评分（临时查询）
chainlesschain compliance ueba score --entity user:alice --event '{"type":"login","hour":3,"ip":"1.2.3.4"}'

# 实体画像（当前状态、关键特征、近期告警）
chainlesschain compliance ueba profile user:alice
chainlesschain compliance ueba profile user:alice --json

# 告警流
chainlesschain compliance ueba alerts --limit 50
chainlesschain compliance ueba alerts --since 2026-04-01 --json
```

---

## 4. 合规框架报告 — SOC 2 / ISO 27001 / GDPR

模板化报告引擎从审计日志中提取证据，按控制项生成审计员可用的检查结果。

### 4.1 列出可用框架

```bash
chainlesschain compliance frameworks            # 可读格式
chainlesschain compliance frameworks --json     # 机器可读
```

### 4.2 生成报告

```bash
# Markdown（默认）
chainlesschain compliance report soc2 --format md

# HTML 并输出到文件
chainlesschain compliance report gdpr --format html -o gdpr-2026-Q1.html

# JSON 用于下游处理
chainlesschain compliance report iso27001 --format json > iso.json

# 强制使用模板报告器（跳过检测启发式）
chainlesschain compliance report iso27001 --detailed
```

每份报告包含：框架元数据、每个控制项的状态（`pass` / `warn` /
`fail` / `not-applicable`）、证据引用，以及审计扫描的时间范围。

### 4.3 证据收集与分类（已有功能）

```bash
chainlesschain compliance evidence              # 收集证据包
chainlesschain compliance classify ./path       # 数据分类扫描
chainlesschain compliance scan                  # 综合扫描
```

---

## 5. 数据存储

| 范围 | 存储位置 |
| --- | --- |
| 威胁指标 | SQLite `threat_indicators` |
| UEBA 基线 | SQLite `ueba_baselines`（按实体存储的 JSON 数据） |
| UEBA 告警 | SQLite `ueba_alerts` |
| 合规报告 | 输出到标准输出或 `--output` 文件（不持久化） |
| 审计证据 | 实时从 `audit_logs` 表拉取 |

所有表存储在 SQLCipher 加密的应用数据库中。

---

## 6. 故障排查

- **`Invalid STIX bundle`** — 解析器仅接受顶层 `{type:"bundle"}` 且包含
  `objects[]` 的格式。如果订阅源是裸数组，需要包装为 bundle 信封。
- **`match` 对已知恶意域名无命中** — 检查大小写和末尾的点号
  （`evil.example.com.` 和 `Evil.Example.com` 均可匹配，
  但缺少 TLD 的 `evil.example` 无法匹配）。
- **UEBA `detect` 返回空结果** — 确保已对该实体运行过 `baseline`。
  新实体没有基线，所有事件看起来都是新的，系统会跳过而非产生误报。
- **合规报告中证据部分为空** — 报告引擎需要 `audit_logs` 表中有数据。
  在生成报告前先运行 `chainlesschain audit log` 确认有审计事件。
- **Windows 下管道导入 STIX 失败** — 使用文件路径代替管道；PowerShell
  的默认编码可能损坏 JSON。`chainlesschain compliance threat-intel import feed.json`
  始终可靠。

---

## 7. 相关文档

- 设计文档: `docs/design/modules/19_合规分类系统.md`
- CLI 参考: `docs/CLI_COMMANDS_REFERENCE.md`（Phase 8 部分）
- 审计 / SIEM: `chainlesschain audit log`、`chainlesschain siem export`
- DLP: `chainlesschain dlp scan` — 与 UEBA 互补的数据流防护
