# Record & Replay → Skill

> 适用对象：希望评估或集成可回放 Skill 的用户与开发者
>
> 当前状态：技术预览。P2-4 的草稿、审阅、隔离回放和三平台验证已经完成，但尚未提供稳定的 `cc` 子命令或 Desktop 可视化录制入口。

## 概述

Record & Replay → Skill 用于把一组稳定、低风险的界面操作整理为可审阅、可参数化、可验证的 Skill 草稿。它不是视频录屏，也不会直接把用户操作转换成不受限制的脚本。

当前实现接收已经结构化的操作列表，完成敏感信息和易变值扫描、参数替换、能力清单生成与环境绑定；用户明确审阅后，再由临时、断网的 Playwright Chromium 环境回放。只有所有步骤都返回终态证据，回放才会成功。

当前适合仓库集成、自动化验证和低风险本地界面流程试验。普通用户暂时不能从 Desktop 点击“开始录制”，也没有稳定的 `cc record` 或 `cc replay` 命令。

### 当前代码与产品入口

| 层面 | 当前状态 | 代码依据 |
| --- | --- | --- |
| 草稿、审阅和回放领域 API | 已实现 | `skill-recorder.js` 导出三个生命周期函数 |
| Playwright 临时浏览器驱动 | 已实现 | `playwright-ui-driver.js` 默认动态加载 Playwright Chromium |
| 真实三平台发布旅程 | 已实现 | `record-replay-ui-journey.mjs` 执行 click/assert 正向流程和网络逃逸探针 |
| 稳定 CLI 子命令 | 尚未实现 | 当前命令注册表没有 Record & Replay 命令 |
| Desktop 可视化录制入口 | 尚未实现 | 当前没有事件捕获、selector 生成或审阅页面 |
| 真实网站导航与登录态回放 | 尚未支持 | 当前 driver 只接受自包含 HTML，并拒绝 HTTP(S)、WebSocket 和文件请求 |
| 转换、安装并启用为正式 Skill | 尚未接通 | 当前回放成功后只返回 report，不写入 Skill loader |

## 核心特性

- 支持 `observe`、`click`、`type`、`select`、`assert` 五种有界操作。
- 把捕获值替换为 `${parameter.name}` 参数，避免把账号、测试数据或易变值写入 Skill。
- 扫描常见 secret、PII 和临时路径、时间戳、UUID 等易变数据。
- 自动生成 `ui.observe` 和 `ui.interact` capability manifest。
- 审阅必须精确接受能力清单和失败条件，不能模糊授权。
- 回放要求环境摘要一致、沙箱开启并禁用网络。
- selector 必须精确匹配一个可见元素；歧义、漂移和缺少终态证据都会失败。
- receipt 只保留摘要和有界结构元数据，不保存 selector、输入值、页面正文、URL 或截图本体。

## 系统架构

```text
结构化操作列表
      │
      ▼
草稿生成器 ── secret / PII / volatile 扫描
      │        参数化 + capability / environment binding
      ▼
待审阅 Skill 草稿
      │
      ▼
用户精确审阅 capability 与失败条件
      │
      ▼
临时 Playwright Chromium context
      │        network-off / filesystem denied
      ▼
逐步终态证据 ──► metadata-only replay receipt
```

当前系统由两部分组成：`skill-recorder.js` 负责草稿、审阅和回放生命周期，`playwright-ui-driver.js` 负责临时浏览器中的实际操作与证据摘要。当前驱动器加载调用方提供的 HTML fixture，不会访问真实网站。

## 快速开始

### 使用流程

1. 将稳定流程整理成受支持的结构化 action。
2. 将账号、姓名、测试输入和每次运行都会变化的值声明为参数。
3. 生成草稿并检查扫描结果、操作顺序、selector、失败条件和环境要求。
4. 精确批准草稿生成的 capability manifest。
5. 在相同环境摘要下，通过断网临时浏览器执行回放。
6. 检查 replay receipt；全部步骤成功后，才进入后续 Skill 保存或启用流程。

### 支持的操作

