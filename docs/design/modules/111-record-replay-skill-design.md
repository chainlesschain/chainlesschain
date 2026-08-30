# 111 Record & Replay → Skill 设计

> 状态：P2-4 回放内核与原三平台发布边界已关闭；CLI 产品化实现已完成，等待最终合并提交的权威矩阵结果
>
> 适用范围：`packages/cli/src/commands/record-replay.js`、`packages/cli/src/lib/record-replay/`、ProcessExecutionBroker 接线、测试与发布旅程
>
> 用户文档：[Record & Replay → Skill](../../features/record-replay-skill-user-guide.md)

## 1. 概述（背景与决策）

Record & Replay 的目标是把“用户演示一次稳定流程”转换成可审阅、可治理、可撤销的 Skill，而不是录屏或保存任意浏览器脚本。原始鼠标坐标、按键流、页面正文和完整凭据既脆弱，也容易泄露秘密和环境偶然值，因此系统采用有界 action vocabulary、参数化、精确环境绑定和 metadata-only evidence。

当前实现作出以下决策：

1. 稳定产品入口是 `cc skill recording`，别名为 `cc skill record-replay`；Desktop 页面不是 CLI 产品化的前置条件。
2. 真实录制器只捕获受控 DOM 事件并生成稳定 selector，不采集页面正文、截图或任意脚本。
3. 所有捕获值在创建 draft 前参数化；密码自动标敏，业务字段可人工标敏。
4. review 必须绑定精确 revision、action、parameter、capability、environment 和 failure condition。
5. 自包含 HTML 强制断网；URL 目标使用精确 origin allowlist、非秘密身份标签和 storage-state digest。
6. 回放成功只产生有界 evidence digest；原始 selector、输入值、页面正文、URL 和截图 bytes 不进入报告。
7. 只有 replay-validated revision 才能安装进现有 Skill loader；安装与撤销使用摘要绑定的可回滚事务。
8. store、export 和 audit 是版本化边界，每次消费都会重新 canonicalize、重算摘要并拒绝未知字段。

## 2. 目标与非目标

### 2.1 目标

- 支持 `observe/click/type/select/assert` 五种确定性操作。
- 真实捕获 click、输入和选择事件，生成不依赖页面文本的 selector。
- 提供 draft → approved → validated → enabled → revoked 生命周期。
- 在修改、stale revision、能力扩大、环境漂移、凭据漂移或网络逃逸时失败关闭。
- 提供 owner-private 持久化、保留期、删除、导入/导出、审计和策略。
- 把验证通过的记录转换为现有 Skill loader 可发现的项目或全局 Skill。
- 为 CI 提供结构化 JSON 入口和真实 Chromium 产品 E2E。

### 2.2 非目标

- 不录制视频、音频、鼠标坐标、键盘宏或完整页面正文。
- 不支持任意 JavaScript、Shell、上传、下载、剪贴板或文件系统操作。
- 不自动批准、自动扩权或静默修改已批准 revision。
- 不把 storage-state 正文写入 store、export、audit 或生成 Skill。
- 当前不提供 Desktop 可视化录制页，也不冻结公开 npm SDK subpath。
- 本地哈希链用于完整性和损坏检测，不宣称抵抗能够重写整个 owner store 的同 UID 攻击者；需要外部不可变审计时应另接 WORM/签名日志。

## 3. 核心特性

| 能力       | 入口/API                                           | 语义                                                 |
| ---------- | -------------------------------------------------- | ---------------------------------------------------- |
| 真实录制   | `record` / `launchPlaywrightRecordedSkillRecorder` | 捕获事件、生成 selector、参数化并创建 draft          |
| 审阅       | `show`、`review --approve`                         | 展示精确投影并批准当前 revision                      |
| 回放       | `replay` / `replayRecordedSkill`                   | 验证审批、环境、隔离和 capability，逐步产生 evidence |
| 存储       | `RecordedSkillStore`                               | 文件锁、原子写、CAS、schema/digest 重验证和保留期    |
| Skill 转换 | `enable` / `installRecordedSkillPackage`           | 生成并安装三文件 Skill 包                            |
| 撤销       | `revoke --approve`                                 | 对精确 package digest 进行 stage/commit/rollback     |
| 治理       | `policy/audit/prune/export/import/delete`          | 数据生命周期、组织策略输入和 content-free 审计       |
| 真实目标   | `--url/--allowed-origin/--storage-state`           | HTTPS/loopback、精确来源、身份和凭据摘要绑定         |

