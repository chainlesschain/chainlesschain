# Record & Replay → Skill

> 适用对象：希望把稳定浏览器流程录制为可审阅 Skill 的用户、管理员和开发者
>
> 当前状态：CLI 产品入口已实现；当前不包含 Desktop 可视化录制页。

## 概述

Record & Replay 把一次受控的浏览器操作转换为可审阅、可参数化、可重复执行的 Skill。它不录制视频，也不生成任意 JavaScript：录制器只接受 `observe`、`click`、`type`、`select`、`assert` 五种操作，生成稳定 selector，并在批准前显示完整动作、参数、能力、环境和失败条件。

```bash
cc skill recording --help
# 等价别名
cc skill record-replay --help
```

## 核心特性

- 从真实 Chromium 捕获 `click/type/select`，通过参数追加 `observe/assert`。
- selector 优先使用测试属性、`id`、`name`、`aria-label` 和结构 CSS，不使用页面文本。
- 捕获值只在内存中存在；密码框自动标敏，`--sensitive` 可人工标记业务敏感参数。
- 草稿、审批、环境、回放、存储、导出、审计和安装包分别使用域隔离摘要。
- 支持自包含 HTML 离线目标，以及凭据摘要和精确来源白名单约束的 HTTPS 目标。
- 回放成功后可安装到现有 Skill loader，并支持摘要校验后的原子撤销。
- 提供 revision CAS、保留期、删除、导入/导出、哈希链审计和组织策略入口。

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

持久状态位于 CLI 配置目录的 `record-replay/state.json`。写入使用文件锁、revision CAS、原子替换和 owner-only 权限；读取与导入时重新验证 schema 和摘要。

## 快速开始

准备自动化输入 `automation.json`：

```json
[
  { "kind": "click", "target": "#open" },
  { "kind": "type", "target": "#account", "value": "captured-account" },
  { "kind": "select", "target": "#region", "value": "cn" }
]
```

录制、审阅、回放并启用：

```bash
cc skill recording record open-project \
  --fixture ./fixture.html \
  --automation ./automation.json \
  --observe h1 \
  --assertions ./assertions.json \
  --sensitive account \
  --failure "页面未进入 ready 状态时停止"

cc skill recording show open-project
cc skill recording review open-project --reviewer reviewer-1 --approve

cc skill recording replay open-project \
  --fixture ./fixture.html \
  --input account=runtime-account \
  --input region=cn

cc skill recording enable open-project --approve
cc skill list --source workspace
```

不传 `--automation` 时需要 TTY；命令会打开 Chromium，操作完成后在终端按 Enter。`review` 不带 `--approve` 只读。只有当前批准 revision 回放成功后才能启用。

## 真实 URL 与登录态

```bash
cc skill recording record submit-report \
  --url https://portal.example.com/report \
  --allowed-origin https://portal.example.com \
  --identity report-robot \
  --storage-state ./playwright-storage-state.json \
  --automation ./automation.json \
  --failure "提交结果未出现时停止"

cc skill recording replay submit-report \
  --url https://portal.example.com/report \
  --storage-state ./playwright-storage-state.json \
  --input reportTitle="月报"
```

storage-state 正文不会写入草稿或审计，只持久化摘要。普通 URL 必须使用 HTTPS；HTTP 只允许 loopback 测试目标。跳转和子资源必须留在批准的精确 origin 集合内。

## 使用示例

完整 HTML 流程使用“录制 → 只读检查 → 显式批准 → 回放 → 启用”；登录态 URL 流程额外提供 `--identity` 和临时 `--storage-state`。可直接复用上面两个示例，并用 `--json` 将每一步结果交给 CI。回放验证通过后，可以这样检查和撤销生成的 Skill：

```bash
cc skill recording audit --name open-project
cc skill recording export open-project --output ./open-project.recorded.json
cc skill recording revoke open-project --approve
```

## 配置参考

### 命令

| 命令                                   | 用途                                         |
| -------------------------------------- | -------------------------------------------- |
| `record <name>`                        | 录制 HTML 或 URL 并创建 draft                |
| `list` / `show <name>`                 | 查看状态或完整审阅投影                       |
| `review <name> --reviewer … --approve` | 批准精确 revision                            |
| `replay <name>`                        | 在策略绑定的临时 Chromium 中回放             |
| `enable <name> --approve`              | 安装到项目 Skill 层；`--global` 安装到全局层 |
| `revoke <name> --approve`              | 摘要校验后撤销生成 Skill                     |
| `export` / `import`                    | 无运行时输入、无凭据地导出和重验证导入       |
| `delete` / `prune`                     | 显式批准后删除单项或过期非 enabled 记录      |
| `audit`                                | 验证 content-free 哈希链审计                 |
| `policy` / `policy-template`           | 查看、显式批准后替换或生成治理策略           |

所有主要命令支持 `--json`。

### 默认策略与资源边界

