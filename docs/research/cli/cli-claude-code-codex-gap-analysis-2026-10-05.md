# ChainlessChain CLI 对照 Claude Code / Codex 最新版本的差距与优化分析（2026-10-05）

> **2026-10-08 最终候选修正**：旧 CLI CI #37779105012 的 Windows/macOS 失败已定位到测试临时目录别名；fixture 现使用 canonical realpath，并新增真实 symlink/junction 父目录拒绝回归，生产严格检查未放宽。两 Node 版本各37项通过，最终准确 SHA 全矩阵待执行。 私有 esbuild leaf 按去除 EOF 空行后的最新源码重编译并真实实跑 v3，成功和未入 Job 清理负例均成立；[最新字节与状态](../cli-ide-gap-validation-2026-10-05.md#183-最终源码字节重新验证)仍保留 NOT_ADMITTED，正式36+9和人工/账户验收仍开放。配对候选为 CLI `0.166.94` / VS Code `0.37.139` / JetBrains `0.4.157`；通过完整发布门后按授权发布。

> **2026-10-08 私有 leaf 与发布准备**：独立非管理员监督器已在零capability AppContainer内让冻结esbuild真实bundle成功，源码/真实负例与61项合同已固化；完整service/config/default forks/review仍未接入，状态NOT_ADMITTED。用户授权测试成功后配对发布，候选CLI`0.166.94` / VSCode`0.37.139` / JetBrains`0.4.157`，10个固定子包下载/依赖核验完成，Doctor推荐值构建残留也已修复。本机CLI/IDE相关回归和插件ZIP构建通过，最终准确SHA完整门待执行；见[验证第18节](../cli-ide-gap-validation-2026-10-05.md#18-2026-10-08-私有-esbuild-leaf-与发布候选)。durable后端、正式36+9、官方账单和人工长时验收继续开放，无付费模型请求，尚未发布。

> **2026-10-08 设置锁与 esbuild 启动续做**：用户指出的Windows Strict并发设置锁失败已在`91924f202e`修复，原两秒期限/ownership保留；Windows/Linux x64/ARM64/macOS15及额外macOS latest五job完整成功；CLI CI仍待完成。独立esbuild leaf在`fd713e0e72`已启动并取得11条API记录，祖先打开仍Win32 5，完整config/default forks/review开放。定向回归两Node版本各136通过/1 Linux专属跳过，真实四进程两系统各240次写入无丢失/重复；本机完整失败保留。见[验证第17节](../cli-ide-gap-validation-2026-10-05.md#17-2026-10-08-设置锁公平性与-esbuild-启动取证)。Windows/macOS durable、正式36+9、官方账单与人工长时验收仍开放，无付费请求或发布。

> **2026-10-08 Worker/锁/GNU 续做**：修复 Linux CI 的 Worker 结算竞态和严格锁释放争用；Windows 74 通过/1 Linux 专属跳过，Linux Node 22.12.0 为 75 全通过。冻结 GNU Rollup addon 通过独立 41 项 N-API forwarder 在零 capability AppContainer 中完成同步/异步解析、哈希及负例，36 项合同通过，仍为 `NOT_ADMITTED`。完整 esbuild/config/default forks/native review、Windows/macOS durable 后端和正式 36+9/官方账户账单/人工长时验收继续开放。当前结果见[验证第 15 节](../cli-ide-gap-validation-2026-10-05.md#15-2026-10-08-worker-结算锁释放与-gnu-工具链)，下方历史记录保留各自时点。

> **2026-10-08 NUL 与后代继承续做**：独立实验 v3 已在真实零 capability AppContainer 中验证 `\Device\Null`、两层受控 Node 后代、三个并发 child、精确句柄白名单和不支持启动的拒绝；六个进程、十二份 phase 回执与清理完整。结果校验新增 childErrors 门禁，最终 **517 项 Node + 3 项原生传输 + 52 项 Vitest = 572 项通过、零跳过**。冻结 config 的新实际失败是 esbuild 报告祖先目录读取被拒，尚未进入 worker pool；v3 只接纳受控 Node，不能关闭 esbuild/config/full review。证据、构建范围与未完成条件见[验证第 14 节](../cli-ide-gap-validation-2026-10-05.md#14-2026-10-08-nul-设备与精确后代继承)。正式 36+9 仍 `NOT_RUN`，未新增付费请求或发布；以下各轮记录保留其历史时点。

> **2026-10-08 实验 runtime 续做**：独立 Windows 管道 v1 与私有规范路径 v2 适配器已在真实零 capability AppContainer 中完成同步、异步、fork IPC、子进程回执及清理验证；冻结 Vitest/Vite/happy-dom 导入和原 globalSetup/teardown 均已通过。未修改冻结包或原七项能力结果，整包仍 `capabilities={}`。本轮 **391 项 Node + 3 项原生传输 + 52 项 Vitest = 446 项通过、零跳过**，构建与失败原件摘要已归档。NUL、冻结 forks/config/full review、durable 后端及正式 36+9 仍未关闭，详见[验证第 13 节](../cli-ide-gap-validation-2026-10-05.md#13-2026-10-08-独立实验-runtime-与冻结-setup)。

> **2026-10-08 继续实施**：补齐冻结 registry 工具链准备和独立 Windows v2 胶囊：191 包、8,369 文件、111,823,724 字节；81 文件/12 MiB 原生传输、写入拒绝、篡改与未列出文件拒绝均通过，v1 的 64 文件/8 MiB 边界保留。本轮 **208 项回归通过、零跳过**。实际导入确认仍有运行时缺口：Rollup 顶层默认管道调用阻塞，冻结 globalSetup 的 native realpath 返回 `EPERM`；三个 addon 均已观察，Parcel/MSVC 加载成功、GNU 失败，整套 ABI 不标为通过。详见[验证第 12 节](../cli-ide-gap-validation-2026-10-05.md#12-2026-10-08-冻结原生工具链与-appcontainer-胶囊)。完整 native review、Windows/macOS durable 后端、正式 36+9、官方账号/账单与人工验收继续开放；本轮未发布。

> **2026-10-07 原生评测续做**：七个能力探针已改为各自的一次性 AppContainer/Job，完成原先未观察的 IPC。真实 Windows 10 / Node 22.22.2 结果为四项支持、file stdio `EPERM`、pipe/IPC 各自超时，七项清理均确认，整包 `capabilities={}`；未扩大隔离权限或期限。补齐 v2 证据/宿主/runtime 校验、原准入兼容及冻结 lock/setup 的只读工具链 inventory，共 **68 项回归通过、零跳过**。详见[验证第 11 节](../cli-ide-gap-validation-2026-10-05.md#11-2026-10-07-独立原生探针与工具链预检)。完整 native 工具链执行、Windows/macOS durable 后端、正式 36+9、账单与人工/长时验收仍未完成；inventory 不授予执行权限。

> **2026-10-06 原生 review 准入与 CI 修复**：新增 Windows 后端的只读逐题准入及固定能力探针，保留冻结 Windows 的 12 个任务与原分母；不完整探针不授予能力。真实零 capability AppContainer 的逐阶段记录定位到管道 stdio 卡住，文件 stdio 返回 `EPERM`，15 秒 watchdog 与空 Job 清理成立；完整 native review 仍 `NOT_READY`。安全映射的过期生产者摘要已在 `d558e6c71e` 修正，`266718e8b5` 的 Strict/Safety 完整工作流已成功，含三系统、ARM64、附加 macOS 与 Safety 汇总；另已提交 PDH 安装隔离与迁移夹具修复。工程测试、失败材料及后续条件见[验证记录第 10 节](../cli-ide-gap-validation-2026-10-05.md#10-2026-10-06-原生-review-准入与-actions-修复)。新改动须以自身准确提交的 Actions 验证，正式 36+9 仍未运行。

> **2026-10-06 公开包与原生沙箱续做**：公开 npm CLI `0.166.90` 已在隔离 profile 中用火山完成真实写入/读回；补齐 registry lock 身份校验。Windows 原生执行期限与一次性只读 staged CJS 检查器已实现，5 文件 **360/360** 回归通过，旧失败和源码/二进制摘要均归档。公开 VS Code `0.37.135` 与 JetBrains `0.4.153` 的真实工具任务和重启恢复也通过，修复模式启动前校验与合法 `system/end` 被误判的采集器缺陷。范围及费用 unknown 见[验证记录第 9 节](../cli-ide-gap-validation-2026-10-05.md#9-2026-10-06-公开安装与-windows-原生检查器)。完整 native36、Windows/macOS durable 后端、官方账号/账单、正式 36+9 与人工/长时验收仍开放，不将诊断写入正式 observations。

> **2026-10-06 本轮续做**：已回读并归档 Linux x64/ARM64 显式进程恢复矩阵（各 31/31）与双 IDE 六宿主矩阵。按用户授权使用火山 `deepseek-v4-flash-ga-260731` 完成两轮共 24 个校准请求、两轮压缩及只读工具轨迹的 6 个请求，合计 30 次实际调用，usage 对应估算费用 **$0.01506344**。修复采样的正文超时、部分失败回执丢失，并记录实际输出超过请求限制；15 项回归通过且接入三系统 CI。原始回执、准确源码范围及剩余任务见[续做记录第 8 节](../cli-ide-gap-validation-2026-10-05.md#8-2026-10-06-ci-回读与火山真实采样)。正式 36+9、官方新模型矩阵、账单、Windows/macOS durable 后端、真人听测与长时观察仍未完成；以下正文保留原审计时点。

> **2026-10-06 继续实施**：补齐 BRIDGE-02 的显式 Linux `agent process-ownership status/recover` 入口，复用可信 cgroup 身份与持久清理回执；IDE 宿主诊断新增跨平台身份旅程和真实 IntelliJ 冷初始化采集，工程回归与实际宿主结果见[续做验证第 7 节](../cli-ide-gap-validation-2026-10-05.md#7-2026-10-06-剩余工程接线)。后续配对发行已为 CLI `0.166.90` / Open VSX `0.37.135` / JetBrains `0.4.153`，公开版本及标签源码见[最新发行回读](./evidence/documentation-release-status-2026-10-06-final.json)。Windows/macOS durable 后端、正式 36+9、账户账单、真人听测与长时观察仍开放；以下正文保留原审计时点。

> **Actions 修复续做（2026-10-06）**：`6196cd065d` 的 Docker 六分片已完整通过：36/36 题、42 个行为反例全部检出，精确源码校验器保持严格。`4f2c19281c` 的流式采集有界期限、可见性、逐案例诊断与取消清理已接通，但 Windows/macOS 的 warmup 校验暴露了已有光标导致诊断选区未建立的问题。真实 Chromium 已复现，修复先清除旧 range，再建立并核验真实目标选区，结束后恢复原状态；原采样和断言合同保留。新准确提交仍须全系统 CLI 双门与完整 IDE 宿主矩阵，候选尚未发布。详见[续做验证记录](../cli-ide-gap-validation-2026-10-05.md)；正式 36+9、账号账单及人工验收仍开放。

> **本轮发行（2026-10-05）**：CLI `0.166.88` 已通过 GitHub Actions OIDC 发布，VS Code `0.37.133` 已在 Open VSX 公开，JetBrains `0.4.151` 已公开上架。三项标签源码固定为 `7db17a12e1`，准确提交完整门及公开回读见[发行证据](../cli/evidence/gap-2026-10-05/release-0.166.88/README.md)。36+9 仍为 `NOT_RUN`，真实验收状态不因发布改变。

> **最新续做**：显式 Linux `agent controlled-host`、IDE prepare/finish 与双宿主驱动已接通。准确工程提交 `f289a08844` 的官方 MCP stdio/HTTP/GET-SSE 三系统 CI 和双 IDE 六宿主矩阵全部通过，原始协议、UI 与退出证据已归档。IDE 诊断允许有界回收并核验进程消失，逐平台退出方式见[实施记录第 13 节](../cli-ide-gap-implementation-2026-10-05.md#13-真实矩阵反馈与退出生命周期)。候选 CLI `0.166.89`、VS Code `0.37.134`、JetBrains `0.4.152` 尚未发布。正式 36+9 样本保持 `NOT_RUN`；账号账单、公开安装、人工验收及 Windows/macOS durable 后端仍开放。

> **本次续做**：在 `4f12030641` 之后补齐 IDE 任务的 prepare/finish 执行器、完整基线/diff 与 reviewed setup/check 回执接线，接入双 IDE 面板采集驱动，并完成官方 MCP stdio/HTTP 的本地真实进程补验。最新验证、尚缺的实际环境与验收项见[实施记录第 11 节](../cli-ide-gap-implementation-2026-10-05.md#11-实际宿主采集与验收执行接线)。下列原始审计及前几轮发布记录保留其各自时点含义。

> **后续实施（2026-10-05）**：模型合同与目录审查、Memory 查询索引、Codex 0.160.0 协议探针、MCP 参考服务端互操作及 IDE 修复已落地；其余执行接线、真实验收与平台边界见[本期实施状态与证据](../cli-ide-gap-implementation-2026-10-05.md)。以下正文保留原审计快照，“当前缺失”与行号均指原基线，不能视作实施后的现状。按用户要求，后续修改已转到 `main`。

> **本轮工作区补充**：增加覆盖全部 36 题的 setup/check 生成器（72 个自包含脚本、42 个源码行为反例）、双 IDE 原始协议观察接口及首次安装/宿主证据只读导入器。工程验证和限制见[实施记录第 9 节](../cli-ide-gap-implementation-2026-10-05.md#9-本轮验收工程补充)。当前仍无正式任务 observations，36+9 保持 `NOT_RUN`。native 六目标 unsigned 验证已有独立历史回执，不能再将 Windows ARM64 描述为始终未通过，详见实施记录。用户最新已授权提交发布，发行结果及准确提交验证见实施记录第 10 节；正式验收状态不因发布改变。

> 审计日期：2026-10-05（Asia/Shanghai）。
>
> 代码基线：`8b13129624d4b7fa5b122a4109151c574564448e`；CLI 源码版本 `0.166.86`。审计开始时，共享实施状态文档已有工作区修改，本次只读取，不覆盖。源码版本不代表已公开发行。
>
> 官方最新版本核对：Claude Code `2.1.289`（2026-10-03 23:07:17 UTC 发布，即北京时间 10-04）；Codex CLI `0.160.0`（2026-10-01）。本轮新增模型重点为 Claude Sonnet 5.5、GPT-6.1 Sol；具体增量见第 2 节。
>
> 格式参照：[2026-09-27 CLI 分析](./cli-claude-code-codex-gap-analysis-2026-09-27.md)。配套：[2026-10-05 IDE 分析](../ide/ide-claude-code-codex-gap-analysis-2026-10-05.md)。历史完成情况以[实施状态总表](../cli-ide-gap-implementation-2026-09-27.md)及其绑定的提交为准。
>
> 本文为代码审计、局部验证与改进建议；未修改产品代码、调用付费模型或执行发布。

## 1. 复核后的结论

当前主要不足已从“缺少基本 Agent 能力”转为**模型更新传播速度、已实现能力的实际接入、规模化查询，以及真实用户任务的验证闭环**。09-27 报告中的不少具体反例已修复，不能直接复制为本期问题。

本轮最明确的新增问题是：**GPT-6.1 Sol 尚未进入模型目录，当前被路由到 Chat Completions / 128K；Sonnet 5.5 仍按 200K 和旧 Sonnet 价格估算。** 两者都可以在不调用模型的情况下，从当前纯函数直接复现。官方 GPT-6.1 Sol 工具调用需要 Responses；Sonnet 5.5 的标准价格已是 `$2/$10` 每百万输入/输出 token，当前通配仍为 `$3/$15`。这说明上一轮补齐模型后的更新机制仍主要依赖手工追赶。

另有四组持续存在、需要继续投入的问题：

1. **canonical Memory 的容量问题已缓解，列表和检索成本仍随全库增长。** 分片、点读、100K 三系统容量验收已经有证据；业务列表的 `limit` 没有下推，当前全量查询的历史实测仍为秒级。
2. **真实项目评测尚有工程接线缺口。** 36 项任务、9 次首次安装已经冻结并有只读准入校验，但 `cc eval --suite` 只支持 `builtin`；实际 setup/check、执行回执与双 IDE 终态采集仍未接通，不能全部归因于等待账号。
3. **网络撤销与外部 Agent 的支持范围明显小于模块数量所暗示的范围。** Linux 受控宿主已完成持久权限接线和真容器场景；默认 CLI、Windows/macOS 尚未取得同等交付。外部 Claude/Codex 编排仍因逐请求治理证据不足被拒绝，这是正确的边界，也构成尚未交付的能力。
4. **最新上游协议验证落后于上游发行。** Codex App Server 已修复 camelCase、thread/turn 归属和取消终态；但固定协议探针仍为 `0.157.1`，默认实验兼容白名单最高 `0.154.0`，不能把这些证据直接移用于 `0.160.0`。

### 1.1 判断口径

| 标记             | 含义                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| 本次复现         | 当前源码上的纯函数或局部探针出现可重复结果；不是已观察的真实 API 故障 |
| 静态确认         | 已跟踪代码、调用关系及拒绝条件，尚未完成目标宿主/账号旅程             |
| 历史准确提交证据 | 读取仓库归档回执；只适用于其中绑定的源码和环境，不视为本次重跑        |
| 已实现，待验收   | 实现存在，缺真实 provider、账单、规模效果或完整宿主验证               |
| 建议新增         | 本文提出的工作及验收标准，不是已经取得的结果                          |

本次未证明生产权限绕过、Memory 数据丢失或真实模型调用失败；以下安全工作保留 fail-closed，不以移除治理检查换取功能可用。

## 2. 版本段增量审计

本节区分 CLI 版本、模型版本和实验协议支持，不推测未核实补丁的内容。

| 上游版本段                                        | 本次官方核对结果                                                                                                                                                                                                                  | 对本项目的影响                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Claude Code `2.1.284`                             | 新增 Claude Sonnet 5.5；模型 ID `claude-sonnet-5-5`，1M 上下文，标准价格 `$2/$10` 每百万输入/输出 token                                                                                                                           | 新增 MODEL-03：精确模型 profile 与价格，避免继承旧 Sonnet 通配                               |
| Claude Code `2.1.285`～`2.1.286`                  | 修复进程 setup 阶段的取消、PowerShell 解析失败时 deny/ask 行为；并行工具批次崩溃后的恢复；全模型调用统一重试预算                                                                                                                  | 作为本项目取消、权限解析失败、恢复和总重试预算的新负向用例；不是本项目已被证实的缺陷         |
| Claude Code `2.1.287`～`2.1.289`                  | Mods 默认开启；修复零 usage 压缩、resume 的压缩上下文/末条答复、MCP 超大/坏 JSON 结果被重执行、流中超时的 partial continuation、Hook 失败阻断及 Bash 环境变量前缀/裸赋值的 deny/ask 行为                                          | 优先核对恢复/不重放与权限合同；Mods 的无沙箱、部分覆盖 deny 语义不宜照搬                     |
| Codex CLI `0.158.0`～`0.159.0`                    | MCP 预注册 OAuth secret、exec-server WebSocket bearer、elevated 终端输入审批；修复嵌套 writable roots/Git 元数据保护；增加 opt-in instant interrupt、按 item 分页的 thread 历史、空会话草稿，保留显式文件 deny 和 `.aws` 默认保护 | 对照现有 MCP、执行权限和 session 入口增加合同；不能仅因上游修复就推导本项目存在同样漏洞      |
| Codex CLI `0.159.1`（2026-09-29）                 | GPT-6.1 Sol 进入默认模型目录                                                                                                                                                                                                      | 新增 MODEL-03：Responses 工具路径、1,050,000 窗口、reasoning 约束及逐型号计价                |
| Codex CLI `0.159.2`～`0.160.0`（最新 2026-10-01） | uncertain 提交解消后恢复未发送队列并防重复；显式 provider 目录不混入不支持的内置模型、刷新失败不使用陈旧目录；Windows 控制台/长路径、SQLite 启动诊断与等待、插件 manifest 缓存及 HTTP 复用改进                                    | 将模型目录漂移、未知提交后的恢复、启动性能纳入现有主路径；固定协议探针先升级，不能只改白名单 |
| GPT-6.1 Sol 模型合同                              | 1,050,000 context、128,000 max output；工具调用使用 Responses；reasoning 支持 low/medium/high/xhigh/max，不支持 none/minimal；标准输入/缓存读/缓存写/输出为 `$2/$0.10/$2.50/$10` 每百万 token                                     | 当前目录缺项；缓存读为输入价的 5%，不能原样复用当前 GPT-6 的 10% 缓存读系数                  |

来源：[Claude Code changelog](https://code.claude.com/docs/en/changelog)、[Codex changelog](https://developers.openai.com/codex/changelog)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。本报告不据版本号比较模型编码正确率。

## 3. 已确认覆盖的能力

| 旧问题 / 能力                          | 当前源码或证据                                                                                                                                        | 本轮判断                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GPT-6 Astra/Sol/Luna、Opus 5.5 profile | `packages/cli/src/lib/model-context-catalog.js:96,109,135`；`model-capabilities.js:150,199`                                                           | 上一轮模型条目已补齐；本轮问题是更新后的 GPT-6.1 / Sonnet 5.5，不能重开同一缺项       |
| 定价来源统一、unknown 语义             | `packages/cli/src/lib/llm-pricing.js:190,248`；`token-tracker.js:32`                                                                                  | 已统一主要价格入口，并保留 unpriced；新 Sonnet 的家族通配问题仍存在                   |
| 外部编排就绪信息                       | `packages/cli/src/commands/orchestrate.js:54,75,79`；`agent-router.js:535`                                                                            | 已明确 installed、governanceAdmitted、runnable 与 blockedReason，09-27 帮助误导项已修 |
| Codex App Server 通知和终态            | `packages/cli/src/lib/codex-app-server-adapter.js:33,80,204`                                                                                          | camelCase、交错 turn 和未知工具终态已有合同；本轮适配器/官方 schema 定向测试通过      |
| MCP HTTP 404 恢复                      | `packages/cli/src/harness/mcp-client.js:3528,3551`                                                                                                    | 已重初始化连接，结果未知的工具不自动重放；本轮真实 loopback 合同通过                  |
| Linux 域名强制出口                     | `packages/cli/src/lib/agent-sandbox.js:355,388,509`；[ARM64 真容器回执](./evidence/net02-docker-arm64-22c0e4036c.json)                                | 已有 Docker egress 实现和限定验收，不能继续写成“没有任何不可绕过后端”                 |
| canonical Memory 容量                  | `packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js:136,553`；[三系统 formal](./evidence/persistent-capacity-matrix-b2aa3aba08.json) | 分片、点读、1K/10K/100K 并发读改删已有证据；二级查询索引仍缺                          |
| 后台任务分页 / 平台探针                | `packages/cli/scripts/persistent-capacity-benchmark.mjs:759`；`.github/workflows/cli-strict-sandbox.yml:385,426`                                      | 后台索引/分页、macOS latest 能力探针已补，不沿用旧“尚未测量/未探测”结论               |
| runtime 拆分                           | `packages/cli/src/runtime/agent-core.js:31` 引用 `provider-stream-state.js`                                                                           | 已抽出 provider stream 状态和 usage 归一化；后续保行为拆分仍可继续                    |

## 4. 建议任务与真实优先级

### 4.1 P0：只对扩大支持声明或正式发布设置前置条件

| ID                 | 当前事实                                                                         | 需要保留的前置条件                                                        | 验收                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| NET-02 / BRIDGE-01 | durable 网络权限只由显式 Linux 受控宿主启用；外部 Agent 仍未获逐请求模型治理准入 | 宣称跨平台持久撤销、外部 Agent 可安全执行前，先取得对应真实执行证据       | 固定 authority、跨进程撤销、活跃 HTTP/WS 关闭、后代回收和 ACK 均绑定实际会话；未知执行结果不自动重跑 |
| RELEASE            | 源码版本、历史完整 CI、公开包版本不是同一事实                                    | 沿用准确 release commit 的 CLI CI + CLI Strict Sandbox 全矩阵及 OIDC 发布 | 子 npm 包按依赖先发布并可 fetch，之后 CLI，最后 IDE；不得沿用旧 SHA 的成功门或改用本地 npm token     |

没有证据支持把本轮新增模型目录遗漏直接上升为生产安全 P0。它首先是协议兼容与计费正确性的 P1。

### 4.2 P1：模型正确性、真实使用路径与验证接线

| ID                                | 差距与证据                                                                                                         | 建议                                                                                              | 完成标准                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| MODEL-03（新增）                  | GPT-6.1 Sol 回落 Chat Completions/128K/unpriced；Sonnet 5.5 回落 200K/旧价，见第 5.1 节                            | 为两者增加精确、带官方来源/日期的 profile；独立定价 terms；验证 reasoning 与输出上限              | 纯函数合同、stream/tool/reasoning 往返、usage/预算均一致；官方 endpoint 与自定义网关分开；未知型号不得默继承旧家族价格  |
| MODEL-04（新增）                  | catalog 版本仍为 `2026-09-27`，上游新模型未进入；已有 117 项相关局部测试照样通过                                   | 加入模型目录更新审查：上游新型号生成待审差异，保留精确 fixture 与变更来源，不自动启用未经验证型号 | 对已声明支持的模型，协议、窗口、reasoning、缓存/长上下文/服务层级和各计费消费者有同一份合同；新型号遗漏可在 CI 中被看见 |
| VERIFY-02（VERIFY-01 的工程子项） | `getSuite()` 只接受 builtin；36 项计划缺实际 setup/check 与执行/终态采集                                           | 复用现有 `runEvalSuite`、outcome schema 和只读准入器补受审查的真实任务入口，分离执行者与验收者    | 不付费先完成 fixture 接线、独立负例和实际终态导入；随后才运行获授权 provider/双 IDE/首次安装样本；36+9 固定分母不变     |
| PERF-03（PERF-01 后续）           | `memory-service.js:406` 取全库后 filter/slice；父类 `listRecords()` 再全量 sort                                    | 为 category/scope/state 和稳定排序设计可验证二级索引、游标分页及失效重建；保留现有一致快照与 CAS  | 同数据对比全扫/冷索引/热索引/重建，覆盖 1K/10K/100K、并发更新/删除及审计完整性；批准 SLO 后才作为 gate                  |
| PLATFORM-02                       | 默认 CLI 未自动注册 durable host；Windows/macOS provisioning 明确 unsupported；native Windows ARM64 旧准确门仍失败 | 用户可见地给出 OS/架构/引擎/stdio/权限来源支持组合；先完成一个目标入口的正式交付                  | 每项支持声明绑定真实宿主；缺后端准确拒绝；native 原始超时与断言不通过扩大 timeout 或删除样本隐藏                        |

### 4.3 P2：持续兼容、恢复和维护成本

| ID        | 当前边界                                                                                      | 建议与验收                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| CODEX-02  | 默认 adapter 白名单最高 `0.154.0`；协议 CI 固定 `0.157.1`，而最新 CLI 为 `0.160.0`            | 先更新固定 schema/真进程探针、双 thread 交错和审批取消负例，再评估是否扩大准入；保持实验模块可移除及生产治理门    |
| BRIDGE-02 | Linux ownership journal 已持久化；`process-ownership-quarantine.js:75` 仍 `restartSafe:false` | 补可信恢复解除与异常后代实际回收方案；不能以 PID 不存在、重启、过期或删除记录当作清理证明                         |
| PERF-02   | token 估计仍使用 UTF-8 bytes/4；已有单模型真实 usage/双轮压缩证据                             | 按中文、代码、emoji、工具 schema 和多 provider 校准，并测事实保真和真实任务成功率；不能仅据估算断言溢窗           |
| MCP-02    | HTTP 404 合同已补，目标 MCP 服务端互操作未闭环                                                | 复用现有恢复测试跑固定版本真实服务端，区分“连接重建成功”和“工具终态已知”；保持不重放副作用                        |
| MAINT-02  | runtime 拆分已有进展，仍有跨模块合同维护压力                                                  | 以真实变更触及的独立实现数、回归时间和维护工时衡量拆分收益；优先模型合同、权限权威、provider transport 的清晰边界 |

## 5. 本期无需等待即可完成

### 5.1 新模型合同与价格复现

未设置用户覆盖时，当前纯函数结果如下，详见[本轮审计回执](./evidence/cli-ide-gap-audit-2026-10-05.json)；未发送 API 请求：

| 输入                                  | 当前协议 / 窗口                                | 当前价格                              | 官方合同差异                                                                             |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `openai / gpt-6.1-sol`                | Chat Completions / 128,000；provider-default   | unpriced，`matched:false, free:false` | 应按该型号使用 Responses 工具协议、1,050,000 context、128,000 max output，并加入精确价格 |
| `anthropic / claude-sonnet-5-5`       | Anthropic Messages / 200,000；provider-default | `$3/$15`，pattern=`sonnet`            | 官方 1M context、标准 `$2/$10`；普通未缓存请求被高估 50%                                 |
| `openai / gpt-6-sol`（对照）          | Responses / 1,050,000                          | `$2/$10`                              | 上轮修复已生效                                                                           |
| `anthropic / claude-opus-5-5`（对照） | Anthropic Messages / 1,000,000                 | `$4/$20`                              | 上轮修复已生效                                                                           |

Sonnet 5.5 示例：1,000 input + 100 output token，当前估算 `$0.0045`，按新的标准基础价应为 `$0.003`。该例不含缓存、服务层级或长上下文溢价，不是已核对的账号账单。

定位：`packages/cli/src/lib/model-context-catalog.js:48,87,134` 缺新型号；`model-capabilities.js:150,179,199` 决定 fallback；`packages/cli/src/runtime/agent-core.js:12108` 将 profile 用于真实 transport 分支。`llm-pricing.js:57` 保留 Sonnet 家族通配；`:202` 的未知新型号保护目前针对 Opus，没有覆盖 Sonnet。

不能简单把 GPT-6.1 Sol 加入 GPT-6 数组后结束：`model-context-catalog.js:148` 的 `GPT6_PRICING_TERMS.cacheReadMultiplier` 为 `0.1`，新型号官方 `$0.10/$2=0.05`。还需覆盖 >272K 的全请求阶梯、Fast/Batch/Flex、区域处理和 reasoning 允许值。建议逐型号引用 terms，继续从统一价格函数投影到预算、usage、Eval，避免重新引入多表分叉。

现有显式窗口覆盖能调整规划窗口，但不改变 GPT-6.1 Sol 的 transport 选择。价格覆盖也并非完全无效：可以覆盖基础输入/输出价；但 `llm-pricing.js:145` 的 `mergePricing()` 不保留新条目传入的 terms，只映射 match/in/out 等基础字段。例如给 GPT-6.1 Sol 配置 `$2/$10` 和缓存读系数 `0.05`，单请求 **100,000** 缓存读 token 仍按通用 OpenAI `0.5` 系数估为 **$0.10**，官方标准价应为 **$0.01**；该样本低于 272K 阶梯，避免混入长上下文溢价。因此需要给完整 terms 增加受校验的配置合同，不能把手工改基础价格当作全面修复。现有 session/team 预算会阻断 unpriced usage，本轮不据零值占位推断预算绕过。

### 5.2 Memory 的 limit 没有降低全库工作量

在内存夹具中，调用实际 `CliCanonicalMemoryService.prototype.list()`，传入 `limit:1, category:'general'` 和 10,000 条记录：返回 1 条，但 category getter 被读取 10,001 次（10,000 次筛选 + 1 次输出），底层 `listRecords()` 没有收到任何参数。

该探针只证明筛选和截断顺序，不作为磁盘性能结果。真实调用链为：

```text
CliCanonicalMemoryService.list(limit/category)
  → memoryPort.listRecords()                # 尚未下推筛选/分页
  → DurableJsonMemoryPort.listRecords()
  → SegmentedMemoryPort.query()             # 读取全部分片快照
  → 全量过滤、排序
  → 业务 category 过滤、slice(limit)
```

定位：`memory-service.js:406`、`durable-memory-port.js:295`、`segmented-memory-port.js:560`，均在 `packages/cli/src/lib/context-memory-kernel/`。全量快照先在锁内捕获字节，再在锁外校验，已经降低持锁校验负担；不能描述为“全部 JSON 校验都在锁内”。

历史 `b2aa3aba08` formal 的 100K 点读 p95 为 Linux/Windows/macOS `25.471 / 41.066 / 51.396 ms`，全 query p95 为 `5.962 / 7.498 / 8.294 s`。该结果不能外推为所有硬件或本次 HEAD 的性能。完整 ID 删除已在 `memory-service.js:572` 先点读，不能再次把删除流程写成必然全扫。默认 cutover 仍是 shadow（`authority.js:26`）；本节范围是 canonical Memory，不能将其全部性能归因于默认 legacy 路径。

### 5.3 固定评测计划尚不能由现有 suite 入口执行

调用实际 `getSuite('verify01-plan-2026-10-04')`，得到：

```text
unknown eval suite: "verify01-plan-2026-10-04" (available: builtin)
```

定位：`packages/cli/src/lib/eval/tasks.js:637`；CLI 在 `packages/cli/src/commands/eval.js:384` 使用该入口。已有通用 `runEvalSuite`（`eval/runner.js:90`）可复用，不需要另造一套统计系统。

本轮重新运行冻结计划 validator：36 个任务、9 个首次安装，`executionStatus:NOT_RUN`、`emptyReportStatus:INSUFFICIENT_EVIDENCE`。工程上可先补经过审查的 setup/check 与终态采集适配，使用无付费 fixture 验证身份、失败、预算 unknown、人工补救和独立断言；这些通过后仍不等于真实任务已经执行。

### 5.4 App Server 的“协议证明”和“可执行准入”需要分开

当前默认兼容函数对 `0.154.0` 返回 true，对 `0.157.1`、`0.160.0` 均返回 false，源于 `codex-app-server-adapter.js:5` 的精确白名单。`.github/workflows/codex-app-server-compatibility.yml:76,96` 已有 `0.157.1` 官方 schema 与真进程旅程，且 job 名明确标为 `no admission`。

这种差异是保守准入，不是已证实的故障。真实缺口是最新上游未进入兼容验证/产品接入闭环。应先将固定验证推进到本次目标版本，并保留“合成 provider、真实工具执行、生产准入”三个不同状态；不能为让探针通过而直接开放版本或外部 Agent 主路由。

## 6. 建议下一期实施的外部依赖项

| 事项                | 已有基础                                      | 下一步依赖及结果要求                                                                                            |
| ------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 最新模型真实可用性  | Responses、stream/reasoning、统一价格已有实现 | 经授权的目标账号完成工具往返、流式取消/恢复、usage 和预算；公开目录信息不等于账号 entitlement                   |
| 账单核对            | request-level usage、缓存/阶梯/服务层级合同   | 对真实账号账单逐请求对照；缺 usage 的历史聚合保留 unknown，不补造费用                                           |
| 36+9 项目与首次安装 | 冻结任务、分层、预算、准入校验                | 先完成执行接线，再使用精确公开产物/干净 profile/实际双 IDE；缺失样本保留，不借历史 mock 补齐                    |
| 长时运行与维护成本  | 已有 reliability/soak 工具、观察计划          | 真实 8h/24h 使用和维护记录；等待时钟或没有报错日志不能自动生成稳定性结论                                        |
| 平台和 native       | 当前平台隔离及部分真宿主回执                  | WSL1 稳定持久信任、Windows ARM64 updater 原门、其余支持组合仍需目标宿主；不把普通 Node 单测当作 native 发行证明 |

## 7. 推荐实施顺序与容量控制

1. 先修 MODEL-03，增加能捕获本次新型号遗漏和错误家族价格的回归；同时建立 MODEL-04 的更新审查。
2. 并行完成 VERIFY-02 的无付费执行/采集接线与 Memory 业务索引设计；先冻结 SLO 和真实任务验收器，再追求优化指标。
3. 将 Codex 最新固定协议探针、MCP 真实服务端和 Linux 受控宿主的正式入口交付列为独立工作流，不将其成功状态互相替代。
4. 在准确提交通过完整门后按现有顺序发布；公开安装、实际账号任务和长时观察另列验收，不由发布成功代替。

不建议同时新增一批 CLI 命令、语音入口、云任务产品或自建新证据平台。优先投入已存在主流程的正确性、可达性和实际效果。

## 8. GitHub Actions 验证映射

| 改动范围                | 必要检查                                                                   | 本轮证据边界                                                              |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| model profile / pricing | CLI CI 相关 unit/integration，各模型合同及预算一致性                       | 本轮 5 文件 117/117 为本机定向验证，不是 release matrix                   |
| Memory 索引/分页        | canonical Memory/CAS/审计回归、三系统 formal 同数据对比                    | 旧 100K formal 证明旧准确源码；新索引实现必须重跑                         |
| App Server              | 固定上游版本 schema、真进程交错 turn/取消/未知终态、三系统聚合             | 当前工作流固定 `0.157.1`；不能证明 `0.160.0`                              |
| 网络/进程边界           | CLI Strict Sandbox、Linux x64/ARM64 真容器、目标 OS 真进程                 | 受控 Linux 证明不能转移到普通 CLI 或其他平台                              |
| 发布                    | 同一准确提交完整 CLI CI、CLI Strict Sandbox；子包→CLI→IDE；OIDC 和公开回读 | 本轮已只读查询 Actions、npm 和 Open VSX，结果见下表与审计回执；未执行发布 |

本轮在 `8b13129624` 上的只读查询时点结果如下；运行中作业后续可能改变，详见[审计回执](./evidence/cli-ide-gap-audit-2026-10-05.json)。

| 对象                                                                                                        | 本轮在线查询                                                                            | 结论                                                           |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [CLI CI 37220898138](https://github.com/chainlesschain/chainlesschain/actions/runs/37220898138)             | in_progress；已生成 67 作业，64 success、1 dry-run-publish skip、2 个 verify-cli 未结束 | 完整门未结束，不能发布                                         |
| [CLI Strict Sandbox 37220897891](https://github.com/chainlesschain/chainlesschain/actions/runs/37220897891) | success                                                                                 | 该提交的 Strict 门已通过                                       |
| [IDE Extensions 37220997626](https://github.com/chainlesschain/chainlesschain/actions/runs/37220997626)     | success；18 success / 1 post-publish skip                                               | 该提交 IDE 门已通过；不等于已发布                              |
| [CI Tests 37220897975](https://github.com/chainlesschain/chainlesschain/actions/runs/37220897975)           | failure；macOS stable unit fallback 作业 `111490913397` 失败                            | 另一个工作流失败，本报告未定位根因，不能称整个仓库所有检查全绿 |
| npm / Open VSX                                                                                              | latest 分别为 CLI `0.166.85` / VS Code `0.37.130`                                       | 与源码候选 `0.166.86` / `0.37.131` 分开记录                    |

当前 CLI 源码为 `0.166.86`；仓库已归档的公开 CLI 回读为 [`0.166.85@84f204db94`](./evidence/cli-0.166.85-publication-readback-84f204.json)，与本轮 npm latest 查询一致。不能仅凭源码版本称 `0.166.86` 已公开，也不能凭前一提交全绿称当前完整发布门通过。

## 9. 合并前负向测试清单

- 新型号 missing/unknown、拼写近似、自定义网关同名模型均不自动获得官方能力；未知 Sonnet 版本不静默继承旧价。
- GPT-6.1 Sol 的 `none/minimal`、工具加 Chat Completions、不合法服务层级、缓存和 272K 边界分别有合同；未知费用不被当作免费。
- Memory 索引丢失/损坏/过期/重建与并发删除后不返回旧数据；权限过滤先于用户可见结果，游标绑定正确版本。
- 真实任务入口拒绝计划/身份/验收器漂移；失败安装、unknown 终态、人工补救、未知成本和缺失样本不计作原始成功。
- App Server 双 thread/turn 通知交错、审批拒绝/取消、进程死亡、提交结果不明均不误成功或 fallback 重跑。
- 将本期 Claude 修复转化为审查案例：MCP 大结果/坏 JSON 不触发副作用重执行，Hook 序列化/匹配失败不放行，Bash 环境变量前缀与 PowerShell 解析错误不绕过 deny/ask；尚未复现的事项只记待核对。
- 运行中撤销等待实际代理/容器清理再 ACK；跨进程来源不受支持时准确拒绝；删除 ownership 记录不是恢复流程。

## 10. 不建议照搬

| 上游方向                                  | 本项目建议                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| 默认开放新模型或自动接入新外部 Agent 版本 | 可自动发现差异，仍由精确合同、目标账号和治理准入决定是否可用                   |
| 把模块多、测试多作为效果证明              | 继续报告实际项目原始成功率、补救、成本和缺失样本；已通过合同与实际完成任务分开 |
| 因已有 SQLite/分片就认定性能完成          | 用当前用户查询路径证明筛选/分页确实下推，以及冷启动、并发和重建的成本          |
| 为恢复便利跳过 fail-closed 或清空 journal | 先设计可核验的恢复权威；保留未知结果与待清理状态                               |
| 将上游桌面/云/语音能力全部列为 CLI 必补项 | 仅把目标用户流程确实需要的能力纳入下一期，避免挤占模型正确性、恢复和真实验收   |

## 11. 官方参考资料

1. [Claude Code changelog](https://code.claude.com/docs/en/changelog)
2. [Codex changelog](https://developers.openai.com/codex/changelog)
3. [GPT-6.1 Sol 模型合同](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
4. [Codex App Server](https://developers.openai.com/codex/app-server)
5. [Claude Code 官方仓库 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
6. [Claude Code 2.1.289 官方 release](https://github.com/anthropics/claude-code/releases/tag/v2.1.289)
7. [Claude Mods 的运行与信任边界](https://code.claude.com/docs/en/plugins/mods/overview)、[权限与 Hooks](https://code.claude.com/docs/en/permissions)：用于评估扩展机制的取舍，不能将终端 UI 等同于 VS Code chat 能力。

以上页面用于确定本轮公开版本及协议/模型合同，不代表在用户账号上验证过访问权限或账单。

## 12. 审计边界与本次验证

本轮基于 `8b13129624d4b7fa5b122a4109151c574564448e` 的实际代码，聚焦可与 Claude Code/Codex 直接比较的 CLI、双 IDE 及共享 runtime，并非后端、桌面和移动端全仓审计。读取 09-27 原报告、共享实施状态及有关回执，未修改用户已有文档改动。历史回执中的时间和性能按原环境保留，未重新下载全部远端产物。

收尾时并行工作将 `main` 推进到 `736784f999`，相对基线只更改桌面 P2P 重试测试；本轮审计的 CLI/IDE 实现未变，Actions 结果仍只对应 `8b13129624`。本次新增报告与回执不改变该后续提交的发布资格。

本机 Windows x64 / Node `22.22.2` 执行：

```powershell
# packages/cli 下执行
..\..\node_modules\.bin\vitest.cmd run `
  __tests__/unit/model-capabilities.test.js `
  __tests__/unit/llm-pricing.test.js `
  __tests__/unit/codex-app-server-adapter.test.js `
  __tests__/unit/codex-app-server-official-schema.test.js `
  __tests__/unit/mcp-client-http-session-recovery.test.js

# 仓库根目录执行
node docs/research/cli/verify01-plan-2026-10-04/validate-plan.mjs
```

结果：5 文件 **117/117** 通过；冻结计划 **36 tasks / 9 firstRuns / NOT_RUN / INSUFFICIENT_EVIDENCE**。另运行模型纯函数、Memory list 参数/访问计数、App Server 版本匹配和 Eval suite 选择探针。Memory 探针首次因夹具缺少 `provenance` 失败，补齐夹具后取得第 5.2 节结果；该失败不是产品反例。

这些定向测试没有覆盖新型号真实 API、目标 MCP 服务端、全部 CLI/IDE 旅程、实际账单或发布安装。本轮读取了 Actions 当前状态，但没有重新执行完整矩阵，也没有将运行中的门记作通过。没有运行付费任务、变更默认 provider、放宽权限、修改产品代码或执行发布。
