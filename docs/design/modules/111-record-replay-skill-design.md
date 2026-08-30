# 111 Record & Replay → Skill 设计

> 状态：P2-4 回放内核与三平台发布边界已关闭；产品入口仍为技术预览
>
> 适用范围：`packages/cli/src/lib/record-replay/` 及其测试、发布旅程和后续产品适配器
>
> 用户文档：[Record & Replay → Skill](../../features/record-replay-skill-user-guide.md)

## 1. 背景与决策

ChainlessChain 已有 Skill 加载、审阅、能力控制和隔离执行基础，但“用户演示一次流程，系统生成可复用 Skill”的完整产品闭环需要一个比录屏更严格的中间模型。原始鼠标坐标、按键流和页面内容既脆弱，也容易携带秘密、个人信息和环境偶然值。

本模块采用以下决策：

1. 录制产物是有界、结构化的 action，不是视频或任意脚本。
2. action 必须先参数化和扫描，再生成带摘要的 Skill 草稿。
3. capability、失败条件和环境要求必须由用户精确审阅。
4. 回放使用临时、断网的 Playwright Chromium context，并逐步产生终态证据。
5. receipt 只保留 domain-separated digest 和有界元数据，不保存用户内容。
6. 当前实现定位为回放内核与产品化基础，不把尚未存在的 Desktop/CLI 录制入口声明为完成。

## 2. 目标与非目标

### 2.1 目标

- 为低风险、可重复 UI 流程提供确定性的 action vocabulary。
- 在生成草稿前识别常见 secret、PII 和 volatile value。
- 把捕获值变成显式参数，而不是隐式模板变量。
- 将草稿、审阅、环境和回放证据用不同摘要域绑定。
- 在 capability 不足、环境漂移、selector 歧义、网络逃逸或证据缺失时失败关闭。
- 为未来 Desktop、CLI、IDE 或浏览器产品入口提供共享内核。

### 2.2 非目标

- 不录制视频、音频或完整页面正文。
- 不执行任意 JavaScript、Shell、文件操作或网络请求。
- 不以当前 fixture driver 代替真实浏览器站点自动化产品。
- 不自动批准或启用生成的 Skill。
- 不保证正则扫描可以识别所有业务敏感信息。
- 不在当前阶段冻结公开 npm subpath、持久化文件格式或 CLI 命令。

## 3. 核心特性

### 3.1 当前能力边界

当前实现包含三个领域操作和一个真实 UI driver：

| 能力 | API | 当前语义 |
| --- | --- | --- |
| 创建草稿 | `createRecordedSkillDraft` | 校验 action、参数化捕获值、扫描敏感/易变内容、生成 capability 与 environment digest |
| 审阅草稿 | `reviewRecordedSkillDraft` | 要求 reviewer、精确 capability 集和失败条件确认，生成 approval digest |
| 回放 Skill | `replayRecordedSkill` | 校验审批、隔离、环境和 executor capability，顺序执行并汇总 receipt |
| 启动 UI driver | `launchPlaywrightRecordedSkillDriver` | 在临时 Chromium context 加载自包含 HTML，离线执行有界 action |

这里的“Record”目前表示将调用方提供的结构化操作规范化为 recorded Skill draft。仓库尚无捕获真实用户事件、生成 selector、保存草稿或呈现审阅 UI 的生产入口。

## 4. 系统架构

```text
Product Recorder Adapter（未来）
  Desktop / CLI / IDE / Browser
                │
                ▼
        CapturedAction[]
                │
                ▼
┌──────────────────────────────────────┐
│ Recorded Skill Domain               │
│  sanitize → parameterize → scan     │
│  capability manifest                │
│  environment binding                │
│  draft/review/replay digest          │
└──────────────────────────────────────┘
                │
                ▼
          Reviewed Draft
                │
                ▼
┌──────────────────────────────────────┐
│ Replay Executor                     │
│  current: Playwright fixture driver │
│  ephemeral / offline / bounded      │
└──────────────────────────────────────┘
                │
                ▼
      Evidence Digest[] + Receipt
                │
                ▼
 Skill packaging / installation（未来）
```

领域层不依赖具体 UI。产品适配器负责捕获和展示，executor 负责执行；两者都不能改变领域层已经审阅的能力、环境或 action 顺序。

## 5. 领域模型

### 5.1 RecordedSkillDraft

草稿 schema 为 `chainlesschain.recorded-skill-draft/v1`，包含：