| 操作 | 用途 | 所需能力 | 注意事项 |
| --- | --- | --- | --- |
| `observe` | 确认目标可见并记录状态摘要 | `ui.observe` | selector 必须唯一 |
| `click` | 点击按钮、链接或其他目标 | `ui.interact` | 点击后的目标允许被移除 |
| `type` | 向输入控件填值 | `ui.interact` | 用户数据应参数化 |
| `select` | 选择下拉选项 | `ui.interact` | 选项值应稳定或参数化 |
| `assert` | 断言文本或控件值 | `ui.observe` | 不提供 `value` 时只检查可见性 |

## 配置参考

### 草稿参数

| 参数 | 含义 | 当前约束 |
| --- | --- | --- |
| `name` | Skill 名称 | 字母开头，最多 128 个受支持字符 |
| `description` | 说明 | 最多 2,048 字符 |
| `actions` | 操作列表 | 1～256 个操作 |
| `parameterBindings` | 捕获值与参数名的映射 | 参数名唯一；捕获值不能为空 |
| `environment` | 回放环境要求 | 以 canonical digest 精确绑定 |
| `failureConditions` | 用户接受的失败条件 | 每项最多保留 512 字符 |

### 回放参数

| 参数 | 含义 | 当前要求 |
| --- | --- | --- |
| `inputs` | 参数实际值 | 所有 required 参数必须提供 |
| `environment` | 当前环境 | 摘要必须与审阅稿一致 |
| `isolation.sandboxed` | 是否在沙箱中运行 | 必须为 `true` |
| `isolation.network` | 网络策略 | 必须为 `deny` |
| `timeoutMs` | 单步等待上限 | 100～30,000 ms，默认 5,000 ms |
| `settleMs` | 操作后稳定等待 | 0～1,000 ms，默认 25 ms |
| `viewport` | 浏览器视口 | 宽 320～3,840，高 240～2,160 |

`required:false` 当前只影响预检查；如果 action 实际引用了该参数，展开阶段仍要求提供输入。完整占位符可以替换为任意 JSON 值，嵌在较长字符串中的占位符只接受字符串。`sensitive` 当前是审阅元数据，不会自动从外部 SecretStore 取值。

## 使用示例（技术预览）

下面示例展示仓库内部 API 的形状，不代表公开 npm subpath 或稳定 CLI 接口：

```js
import {
  createRecordedSkillDraft,
  reviewRecordedSkillDraft,
  replayRecordedSkill,
  launchPlaywrightRecordedSkillDriver,
} from "./packages/cli/src/lib/record-replay/index.js";

const environment = { application: "demo-form", revision: "1" };

const draft = createRecordedSkillDraft({
  name: "fill-demo-form",
  actions: [
    { kind: "type", target: "#name", value: "Captured Name" },
    { kind: "assert", target: "#name", value: "Captured Name" },
  ],
  parameterBindings: [
    { name: "displayName", value: "Captured Name", sensitive: true },
  ],
  environment,
  failureConditions: ["名称输入框缺失或不唯一时停止"],
});

const approved = reviewRecordedSkillDraft(draft, {
  reviewerId: "local-reviewer",
  approvedCapabilities: draft.capabilityManifest,
  acceptedFailureConditions: true,
});

const driver = await launchPlaywrightRecordedSkillDriver({
  html: '<label>名称 <input id="name"></label>',
});

try {
  const receipt = await replayRecordedSkill(approved, {
    inputs: { displayName: "本次输入" },
    environment,
    executor: driver.executor,
  });
  console.log(receipt.status, receipt.replayDigest);
} finally {
  await driver.close();
}
```

## 性能指标

- 操作按顺序执行，不进行并发点击或输入。
- 单个草稿最多 256 个 action。
- HTML fixture 最大 1,000,000 字符。
- `type` 值最大 8,192 字符，selector 和选择值也有独立上限。
- 每一步都会读取目标状态并计算页面和截图摘要，因此它更适合短而稳定的流程，不适合高频性能压测。
- 浏览器启动和逐步截图通常是主要耗时；具体时间取决于主机和 action 数量。

当前没有对普通用户承诺固定的 P50/P95。产品化前应针对真实入口公布启动时间、单步延迟、成功率与资源占用基线。

## 测试覆盖

仓库测试覆盖以下边界：