## 4. 系统架构

```text
┌─────────────────────────────────────────────────────────────┐
│ CLI Product Surface                                         │
│ record/list/show/review/replay/enable/revoke/export/...     │
└───────────────────────┬─────────────────────────────────────┘
                        │
         ┌──────────────▼──────────────┐
         │ Playwright UI Recorder      │
         │ event allowlist             │
         │ stable selector generation  │
         │ transient captured values   │
         └──────────────┬──────────────┘
                        │ parameterize + scan
         ┌──────────────▼──────────────┐
         │ Recorded Skill Domain       │
         │ draft / review / replay     │
         │ schema + deep freeze        │
         │ domain-separated digests    │
         └───────┬─────────────┬───────┘
                 │             │
      ┌──────────▼──────┐   ┌──▼──────────────────────────────┐
      │ Versioned Store │   │ Browser Target Policy          │
      │ CAS / retention │   │ HTML deny or URL allowlist     │
      │ export / audit  │   │ identity + storage-state hash  │
      └──────────┬──────┘   └──┬──────────────────────────────┘
                 │             │
                 │       ┌─────▼──────────────────────────────┐
                 │       │ Playwright Replay Driver          │
                 │       │ ephemeral context + bounded proof │
                 │       │ exact Chromium ProcessBroker grant│
                 │       └─────┬──────────────────────────────┘
                 │             │ ReplayReport
         ┌───────▼─────────────▼───────┐
         │ Skill Package Transaction   │
         │ install / inspect / revoke  │
         └─────────────────────────────┘
```

Recorder、domain、store、target policy、driver 和 package transaction 分层，避免 CLI 参数解析成为安全 authority。CLI 只负责把显式用户决定传给相应边界。

## 5. 领域模型与 schema

### 5.1 Draft

`chainlesschain.recorded-skill-draft/v1` 包含：

- `name/description/status=draft`；
- 1～256 个严格字段集合的 action；
- 仅保留 name、required、sensitive 的 parameter 定义；
- 由 action 计算的 capability manifest；
- failure conditions；
- canonical environment requirements 与 digest；
- `cc.record-replay.skill-draft/v1` 域生成的 `draftDigest`。

捕获原值只作为创建阶段的 transient binding，替换为 `${parameter.<name>}` 后立即清除。扫描器遍历 description、actions、environment 和 failure conditions 等所有持久字段；finding 只返回 path/category。

### 5.2 ReviewedRecordedSkill

review 在 Draft 上增加：

- `status=approved`；
- reviewer ID；
- 与 manifest 完全相等的 approved capability 集；
- `acceptedFailureConditions=true`；
- 绑定 draft digest 的 approval digest。

消费者对序列化对象重新执行 strict-key schema validation、canonicalization、deep freeze 和摘要重算，不能信任进程内对象身份。

### 5.3 ReplayReport

`chainlesschain.recorded-skill-replay/v1` 只包含：

- draft/environment digest；
- `status=succeeded`；
- 顺序排列的 `actionId + evidenceDigest`；
- report digest。

每步 evidence 序列化后最多 256 KiB。任一步失败、无 `ok=true`、无 evidence、序列化失败或超限时不产生成功 report。

### 5.4 Store 与 export

store schema 为 `chainlesschain.recorded-skill-store/v1`；entry、policy、audit event 和 export 分别有独立 v1 schema 与摘要域。entry 同时绑定 source、skill、last replay 和 installation。export 导入后重新验证全部嵌套 schema/digest，并把 enabled 安装状态降为 validated，避免在另一台机器伪造已安装状态。

## 6. 生命周期与状态机

```text
record
  │
  ▼
DRAFT ── review --approve ──► APPROVED
                                 │
                                 │ exact target/environment replay
                                 ▼
                              VALIDATED
                                 │
                                 │ enable --approve
                                 ▼
                              ENABLED
                                 │
                                 │ revoke --approve
                                 ▼
                              REVOKED
```