| 项目                     | 默认/上限                    |
| ------------------------ | ---------------------------- |
| 保留期、记录数、审计事件 | 90 天、500 条、20,000 事件   |
| action 数量              | 1～256                       |
| HTML / CLI JSON 文件     | 1,000,000 字符 / 2 MiB       |
| selector / type / select | 1,024 / 8,192 / 1,024 字符   |
| 单步 timeout / settle    | 100～30,000 ms / 0～1,000 ms |
| URL 来源白名单           | 最多 8 个精确 origin         |
| 单步 evidence            | 最多 256 KiB，报告只保存摘要 |

策略还可限制 `allowedCapabilities` 和 `allowGlobalInstall`。先运行 `policy-template` 生成 JSON，再用 `policy --set <file> --approve` 应用。

## 性能指标

action 串行执行，每一步读取前后状态、截图并计算摘要。2026-08-30 本机 Windows 验证中，包含策略审批、录制、审阅、5 步回放、启用、撤销、导出、删除、导入和审计的 CLI E2E 约 19～30 秒；HTML 与真实 loopback URL Chromium 集成组合约 9～20 秒。它们是开发基线，不是跨机器 P50/P95 SLA。

## 测试覆盖

- 23 个聚焦 Vitest 用例覆盖领域、driver、目标策略、进程上下文和四条产品生命周期。
- 真实 Chromium 产品集成覆盖五种 action、密码自动标敏、人工敏感标记、store、CAS、安装、撤销、导入/导出和篡改拒绝。
- URL 集成使用真实 loopback 服务和 Cookie storage state，验证敏感正文不落盘及来源外请求失败关闭。
- 实际 CLI E2E 覆盖录制、审阅、回放、启用、Skill loader 发现、撤销、导出、删除、导入和审计。
- 三平台发布旅程覆盖五种 action 和网络逃逸探针，并按 exact SHA 聚合 Linux、Windows、macOS 证据。

本地结果不能替代发布提交自身的三平台 CI 与 Strict Sandbox 门禁。

## 安全考虑

- 密码、token、Cookie、私钥和个人资料不能写入 description、failure condition、environment 或断言常量；全字段扫描仍不能替代人工审阅。
- storage-state 必须是有界普通文件且不能是符号链接；系统只保存摘要和非秘密身份标签。
- HTML 强制断网；URL 只允许审批过的精确来源，来源外网络或文件请求会使回放失败。
- Chromium 通过 ProcessExecutionBroker 的精确 executable path 临时授权启动。
- store read、import、review、replay、enable、revoke 都会重算摘要；未知字段、修改内容和 stale revision 失败关闭。
- 生成 Skill 被手工修改后，自动撤销拒绝删除，避免误删用户内容。
- 审计不保存页面、selector、参数值或凭据。

## 故障排除

| 错误码                                 | 处理方式                                   |
| -------------------------------------- | ------------------------------------------ |
| `CC_RECORD_EXPLICIT_APPROVAL_REQUIRED` | 为变更状态的命令添加显式 `--approve`       |
| `CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA` | 参数化或删除命中的正文后重新录制           |
| `CC_RECORD_REVISION_CONFLICT`          | 重新 `show` 并审阅当前 revision            |
| `CC_RECORD_TARGET_DRIFT`               | 恢复原 HTML/完整 URL 或重新录制            |
| `CC_RECORD_CREDENTIAL_DRIFT`           | 使用摘要匹配的 storage-state 或重新审阅    |
| `CC_REPLAY_ENVIRONMENT_DRIFT`          | 恢复身份、来源和环境绑定                   |
| `CC_REPLAY_UI_TARGET_AMBIGUOUS`        | 改用稳定且唯一的 selector                  |
| `CC_REPLAY_UI_NETWORK_ATTEMPT`         | 删除来源外访问，或修改白名单后重新录制审阅 |
| `CC_RECORD_INSTALL_MODIFIED`           | 人工检查已修改的生成 Skill                 |
| `CC_RECORD_STORE_CORRUPT`              | 保留原文件，并从可信导出恢复               |

## 关键文件

- `packages/cli/src/commands/record-replay.js`：CLI 产品入口。
- `packages/cli/src/lib/record-replay/playwright-ui-recorder.js`：事件捕获与 selector 生成。
- `packages/cli/src/lib/record-replay/browser-target-policy.js`：URL、凭据和来源策略。
- `packages/cli/src/lib/record-replay/skill-recorder.js`：草稿、审阅和回放领域逻辑。
- `packages/cli/src/lib/record-replay/playwright-ui-driver.js`：隔离回放与 evidence。
- `packages/cli/src/lib/record-replay/recorded-skill-store.js`：store、策略、审计和导入/导出。
- `packages/cli/src/lib/record-replay/recorded-skill-package.js`：Skill 安装和撤销事务。

## 相关文档

- [Record & Replay → Skill 设计](/design/modules/111-record-replay-skill-design)
- [Agent Platform 发布与证据边界](/chainlesschain/agent-platform-release)
- [Desktop Graph 调试与 Skill 安全](/chainlesschain/desktop-graph-skill-security)
- [技能系统](/chainlesschain/skills)