- `record-replay-skill.test.js` 的 6 个领域测试用例覆盖草稿生成、参数替换、secret/PII/volatile 拒绝、精确审阅、隔离、环境漂移和 report。
- `record-replay-playwright-driver.test.js` 的 2 个受控 Playwright double 测试覆盖 click/assert/type/select、content-free summary、资源回收和网络逃逸；它不是三平台真实浏览器证据。
- `record-replay-ui-journey.mjs` 才使用默认 Playwright Chromium，在 Linux、Windows、macOS 分别执行 click/assert 正向旅程和主动网络逃逸探针。
- 三平台聚合器校验 exact SHA、平台完整性、fixture/draft/approval 摘要、action 数量和负向探针结果。

当前真实浏览器发布旅程没有逐项覆盖 `observe`、`type` 和 `select`，这些 action 目前由实现和受控单元测试覆盖。扩展正式产品入口前，应补齐五种 action 的真实浏览器矩阵以及录制、审阅、启用端到端测试。

发布证据绑定精确提交，不能用本地单测或旧提交的 CI 结果代替新版本的三平台门禁。

## 安全考虑

- 不要把密码、token、Cookie、私钥、手机号、邮箱或真实个人资料直接写入 action。
- 正则扫描只能作为防线之一，不能证明任意业务数据都已完全识别；审阅者仍需检查所有步骤。
- 当前扫描器只遍历参数化后的 `actions`；`description`、`environment` 和 `failureConditions` 不会自动扫描，而且环境 requirements 会保存在草稿中，因此这些字段同样禁止放入秘密或个人信息。
- 回放默认拒绝 `file:`、`http:`、`https:`、`ws:` 和 `wss:` 请求。
- 不要通过修改环境摘要、selector 或 action 绕过已经完成的审阅。
- 当前技术预览只应接收进程内生成并保持受控的对象；外部导入和持久化格式尚未声明为稳定或可信边界。
- receipt 中的摘要用于关联证据，不等同于公开内容，也不应被反向用作用户输入存储。

## 故障排除

| 错误码 | 常见原因 | 处理方式 |
| --- | --- | --- |
| `CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA` | action 中仍有敏感或易变值 | 将对应值改为参数并重新审阅 |
| `CC_REPLAY_UNSAFE_ACTION` | 使用了五种 allowlist 之外的操作 | 拆分流程或等待受控词汇扩展 |
| `CC_REPLAY_REVIEW_INCOMPLETE` | capability 或失败条件未精确接受 | 按草稿 manifest 完成审阅 |
| `CC_REPLAY_NOT_APPROVED` | 草稿未审阅就尝试回放 | 先生成正式 review |
| `CC_REPLAY_ENVIRONMENT_DRIFT` | 当前环境摘要与审阅稿不同 | 恢复匹配环境或重新录制、审阅 |
| `CC_REPLAY_CAPABILITY_DENIED` | 驱动器没有所需能力 | 使用匹配能力的受控 executor |
| `CC_REPLAY_UI_TARGET_AMBIGUOUS` | selector 匹配零个或多个元素 | 改成稳定且唯一的 selector |
| `CC_REPLAY_UI_NETWORK_ATTEMPT` | 页面或操作尝试访问网络或文件 | 删除外部依赖，使用自包含 fixture |
| `CC_REPLAY_ACTION_FAILED` | 步骤没有成功终态证据 | 检查目标可见性、断言和超时 |
| `CC_REPLAY_UI_DRIVER_UNAVAILABLE` | Playwright Chromium 不可用 | 在受支持环境安装并验证 Chromium |

## 关键文件

- `packages/cli/src/lib/record-replay/skill-recorder.js`：草稿、审阅、参数化和回放生命周期。
- `packages/cli/src/lib/record-replay/playwright-ui-driver.js`：真实 Chromium 隔离驱动器。
- `packages/cli/__tests__/unit/record-replay-skill.test.js`：领域逻辑测试。
- `packages/cli/__tests__/unit/record-replay-playwright-driver.test.js`：受控 Playwright double 的驱动契约测试。
- `packages/cli/scripts/record-replay-ui-journey.mjs`：三平台发布旅程。

## 相关文档

- [Record & Replay → Skill 设计](/design/modules/111-record-replay-skill-design)
- [Agent Platform 发布与证据边界](/chainlesschain/agent-platform-release)
- [Desktop Graph 调试与 Skill 安全](/chainlesschain/desktop-graph-skill-security)
- [技能系统](/chainlesschain/skills)