- 每次 mutation 需要 `expectedRevision`，冲突返回 `CC_RECORD_REVISION_CONFLICT`。
- 草稿只能批准一次；修改必须产生新 draft/digest/revision，旧 approval 不能复用。
- approved、validated、enabled 或 revoked 可重新回放；enabled 回放保留当前 installation。
- 只有 validated 可首次 enable；只有 enabled 可 revoke。
- enabled 记录不能 delete/prune。

## 7. Action vocabulary 与录制规则

| kind      | capability    | 捕获/执行                      | 终态要求                            |
| --------- | ------------- | ------------------------------ | ----------------------------------- |
| `observe` | `ui.observe`  | CLI 显式追加，等待目标可见     | before/after/page/screenshot digest |
| `assert`  | `ui.observe`  | CLI JSON 显式追加，可选比较值  | 断言成功并产生 evidence             |
| `click`   | `ui.interact` | 捕获 click，回放 locator.click | 目标唯一可见；允许点击后 detached   |
| `type`    | `ui.interact` | 捕获 change，回放 locator.fill | 值参数化；密码自动 sensitive        |
| `select`  | `ui.interact` | 捕获 change，回放 selectOption | 值参数化，可人工 sensitive          |

selector 生成优先级为：`data-testid/data-test/data-cc-record` → 唯一 `id` → 唯一 `name` → 唯一 `aria-label` → 最多 8 层的结构 CSS。任何候选都必须在录制时唯一；不使用 text content。

## 8. 浏览器目标、身份与凭据

### 8.1 自包含 HTML

- 只接受 HTML，不允许同时提供 URL、origin 或 storage state。
- network policy 固定为 `deny`，context 设为 offline。
- HTML 内容以 `cc.record-replay.ui-fixture/v1` 摘要绑定。

### 8.2 URL 目标

- 生产目标必须 HTTPS；HTTP 只允许 loopback 测试。
- URL 不能带 username/password。
- target digest 绑定完整规范化 URL，包括 path/query。
- origin allowlist 最多 8 项，必须包含 target origin，且每项不能含 path/query/fragment。
- identity 是非秘密稳定标签；Playwright storage state 只在启动 context 时使用，持久层只保存其 canonical digest。
- route 对 `file/ws/wss` 和来源外 HTTP(S) 请求失败关闭；redirect 后地址也必须在批准策略内。

浏览器实际 executable path 通过 AsyncLocalStorage 传给 ProcessExecutionBroker，只临时允许精确绝对命令；其他子进程在同一上下文仍为 deny。

## 9. 持久化、审计与数据治理

`RecordedSkillStore` 默认位于 CLI 配置根目录的 `record-replay/state.json`：

- owner-only 目录/文件权限；
- 32 MiB store 上限；
- fail-closed 文件锁；
- 私有临时文件、fsync、原子 rename；
- entry/store/export/audit 独立摘要；
- revision CAS 和深度不可变返回对象；
- 最大记录/action/audit 数、能力和全局安装 policy；
- 默认 90 天保留，只清理过期非 enabled 记录；
- export/import/delete/prune/policy change 均进入审计链。

审计事件不包含 action、selector、输入、页面、URL 或凭据正文。组织可下发 policy JSON 收紧保留期、容量、能力和全局安装；当前实现是本机 owner authority，不包含远端签名 policy distribution。

## 10. Skill 包与现有 loader 接线

成功回放后生成：

- `SKILL.md`：Skill metadata、能力和受治理 replay 使用说明；
- `handler.js`：只作为执行身份 marker，不绕过 CLI authority；
- `recorded-skill.json`：entry/draft/approval/replay/target/package digest 和参数元数据。

项目安装目标为 `.chainlesschain/skills/<name>`；全局目标为 CLI user-data Skill 层。安装拒绝 symlink traversal、名称碰撞和修改过的目标。撤销先把精确 package stage 到同根临时位置，store 状态成功提交后再删除；失败则 rollback。若已安装文件被手工修改，撤销拒绝自动删除。

## 11. CLI 产品面

`cc skill recording` 注册以下命令：

`record`、`list`、`show`、`review`、`replay`、`enable`、`revoke`、`export`、`import`、`delete`、`audit`、`prune`、`policy`、`policy-template`。

`show/review` 投影逐项显示 action、parameter、capability、environment digest、failure condition、draft/approval/replay digest 和 installation。`review`、`enable`、`revoke`、`delete`、`prune` 和 policy replacement 的 mutation 都要求显式 `--approve`。主要命令支持 `--json`。

