# Record & Replay → Skill 用户指南

> 状态：CLI 产品入口已实现。支持真实 Chromium 录制、逐项审阅、隔离回放、Skill 启用/撤销和本地数据治理；当前不包含 Desktop 可视化录制页。

## 概述

Record & Replay 把一次受控的浏览器操作转换为可审阅、可参数化、可重复执行的 Skill。它不录制视频，也不生成任意 JavaScript：录制器只接受 `observe`、`click`、`type`、`select`、`assert` 五种操作，生成稳定 selector，并在批准前显示完整动作、参数、能力、环境和失败条件。

稳定入口为：

```bash
cc skill recording --help
# 等价别名
cc skill record-replay --help
```

## 核心特性

- 从真实 Chromium 事件捕获 `click`、`type` 和 `select`，通过参数追加 `observe` 和 `assert`。
- selector 优先使用 `data-testid`、`data-test`、`data-cc-record`、`id`、`name`、`aria-label`，最后才使用结构 CSS；不使用页面文本。
- 捕获值在内存中参数化，密码框自动标敏；`--sensitive` 可人工标记业务敏感参数。
- 草稿、审批、环境、回放、存储、导出、审计和安装包分别使用域隔离 SHA-256 摘要。
- 支持自包含 HTML 离线目标，以及凭据摘要和精确来源白名单约束的 HTTPS 目标。
- 回放成功后可生成现有 Skill loader 能识别的 `SKILL.md`、`handler.js` 和 `recorded-skill.json`。
- 支持 revision CAS、保留期、删除、导入/导出、哈希链审计、能力策略和全局安装策略。

## 系统架构

```text
Chromium 事件 / 自动化输入
          │
          ▼
稳定 selector + 参数化 + 全字段扫描
          │
          ▼
版本化 Draft ──► CLI 逐项审阅 ──► Approved
                                      │
                                      ▼
     HTML: network deny    URL: exact-origin allowlist
                   临时 Chromium 回放
                                      │
                                      ▼
                         metadata-only ReplayReport
                                      │
                                      ▼
                     Skill 安装 / 撤销 / 导出 / 审计
```

持久状态位于 CLI 配置目录的 `record-replay/state.json`。写入使用文件锁、revision CAS、原子替换和 owner-only 权限；每次读取、导入和状态变更都会重新验证 schema 与所有摘要。

## 快速开始

### 1. 录制自包含 HTML

准备 `automation.json`：

```json
[
  { "kind": "click", "target": "#open" },
  { "kind": "type", "target": "#account", "value": "captured-account" },
  { "kind": "select", "target": "#region", "value": "cn" }
]
```

准备 `assertions.json`：

```json
[{ "target": "h1", "value": "ready" }]
```

录制并显示审阅投影：

```bash
cc skill recording record open-project \
  --fixture ./fixture.html \
  --automation ./automation.json \
  --observe h1 \
  --assertions ./assertions.json \
  --sensitive account \
  --failure "页面未进入 ready 状态时停止"
```

不传 `--automation` 时需要 TTY；命令会打开可交互 Chromium，操作完成后在终端按 Enter。`--headless` 适合自动化录制。

### 2. 审阅、回放和启用

```bash
cc skill recording show open-project
cc skill recording review open-project --reviewer reviewer-1 --approve

cc skill recording replay open-project \
  --fixture ./fixture.html \
  --input account=runtime-account \
  --input region=cn

cc skill recording enable open-project --approve
cc skill list --source workspace
```

`review` 不带 `--approve` 只读，不会改变状态。只有当前批准 revision 成功回放后才能 `enable`。

### 3. 录制真实 URL

```bash
cc skill recording record submit-report \
  --url https://portal.example.com/report \
  --allowed-origin https://portal.example.com \
  --identity report-robot \
  --storage-state ./playwright-storage-state.json \
  --automation ./automation.json \
  --failure "提交结果未出现时停止"
```

回放时重新提供同一 URL 和凭据状态：

```bash
cc skill recording replay submit-report \
  --url https://portal.example.com/report \
  --storage-state ./playwright-storage-state.json \
  --input reportTitle="月报"
```

