# Record & Replay → Skill 用户指南

Record & Replay → Skill 当前为技术预览：它可以把结构化 UI 操作生成经过扫描、参数化和能力审阅的 Skill 草稿，并在断网临时 Chromium 中验证回放；仓库暂未提供稳定的 CLI 子命令或 Desktop 可视化录制入口。

## 概述

该能力面向稳定、低风险、自包含的 UI 流程。当前代码接收结构化 action，而不是直接捕获鼠标和键盘事件；经过参数化、扫描和精确审阅后，才能在断网临时浏览器中执行。

## 核心特性

- 支持 `observe`、`click`、`type`、`select`、`assert`。
- 生成 `ui.observe`、`ui.interact` 能力清单。
- 扫描常见 secret、PII 和 volatile value。
- 精确绑定环境摘要并生成 metadata-only receipt。
- 网络、文件、歧义 selector、环境漂移和缺少证据时失败关闭。

## 系统架构

```text
结构化 action → 参数化/扫描 → draft → 用户审阅 → 临时 Chromium 回放 → receipt
```

`skill-recorder.js` 管理领域生命周期，`playwright-ui-driver.js` 执行自包含 HTML fixture。当前没有稳定 CLI 命令、Desktop 录制 UI、真实网站导航或 Skill 安装接线。

## 配置参考

- 草稿接受 1～256 个 action。
- 环境对象必须稳定且不含秘密；回放时摘要必须完全一致。
- `isolation.sandboxed` 必须为 `true`，`isolation.network` 必须为 `deny`。
- 单步 timeout 为 100～30,000 ms，settle 为 0～1,000 ms。
- Playwright fixture HTML 最大 1,000,000 字符。
- `required:false` 不是默认值机制；action 引用的参数在展开时仍必须提供。

## 性能指标

action 串行执行，每步读取前后状态并计算页面和截图摘要。该路径以可验证性为优先，不适合高频性能压测；当前没有对普通用户承诺固定 P50/P95。

## 测试覆盖

- 6 个领域单元测试用例覆盖草稿、扫描、参数、审阅、隔离、环境和 report。
- 2 个受控 Playwright double 测试覆盖 click/assert/type/select、证据最小化、资源回收和网络逃逸。
- 三平台真实 Chromium 旅程覆盖 click/assert 正向流程与主动网络逃逸探针。

`observe`、`type` 和 `select` 尚未逐项进入真实浏览器发布矩阵，正式产品化前需要补齐。

## 安全考虑

不要把密码、token、Cookie、私钥或个人资料直接写入 action。当前扫描只覆盖参数化后的 action，不覆盖 description、environment 和 failure conditions；后面三个字段也不能放秘密。正则扫描不能代替人工审阅。当前只支持受控进程内对象；外部导入、跨进程持久化和真实网站凭据不属于稳定边界。

## 故障排除

| 错误 | 处理方式 |
| --- | --- |
| `CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA` | 参数化命中的敏感或易变值 |
| `CC_REPLAY_REVIEW_INCOMPLETE` | 精确接受 capability 和失败条件 |
| `CC_REPLAY_ENVIRONMENT_DRIFT` | 使用匹配环境或重新生成、审阅草稿 |
| `CC_REPLAY_UI_TARGET_AMBIGUOUS` | 使用稳定且唯一的 selector |
| `CC_REPLAY_UI_NETWORK_ATTEMPT` | 删除网络或文件依赖，改用自包含 fixture |

## 关键文件

- `packages/cli/src/lib/record-replay/skill-recorder.js`
- `packages/cli/src/lib/record-replay/playwright-ui-driver.js`
- `packages/cli/__tests__/unit/record-replay-skill.test.js`
- `packages/cli/__tests__/unit/record-replay-playwright-driver.test.js`
- `packages/cli/scripts/record-replay-ui-journey.mjs`

## 使用示例

```js
const draft = createRecordedSkillDraft({
  name: "open-project",
  actions: [{ kind: "click", target: "#project" }],
  environment: { app: "local-fixture", revision: "1" },
  failureConditions: ["目标不存在或不唯一时停止"],
});
```

完整示例包含显式审阅、参数输入、driver 创建、回放和 `finally` 资源关闭，参见文档站页面。

## 相关文档

- [面向用户的完整指南](../../docs-site/docs/chainlesschain/record-replay-skill.md)
- [模块 111 设计](../design/modules/111-record-replay-skill-design.md)
- [P2-4 差距分析与验收](../CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md)
