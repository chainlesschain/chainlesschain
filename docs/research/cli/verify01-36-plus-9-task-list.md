# VERIFY-01：36+9 具体任务清单

整理日期：2026-10-18。依据火山引擎 v3 冻结计划，将 36 项项目维护任务与 9 次独立首次安装旅程集中保存为 Markdown。任务标题、原始提示词、源码路径、交付文件、验收条件和样本分配均来自原始 JSON。

> 正式执行状态：**NOT_RUN，任务 0/36，首次安装 0/9**。本文是任务清单；整理、审阅、工程回归和诊断均不增加正式完成数。

**实际交付更新（2026-11-01）：OpenAI 队列跨版本累计通过 40/45（普通任务 32/36、独立首次安装 8/9），剩余 5 项已工程修复但尚未通过新一轮模型验收。** 完整逐项表格及代码证据见文末[实际完成情况](#actual-completion)，与上述冻结火山计划的正式验收状态分别统计。

## 36 项任务速查表

以下任务正式执行状态均为 `NOT_RUN`；点击编号可跳转至原始提示词、交付文件和完整验收条件。

| 编号                    | 任务                               | 核心验收要求                                                                   |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| [verify-01](#verify-01) | 官方 endpoint 与同名自定义网关隔离 | 自定义网关不得继承官方认证；未知上下文窗口保持未知                             |
| [verify-02](#verify-02) | 精确模型能力查找                   | 精确识别模型；未知后缀不得被当作已认证工具模型                                 |
| [verify-03](#verify-03) | 新家族未知计价                     | 未知模型返回 `unpriced`；已知模型正常计价                                      |
| [verify-04](#verify-04) | 请求级缓存与阶梯费用               | 按每次请求的缓存、长上下文分布计算费用                                         |
| [verify-05](#verify-05) | 安装与准入分离                     | 已安装但未经认证的 CLI 后端拒绝运行；可用 API 后端保留                         |
| [verify-06](#verify-06) | 付费分解前预检                     | 后端不满足条件时，在任务分解和通知前终止                                       |
| [verify-07](#verify-07) | 持久正文分页边界                   | 跨页读取不遗漏最终正文、不重复边界事件                                         |
| [verify-08](#verify-08) | fork 历史归属                      | 分支正确恢复祖先记录，分支后的正文互不混入                                     |
| [verify-09](#verify-09) | 历史来源篡改拒绝                   | 拒绝错误 session/source 身份；正确来源可读                                     |
| [verify-10](#verify-10) | 分页索引失效回归                   | 写入、删除后，索引分页与同快照全量列表一致                                     |
| [verify-11](#verify-11) | 问题持久记录归属                   | 不同 session 的同名问题不串值；完成记录不恢复执行权                            |
| [verify-12](#verify-12) | 含空格参数完整性                   | 空参数、空格和引号路径保持 argv 边界，不触发 shell 展开                        |
| [verify-13](#verify-13) | 附件同句柄读取边界                 | 拒绝读取前被替换或超限的输入；正常读取后关闭资源                               |
| [verify-14](#verify-14) | 图片逐项错误                       | 混合图片输入准确记录每项成功或拒绝原因                                         |
| [verify-15](#verify-15) | 权限修订溢出拒绝                   | generation/revision 达到上界时拒绝写入，不放宽权限                             |
| [verify-16](#verify-16) | 无效设置来源保守失败               | 来源删除、损坏或发生 ABA 变化后，不复用旧允许结果                              |
| [verify-17](#verify-17) | 持久进程所有权记录                 | 损坏 journal 不视为空闲；待回收记录跨实例保留                                  |
| [verify-18](#verify-18) | 所有权未知保持阻断                 | 监督器失联后阻断后续执行；根进程退出不代表整棵进程树退出                       |
| [verify-19](#verify-19) | 取消审批迟到回调                   | 取消后的迟到接受不能授权新请求                                                 |
| [verify-20](#verify-20) | deny 决策不降级                    | 显式 deny 和未知策略不得经 fallback 变成 allow                                 |
| [verify-21](#verify-21) | Memory 影子读取无写入              | shadow 读取不改变目录字节和条目，不触发迁移或 GC                               |
| [verify-22](#verify-22) | Memory 发布后故障语义              | manifest 发布后同步失败须声明 committed，重开仍可读新状态                      |
| [verify-23](#verify-23) | 缺失样本固定分母                   | 保留全部计划样本；未知费用保持 `null`                                          |
| [verify-24](#verify-24) | 比较身份严格隔离                   | 模型、权限或运行时身份不同，不得算作可比改善                                   |
| [verify-25](#verify-25) | 草稿写失败保留旧记录               | 原子写入失败后旧草稿可恢复，发送不提前清空                                     |
| [verify-26](#verify-26) | 敏感问题字段排除                   | password、writeOnly 及未知 schema 回退字段不进入持久化投影                     |
| [verify-27](#verify-27) | 重载问题精确绑定                   | request/session/schema 不匹配时不恢复实时字段                                  |
| [verify-28](#verify-28) | 迟到加载不覆盖编辑                 | 延迟恢复不覆盖新输入；选择项声明顺序保持                                       |
| [verify-29](#verify-29) | 模式 ACK 关联                      | 旧 generation/correlation 的 ACK 无效；失败不显示模式已生效                    |
| [verify-30](#verify-30) | 累计动画帧预算                     | 多帧累计超限在昂贵解码前拒绝，合法边界图片可用                                 |
| [verify-31](#verify-31) | 快照失败资源清理                   | 读取或复制失败后清理句柄、临时文件，保留成功引用的图片                         |
| [verify-32](#verify-32) | 预览取消失效                       | 页面切换或取消后，迟到预览不写入新页面                                         |
| [verify-33](#verify-33) | 快速多图添加预算                   | 连续添加超总量时准确拒绝对应项，保留成功附件                                   |
| [verify-34](#verify-34) | 冻结计划操作说明                   | 编写真实 outcome 脚本运维说明，覆盖指纹、退出码 2、未知费用及禁止误报改善 PASS |
| [verify-35](#verify-35) | 模型失败分类回归                   | 区分可重试错误与明确拒绝，不把协议错误转为成功                                 |
| [verify-36](#verify-36) | 启动配置身份保真                   | 保存、恢复后策略身份一致；非法配置拒绝处理                                     |

各项还须保留相关既有回归，并用正反对照证明新增断言有效。

## 1. 范围与冻结身份

- **36**：36 个不同的项目维护任务，每个任务只分配到一个系统和入口组合；九组各四项。
- **9**：三种操作系统 × 三种入口，每组另执行一次独立首次安装旅程，并重新完成前九项中对应的一项任务。
- 首次安装复用任务要求，但必须使用独立干净环境与独立运行记录；同一 `(runId, taskId)` 不得重复计数。
- 任务依据已有行为合同增加回归覆盖；仅在反例证明需要时最小修复，不能把任务清单理解为 36 个已确认缺陷。

| 项目                 | 冻结值                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- |
| 固定项目提交         | `b2aa3aba082873570e85dce39b00754e5504ff37`                                         |
| 被测公开版本         | CLI `0.166.99` / VS Code 扩展 `0.37.143` / JetBrains 插件 `0.4.161`                |
| 被测发行源码         | `311e01a5ec34a8e433c7abde0e4b6b05bce4513b`                                         |
| 运行时               | Node.js `22.12.0`                                                                  |
| IDE 宿主             | VS Code `1.132.0` / IntelliJ IDEA `2025.2`                                         |
| Provider / model     | `volcengine / deepseek-v4-flash-ga-260731`，全部 45 个样本一致                     |
| Endpoint             | `https://ark.cn-beijing.volces.com/api/v3`                                         |
| 推理与重试           | 默认 thinking，不覆盖；禁止 fallback；每样本最多两次尝试，合用该样本时间与费用上限 |
| 观察窗口（UTC）      | `2026-10-12T14:46:52.556Z` 至 `2026-10-19T14:46:52.556Z`                           |
| 观察窗口（北京时间） | 2026-10-12 22:46:52.556 至 2026-10-19 22:46:52.556                                 |
| 普通任务上限         | 每项 $2 / 20 分钟，36 项共 $72                                                     |
| 首次安装上限         | 每项 $3 / 30 分钟，9 项共 $27                                                      |
| 共享总预算           | $99，v1/v2/v3 共用；不能因修订或重试重置，实际剩余额度未知                         |
| 维护工时             | 16 小时；construction 单列，不计持续维护成本                                       |
| 计划指纹             | `sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13`          |

以上是评测冻结身份，并非当前最新公开发行版本。更换版本、窗口或比较身份时，应在新执行前另建修订并生成指纹。

## 2. 九组分配总览

| 目标系统与架构      | 入口      | 四项普通任务                                                                                       | 独立首次安装                                              | 重新执行任务            | 组预算上限 |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------- | ---------- |
| Windows 11 24H2 x64 | CLI       | [verify-01](#verify-01)、[verify-10](#verify-10)、[verify-19](#verify-19)、[verify-28](#verify-28) | [first-run-win32-cli](#first-run-win32-cli)               | [verify-01](#verify-01) | $11        |
| Windows 11 24H2 x64 | VS Code   | [verify-02](#verify-02)、[verify-11](#verify-11)、[verify-20](#verify-20)、[verify-29](#verify-29) | [first-run-win32-vscode](#first-run-win32-vscode)         | [verify-02](#verify-02) | $11        |
| Windows 11 24H2 x64 | JetBrains | [verify-03](#verify-03)、[verify-12](#verify-12)、[verify-21](#verify-21)、[verify-30](#verify-30) | [first-run-win32-jetbrains](#first-run-win32-jetbrains)   | [verify-03](#verify-03) | $11        |
| Ubuntu 24.04 x64    | CLI       | [verify-04](#verify-04)、[verify-13](#verify-13)、[verify-22](#verify-22)、[verify-31](#verify-31) | [first-run-linux-cli](#first-run-linux-cli)               | [verify-04](#verify-04) | $11        |
| Ubuntu 24.04 x64    | VS Code   | [verify-05](#verify-05)、[verify-14](#verify-14)、[verify-23](#verify-23)、[verify-32](#verify-32) | [first-run-linux-vscode](#first-run-linux-vscode)         | [verify-05](#verify-05) | $11        |
| Ubuntu 24.04 x64    | JetBrains | [verify-06](#verify-06)、[verify-15](#verify-15)、[verify-24](#verify-24)、[verify-33](#verify-33) | [first-run-linux-jetbrains](#first-run-linux-jetbrains)   | [verify-06](#verify-06) | $11        |
| macOS 15 arm64      | CLI       | [verify-07](#verify-07)、[verify-16](#verify-16)、[verify-25](#verify-25)、[verify-34](#verify-34) | [first-run-darwin-cli](#first-run-darwin-cli)             | [verify-07](#verify-07) | $11        |
| macOS 15 arm64      | VS Code   | [verify-08](#verify-08)、[verify-17](#verify-17)、[verify-26](#verify-26)、[verify-35](#verify-35) | [first-run-darwin-vscode](#first-run-darwin-vscode)       | [verify-08](#verify-08) | $11        |
| macOS 15 arm64      | JetBrains | [verify-09](#verify-09)、[verify-18](#verify-18)、[verify-27](#verify-27)、[verify-36](#verify-36) | [first-run-darwin-jetbrains](#first-run-darwin-jetbrains) | [verify-09](#verify-09) | $11        |

建议首批为 Linux CLI：`verify-04`、`verify-13`、`verify-22`、`verify-31`，另加独立 `first-run-linux-cli`；最多 $11，已包含在共享 $99 内。

## 3. 普通任务的共同执行与验收要求

1. 每项从固定项目提交创建独立 checkout，按 lockfile 安装依赖，先运行相关既有测试建立基线。环境错误单独归因，保留原始输出。
2. 阅读列出的源码和相关测试，交付指定测试或文档及实际验证记录。源码路径和交付路径均相对于冻结项目根目录；交付路径表示预期产物，不表示文件当前已存在。
3. 新增测试须有实质断言、正反对照，并以受控错误行为证明断言会失败。保存完整 diff 与命令输出；额外修改单列。
4. 不得修改冻结计划或验收器，不得降低断言、删除断言、跳过失败或提交空测试。
5. 真实 IDE 样本须在对应宿主提交提示词，并保留后台 tab 切回、最终结果、重载后结果与交付文件一致的回执；涉及草稿、附件、模式时补齐相关操作回执。
6. 逐项验收须绑定准确脚本包及审阅身份。Astra AI 预审按既有授权记录为 AI；真实候选成果仍需实际检查与原始回执。
7. 第 34 项是运维文档题，需核对真实脚本参数、运行文档命令并检查输出。各题下方完整保留原目录的验收文字。

## 4. 36 项项目任务详情

<a id="verify-01"></a>

### verify-01：官方 endpoint 与同名自定义网关隔离

- 状态：`NOT_RUN`。
- 差距分类：`MODEL-01`。
- 执行入口：Windows 11 24H2 x64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/model-context-catalog.js`。
- 交付文件：`packages/cli/__tests__/verify-01.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「官方 endpoint 与同名自定义网关隔离」。阅读 packages/cli/src/lib/model-context-catalog.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：分别输入官方与自定义 endpoint，同名模型不得共享官方认证；未知窗口保留未知。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 分别输入官方与自定义 endpoint，同名模型不得共享官方认证；未知窗口保留未知
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-02"></a>

### verify-02：精确模型能力查找

- 状态：`NOT_RUN`。
- 差距分类：`MODEL-01`。
- 执行入口：Windows 11 24H2 x64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/model-capabilities.js`。
- 交付文件：`packages/cli/__tests__/verify-02.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「精确模型能力查找」。阅读 packages/cli/src/lib/model-capabilities.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：验证 Astra/Sol/Luna 精确标识及未知后缀，不把未知模型当作已认证工具模型。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 验证 Astra/Sol/Luna 精确标识及未知后缀，不把未知模型当作已认证工具模型
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-03"></a>

### verify-03：新家族未知计价

- 状态：`NOT_RUN`。
- 差距分类：`MODEL-02`。
- 执行入口：Windows 11 24H2 x64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/llm-pricing.js`。
- 交付文件：`packages/cli/__tests__/verify-03.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「新家族未知计价」。阅读 packages/cli/src/lib/llm-pricing.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：未知模型返回 unpriced，不命中旧家族价格；已知模型正对照仍可计价。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 未知模型返回 unpriced，不命中旧家族价格；已知模型正对照仍可计价
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-04"></a>

### verify-04：请求级缓存与阶梯费用

- 状态：`NOT_RUN`。
- 差距分类：`MODEL-02`。
- 执行入口：Ubuntu 24.04 x64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/usage-pricing-context.js`。
- 交付文件：`packages/cli/__tests__/verify-04.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「请求级缓存与阶梯费用」。阅读 packages/cli/src/lib/usage-pricing-context.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：同一总 token 数但不同缓存/长上下文请求分布的费用按逐请求合同计算。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 同一总 token 数但不同缓存/长上下文请求分布的费用按逐请求合同计算
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-05"></a>

### verify-05：安装与准入分离

- 状态：`NOT_RUN`。
- 差距分类：`READY-01`。
- 执行入口：Ubuntu 24.04 x64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/agent-router.js`。
- 交付文件：`packages/cli/__tests__/verify-05.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「安装与准入分离」。阅读 packages/cli/src/lib/agent-router.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：已安装未 attested 的 CLI 后端仍拒绝运行；可用 API 后端保留。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 已安装未 attested 的 CLI 后端仍拒绝运行；可用 API 后端保留
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-06"></a>

### verify-06：付费分解前预检

- 状态：`NOT_RUN`。
- 差距分类：`READY-01`。
- 执行入口：Ubuntu 24.04 x64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/commands/orchestrate.js`。
- 交付文件：`packages/cli/__tests__/verify-06.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「付费分解前预检」。阅读 packages/cli/src/commands/orchestrate.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：被拒绝后端在分解前终止；分解和通知 spy 均为零。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 被拒绝后端在分解前终止；分解和通知 spy 均为零
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-07"></a>

### verify-07：持久正文分页边界

- 状态：`NOT_RUN`。
- 差距分类：`IDE-REPLAY`。
- 执行入口：macOS 15 arm64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/session-transcript-history.js`。
- 交付文件：`packages/cli/__tests__/verify-07.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「持久正文分页边界」。阅读 packages/cli/src/lib/session-transcript-history.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：跨页读取首尾 cursor，不遗漏最终正文、不重复边界事件。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 跨页读取首尾 cursor，不遗漏最终正文、不重复边界事件
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-08"></a>

### verify-08：fork 历史归属

- 状态：`NOT_RUN`。
- 差距分类：`IDE-REPLAY`。
- 执行入口：macOS 15 arm64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/session-branch-history.js`。
- 交付文件：`packages/cli/__tests__/verify-08.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「fork 历史归属」。阅读 packages/cli/src/lib/session-branch-history.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：两个分支各自恢复有效祖先和独立正文，分支之后内容不串入。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 两个分支各自恢复有效祖先和独立正文，分支之后内容不串入
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-09"></a>

### verify-09：历史来源篡改拒绝

- 状态：`NOT_RUN`。
- 差距分类：`IDE-REPLAY`。
- 执行入口：macOS 15 arm64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/session-history-origins.js`。
- 交付文件：`packages/cli/__tests__/verify-09.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「历史来源篡改拒绝」。阅读 packages/cli/src/lib/session-history-origins.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：错误 session/source 身份被拒绝，正确来源正对照可读。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 错误 session/source 身份被拒绝，正确来源正对照可读
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-10"></a>

### verify-10：分页索引失效回归

- 状态：`NOT_RUN`。
- 差距分类：`PERF-01`。
- 执行入口：Windows 11 24H2 x64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/background-agent-list-index.js`。
- 交付文件：`packages/cli/__tests__/verify-10.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「分页索引失效回归」。阅读 packages/cli/src/lib/background-agent-list-index.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：写入、删除后索引分页与同快照全量列表一致，包含末页。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 写入、删除后索引分页与同快照全量列表一致，包含末页
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-11"></a>

### verify-11：问题持久记录归属

- 状态：`NOT_RUN`。
- 差距分类：`IDE-DRAFT`。
- 执行入口：Windows 11 24H2 x64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/background-interaction-journal.js`。
- 交付文件：`packages/cli/__tests__/verify-11.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「问题持久记录归属」。阅读 packages/cli/src/lib/background-interaction-journal.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：同名问题不同 session 不串值；完成记录不重建执行权。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 同名问题不同 session 不串值；完成记录不重建执行权
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-12"></a>

### verify-12：含空格参数完整性

- 状态：`NOT_RUN`。
- 差距分类：`PLATFORM-01`。
- 执行入口：Windows 11 24H2 x64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/background-command-argv.js`。
- 交付文件：`packages/cli/__tests__/verify-12.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「含空格参数完整性」。阅读 packages/cli/src/lib/background-command-argv.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：空参数、空格和引号路径保持 argv 边界，不触发 shell 展开。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 空参数、空格和引号路径保持 argv 边界，不触发 shell 展开
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-13"></a>

### verify-13：附件同句柄读取边界

- 状态：`NOT_RUN`。
- 差距分类：`IDE-IMAGE`。
- 执行入口：Ubuntu 24.04 x64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/image-file-boundary.js`。
- 交付文件：`packages/cli/__tests__/verify-13.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「附件同句柄读取边界」。阅读 packages/cli/src/lib/image-file-boundary.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：读取前替换或超限输入被拒绝；正常小图可读且资源关闭。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 读取前替换或超限输入被拒绝；正常小图可读且资源关闭
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-14"></a>

### verify-14：图片逐项错误

- 状态：`NOT_RUN`。
- 差距分类：`IDE-IMAGE`。
- 执行入口：Ubuntu 24.04 x64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/image-input.js`。
- 交付文件：`packages/cli/__tests__/verify-14.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「图片逐项错误」。阅读 packages/cli/src/lib/image-input.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：混合合法图与损坏输入保留准确成功/拒绝信息，不默默跳过。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 混合合法图与损坏输入保留准确成功/拒绝信息，不默默跳过
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-15"></a>

### verify-15：权限修订溢出拒绝

- 状态：`NOT_RUN`。
- 差距分类：`NET-02`。
- 执行入口：Ubuntu 24.04 x64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/scoped-permission-store.js`。
- 交付文件：`packages/cli/__tests__/verify-15.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「权限修订溢出拒绝」。阅读 packages/cli/src/lib/scoped-permission-store.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：generation/revision 到上界时写入失败且不放宽旧权限。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] generation/revision 到上界时写入失败且不放宽旧权限
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-16"></a>

### verify-16：无效设置来源保守失败

- 状态：`NOT_RUN`。
- 差距分类：`NET-02`。
- 执行入口：macOS 15 arm64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/settings-source-observation.cjs`。
- 交付文件：`packages/cli/__tests__/verify-16.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「无效设置来源保守失败」。阅读 packages/cli/src/lib/settings-source-observation.cjs 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：删除、损坏及 ABA 来源变化不会复用旧允许结果。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 删除、损坏及 ABA 来源变化不会复用旧允许结果
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-17"></a>

### verify-17：持久进程所有权记录

- 状态：`NOT_RUN`。
- 差距分类：`BRIDGE-01`。
- 执行入口：macOS 15 arm64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/process-execution-broker/process-ownership-journal.js`。
- 交付文件：`packages/cli/__tests__/verify-17.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「持久进程所有权记录」。阅读 packages/cli/src/lib/process-execution-broker/process-ownership-journal.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：损坏 journal 不被当作空闲；合法待回收记录跨实例保留。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 损坏 journal 不被当作空闲；合法待回收记录跨实例保留
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-18"></a>

### verify-18：所有权未知保持阻断

- 状态：`NOT_RUN`。
- 差距分类：`BRIDGE-01`。
- 执行入口：macOS 15 arm64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/process-execution-broker/process-ownership-quarantine.js`。
- 交付文件：`packages/cli/__tests__/verify-18.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「所有权未知保持阻断」。阅读 packages/cli/src/lib/process-execution-broker/process-ownership-quarantine.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：监督器失联后后续执行被阻断，不以根进程消失当完整树退出。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 监督器失联后后续执行被阻断，不以根进程消失当完整树退出
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-19"></a>

### verify-19：取消审批迟到回调

- 状态：`NOT_RUN`。
- 差距分类：`IDE-MODE`。
- 执行入口：Windows 11 24H2 x64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/permission-request.js`。
- 交付文件：`packages/cli/__tests__/verify-19.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「取消审批迟到回调」。阅读 packages/cli/src/lib/permission-request.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：取消后迟到接受不能授权新请求；正常接受仅绑定原请求。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 取消后迟到接受不能授权新请求；正常接受仅绑定原请求
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-20"></a>

### verify-20：deny 决策不降级

- 状态：`NOT_RUN`。
- 差距分类：`IDE-MODE`。
- 执行入口：Windows 11 24H2 x64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/permission-decision.js`。
- 交付文件：`packages/cli/__tests__/verify-20.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「deny 决策不降级」。阅读 packages/cli/src/lib/permission-decision.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：显式 deny 与未知策略不会被 fallback 变成 allow。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 显式 deny 与未知策略不会被 fallback 变成 allow
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-21"></a>

### verify-21：Memory 影子读取无写入

- 状态：`NOT_RUN`。
- 差距分类：`PERF-01`。
- 执行入口：Windows 11 24H2 x64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js`。
- 交付文件：`packages/cli/__tests__/verify-21.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「Memory 影子读取无写入」。阅读 packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：v1/v2 shadow 读前后目录字节与条目一致，不触发迁移/GC。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] v1/v2 shadow 读前后目录字节与条目一致，不触发迁移/GC
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-22"></a>

### verify-22：Memory 发布后故障语义

- 状态：`NOT_RUN`。
- 差距分类：`PERF-01`。
- 执行入口：Ubuntu 24.04 x64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js`。
- 交付文件：`packages/cli/__tests__/verify-22.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「Memory 发布后故障语义」。阅读 packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：manifest 发布后注入同步失败，错误声明 committed 且重开仍可读新状态。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] manifest 发布后注入同步失败，错误声明 committed 且重开仍可读新状态
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-23"></a>

### verify-23：缺失样本固定分母

- 状态：`NOT_RUN`。
- 差距分类：`VERIFY-01`。
- 执行入口：Ubuntu 24.04 x64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/eval/outcomes.js`。
- 交付文件：`packages/cli/__tests__/verify-23.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「缺失样本固定分母」。阅读 packages/cli/src/lib/eval/outcomes.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：部分 observations 保留全部计划样本；未知费用保持 null，不能冒充零。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 部分 observations 保留全部计划样本；未知费用保持 null，不能冒充零
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-24"></a>

### verify-24：比较身份严格隔离

- 状态：`NOT_RUN`。
- 差距分类：`VERIFY-01`。
- 执行入口：Ubuntu 24.04 x64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/eval/evidence.js`。
- 交付文件：`packages/cli/__tests__/verify-24.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「比较身份严格隔离」。阅读 packages/cli/src/lib/eval/evidence.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：相同 task 不同模型/权限/运行时身份不能算可比改善。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 相同 task 不同模型/权限/运行时身份不能算可比改善
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-25"></a>

### verify-25：草稿写失败保留旧记录

- 状态：`NOT_RUN`。
- 差距分类：`IDE-DRAFT`。
- 执行入口：macOS 15 arm64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/draft-store.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-25.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「草稿写失败保留旧记录」。阅读 packages/vscode-extension/src/chat/draft-store.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：原子写入失败后旧草稿可恢复，发送不提前清空。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 原子写入失败后旧草稿可恢复，发送不提前清空
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-26"></a>

### verify-26：敏感问题字段排除

- 状态：`NOT_RUN`。
- 差距分类：`IDE-DRAFT`。
- 执行入口：macOS 15 arm64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/question-draft-contract.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-26.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「敏感问题字段排除」。阅读 packages/vscode-extension/src/chat/question-draft-contract.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：password/writeOnly 与未知 schema fallback 不进入持久化投影。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] password/writeOnly 与未知 schema fallback 不进入持久化投影
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-27"></a>

### verify-27：重载问题精确绑定

- 状态：`NOT_RUN`。
- 差距分类：`IDE-DRAFT`。
- 执行入口：macOS 15 arm64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/question-drafts.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-27.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「重载问题精确绑定」。阅读 packages/vscode-extension/src/chat/question-drafts.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：request/session/schema 不匹配不恢复 live 字段；精确重发才恢复。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] request/session/schema 不匹配不恢复 live 字段；精确重发才恢复
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-28"></a>

### verify-28：迟到加载不覆盖编辑

- 状态：`NOT_RUN`。
- 差距分类：`IDE-DRAFT`。
- 执行入口：Windows 11 24H2 x64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/question-form-drafts.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-28.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「迟到加载不覆盖编辑」。阅读 packages/vscode-extension/src/chat/question-form-drafts.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：延迟恢复返回时新输入保留；select/checkbox 声明顺序保持。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 延迟恢复返回时新输入保留；select/checkbox 声明顺序保持
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-29"></a>

### verify-29：模式 ACK 关联

- 状态：`NOT_RUN`。
- 差距分类：`IDE-MODE`。
- 执行入口：Windows 11 24H2 x64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/permission-mode-state.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-29.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「模式 ACK 关联」。阅读 packages/vscode-extension/src/chat/permission-mode-state.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：旧 generation/correlation ACK 无效，失败不显示新模式已生效。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 旧 generation/correlation ACK 无效，失败不显示新模式已生效
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-30"></a>

### verify-30：累计动画帧预算

- 状态：`NOT_RUN`。
- 差距分类：`IDE-IMAGE`。
- 执行入口：Windows 11 24H2 x64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/image-decode-budget.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-30.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「累计动画帧预算」。阅读 packages/vscode-extension/src/chat/image-decode-budget.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：多帧累计超限在昂贵解码前拒绝，合法边界图保留。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 多帧累计超限在昂贵解码前拒绝，合法边界图保留
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-31"></a>

### verify-31：快照失败资源清理

- 状态：`NOT_RUN`。
- 差距分类：`IDE-IMAGE`。
- 执行入口：Ubuntu 24.04 x64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/image-file-snapshot.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-31.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「快照失败资源清理」。阅读 packages/vscode-extension/src/chat/image-file-snapshot.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：读取/复制失败后句柄和临时文件清理，不删除成功引用图片。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 读取/复制失败后句柄和临时文件清理，不删除成功引用图片
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-32"></a>

### verify-32：预览取消失效

- 状态：`NOT_RUN`。
- 差距分类：`IDE-IMAGE`。
- 执行入口：Ubuntu 24.04 x64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/image-preview-gate.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-32.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「预览取消失效」。阅读 packages/vscode-extension/src/chat/image-preview-gate.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：页面切换或取消后迟到预览不写入新页面；当前页面正常显示。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 页面切换或取消后迟到预览不写入新页面；当前页面正常显示
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-33"></a>

### verify-33：快速多图添加预算

- 状态：`NOT_RUN`。
- 差距分类：`IDE-IMAGE`。
- 执行入口：Ubuntu 24.04 x64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/vscode-extension/src/chat/image-attachments.js`。
- 交付文件：`packages/vscode-extension/__tests__/verify-33.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「快速多图添加预算」。阅读 packages/vscode-extension/src/chat/image-attachments.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：连续添加超总量准确拒绝对应项，已成功附件保持可用。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 连续添加超总量准确拒绝对应项，已成功附件保持可用
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-34"></a>

### verify-34：冻结计划操作说明

- 状态：`NOT_RUN`。
- 差距分类：`VERIFY-01`。
- 执行入口：macOS 15 arm64 / CLI。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/scripts/task-outcome-report.mjs`。
- 交付文件：`docs/development/verify-34-outcome-runbook.md`。

**原始提示词：**

```text
在固定项目快照中完成「冻结计划操作说明」。阅读 packages/cli/scripts/task-outcome-report.mjs 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：编写该真实脚本的仓库运维说明，包含指纹、缺失样本退出2、未知费用及禁止改善PASS。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 编写该真实脚本的仓库运维说明，包含指纹、缺失样本退出2、未知费用及禁止改善PASS
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-35"></a>

### verify-35：模型失败分类回归

- 状态：`NOT_RUN`。
- 差距分类：`MODEL-01`。
- 执行入口：macOS 15 arm64 / VS Code。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/model-failure-policy.js`。
- 交付文件：`packages/cli/__tests__/verify-35.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「模型失败分类回归」。阅读 packages/cli/src/lib/model-failure-policy.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：可重试与明确拒绝按现有合同区分，不把协议错误隐式转成成功。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 可重试与明确拒绝按现有合同区分，不把协议错误隐式转成成功
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

<a id="verify-36"></a>

### verify-36：启动配置身份保真

- 状态：`NOT_RUN`。
- 差距分类：`PLATFORM-01`。
- 执行入口：macOS 15 arm64 / JetBrains。
- 时间 / 费用上限：20 分钟 / $2（含补救重试）。
- 涉及源码：`packages/cli/src/lib/background-launch-profile.js`。
- 交付文件：`packages/cli/__tests__/verify-36.test.js`。

**原始提示词：**

```text
在固定项目快照中完成「启动配置身份保真」。阅读 packages/cli/src/lib/background-launch-profile.js 及现有相关测试，新增独立回归覆盖或补齐已有覆盖；仅在反例证明需要时最小修复实现。不得虚构已存在缺陷。验收要求：保存和恢复启动配置后策略身份一致，非法配置拒绝而非放宽。提交补丁和实际验证记录，禁止修改评测计划、降低断言或跳过失败。
```

**验收条件：**

- [ ] 保存和恢复启动配置后策略身份一致，非法配置拒绝而非放宽
- [ ] 相关既有回归保持通过；新测试应含正反对照，并证明错误行为会使断言失败
- [ ] 独立验收者检查实际断言和原始命令输出；仅新增标题/空测试不通过

## 5. 9 次独立首次安装旅程详情

每次均使用全新用户目录、配置、IDE profile 与独立项目 checkout，从正式公开渠道安装上述冻结版本；CLI 先于 IDE 安装。记录来源 URL、版本、SHA-256、安装日志、运行时与源码身份。

每次完整保存 `install → configure → authenticate → tool → artifact` 五阶段；失败阶段及受其影响未执行的阶段分别记录原因。认证、工具、首次尝试与补救的费用计入同一 $3 / 30 分钟上限。

<a id="first-run-win32-cli"></a>

### first-run-win32-cli

- 状态：`NOT_RUN`。
- 目标环境：Windows 11 24H2 x64 / CLI，Node.js 22.12.0。
- 独立重新完成：[verify-01：官方 endpoint 与同名自定义网关隔离](#verify-01)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 CLI 实际入口提交提示词，在独立 checkout 重新完成 verify-01，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-01.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

<a id="first-run-win32-vscode"></a>

### first-run-win32-vscode

- 状态：`NOT_RUN`。
- 目标环境：Windows 11 24H2 x64 / VS Code，Node.js 22.12.0。
- 独立重新完成：[verify-02：精确模型能力查找](#verify-02)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，再安装 VS Code 扩展 0.37.143，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 VS Code 实际入口提交提示词，在独立 checkout 重新完成 verify-02，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-02.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

<a id="first-run-win32-jetbrains"></a>

### first-run-win32-jetbrains

- 状态：`NOT_RUN`。
- 目标环境：Windows 11 24H2 x64 / JetBrains，Node.js 22.12.0。
- 独立重新完成：[verify-03：新家族未知计价](#verify-03)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，再安装 JetBrains 插件 0.4.161，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 JetBrains 实际入口提交提示词，在独立 checkout 重新完成 verify-03，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-03.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

<a id="first-run-linux-cli"></a>

### first-run-linux-cli

- 状态：`NOT_RUN`。
- 目标环境：Ubuntu 24.04 x64 / CLI，Node.js 22.12.0。
- 独立重新完成：[verify-04：请求级缓存与阶梯费用](#verify-04)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 CLI 实际入口提交提示词，在独立 checkout 重新完成 verify-04，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-04.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

<a id="first-run-linux-vscode"></a>

### first-run-linux-vscode

- 状态：`NOT_RUN`。
- 目标环境：Ubuntu 24.04 x64 / VS Code，Node.js 22.12.0。
- 独立重新完成：[verify-05：安装与准入分离](#verify-05)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，再安装 VS Code 扩展 0.37.143，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 VS Code 实际入口提交提示词，在独立 checkout 重新完成 verify-05，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-05.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

<a id="first-run-linux-jetbrains"></a>

### first-run-linux-jetbrains

- 状态：`NOT_RUN`。
- 目标环境：Ubuntu 24.04 x64 / JetBrains，Node.js 22.12.0。
- 独立重新完成：[verify-06：付费分解前预检](#verify-06)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，再安装 JetBrains 插件 0.4.161，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 JetBrains 实际入口提交提示词，在独立 checkout 重新完成 verify-06，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-06.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

<a id="first-run-darwin-cli"></a>

### first-run-darwin-cli

- 状态：`NOT_RUN`。
- 目标环境：macOS 15 arm64 / CLI，Node.js 22.12.0。
- 独立重新完成：[verify-07：持久正文分页边界](#verify-07)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 CLI 实际入口提交提示词，在独立 checkout 重新完成 verify-07，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-07.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

<a id="first-run-darwin-vscode"></a>

### first-run-darwin-vscode

- 状态：`NOT_RUN`。
- 目标环境：macOS 15 arm64 / VS Code，Node.js 22.12.0。
- 独立重新完成：[verify-08：fork 历史归属](#verify-08)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，再安装 VS Code 扩展 0.37.143，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 VS Code 实际入口提交提示词，在独立 checkout 重新完成 verify-08，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-08.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

<a id="first-run-darwin-jetbrains"></a>

### first-run-darwin-jetbrains

- 状态：`NOT_RUN`。
- 目标环境：macOS 15 arm64 / JetBrains，Node.js 22.12.0。
- 独立重新完成：[verify-09：历史来源篡改拒绝](#verify-09)；使用该题完整提示词、交付文件和验收条件。
- 时间 / 费用上限：30 分钟 / $3。

- [ ] **install**：在干净环境安装公开 CLI 0.166.99，再安装 JetBrains 插件 0.4.161，保存身份与安装回执。
- [ ] **configure**：配置冻结模型、端点及权限，保存脱敏配置；禁止 fallback。
- [ ] **authenticate**：完成真实火山引擎认证，保留脱敏请求与费用记录。
- [ ] **tool**：通过 JetBrains 实际入口提交提示词，在独立 checkout 重新完成 verify-09，保存运行终态与工具记录。
- [ ] **artifact**：核验 `packages/cli/__tests__/verify-09.test.js`、实际补丁与该题全部验收输出；IDE 另核对重载前后结果。

## 6. 正式执行状态与证据记录

截至本次整理，仓库公开状态仍为 **NOT_RUN（0/36、0/9）**，正式预算 **NOT_PAID_READY**，完整 native **NOT_ADMITTED**。v3 的 `execution-readiness.json` 是冻结时快照；后续脚本包 AI 审阅和工程进展应查阅[增量验收记录](./evidence/gap-2026-10-05/continuation-2026-10-13/volcengine-v3/README.md)，不可将快照中的早期审阅缺口当作全部当前进展。

执行时按原协议补齐共享预算与历史未决费用对账、真实目标宿主及公开安装身份，并检查剩余完整执行时间。Windows/macOS native、真人辅助技术、固定硬件 SLO 和各入口启动后的 8h/24h 观测分别保存真实回执。现有诊断、fixture、工程测试和组件长期观察均不计入这 45 个正式样本。

每个样本至少保留：样本 ID、任务 ID、独立 runId、计划/审阅/比较摘要、项目/产品/宿主身份、五阶段或任务执行回执、完整 diff、原始测试与验收输出、真实时间和费用记录。未知费用保留 null；失败、跳过、缺失继续计入原计划分母。

## 7. 原始文件与协议

- [v3 计划说明](./verify01-plan-2026-10-13-volcengine/README.md)
- [36 项原始任务：tasks.json](./verify01-plan-2026-10-13-volcengine/tasks.json)
- [45 个样本与预算：plan.json](./verify01-plan-2026-10-13-volcengine/plan.json)
- [宿主、模型与权限绑定：comparison-bindings.json](./verify01-plan-2026-10-13-volcengine/comparison-bindings.json)
- [冻结就绪快照：execution-readiness.json](./verify01-plan-2026-10-13-volcengine/execution-readiness.json)
- [共享预算说明](./verify01-plan-2026-10-13-volcengine/BUDGET_READINESS.md)
- [真实宿主与首次安装采集协议](./verify01-plan-2026-10-04/HOST_CAPTURE_README.md)
- [v3 后续工程与 AI 审阅进展](./evidence/gap-2026-10-05/continuation-2026-10-13/volcengine-v3/README.md)

本文仅汇集既有任务内容，未修改冻结 JSON、摘要、预算或执行记录。

<a id="actual-completion"></a>

## 8. 实际完成情况（2026-11-01 核对）

**当前 OpenAI 队列跨版本累计通过 40/45（88.9%）：普通任务 32/36、独立首次安装 8/9，剩余 5 项未通过模型独立验收。** 最近完整一轮为 `.133` 的 39/45；`.135` 只复测此前失败的六项，新增 `verify-26` 通过，其他五项仍未通过。五项后续工程修复已提交并有回归证据，尚未形成新的模型验收结果。

本次代码核对截至提交 `239f953d90ccd31f61246052ca1156126190bd8e`，当前 [CLI package.json](../../../packages/cli/package.json) 为 `0.166.136`。下表使用已归档的 `.133` 完整轮与 `.135` 六项复测收据，不将累计成绩称为 `.136` 或任一单版完整重跑的通过率。

### 8.1 完成情况汇总与统计口径

| 统计口径                             | 普通任务  | 独立首次安装 | 合计               | 实际结论与证据                                                                                |
| ------------------------------------ | --------- | ------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| OpenAI `.133` 完整轮                 | 31/36     | 8/9          | **39/45（86.7%）** | 生成摘要、独立验收各收齐 45 份；生成通过 44/45；[完整报告][openai133]                         |
| OpenAI `.135` 六项复测               | 1/5       | 0/1          | **1/6**            | 生成及验收各收齐 6 份，仅 `verify-26` 通过；没有重跑此前已通过的 39 项；[复测报告][openai135] |
| **OpenAI 跨版本累计**                | **32/36** | **8/9**      | **40/45（88.9%）** | 按独立样本 ID 合并通过项，剩余 4 项普通任务和 1 项首次安装；不混入火山或人工辅助成绩          |
| 火山历史自动交付（截至 `.132` 账本） | 27/36     | 7/9          | **34/45（75.6%）** | 保留原统计；`.131` / `.132` 未新增自动合格项；[历史后续账本][volc132]                         |
| 冻结火山 v3 正式验收                 | 0/36      | 0/9          | **0/45，NOT_RUN**  | 原任务 JSON 未改写，`readyForPaidExecution:false`；[冻结就绪记录][readiness]                  |

OpenAI 队列为独立的 `openai / gpt-6.1-sol / Responses` 诊断身份，固定项目仍为 `b2aa3aba082873570e85dce39b00754e5504ff37`。`.133` 使用 CLI `0.166.133` / Open VSX `0.37.171` / JetBrains `0.4.188`；`.135` 使用公开 CLI `0.166.135` / Open VSX `0.37.173`，JetBrains `0.4.189` 使用来源及 ZIP 摘要已核验的官方 Actions 构建包。该复测没有将构建包称为商店已批准版本。

表中“已通过”要求该样本的生成身份、终态、交付来源及 Linux 无模型凭据 Docker 独立检查均通过；首次安装保持独立样本，普通任务通过不能替代首次安装。候选在冻结项目上验收通过，不代表全部候选已集成到当前仓库，也不授予正式付费或原生生产准入。

### 8.2 普通任务逐项完成情况（OpenAI 累计 32/36）

验收数字来自两轮机器可读结果：[`.133` JSON][openai133-json]、[`.135` JSON][openai135-json]。“变异检出”表示候选能使注入错误行为后的断言失败；普通测试自身通过但漏过变异仍算未通过。计划交付路径仅核对原 `expectedFiles` 的同名文件是否存在，不用于替代行为验收。

| 编号                    | 任务                               | 分配入口            | OpenAI 累计验收 | 最新独立验收事实                                             | 当前计划交付路径 | 证据                                            |
| ----------------------- | ---------------------------------- | ------------------- | --------------- | ------------------------------------------------------------ | ---------------- | ----------------------------------------------- |
| [verify-01](#verify-01) | 官方 endpoint 与同名自定义网关隔离 | Windows / CLI       | 已通过          | `.133` 基线 75/75，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-02](#verify-02) | 精确模型能力查找                   | Windows / VS Code   | 已通过          | `.133` 基线 75/75，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-03](#verify-03) | 新家族未知计价                     | Windows / JetBrains | 已通过          | `.133` 基线 31/31，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-04](#verify-04) | 请求级缓存与阶梯费用               | Linux / CLI         | 已通过          | `.133` 基线 22/22，候选 5/5；2/2 项变异检出                  | 存在（辅助交付） | [完整轮][openai133]                             |
| [verify-05](#verify-05) | 安装与准入分离                     | Linux / VS Code     | 已通过          | `.133` 基线 42/42，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-06](#verify-06) | 付费分解前预检                     | Linux / JetBrains   | 已通过          | `.133` 基线 31/31，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-07](#verify-07) | 持久正文分页边界                   | macOS / CLI         | 已通过          | `.133` 基线 39/39，候选 5/5；2/2 项变异检出                  | 存在（辅助交付） | [完整轮][openai133]                             |
| [verify-08](#verify-08) | fork 历史归属                      | macOS / VS Code     | 未通过，待复测  | `.135` 基线 58/58，候选 0/3；fork 归属与 capability 断言失败 | 未见同名文件     | [复测回执][check-verify-08]、[工程修复][repair] |
| [verify-09](#verify-09) | 历史来源篡改拒绝                   | macOS / JetBrains   | 已通过          | `.133` 基线 11/11，候选 6/6；1/1 项变异检出                  | 存在（辅助交付） | [完整轮][openai133]                             |
| [verify-10](#verify-10) | 分页索引失效回归                   | Windows / CLI       | 已通过          | `.133` 基线 2/2，候选 6/6；1/1 项变异检出                    | 存在（辅助交付） | [完整轮][openai133]                             |
| [verify-11](#verify-11) | 问题持久记录归属                   | Windows / VS Code   | 已通过          | `.133` 基线 16/16，候选 6/6；2/2 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-12](#verify-12) | 含空格参数完整性                   | Windows / JetBrains | 已通过          | `.133` 基线 11/11，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-13](#verify-13) | 附件同句柄读取边界                 | Linux / CLI         | 未通过，待复测  | `.135` 基线 13/13、候选 6/6，但未检出行为变异                | 存在（辅助交付） | [复测回执][check-verify-13]、[工程修复][repair] |
| [verify-14](#verify-14) | 图片逐项错误                       | Linux / VS Code     | 已通过          | `.133` 基线 41/41，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-15](#verify-15) | 权限修订溢出拒绝                   | Linux / JetBrains   | 已通过          | `.133` 基线 12/12，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-16](#verify-16) | 无效设置来源保守失败               | macOS / CLI         | 已通过          | `.133` 基线 25/25，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-17](#verify-17) | 持久进程所有权记录                 | macOS / VS Code     | 已通过          | `.133` 基线 11/11，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-18](#verify-18) | 所有权未知保持阻断                 | macOS / JetBrains   | 已通过          | `.133` 基线 2/2，候选 6/6；1/1 项变异检出                    | 未见同名文件     | [完整轮][openai133]                             |
| [verify-19](#verify-19) | 取消审批迟到回调                   | Windows / CLI       | 未通过，待复测  | `.135` 基线 17/17、候选 3/3，但未检出行为变异                | 未见同名文件     | [复测回执][check-verify-19]、[工程修复][repair] |
| [verify-20](#verify-20) | deny 决策不降级                    | Windows / VS Code   | 已通过          | `.133` 基线 4/4，候选 6/6；1/1 项变异检出                    | 未见同名文件     | [完整轮][openai133]                             |
| [verify-21](#verify-21) | Memory 影子读取无写入              | Windows / JetBrains | 已通过          | `.133` 基线 19/19，候选 4/4；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-22](#verify-22) | Memory 发布后故障语义              | Linux / CLI         | 已通过          | `.133` 基线 19/19，候选 4/4；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-23](#verify-23) | 缺失样本固定分母                   | Linux / VS Code     | 已通过          | `.133` 基线 30/30，候选 5/5；2/2 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-24](#verify-24) | 比较身份严格隔离                   | Linux / JetBrains   | 已通过          | `.133` 基线 22/22，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-25](#verify-25) | 草稿写失败保留旧记录               | macOS / CLI         | 已通过          | `.133` 基线 25/25，候选 5/5；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-26](#verify-26) | 敏感问题字段排除                   | macOS / VS Code     | 已通过          | `.135` 基线 14/14，候选 6/6；2/2 项变异检出                  | 未见同名文件     | [六项复测][openai135]                           |
| [verify-27](#verify-27) | 重载问题精确绑定                   | macOS / JetBrains   | 已通过          | `.133` 基线 14/14，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-28](#verify-28) | 迟到加载不覆盖编辑                 | Windows / CLI       | 已通过          | `.133` 基线 14/14，候选 4/4；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-29](#verify-29) | 模式 ACK 关联                      | Windows / VS Code   | 已通过          | `.133` 基线 19/19，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-30](#verify-30) | 累计动画帧预算                     | Windows / JetBrains | 已通过          | `.133` 基线 13/13，候选 6/6；2/2 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-31](#verify-31) | 快照失败资源清理                   | Linux / CLI         | 已通过          | `.133` 基线 31/31，候选 3/3；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-32](#verify-32) | 预览取消失效                       | Linux / VS Code     | 已通过          | `.133` 基线 13/13，候选 5/5；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-33](#verify-33) | 快速多图添加预算                   | Linux / JetBrains   | 已通过          | `.133` 基线 18/18，候选 5/5；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-34](#verify-34) | 冻结计划操作说明                   | macOS / CLI         | 已通过          | `.133` 基线 30/30；文档与脚本检查通过                        | 未见同名文件     | [完整轮][openai133]                             |
| [verify-35](#verify-35) | 模型失败分类回归                   | macOS / VS Code     | 已通过          | `.133` 基线 77/77，候选 6/6；1/1 项变异检出                  | 未见同名文件     | [完整轮][openai133]                             |
| [verify-36](#verify-36) | 启动配置身份保真                   | macOS / JetBrains   | 未通过，待复测  | `.135` 基线 7/7，候选 2/6；策略持久化与非法值拒绝失败        | 未见同名文件     | [复测回执][check-verify-36]、[工程修复][repair] |

当前 36 项涉及的源码路径均存在；计划同名交付文件实际存在 **5/36**：`verify-04`、`07`、`09`、`10`、`13`，来自已安装的人工辅助交付。其余计划同名路径未见文件，候选交付及摘要绑定见上述验收归档；其他名称的既有回归不据此判为缺失。剩余五项涉及的新增工程回归使用 `__tests__/unit/` 下的名称，见 8.4 工程表。

### 8.3 独立首次安装逐项完成情况（OpenAI 累计 8/9）

| 独立样本                                                  | 重新执行任务 | OpenAI 累计验收 | 最新独立验收事实                                               | 证据                                                          |
| --------------------------------------------------------- | ------------ | --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| [first-run-win32-cli](#first-run-win32-cli)               | verify-01    | 已通过          | `.133` 基线 75/75，候选 6/6；1/1 项变异检出                    | [完整轮][openai133]                                           |
| [first-run-win32-vscode](#first-run-win32-vscode)         | verify-02    | 已通过          | `.133` 基线 75/75，候选 6/6；1/1 项变异检出                    | [完整轮][openai133]                                           |
| [first-run-win32-jetbrains](#first-run-win32-jetbrains)   | verify-03    | 已通过          | `.133` 基线 31/31，候选 6/6；1/1 项变异检出                    | [完整轮][openai133]                                           |
| [first-run-linux-cli](#first-run-linux-cli)               | verify-04    | 已通过          | `.133` 基线 22/22，候选 5/5；2/2 项变异检出                    | [完整轮][openai133]                                           |
| [first-run-linux-vscode](#first-run-linux-vscode)         | verify-05    | 已通过          | `.133` 基线 42/42，候选 6/6；1/1 项变异检出                    | [完整轮][openai133]                                           |
| [first-run-linux-jetbrains](#first-run-linux-jetbrains)   | verify-06    | 已通过          | `.133` 基线 31/31，候选 6/6；1/1 项变异检出                    | [完整轮][openai133]                                           |
| [first-run-darwin-cli](#first-run-darwin-cli)             | verify-07    | 已通过          | `.133` 基线 39/39，候选 6/6；2/2 项变异检出                    | [完整轮][openai133]                                           |
| [first-run-darwin-vscode](#first-run-darwin-vscode)       | verify-08    | 未通过，待复测  | `.135` 基线 58/58，独立候选 2/4；capability 绑定与历史导入失败 | [复测回执][check-first-run-darwin-vscode]、[工程修复][repair] |
| [first-run-darwin-jetbrains](#first-run-darwin-jetbrains) | verify-09    | 已通过          | `.133` 基线 11/11，候选 6/6；1/1 项变异检出                    | [完整轮][openai133]                                           |

### 8.4 剩余五项：最新代码修复与待办

剩余样本为 **`verify-08`、`verify-13`、`verify-19`、`verify-36`、`first-run-darwin-vscode`**。最新模型复测全部已生成交付，但独立验收未通过；下面的工程修复没有重写原候选或成绩。相关产品修复提交为 `714053760794301496080a48b24faeac01c40429`，`.136` 准备提交另修正了 Windows 图片夹具的 BigInt 文件身份比较。

| 样本                      | 当前代码 / 工程交付                                                                                                                                                                                       | 工程证据                                                                                                                                                                                                     | 尚待完成                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `verify-08`               | [完整历史分叉](../../../packages/cli/src/lib/session-history-origins.js)独立验证 capability、指纹、head、消息数及 ordinal；纠正内部 lineage notice 与展示消息的断言位置                                   | [分叉归属回归](../../../packages/cli/__tests__/unit/session-branch-ownership-regression.test.js) 3/3                                                                                                         | 在新执行身份下重新生成候选并通过独立验收                                         |
| `verify-13`               | 生产图片 guard 原本正确；补同句柄、同内容、同大小而仅 mtime/ctime 改变的控制及像素上限边界，Windows 夹具使用 BigInt 比较文件身份                                                                          | [同句柄回归](../../../packages/cli/__tests__/unit/image-pinned-handle-regression.test.js) 6/6                                                                                                                | 新候选须检出原验收器的元数据变化及像素预算变异                                   |
| `verify-19`               | 生产审批逻辑原本正确；补真实 pending approval 的拥有者 turn abort，随后发送关联正确的迟到 accept，验证拒绝及工具执行数为 0                                                                                | [审批所有权回归](../../../packages/cli/__tests__/unit/headless-approval-ownership-regression.test.js) 4/4                                                                                                    | 新候选须检出取消时错误放行的行为变异                                             |
| `verify-36`               | [启动策略](../../../packages/cli/src/lib/background-launch-profile.js)与 [agent 入口](../../../packages/cli/src/commands/agent.js)保留空白名单、独立插件/MCP 限制和显式配置，拒绝非法策略、缺值及预算格式 | [策略往返回归](../../../packages/cli/__tests__/unit/background-launch-policy-roundtrip-regression.test.js) 6/6；[入口定制回归](../../../packages/cli/__tests__/unit/agent-customization-options.test.js) 5/5 | 明确冻结项目与修复后产品的不同身份，重新生成并验收，不能靠宿主升级补写旧项目通过 |
| `first-run-darwin-vscode` | 复用完整历史分叉产品修复；独立覆盖真实历史导入及错误来源、摘要、截断的拒绝                                                                                                                                | [历史导入回归](../../../packages/cli/__tests__/unit/session-history-import-regression.test.js) 4/4                                                                                                           | 在独立干净 macOS / VS Code 环境重新完成首次安装及对应任务验收                    |

工程归档记录定向回归 **28/28**、相关回归 **155 通过 / 1 个既有平台 skip**、原验收器 **5/5** 个行为变异被拒绝，并拒绝撤销完整历史分叉修复的模拟；不同套件可能重叠，不相加。详见[工程报告][repair]及[机器可读证据][repair-json]。这些工程检查没有新增模型请求。

本次在标准 Windows 权限环境重新运行上述六文件，实际 **28/28、零失败、零跳过，exit 0**。此前受限环境运行为 21 通过、7 失败；7 项均停在 `owner-only native ACL verification failed`，未进入业务断言。保留该环境差异，不以禁用 ACL 或改动测试取得通过。修复所涉 4 个生产文件与工程归档 SHA-256 一致；图片测试文件因 `.136` BigInt 夹具修正而不同。

```powershell
# 工作目录：packages/cli
npx.cmd --no-install vitest run __tests__/unit/session-branch-ownership-regression.test.js __tests__/unit/session-history-import-regression.test.js __tests__/unit/image-pinned-handle-regression.test.js __tests__/unit/headless-approval-ownership-regression.test.js __tests__/unit/background-launch-policy-roundtrip-regression.test.js __tests__/unit/agent-customization-options.test.js --maxWorkers=3
```

### 8.5 历史证据与完成边界

| 范围                       | 已核实情况                                                                                                                                   | 对当前完成数的影响                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 火山自动候选               | [历史 32 项交付索引][accepted32]加[`.128` 账本][round128]新增 2 项，累计 34/45；[`.131` 续测][volc131]及[`.132` 续测][volc132]未新增自动合格 | 单列保留，不与 OpenAI 相加，不将历史失败覆盖为通过                           |
| 原冻结项目上的人工辅助交付 | `verify-04`、`07`、`09`、`10`、`13` 已安装；[五项安装与独立复核][assisted5]保留原 Docker 检查及适配限制                                      | 属于辅助工程交付，不计为原自动模型候选成功，也不替代完整首次安装旅程         |
| 最新五项工程修复           | 当前代码六文件 28/28；历史工程变异控制通过；未开展新的五项模型复测                                                                           | OpenAI 累计仍为 40/45，剩余 5 项                                             |
| 费用                       | `.133` 598/598 请求用量完整，token 估算 $30.660472；`.135` 100/100，估算 $5.880530；实际账单均为 `null`                                      | 两轮费用各按原记录，不把估算、未知账单或不同 provider 结果合并为正式比较结论 |
| 冻结正式计划               | 原 `tasks.json`、`plan.json`、摘要、预算及正式就绪状态保持原记录                                                                             | 正式 `NOT_RUN`，0/36、0/9；本文文档更新与本机回归不增加正式完成数            |

本次更新仅核对仓库代码、现有验收归档和定向本机回归，没有调用模型、重新派发付费任务或修改冻结计划与历史验收记录。

[openai133]: ./verify01-openai-133/run-41117741513/REPORT.md
[openai133-json]: ./verify01-openai-133/run-41117741513/results.json
[openai135]: ./verify01-openai-135/retest-six-99b93fc209/REPORT.md
[openai135-json]: ./verify01-openai-135/retest-six-99b93fc209/results.json
[repair]: ./verify01-openai-135/five-failure-repair/REPORT.md
[repair-json]: ./verify01-openai-135/five-failure-repair/engineering-evidence.json
[check-verify-08]: ./verify01-openai-135/retest-six-99b93fc209/receipts/verify-08-check.json
[check-verify-13]: ./verify01-openai-135/retest-six-99b93fc209/receipts/verify-13-check.json
[check-verify-19]: ./verify01-openai-135/retest-six-99b93fc209/receipts/verify-19-check.json
[check-verify-36]: ./verify01-openai-135/retest-six-99b93fc209/receipts/verify-36-check.json
[check-first-run-darwin-vscode]: ./verify01-openai-135/retest-six-99b93fc209/receipts/first-run-darwin-vscode-check.json
[accepted32]: ./evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-106-20261018-r2-accepted-deliverables.json
[round128]: ./evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028.json
[volc131]: ../cli-ide-native-retest131-progress-2026-10-29.md
[volc132]: ../cli-ide-native132-first-run-progress-2026-10-30.md
[assisted5]: ../cli-ide-assisted-0413-install-progress-2026-10-30.md
[readiness]: ./verify01-plan-2026-10-13-volcengine/execution-readiness.json