存储状态正文不会写入草稿或审计，只持久化摘要。普通 URL 必须为 HTTPS；HTTP 只允许 `localhost`、`127.0.0.1` 或 `::1` 测试目标。跳转和子资源请求必须留在批准的来源集合内。

## 使用示例

完整 HTML 流程使用“录制 → 只读检查 → 显式批准 → 回放 → 启用”；登录态 URL 流程额外提供 `--identity` 和临时 `--storage-state`。可直接复用上面两个示例，并用 `--json` 将每一步结果交给 CI。回放验证通过后，可以检查审计、导出并撤销生成的 Skill：

```bash
cc skill recording audit --name open-project
cc skill recording export open-project --output ./open-project.recorded.json
cc skill recording revoke open-project --approve
```

## 配置参考

### 命令

| 命令                                   | 用途                                         |
| -------------------------------------- | -------------------------------------------- |
| `record <name>`                        | 录制 HTML 或 URL 目标并创建 draft            |
| `list` / `show <name>`                 | 查看状态或完整审阅投影                       |
| `review <name> --reviewer … --approve` | 批准精确 revision                            |
| `replay <name>`                        | 在策略绑定的临时 Chromium 中回放             |
| `enable <name> --approve`              | 安装到项目 Skill 层；`--global` 安装到全局层 |
| `revoke <name> --approve`              | 摘要校验后原子撤销生成的 Skill               |
| `export` / `import`                    | 导出或完整重验证导入；不包含运行时输入和凭据 |
| `delete <name> --approve`              | 删除非 enabled 记录                          |
| `audit`                                | 验证并显示 content-free 哈希链审计           |
| `prune --approve`                      | 按保留策略删除过期非 enabled 记录            |
| `policy` / `policy-template`           | 查看、显式批准后替换或生成治理策略           |

所有主要命令支持 `--json`，便于 CI 消费稳定的结构化结果。

### 默认治理策略

| 字段                  |                      默认值 | 约束                       |
| --------------------- | --------------------------: | -------------------------- |
| `retentionDays`       |                          90 | 1～3,650 天                |
| `maxRecords`          |                         500 | 1～10,000                  |
| `maxActions`          |                         256 | 1～256                     |
| `maxAuditEvents`      |                      20,000 | 100～100,000               |
| `allowedCapabilities` | `ui.interact`, `ui.observe` | 只允许受支持能力           |
| `allowGlobalInstall`  |                      `true` | 可由个人或组织下发策略关闭 |

### 运行边界

- HTML 最多 1,000,000 字符；CLI 输入文件最多 2 MiB。
- selector 最多 1,024 字符；`type` 值最多 8,192 字符；`select` 值最多 1,024 字符。
- viewport 为 320×240～3,840×2,160。
- 单步 timeout 为 100～30,000 ms；settle 为 0～1,000 ms。
- URL 白名单最多 8 个精确 origin，不接受带路径、查询、fragment 或 URL 凭据的 origin。
- 单步终态 evidence 最多 256 KiB，报告只保留 evidence digest。

## 性能指标

动作按审阅顺序串行执行，每一步都会读取前后状态、截图并计算多个摘要。该路径面向短而稳定的业务流程，不面向高频压测。

2026-08-30 本机 Windows 验证中，包含策略审批、录制、审阅、5 步回放、启用、撤销、导出、删除、导入和审计的完整 CLI E2E 用时约 19～30 秒；包含 HTML 与真实 loopback URL Chromium 的集成组合约 9～20 秒。数据只作为当前开发基线，不是跨机器 P50/P95 SLA。

## 测试覆盖

- 23 个聚焦 Vitest 用例覆盖领域校验、Playwright driver、浏览器目标策略、进程执行上下文和四条产品生命周期。
- 产品集成测试使用真实 Chromium 覆盖五种 action、密码自动标敏、人工敏感标记、持久化、revision CAS、安装、撤销、导入/导出和篡改拒绝。
- URL 集成测试使用真实 loopback HTTP 服务与 Cookie storage state，验证凭据正文不落盘、来源外请求被拒绝。
- CLI E2E 从实际 `cc` bin 完成录制、只读审阅拒绝、批准、回放、启用、Skill loader 发现、撤销、导出、删除、导入和审计。
- 三平台真实 Chromium 发布旅程覆盖 `observe/click/type/select/assert` 和主动网络逃逸探针，并按 exact SHA 聚合 Linux、Windows、macOS 证据。

