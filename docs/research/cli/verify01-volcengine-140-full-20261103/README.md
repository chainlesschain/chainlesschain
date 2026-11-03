# 火山 / DeepSeek：最新 CLI 与 IDE 完整 36+9 复测

用户明确要求“全部复测”，本轮重新运行全部 **36 项普通任务及 9 次独立首次安装，共 45 项**，包含历史已通过的项目。此前失败项补测的选择器不用于本轮。

执行状态以 `dispatch.json` 和最终 `results.json` 为准。配置、离线检查和发布验证不计为任务完成。

已从不可变提交 `eb50e4f42778d6be457595cc0f39fcada025d5f0` 启动[完整 Actions 41630636517](https://github.com/chainlesschain/chainlesschain/actions/runs/41630636517)，标签 `verify01-volc140-full45-eb50e4f427`，45 项生成及45 项独立验收均保留。启动成功不计作任务通过，最终成绩待完整回执核验。

## 固定身份

- CLI `0.166.140`，VS Code 插件 `0.37.176`，JetBrains 插件 `0.4.193`；发行源码 `e2a91bf54332ff3d252c40ecc25c5887e0f0430d`。
- CLI 使用 npm 公开发行包，VS Code 使用 Open VSX 公开包；核对官方 Actions 发布构件字节。JetBrains 使用对应成功发布作业的原始 ZIP；若 Marketplace 尚未审批，明确保留此状态，不能称作已公开可下载。
- 已核验 JetBrains 官方发布作业 `41614441190` 第二次尝试成功，构件 `chainlesschain-ide-jetbrains-2`，构件 ID `13226403499`；本轮冻结时 Marketplace 尚待审批。三包原始字节及其来源摘要均通过核验。
- 项目源码保持原冻结提交 `b2aa3aba082873570e85dce39b00754e5504ff37`，不换成 Sol 后续修复项目。
- Provider / model：`volcengine / deepseek-v4-flash-ga-260731`。
- Windows、Linux、macOS × CLI、VS Code、JetBrains 共九组，每组四项任务和一次首次安装。每个样本独立生成，独立 Linux Docker 验收。
- 保留通用变更审查、原始提示词、文件权限、行为反例和基线检查。不给模型前次候选或 Sol 答案。

## 执行策略

每项最多 40 个模型轮次、48 次物理请求；输出参数使用认证模型目录公布的最大值 `393216`，不再设 `8192` 的测试上限。普通任务截止 40 分钟，首次安装截止 60 分钟；连接地址选择等待 10 秒。省略 `parallel_tool_calls`，保留提供方默认批处理。规划窗口为 `32768`。

Thinking 保持此前火山诊断的 `disabled`。Sol 使用默认思考和 Responses 协议，版本和部分任务源码也不同，不能将结果当作严格的模型单变量排名。模型最大输出参数是请求允许值，不代表每次输出或账单必然达到此值。

只使用专用 `VOLCENGINE_VERIFY01_API_KEY`；完整密钥通过环境注入，目录认证只发 GET，不保存密钥。正式冻结计划的财务/执行准入仍为 `NOT_RUN`，本轮属于另行授权的诊断。

## 计分与证据

本轮完整成绩单独计算，分列生成终态、候选验收和两者均通过。历史火山自动候选交付累计 **34/45** 保留（`verify-06` 历史候选验收为真但端到端为假，原限定不升级）。新累计只按样本 ID 合并已通过记录，不因重测失败抹去旧成功。

Sol 的 **45/45** 为跨版本、含修复任务源码的累计覆盖，原冻结项目历史 **41/45** 仍单独保留；不是同版本同源码的一次 45 项全量成绩。

冻结配置：[完整包清单](../verify01-package-sets/2026-11-03-volcengine-public140-full45.json)。`package-resolution.json` 保存来源、版本、官方作业和包哈希，`model-catalog.json` 保存非敏感目录元数据。执行前记录不可变提交和 dispatch 日志；不盲目重发付费工作流。完成后归档每项原始 summary、候选、验收回执及摘要校验，再更新[任务清单](../verify01-36-plus-9-task-list.md)。

离线验证：工作流使用的 26 个测试文件共 **183 项通过**；源码出网清单无未审阅/失效条目。离线通过不计入 45 项任务成绩。