## 12. 配置参考

| 配置             | 边界                                     |
| ---------------- | ---------------------------------------- |
| action           | 1～256                                   |
| HTML             | 最多 1,000,000 字符                      |
| CLI JSON 输入    | 最大 2 MiB、普通文件、非 symlink         |
| selector         | 最大 1,024 字符                          |
| type/select      | 最大 8,192 / 1,024 字符                  |
| viewport         | 320×240～3,840×2,160                     |
| timeout/settle   | 100～30,000 ms / 0～1,000 ms             |
| origin allowlist | 1～8 个精确 origin                       |
| evidence         | 每 action 最大 256 KiB                   |
| store            | 最大 32 MiB                              |
| retention        | 1～3,650 天，默认 90                     |
| records/audit    | 最多 10,000 / 100,000，默认 500 / 20,000 |

## 13. 性能指标

action 必须串行执行，每步读取结构状态、截图并计算域隔离摘要，吞吐量不是首要目标。2026-08-30 Windows 本地开发基线：

- 完整 CLI 产品 E2E（策略审批、录制至导入/审计）：约 19～30 秒；
- 包含 HTML 和 loopback URL 两类真实 Chromium 的集成组合：约 9～20 秒；
- 5 步三平台发布旅程保留 action count 与 exact-SHA evidence 聚合。

这些是单机回归观测，不是 SLA。后续若承诺 P50/P95，必须固定硬件、Chromium/Node 版本、冷/热启动定义和样本量。

## 14. 测试覆盖

### 14.1 聚焦矩阵

- `record-replay-skill.test.js`：strict schema、全字段扫描、参数、审批、deep freeze、环境/隔离、report 和 evidence 上限。
- `record-replay-playwright-driver.test.js`：受控 driver 契约、五种执行语义、content-free evidence、关闭和网络逃逸。
- `record-replay-browser-target-policy.test.js`：URL/origin/协议/凭据摘要和 binding drift。
- `process-execution-broker-context.test.js`：精确 Chromium command allow、其他 command deny、异步上下文恢复。
- `record-replay-product-lifecycle.test.js`：三条真实 Chromium 生命周期，覆盖 HTML、URL、Cookie、store、CAS、package、export/import、tamper 和 egress denial。
- `record-replay-cli.e2e.test.js`：实际 bin 的完整用户旅程。

当前聚焦 Vitest 为 23 个用例，另有 1 条完整 CLI E2E。三平台 `record-replay-ui-journey.mjs` 正向覆盖 `observe/click/type/select/assert`，负向覆盖网络逃逸；聚合器拒绝缺平台、混合 SHA、摘要篡改和负向探针失效。

### 14.2 发布门禁

原 P2-4 replay kernel 已有三平台 exact-SHA 发布证据。此次产品面新增 recorder/store/package/URL target/CLI 后，必须以最终合并 SHA 重新运行适用 CLI CI、CLI Strict Sandbox 和 Record & Replay 三平台旅程；本地绿色不能替代权威门禁。

## 15. 安全考虑

| 威胁          | 控制                                                          | 剩余边界                                            |
| ------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| 捕获秘密/PII  | 参数化、密码自动标敏、人工 sensitive、全持久字段扫描          | 正则无法识别所有业务敏感数据，仍需人工 review       |
| 审批后篡改    | strict keys、deep freeze、domain digest、消费时重算、CAS      | 无外部签名/WORM 时不抵抗完整同 UID store 重写       |
| selector 漂移 | 稳定属性优先、录制/回放都要求唯一可见                         | 页面语义改变仍可能产生唯一但错误目标，需 assert     |
| 凭据泄露      | storage state 只临时使用并保存 digest                         | storage-state 文件自身由用户安全管理                |
| 网络外传      | HTML offline；URL exact-origin route；动作后检查 denied count | 批准 origin 自身的服务器仍属于用户信任边界          |
| 子进程绕行    | ProcessBroker 精确 executable path ambient grant              | 浏览器自身漏洞与 OS 级强隔离需平台 sandbox 继续防护 |
| 伪成功        | 每步终态 evidence、报告摘要、全步成功才出 report              | 摘要不是内容真实性或时间戳证明                      |
| 误删 Skill    | path containment、symlink 拒绝、package digest、staged revoke | 手工修改后需人工处置残留目录                        |

