# 36+9 剩余任务续测与宿主修复

日期：2026-10-28。承接[公开 .128 复测记录](./cli-ide-review128-task-progress-2026-10-28.md)。当前已核验跨版本累计产物合格为 **34/45**，普通任务 **27/36**，首次入口 **7/9**，剩余 **11** 项产物。`verify-06` 虽新增产物合格，原生旅程仍失败；本轮累计新增端到端合格仅 **1** 项，不能将 34/45 解释为完整原生通过率。

## 已核对的历史结论

10 月 27 日的 13 项剩余样本已有完整尝试，新增合格 0；10 月 28 日公开 `.128` 的 `verify-09`、`verify-04`、`verify-13` 三项也已完成生成与独立验收，新增合格 0。最新结果应使用上述记录及其严格收集账本，不能仅依据 10 月 23 日的历史剩余清单判断“未复测”。

`verify-33` 已合格候选的归档回复恢复，于 10 月 26 日在公开 JetBrains `.179` / Linux 2025.2 上独立通过，见[成功证据](./cli/evidence/recovery-2026-10-26/archived-reply-success/result.json)。这不改写历史任务的原生恢复失败，也不新增一项合格交付；无需把这个已完成的限定范围检查继续列为未执行。

## JetBrains 宿主诊断

运行 [40623725873](https://github.com/chainlesschain/chainlesschain/actions/runs/40623725873) 的三个 JetBrains 失败均已下载核对。Linux、Windows、macOS Intel 的 `valid` 阶段都显示 `LLM configuration could not be read`，追踪文件记录了 `llm capabilities --json` 调用。旧夹具返回 `{}`，不满足能力 profile 协议；生产代码将其判为无法读取，符合新的配置状态合同。

修补提交 `276e5909d35e36986f9359a55c8ecc22af958519` 在私有 home 中写入明确的 `{"llm":{}}` 配置，并清除继承的配置根目录覆盖，使 IDE 读取已由旅程设置的私有 `user.home`。保留生产逻辑、原 UI 断言和禁止 Agent 调用的夹具限制。原始三系统失败日志、命令追踪和摘要见[证据索引](./cli/evidence/remaining-tasks-2026-10-28/retained-host-failures.json)。

本地夹具与进程管理检查共 22 项通过、3 项 POSIX 专属跳过。第一次沙箱内运行的进程管理检查受到 Windows CIM 权限拒绝，未计为通过；经允许在沙箱外重跑后通过。复测计划、账本及任务驱动检查 37/37 通过。

第一版的 [VERIFY01 Host Diagnostics 40632791791](https://github.com/chainlesschain/chainlesschain/actions/runs/40632791791) 在 Windows 和 Linux 仍失败。进一步读取启动链发现 Gradle 在最终 IDE 进程重新注入了 `CHAINLESSCHAIN_HOME`，因此仅修改父进程环境不足。Windows 原始失败保留在[第一版失败目录](./cli/evidence/remaining-tasks-2026-10-28/first-fix-windows/)，该运行剩余作业在替代检查启动后取消，不能计为通过。

后续提交 `253aeaa28f06400f3c9af1f8fb85be77a198272e` 仅在身份诊断旅程的 Gradle 启动处清除配置根覆盖，其他原生任务保留原隔离方式；UI 旅程新增实际 IDE 的 `user.home` 与两个环境覆盖断言并保存快照。JDK 21 离线 `compileUiTestJava` 成功，保留既有 API 弃用警告。固定验证引用 `eval-verify01-onboarding-20261028-r2` 的[三系统复查 40635239599](https://github.com/chainlesschain/chainlesschain/actions/runs/40635239599) 已 **7/7 作业通过**。

制品回读核对三系统 JetBrains 各 8 项身份旅程、实际配置环境、源码提交和 VS Code 三系统诊断结果，保留 22 份压缩原始文件及双摘要，见[完整回读索引](./cli/evidence/remaining-tasks-2026-10-28/host-success-40635239599/verification.json)。Windows 配置路径包含长短文件名差异，等价性由真实 IDE 内的 `Path.toRealPath()` 断言验证，不以字符串相等替代。该运行是无模型宿主诊断，不增加 36+9 产物数量，也不代表发布门禁全部通过。

## 新增合格任务

按原 `.128` 不可变计划继续执行 `first-run-linux-cli`，运行 [40632820075](https://github.com/chainlesschain/chainlesschain/actions/runs/40632820075)，驱动源码保持 `d9f2511b953ca08a7b5013c177250474b3d6fb4e`。派发前已核对前三项完整用量、严格收集结果、公开包及保守资金预留。意图、唯一运行绑定和调用回执保存在本地操作目录；没有重复派发。

沿用原始模型、20 回合、24 次物理请求、8192 单请求输出 token 和六文件工具限制，并启用原有预算内复查。未发布的独立上下文复查修补不计入此次公开 `.128` 行为。

该运行已经成功完成：公开包首次安装、原生生成和独立验收通过。基线 22/22、候选测试 4/4、行为变异检查通过；20/20 次物理请求用量完整，broker 未污染，token 费用估算为 ¥0.6002726，实际账单未知。严格收集器已归档候选、生成摘要、独立检查回执和逐请求用量，账本验证得到 `cumulativeAcceptedDeliverables:33`、本轮 `endToEndPassed:1`。见[本轮账本](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028.json)。

Linux / JetBrains `verify-06` 的运行 [40634447041](https://github.com/chainlesschain/chainlesschain/actions/runs/40634447041) 已完成，驱动源码和公开包保持本轮绑定。基线 31/31、候选 6/6、行为变异检查通过，严格收集器新增一项产物合格；但生成阶段因连接失败结束，未取得可重启的完整结果，`generationPassed:false`、`endToEndPassed:false`。

第 16 条请求回执记录 IPv4 连接超时、IPv6 `ENETUNREACH`，`dispatchStarted:false`，TCP / TLS / 响应时间均为空，响应为零字节，错误为 `DIAGNOSTIC_REQUEST_NOT_DISPATCHED`。前 15 条回执用量完整，token 估算合计 ¥0.3445642；第 16 条用量仍为空，保留原始账本，不将该条伪造成零用量，不自动重放。既有合格候选也不重新生成。

纳入已知费用后，下一项保守资金预留已超过最近记录的可用余额；同时本项账本仍有未完整结算记录。用户随后提供了新的余额，本地已记录为用户文本观察并保留前次资金记录；没有将文本观察标记为截图核验或账单对账，新余额仍低于既有预留。新的付费派发停止，等待资金补足及独立请求核对，旧未知账单与共享预算责任保留。账户资金记录只保存在本地操作目录，不公开账户余额。无需模型的宿主修复现已完成三系统验证。

不改写冻结任务与验收器、不将人工修补计入原生交付。正式准入状态继续与诊断合格交付分开记录。

用户先授权任务完成后发布 CLI 与 VS Code / JetBrains IDE 插件，随后明确调整为“这次测试通过就可以发布”。因此本轮测试及最终发行提交的完整跨平台门禁（CLI CI、CLI Strict Sandbox 及适用 IDE 门禁）通过后即可发布，不再将全部历史 45 项结案作为发布前提。按必要子 npm 包 → CLI → IDE 插件的顺序通过既有 GitHub Actions OIDC 流程发布，并逐阶段核验公开制品及版本配对。历史失败与未完成任务继续如实记录；该条件授权不等于当前已可发布，移动端和 PC 客户端不在此次发布请求范围内。

## 用户确认后的继续执行

用户随后明确要求“执行吧够用的”。据此记录独立的继续执行授权，保留此前未达到原聚合预留条件的事实，按用户确认的可用额度继续检查逐项执行预留、已知新增用量与单项调用上限。历史责任及原始资金观察均未清除，账户数据仍只保存在本地。

已用严格归档的 SHA-256 及压缩原始回执核对 `verify-06` 第 16 条记录：没有 TCP/TLS 连接，没有请求发送、完成或响应事件，响应零字节且摘要一致。它被单独分类为 `NO_TRANSPORT_DISPATCH`，原空用量与未知账单字段不变，不重新执行该已合格候选。任何无法证明未发送且缺少用量的后续记录仍阻断新派发。

下一项 macOS CLI `verify-07` 已启动，运行 [40669282131](https://github.com/chainlesschain/chainlesschain/actions/runs/40669282131)，继续使用固定驱动源码和公开 `.128`。后台操作流程仅覆盖本轮原计划尚未执行的八项，逐项等待完成、严格收集后才允许下一项；不自动补发不明派发、不重试失败样本。该操作授权不改变正式准入，运行开始不增加合格数。

该运行随后因 `DIAGNOSTIC_OUTPUT_TRUNCATED` 未完成生成，独立验收也未通过：基线 39/39，候选未执行有效测试。3/3 条请求用量完整，token 费用估算 ¥0.148309，broker 未污染，累计产物数保持 34/45。一次 GitHub TLS 查询超时导致严格收集暂停，后续只重试证据读取；不重新调用模型。固定输出上限保持不变。