- `name`、`description` 和 `status=draft`；
- 1～256 个带稳定 `action-N` ID 的 action；
- 不含捕获原值的参数定义；
- 从 action 计算出的 `capabilityManifest`；
- 用户需要审阅的 `failureConditions`；
- canonical environment requirements 与 digest；
- `cc.record-replay.skill-draft/v1` 摘要域生成的 `draftDigest`。

### 5.2 ReviewedRecordedSkill

审阅结果保留草稿内容并增加：

- `status=approved`；
- `reviewerId`；
- 精确排序后的 `approvedCapabilities`；
- `acceptedFailureConditions=true`；
- 绑定 `draftDigest` 的 `approvalDigest`。

批准集合必须和草稿 capability manifest 完全一致。审阅方不能少批后继续执行，也不能在同一次审阅里静默扩权。

### 5.3 ReplayReport

回放报告 schema 为 `chainlesschain.recorded-skill-replay/v1`，包含：

- `skillDigest`；
- `environmentDigest`；
- `status=succeeded`；
- 按 action 顺序排列的 `actionId + evidenceDigest`；
- `cc.record-replay.report/v1` 摘要域生成的 `replayDigest`。

只有全部 action 成功才会生成 succeeded report。当前失败通过稳定 error code 和异常返回，不生成伪成功或部分成功报告。

## 6. 生命周期与状态机

```text
captured actions
      │ create + scan
      ▼
    DRAFT ───── invalid/sensitive/volatile ───► REJECTED
      │ exact review
      ▼
  APPROVED ─── environment/capability drift ─► DENIED
      │ isolated replay
      ├── action/network/evidence failure ───► FAILED
      ▼
  SUCCEEDED
```

当前对象状态没有持久化 store。未来加入保存、恢复和跨进程传递时，必须定义版本化 envelope、canonical validation、revision CAS、签名或等价完整性保护，以及草稿被修改后的审阅失效规则。

## 7. Action vocabulary

| kind | capability | 执行语义 | 终态要求 |
| --- | --- | --- | --- |
| `observe` | `ui.observe` | 等待唯一目标可见并读取结构状态 | before/after/page/screenshot digest |
| `assert` | `ui.observe` | 检查可见性，可选比较文本或控件值 | 断言相等并产生证据 |
| `click` | `ui.interact` | 点击唯一可见目标 | 允许目标在点击后移除 |
| `type` | `ui.interact` | 使用 locator `fill` 写入值 | 值受长度限制，输出不含正文 |
| `select` | `ui.interact` | 使用 `selectOption` 选择值 | 值受长度限制，输出不含正文 |

不支持坐标点击、键盘宏、拖放、上传、下载、导航、脚本执行或剪贴板访问。新增 action 必须同时定义 capability、输入上限、终态证据、隐私处理、负向测试和三平台发布旅程。

## 8. 参数化与内容扫描

`parameterBindings` 将捕获字符串全量替换为 `${parameter.<name>}`。草稿只保存参数名、`sensitive` 和 `required`，不保存 binding 原值。

扫描器当前识别：

- 私钥头、Bearer、常见 token/password/secret/API key 形态；
- 邮箱、中国大陆手机号和美国 SSN 形态；
- UUID、ISO 时间戳和 tmp/temp 路径。

扫描发生在参数替换之后，因此调用方应先声明已知敏感值。扫描结果只返回 path 和 category，不回显命中的内容。

当前代码只对 `sanitizedActions` 调用扫描器。`description`、`environment` 和 `failureConditions` 没有进入扫描，而 environment requirements 会原样克隆到草稿；这些字段必须由调用方和审阅界面保证不含秘密、PII 或易变值。`sensitive` 当前只是参数定义元数据，不会自动连接 SecretStore。

`required:false` 目前只跳过回放前的 required 检查；只要 action 中引用该参数，`expandParameters` 仍会在缺值时返回 `CC_REPLAY_PARAMETER_MISSING`。完整占位符可替换为任意值，嵌入字符串的占位符只接受字符串。未来如需真正的 optional/default 语义，必须升级 schema，而不能改变 v1 的解释。

正则扫描不是数据分类引擎。未来产品适配器必须允许用户手动标记敏感字段，并在可信来源、组织策略和 declassification 规则下追加扫描器；不得把“未命中正则”等价为“内容安全”。

## 9. 配置参考

### 9.1 Capability 与环境绑定

action 到 capability 的映射由领域层固定：观察和断言使用 `ui.observe`，交互使用 `ui.interact`。回放 executor 必须显式声明拥有草稿需要的每项能力。