## 16. 故障排除

错误按边界分类：

- `CC_RECORD_*`：CLI、store、policy、target、credential、package 或显式批准错误；
- `CC_REPLAY_*`：draft/review/schema/参数/环境/能力/evidence 错误；
- `CC_REPLAY_UI_*`：Chromium setup、selector、assertion、network 和 action 错误。

排查顺序：

1. `cc skill recording show <name>` 核对 revision、state 和环境摘要。
2. 检查是否使用原始完整 URL/HTML 和摘要匹配的 storage state。
3. 确认 selector 唯一，且 action 没有触发来源外请求。
4. 若 revision conflict，重新读取并审批当前版本，不要重用旧 approval。
5. 若 store corrupt，保留原文件用于审计，从可信 export 恢复；不要手工改摘要。
6. 若 install modified，人工确认生成 Skill 目录差异后再决定删除或保留。

错误正文不得包含 selector、输入值、页面正文、storage state、Cookie 或原始 URL。

## 17. 产品化关闭映射

| 原未完成项       | 当前实现                                                               |
| ---------------- | ---------------------------------------------------------------------- |
| 实际录制 adapter | 真实 Chromium DOM 事件捕获、稳定 selector、无页面正文采集              |
| 版本化存储       | strict schema、deep immutability、digest 重算、CAS、review binding     |
| 审阅产品面       | CLI `show/review` 完整投影与显式批准                                   |
| 稳定执行入口     | `cc skill recording` 与 `record-replay` alias                          |
| Skill 转换/启用  | 三文件包、现有 loader、项目/全局安装与撤销事务                         |
| 真实目标 adapter | HTTPS/loopback、身份、storage-state digest、导航和 exact-origin policy |
| 数据治理         | retention/delete/export/import/audit/policy/manual sensitive           |
| 产品 E2E         | 真实 Chromium integration、实际 CLI lifecycle、篡改/网络/撤销负向路径  |

仓库内功能缺口已关闭；最终发布状态仍以合并 SHA 的权威 CI 结果为准。Desktop 图形入口属于后续独立体验增强，不再阻塞 CLI 产品面。

## 18. 使用示例

```bash
cc skill recording record approve-invoice \
  --url https://billing.example.com/invoices/next \
  --allowed-origin https://billing.example.com \
  --identity billing-operator \
  --storage-state ./billing-state.json \
  --automation ./approve-actions.json \
  --assertions ./approve-assertions.json \
  --sensitive invoiceId \
  --failure "审批状态未变为 approved 时停止"

cc skill recording review approve-invoice \
  --reviewer security-reviewer --approve

cc skill recording replay approve-invoice \
  --url https://billing.example.com/invoices/next \
  --storage-state ./billing-state.json \
  --input invoiceId=INV-2026-001

cc skill recording enable approve-invoice --approve
cc skill recording audit --name approve-invoice
cc skill recording revoke approve-invoice --approve
```

## 19. 关键文件

- `packages/cli/src/commands/record-replay.js`
- `packages/cli/src/lib/record-replay/skill-recorder.js`
- `packages/cli/src/lib/record-replay/playwright-ui-recorder.js`
- `packages/cli/src/lib/record-replay/playwright-ui-driver.js`
- `packages/cli/src/lib/record-replay/browser-target-policy.js`
- `packages/cli/src/lib/record-replay/recorded-skill-store.js`
- `packages/cli/src/lib/record-replay/recorded-skill-package.js`
- `packages/cli/src/lib/process-execution-broker/index.js`
- `packages/cli/__tests__/unit/record-replay-*.test.js`
- `packages/cli/__tests__/integration/record-replay-product-lifecycle.test.js`
- `packages/cli/__tests__/e2e/record-replay-cli.e2e.test.js`
- `packages/cli/scripts/record-replay-ui-journey.mjs`
- `.github/workflows/record-replay-ui-journey.yml`

## 20. 相关文档

- `docs/features/record-replay-skill-user-guide.md`
- `docs/CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md` §7.3、§12.68 及产品化关闭增量。
- `docs/design/modules/110-agent-platform-release-boundaries.md` §7。
- `docs/design/modules/109_Desktop_Cowork_Skill_Execution_Security.md`。
- `docs-site/docs/chainlesschain/skills.md`。