本地结果不能替代发布提交自身的三平台 CI 与 Strict Sandbox 门禁。

## 安全考虑

- 不把密码、token、Cookie、私钥或个人资料写入 description、failure condition、environment 或断言常量；所有持久字段都会扫描，但正则扫描不能代替人工审阅。
- storage-state 文件必须是有界普通文件且不能是符号链接；只持久化其摘要和非秘密身份标签。
- HTML 目标强制断网；URL 目标只允许审批过的精确来源，任何动作触发来源外网络或文件访问都会使回放失败。
- Chromium 只能通过 ProcessExecutionBroker 中与实际 executable path 精确匹配的临时执行上下文启动。
- import、store read、review、replay、enable 和 revoke 都会重新 canonicalize 并验证摘要；未知字段、修改内容和 stale revision 失败关闭。
- 生成 Skill 若被手工修改，自动撤销不会删除它，而是返回安装已修改错误，避免误删用户内容。
- 审计事件只保存名称、状态、revision、actor、时间和摘要链，不保存页面、selector、参数值或凭据。

## 故障排除

| 错误码                                 | 原因与处理                                                 |
| -------------------------------------- | ---------------------------------------------------------- |
| `CC_RECORD_EXPLICIT_APPROVAL_REQUIRED` | `review/enable/revoke/delete/prune` 缺少显式 `--approve`   |
| `CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA` | 持久字段仍含敏感或易变正文；参数化或删除后重新录制         |
| `CC_RECORD_REVISION_CONFLICT`          | 记录被其他进程更新；重新 `show` 并审阅当前 revision        |
| `CC_RECORD_TARGET_DRIFT`               | HTML 内容或完整 URL 与录制目标不同                         |
| `CC_RECORD_CREDENTIAL_DRIFT`           | storage-state 摘要变化；恢复批准凭据或重新录制审阅         |
| `CC_REPLAY_ENVIRONMENT_DRIFT`          | 身份、来源策略或环境摘要变化                               |
| `CC_REPLAY_UI_TARGET_AMBIGUOUS`        | selector 匹配零个或多个元素；使用稳定唯一属性              |
| `CC_REPLAY_UI_NETWORK_ATTEMPT`         | 动作触发来源外网络或文件访问；修正流程或白名单后重新审阅   |
| `CC_RECORD_INSTALL_MODIFIED`           | 已安装生成 Skill 被修改；人工确认差异后处理                |
| `CC_RECORD_STORE_CORRUPT`              | store schema、摘要或审计链不一致；保留文件并从可信导出恢复 |

## 关键文件

- `packages/cli/src/commands/record-replay.js`：稳定 CLI 产品入口。
- `packages/cli/src/lib/record-replay/playwright-ui-recorder.js`：真实 Chromium 事件捕获与 selector 生成。
- `packages/cli/src/lib/record-replay/browser-target-policy.js`：URL、凭据摘要和网络来源策略。
- `packages/cli/src/lib/record-replay/skill-recorder.js`：草稿、审阅、参数化、验证与回放领域逻辑。
- `packages/cli/src/lib/record-replay/playwright-ui-driver.js`：隔离回放和 content-free evidence。
- `packages/cli/src/lib/record-replay/recorded-skill-store.js`：版本化 store、策略、审计和导入/导出。
- `packages/cli/src/lib/record-replay/recorded-skill-package.js`：Skill 安装与可回滚撤销事务。
- `packages/cli/__tests__/integration/record-replay-product-lifecycle.test.js`：真实浏览器产品旅程。
- `packages/cli/__tests__/e2e/record-replay-cli.e2e.test.js`：实际 CLI 生命周期。

## 相关文档

- [文档站用户指南](../../docs-site/docs/chainlesschain/record-replay-skill.md)
- [模块 111 设计](../design/modules/111-record-replay-skill-design.md)
- [P2-4 差距分析与验收](../CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md)
- [Skill 系统](../../docs-site/docs/chainlesschain/skills.md)