环境对象 canonicalize 后以 `cc.record-replay.environment/v1` 域计算 digest。回放时当前环境必须产生完全相同的 digest。环境应只包含稳定、必要、非秘密的条件，例如应用标识、页面契约版本、语言和 feature revision；不应包含 token、Cookie、绝对临时路径或当前时间。

未来跨设备回放需要区分：

- 必须完全相等的安全约束；
- 允许集合匹配的平台和浏览器版本；
- 经审阅的迁移/upcast；
- 需要重新审阅的语义变化。

在该模型冻结前，当前实现保持精确摘要匹配。

## 10. Replay driver 与隔离

Playwright driver 创建独立 browser、context 和 page，并执行以下限制：

- `acceptDownloads=false`；
- `serviceWorkers=block`；
- context offline；
- route 层拒绝 `file:`、`http:`、`https:`、`ws:`、`wss:`；
- fixture 加载期间出现被拒请求即停止；
- action 期间出现网络或文件请求即停止；
- selector 必须精确匹配一个元素并可见；
- 结束时关闭 context 和 browser。

当前 driver 使用 `page.setContent` 加载调用方提供的自包含 HTML。这一设计适合确定性验证，但不能直接推导“可回放任意真实网站或 Desktop 应用”。真实产品 adapter 必须重新定义导航、页面身份、会话状态、凭据和 OS 级隔离边界。

## 11. 证据与隐私

每一步证据包含 action kind、capability、目标摘要、前后状态摘要、页面摘要、截图摘要、网络策略和拒绝请求计数。以下内容不得进入报告：

- selector 原文；
- 输入或选择值；
- 页面正文；
- URL；
- screenshot bytes；
- 参数实际值。

所有摘要使用显式域分离，避免同一字节在不同语义对象之间被误用。摘要只能证明调用方持有的一组字节与 receipt 关联，不能替代访问控制、签名、时间证明或长期审计保留策略。

## 12. 安全考虑

### 12.1 威胁模型

| 威胁 | 当前控制 | 剩余风险 |
| --- | --- | --- |
| 录制中包含秘密或 PII | 参数化后扫描 action，finding 不回显正文 | 非 action 字段当前不扫描，正则也无法识别所有业务敏感数据 |
| 未审阅 action 获得执行 | draft/review 状态和 capability 检查 | 当前没有稳定的外部序列化验证边界 |
| 审阅后内容被修改 | 进程内摘要和冻结顶层对象 | 嵌套对象深冻结、重算和持久签名仍需产品化补齐 |
| selector 指向错误目标 | 必须唯一且可见 | 页面语义变化仍可能命中错误但唯一的元素 |
| 网络或文件外传 | offline + scheme route deny | 真实站点 adapter 需要更强 egress broker 和 OS sandbox |
| 失败被报告为成功 | 每步要求 `ok=true` 和 evidence | 当前失败报告没有持久恢复或补偿状态 |
| receipt 泄露内容 | metadata-only + domain digest | 小取值空间仍可能被离线枚举，应限制 receipt 访问 |

因此，外部文件导入、跨进程持久化和不可信调用方当前不属于受支持边界。加入这些入口前，必须在消费边界重新 canonicalize、重算所有 digest、验证 schema/revision，并使任何修改令既有 approval 失效。

## 13. 故障排除

### 13.1 错误与终态语义

领域错误使用 `CC_REPLAY_*`，UI driver 错误使用 `CC_REPLAY_UI_*`。主要类别包括：

- 输入、标识符或 action 非法；
- secret/PII/volatile 内容未参数化；
- 审阅不完整或草稿未批准；
- 参数缺失或类型不符；
- sandbox/network isolation 不满足；
- 环境漂移或 capability 不足；
- selector 歧义、断言失败、网络逃逸；
- driver 不可用、设置失败或 action 无终态证据。

错误消息不应包含 selector、输入值、页面正文或原始 URL。任何未来 telemetry adapter 只能记录错误码、action ID、计数和摘要等有界元数据。

## 14. 性能指标

### 14.1 资源边界

- action 数量：1～256；
- fixture HTML：最多 1,000,000 字符；
- selector：最多 1,024 字符；
- type value：最多 8,192 字符；
- select value：最多 1,024 字符；
- viewport：320×240 至 3,840×2,160；
- 单步 timeout：100～30,000 ms；
- settle：0～1,000 ms。

action 串行执行，每步截图并计算多个摘要。该路径优先保证可验证性和隐私边界，不以吞吐量为主要优化目标。任何缓存、并发或截图抽样优化都不能削弱步骤顺序、网络检测和终态证据。

