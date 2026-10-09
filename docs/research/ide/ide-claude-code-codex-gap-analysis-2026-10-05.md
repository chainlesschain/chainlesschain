# ChainlessChain 对照 Claude Code / Codex 的 IDE、CLI 与 Runtime 增量审计（2026-10-05）

> **2026-10-09 剩余任务续做**：共享模型审查补齐源码/输入字节绑定与失败保存；Windows 共享工具链已真实运行同 SID/Job 的 esbuild service、原冻结 `forks/maxWorkers:2` 配置和 65 项测试，最终源码、actor 身份与清理已独立复核。owner 崩溃后的原 Job/socket 回收原语也已完成，均保持 `NOT_ADMITTED`。完整 native review、Windows/macOS 持久权限后端及双 IDE 正式验收继续开放；已公开的 Doctor、身份和冷初始化工程无需重复立项。目标宿主、正式 36+9、官方账单、独立人工、辅助技术听测和长时/SLO 条件见[验证第 20 节](../cli-ide-gap-validation-2026-10-05.md#20-2026-10-09-剩余工程与验收边界)，原冻结计划与 observations 未改。

> **2026-10-09 配对发行完成**：准确提交 `efcab5f632312aea433953157d52091f018f26ae` 的 CLI CI 71 job 全部成功、Strict 5 job 全部成功、IDE Extensions 实际宿主与构建门成功；[PR #423](https://github.com/chainlesschain/chainlesschain/pull/423) 已合并。CLI `0.166.94` 已由 GitHub Actions OIDC 发布并核验公开 tarball/provenance；VS Code `0.37.139` 已在 Open VSX 公开且 latest/listed，公开 VSIX 与标签产物字节一致；JetBrains `0.4.157` 已获批并公开上架，下载包全部 entry 字节与标签产物一致。 发行源码、原失败/恢复及公开回读见[发行证据](../cli/evidence/gap-2026-10-05/release-0.166.94/README.md)。较早日期记录保留各自时点。私有 esbuild 保持 NOT_ADMITTED；完整 service/config/forks/review、Windows/macOS durable 后端、正式 36+9、官方账单、人工与长时验收仍开放，分母、$99 预算及 observations 未改。

> **2026-10-08 最终候选修正**：旧 CLI CI #37779105012 的 Windows/macOS 失败已定位到测试临时目录别名；fixture 现使用 canonical realpath，并新增真实 symlink/junction 父目录拒绝回归，生产严格检查未放宽。两 Node 版本各37项通过，最终准确 SHA 全矩阵待执行。 私有 esbuild leaf 按去除 EOF 空行后的最新源码重编译并真实实跑 v3，成功和未入 Job 清理负例均成立；[最新字节与状态](../cli-ide-gap-validation-2026-10-05.md#183-最终源码字节重新验证)仍保留 NOT_ADMITTED，正式36+9和人工/账户验收仍开放。配对候选为 CLI `0.166.94` / VS Code `0.37.139` / JetBrains `0.4.157`；通过完整发布门后按授权发布。

> **2026-10-08 私有 leaf 与发布准备**：独立非管理员监督器已在零capability AppContainer内让冻结esbuild真实bundle成功，源码/真实负例与61项合同已固化；完整service/config/default forks/review仍未接入，状态NOT_ADMITTED。用户授权测试成功后配对发布，候选CLI`0.166.94` / VSCode`0.37.139` / JetBrains`0.4.157`，10个固定子包下载/依赖核验完成，Doctor推荐值构建残留也已修复。本机CLI/IDE相关回归和插件ZIP构建通过，最终准确SHA完整门待执行；见[验证第18节](../cli-ide-gap-validation-2026-10-05.md#18-2026-10-08-私有-esbuild-leaf-与发布候选)。durable后端、正式36+9、官方账单和人工长时验收继续开放，无付费模型请求，尚未发布。

> **2026-10-08 设置锁与 esbuild 启动续做**：用户指出的Windows Strict并发设置锁失败已在`91924f202e`修复，原两秒期限/ownership保留；Windows/Linux x64/ARM64/macOS15及额外macOS latest五job完整成功；CLI CI仍待完成。独立esbuild leaf在`fd713e0e72`已启动并取得11条API记录，祖先打开仍Win32 5，完整config/default forks/review开放。定向回归两Node版本各136通过/1 Linux专属跳过，真实四进程两系统各240次写入无丢失/重复；本机完整失败保留。见[验证第17节](../cli-ide-gap-validation-2026-10-05.md#17-2026-10-08-设置锁公平性与-esbuild-启动取证)。Windows/macOS durable、正式36+9、官方账单与人工长时验收仍开放，无付费请求或发布。

> **2026-10-08 Worker/锁/GNU 续做**：修复 Linux CI 的 Worker 结算竞态和严格锁释放争用；Windows 74 通过/1 Linux 专属跳过，Linux Node 22.12.0 为 75 全通过。冻结 GNU Rollup addon 通过独立 41 项 N-API forwarder 在零 capability AppContainer 中完成同步/异步解析、哈希及负例，36 项合同通过，仍为 `NOT_ADMITTED`。完整 esbuild/config/default forks/native review、Windows/macOS durable 后端和正式 36+9/官方账户账单/人工长时验收继续开放。当前结果见[验证第 15 节](../cli-ide-gap-validation-2026-10-05.md#15-2026-10-08-worker-结算锁释放与-gnu-工具链)，下方历史记录保留各自时点。

> **2026-10-08 共享 NUL/继承续做**：共享评测后端新增独立实验 v3，真实 AppContainer 内的 NUL 设备、两层受控 Node 后代与并发启动、精确句柄白名单及清理已验证，最新回归 **572 项通过、零跳过**。冻结配置仍在 esbuild 报告的祖先目录读取阶段失败，未观察 worker pool；本轮没有新增双 IDE 正式旅程。详见[验证第 14 节](../cli-ide-gap-validation-2026-10-05.md#14-2026-10-08-nul-设备与精确后代继承)。正式 36+9、目标宿主、官方账号/账单、独立人工签核、真人辅助技术及长时验收继续开放；没有发布。

> **2026-10-08 共享评测续做**：Windows 实验 runtime 已验证管道/fork IPC、私有规范路径及各 Node 子进程回执，冻结工具链导入和原 globalSetup/teardown 已通过；共享回归 **446 项通过、零跳过**。这些是本地 Windows 10 / Node 22.22.2 诊断，不能关闭双 IDE 正式任务、公开首次安装、真人听测或长时验收。NUL、冻结 forks/config/full review 和正式 36+9 继续开放，证据与 CI 失败修复见[验证第 13 节](../cli-ide-gap-validation-2026-10-05.md#13-2026-10-08-独立实验-runtime-与冻结-setup)。

> **2026-10-08 共享验收执行续做**：已补齐冻结工具链准备、独立 v2 AppContainer 胶囊及原生传输/拒绝反例，208 项回归通过、零跳过。双 IDE 既有身份、Doctor 和冷初始化修复继续保留；共享 native review 仍被实际 Rollup 管道与冻结 globalSetup 的 `realpath EPERM` 阻塞，addon 结果保留两项成功、一项失败。详见[验证第 12 节](../cli-ide-gap-validation-2026-10-05.md#12-2026-10-08-冻结原生工具链与-appcontainer-胶囊)。正式双 IDE 任务/首次安装、真人听测、8h/24h、官方账号/账单及获批 SLO 均未关闭；不把胶囊诊断写入正式 36+9。

> **2026-10-07 共享原生验收续做**：七项探针各自独立 Job，IPC 已真实执行但与 pipe 一样超时；清理均确认，未授予部分能力。补齐 v2 校验、准入兼容及冻结工具链只读预检，**68 项回归通过**，失败和摘要已归档，详见[验证第 11 节](../cli-ide-gap-validation-2026-10-05.md#11-2026-10-07-独立原生探针与工具链预检)。本轮未启动新的 IDE/provider 正式样本；native 完整执行、正式 36+9、账单、真人辅助技术与长时验收继续开放。

> **2026-10-06 原生 review 准入与 CI 修复**：Windows review 后端已有只读逐题准入与固定能力探针，完整 pack 仍缺受信任工具链及 locked setup 支持。逐阶段实测定位到管道 stdio 卡住，文件 stdio 返回 `EPERM`；不将部分记录作为正式验收能力。单独审计 `verify-17`：其冻结目标为 macOS VS Code，唯一 journal 基线却仅在 Linux 执行，必须分别保留平台不匹配与基线不支持。修正安全映射摘要后，`266718e8b5` 的 Strict/Safety 完整工作流成功，含三系统、ARM64、附加 macOS 与 Safety 汇总。新增测试与原始失败边界见[验证记录第 10 节](../cli-ide-gap-validation-2026-10-05.md#10-2026-10-06-原生-review-准入与-actions-修复)，正式 36+9 和人工/长时验收仍开放。

> **2026-10-06 公开 IDE 实测续做**：市场 VS Code `0.37.135` / JetBrains `0.4.153` 配对公开 npm CLI `0.166.90`，在真实 VS Code `1.132.0` / IntelliJ `2024.2`、隔离 profile 和火山账号中完成写入/读回、tab 切换、终态显示及重启恢复；唯一输入和 durable receipt、自然 drained exit 0、零恢复重放均经原始协议核验。保留首轮不支持 `auto` 的失败，新增模式启动前校验；修复采集器误判合法 `system/end`，未知重试费用保留 null。源码及费用边界见[验证记录第 9 节](../cli-ide-gap-validation-2026-10-05.md#9-2026-10-06-公开安装与-windows-原生检查器)。这是 Windows 10 / Node 22.22.2 诊断；正式 36+9、双平台完整 review、账单、真人听测与长时观察仍开放。

> **2026-10-06 本轮续做**：已归档 `7694e16564` 的双 IDE 六宿主成功矩阵，包含 Linux/Windows/macOS 实际 IntelliJ 八阶段身份与三场冷初始化旅程；原始协议/UI、退出确认及源码摘要已独立回读。后续 `22236fcb09` 的永不 init/提前退出替换及菜单修复仍以其本地证据为准，不借用旧矩阵。用户授权火山真实采样后，两轮生产压缩与只读工具轨迹通过；正式 provider/首次安装 36+9、官方新模型、真人听测和长时性能验收仍未关闭。详见[续做记录第 8 节](../cli-ide-gap-validation-2026-10-05.md#8-2026-10-06-ci-回读与火山真实采样)。

> **2026-10-06 继续实施**：JetBrains 身份诊断解除 Windows-only 限制，隔离 PATH 仅作用于实际 IDE，三系统 CI 增加同进程八阶段身份旅程；新增真实 30 秒 init、生产 120 秒超时、迟到 init、Stop 与显式重试采集，并以原始子进程记录独立核对零自动补发。最新工程回归与实际宿主结果见[续做验证第 7 节](../cli-ide-gap-validation-2026-10-05.md#7-2026-10-06-剩余工程接线)。CLI `0.166.90` / Open VSX `0.37.135` / JetBrains `0.4.153` 已有[公开回读](../cli/evidence/documentation-release-status-2026-10-06-final.json)；正式 provider/首次安装、真人听测、8h/24h 与获批 SLO 仍独立验收，以下正文保留原审计时点。

> **身份与 Actions 续做（2026-10-06）**：Windows IntelliJ 2024.2 / 插件 0.4.152 的八阶段身份旅程、`6196cd065d` 六宿主通过证据已归档；该提交 Docker 六分片通过 36/36 题与 42 个行为反例。`4f2c19281c` 的独立流式采集期限、真实可见帧与取消清理已接通，但 Windows/macOS warmup 均发现已有光标使 Chromium 忽略新增诊断选区。修复先清除旧 range，再建立并核验真实非折叠选区，清理时恢复原状态；保留 warmup、正式案例与性能验收边界。候选尚未发布，新准确提交仍须完整矩阵。原始失败与通过证据均保留，详见[续做验证记录](../cli-ide-gap-validation-2026-10-05.md)，原审计快照与正式 36+9 边界保留。

> **本轮发行（2026-10-05）**：CLI `0.166.88` 已通过 GitHub Actions OIDC 发布，VS Code `0.37.133` 已在 Open VSX 公开，JetBrains `0.4.151` 已公开上架。三项标签源码固定为 `7db17a12e1`，准确提交完整门及公开回读见[发行证据](../cli/evidence/gap-2026-10-05/release-0.166.88/README.md)。36+9 仍为 `NOT_RUN`，真实验收状态不因发布改变。

> **最新续做**：准确工程提交 `f289a08844` 的 Linux、Windows、macOS 双 IDE 六宿主矩阵与 MCP 三系统 CI 全部通过。VS Code `0.37.134`、JetBrains `0.4.152` 的初始运行和重启恢复均有原始证据；JetBrains CI 初始阶段使用有界回收并确认进程消失，重启阶段均正常退出，不能推广本地 Windows 两次自然退出的结论。七次前序成功/失败尝试继续保留。配对 CLI `0.166.89`，候选尚未发布。详见[实施记录第 13 节](../cli-ide-gap-implementation-2026-10-05.md#13-真实矩阵反馈与退出生命周期)。正式 36+9 样本仍为 `NOT_RUN`，公开安装、真人听测和长时观察仍需独立验收。

> **本次续做**：VS Code 和 JetBrains 的实际面板均已接入显式原始协议采集，并增加提交、标签切换、终态显示和重启恢复的两阶段 GUI driver；CLI 工具负责准备、完整变更扫描与验收组装。Windows 上双 IDE 的真实宿主两阶段诊断均已通过，使用确定性本地 peer；正式模型样本仍为 `NOT_RUN`。最新验证及正式样本边界见[实施记录第 11 节](../cli-ide-gap-implementation-2026-10-05.md#11-实际宿主采集与验收执行接线)。下列原始审计及前几轮发布记录保留其各自时点含义。

> **后续实施（2026-10-05）**：IDE-READY-02、IDE-ONBOARD-02、IDE-COLD-02 及共享模型修复已落地；实现、测试及真实宿主验收边界见[本期实施状态与证据](../cli-ide-gap-implementation-2026-10-05.md)。以下正文保留原审计快照，所述缺陷与行号指原代码基线。后续工作按用户要求在 `main` 进行。

> **本轮工作区补充**：双 IDE `AgentChatSession` 支持可选原始协议观察，新的只读导入器核对输入接受回执、真实终态、退出、tab/reload 操作记录和完整文件变更，并接入既有 Eval/outcome。接口与合同测试已经补齐；真实 GUI driver、公开安装、provider/账单、真人听测和长时观察仍须另行验收。详见[实施记录第 9 节](../cli-ide-gap-implementation-2026-10-05.md#9-本轮验收工程补充)。36+9 仍为 `NOT_RUN`；用户最新已授权提交发布，发行结果及准确提交验证见实施记录第 10 节；正式验收状态不因发布改变。

- 审计日期：2026-10-05（Asia/Shanghai）。
- 代码快照：`main@8b13129624d4b7fa5b122a4109151c574564448e`。开始时共享实施记录已有工作区修改；本次保留该修改，未改产品代码。
- 本项目源码版本：VS Code **0.37.131**、JetBrains **0.4.149**、CLI **0.166.86**。
- 最新可核验上游：Claude Code **2.1.289**、Codex CLI **0.160.0**。版本事实来自官方记录；CLI、IDE、桌面与云端能力按产品入口分别判断。
- 格式参照：[2026-09-27 IDE 审计](./ide-claude-code-codex-gap-analysis-2026-09-27.md)；历史实现与验收边界参照[共享实施记录](../cli-ide-gap-implementation-2026-09-27.md)。本文是新的审计快照，不覆盖旧问题出现时的记录。
- 配套：[本期 CLI 分析](../cli/cli-claude-code-codex-gap-analysis-2026-10-05.md)；[本期统一证据](../cli/evidence/cli-ide-gap-audit-2026-10-05.json)。源码行号均指上述快照。

## 一、结论

**当前 IDE 的主要不足已从“缺恢复能力”转向“能力状态不一致、冷启动边界不统一、真实用户验收尚未完成”。** 09-27 的历史恢复、草稿、流式渲染、模式确认、图片预算五项均已有实质实现，本次相关本地回归通过，不能继续按未开发立项。

本次确认三个具体代码问题，并保留三个产品或验收改进项：

1. **Doctor 的 READY 未反映新能力是否生效。** 双 IDE 仍以 CLI `0.162.190` 为基础就绪下限，启动升级提示使用推荐 `0.166.86`；不支持输入回执的 runtime 仍可发送，但输入状态保留 `unknown`、模式为 `unconfirmed`。这属于基础运行、功能降级和推荐版本的说明不一致，不是“旧版本一律不可运行”。
2. **JetBrains 仍可能把同名 C 编译器识别为已安装 CLI。** 二进制选择器已有严格检查，但所有候选失败时回退 `cc`；onboarding 和手动更新随后改用宽松版本抽取，`cc (GCC) 12.2.0` 被抽成 `12.2.0`。错误会落到模型配置或“已是新版本”方向，增加首次安装排障成本。
3. **JetBrains 冷启动等待仍只有 15 秒，且超时提示可能误称进程未运行。** VS Code 已为同类迁移/SessionStart 冷启动增加 120 秒有界等待和明确错误；JetBrains 的等待超时异常没有 message 时，界面走“agent session is not running”分支。纯 Java 探针实测约 15 秒，尚未在真实 IntelliJ 宿主重现慢初始化。
4. **最新模型共享目录仍需更新。** GPT-6.1 Sol、Sonnet 5.5 的协议、窗口和价格问题由配套 CLI 报告统一立项，IDE 应消费同一能力和计价来源。
5. **真实任务、首次安装、真人辅助技术与性能 SLO 仍缺关闭证据。** 有真实宿主和自动化语义测试，不能等同于真实模型完成任务或真人听测；36 个项目任务和 9 次安装旅程仍为 `NOT_RUN`。
6. **Cloud 仍是自建 runner handoff。** 已有 Local/WSL/SSH/Container 路径不应被否定，但跨本地与云端连续恢复尚未实现，是否产品化属于条件性 P2。

### 1.1 本次状态标记

| 标记               | 含义                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| 本次复现           | 运行真实生产类/纯函数及注入依赖探针，确认输入输出；不自动等于真宿主 E2E |
| 静态确认           | 已追踪调用链与分支；实际出现频率、宿主结果另行验证                      |
| 已实现，待目标验收 | 源码和工程回归存在，部分目标环境或发布产物尚缺验证                      |
| 产品条件项         | 需要明确用户场景再投资，不因竞品存在就默认复制                          |

### 1.2 源码、完整门与公开发行

| 层次                           | 本次核对结果                                                                                                                                       | 可得结论                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 源码                           | CLI `0.166.86` / VS Code `0.37.131` / JetBrains `0.4.149`                                                                                          | 是候选源码版本，不等于已发布                                                             |
| 审计基线 SHA 的 IDE Extensions | [37220997626](https://github.com/chainlesschain/chainlesschain/actions/runs/37220997626)整体成功，18 成功 / 1 JetBrains Marketplace 发布后预期跳过 | 该提交 IDE 门已通过；不能继续沿用旧状态表中的“运行中”                                    |
| 审计基线 SHA 的 Strict Sandbox | [37220897891](https://github.com/chainlesschain/chainlesschain/actions/runs/37220897891)整体成功                                                   | 该提交的 Strict 门已完成                                                                 |
| 审计基线 SHA 的 CLI CI         | [37220898138](https://github.com/chainlesschain/chainlesschain/actions/runs/37220898138)查询时仍执行中                                             | 完整 CLI 发布门尚未结束；查询时点以本期证据快照为准                                      |
| 本次公开端点读取               | npm `latest` 为 **0.166.85**；Open VSX `latest` 为 **0.37.130**                                                                                    | 当前源码晚于公开默认安装版本；未将 Microsoft Marketplace 或 JetBrains 候选计作本次已发布 |

发布继续遵守子 npm 包 → CLI → 双 IDE 的依赖顺序、GitHub Actions OIDC 和准确提交完整矩阵。本文不发起发布，也不以本地 129 项测试替代这些门。

收尾时并行工作将 `main` 推进到 `736784f999`，相对审计基线仅修改桌面端 P2P 重试测试；本文核查的 CLI/IDE 实现未变。以上工作流结果仍只归属于 `8b13129624`，不转移到新提交。

## 二、逐版本段增量复核

| 上游版本段                  | 与 IDE 决策有关的变化                                                                                                   | 本项目判断                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Claude `2.1.284`～`2.1.285` | 当前 Problems 诊断按需读取；reload 中断说明、跨窗口会话重复、queued message 与 hook 阻断原因、live/history 协同继续修正 | 复用已有诊断桥、transcript identity 和草稿协议；新增真实恢复旅程，不重建聊天系统                   |
| Claude `2.1.286`            | 问答永久保留、附件上下文可展开、Bookmarks；主 turn 与后台 agent 的停止范围更明确                                        | 审批/问题保留与 Stop 的准确范围值得补验收；Bookmarks 为需求项，不是本期阻断                        |
| Claude `2.1.287`～`2.1.289` | 后台命令/subagent 观察、重载避免双进程、remote/WSL 超时体验；附件与选中代码路径遵守 Read deny 的修复                    | 冷启动与显式身份检查优先；将 symlink/deny 边界纳入回归候选，本次未证明本项目存在同类权限缺陷       |
| Codex `0.158.x`～`0.159.0`  | App Server 按 item 分页；空会话切换保留草稿；选择复制保留 Markdown                                                      | 现有分页和草稿能力已经具备，继续验证选区/复制与运行时版本匹配；不因协议新版本直接开放外部生产执行  |
| Codex `0.160.0`             | 不确定提交确认后恢复未发送队列、减少重复发送；Show more 键盘可操作；恢复时权限与配置更准确                              | 对照本项目 `unknown` 输入与 mode ACK，补统一能力状态、真实重启和键盘旅程；不把未知接受状态自动重发 |

来源：[Claude Code 官方 changelog](https://code.claude.com/docs/en/changelog)、[官方仓库 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)、[Codex changelog](https://developers.openai.com/codex/changelog)、[Codex App Server](https://developers.openai.com/codex/app-server)。Claude Mods 的终端/部分桌面界面不能直接写成 VS Code chat 已具备完整 Mods UI；Codex CLI 发布号也不是 IDE 插件版本号。

## 三、现有能力：不要重复建设

| 09-27 项目 / 已有能力                      | 当前源码依据                                                                                                                                                                                                | 本次判断及边界                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| IDE-REPLAY / SESSION-01                    | `packages/vscode-extension/src/chat/chat-view.js:912` 恢复入口；`transcript-sync.js:110` 有界增量读取；JetBrains `intellij/ConversationView.java:228` 接入 `ChatHistoryView`                                | 已有 canonical history、分页、generation/cursor 及实时合并；真实 rewind/compaction/fork 和旧 profile 个别边界仍按实施记录保留 |
| IDE-DRAFT                                  | `chat-view.js:435` durable send，`:1199` receipt negotiation；JetBrains `intellij/ChatComposerDrafts.java:43`、`:98` 保存/恢复/准备输入                                                                     | composer、附件、问题表单与接受回执已有实现；不能重报“只有共享 DOM”                                                            |
| IDE-STREAM                                 | `chat-html.js:362` follow-bottom，`:654` 调用增量 renderer；`streaming-transcript.js:20` 追加，`:44` 后每个可变文本尾块至多 4K                                                                              | 已消除每帧全文 Markdown 解析的旧路径；真实硬件的完成阶段成本与 SLO 仍开放                                                     |
| IDE-MODE                                   | `permission-mode-state.js:10` requested/effective/status，`:21` ACK 校验；JetBrains `intellij/ConversationView.java:1804` 模式切换与退出确认                                                                | effective/pending/failed/unconfirmed 与请求关联已有实现；Doctor 汇总尚未消费这一降级信息                                      |
| IDE-IMAGE                                  | `image-preview-gate.js:5` 解码前检查、`:214` Worker 超时，`image-decode-budget.js:45` 帧/累计像素预算；JetBrains `ImageAttachments.java:24` 字节/像素上限与 `intellij/ChatComposerImages.java:174` 有界快照 | 已有总字节、结构、帧预算及失败反馈；两端实际 decoder、磁盘失败、各平台和性能范围分别验收                                      |
| Plan / Diff / Review、MCP、Workbench、Team | 双 IDE 既有入口、共享 runtime 和真实宿主合同                                                                                                                                                                | 应持续整合，不新增第四套 agent/workflow/session engine                                                                        |
| Execution Location                         | `packages/cli/src/lib/execution-location-contract.js:311` 起列出各位置合同                                                                                                                                  | Local/WSL/SSH/Container 与 Cloud 的恢复能力必须分别展示                                                                       |

表中短路径 `chat-*.js`、`transcript-*.js`、`image-*.js` 位于 `packages/vscode-extension/src/chat/`；JetBrains 短路径位于 `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/`。

## 四、本期建议与自动化合并门

### 4.1 证据规则

每项绑定源码 SHA、IDE/OS、安装来源、场景与回执。局部纯类测试、生成 Webview、真实宿主、真实模型、真人辅助技术、公开安装分别计数。相邻版本或旧 SHA 的成功只能作为历史证据，不转移为当前新能力的验收结果。

### 4.2 建议实施表

| ID                  | 优先级       | 当前不足                                                                       | 复用实现与完成条件                                                                                                                      |
| ------------------- | ------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| IDE-READY-02        | P1           | Doctor 只看基础 CLI 版本/端口/信任，忽略输入回执、模式确认等新能力的降级       | 保留最低可运行版本；汇总实际 init capabilities 与 mode state，显示基础可运行/能力降级/推荐升级。缺 ACK 时明确边界，不误报已完整就绪     |
| IDE-ONBOARD-02      | P1           | JetBrains onboarding/手动更新在严格 binary 检查后重新宽松解析，错认 gcc banner | 复用 `AgentChatSession.looksLikeCcVersion` 或统一探测结果。只有 gcc、显式路径错误、未安装、managed fallback、安装后恢复五类得到准确引导 |
| IDE-COLD-02         | P1           | JetBrains 15 秒初始化等待、异常分类与 VS Code 不一致                           | 统一有界初始化合同和明确错误；30 秒后 init 可发送一次，永不 init 可停止/重试且不自动补发，仍活跃 child 不显示为不存在                   |
| MODEL-03 / MODEL-04 | P1，共享任务 | 最新模型目录与价格/窗口回落问题影响 IDE 配置、context 与 usage                 | 以配套 CLI 报告为准，IDE 从共享 profile 展示能力、unknown/unpriced 与来源，不另建价格表                                                 |
| VERIFY-IDE-02       | P1 验收      | 真实任务/首次安装未执行，AX 工程检查与性能测量未形成完整体验结论               | 复用 36+9 冻结计划；记录公开包身份、真实双 IDE 任务、故障及费用；NVDA/VoiceOver/Orca 听测和获批 SLO 单独结案                            |
| CLOUD-02            | P2，条件项   | Cloud 仅 self-hosted handoff，resume 未实现                                    | 先确定断开 IDE 后持续运行/本地云端往返的需求；需实现时复用 session identity、审批归属、取消和产物回流合同                               |

### 4.3 候选、条件项与不立项

| 项目                                             | 处置                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| 新增 Bookmarks、附件上下文展开、后台任务操作聚合 | 以真实用户旅程决定 P2 顺序；现有 Workbench/附件/历史入口可复用             |
| 上游最新 symlink/Read deny 修复                  | 添加路径与权限回归候选；本报告没有复现本项目同类漏洞，不列为已确认安全缺陷 |
| 复制上游云账户、订阅、Mods UI、语音              | 不因对标直接立项；先解决已有入口的状态与首次使用失败                       |
| 将全部旧 CLI 强制判定为不可用                    | 不建议。基础桥和降级发送仍可能运行，应按实际 capability 与功能边界分层     |
| 将实验 Codex adapter 直接作为双 IDE 默认生产基础 | 保持实验/治理边界；固定旧上游原生协议旅程不等于最新版本真实 provider 验收  |

## 五、关键设计建议

### 5.1 READY 应说明哪些能力已经就绪

VS Code `packages/vscode-extension/src/version-check.js:16` 的基础下限仍为 `0.162.190`，`:118` 的升级提示以推荐 `0.166.86` 为参数；`runtime-compatibility.js:25` 只接收 CLI 输出、基础下限、bridge port 和 workspace trust，`ide-doctor.js:38` 没有传入会话能力。JetBrains `RuntimeCompatibility.java:14` 和 `:42` 使用同样结构。

本次对同一输入运行生产函数：`0.162.190` 和 `0.166.85` 都被 Doctor 判为 `ready`，同时启动版本检查判为 `outdated`。这个结果本身不证明基础功能失效；问题在于“CLI and bridge are compatible”的总说明不能表达功能降级或未确认能力。

进一步用真实 `ChatViewProvider` 注入无 `input_receipts` 的 init：`chat-view.js:1199` 将版本记为 0，`:2776` 仅在版本 1 时发送 `client_message_id`，仍成功提交 `type:user`；草稿存储的 settlement 为 `unknown`，界面收到 `receiptSupported:false`，模式为 `unconfirmed`。该回退保护了旧 runtime 的基本可用性，不能写成“不支持 receipt 就禁止聊天”，也不能写成已经取得 durable 接受确认。

建议将现有 init、mode state、transcript 协议能力投影到同一诊断结果，分别标注“基础桥可用”“输入接受未获回执”“实际模式未确认”“推荐配对版本”。未知状态保留未知；已有存储与手动恢复照常使用，不自动重发可能已执行的输入。验收至少覆盖基础最低版本、公开配对、当前候选、未知版本、无 receipt、过期 mode ACK，以及运行中更换 CLI。

### 5.2 首次安装应先确认命令身份，再解释配置

JetBrains `AgentChatSession.java:233` 的 resolver 已对候选输出执行严格首行 semver 检查，但所有全局/managed 候选失败后在 `:254` 回退 `cc`。这在未安装 ChainlessChain 且系统装有 GCC/Clang 时，可以取得真实编译器 banner；显式配置错误路径也会跳过自动探测。

`intellij/ConversationView.java:418` 的缓存只缓存正确身份，值得保留；但 `:434` onboarding 判断安装是否存在使用 `CliVersionCheck.parseVersion(ver)`，其实现 `CliVersionCheck.java:27` 从任意位置抽取版本。相同问题在手动更新 `ConversationView.java:517` 再次出现。纯 Java 探针确认 `cc (GCC) 12.2.0` 被抽取成 `12.2.0`，而同一输出交给 `RuntimeCompatibility.evaluate` 返回 `repair`。

因此这里缺的是调用端复用严格身份结论：onboarding 不应继续把故障解释为 provider 未配置，手动更新不应因为 `12.2.0 > 0.166.86` 认为 CLI 已足够新。建议返回统一探测结果 `{command, identity, version, failureKind}`，复用已有解析器；保持用户配置路径，不自动改 PATH 或覆盖其他工具。

VS Code 纯版本检查同样能从 GCC banner 得到 `ok`，但实际 activation 在 `extension.js:265` 先做 missing/identity 通知，故本报告不把纯函数输入直接扩大成 VS Code 的同等宿主故障。JetBrains 的 UI 分支目前为静态确认，未在真实 IDE 中安装/替换编译器复现。

### 5.3 冷启动超时必须与“进程已退出”分开

VS Code `chat-view.js:84` 明确持久会话首次启动可能执行迁移和 SessionStart hooks，`:87` 使用 120 秒期限；超时在 `:405` 提示初始化未完成并保留输入，在确认实例身份后停止旧 child。既有 `test/agent-initialization.test.cjs` 本次通过，包含超过旧 15 秒、30 秒后初始化只派发一次，以及超时后迟到 init 不派发。

JetBrains `intellij/ConversationView.java:780` 仍调用 `dispatch.awaitReady(capability, 15, TimeUnit.SECONDS)`；`InputDispatch.java:34` 的 `CompletableFuture.anyOf(...).get(...)` 到期抛 `TimeoutException`。调用端 `ConversationView.java:810` 把 `ex.getMessage()` 作为错误，`:832` 只在非 null 时显示错误；message 为 null 且未发送时，`:842` 显示“agent session is not running — press New to restart”。

本次用生产 `InputDispatch` 与未完成 future 实测 **15,006 ms** 超时，`message=null`、`initDone=false`、`dispatched=false`；之后完成 init，同一共享 future 仍可被新等待读取。这证明“等不到 init”不足以推出“agent 进程不存在”。测试没有启动 IntelliJ、CLI 子进程或模型，不能据此估算真实用户触发率。

应单独处理 timeout、取消、启动失败、旧进程退出未确认，并在面板呈现“初始化仍未完成，草稿已保留”的准确状态。采用有界宽限和 Stop，而不是无限等待；超时后停止/复用/重启须遵守现有 session generation 与退出确认规则。除 30 秒慢初始化外，还要验收永不 init、旧实例迟到 ACK、Stop 与初始化竞态、手动重试只发送一次。

### 5.4 将真实任务验收和工程门分别完成

已有真实宿主矩阵是实际能力，不应说“没有 E2E”；但 `packages/vscode-extension/test/extension-host/driver/streaming-profile.cjs:62` 明确断言 `performanceGate:false`，只能证明采集完成，不能自动认定满足 SLO。JetBrains 的历史 native transcript 指标也将 SLO 保留为未评估，详见[18 条宿主旅程指标](./evidence/96-matrix-metrics.json)。

`.github/workflows/ide-roadmap-accessibility-performance.yml:231`、`:248`、`:259` 的 Orca/NVDA/VoiceOver producer 均写出 `speechQualityAssessed:false`。进程/签名/语义合同不能代替审批内容是否完整朗读、流式重复播报、焦点恢复和 Show more 键盘路径的听测。

冻结计划的 [README](../cli/verify01-plan-2026-10-04/README.md) 与 [COLLECTION_README](../cli/verify01-plan-2026-10-04/COLLECTION_README.md) 明确 **36 个任务 + 9 次首次安装均为 `NOT_RUN`**。只读采集器不会运行 setup/check、模型或 IDE。下一步应按现成计划执行并保留失败、费用 unknown、安装来源和终态，避免再建一套“看起来有结果”的 fixture 统计。

### 5.5 云端能力按连续工作合同评估

`packages/cli/src/lib/execution-location-contract.js:353` 的 Cloud profile 为 `executor:self-hosted-handoff`，`:357` 明确 `resume:not-implemented`；`packages/cli/src/commands/cloud.js:2` 起实现 bundle → submit → status/attach → 本地产物回流。已有 IDE `/handoff` 主要将会话交给 detached background agent，与完整云端会话迁移不是同一能力。

若产品需要像 Codex 云任务那样断开 IDE 后继续、跨机器恢复，再补 job/session 身份映射、断线重连、审批交接、取消确认及产物冲突处理。可以先完善“此位置支持启动/恢复/回流到什么程度”的提示；不必为了对标复制供应商账户或计费控制面。

## 六、不建议复制的增量

| 上游能力或变化                     | 本项目处置                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------- |
| 更多 agent、workflow、session UI   | 复用现有 runtime 与 Workbench；先统一状态、恢复和停止语义                  |
| 一律升级到最新 CLI 才能打开面板    | 按 capability 降级；基础最低版本、推荐配对、实际运行能力分别展示           |
| 云端、语音、主题、Mods 的全部 UI   | 先确认本项目场景和维护成本；竞品版本更新不构成需求证据                     |
| 自动重试未知输入或后台任务         | 保留 durable receipt 与未知状态，不以“体验连续”交换重复副作用              |
| 用测试数量或功能数量比较编码成功率 | 使用冻结实际任务、失败归因、费用及维护工时；目前没有足够样本给出成功率排名 |

## 七、审计附录

### 7.1 本次执行与结果

环境为 Windows、Node **22.22.2**；纯 Java 探针用本机 JDK **17.0.17** 编译 SDK-free 生产类，不代表 JetBrains Java 21/真实宿主构建验收。

| 验证                                                                                           | 结果                                                                        | 证明范围                                                 |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `vscode-ext-chat-tabs/mode/images`、`vscode-ext-draft-store`、`vscode-ext-image-decode-budget` | 5 文件，**97/97**                                                           | 旧缺口相关现有单测与生成 Webview/预算合同                |
| `vscode-ext-transcript-sync`、`vscode-ext-streaming-transcript`                                | 2 文件，**17/17**                                                           | canonical 增量同步、选区/滚动保持、流式文本与草稿 ACK    |
| VS Code runtime compatibility / version / doctor / initialization                              | 4 文件，**15/15 TAP tests**                                                 | 含 Doctor 脚本内部 8 条 assertions；不另累计成额外测试数 |
| JS 生产函数与 ChatView 探针                                                                    | 版本就绪分歧、GCC 宽松解析、无 receipt init 的降级发送均观察到              | 注入 transport/store，未执行旧公开 CLI 或付费模型        |
| Java 生产类探针                                                                                | GCC 版本抽取/Doctor 分歧；15 秒 timeout 的 null message；迟到 init 仍可读取 | 无 IntelliJ SDK/GUI，无真实 CLI child                    |
| Actions 与公开版本                                                                             | 只读在线查询，见 1.2 和统一证据                                             | 不重新触发工作流，不发布                                 |
| 真实 IDE 新旅程 / 真人听测 / 付费模型                                                          | 本次未执行                                                                  | 不能由上述 129 项既有测试推定通过                        |

两组 Vitest 总计 **114**，Node TAP **15**，合计 **129** 通过。Java 临时探针首次因 Windows 默认 GBK 编译读取 UTF-8 源码失败；显式 `javac -encoding UTF-8` 后执行成功，属于探针运行配置修正，未改生产源文件。

可重复执行的既有测试：

```powershell
# 工作目录 packages/cli
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/vscode-ext-chat-tabs.test.js __tests__/unit/vscode-ext-chat-mode.test.js __tests__/unit/vscode-ext-chat-images.test.js __tests__/unit/vscode-ext-draft-store.test.js __tests__/unit/vscode-ext-image-decode-budget.test.js --reporter=dot
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/vscode-ext-transcript-sync.test.js __tests__/unit/vscode-ext-streaming-transcript.test.js --reporter=dot

# 工作目录 packages/vscode-extension
node --test test/runtime-compatibility.test.cjs test/cli-version-check.test.cjs test/ide-doctor.test.cjs test/agent-initialization.test.cjs
```

### 7.2 新增验收矩阵

| 场景           | 最低验收要求                                                                            |
| -------------- | --------------------------------------------------------------------------------------- |
| CLI 身份与版本 | 只有 gcc、显式错路径、缺失、managed fallback、公开配对、基础旧版本分别有准确结论        |
| Runtime 降级   | 无 receipt 或 mode ACK 时，Doctor/状态栏/发送状态一致；未知接受状态不自动重发           |
| 冷启动         | 30 秒 init、永不 init、提前退出、Stop、迟到 init、显式重试；两 IDE 同一语义与零重复派发 |
| 最新模型       | 同一 profile 驱动 provider、协议、窗口、费用和 unknown 提示；真实账号验收单列           |
| 公开安装       | 记录 registry/市场版本、包摘要、CLI 配对与干净 profile；不能用源码包替代市场安装        |
| 辅助技术       | 真人走审批、问题草稿、历史展开、Stop、恢复与流式通知，记录技术/版本/OS/结果             |
| 性能与真实任务 | 固定硬件与 SLO、实际模型与项目、安装失败、成本及任务终态；保留失败与未执行项            |

### 7.3 来源与置信度

源码调用链、局部探针与既有回归为高置信度工程证据；真实宿主新问题仍需相应环境复现。官方 changelog 证明上游宣告的产品变化，不证明本项目必然存在同根因缺陷，也不证明任何产品在本仓库任务上的成功率更高。公开端点与 Actions 为查询时点事实，最终发布和新提交须重新核验。

## 八、最终判断与实施顺序

建议先修 **JetBrains 身份误判和冷启动错误分类**，同步把 **Doctor 与实际能力状态统一**；这三项可直接减少首次使用和恢复流程中的误导。随后完成最新模型共享目录与当前正式发布门，并利用已经冻结的计划执行真实双 IDE、公开安装、辅助技术和性能验收。Cloud 连续恢复、Bookmarks、语音等新增体验放到需求明确后的 P2。

项目已有丰富的恢复、治理和双 IDE 基础；当前更有价值的优化，是让源码实现、用户看到的状态、公开可安装版本与已验收范围保持一致。
