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


## 附录：规范章节补全（v5.0.2.34）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

ChainlessChain 合规与威胁情报子系统围绕 `cc compliance` CLI 展开，覆盖 STIX 2.1 威胁情报解析、UEBA 行为分析、SOC2 / ISO27001 / GDPR 报告生成。iter24 / iter27 / iter28 增设了 `stixgov-*-v2` / `tigov-*-v2` / `uebgov-*-v2` / `cmpmgov-*-v2` 四套 V2 治理表面，实现 4 态 / 5 态生命周期与容量约束。

### 2. 核心特性

- STIX 2.1 解析（`stixgov`）+ 版本多载
- UEBA 异常检测（`uebgov`）+ 实体 / 告警生命周期
- 多框架合规报告：SOC2 / ISO27001 / GDPR / HIPAA
- 威胁情报源聚合（`tigov`：OTX 等）
- 合规管理器（`cmpmgov`）统一框架装配

### 3. 系统架构

见 [系统架构](/guide/architecture)。合规子系统位于 CLI 层 + 后端审计 sink：

```
cc compliance ─┬─ stixgov-*-v2   → stix-parser.js
               ├─ tigov-*-v2     → threat-intel.js
               ├─ uebgov-*-v2    → ueba.js
               └─ cmpmgov-*-v2   → compliance-manager.js
                                     │
                                     └─► 审计 sink (默认 / Splunk / 企业 SIEM)
```

### 4. 系统定位

面向"**合规可替换 + 威胁情报可聚合**"：企业可把默认 `compliance-default` 插件替换为公司 SIEM 适配器；同时以 V2 治理表面为合规治理提供可观测生命周期。

### 5. 核心功能

| 能力 | CLI 表面 |
|---|---|
| STIX 解析 | `cc compliance stixgov-...-v2` |
| 威胁源 | `cc compliance tigov-...-v2` |
| UEBA 告警 | `cc compliance uebgov-...-v2` |
| 合规报告 | `cc compliance cmpmgov-...-v2`（默认 `framework=soc2`） |
| 审计导出 | `cc audit log` / `cc siem export` |
| DLP | `cc dlp scan` |

### 6. 技术架构

见 [技术栈](/guide/tech-stack)。合规核心库位于 `packages/cli/src/commands/compliance/`：`stix-parser.js` / `threat-intel.js` / `ueba.js` / `compliance-manager.js`，所有 V2 治理表面共用统一 4/5 态状态机。

### 7. 系统特点

- **4 态（stale / suppressed → active）+ 5 态（3 终止态）**：所有 `*gov-*-v2` 统一语义
- **容量约束**：`cmpmgov` 6/15、`stixgov` 6/15、`tigov` 6/15、`uebgov` 8/20
- **自动降级**：auto-stale-idle / auto-suppress-idle + auto-fail-stuck
- **聚合视图**：`cc compliance <prefix>gov-gov-stats-v2` 查看全局
- **与 audit/SIEM 双向贯通**：告警直接转 SIEM / SOC2 报告

### 8. 应用场景

- 金融 / 医疗 SOC2 / ISO27001 年审报告自动出具
- 安全运营中心 UEBA + 威胁情报联动
- 政府 / 国企 GDPR / HIPAA 合规审计
- 企业内置 SIEM 整包替换默认 sink

### 9. 竞品对比

| 能力 | ChainlessChain | Splunk ES | Wazuh |
|---|---|---|---|
| STIX 2.1 | ✅ `stixgov` | ✅ 收费 | ✅ |
| UEBA | ✅ `uebgov` | ✅ 收费 | ⚠️ 基础 |
| SOC2 / ISO27001 报告 | ✅ `cmpmgov` | ✅ 模板 | ⚠️ |
| CLI 可自动化 | ✅ 109 命令 | ⚠️ | ⚠️ |
| 本地优先 / 可离线 | ✅ | ❌ | ✅ |
| V2 治理生命周期 | ✅ | ❌ | ❌ |

### 10. 配置参考

```bash
# 切换默认合规框架
cc compliance cmpmgov-framework-use-v2 soc2

# 注册威胁源
cc compliance tigov-source-add-v2 otx --token "$OTX_KEY"

# 启用 UEBA 实体
cc compliance uebgov-entity-activate-v2 user

# 解析 STIX 包
cc compliance stixgov-parse-v2 --version 2.1 --input threats.json
```

### 11. 性能指标

- STIX 2.1 解析（1k 对象）：< 200ms
- UEBA 单用户告警评估：< 50ms
- SOC2 年度报告生成（1 万条事件）：< 8s
- 治理表面查询 `*-gov-stats-v2`：< 10ms

### 12. 测试覆盖

- 每个 V2 表面 **44** 测试（`stixgov` / `tigov` / `uebgov` / `cmpmgov` 合计 **176** V2 测试）
- 累计 **14,800+** 项目测试中，合规路径 ≈ 600+
- 集成：`tests/integration/compliance/*.integration.test.js`

### 13. 安全考虑

- 威胁情报源凭据存 `.chainlesschain/config.json`（git-ignored）
- SIEM 导出默认走 `chain-gateway` 可审计通道
- UEBA 模型离线训练，不外发原始日志
- 合规报告签名：可选 ed25519 签名（企业场景）

### 14. 故障排除

- **`stixgov-parse-v2` 报 version 错误**：确认 `--version 2.1`；2.0 需走 legacy
- **`tigov` 告警无数据**：源 token 是否过期 / 网络策略是否放行
- **UEBA 持续 stale**：`uebgov-entity-activate-v2`；检查是否触发 auto-suppress-idle
- **SOC2 报告缺项**：升级 `cmpmgov-framework-use-v2` 至最新 framework 版本

### 15. 关键文件

```
packages/cli/src/commands/compliance/
  stix-parser.js
  threat-intel.js
  ueba.js
  compliance-manager.js
desktop-app-vue/src/main/plugins-builtin/compliance-default/
docs/CLI_COMMANDS_REFERENCE.md   # Phase 8
```

### 16. 使用示例

```bash
# 合规一键流程
cc compliance cmpmgov-framework-use-v2 soc2
cc compliance tigov-source-add-v2 otx
cc compliance uebgov-entity-activate-v2 user
cc compliance stixgov-parse-v2 --input feed.json
cc compliance cmpmgov-report-generate-v2 --period 2026Q1
cc audit log --since 2026-01-01 | jq
```

### 17. 相关文档

- [系统简介](/guide/introduction)
- [系统架构](/guide/architecture)
- [技术栈](/guide/tech-stack)
- [快速开始](/guide/getting-started)
- [桌面版 V6 对话壳](/guide/desktop-v6-shell)
- [去中心化社交协议](/guide/social-protocols)
- [系统设计主文档](/design/)