## 15. 测试覆盖

### 15.1 测试与发布门禁

#### 单元与驱动契约测试

- `record-replay-skill.test.js` 覆盖草稿、扫描、参数、审阅、能力、环境和回放报告。
- `record-replay-playwright-driver.test.js` 使用受控 Playwright double 覆盖 click/assert/type/select、证据最小化、资源回收和网络逃逸；该文件自身不启动真实 Chromium。

#### 三平台真实浏览器旅程

`record-replay-ui-journey.mjs` 在 Linux、Windows、macOS 执行：

1. 正向自包含 fixture 回放；
2. 主动网络逃逸探针；
3. receipt 结构和内容最小化检查；
4. exact-SHA evidence 聚合。

聚合器应拒绝缺平台、混合提交、重复平台、摘要篡改、正向失败或逃逸探针未被拒绝。新版本必须在自己的最终提交上重跑，不能继承旧发布的成功证据。

当前三平台旅程的正向 action 是 `click + assert`，负向 action 是触发网络请求的 `click`。`observe`、`type` 和 `select` 尚未逐项进入真实 Chromium 发布矩阵；在正式用户入口关闭前必须补齐这部分覆盖。

## 16. 产品化路线与稳定门槛

从技术预览升级为正式用户功能前，需要完成：

1. 实际录制适配器：捕获受控事件并生成稳定 selector，不采集无关页面内容。
2. 版本化草稿存储：schema validation、deep immutability、digest 重算、revision CAS 和审阅失效。
3. 审阅产品面：逐步展示 action、参数、capability、环境和失败条件。
4. 稳定执行入口：定义 CLI 命令、Desktop 页面或 SDK public subpath。
5. Skill 转换与启用：把回放通过的草稿打包为现有 Skill 系统可消费的产物。
6. 真实目标 adapter：在明确的身份、凭据、导航、sandbox 和 egress policy 下支持浏览器或 Desktop。
7. 用户数据治理：保留期、删除、导出、审计、组织 policy 和敏感字段人工标注。
8. 产品级 E2E：录制、审阅、回放、启用、失败修改和撤销的完整旅程。

只有以上入口真实存在并通过发布矩阵后，用户文档才能移除“技术预览”和“无稳定入口”的说明。

## 17. 使用示例

当前集成顺序必须保持为“创建草稿 → 精确审阅 → 创建隔离 executor → 回放 → 关闭 driver”：

```js
const draft = createRecordedSkillDraft({
  name: "open-project",
  actions: [
    { kind: "click", target: "[data-project='captured-project']" },
    { kind: "assert", target: "h1", value: "captured-project" },
  ],
  parameterBindings: [
    { name: "projectName", value: "captured-project", required: true },
  ],
  environment: {
    app: "chainlesschain-record-replay-fixture",
    selectorContract: "record-replay-ui-v1",
  },
  failureConditions: ["the selected project title is not visible"],
});

const approved = reviewRecordedSkillDraft(draft, {
  reviewerId: "reviewer-1",
  approvedCapabilities: draft.capabilityManifest,
  acceptedFailureConditions: true,
});

const driver = await launchPlaywrightRecordedSkillDriver({ html });
try {
  const report = await replayRecordedSkill(approved, {
    inputs: { projectName: "project-2" },
    environment: approved.environment.requirements,
    isolation: { sandboxed: true, network: "deny" },
    executor: driver.executor,
  });
} finally {
  await driver.close();
}
```

这段代码只展示仓库内部 API 契约。未定义公开 package export 前，产品代码不得依赖深层源码路径作为稳定 SDK。

## 18. 关键文件

- `packages/cli/src/lib/record-replay/skill-recorder.js`
- `packages/cli/src/lib/record-replay/playwright-ui-driver.js`
- `packages/cli/src/lib/record-replay/index.js`
- `packages/cli/__tests__/unit/record-replay-skill.test.js`
- `packages/cli/__tests__/unit/record-replay-playwright-driver.test.js`
- `packages/cli/scripts/record-replay-ui-journey.mjs`
- `.github/workflows/record-replay-ui-journey.yml`

## 19. 相关文档

- `docs/CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md` §7.3、§12.68。
- `docs/design/modules/110-agent-platform-release-boundaries.md` §7。
- `docs/design/modules/109_Desktop_Cowork_Skill_Execution_Security.md`。
- `docs/features/record-replay-skill-user-guide.md`。
