# CLI / IDE 差距续做：Actions 修复与身份诊断

> **2026-10-10 增量：四版本已发行，诊断工程待新 SHA 验证**：Agent SDK `0.2.14`、CLI `0.166.96`、Open VSX `0.37.140` 和 JetBrains `0.4.158` 已发行；JetBrains Marketplace update `1190815` 现已 approved、公开列出并可下载。[PR #425](https://github.com/chainlesschain/chainlesschain/pull/425) 已合并为 `2650447476d6358254368b73ddc52b5319982608`，发行标签仍绑定 `da91e730d802b7c9dcdc075b222ecc257021e552`。原 `73f5` Scheduler Windows 失租及 x64 restart trace 缺失的根因仍未知，本轮仅补 CI/helper 诊断，未升版或新发布；局部复验已通过，新准确 SHA 矩阵待完成。详见 20.23；以下各节保留历史时点，冻结正式验收与开放项不变。

本记录补充两份 2026-10-05 审计的实施结果，保留原审计和历史发布的各自源码时点。本轮直接修改 `main`；本机 Docker 不可用，实际容器验收交由 GitHub Actions 执行。

## 1. Docker review pack 权限修复

[VERIFY01 Docker Review Pack #37303181923](https://github.com/chainlesschain/chainlesschain/actions/runs/37303181923) 的准确源码为 `07a383c906add37eae2067a1e20b41bbd22ded2d`。六分片均在 setup 失败；下载的第 4 分片六项原始回执显示 locked dependency installation failed，实际 npm 退出码 243，错误为 `EACCES: mkdir /workspace/node_modules`。合并提交 `ae6adbe13c` 的[后续运行 #37304444663](https://github.com/chainlesschain/chainlesschain/actions/runs/37304444663) 也失败。

Node 官方镜像默认使用 root；验收器使用 `--cap-drop ALL`，该 root 无法越过 runner 用户拥有的 bind mount 权限。修复提交 `feda6d1eeee84330a8c22e48b4fc98c419f833e8` 让安装和测试容器都使用 Linux 操作者真实的 `process.getuid()/process.getgid()`，并将身份写入阶段回执。UID/GID 必须是 `0..0xfffffffe` 的整数，缺失、字符串、负数、分数和越界值均拒绝。

容器根文件系统保持只读，setup 仅工作区可写；check 的工作区与控制目录均只读、断网。继续移除全部 capabilities、启用 no-new-privileges、使用限时 watchdog 与既有资源限制，没有增加权限或修改工作区所有权。Astra 只读复核确认该方案适用于 GitHub 标准 rootful Docker runner；启用 user namespace remapping 的自建宿主需要单独验证。

本地 Windows / Node 22.22.2 / Vitest 4.1.10 的两个相关文件 **10/10 通过**，定向 ESLint 与 Prettier 检查通过。WSL 补验启动因恢复后的缓存缺少 Linux native binding 失败，没有产生新的 Linux 通过结果。

该提交的[六分片运行 #37308413469](https://github.com/chainlesschain/chainlesschain/actions/runs/37308413469) 全部结束为失败，但原始回执确认安装权限问题已解决，部分题已完成 setup/check 与行为反例。六份原始 ZIP 与 GitHub artifact digest 逐份一致，见[失败材料回读](./cli/evidence/gap-2026-10-05/verify01-docker-ci-feda/readback.json)。未将该次失败覆盖为成功。

第二轮修复提交 `49d36bc06e65969b7f1dbf665e1ef585b84c4b81` 包含：

- 官方 Node 22.12.0 bookworm 完整镜像，提供冻结权限测试调用的真实 Git；工作流仍按实际 image ID 固定容器。
- CLI 与 root 的锁定依赖安装，尝试补齐 DOM 依赖；随后实际 CI 证实冻结项目的 happy-dom 属于 `desktop-app-vue`，该安装范围不足。继续 `--ignore-scripts`，仅显式调用锁定的 SQLite prebuild installer；实际内存查询验证及原生文件字节摘要写入回执。WSL / Node 22.12.0 的独立安装与查询补验通过，该结果不代表本机 Docker 可用。
- 精确识别 Vitest `rejects/resolves` 序列化为 Error 的断言失配，同时要求实际 matcher 栈。真实子进程的三种 Promise 断言分别接受，普通应用错误、加载异常、skip/空测试仍拒绝。
- 保留基线完整执行，并为实际漏检的行为反例增加可执行控制。verify-07 的原基线在游标反例下进入同步死循环；该题候选使用有限次分页直接断言边界，基线仍在 setup/check 单独完整执行，两个原反例不变，未扩大 timeout。
- 文档题使用明确短句要求缺失样本不得报告 PASS，仍运行真实 fingerprint 与空报告退出码检查。

三个定向 Windows 测试文件 **21/21 通过**，格式、定向 ESLint 与 diff 检查通过；冻结主模块及原始反例的补充测试均通过，其中 headless approval 的完整冻结源码本地控制为正常实现通过、原 `pending.resolve(true)` 反例触发 AssertionError。主模块补验不替代完整 frozen Docker 环境。

准确提交的[第二轮运行 #37312209419](https://github.com/chainlesschain/chainlesschain/actions/runs/37312209419) 已完成第 3 分片，verify-03、09、21 通过；verify-15 未拒绝计数器耗尽反例，verify-27、33 因缺少 happy-dom 失败。按用户取消过期运行的要求，剩余五个排队分片已取消；该 run 最终为 `cancelled`，不提供完整矩阵成功证据。[原始失败 ZIP](./cli/evidence/gap-2026-10-05/verify01-docker-ci-49d/readback.json) 已与 GitHub artifact digest 核验一致。

后续修复将锁定安装范围改为 CLI 与 `desktop-app-vue` 两个 workspace，明确排除 root；冻结项目的依赖声明由 `git show` 核实。继续保持 `--ignore-scripts` 和显式 SQLite prebuild installer。verify-15 补充真实权限 store 的 add generation、revoke generation/revision 耗尽断言，验证拒绝操作且落盘字节不变；当前与冻结源码两轮补验均通过，18 个子测试分别为 11 正对照通过、7 原反例产生预期 AssertionError。实际 Docker 全包结果须等待新准确提交的六分片验证。

## 2. JetBrains CI 就绪探针修复

准确提交 `ad129eb3feee7a284d08d8ff460fe5642719382f` 的 [IDE Extensions #37313555158](https://github.com/chainlesschain/chainlesschain/actions/runs/37313555158) 出现四个宿主失败：[Windows 2024.2](https://github.com/chainlesschain/chainlesschain/actions/runs/37313555158/job/111782494785)、[Windows 2025.2](https://github.com/chainlesschain/chainlesschain/actions/runs/37313555158/job/111782494855)、[Linux 2024.2](https://github.com/chainlesschain/chainlesschain/actions/runs/37313555158/job/111782494705)、[Linux 2025.2](https://github.com/chainlesschain/chainlesschain/actions/runs/37313555158/job/111782494796)。原始制品核验后确认共因为 `NativeTranscriptProbe.readyState` 反射读取已经移除的 `cachedVersionOut`，抛出 `NoSuchFieldException`；恢复与 Stop 的 initial 证据已写出，随后 native transcript 就绪测量失败。

四份原始失败 JUnit XML 已[归档并核验摘要](./ide/evidence/gap-2026-10-05/ide-ci-ad129/readback.json)，未公开 ZIP 内未审截图。修复仅更新 UI 测试探针与 Robot 调度：在后台执行真实 CLI 身份探测，再在 EDT 读取界面状态并确认配置仍有效。保留 fixture 版本观察及全部就绪条件，不恢复生产缓存、不移除 native transcript 验证门。Java 编译、2 项探针回归与 49 项证据校验通过；CLI 的三个相关文件 21/21 通过。此项仍须以新准确提交的完整真实宿主矩阵验收。

修复提交 `4f24f474b1c5ecc72fa2c812560e2f102fec0917` 已推送并触发 [IDE 宿主矩阵 #37322783550](https://github.com/chainlesschain/chainlesschain/actions/runs/37322783550) 与 [Docker 六分片 #37322783711](https://github.com/chainlesschain/chainlesschain/actions/runs/37322783711)。同一提交的 CLI Strict Sandbox **5/5 作业通过**；CLI CI 已发现下述集成失败，未满足发布门，未发布候选。

该提交的 Docker 六分片已完整结束：36 题中 33 题通过，verify-04、27、31 失败，见[逐题回读](./cli/evidence/gap-2026-10-05/verify01-docker-ci-4f24/tasks-readback.json)；六份 ZIP 全部核验 GitHub 摘要。verify-04 未覆盖缓存 token 跨越长上下文阈值；verify-27 原测试在失配身份恢复时只抛普通应用 Error，缺少行为断言；verify-31 未检测读取失败后的句柄泄漏。后续为三题分别补充阈值、三种单独身份字段失配及 I/O 句柄生命周期控制，完整基线导入、冻结 42 个反例和严格 parser 均不变。当前与冻结模块补验通过，不能据此将失败 CI 改为成功。

CLI CI 的 Linux integration 1/8 作业中 149 项通过、1 项失败，原因是归档 `good.cmd` 的 `-text` 覆盖仍继承通用 `eol=crlf`，与精确源码校验合同冲突。[原始失败日志与 XML](./cli/evidence/gap-2026-10-05/cli-integration-ci-4f24/readback.json) 已保留。修复对原始证据目录显式设置 `!eol`，不修改校验器；真实 Git fixture 补验确认原始 CRLF 字节通过、改为 LF 仍被拒绝。定向 3/3 通过；新提交仍须完整验证。

上述三题及属性修复合并后，三个 CLI 定向文件 **22/22 通过**，Git fixture 定向 **3/3 通过**（其余六项未选中）；格式、定向 ESLint 和 diff 检查通过。这些本地结果仅作补充，不能替代新发布提交的全系统矩阵。

本机 Windows 2024.2 的完整 canonical 旅程补验通过：恢复、Stop、原生 transcript 测量及真实 IDE 重启均完成。[最小文本证据包](./ide/evidence/gap-2026-10-05/native-probe-windows-fix/readback.json) 保留 7 份原始记录、全部字节摘要和三份测试源码摘要；不含截图或 ZIP。运行从 `ad129eb3fe` 加 dirty 修复开始，期间生成 `4f24f474b1`，driver 在结束时读取 HEAD；三份测试源码字节始终一致。该补验不属于干净准确提交 CI，也不满足正式样本、独立人工验收或性能 SLO。

## 3. Docker 完整通过与 macOS 流式采集失败

准确提交 `6196cd065dca2afd55ca51ed53c8d95a196be223` 的 [Docker Review Pack #37326983206](https://github.com/chainlesschain/chainlesschain/actions/runs/37326983206) 已完整通过：六分片、36/36 题、42 个行为反例全部检出，包括 verify-04、27、31。六份原始 ZIP 与 GitHub artifact digest 逐份一致，见[完整回读](./cli/evidence/gap-2026-10-05/verify01-docker-ci-6196/tasks-readback.json)。该结果是冻结项目的 setup/check 与反例工程验证，不是正式 provider 任务样本或独立人工审阅。

同一提交的 [CLI Strict Sandbox #37326983050](https://github.com/chainlesschain/chainlesschain/actions/runs/37326983050) 5/5 作业通过；macOS MCP 发布门、E2E、IDE Roadmap Safety Matrix、Code Quality & Security 和 Full Test Automation with Diagnostics 已完整成功。CLI CI 仍在执行，不能据此提前发布候选。

[IDE Extensions #37327110713 的 macOS 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/37327110713/job/111825117269) 在最低版本 VS Code 1.85.2 的 `streamProfile` 采集阶段失败。前面的真实交互、100 次 Workbench needs-input、reply-artifact 均已通过，随后通用 DOM relay 的 10 秒响应期限到期。该作业 stable 版本的三个录制案例耗时约 2.2、2.8、4.3 秒；没有最低版本逐案例开始/结束记录，不能确定失败尺寸或将隐藏视图调度认定为根因。[安全文本回读](./ide/evidence/gap-2026-10-05/ide-ci-6196-macos-failure/readback.json) 保留原始失败日志、进度与对照指标，不公开截图和完整 ZIP。

修复为流式采集增加独立有界期限：host 90 秒、renderer 75 秒、可见性预检 15 秒；普通 relay 仍为 10 秒。必须使用真实可见 DOM 与真实 rAF，逐案例/warmup 记录 started/completed/failed 及实际帧进度。隐藏、取消、超时和逾期帧会停止采样、清理临时 DOM 并恢复 selection/scroll；取消和进度消息均校验 token/requestId，不接受并发采样。原有 64 帧、selection、parse/finalization 等断言及 `performanceGate:false` 保留，没有将采集期限扩大解释为 SLO 通过。

本地 host DOM 与 extension-host runner **86/86** 通过，CLI 引用侧 20 个文件分轮 **260/260** 通过；最初两个 DOM 文件因本地缺少锁定 `happy-dom` 没有加载，隔离补齐 lock 中的 20.11.1 后通过，未修改仓库依赖。ESLint、Prettier 和 diff 检查通过。同一旧提交的 JetBrains 三系统 × 两版本六宿主全部成功，[54 份安全原始文本及字节回读](./ide/evidence/gap-2026-10-05/jetbrains-ci-6196/readback.json) 已归档；IDE 工作流最终只有上述 macOS VS Code 作业失败，Linux 发布门因此跳过。修复后的准确提交仍须完整 CLI 双门与 IDE 宿主矩阵，当前候选 CLI 0.166.89、VS Code 0.37.134、JetBrains 0.4.152 均未发布。

## 4. Windows / macOS 流式诊断选区准备失败

准确提交 `4f2c19281ca9b66576a3ef3d599dafa1fe67471c` 的 [IDE Extensions #37332999462](https://github.com/chainlesschain/chainlesschain/actions/runs/37332999462) 出现两个失败作业：[Windows](https://github.com/chainlesschain/chainlesschain/actions/runs/37332999462/job/111850754043) 与 [macOS](https://github.com/chainlesschain/chainlesschain/actions/runs/37332999462/job/111850754054)。macOS stable 与最低版本均在 `verifyStreamingProfile` 的 `deferredWhileSelected` 断言失败；Windows warmup 已采满 64 个真实可见帧，耗时约 1.2 秒，macOS 最低版本约 5.1 秒。本次不是隐藏视图或采集超时，失败结果继续保留。

Astra 使用真实 Chromium 确认诊断准备缺陷：已有 collapsed caret range 时，直接 `Selection.addRange(target)` 会保留原光标，实际选中文本为空。旧 `selectionStable` 比较空文本仍可能通过，但生产 renderer 正确识别 `isCollapsed=true`，立即格式化，因此延迟格式化断言失败。新增 warmup 校验暴露了此问题；不能删除 warmup 校验或放宽正式案例断言。

修复在保存原 range 后，先清除已有选区，再建立并核验目标文本的非折叠选区；清理路径仍恢复原 range 和滚动位置。真实可见 DOM、rAF、64 帧、取消/期限合同与 `performanceGate:false` 保持不变。修复后的准确提交仍须重新完成全系统 CLI 双门和完整 IDE 宿主矩阵，不能复用 `4f2c` 或 `6196` 的通过作业发布新提交。

本地 host DOM 与 extension-host runner **87/87** 通过，CLI 流式渲染 DOM 引用回归 **7/7** 通过；ESLint、Prettier 和 diff 检查通过。新回归模拟 Chromium 单 range 行为，验证已有 caret 的替换、取消后的恢复以及拒绝目标 range 时的清理。只在内存中移除新增的清除操作后，caret 回归按预期失败，共享源码未被临时修改。

## 5. JetBrains 身份旅程

真实 Windows IntelliJ 2024.2 / 插件 0.4.152 的同一 IDE 进程完成八阶段诊断：有效 CLI、显式错误路径且存在 managed fallback、修复显式路径、同路径替换为 GCC、PATH 上 GCC、四个命令别名均缺失、managed fallback、安装到 PATH 后无需重启恢复。两次手动更新也显示正确的身份失败原因。

该诊断只使用本地命令 fixture，没有发送模型请求、运行 agent 任务或安装公开产品。[安全归档与回读](./ide/evidence/gap-2026-10-05/onboarding-identity-windows/readback.json) 包含 29 份原始文件，其中 10 张截图限定 IDE/对话框；前两次失败尝试的整桌面截图不公开，前三次失败原因和清理结果分别保留。最终回执绑定 `ae6adbe13c` 加 dirty 工作区及逐文件字节摘要，五份源码摘要与当前文件一致；不能将其描述为干净提交的 CI 或首次公开安装样本。实际 IDE 正常退出，Gradle owner exit 0、taskkill 未使用、已记录进程身份均已消失。

## 6. 仍需独立完成的任务

| 项目                      | 当前证据与剩余条件                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| MODEL-03 / PERF-02        | 模型、价格、reasoning 与 usage 工程合同已实现；真实目标账号、usage、账单及估算器校准仍未执行               |
| VERIFY-02 / VERIFY-IDE-02 | 36 题 setup/check 与 42 行为反例已通过完整 Docker 六分片；独立人工审阅、正式 provider 与公开安装样本仍开放 |
| PLATFORM-02 / NET-02      | 显式 Linux controlled-host 已接通；Windows/macOS durable 权限存储、持久网络撤销与崩溃恢复仍缺后端实现      |
| IDE-ONBOARD-02            | 本地真实 Windows 宿主身份诊断通过；Linux/macOS 对应旅程及公开安装来源仍需验证                              |
| IDE-COLD-02               | 120 秒有界等待及迟到 init 不补发已有合同；真实慢初始化、永不 init 与 Stop 竞态的 GUI 旅程仍需补验          |
| 辅助技术与性能            | 真实宿主语义/性能采集存在；NVDA、VoiceOver、Orca 真人听测、8h/24h 观察与获批 SLO 仍开放                    |
| CLOUD-02                  | 完整跨机器 resume 仍为需求条件项，现有 self-hosted handoff 不承担该支持声明                                |

只读冻结计划回读仍为 `executionStatus:NOT_RUN` / `INSUFFICIENT_EVIDENCE`，真实进程退出码 **2**。任务 observed=0、missing=36；首次安装 observed=0、missing=9；总费用为 null。正式分母与预算 $72+$27=$99 不变。本轮没有付费调用、发布新候选或写入正式 observations。

## 7. 2026-10-06 剩余工程接线

本节续做从 `4807dfaa5e` 开始，保留上述历史失败和各自源码时点。工作期间共享仓库由另一进程提交了 `59da637285` 与 `3027b27454`；以下本地宿主材料绑定其实际启动时的提交及逐文件字节，部分诊断/清理辅助代码随后仍有修改，不能描述为当前新提交的干净 CI 或新发行。既有公开配对已更新为 CLI **0.166.90**、Open VSX **0.37.135**、JetBrains **0.4.153**，标签源码为 `28cff6adc8`，见[独立公开回读](./cli/evidence/documentation-release-status-2026-10-06-final.json)。本节新工程没有发布。

### 7.1 BRIDGE-02 显式可信恢复入口

新增 `cc agent process-ownership status --json` 和 `cc agent process-ownership recover <execution-uuid> --timeout-ms 5000 --json`。状态查询不 provision 权限域；恢复仅委托已有 Linux cgroup 身份验证、kill、空组 fence 和持久清理回执。非法 UUID、非整数/越界期限、非 Linux 及父 `agent` 参数混用均拒绝；执行结果错误或超时继续保留隔离，没有 reset、删除 ledger、按 PID 推断清理或自动重放任务。

实际 CLI 子进程合同和恢复集成已接入 [Process Ownership Recovery](../../.github/workflows/process-ownership-recovery.yml) 的 Linux x64/arm64 真实 delegated cgroup job；新命令源码和测试路径均触发此门。Windows 定向合同 **55 项通过、15 项平台专用跳过**；WSL / Node 22.12.0 的三个原生 CLI 场景验证 help 不建 authority、空状态不 provision、旧 PID-only 记录拒绝恢复且字节不变。后者不具有 cgroup v2，不能当作新命令实际回收后代的证明。完整操作合同见[受控宿主指南](../cli/NET02_CONTROLLED_HOST.md#explicit-process-ownership-inspection-and-recovery)。

### 7.2 跨平台身份与冷初始化宿主旅程

`onboarding-diagnostic.mjs` 复用单独的私有命令夹具：Windows 使用 `.cmd`，Linux/macOS 使用可执行 POSIX shim；脚本固定绝对 Node 路径。仅实际 IDE 的 PATH 被隔离，Gradle 保留构建 PATH；另移除 Node 版本管理器的发现变量，按忽略大小写的唯一键提供私有 APPDATA/ProgramFiles，Windows 加入固定 PowerShell 目录以支持真实 ACL 初始化。主 `cc` shim 被物理移除；三个替代名字使用明确返回 command-not-found 的私有 sentinel，避免生产 `CliLauncher` 自动补入系统目录后逃逸到已安装 CLI。Linux/macOS 上真正的系统 C 编译器仍允许被探测并拒绝其身份，这不是删除系统编译器或宣称所有 OS 可执行文件物理缺失。

实际 Windows 第一轮发现 Node manager 环境使诊断探测到真实 `chainlesschain`，见[保留的失败材料](./ide/evidence/gap-2026-10-05/onboarding-cross-platform-windows-first/readback.json)；第二轮[菜单定位失败](./ide/evidence/gap-2026-10-05/onboarding-cross-platform-windows-second/readback.json)也保留。菜单动作改为同一 EDT 的真实按钮 → 绑定当前选中视图的 production JPopupMenu → 唯一 showing/enabled JMenuItem，随后仍检查标题为 ChainlessChain、owner 链属于同一 IDE frame 的实际对话框及错误文本，没有反射调用生产更新方法。第三轮[八阶段完整回读](./ide/evidence/gap-2026-10-05/onboarding-cross-platform-windows-v3/readback.json)全部通过，两次手动更新也显示正确身份错误；记录的源码摘要与回读时文件全部一致，IDE 自然退出且所有记录身份消失。这个动作验证不证明鼠标导航或物理桌面可见性：前两轮截图存在黑屏/其他窗口遮挡，截图和完整日志均未进入公开归档。

新增 IntelliJ `--journey cold`，使用实际安装的插件、原生 Send/Stop 与真实子进程，由确定性 peer 显式延迟 init。三场分别覆盖 30 秒后 init、生产 120 秒初始化期限耗尽后迟到 init、Stop 后迟到 init；超时/Stop 后保留草稿，直到显式重试才发送。独立校验原始 child ledger、session/nonce/process instance、实际加载的 120 秒常量、GUI 状态和时间顺序，要求每场只有一条原始 user 输入。重复派发、错误子进程、旧 retry 观察、缺失案例和缩短期限均有可执行负例。

第一轮 GUI 三场和退出均通过，但旧校验器把 child 的 gate 时间当作插件计时起点：真实 child gate 在初始化等待开始后报告，超时观测约 **119.8 秒**，校验器错误拒绝。保留[原始失败材料](./ide/evidence/gap-2026-10-05/cold-init-windows-first/readback.json)，没有将其改写为通过。修正分别记录提交耗时与 child 等待观测；生产期限不变，实际加载常量仍为 120，同时要求迟到 init 后的 ready → beforeRetry → explicitRetry → 原始 user 时间链。第二轮[Windows IntelliJ 2024.2 / 插件 0.4.153 原始回读](./ide/evidence/gap-2026-10-05/cold-init-windows-v2/readback.json)全部通过：

| 场景                  | child 等待观测 | 提交至 held 观测 | 原始 user 输入 | 自动补发 |
| --------------------- | -------------: | ---------------: | -------------: | -------: |
| 30 秒 init            |      30,134 ms |        32,684 ms |              1 |        0 |
| 120 秒超时后迟到 init |     120,038 ms |       121,335 ms |              1 |        0 |
| Stop 后迟到 init      |         313 ms |         1,175 ms |              1 |        0 |

实际 IDE 自然退出，Gradle owner exit 0、taskkill 未使用、已记录进程身份全部消失。回读明确记录两份后续修改的辅助源码摘要差异；这是本地历史工作区验证，不是当前干净提交 CI，不是性能 SLO，也不代表真实 provider 的迁移/hooks 冷启动发生率。

继续补齐 `--journey cold-boundaries`。首次[真实边界旅程](./ide/evidence/gap-2026-10-05/cold-boundaries-windows-first/readback.json)中，永不 init 的旧实例回收与显式重试通过；提前退出阶段暴露产品错误：onExit 清空 session generation 后，发送收尾把实例变化误判为审批变化，覆盖了 `Agent exited before input acknowledgement`。修复只调整提示分类：真实审批 revision 变化仍优先；同一 revision 保留实际错误；其他实例变化使用通用 session 提示，派发、保存、撤销和重试门不变。

修复后的[两个边界完整回读](./ide/evidence/gap-2026-10-05/cold-boundaries-windows-v2/readback.json)通过：永不 init 的 gate 没有释放，生产期限耗尽后由真实 `/normal` 控件请求退出屏障；提前退出以真实 code 86 结束，显示准确原因且保留草稿。两场均确认旧 Node 已消失，旧实例 user 输入 **0**、新实例 **1**，替换发生在显式重试和退出确认之后，自动补发 **0**。源码逐文件摘要全部与回读时工作区匹配，IDE 正常退出、taskkill 未使用。Astra 审查发现的两个串扰反例（唯一输入改错 session、同实例追加其他会话输入）已增加实际负例，校验器同时绑定 session 与旧/新 processInstanceId。

最终 Windows / Node 22.22.2 与 WSL / Node 22.12.0 的四个新增 Node 文件各 **23/23 通过**，包含实际 POSIX shim 删除/恢复、错误路径及真实 peer init 前 code 86 退出。Java `InputDispatchTest` **10/10**、`PermissionModeStateTest` **4/4** 通过，SDK 编译与插件构建通过。三系统身份、两组冷初始化 GUI 及证据负例均接入 [VERIFY01 Host Diagnostics](../../.github/workflows/verify01-host-diagnostics.yml)；新 Linux/macOS 实际宿主结果仍须矩阵回读。

### 7.3 Windows 退出测试的准备阶段

扩大宿主回归首次出现两项失败：hanging graceful request 没有观察到 abort，detached descendant 场景没有进入预期拒绝。原因是 Windows kernel 身份采集先消耗了已经启动的绝对 graceful deadline，测试实际走 taskkill 分支；沙箱内另有 CIM `PermissionDenied`，这些失败不作通过证据。

新增显式 `captureOwnedProcessTree(handle)` 准备阶段，在 owner 活着时采集真实创建身份，然后才启动原 graceful 请求期限。普通调用仍由 `stopOwned` 执行采集；采集失败保存 `confirmed:false` 原始错误，不能确认清理。CIM 只查询四个所需字段，保留原 10 秒采集、6 秒请求、30 秒测试期限与持续采样；没有扩大 timeout 或删断言。Windows 沙箱外两项独立复验 **2/2 通过**，完整生命周期文件 **13 通过、3 项 POSIX 专用跳过、0 失败**。相关 JS 定向 ESLint、Prettier、两个工作流 actionlint 及 CLI 生成文件检查通过。

### 7.4 仍需的环境与验收

| 项目                         | 本轮后的状态                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODEL-03 / PERF-02           | 工程合同已有；GPT-6.1 Sol/Sonnet 5.5 官方账号 stream/tool/reasoning、usage/账单、token 估算事实保真仍需真实调用                                    |
| VERIFY-02 / VERIFY-IDE-02    | Docker 36/36 与42反例已有准确证据；正式36+9、独立人工 review、native Windows/macOS review、公开安装与费用仍未完成                                  |
| BRIDGE-02                    | 显式 CLI 接线及拒绝合同完成；新命令真实 Linux x64/arm64 cgroup 矩阵仍待运行，不覆盖旧 PID-only journal                                             |
| IDE-ONBOARD-02 / IDE-COLD-02 | 跨平台 driver/CI 接线、Windows 八阶段身份、五场实际 IntelliJ 初始化/替换旅程完成；新三系统矩阵、公开安装及更广泛调度/物理桌面交互仍独立验收        |
| PLATFORM-02 / NET-02         | Windows/macOS durable authority、持续网络撤销和崩溃恢复后端仍未实现；Linux dirfd/cgroup、Windows WFP 与 macOS 受信任服务不可互换，平台拒绝保持严格 |
| 辅助技术与性能               | NVDA/VoiceOver/Orca 真人听测、8h/24h 覆盖回执及获批 SLO 仍开放，fixture 延迟不是性能验收                                                           |
| CLOUD-02 / MAINT-02          | 完整跨机器 resume 仍是需求条件项；持续维护工时和真实任务收益仍需独立记录                                                                           |

重新执行冻结 validator/fingerprint 和只读采集器，指纹仍为 `665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0`，原生进程退出码 **2**：task observed=0/missing=36，firstRun observed=0/missing=9，totalCost=null。冻结 provider 为 **Volcengine `deepseek-v4-flash-ga-260731` 与 OpenAI `gpt-6-astra`**；MODEL-03 的 Anthropic 官方端点验收是另一个项目，不能替换冻结 provider。当前仍需账户配置、费用授权和独立人工签核，未启动付费调用，也未写入正式 observations。

## 8. 2026-10-06 CI 回读与火山真实采样

本轮从 `22236fcb09a09c20e2bf2a5e5f8837b92084b252` 的干净工作区开始。用户随后明确授权“可用火山引擎测试，本地环境好了的”。只读取配置的 provider/model/endpoint 和凭据是否存在，确认其为内置火山端点与 `deepseek-v4-flash-ga-260731`；按该授权完成以下真实调用。第 7 节的“无付费授权”仅保留当时含义，不再适用于火山测试。未取得官方 OpenAI/Anthropic 账号或真实账单材料。

### 8.1 Linux 显式进程恢复的双架构结果

[Process Ownership Recovery #37422826291](https://github.com/chainlesschain/chainlesschain/actions/runs/37422826291) 绑定 `3027b274540274a7b501e15384a6b80a290a60c3`，Linux x64 与 ARM64 两个 job 均成功，每个 **31/31**、无跳过。已下载并按原字节归档测试报告与内核回执，见[独立回读](./cli/evidence/gap-2026-10-05/process-recovery-ci-3027/readback.json)。

集成场景通过真实 CLI 执行 `status`、`recover <uuid>`：监督进程死亡后 detached 后代仍在执行，恢复要求实际 cgroup 身份匹配、发出 kill、确认空组、持久化回执，再验证新的执行准入；原任务启动标记仍只有一条。旧 PID-only 记录、boot/object 漂移及发布失败保持拒绝，恢复不重放任务。相关命令、内核实现、集成测试和工作流从被测提交到本轮 HEAD 无改动；回执仍仅归属于其明确记录的准确提交，不作为本轮发布门或其他平台证明。

### 8.2 双 IDE 六宿主与身份、初始化矩阵

[VERIFY01 Host Diagnostics #37423495338](https://github.com/chainlesschain/chainlesschain/actions/runs/37423495338) 绑定 `7694e165644f99ed8a03cf76c9459df72f32ed5d`，打包及六宿主 job 全部成功：Linux、Windows、macOS Intel × VS Code **1.132.0** / IntelliJ **2024.2**，Node **22.12.0**。保存原始协议、UI、源码摘要、进程退出确认与 Actions 元数据，见[完整回读](./ide/evidence/gap-2026-10-05/host-ci-7694/readback.json)。

回读重新核对六处 task capture：每场唯一 generation、唯一 user 输入、连续原始协议、真实 drained exit 0，以及 submit/tab/return/final/reload/restored 六个动作。IntelliJ 三系统各含八阶段身份旅程及 slow-init / timeout-late-init / stop-before-init；用被测提交的原版校验器重新比对 GUI 与原始 child ledger，保留实际 120 秒生产期限、显式重试和零自动补发。源码摘要与准确 Git blobs 对照；Windows checkout 的 CRLF 变换单独记录。

这些通过结果关闭了对应历史提交的 Linux/macOS 身份与三场冷初始化“尚无矩阵回读”。`22236fcb09` 后续的菜单动作修复、永不 init/提前退出替换和错误分类不在旧工作流源码中，仍需新准确提交矩阵；不能以旧三场通过冒充新五场通过。本轮宿主回读使用确定性 peer，未评估 provider、市场安装、物理桌面交互、屏幕阅读器或性能 SLO，不加入正式 36+9。

### 8.3 火山校准采集修复与实际结果

Astra 协助修复 `context-token-volcengine-live-probe.mjs`：20 秒期限现在覆盖 headers 和完整正文，正文最多 1 MiB；每请求先保存 started，结束保存 settled，失败保留已付费样本和已知费用小计，未知费用保留 null。输出目录拒绝复用，原始请求/响应 ID/响应正文只保留摘要，保存数值 usage、准确源码文件摘要与实际 OS/Node。增加 `--output`、`--matrix`，原调用方式保持兼容。

首次 12 请求完成后发现实际 `completion_tokens` 超过请求的 `max_tokens:8`。补充 requested/observed 字段和超限次数，并增加 66-token 响应负例；全部实际 output usage 仍计入费用，没有猜测原因、增加未经验证的参数或将请求值当作硬性上限。最终脚本再采 12 请求；两轮原始回执分别保留，第一轮缺源码元数据的限制明确记录，见[真实采样回读](./cli/evidence/gap-2026-10-05/volcengine-live-20261006/readback.json)。最终脚本及估算器的全部记录文件摘要与回读时工作区一致，`workingTreeDirty:true`，不冒称干净提交 CI。

最终一轮 Windows x64 / Node **22.22.2** 的结果：

| 类别        | 不同请求数 | 估算输入 token 合计 | provider 输入 token 合计 | 低估次数 | P95 相对绝对误差 |
| ----------- | ---------: | ------------------: | -----------------------: | -------: | ---------------: |
| 中文        |          3 |               1,260 |                    1,065 |        0 |           25.05% |
| 代码        |          3 |               1,022 |                    1,236 |        3 |           24.30% |
| emoji       |          3 |                 786 |                    1,470 |        3 |           47.59% |
| 工具 schema |          3 |               2,373 |                    3,378 |        3 |           38.61% |
| 合计        |         12 |               5,441 |                    7,149 |        9 |           47.59% |

最大单请求低估 **365 tokens**；实际输出最多 **133 tokens**，最终 12 次 usage 都超过请求值 8。两轮校准对应估算费用分别 **$0.00110922**、**$0.00112378**。这只说明本次火山请求的 framing、schema 与内容编码偏差；冻结官方矩阵仍为 OpenAI `gpt-6.1-sol` / Anthropic `claude-sonnet-5-5` × 四类 × 三个不同请求，全部 24 个官方目标请求仍缺。保留 `INSUFFICIENT_EVIDENCE`，不据单 provider 小样本改动全局 bytes/4。

### 8.4 生产压缩与只读工具的真实轨迹

复用现有 `ide-roadmap-live-provider-trajectory.mjs --mode live --runs 1`，使用真实火山账户完成 **6 次调用**：两轮生产 semantic compaction，每轮再完成 read_file 与最终回答。Windows 本轮 HEAD 下的轨迹代码、运行时和冻结 fixture 相对提交无改动，回执已再次经既有严格校验器验证；[原始结果](./cli/evidence/gap-2026-10-05/volcengine-live-20261006/trajectory-first.json)记录完整脱敏 usage、事件顺序与事实摘要。

两轮分别保留 **9/9**、**17/17** 条冻结事实，字段归属与结构一致，silent loss **0**；只读工具各执行一次，模型 usage 全部已知。轨迹对应估算费用 **$0.01283044**；合并两轮校准，共 **30 次真实调用、$0.01506344**。费用使用仓库价表与返回 usage 估算，未认证账户账单。测试演化部署用于构建隔离运行时，不作为生产部署溯源、真实任务成功率、Linux 100 次 manifest 单元或 IDE/provider 正式样本证明。

### 8.5 本轮验证与剩余任务

两份校准 Node 文件合计 **15/15** 通过，含真实 HTTP headers 后正文挂起的 abort、部分失败不丢失、未知费用、输出超限与脱敏负例；已接入 `CLI CI` 的三系统 `verify-cli`。本轮定向 ESLint（推荐 Node 规则）、Prettier、workflow actionlint 与 diff 检查全部通过；该新增 CI 步骤尚无新准确提交的 Actions 结果。本轮没有提交发布。

| 项目                         | 已补齐                                                                 | 仍需实际完成                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| BRIDGE-02                    | Linux x64/ARM64 显式 CLI 真实回收与持久回执，各 31/31                  | Windows/macOS ownership 与同 UID 对抗隔离不在支持声明内                                            |
| IDE-ONBOARD-02 / IDE-COLD-02 | `7694e16564` 三系统八阶段身份、三场冷初始化；后续 Windows 五场本地证据 | 当前菜单/额外边界修复的新准确提交三系统矩阵、公开安装与更广调度                                    |
| PERF-02                      | 火山中文/代码/emoji/schema 真 usage、两轮事实保真、采集可靠性修复      | 官方新模型矩阵、多 provider 校准、账单与真实项目成功率                                             |
| MODEL-03                     | 工程合同保留，火山连接与 usage 已验证                                  | 官方 OpenAI/Anthropic 新模型 stream/tool/reasoning 与账户账单；火山不能替代官方端点                |
| VERIFY-02 / VERIFY-IDE-02    | 冻结 Linux Docker 全包、六宿主诊断、火山付费测试授权                   | 独立人工预审、Windows/macOS native evaluator 隔离、正式 36+9、公开安装来源及账单                   |
| PLATFORM-02 / NET-02         | 继续保留 Linux authority/撤销与平台拒绝                                | Windows 服务/WFP/持久身份恢复、macOS 受信任服务/持续网络撤销；原生 review 不得退化为本机直接 spawn |
| 辅助技术、性能与维护         | 既有语义采集、历史工程证据                                             | NVDA/VoiceOver/Orca 真人验收、8h/24h 观察、获批 SLO、独立维护工时                                  |
| CLOUD-02                     | 现有 self-hosted handoff 合同                                          | 完整跨机器 resume 仍为需求条件项                                                                   |

本地 Docker Linux engine 的命名管道当前不存在，未启动或修改宿主服务。Windows 本机版本 **10.0.19045**、Node **22.22.2** 不匹配冻结正式 Windows 11 / Node 22.12.0 目标，不能将本轮真实探针改填正式样本。再次只读检查冻结采集器：原生退出 **2**、`NOT_RUN` / `INSUFFICIENT_EVIDENCE`、task observed=0/missing=36、firstRun observed=0/missing=9、totalCost=null；指纹与 **$72+$27=$99** 冻结预算不变。归档的 **255 项字节/源码摘要** 全部匹配，检查材料未包含本机已配置凭据，见[最终核对与原始采集器回读](./cli/evidence/gap-2026-10-05/volcengine-live-20261006/final-verification.json)。未写正式 observations。

## 9. 2026-10-06 公开安装与 Windows 原生检查器

用户授权继续火山实测并在完成后提交 Git。本节记录公开包的独立诊断及原生沙箱增量，不修改冻结正式计划。原生实现已在 `7e8d61e1c7` 提交，公开 npm 校验与第 8 节材料已在 `189a904032` 提交；本轮继续补齐证据归档、真实公开 IDE 旅程与发现的采集器缺陷。

### 9.1 公开 npm CLI 安装、配置和真实工具

公开安装校验器保留本地候选模式。npm manifest 带 `dist` 时，新增校验 CLI 自身的 registry lock 条目：准确版本、tarball URL、规范的 64-byte SHA512 integrity，同时继续核对全部固定版本子包。该合同不证明签名、源码提交或安装后每个文件的字节身份。新增 Node **3/3**、原有单文件 Vitest **10/10** 通过，Node 测试已接入三系统 CLI CI。

真实安装公开 CLI **0.166.90** 到独立 prefix，完成配置及火山连通性，再用新的隔离 profile 完成 `write_file` → `read_file`。产物严格为 `CHAINLESSCHAIN_PUBLIC_FIRST_RUN_V1\n`，唯一成功终态、三条 usage、自然 owner exit，已知工具调用估算费用 **$0.000869764**。见[完整尝试回读](./cli/evidence/gap-2026-10-05/public-cli-first-run-readback/readback.json)。

安装操作错误、错误 flag、网络失败、跨执行身份的 EPERM 及准备阶段 EEXIST 均保留；没有修改旧 profile ACL，也没有把失败尝试改写为首次即成功。五个诊断阶段在多次尝试后完成，**singleInitialAttemptPassed=false**。连通性请求与失败请求费用未知，完整总费用为 null；未验证账单、签名或恶意后代隔离。Windows 10 / Node 22.22.2 与冻结目标不同，不计正式 first-run。

### 9.2 Windows 原生执行期限

普通 broker 新增 Windows 专用 `sandboxPolicy.limits.wallTimeMs`，只接受 **1–3,600,000 ms** 的安全整数；其他平台明确拒绝，不静默忽略。C# watchdog 在目标 Resume 前启动，覆盖入口管道交付，期限耗尽终止整个 Job；仍需确认空 Job 才允许结算。处理 timer callback 与句柄关闭竞态，期限不包含 wrapper 准备时间，也不替代最多 10 秒的清理屏障。

最初三项原生案例及五份匹配源码/二进制快照见[stage 1 回读](./cli/evidence/gap-2026-10-05/windows-native-wall-time-stage1/readback.json)。后续 stage 2 完整回归仍覆盖这三项，不将两个阶段测试数量叠加成不同测试。

### 9.3 最小只读原生检查器

新增 `windows-native-evaluator.js`：每次创建私有 stage，源文件和检查器只读，scratch 可写；工厂签发一次性 WeakMap policy，绑定文件身份、摘要、runtime、check、cwd 和期限。拒绝软链接、硬链接、重复/非法路径与超限数据。Node 被复制到私有 control，不给原项目或 NVM 目录追加 AppContainer ACL；仅以明确的最小环境启动检查器，没有 provider 凭据。

原生 helper 持有文件及祖先目录 guard 到空 Job 确认，唯一零 capability AppContainer 同时限制文件与网络。沙箱账户的 profile 创建失败保留；成功实测来自获准的真实用户执行身份，不据此推广到所有账户。Native helper readiness、格式与定向 lint 已核对；最终 **5 文件、360/360、无跳过**，六个源码/二进制摘要与当前实现及准确 Git blobs 一致。最终回执、完整测试结果及七个关键失败材料见[stage 2 归档](./cli/evidence/gap-2026-10-05/windows-native-evaluator-stage2/readback.json)。归档脱敏绝对用户路径，同时记录原始与归档摘要；历史失败的缺失字段及并发源码绑定问题单独标明。

真实案例验证源文件/检查器改写、删除、目录重命名和硬链接被拒绝，scratch 可写，篡改在创建目标前被拒绝，detached child 随 Job 清理。公网 TCP 返回 **EACCES**；loopback 为 **ETIMEDOUT**，并同时核验零 capability、前后无 loopback exemption、同一 listener 的前后可达正对照及零额外连接。**超时本身没有被写成明确拒绝码**。

这是最小 staged **CJS 检查器**，不是完整 native36/Vitest review pack，不是 Windows durable authority、WFP 持续网络撤销或崩溃恢复，也不证明运行中修改 loopback exemption 的对抗隔离；macOS 原生检查器仍开放。不能用它替代冻结正式任务的全部平台前置条件。

### 9.4 公开 VS Code 与真实火山任务

从 Open VSX 下载 **0.37.135** 原始 VSIX，实际 **714,045 bytes**，SHA256 `ba905abfa806bebfef726dde4941dacf24fc4ef39ffe571896d7f585238b8408` 与市场 checksum 一致；下载仅允许 Open VSX 及其 Eclipse 内容域。配对公开 CLI **0.166.90**。见[公开来源回执](./ide/evidence/gap-2026-10-05/public-vscode-market-source-v2/receipt.json)。未声称签名或源码提交已认证。

第一轮在真实 VS Code **1.132.0** 安装成功，但驱动把 CLI 别名 `auto` 交给 IDE 的 `setMode`，在发送提示前报 `Unsupported host permission mode`。IDE 正常退出，不是 10 分钟 deadline 耗尽；零 user 输入、零 CLI 任务、零模型调用。操作器又因重复复制相同 launcher config 报 EEXIST；原文件保留，后来按字节相等恢复归档，原始日志仅保留脱敏节选并记录完整日志摘要，见[原失败回读](./ide/evidence/gap-2026-10-05/public-vscode-live-windows-first/recovery-readback.json)。

Astra 协助在 launcher 启动前严格校验 `default/acceptEdits/bypassPermissions`，不自动转换权限。新增模式契约及无副作用拒绝测试，与诊断和宿主 runner 合计 **57/57** 通过，接入扩展 `test:unit` 及三系统宿主诊断工作流。

第二轮使用新的隔离 profile、明确 `acceptEdits` 和最多四轮，在公开安装的面板中发送一次真实任务。实际执行 `write_file` 与 `read_file`，文件严格为 `CHAINLESSCHAIN_PUBLIC_IDE_FIRST_RUN_V1\n`；面板显示 `DONE.`，后台 tab 切换及返回、自然关闭和真实 IDE 重启后恢复均完成，恢复没有启动新 agent 或重放输入。原始 **22** 条连续记录包含一条 user、一个匹配的 durable input receipt、唯一 success、同会话 `system/end` 和 drained exit 0；见[独立回读](./ide/evidence/gap-2026-10-05/public-vscode-live-readback/readback.json)。

独立核验暴露旧 `inspectIdeProtocol` 将合法 `system/end` 当作任务尾输出的问题。修复只识别唯一、最后、紧随唯一 result 的同会话单轮结束帧，核对 turn、可选 trace/sequence 和字段白名单；保留原始 capture，通用 `verifyAgentTerminal` 仍拒绝任意尾输出。重复/提前 end、跨会话、附带 error、错误 turns、额外工具/错误、非零或未 drain 退出仍失败，显式失败结果后 end 也不变为成功。最初 reader 失败回执保留，未为通过核验重新调用模型。

三个成功 usage 的输入/输出/缓存读分别合计 **18,126 / 231 / 25,600 tokens**，按仓库价格表估算 **$0.00296072**。实测还出现一次 `stream_retry`，原始重试保留，失败请求费用未知，因此完整诊断总费用为 **null**，不是上述小计。没有真实账单、物理桌面鼠标导航、恶意进程树、听测或性能 SLO 验收；本机 OS/Node 与正式计划不同，**formalSample=false、observationsCreated=false**。

### 9.5 公开 JetBrains 与真实火山任务

从 JetBrains Marketplace 获取已公开 **0.4.153**，update **1187914**，ZIP **1,521,021 bytes**，SHA256 `d41b78abc65eb3c417e573295da10bc24eccf7a13f79e2e8cb24d4f33cc7f1e0`。保留官方 API 元数据、请求与最终内容域、原始 ZIP 和摘要，见[公开来源](./ide/evidence/gap-2026-10-05/public-jetbrains-market-source/readback.json)；这是来源与字节记录，不宣称市场签名或源码提交已认证。

驱动准备的 Gradle 命令在审批/工具返回前挂起约 **493 秒**，root 中断后没有 stdout/session，未启动 GUI 或模型任务。随后沙箱内直接 javac 虽返回 0，关闭外部依赖 jar 时日志出现 `AccessDeniedException`，这次也不算干净通过。两份准备失败保留。获准执行的统一脚本用仓库 JDK 21、缓存依赖，将当前八份 UI Java 源码及独立 main 编译到新的输出目录；exit 0、无异常日志、十个 class，记录编译器、源码、依赖及 class 的逐文件摘要。

直接启动缓存的真实 IntelliJ **2024.2 / build 242.20224.300**，全新 config/system/plugins/home/workspace。插件只从市场 ZIP 解压，没有调用 `buildPlugin/runIdeForUiTests` 替换为本地包。实际宿主身份分别核对插件 **0.4.153**、安装路径、配置路径、amd64、JBR **21.0.3** 及迭代预算 **4**；公开 CLI **0.166.90** 使用独立 profile 和火山配置。采用明确 `acceptEdits`，发送一次与 VS Code 同内容的写入/读回任务。

初次运行与同 profile 的真实新 IDE 进程重启均完成，驱动两次 exit 0，IDE 退出和进程清理分别确认。实际文件严格为 `CHAINLESSCHAIN_PUBLIC_IDE_FIRST_RUN_V1\n`；唯一用户输入、匹配 durable receipt、指定 provider/model、write/read 各一次、唯一 success → 同会话 end → drained exit 0 均从原始协议回读。重启前后原始协议摘要一致，恢复不启动 agent、不重放输入。六个 UI 动作、结果文本/row 身份、源码/class 和市场包身份见[独立回读](./ide/evidence/gap-2026-10-05/public-jetbrains-live-windows-v1/readback.json)。

保留三个成功 usage，输入/输出/缓存读分别合计 **18,600 / 398 / 24,576 tokens**，与 terminal 汇总一致；当前统一价格估算小计 **$0.003059504**，实际 `stream_retry` **0**。terminal 未报告费用，实际账单及未观测失败请求费用保留 unknown，不将费用 unknown 当作零。原始 capture 和全部准备/执行/清理记录均归档。这是 Windows 10 / Node 22.22.2 的公开包诊断，不是正式首次安装样本、真人鼠标导航/听测或性能 SLO；未写 observations。

### 9.6 本轮验证与未关闭条件

最终终态导入相关四文件 **106/106** 通过，包含结束帧顺序、来源、字段和失败保真的反例；VS Code 模式/诊断/runner 三文件 **57/57** 通过。定向 ESLint 无错误或警告，Prettier、宿主 workflow actionlint 和 diff 检查通过。原生 **360** 与这两组测试的范围分别记录，不把测试数量作为真实编码成功率。本轮的新模式前置检查已接入扩展单测与三系统宿主 CI，准确新提交的远端矩阵仍待运行。

所有新增公开安装和原生归档均设置 `-text` 并排除全仓格式化，保留记录摘要对应的字节。最终核对包括源码、原始/脱敏归档摘要、已配置凭据值的精确扫描、冻结 validator 和只读采集器，见[收尾核对](./cli/evidence/gap-2026-10-05/completion-checks-20261006/verification.json)。正式计划指纹仍为 `665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0`；采集器原生 exit **2**，task observed=0/missing=36、firstRun observed=0/missing=9、totalCost=null，冻结预算 **$99** 未变。

| 项目                      | 本轮后的准确状态                                                                | 尚需完成                                                                      |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 公开 CLI / 双 IDE         | 公开配对包的真实火山读写、双 IDE 终态和重启零重放均通过；原始失败和未知费用保留 | 签名/安装后逐字节溯源、真实账单、其他正式 OS/Node 与各个 first-run            |
| Windows native review     | 执行期限、一次性只读 staged CJS、零 capability 与空 Job 已实测，360/360         | 完整 native36/Vitest review pack、独立人工 setup/check 预审、macOS 原生检查器 |
| PLATFORM-02 / NET-02      | 最小检查器不扩张原平台准入；Linux authority/恢复合同保留                        | Windows 服务/WFP/durable 身份、macOS 受信任服务、持续撤销与崩溃恢复           |
| MODEL-03 / PERF-02        | 火山已授权并有真实 usage、工具与事实保真                                        | 官方 OpenAI/Anthropic 新型号端点、完整校准矩阵与账单，不能以火山代替          |
| VERIFY-02 / VERIFY-IDE-02 | 正式 36+9 保持 `NOT_RUN`，不把 Windows 10/Node 22.22.2 诊断填入冻结目标         | 正式目标环境、独立人工审查和逐样本完整证据；未知费用仍不能结案                |

## 10. 2026-10-06 原生 review 准入与 Actions 修复

### 10.1 七项失败的共同原因

CLI Strict Sandbox 与 IDE Roadmap Safety Matrix 的三系统生产任务均在 mapped Claude security delta 步骤退出，Safety 汇总依赖失败：共七项。安全映射中 `cc-2.1.232-sandbox-binary-ripgrep-scope` 的生产者文件摘要仍为 `5519d1a7…`，实际测试文件已因原生期限与权限断言增量变为 `b3c11d16…`。映射对应的 652 字节测试块未变；独立核对全部 32 条映射、21 个生产者及测试 ID 后，仅更新这一摘要，不删断言或放宽门。

修复已在 `d558e6c71e4da77bec3a9abcc5f413a7db10d74e` 提交并推送。该准确提交的本地映射执行器 **29 passed、0 failed、932 未选中**；未选中测试不算通过。前序 Actions 被后续提交的并发策略取消，不能作为完整矩阵。

其后主分支 `266718e8b53864338619eb8f1a963fa9523640b4` 保留正确摘要：[CLI Strict Sandbox #37456050925](https://github.com/chainlesschain/chainlesschain/actions/runs/37456050925) 的 Linux、macOS、Windows、ARM64 整任务成功；[Safety Matrix #37456050953](https://github.com/chainlesschain/chainlesschain/actions/runs/37456050953) 三系统整任务成功。归档时 Safety 汇总与附加 macOS latest capability **尚未分配 runner**，仍为 queued；只保存六个目标系统任务的成功，不宣称七项全绿或新提交通过。元数据快照与范围见[本轮回读](./cli/evidence/gap-2026-10-05/windows-native-review-admission-stage1/readback.json)。

另发现该提交的 PDH advisory watchdog 在依赖安装步骤失败，尚未检查 schema。安装原本位于 monorepo 根目录，与注释中的“standalone”不符；改为 runner 临时目录、关闭 workspace 解析并固定 `better-sqlite3@11.10.0`，用 `NODE_PATH` 供 CJS checker 加载。实际本地 checker 又暴露旧漂移夹具缺少 `audit_log` 等迁移依赖；复用完整 v1–v3 schema，显式注入四个旧非 partial 索引，先独立检查 v4 修复，再检查升级到最新 schema 后的 account scope，防止后续重建掩盖 v4 失效。修复已在 `be3058e297` 提交并推送；本地实际 SQLite 两场通过、静态单测 **10/10**、ESLint/Prettier/actionlint 通过，准确新提交的远端结果仍独立等待。

随后 Safety 汇总也已成功，工作流整体为 **completed/success**，详见[后续完成回执](./cli/evidence/gap-2026-10-05/windows-native-review-admission-stage1/ci-completion.json)。因此原始七项失败在准确提交 `266718e8b5` 已全部关闭；较早的 queued 快照原样保留。附加 macOS latest capability 仍排队，Strict 全工作流与本轮新源码提交不借用这七项的通过结论。

最终附加 macOS latest 的真实 Seatbelt 探针与证据上传也已成功；准确提交 `266718e8b5` 的 **CLI Strict Sandbox 与 IDE Roadmap Safety Matrix 两个完整工作流均 completed/success**。五个 Strict job 与四个 Safety job、workflow 元数据及摘要见[最终完成回执](./cli/evidence/gap-2026-10-05/windows-native-review-admission-stage1/ci-full-completion.json)。上述排队快照保留历史时点；新原生代码和 PDH 修复仍须验证自己的提交。

### 10.2 Windows 后端的逐题只读准入

`verify01-review-pack.mjs` 新增显式 `--backend windows-native`；在生成文件前读取冻结合同，返回结构化 `NOT_READY` / exit **2**，不执行 setup、check 或模型。原 Linux Docker 默认后端和生成的 runtime 字节保留。Windows 模式拒绝 Docker image 绑定，缺工具链时拒绝生成。

准入默认选择真正属于 Windows 的 **12 个任务**：`01,02,03,10,11,12,19,20,21,28,29,30`；计划总任务仍为 36。当前 Windows **10.0.19045 / Node 22.22.2** 与冻结 Windows 11 24H2 / Node 22.12.0 不符。单独的 [verify-17 平台审计](./cli/evidence/gap-2026-10-05/windows-native-review-admission-stage1/verify-17-platform-audit.json)读取冻结 Git blob：目标是 `darwin-vscode-openai`，唯一 `process-ownership-journal.test.js` 基线仅支持 Linux。平台分配不匹配与基线不能执行分别报告，不能把全部 pending 算通过。

现有最小 evaluator v1 的 64 文件、单文件 1 MiB、总量 8 MiB、128 目录及 scoped 路径限制保留。完整 Vitest 依赖树、happy-dom、Vite 大文件、SQLite addon 和开发环境的外部缓存 junction 不能直接获得准入；需要独立版本化、lock/integrity/hash/ABI 绑定的只读工具链 capsule，以及 frozen setup/globalSetup 的原生支持。`forks` 为显式默认需求；`threads` 仅作为声明不同 pool 的诊断，不能自动替代 Docker forks。原生 CPU/进程限制也不宣称与 Docker 内存/CPU/PID 限制等价。

只读命令：

```powershell
node packages/cli/scripts/verify01-native-review-admission.mjs
node packages/cli/scripts/verify01-review-pack.mjs --backend windows-native
```

外部 capability JSON 必须同时提供其原始字节 `--capabilities-digest sha256:...`，且匹配当前 host/runtime；完整报告再经原始输出、manifest、PID、exit 与 settlement 严格回读。不完整报告一律不给能力。没有选项可将任意缓存或调用者“supported”声明当作受信任工具链。

### 10.3 固定原生探针与保留的真实失败

`windows-native-evaluator-capabilities.mjs --confirm-native --output NEW_ABSOLUTE_DIR` 只运行七个固定小夹具：scratch environment、ESM、worker threads、inherited/file/pipe stdio、fork IPC。仍通过原一次性 WeakMap factory 与零 capability AppContainer，使用复制的 Node、只读 workspace/control 与可写 scratch；在目标中派生 TEMP/HOME/AppData，不转发 provider 凭据，没有本机普通 spawn fallback。默认 Job wall-time **15,000 ms**、单 probe **1,200 ms**，ESM import 单独有界；JS timer 不能抢占同步阻塞，whole-Job watchdog 仍为最终边界。

第一轮目标实际创建，但只有最终 stdout，15 秒超时无法定位阶段；不将其归因为 profile 创建失败。补齐早期 initialization 和每 probe 的 started/settled **同步 fsync JSONL**，最多 17 条、每条 16 KiB、总量 64 KiB；主进程仅在原生清理确认后读取唯一预定日志，核验 scratch 身份、拒绝 links/超限并用固定大小文件句柄回读。所有不完整 stage 保留，区分 `diagnostic-incomplete` 与 `cleanup-unconfirmed`。

新的受限环境尝试在 native readiness/cleanup 验证前被拒绝；获准真实用户复跑启动 **PID 18708**，保留 13 条连续记录：

| 阶段                                     | 真实观察                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| scratch / ESM / worker / inherited stdio | 四项已 settled 且返回支持结果；这是未完成诊断的 prefix                               |
| file stdio                               | **2 ms** 返回 `EPERM`，保留真实错误                                                  |
| pipe stdio                               | **217 ms** 时记录 started，之后无 settled；15 秒 Job watchdog 终止目标，exit **125** |
| fork IPC                                 | 未到达，`NOT_OBSERVED`                                                               |

最终 `cleanupConfirmed=true`、`capabilityCount=0`、`loopbackExemptionAbsent=true`，stage 保留。严格 partial validator 核对日志顺序、PID、字节摘要与目标失败，返回 **diagnosticCompleted=false、capabilities={}**；默认完整 validator 拒绝该报告。没有扩大原生期限或修改 C#/二进制来把失败变为成功。

原始报告及 journal 在本地保留，归档文本仅脱敏用户/仓库绝对前缀；[回读与产物摘要](./cli/evidence/gap-2026-10-05/windows-native-review-admission-stage1/readback.json)分别记录原始和归档 SHA。内部 manifest/输出摘要仍绑定原始材料，脱敏归档不能直接作为 capability 准入输入，也不是原始不变的成功证据。

### 10.4 验证与仍待完成的工作

能力模块纯合同 **23/23** 与既有 Docker review-pack 回归 **8/8**，共 **31/31、零跳过**；新增 Node 准入 **8/8**，包含真实 CLI exit2、生成前拒绝、显式 pool、冻结人口、平台 mismatch、摘要与伪造能力反例。能力合同已接入 Strict Sandbox 的系统矩阵，Node 准入接入 CLI CI 的三系统校验。定向 ESLint、Prettier、三个工作流 actionlint 通过；这组纯测不替代 Windows 原生实测或新准确提交 CI。

完整 native review 仍 **NOT_READY**：需要将有阻塞风险的探针隔离为各自原生 Job、完成未观察 IPC，并实现受信任工具链与 locked test support；其他平台的原生后端、独立人工 setup/check 预审也未关闭。现有检查没有启动正式任务或 provider；冻结 fingerprint 仍为 `665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0`，只读 collector exit **2**，task observed=0/missing=36、firstRun observed=0/missing=9、totalCost=null、预算 **$99** 不变。
| 辅助技术、性能与维护 | 既有工程/宿主语义证据保留 | NVDA/VoiceOver/Orca 真人听测、8h/24h、获批 SLO 与独立维护工时 |
| CLOUD-02 | 现有 self-hosted handoff 继续可用，resume 明确未实现 | 需求明确后实现跨机器连续恢复，不默认复制云账户/订阅 |

## 11. 2026-10-07 独立原生探针与工具链预检

### 11.1 已完成的工程

七项探针分别使用新的一次性 AppContainer/Job，保持每 Job 15 秒期限、零网络 capability 和独立 manifest/stdio/journal/清理回执。确认清理且证据有效的超时可继续；清理或身份/摘要不确认则停止，不发下一 policy。未修改 helper、ACL 范围或生产 allowlist。

新 `capabilities/v2` 保留 v1 历史验证，核对固定顺序、独立 stage/manifest、顶层与各 Job 的宿主/runtime、runtime 字节摘要/大小、完成状态和原始证据。超时整包 `capabilities={}`；独立结果仅作诊断。原准入兼容 v2，保持 12 个 Windows 任务与原 36 题人口，未就绪时生成前拒绝。

新增 `verify01-native-toolchain.mjs` 只读核对独立 lock digest 与冻结 Git blob、包版本/registry integrity 元数据、全部文件摘要、Node 可执行文件/ABI、addon 清单和五个冻结 setup/helper 字节；拒绝 links/junctions、硬链接、别名、超限和未锁定包。不安装、import 或执行 addon/setup/test。输出明确为 `INVENTORIED_NOT_EXECUTABLE`、`trusted:false`、`executionStatus:NOT_RUN`；registry 内容验证、addon ABI 执行和原生 ACL 均未获证明，不扩张最小 evaluator 的 64 文件/8 MiB 边界。

### 11.2 实际诊断与证据

受限会话先在 readiness/cleanup 阶段失败并保留 stage。获准真实用户权限的七 Job 结果如下，全部独立清理确认：

| 探针                                     | 实际结果                                       |
| ---------------------------------------- | ---------------------------------------------- |
| scratch / ESM / worker / inherited stdio | 四项支持                                       |
| file stdio                               | `EPERM`，blocked                               |
| pipe stdio                               | 15 秒 Job watchdog 结束，timed-out             |
| fork IPC                                 | 已独立执行，15 秒 Job watchdog 结束，timed-out |

整包不完整、能力为空；完整 validator 拒绝，partial 回读保留七项结果。本机 Windows **10.0.19045 / Node 22.22.2** 不能替代冻结 Windows 11 24H2 / Node 22.12.0。诊断发生在随后 validator-only 收紧之前；原报告摘要绑定实际运行源码，最终源码摘要另行记录，不称为新准确提交的原生门。

[回读和摘要](./cli/evidence/gap-2026-10-05/windows-native-isolated-probes-2026-10-07/readback.json)包含受限失败、逐 Job 报告/journal 的脱敏副本、准入拒绝和测试回执。原件与脱敏归档分别记录摘要，脱敏档案不能作为 capability 输入。

### 11.3 验证与剩余项

能力合同 **37/37**、Docker review-pack **8/8**、Node 准入 **10/10**、工具链预检 **13/13**，共 **68/68**，零失败、零跳过。预检接入 CLI CI 的三系统步骤；本地不代替新准确提交 Actions。本轮没有发布或新增付费 provider 请求。

```powershell
node --test packages/cli/test-node/verify01-native-review-admission.node-test.mjs packages/cli/test-node/verify01-native-toolchain.node-test.mjs
node packages/cli/scripts/windows-native-evaluator-capabilities.mjs --confirm-native --output NEW_ABSOLUTE_DIR
node packages/cli/scripts/verify01-native-toolchain.mjs --root ABSOLUTE_ISOLATED_TREE --lock-digest sha256:INDEPENDENT_FROZEN_LOCK_DIGEST
```

仍需完成：受信任原生工具链 capsule 与 locked setup/config 执行、Windows/macOS durable 权限/网络撤销/崩溃恢复后端；冻结目标宿主；独立人工 review、正式 36+9、官方账号/账单、真人辅助技术、8h/24h 与获批 SLO。本轮未写正式 observations，不增加正式实测分母。

## 12. 2026-10-08 冻结原生工具链与 AppContainer 胶囊

### 12.1 本轮实现与真实准备

在 `feature/cli-ide-gap-completion-20261008` 继续工作。新增 `verify01-native-toolchain-prepare.mjs`，从冻结 Git lock 解析 Vitest/Vite/happy-dom 的依赖、peer 与平台适用闭包，保留原始嵌套 `node_modules` 路径。顺序下载仅接受锁定的 HTTPS npm registry URL，先核对 sha512、完整 tar 结构、包身份与每个文件字节，再写入新建的私有树；不运行 npm 安装或 lifecycle scripts。冻结源码使用一次 `git cat-file --batch`，逐 blob 校验 Git SHA-1 与文件 SHA-256，包含原配置、五个 setup/helper 和其源码依赖闭包。

真实 Windows x64 准备结果为 **191 包、8,369 文件、111,823,724 字节**。独立 inventory 再次验证全部 registry 内容，状态仍 `INVENTORIED_NOT_EXECUTABLE`。锁定原件摘要为 `sha256:f70a1beec6cb222e3e4fbcb13711e67681d49c8f8edb5d75f55000832b95455a`；registry manifest 摘要为 `sha256:40f48cf9bbdcf754f9e9fad91ddde1f020f520710a3444552c5c86ac625ee2c2`。成功与前两次失败见[准备回读](./cli/evidence/gap-2026-10-05/windows-native-toolchain-prepare-2026-10-08/completion-readback.json)。

准备过程修复两个真实 npm 制品编码兼容问题：DefinitelyTyped 的 `@types/NAME` 可使用其锁定 `NAME/` 根；同一制品必须保持唯一根与准确包身份。`package/./PATH` 只有与精确 canonical 普通文件逐字节相同且成对出现时才可归一化一次，写出审计记录。不同内容、孤立 alias、case alias、重复原名、目录 alias、`..`、links、未锁定包与额外安装文件仍拒绝。实际成对编码仅出现在 agent-base/http-proxy-agent/https-proxy-agent；首次两轮失败原样保留。

### 12.2 独立 v2 原生胶囊

新增 `createWindowsNativeCapsuleEvaluator` 与 `verify01-native-capsule.mjs`，保持原 v1 的 **64 文件、1 MiB 单文件、8 MiB 总量、128 目录**。v2 使用独立 policy brand、私有目录前缀、manifest version 与 lock/plan/project/runtime/ABI 绑定，JS 和 C# 两侧分别限制 **20,000 文件、32 MiB 单文件、512 MiB 总量、20,000 目录**，check 仍最多 1 MiB，manifest 最多 4 MiB。实际使用现有摘要绑定的 invocation 文件运输，没有将大清单塞入 Windows 命令行。

捕获在分配下一文件前累计预算；单文件以有界 FD 读取，分别核对 pathname/descriptor 身份并重新打开比对，不能用文件增长突破分配上限。binding/runtime 深冻结，库存 JSON 不能替代源树重新核验。安全 dotfile 与 scoped 包路径可进入 v2；v1 路径合同保留。

原生 helper 继续逐文件/目录持有 guard、枚举全部条目、拒绝未列出文件与 links/硬链接/别名，绑定实际复制的 Node/check、挂起目标令牌和 Job；仍为零 capabilities、无 loopback exemption、墙钟终止与空 Job settlement。新 helper 的嵌入源码摘要为 `ae1d468fce99a4a4a75b78805f24e043c8e16bc110821ae0df17bab54b5abbd7`。

真实原生测试 **3/3**：81 文件、12 MiB 可传输执行，源码/control 写入拒绝、scratch 写入成功；篡改文件及新增未列出文件分别在目标创建前拒绝，`targetPid=0`，清理确认。20,000 的上限没有做满额资源/SLO 测量。证据见[胶囊回读](./cli/evidence/gap-2026-10-05/windows-native-capsule-2026-10-08/readback.json)；旧回执的源码身份与最后有界读取回归分别记录，不作为准确提交发布门。

### 12.3 实际工具链执行与仍存在的故障

所有执行使用原 registry/Git 字节、Windows **10.0.19045**、Node **22.22.2**、ABI **127**。先前受限用户令牌的 readiness/cleanup 拒绝被保留；按工具权限流程用真实用户令牌继续诊断。

| 实际诊断                   | 观察结果                                                                                              | 当前结论                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 独立 all-file stdio        | 97 字节二进制 stdin 摘要、独立 stdout/stderr、PID、FD 关闭与 settlement 均核对通过                    | 原 ignore-stdin 的 NUL 拒绝不能泛化为所有文件 stdio 不支持；旧七项 capability ID/结果未改 |
| 工具链导入                 | builtin ESM 已完成，`vitest-import-started` 后 15 秒 Job 超时，exit 125，清理确认                     | 导入未完成，不授予完整工具链能力                                                          |
| 冻结 globalSetup           | 原模块导入成功；helper 第 531 行 `fs.realpathSync.native(scratch/tmp)` 返回 `EPERM`，exit 1，清理确认 | 该次不是初始化超时；locked setup 未通过                                                   |
| 三个 registry addon        | Parcel watcher 与 Rollup MSVC 加载成功；Rollup GNU `ERR_DLOPEN_FAILED`                                | 完整诊断保留全部三项，`addonAbiVerified=false`                                            |
| frozen-config Vitest smoke | 前置导入未通过，未运行                                                                                | 保留 `NOT_RUN`；threads 也不等于原 forks 合同                                             |

[Win32/全文件 stdio 回读](./cli/evidence/gap-2026-10-05/windows-pipe-api-2026-10-08/readback.json)保留原始摘要和脱敏派生。固定 libuv 的普通 `uv` pipe 名称返回 Win32 5，LOCAL 创建成功、NUL 返回 5；冻结 Rollup `dist/native.js:21` 在 Windows 顶层使用默认 pipe 的 `spawnSync`，`:91` 的 `isMingw32()` 触发该调用，路径为 `vitest/node → vite → rollup/parseAst → native.js`。内部 3 秒 timeout 不能抢占此前已确认的 libuv 管道创建循环；不以延长 Job 时间或取消隔离解决。

单个 addon 失败不会让其他二进制变成未观察：检查器逐项保留 loaded/blocked/code，验证完整人口、PID/ABI、唯一结束帧与 fsync journal。缺摘要、替换 journal、夹入失败阶段、缺或重复 Vitest start、删除失败 addon 或假称整体 ABI 通过均拒绝。整包 `capabilities={}`，公开派生摘要不能作为准入票据。

### 12.4 回归、接线与剩余任务

| 验证                                                                                   | 结果                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Node：准备/registry/inventory/准入/胶囊回读/pipe/file-stdio 合同                       | **153/153，零跳过**                         |
| 真实 v2 胶囊及篡改/未列出文件拒绝                                                      | **3/3，零跳过**                             |
| Vitest：原 v1、七项能力合同、Docker review pack                                        | **52/52，零跳过**                           |
| 定向 ESLint、Prettier、helper source contract、spawn inventory、两 workflow actionlint | 通过；actionlint 未启用 shellcheck/pyflakes |

共 **208 项通过**；执行诊断中的失败没有混入此回归计数。Node 合同接入 CLI CI 三系统；真实 v2 运输接入 Strict 的 Windows job 并上传回执，相关脚本/测试补入 push/PR path filters。本地结果不替代本分支准确提交的完整 Actions 矩阵。

本轮确认尚需实现的工程：独立版本化原生 runtime 对 LOCAL 管道、Null 设备、受限根 canonical 查询及 Node 后代适配/证明；冻结 setup/config/full review；Windows/macOS durable 权限 authority、网络撤销和崩溃恢复。Astra 的设计审查不是这些后端的执行证据，未启用 IAT hooks、修改 Node/冻结包或扩大生产 allowlist。

真实验收还需目标 Windows 11 24H2/macOS 15/Linux 宿主与 Node 22.12.0、官方 OpenAI/Anthropic 账号与账单、独立人工 setup/check 签核、双 IDE 正式任务/首次安装、真人 NVDA/VoiceOver/Orca、8h/24h 观察和获批 SLO。用户尚未提供目标环境/账号配置信息；CLOUD-02 继续保留需求条件项。

冻结计划 validator 仍为 `sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0`，**36 tasks / 9 firstRuns / NOT_RUN / INSUFFICIENT_EVIDENCE**；未写正式 observations、未删分母、未新增付费请求或发布。

## 13. 2026-10-08 独立实验 runtime 与冻结 setup

### 13.1 已关闭的本地执行阻塞

新增两个独立实验 N-API 适配器：管道 v1 只交换当前固定 `node.exe` 的 `CreateNamedPipeA/CreateFileA` IAT 项，将严格匹配、属于当前 PID 的 libuv pipe 名称映射到 AppContainer LOCAL namespace；runtime v2 加入私有根的 `GetFinalPathNameByHandleW` 回退。两者均先核对实际 AppContainer SID、零 capabilities、PID 和 Job，仅安装当前进程的 slots；失败时回滚页保护与已交换项，不允许继续半安装状态。

有限 CLR/Win32 四项控制确认：scratch/workspace 的 share 0/7 均能打开并关闭句柄，DOS normalized/opened flags 0/8 返回 Win32 5，**normalized NT flags 2 成功**。v2 仅在原 flags 0 返回 ACCESS_DENIED 时，核对真实规范 NT 根目录、固定根句柄、逐层非 reparse/single-link 对象和最终 FileId，再转换到监督器已 guarded 的 DOS 根。`path.resolve` 和 FILE_NAME_OPENED 不用于 canonical 证明；原 API 已成功或其他 flags/错误均透传。证明针对实际目标，不恢复调用者已经解析掉的内部 alias。

| 真实运行                  | 验证结果                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管道 v1                   | sync/async/fork IPC 全部完成；97 字节输入摘要、实际 PID/PPID、分离输出及 close/退出核对，四个 Node 八份安装/exit 回执                              |
| runtime v2                | 上述三种操作通过；scratch/workspace 与三个 child 的 native realpath 成功；`C:\Windows` 可 open 的实际句柄触发 fallback/rejected 各 +1、mapped 不增 |
| 冻结工具链导入            | 原 registry/Git 字节的 Vitest/Vite/happy-dom 导入与关键导出核对通过；两个实际 Node 共四份回执                                                      |
| 冻结 globalSetup/teardown | 原模块执行和 teardown 全部完成；一个 Node 两份回执，不再是先前 realpath EPERM                                                                      |
| helper 原生回归           | 81 文件/12 MiB、workspace/control 写拒绝与 scratch 写允许；监督器最小环境 SID 与实际 token 回执一致；篡改和未列出文件在 target 创建前拒绝          |

最终真实执行均确认同 AppContainer SID、capabilityCount=0、Job、无 loopback exemption 和空 Job 清理；capsule 的 check 仍限 **15 秒**。capsule 保持原冻字节，在新的私有源树加入单独 `adapter/` 文件，factory 再核对所有 snapshot 和实际 runtime，不改变已 issued manifest。新 profile 与 checker 摘要还须命中监督器 guarded manifest 的精确条目，所有已观察 Node phase pairs 共享父进程的 NT/volume/FileId 根证明。只声明 `observed-receipts-only`；未插入原生产 allowlist。

### 13.2 实际失败、修复与构建

完整尝试和原件/派生摘要见[证据 README](./cli/evidence/gap-2026-10-05/windows-runtime-adapter-2026-10-08/README.md) 与 [readback.json](./cli/evidence/gap-2026-10-05/windows-runtime-adapter-2026-10-08/readback.json)。受限用户令牌的 readiness/cleanup 拒绝、监督器未传 SID、Windows NODE_OPTIONS 反斜杠丢失、module 的 extended drive prefix、outside 仅在 open 阶段被拒绝、旧 validator 拒绝正常 ERROR_PIPE_BUSY 重试，均保留原失败，没有覆盖成成功。

helper 仅在 guarded native evaluator 的环境分支覆盖填入已经核对的 SID，源码摘要 **`e007bc6e264216ada6f74bdd0f4fa6fa4592126b3713c8d4a572341044a7e879`**，DLL/EXE 已重建并通过 `-Check`。preload 的 NODE_OPTIONS 使用等价 forward slash 参数编码，两个版本均有真实 Node/含空格路径解析测试。`GetModuleFileNameW` 只允许严格 extended drive 归一化，其他 namespace/alias 仍拒绝。

LLVM-MinGW 20261006 官方 ZIP 校验后安装到私有 `.work/toolchains`，没有全局安装；新本地构建脚本显式接受固定 compiler/header/new-output 路径，记录源码、Node/headers/compiler/DLL、argv、自测和 binary 摘要。实际成功运行的 v2 addon 为 **`0dab7447d7732ebb132a087daefba158c6e2d4f26855ba488b7a0b8471428077`**。构建记录的后续产物有独立 hash，PE 时间戳/输出名可造成差异，不能借用先前 native 结果；未宣称 hermetic compiler closure。

### 13.3 回归、CI 反馈与状态

| 回归                                                                                   | 结果                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Node：准备/registry/inventory/准入/capsule/API/两代 preload/runtime 和复合证据         | **391/391，零跳过**                         |
| helper 实际 transport、防篡改、未列出文件                                              | **3/3，零跳过**                             |
| Vitest：原 v1、七项能力合同、review pack                                               | **52/52，零跳过**                           |
| 定向 ESLint、Prettier、helper source contract、spawn inventory、三 workflow actionlint | 通过；actionlint 未启用 shellcheck/pyflakes |

合计 **446 项通过**；失败诊断不混入计数。新增 Node 合同接入 CLI CI 三系统步骤，diagnostics/runtime/realpath 纳入 Strict path filters；本轮没有将实验 addon 打包为生产支持或进行 npm/IDE 发布。

准确前序提交 `8ade986b048559e9f5668b860890f7478742edd8` 的 Strict Sandbox、IDE Safety Matrix、VERIFY01 Host Diagnostics 与 Process Ownership Recovery 均成功；CLI CI 和 Reliability Soak 仍失败，不能宣称完整门通过。两项实际根因已修：pure capsule 无效输入在读历史 Git 对象前拒绝，消除浅 checkout 中 `fatal:not a tree object` 的错误；Reliability 平台汇总新增只读 verifier workspace dependencies 安装，避免缺 `@chainlesschain/session-core`。新源码须由新准确提交的完整 Actions 验证，不能复用旧成功作发布资格。

### 13.4 尚需继续完成

本地 Windows **10.0.19045 / Node 22.22.2 / ABI 127** 只证明本轮实验 profile。NUL、冻结原 forks/config/full review、Rollup GNU 的整体 ABI、Windows/macOS durable authority/网络撤销/崩溃恢复仍开放。NUL 的固定 libuv 调用是 `CreateFileW(L"NUL")`，stdin access `0x120089`、stdout/stderr `0x120196`，share 3、inherit TRUE、OPEN_EXISTING、flags 0；独立下一版须验证真实 `\Device\Null` 对象/权限并精确继承，不能替换为文件、管道或普通 stdin。固定 libuv 子进程使用普通 CreateProcessW，根进程白名单不能证明所有后代的精确继承，仍需逐次 launcher/受限 runtime 支持。

正式 target hosts、Node 22.12.0、人工 setup/check 签核、官方账号/账单、36+9、双 IDE/公开首次安装、真人辅助技术与 8h/24h/SLO 缺证据。计划 validator 再次确认 digest 不变，**36 tasks / 9 firstRuns / NOT_RUN / INSUFFICIENT_EVIDENCE**；预算 $99、分母、正式 observations 和 CLOUD-02 条件项均未改变，未新增付费请求或发布。

## 14. 2026-10-08 NUL 设备与精确后代继承

### 14.1 实验 v3 的真实验证

独立 `createWindowsNativeNullEvaluator` 使用原 v1 运输边界，并将 v3 profile 绑定到 guarded manifest；caller 不能指定额外 profile/env/handles。helper 仅对该 profile 打开两个真正的 Null 句柄，验证 `GetFileType=CHAR`、内核对象 `\Device\Null`、File 类型、read `0x120089`、write `0x120196` 与同步 mode `0x20`，纳入根进程的精确 HANDLE_LIST。原 v1/v2 默认不增加句柄。

v3 的五个当前 node.exe IAT 项包括既有管道/realpath，以及 `CreateFileW/CreateProcessW`。Null fallback 只处理原 API 失败的固定 libuv NUL 调用：share 3、OPEN_EXISTING、flags 0、inherit TRUE、template NULL 与精确 access；不使用文件或 pipe 模拟 Null。private base handles 不可继承。每次受控 Node launch 独立复制并核对 CRT stdio，改写 CRT 表与标准句柄，传入精确 HANDLE_LIST 和两个新 Null 副本；未知 stdio、detached/breakaway、外部 executable、缺 trusted preload 或不支持形状拒绝。

最终实际运行（格式整理及 LF 源码新构建）有 **六 PID/十二 installed+exit 回执**：root `24384`、nested `27356`、其 grandchild、三个并发 child `9748/23336/11400`。所有进程同 AppContainer SID、零 capability、处于 Job、五个 slots 完整；五个后代实际 EOF/97-byte complete write 成立，root Null fallback/maps 为 `18/18`，launch 为 `7 calls/4 launched/3 rejected`。target exit 0、stderr 空、childErrors 空、Job 清理确认、无 loopback exemption。该运行 **pipe/client/realpath counters 都为 0**，相应验证继续引用独立 v1/v2 材料，不声称 v3 再次覆盖这些分支。

### 14.2 句柄数字复用与失败材料

父进程维持一个真正的可继承 named Event 直到全部 child close。首次严格句柄查询在 absent number 上触发严格句柄异常，随后“相同数字必须不存在”的测试又因 child 正常复用该数字而失败，均保存。最终使用一次有界 **1 MiB `NtQueryInformationProcess(51)` 本进程句柄快照**：parent 在 Event 存活时取得其真实类型索引；child 的该数字不存在，或存在且类型不同，才能排除 Event 继承。数字存在且同 Event 类型仍明确 unsupported，不推断成功；不再查询无效句柄，也不把父子数字相同等同对象相同。

独立结果校验器核对完整本地 source identity 集合、固定 runtime/ABI/布局、guarded 源码 bytes、根 NT/volume/FileId、六 PID lineage、十二 phase、精确 counters、journal digest、Event namespace/类型/存活及 bounded completion。Astra 发现原校验器未消费已采集的 childErrors，现强制数组存在且为空，并补 missing/null/object/已观察 PID 错误/未知 PID 错误五类负例。`diagnosticCompleted` 不作为独立证明来源。

原始失败/成功、最初与最终回读及派生摘要见[证据目录](./cli/evidence/gap-2026-10-05/windows-null-v3-2026-10-08/README.md)。公开版路径脱敏、完整 manifest/inventory 省略并明确改名；原件保留，派生文件不能用作准入票据。source identity 只证明内部完整性与字节绑定，不认证独立 compiler/build。

### 14.3 构建与回归

helper source 为 **`d1734f440aa747de167e7e609ad7a61b78a28205acb3595f3b253b04a292b170`**，DLL/EXE 已重建并通过 source contract。最初 addon 为 `185a7de9…`，CPP/header 为 `5d71ba4b…/ed162f4b…`；其 build record 的 preload `13857ca1…` 保留历史含义。Prettier 整理后的当前 preload 为 **`ac9cfb6d818d378f79127a93f3167161eb9e5f08b98f08fdcea186969b81c7ab`**。提交前统一 CPP/header 为仓库规定的 LF，摘要改为 `c9281636…/42bfb27b…`，重新构建和 selftest 后实际 addon 为 **`75e7a1629843e74347f35da17cb0a4c2ac571c25cf01d140c3b35cad9c24b62c`**；该新二进制已另跑真实隔离诊断，逐项回读 staged/source 字节，见 [clean-readback](./cli/evidence/gap-2026-10-05/windows-null-v3-2026-10-08/clean-readback.json)。没有重建 addon 后借用旧结果；LLVM-MinGW 构建仍非 hermetic，PE 时间戳导致的 hash 差异继续保留。

| 验证                                                             | 结果                |
| ---------------------------------------------------------------- | ------------------- |
| 最终 Node：准备/registry/准入/capsule/API/三代 adapter/结果/门禁 | **517/517，零跳过** |
| 当前 helper 实际运输、篡改及未列出文件拒绝                       | **3/3，零跳过**     |
| Vitest：原 v1、七项能力合同、review pack                         | **52/52，零跳过**   |

共 **572 个不同测试通过**；最初 512 项 Node 与后来的 517 项不相加，执行诊断不另算 xUnit 测试。纯 preload/result 测试加入 CLI CI 三系统，Windows factory 合同加入 Strict native 步骤，相关脚本和诊断纳入 path filters。原归档 567 项是加 childErrors 门禁前的历史记录，最终结果有独立 TAP/readback。

前序准确提交 `1e5477aebe1a69eba0932af915ea24ea545f66d7` 的 [Strict #37737538539](https://github.com/chainlesschain/chainlesschain/actions/runs/37737538539)、[Safety #37737538546](https://github.com/chainlesschain/chainlesschain/actions/runs/37737538546)、[Reliability #37737538595](https://github.com/chainlesschain/chainlesschain/actions/runs/37737538595)、[Host Diagnostics #37737538530](https://github.com/chainlesschain/chainlesschain/actions/runs/37737538530) 均成功；[CLI CI #37737538848](https://github.com/chainlesschain/chainlesschain/actions/runs/37737538848) 初次回读 queued，后续逐 job 回读发现 Linux unit shard 2/4 的 settings-permission-runtime 探针 status 0 时缺 JSON 输出。Worker message/exit 监听竞态的修复与验证见后续记录，其他 job 尚在执行，不能声称完整发布门通过。当前 v3 须新准确提交验证；本轮未发布。

### 14.4 新实际阻塞与未完成验收

冻结 config/default forks 的真实 v2 尝试中，**esbuild service 已启动并回复**，随后报告 `Cannot read directory "../../../../../../..": Access is denied`，再报告无法 resolve 绝对 staged `vitest.config.js`，target exit 1、cleanup true。当前只证明 esbuild 报告祖先目录读取失败，未取证具体底层 API/绝对目录；config 尚未加载、worker pool 未观察。该失败不是 NUL。诊断记录了 maxWorkers=1 与 configuration-default pool，不能作为完整冻结配置的通过结果。

v3 仅接纳 guarded `control/node.exe`，非 Node 的 esbuild launch 明确 unsupported，Node IAT 也不覆盖 Go/esbuild 内核调用。因此工程仍需独立解决冻结原 config/default forks/full review、非 Node 后代适配/证明与 GNU addon 整体 ABI；不能扩大祖先 ACL、修改冻结包/config、切换 forks 为 threads 或放宽 canonical 校验取得通过。Windows/macOS durable authority、活跃网络撤销及崩溃恢复也继续开放。

正式 target hosts/Node 22.12.0、官方账号/账单、独立人工 setup/check 签核、双 IDE 正式任务/公开首次安装、真人 NVDA/VoiceOver/Orca、8h/24h 与获批 SLO 仍缺验收。**36 tasks / 9 firstRuns / NOT_RUN / INSUFFICIENT_EVIDENCE**、$99 预算、原分母、正式 observations 和 CLOUD-02 条件项均未改变；本轮没有新增付费请求。

## 15. 2026-10-08 Worker 结算、锁释放与 GNU 工具链

### 15.1 CI 失败与实际修复

前序 `1e5477aebe` 的 CLI CI 最终为 failure：Linux unit shard 2/4 的 settings permission runtime 探针退出 0，却没有输出 JSON。Node 可以在同一回调内 drain 最后一条 Worker message 后立即 emit exit；原先等待 message 再注册 exit 的代码遗漏了退出事件，未结算的 Promise 不会阻止进程正常退出。新 `observeSettingsWriterWorker` 同步注册 message/error/messageerror/exit，只有唯一结果和 exit 0 同时成立才成功；错误、重复或缺结果保持失败。PM recovery aggregate 是前置 `verify-cli` 被跳过后的安全拒绝，没有降低该门。最终 69 个 job 的逐项状态见[完整回读](./cli/evidence/gap-2026-10-05/worker-lock-recovery-2026-10-08/ci-1e54-final.json)。

实际 WSL 文件系统还出现释放 rename 的 sharing denial 后，release marker 写入短暂 ENOENT。只在未发布 handoff、原 directory dev/ino、原 owner token、marker 缺失和原期限都仍成立时，最多重试三次；每次等待后重新核对，不重放 callback。新增同步/异步 16 项测试覆盖成功恢复、callback 原错误、复制 owner 的替换目录、新 token、已发布 marker、缺 inode、原期限与持续争用。接手时旧 `with-file-lock.test.js` 的 48,441 字节已全部为 NUL，原字节保存在本机 `.work/with-file-lock.test.js.corrupt-20261008`，源码从 HEAD 恢复；本轮变化另用新测试文件覆盖。

### 15.2 冻结 GNU addon 的真实隔离验证

冻结 `@rollup/rollup-win32-x64-gnu@4.62.2` 依赖 `libnode.dll` 的 41 个 `napi_*` 导出，本机固定 Node 全部具备。新增独立 PE export forwarder，每项必须指向当前 `node.exe` 同一个函数地址；bootstrap 核对真实 AppContainer SID、零 capabilities 和 Job。冻结 addon 字节不变，未进入生产 allowlist。

最终真实运行 PID **20840**，forwarder 为 `sha256:327fe76d30aceddfc534cd12f78bd4f7b15f1e9cd08cba2188094123bf52a329`。无 forwarder 时实际 `ERR_DLOPEN_FAILED`；加载后同步/异步 parser 均返回 168 字节、同一摘要，三个 hash 导出匹配独立 MSVC 对照，非法类型拒绝和输入变化反例成立。七个 journal 阶段、唯一 stdout、退出 0、stderr 空、无 loopback exemption 和空 Job 清理均核对。最终[构建](./cli/evidence/gap-2026-10-05/windows-gnu-forwarder-2026-10-08/build.json)、[原始报告](./cli/evidence/gap-2026-10-05/windows-gnu-forwarder-2026-10-08/report.json)与[journal](./cli/evidence/gap-2026-10-05/windows-gnu-forwarder-2026-10-08/journal.jsonl)保留字节绑定。该结果为 `NOT_ADMITTED`，只适用于本机 Windows 10 / Node 22.22.2 / ABI 127；LLVM-MinGW/compiler closure 不是独立认证构建。

### 15.3 本轮验证与继续开放项

| 验证                                                       | 结果                                         |
| ---------------------------------------------------------- | -------------------------------------------- |
| Windows 定向 Vitest：锁/异步锁/释放恢复/Worker runtime     | **74 通过，1 项 Linux 专属跳过**             |
| WSL Linux / Node 22.12.0 同组 Vitest                       | **75 通过，零跳过**                          |
| GNU PE/来源/结果篡改合同                                   | **36 通过，零跳过**                          |
| 四个真实进程、共 240 次严格锁写入                          | Windows、Linux 各 **1 项通过**；无丢失或重复 |
| helper 当前 source contract、定向 ESLint、格式、actionlint | 通过；actionlint 未启用 shellcheck/pyflakes  |

两系统重复测试不累计为新的正式任务样本，旧 572 项回归保留历史源码含义。GNU 与并发锁 Node 合同已接入 CLI CI 三系统；Strict 接入锁恢复回归。新准确提交还须自身完整 Actions 矩阵，本轮没有 npm/IDE 发布或新增付费请求。

完整冻结 config/default forks/full review 仍开放：原 esbuild service 已回复，但报告祖先目录 Access denied；独立非 Node trace 的进程创建与运行时注入按实际阶段另行记录，尚无足够证据关闭目录 API 适配。Windows/macOS durable authority、活跃网络撤销和崩溃恢复继续需要真实后端。正式目标宿主、官方账户/账单、人工 setup/check 签核、双 IDE 36+9/首次安装、真人辅助技术、8h/24h 和获批 SLO 仍缺验收。冻结 validator 再次确认 `sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0`、**36 tasks / 9 firstRuns / NOT_RUN / INSUFFICIENT_EVIDENCE**；原预算 $99、分母和 observations 保持冻结，CLOUD-02 仍为需求条件项。

## 16. 2026-10-08 非 Node esbuild leaf 诊断的真实阻塞

独立 `windows-esbuild-api-trace.mjs` 与 launcher/shim 不修改生产 v1–v3 或冻结 esbuild 包。launcher 使用固定映像摘要、受控 `CREATE_SUSPENDED`、精确四个 HANDLE_LIST、child-process-restricted leaf 策略，逐项核对根/子 AppContainer SID、零 capabilities 和 Job；只尝试真实 API 取证，不做错误码翻译或目录内容替代。

最终当前源码运行的 root **22736** / child **20368** 已完成上述身份和创建证明，但远程 LoadLibrary 的早期初始化以 **`0xC0000142 / DLL_INIT_FAILED`** 退出。shim 没有写出 identity/installed/API 行，trace 长度为 0；root exit 2、`completed=false`、`NOT_ADMITTED`、`cleanupConfirmed=true`、无 loopback exemption。完整[最终原始报告](./cli/evidence/gap-2026-10-05/windows-native-esbuild-trace-2026-10-08/report.json)与[空 trace](./cli/evidence/gap-2026-10-05/windows-native-esbuild-trace-2026-10-08/trace.jsonl)保持字节绑定；报告摘要为 `sha256:06197b1337b3f44491fe53cc4539417d2888dbd0d90ce37ee2cdf1fd69592d92`。最终 CPP/driver 摘要与当前源码一致。a/b/c/d/e/final/final-clean 的失败继续保存在本机 `.work/esbuild-api-trace-20261008-*`，未覆盖成成功。

固定 binary 使用动态 GetProcAddress；独立源码与 PE 检查显示需要取证 Go 的动态目录调用，而非依赖 Node IAT。当前没有实测到具体祖先路径/底层 API，因此不能将冻结 esbuild 源码的错误码解释提升为已经证明的运行根因。API hook 的安装、非 Node 受限运行时的完整继承和冻结 config/default forks/full review 仍需继续实现与真实验证。

纯解析/来源/身份/清理/连续序号/缺中间 API/错误 stderr/不完整注入的 **30 项回归**通过，并接入三系统 CLI CI。fixture 只验证校验器能拒绝缺证据，实际原生结果仍为上述失败。GNU 36 与这组 30 合同合计 66 个不同纯测试；正式 36+9、Windows/macOS durable 后端、官方账户账单和人工长时验收的状态保持开放。本轮没有付费请求、生产权限扩张或发布。

## 17. 2026-10-08 设置锁公平性与 esbuild 启动取证

### 17.1 用户指出的 Windows Strict 失败

[原job 113298272095](https://github.com/chainlesschain/chainlesschain/actions/runs/37773413407/job/113298272095)绑定`be17dfc48a2e8b440d984d00d3f98d9a78a406a3`：2692通过/1失败/11跳过。一个并发addRule writer在原两秒期限内未取得严格锁，owner仍alive且releasePublished=false。每次等待创建/删除candidate、连续writer释放后立即再抢锁，增加Windows元数据争用及饥饿风险。

修复`91924f202ecee89306fdd649df90f311e37debdf`等待活跃锁不创建candidate；absence仍须原子rename发布owner。addRule使用短抖动和释放后32ms让出，原两秒期限、活跃owner保护、单次callback、unknown commit和本进程同步撤销均保留。新增测试验证无candidate副作用、absence后其他owner抢占及释放后authority撤销状态。

Windows Node22.22.2、官方SHASUMS核验的22.12.0各136通过/1 Linux专属跳过；Windows/WSL Linux真实四进程各240次写入无丢失/重复。定向格式/lint通过。两次完整本机Strict失败原样保留：临时Node名字被身份校验拒绝（2680通过/16失败/11跳过）；改正node.exe后2695通过/1 headless恢复15秒超时/11跳过。该单文件保持原期限后来5项通过，不据此声称整组通过。见[原件及摘要](./cli/evidence/gap-2026-10-05/settings-lock-fairness-2026-10-08/README.md)。

该SHA的[Strict #37779098798](https://github.com/chainlesschain/chainlesschain/actions/runs/37779098798) Windows、Linux x64/ARM64、macOS15及额外macOS latest五job均成功，完整Strict成功；[CLI CI #37779105012](https://github.com/chainlesschain/chainlesschain/actions/runs/37779105012)仍执行/排队；尚未完整双门。后续native提交不能借用旧SHA作发布凭据。

### 17.2 esbuild 启动与真实 API

按用户允许请Astra协助，`fd713e0e72`将独立launcher改为DETACHED_PROCESS+原主线程APC加载shim。仅APC及无注入、保留旧console flags的对照仍DLL_INIT_FAILED；当前组合在真实零capability AppContainer完成加载，但不证明Windows内部loader根因。

最终root18140/child27164，同SID、零capabilities、固定映像、四句柄、leaf policy、无loopback exemption与空Job清理成立。11条trace含identity/installed/动态GetProcAddress/CreateFileW/GetFileInformationByHandleEx/exit。外层exit0、esbuild exit1、stderr原样Access denied，仍NOT_ADMITTED。CreateFileW请求`C:\Users`（access0，两次）及`C:\`（GENERIC_READ）均Win32 5；私有workspace真实handle枚举成立。requestedPath不代替canonical证明；Lstat祖先检查与递归ReadDirectory是不同操作，metadata修复不能替代根枚举。

[完整原件](./cli/evidence/gap-2026-10-05/windows-esbuild-detached-2026-10-08/README.md)摘要`acd7a7c6052f525442af455a9cd6e9dc4b4264f2843c45ca7d8539426ea425e6`，当前CPP/driver/实际产物一致。34项trace+36项GNU合同共70项通过，格式/lint通过；冻结包/config、API结果、祖先ACL、生产权限、forks和observations未改。

### 17.3 尚需完成

完整frozen config/default forks/review仍未通过。子进程私有命名空间须绑定监督器guarded真实NT根/FileId，不能以全局/全用户盘符、祖先ACL扩大、目录伪造或错误码翻译关闭本项。

Windows/macOS durable authority、活跃网络撤销、崩溃恢复仍需真实后端。目标宿主/Node22.12.0、官方账号账单、独立人工setup/check签核、双IDE正式36+9/首次安装、真人辅助技术、8h/24h和获批SLO缺证据；已请求用户提供环境与负责人，继续独立工程。36+9固定分母/NOT_RUN、$99预算和CLOUD-02条件项保留，无付费请求或发布。

## 18. 2026-10-08 私有 esbuild leaf 与发布候选

### 18.1 独立私有命名空间组件已真实执行

Astra新增独立非管理员直启监督器、固定shim、driver和结果校验器。LowBox自己设置ProcessDeviceMap实际ACCESS_DENIED，同用户非管理员宿主自设置成功；独立监督器直接创建受限leaf，凭自己持有的原始进程HANDLE设置私有映射，避免未受认证PID请求。根/源文件持有readonly guards，映射根由真实NT路径/FileId绑定。

最终root404/child21860，冻结esbuildexit0并生成真实bundle，20条trace验证X根枚举/entry读/bundle写及宿主根读拒绝、workspace写拒绝、路径遍历受限。零capabilities、精确5句柄、leaf、父映射三次absent/error2、原始child退出、空Job、profile删除和无loopback均成立。

主agent复核要求补强失败清理和未知映射状态。最后同一二进制实际创建child23712后在入Job前停止；原始HANDLE兜底终止、Wait0/exit125/Job0验证成立，不以空Job或PID不见作退出证明。原v1/v2失败、旧final、最终final-v2各自保留。

[完整原件](./cli/evidence/gap-2026-10-05/windows-esbuild-private-map-2026-10-08/README.md)报告摘要`3dbdd99d742a6e610b87af88644ee8cb210b23a10548b4a4415c3559284c4d2b`，CPP/driver/实际二进制/staged字节一致。61项合同在Node22.22.2、22.12.0均通过；原trace34+GNU36合计131个不同Node合同，两个runtime不相加。新合同接入CLI CI三系统，Strict path filters齐备，未将原生诊断加入生产allowlist。

**仍NOT_ADMITTED**，只完成固定entry leaf。完整esbuild service、冻结config/default forks/full review尚未接入；compiler closure非hermetic，正式Win11/Node22.12 target仍待验。Windows/macOS durable、官方账户账单、独立人工、正式36+9及真人长时验收保持开放。

### 18.2 用户授权的配对发布准备

用户明确允许测试成功后发布CLI和两IDE。候选CLI0.166.94 / OpenVSX0.37.139 / JetBrains0.4.157，配对推荐值、lock、changelog与用户升级说明已同步。10个固定子包逐个从官方registry下载并核对SRI/manifest/下游版本，本轮无子包源码改动，无需重发；[子包回读](./cli/evidence/gap-2026-10-05/release-0.166.94/child-registry-readback.json)。

候选本机CLI相关74项、VSCode21项通过；JetBrains946项JUnit通过/3跳过、1445项smoke assertions及ZIP构建成功。第一次JetBrains候选失败暴露Doctor跨类常量内联保留0.166.90而升级推荐已94；改为共享运行时访问器，保留原测试，重新构建通过。后续完整准确SHA的CLI双门与IDE宿主矩阵才作发布依据，不借用91924f202e的旧完整Strict结果。

正式36+9的NOT_RUN、$99预算、原分母和observations保持冻结。发布继续OIDC、子包→CLI→IDE顺序；本节是准备记录，尚未声称候选已发布。

### 18.3 最终源码字节重新验证

shim EOF 多余空行移除后重编译并真实运行 v3，root19628 / child23440 / exit0、20条 trace、父映射明确 absent、原始 HANDLE 与 Job 清理成立；未入 Job 负例 child25900 / exit125 也确认清理。最新 [v3 原件](./cli/evidence/gap-2026-10-05/windows-esbuild-private-map-2026-10-08/final-v3/report.json) SHA256 `e0e346fa05b7df5fc90a87e538188afa2d11a0c27361c0097f88b3bf860e6a02`，源码/driver/实际二进制/staged 一致，61项合同通过。v2 保留历史，不能借用旧摘要绑定新源码。

旧 `91924f202e` 的 CLI CI #37779105012 最终失败：Windows/macOS 工具链准备测试输出父目录被判定为 path alias，导致后续验证未运行和 PM 三系统汇总拒绝；即使原 Strict 全部成功，也未取得双门通过。该失败必须修正后用最终准确 SHA 重跑完整门。

### 18.4 跨平台准备 fixture 修正

旧 CLI CI #37779105012 的 Windows/macOS 失败已定位到测试临时目录别名；fixture 现使用 canonical realpath，并新增真实 symlink/junction 父目录拒绝回归，生产严格检查未放宽。两 Node 版本各37项通过，最终准确 SHA 全矩阵待执行。 macOS /var 与 Windows runner 临时目录可以具有平台别名；fixture 对自己新建的临时目录使用 `fs.realpathSync.native` 后传入准备器。新增实建 symlink/junction 的拒绝测试，确认目标目录没有新增文件。生产准备器零修改，原失败/负例断言保留。Prettier、定向 ESLint 通过。

## 19. 2026-10-09 准确提交完整门与 OIDC 发行

准确发行提交 `efcab5f632312aea433953157d52091f018f26ae` 的 CLI CI 71 个 job 全部成功，Strict 5 个 job 全部成功，IDE PR 实际宿主/构建门 18 成功、1 个非 tag Marketplace 验证跳过。GitHub macOS arm64 容量取消的 13 份原件均无 runner、无测试步骤；恢复保留原 63 个成功任务的执行时间，缺项实际执行，三个 verify-cli 首次执行于 attempt 4，同轮 PM 产物完整汇总。PR #423 已合并，原失败、恢复、完整工作流及 PR 1994 文件通过/7 跳过的原始计数出处见[发行证据](./cli/evidence/gap-2026-10-05/release-0.166.94/README.md)。

CLI `0.166.94` 已通过 GitHub Actions OIDC 发布，公开 tarball 与候选完全一致，签名/provenance 有效。10 个既有子包版本复用，并实际完成 registry 下载/安装核验。VS Code 标签流程 #37824729954 为 11 成功/3 渠道跳过，JetBrains 标签流程 #37824729100 为 13 成功/6 渠道跳过；两个标签均固定于同一准确 SHA，上传前各自重新验证公开 CLI 和 10 个固定子包。

Open VSX `0.37.139` 已公开，latest/listed/downloadable 均成立，公开 VSIX 与标签候选字节及内容摘要一致。JetBrains `0.4.157` 的 update `1189859` 已 approve/listed、未 hidden；公开 ZIP 的容器字节与标签 ZIP 有差异，全部解压 entry 的字节逐一相同，未将两者描述为原始 ZIP 字节一致。实际产物的 Doctor/推荐版本检查通过。Microsoft Marketplace 为未配置凭据的独立可选回填渠道，本轮未发布。正式 36+9、预算、observations 及未关闭工程/人工条件保持原状，无新增付费 provider 请求。

## 20. 2026-10-09 剩余工程与验收边界

本轮由 `976c4f394fbab4fccc041787051f00abe08113c9` 开始，工作分支为 `feature/cli-ide-gap-completion-20261009`。本节描述工作区代码与实际诊断，不借用第 19 节的发行门作新代码的完整 Actions 凭据。用户允许遇到问题请 Astra 协助，Windows service 与 Job 原语分别由 Astra 实现，主 agent 复核清理、来源绑定、失败保存和 CI 接线。

### 20.1 MODEL-04 保存可复核的审查证据

此前 [Model Catalog Review #37297653237](https://github.com/chainlesschain/chainlesschain/actions/runs/37297653237) 确实成功，但 Actions artifact 回读为 **0**；仅凭绿色日志无法重核上游页面原始字节。本轮 `review-model-catalog.mjs --output FILE --expected-sha SHA` 保存实际 HEAD、所读源码的 dirty 状态及字节摘要、预审 fixture 摘要、上游页面原始摘要和审查结果。解析失败与发现漂移仍保存失败报告，输出用 `wx` 拒绝覆盖；16 MiB 有界读取使用已打开的文件并核对读取前后状态，UTF-8 BOM/换行不改变原始摘要。只有同时提供两份上游材料才标记 snapshots complete；provider、账单和产品身份始终没有被此工具验收。

工作流准确 checkout PR HEAD，保留本地/上游报告与原页面，成功、漂移或后续步骤失败均上传 90 天 artifact。报告不会自动修改型号或扩大能力。7 个新 Node 合同覆盖漂移退出码 2、错误页、只提供一份材料、错误 SHA、过大输入及拒绝覆盖，另保留 7 个模型目录 Vitest 回归。[本轮本地报告](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/model-review-local.json) 明确 `reviewedSourcesDirty:true`、`upstreamSnapshotsComplete:false`，不是重新验证了最新上游发行；旧 workflow/artifacts 原件也已归档。

### 20.2 Windows 双向 esbuild service 与冻结配置

独立 private-map supervisor 增加固定 `--service=0.28.1 --ping` 路径，将真实匿名管道传给仍受 leaf policy、零 capability AppContainer、原始 Job/HANDLE 和私有设备映射约束的冻结 esbuild。宿主侧调用未修改的冻结 `esbuild/lib/main.js`；该 JS client 明确在 AppContainer 外。实际请求包含 bundle、TypeScript transform、非法语法负例及冻结 `vitest.config.js` bundle，原 `pool:"forks"` / `maxWorkers:2` 保留。

配置编译成功不表示已执行配置模块、globalSetup 或 worker pool。后续完整配置尝试与最终源码证据单独归档；不得把宿主侧的 config bundle 升级为完整 frozen config/default forks/review 成功。完整 native review 准入保持拒绝，原冻结包/config、祖先 ACL、生产权限和任务分母没有修改。

复核新增 service 路径后补齐四处证据缺口：原生等待记录真实 `WAIT_TIMEOUT`/deadline/error；服务启动前后重新核对 supervisor/shim 产物；结算文件启动前在受保护 root 下以 `CREATE_NEW` 预开非继承句柄，拒绝子进程可写 scratch 路径；最终校验拒绝 `completed:false`、error 或 settlementError。新增 50 个 service 合同含重新封装后的来源、配置、父映射、失败标记和产物篡改负例。[最终 v2 实跑](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/esbuild-private-service-final-v2/report.json) 使用这些最新源码，真实 service 正常退出、原始 HANDLE/Job 清理及 profile 删除均成立，仍 `NOT_ADMITTED`。

[完整配置的最终尝试](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/esbuild-private-frozen-attempt-final/report.json) 是另一个 .work 独立实验：root 4688 / Node 4908 已建立私有 X 根并核对 NT/FileId，builtin 导入完成，Vitest 导入开始后没有完成；45 秒 `WAIT_TIMEOUT=258` / error 1460 后终止 child，exit 125、Job 0/profile 删除均确认。没有观察到配置加载或 worker，不能将该超时归因为某个未经取证的底层 API。初始沙箱拒绝 host-token 的失败与真正启动后的失败分开保留。现有 v3 对 guarded `control/node.exe`、实际 process.execPath 和单一物理根有严格合同，直接放入 X 别名会破坏这些证明；成对逻辑/物理身份及非 Node 同 SID/Job 后代继承须独立实证，不能通过改冻结 config/pool 或增加祖先 ACL 规避。

### 20.3 Windows owner 崩溃后的原始 Job 回收原语

新增独立非管理员 `windows-job-recovery-probe.cs`、运行器及只读 validator。custodian 保留同一个 unnamed Job 的原始 HANDLE；任务 owner 在暂停时入 Job，才恢复执行，再启动 child/grandchild。三个 fixture 各有真实 TCP challenge，外部 conhost 也在 Job 中，不能靠预期固定 PID 数判断空组。真实错 Job 和旧 execution nonce 均被拒绝，全部连接继续可用。

最终 [report](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/windows-job-recovery-final/report.json) 中 owner 被终止后，其原始 HANDLE 已 signal、连接关闭，但两个后代仍回应且 Job 有 4 个活跃成员。显式终止保留的 Job 后，必须同时有 `ActiveProcesses=0`、三个保留进程 HANDLE signal、两个后代 socket EOF/reset，才确认本次清理。read timeout、PID 不存在、删除记录、owner 退出均不能替代这些证明。另真实注入暂停进程尚未入 Job 的失败：保留原始 process HANDLE 独立兜底终止并等待，原件保持 exit 2 / `completed:false` / `cleanupConfirmed:true`。异常清理中 Job 与 owner HANDLE 两段独立执行，前一段失败不阻断后一段兜底。

最终源码重编译实跑，记录四文件源码/快照前后摘要、编译器/产物摘要、原始输出字节摘要、时间和实际 Windows `10.0.19045`。20 个合同分别在 Node 22.12.0 / 22.22.2 通过，两个 runtime 不累计为新样本。最初因 Job 中真实 conhost 数量与预期不同造成的失败原样保留，随后改为查询整个 Job 的空屏障。这是 surviving custodian 原语，始终 `trusted:false / NOT_ADMITTED`：没有证明 custodian 自身崩溃后恢复、恶意同 UID 隔离或 WFP 活动连接撤销，compiler closure 也不是 hermetic。

### 20.4 剩余项的实际完成条件

| 项目                                        | 已有工程/本轮交付                                                                                                           | 仍需完成                                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODEL-03 / PERF-02                          | 精确型号、价格、reasoning/usage 合同和已有火山采样；本轮保留既有结果                                                        | 官方 GPT-6.1 Sol / Sonnet 5.5 账号的 stream/tool/reasoning、usage/账单与校准验收；正式冻结任务另使用原计划型号                                                  |
| MODEL-04                                    | 原审查 CI 成功回读；新增准确源码、输入和失败产物保存                                                                        | 新工作区的准确提交 Actions 结果及持续上游审阅，不把旧成功转移到新代码                                                                                           |
| PERF-03 / MAINT-02                          | 已有 Memory 规模测量/索引和模型合同去重                                                                                     | 获批 SLO、独立维护工时/成本记录；不由测试数量推导维护收益                                                                                                       |
| VERIFY-02                                   | Linux Docker 36 题/42 行为反例的历史完整结果保留；Windows 同 SID/Job service、原冻结配置/default forks 的 65 项真测试已完成 | 完整 Windows 12 题及对应行为反例的 native review、macOS 独立 checker、人工 setup/check 签核与正式任务采集                                                       |
| PLATFORM-02 / NET-02                        | Linux controlled-host 接线，Windows surviving custodian 原始 Job/socket 回收及 custodian 自身崩溃的有限集合清理原语         | Windows 受保护持久服务/authority/journal、服务自身崩溃恢复、WFP 或等价既有流撤销；macOS 真宿主、受保护签名安装及系统网络执行机制                                |
| BRIDGE-02 / MCP-02 / CODEX-02               | 已有 Linux cgroup 可信恢复、参考 MCP 真进程矩阵和 Codex 0.160.0 探针                                                        | 不扩大旧 PID-only 或同 UID 对抗声明；外部 OAuth/真实 provider 及生产 Codex 准入按其独立条件验收                                                                 |
| IDE-READY-02 / IDE-ONBOARD-02 / IDE-COLD-02 | 已公开配对发行的 Doctor、身份、120 秒初始化工程与历史宿主矩阵                                                               | 正式目标宿主的真实 provider/hooks、首次安装及发生率；无需重复实现已有功能                                                                                       |
| VERIFY-IDE-02                               | 双 IDE 真实火山/重启零重放的历史诊断保留                                                                                    | 原 36+9、Windows 11 24H2 / Ubuntu 24.04 / macOS 15、Node 22.12.0、IntelliJ 2025.2 / VS Code 1.132.0 的独立正式验收、真人 NVDA/Orca/VoiceOver、8h/24h 与获批 SLO |
| CLOUD-02                                    | 保留 self-hosted handoff 和 `resume:not-implemented`                                                                        | 需求条件项；未获跨机器 resume 需求确认，不作为已承诺待交付功能                                                                                                  |

此外，`verify-17` 冻结目标是 macOS VS Code，其唯一 journal baseline 显式 `skipIf(platform !== "linux")`。现有 native admission 已分别保留平台不匹配和 `BASELINE_PLATFORM_UNSUPPORTED`，不能伪装在 macOS 跑过该基线；需要计划负责人独立处理这处冻结规范冲突。本轮没有修改计划。

本阶段 6 文件 **208 个 Node 合同**全部通过：旧 trace/private leaf/GNU 131、service 50、Job 20、model evidence 7。Windows Node 22.12.0 / 22.22.2 和 WSL Linux Node 22.22.2 各 208/208，零跳过，三个 runtime 的重复执行不累计为 624 个不同用例；另 7 个既有模型 Vitest 回归通过，合计 **215 个不同测试**。纯合同已加入 CLI CI 三系统，Strict path filters 覆盖新原生脚本/validator；定向 ESLint、Prettier、actionlint（shellcheck/pyflakes 未启用）通过。此统计不包含后续尚在实施的映射继承实验，也不是新准确提交的完整发布门。

### 20.5 继续接通受限 Node 后代的实际 API 证据

为避免把完整配置阻塞归因于“需要管理员”，另行实施最小后代继承探针。在 [e 原件](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/esbuild-private-inheritance-e/report.json) 中，host 14636 → Node 27196 → esbuild 9080 使用同一 AppContainer SID、零 capabilities；初始 Node 的私有 X 根/NT/FileId 证明成立。child shim 经实际 `GLOBALROOT` 路径加载，在任何 patch 前真实 `CreateFileW("X:\\")` 返回 **Win32 3 / PATH_NOT_FOUND**。前序 trace 为空的尝试只说明未取到证明，不能据其断定映射缺失；e 才证明这次创建路径没有可用的 X 映射。

随后 [f 原件](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/esbuild-private-child-map-denial-f/report.json) 中 LowBox Node 24860 对自己原始 `CreateProcess` 返回的 child 2244 HANDLE 调用 `NtSetInformationProcess(23)`，实际返回 **0xC0000022 / ACCESS_DENIED**。没有借用先前“低箱自设映射失败”代替这次子进程句柄结果；child exit 125 和最终空 Job 清理也已确认。

因此继续实现的路径是由外部非管理员监督者受控创建同 SID/同 Job 后代并设置其映射，调用者身份必须绑定初始原始 process HANDLE 和独占管道。参数/映像/stdio 须固定或经过私有 manifest 验证，不接受未经证明的 PID 作为授权，不把 host/Job HANDLE 交给低箱。成对物理 NT/GLOBALROOT 和逻辑 X 名称需要实际持有的 FileID/NT/摘要证明，不能映射整个 C 卷或放宽为字符串别名。此段只记录已取证的前提与实施方向，尚未宣称完整 config/forks 通过。

已向用户询问正式目标宿主、官方账号费用授权和人工验收负责人，尚无这些资源的回复。本轮没有付费请求、发行或正式 observations。再次调用原只读采集器，真实 exit **2**、**36 task / 9 firstRun observed=0**、`NOT_RUN / INSUFFICIENT_EVIDENCE`，总费用仍 null；原窗口、$99、分母和 [冻结摘要回读](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/frozen-collection-summary.json) 保留。缺少正式记录不表示零费用实测，也不等于失败任务被移出分母。

### 20.6 最终 v4 接通原冻结配置与默认 forks

独立 v4 broker 由非管理员 custodian 创建受控后代，逐一证明相同 AppContainer SID、零 capabilities、同一个 Job 和私有 X 映射。每个调用者使用绑定宿主保留原始 process HANDLE 的独占通道注册；worker 与固定 Rollup report-helper 各有 guarded manifest/registration，helper 不计作 worker。actor 回执明确记录真实 OS parent 为 `host-broker-created`。物理 NT/GLOBALROOT 与逻辑 X 名称由实际打开的根/runtime HANDLE、卷号、FileID 和 SHA 配对，宿主/Job HANDLE 不传给低箱。

最终 [original 原件](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final2-original/report.json) 使用当前 9 份 native/CJS 源码，加上 driver、validator 和依赖校验 helper 的 **12** 份最终字节；[独立源码回读](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final2-source-readback.json) 重新读取原件和本机实际编译产物，严格 inspector 返回 `diagnosticVerified:true / errors:[]`。host **19464**、root **19144**、esbuild **1804**、helper **1332**，冻结原配置 `pool:"forks" / maxWorkers:2` 的 `model-capabilities.test.js` **65/65 通过**；root/helper/service exit 0、stderr 空、Job 0、profile 删除及原始 HANDLE 清理成立。实际 guard **9,632 / 48,000**；较早的 s 原件保留原 guard/source 时点。

worker **26564** 的最终 exit 1 仅由严格 op4 证明接纳：parent registration 与 creation sequence 匹配，caller 中的 HANDLE 经 `DuplicateHandle` 和 `CompareObjectHandles` 对等，调用前真实 `WAIT_TIMEOUT=258 / STILL_ACTIVE=259`，实际 `TerminateProcess` 成功后 wait 0/OS exit 1。任意 worker exit 1 仍拒绝。Node exit callback 现在标记 `process-exit-intent`，只在此完整 op4 证明下允许保留可选 callback 回执与 OS 最终值的差异；root/helper 仍要求双回执与 OS 值一致。已自然退出的 worker 则对原 HANDLE 实际调用 Windows API并回传真实失败，不虚构终止成功或中止整个 broker。历史竞争失败原件独立保留。

Worker 线程复用同一进程已验证的 adapter，不再次安装或写进程生命周期回执，仍重新校验 paired identity。最终完整 review 的图像 Worker 回归结果单独列在后续条目。所有成功创建的进程在入 Job 之前就登记外层原始 HANDLE；Job 清理与未入 Job 的 process HANDLE 兜底分别确认。

冻结项目源码另从准确 Git `b2aa3aba082873570e85dce39b00754e5504ff37` 导出 **4,811 文件 / 73,135,639 字节**，逐 blob 核对 Git SHA-1 并记录 SHA-256，closure 固定摘要为 `b8a63ab9af6e4d9be9469af2c07416d350b5a1f70301b40d8f89ffbc0f1ea658`。validator 强制固定摘要与 config/test 的 closure 绑定，自描述 commit/摘要不足以通过。SQLite `12.11.1`、bindings/file-uri-to-path 及 undici 均按原 lock registry SRI准备；SQLite 官方 ABI127 预编译包还与 GitHub asset digest/size 对等，[首次依赖](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/frozen-sqlite-dependency-provenance/manifest.json)与[完整依赖补齐](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/frozen-undici-dependency-provenance/manifest.json)原件分别保存。没有执行生命周期脚本或借用当前开发 node_modules。

本项只关闭指定原配置/default forks 的工程接通，状态保持 **`NOT_ADMITTED / fullFrozenReviewCompleted:false`**。当前实际宿主为 Windows 10 / Node 22.22.2，LLVM-MinGW/compiler closure 非 hermetic，编译二进制原件留本机。完整 Windows 12 题及 macOS review、Windows/macOS durable authority、服务自身崩溃恢复/WFP、正式目标宿主/账号/人工验收继续独立开放。

### 20.7 完整 Windows 基线、精确依赖与真实拒绝条件

完整 12 题按冻结 Windows IDs `01,02,03,10,11,12,19,20,21,28,29,30` 选择 **12 个去重文件**，使用原 external JSON config、`forks/maxWorkers:1`、原 globalSetup/setup 字节和 JSON reporter。原配置 65 项的 `maxWorkers:2` 与这份 review 配置分开记录。最初缺 SQLite/undici/chalk 的模块导入、Worker 线程重复安装、自然退出与 op4 竞争，以及空 `.gitkeep` 被旧 capture 拒绝的失败原件分别保留。

本轮从原 frozen lock 准备 **348 个必需 registry 包**与 workspace 目标，再加精确可选版本隔离/传递源码，共 **389 包、18,804 文件、195,368,619 字节**；保留 `packages/cli/node_modules` 等原嵌套版本布局和 workspace alias 的 1,218 个嵌套镜像。所有 tarball SRI、来源文件和复制前/后实际字节均验证，15 个零字节文件保留真实空 SHA-256，没有删除文件以规避读取器。[完整依赖及 preflight](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/frozen-cli-runtime-closure/manifest.json) 原件保存，manifest SHA 为 `5bfc483de04a94957f1a979eee01f3079f613afd192f15dfd1fd203ac04d4db9`。native 可选源码未运行安装/编译，不能仅凭下载完成认定全部 optional ABI 可执行。

预检 **32,045 文件 + 4,212 目录 = 36,257 节点**，既有文件冲突 0；据此把仅限私有树的 guard 固定上限从 16,000 改为 **48,000**，超限仍拒绝，原 6 进程/每进程 768 MiB 限额和 namespace/ACL 权限未改。完整实跑 guard 与 preflight 精确相同。新 helper 仅接受固定 closure 派生的 workspace roots，拒绝跨 namespace、路径遍历、设备名、symlink/hardlink、文件变化或字节不符；manifest 不能自行授权 roots。driver 对来源及 staged 文件在复制前后实读，inspector 重读留存的来源和 artifact，并核对来源、复制前/后的描述符及 manifest；结束后已删除的 staged 树不由 inspector 再次读取。

最终[完整基线原件](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-full-baseline/report.json)实际 **211 项：194 通过、16 失败、1 跳过**；12 文件全部加载，模块收集错误为 0，permission-decision **4/4**。原始 root exit 1，service/helper 和后代原 HANDLE 已结算，Job 0/profile 删除；native settlement 只剩 baseline 要求 root 0 的四条业务结果错误，依赖、身份、映射及清理没有错误。frozen parser 同时拒绝真实失败和 `skipped`。这是一份完整失败报告，不能标为完整 Windows review 通过。

失败的实际条件如下：

| 范围                  | 真实证据                                                                                                                                                | 完成前提                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| headless-stream 14 项 | `CC_SETTINGS_SOURCE_UNAVAILABLE` 的实际 cause 为 **`EPERM / lstat / C:\Users\longfa\.claude\settings.json`**；冻结观察器只用 Node fs，未调用 PowerShell | 真实读取或真实证明选中 home/project/managed 候选缺失，并验证最近存在父目录身份。默认 managed 路径来自源码，当前执行停在 home，未证明随后 ProgramData 的 errno；不静默改为空 profile 或伪造 ENOENT |
| journal 1 项          | `owner-only ACL process failed [windows-acl:spawn]`；冻结合同要求单一用户 SID ACE，AppContainer 授权与其当前精确合同不同                                | 真实隔离检查器/受保护后端及 owner ACL 证明；不能任意开放 PowerShell 或补一个 AppContainer ACE冒称 owner-only                                                                                      |
| junction 父目录 1 项  | 实际 tag **`0xA0000003`**、attributes `0x410`、FSCTL 读取成功；substitute 为 `\??\Global\C:\...`，Node lstat 返回普通目录、readlink 为 `EINVAL`         | 固定 Node/libuv 只识别 `\??\<drive>:\`，随后回退 stat；新的兼容层须独立证明真实对象、范围、置换和缓冲/原错误，或由负责人重冻结源/runtime；不能翻译 errno、伪造目录类型或信 PrintName              |
| 原 Windows 平台 skip  | 实际 assertion status 是 **`skipped`**，`numPendingTests:1`；冻结 baseline parser 只允许 `pending`，candidate/mutant 均拒绝跳过                         | 保留原始拼写与冻结 gate；由计划负责人处理兼容性/平台条件，不能归一化原报告取得通过                                                                                                                |

macOS `verify-17` 与 Linux-only journal baseline 的既有计划冲突仍独立开放。上述失败不会移出原 36+9 分母或改写 observations。另有 exact **9 任务子组** `01,02,03,10,12,20,28,29,30` 的所有对应文件实际通过，组合基线 **159/159、零跳过**，原 parser 与 native settlement 均成立；其作用限定为后续这 10 个行为反例的真实前置基线。其余 4 个反例因对应基线不成立保持 `NOT_RUN`。

### 20.8 最终合同、基线绑定与验收状态

矩阵启动前的 9 文件 **408 个 Node 合同**：既有 trace/private leaf/GNU/service/Job/model evidence 208，新 identity 62、result 96、dependencies 42。Windows Node 22.22.2 / 22.12.0 和 WSL Linux Node 22.22.2 各 **408/408、零跳过**，不同 runtime 不累计；另保留当时已通过的 7 个模型目录 Vitest，该时点共 **415 个不同测试**。后续新增合同及最终权限边界见 20.13；原配置 65 项与组合基线 159 项有重叠，单独记载且不相加为新的正式任务样本。

新增 fixture 在默认沙箱 Node 22.12 初次产生 24 个 `realpathSync` 祖先 `lstat EPERM`，原失败与主机权限复核均保留。仅把两个测试 fixture 改为既有 `realpathSync.native` 惯例后，最终默认沙箱 408/408 成立，生产 helper/validator/native 字节未改；Linux 重跑也通过。最终 [Windows 22.22](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/final3-node22.22-windows.json)、[Windows 22.12](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/final3-node22.12-windows.json)、[Linux](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/final3-node22.22-linux.json) 保存各自源码前后稳定性和 TAP。

mutant 必须提供 `--baseline-report`：启动前重新验证其原 parser/native0、对应完整 baselineTests 覆盖、source/driver/validator/helper/Node/preparation/依赖以及 review specs/runtime 字节一致。[失败 full baseline 的预启动拒绝](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-failed-baseline-refusal/report.json)保持 compile commands 为 0、没有 capsule/native execution。行为反例只能在[实际通过的 159 项基线](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-clean-baseline/report.json)上执行，语法/import/runner 错误无法充当行为断言拒绝；每题新鲜 capsule 的原 HANDLE 结算独立记录。最终[矩阵索引](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-matrix-index.json)记录 **10 个反例 / 11 次尝试**：6 个检出、4 个存活，另 4 个因失败基线保持 NOT_RUN。11 次尝试均使用与组合基线相同的 12 份 producer 来源，未修改原报告或 source byte binding。

| 反例                                                                                                           | 原始结果：total/pass/fail | 冻结门结果                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [01](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-01/report.json)             | 75/57/18                  | 检出，baseline/parser/native1 均成立                                                                                              |
| [02](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-02/report.json)             | 75/70/5                   | 检出，baseline/parser/native1 均成立                                                                                              |
| [03](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-03/report.json)             | 31/30/1                   | 检出，baseline/parser/native1 均成立                                                                                              |
| [10](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-10/report.json)             | 2/1/1                     | 检出，baseline/parser/native1 均成立                                                                                              |
| [12 重试](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-12-retry1/report.json) | 11/11/0                   | 存活 / OPEN；[首次辅助进程失败](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-12/report.json)另存 |
| [20](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-20/report.json)             | 4/4/0                     | 存活 / OPEN                                                                                                                       |
| [28](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-28/report.json)             | 14/13/1                   | 检出，baseline/parser/native1 均成立                                                                                              |
| [29](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-29/report.json)             | 19/19/0                   | 存活 / OPEN                                                                                                                       |
| [30a](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-30a/report.json)           | 13/12/1                   | 检出，baseline/parser/native1 均成立                                                                                              |
| [30b](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-final-mutant-30b/report.json)           | 13/13/0                   | 存活 / OPEN                                                                                                                       |

六个检出均来自真实行为 AssertionError，模块收集错误为空；业务 root exit 1 与预期相符，不能要求失败业务也 `completed:true`。四个存活报告实际 root exit 0、cleanup/Job0/profile 删除成立；parser 与预期 root1 的 native settlement 正确拒绝，不能把成功清理升级为检出成功。verify-11 两个、verify-19 一个、verify-21 一个反例因对应基线不成立未启动。

纯合同接入三系统 CLI CI，Strict 路径过滤覆盖全部新 helper/validator/诊断；定向 ESLint、Prettier、actionlint（shellcheck/pyflakes 未启用）以及 spawn inventory 生成/检查通过。本轮不发布 npm/IDE，不把第 19 节旧 SHA 的完整绿色转移为本轮发布资格。官方账号/账单、正式目标宿主与独立人工 setup/check、辅助技术听测、8h/24h、获批 SLO、受保护 durable/WFP/macOS 后端及原 **36+9 / NOT_RUN / INSUFFICIENT_EVIDENCE** 继续按 20.4 独立开放。

### 20.9 已完成增量提交与真实上游来源修正

用户要求已完成工作提交到 Git，首批代码及原始证据已提交 `61d91325d0f30b60ec7ce14157e153a9a159707f`，推送到本节 feature 分支并创建[草稿 PR #425](https://github.com/chainlesschain/chainlesschain/pull/425)。提交前核对 707 份暂存证据与 index 原始字节一致，32 份 archive manifest 的 623 份原件大小及 SHA-256 成立；原始 CRLF 未被 Git 归一化。

该准确提交的 [Model Catalog Review PR #37896217862](https://github.com/chainlesschain/chainlesschain/actions/runs/37896217862) 成功，实际上传了[可回读报告](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/model-catalog-pr-61d91325d0/local.json)，`reviewedSourcesDirty:false`、本地合同成立；PR 条件不取上游页面，因此 `upstreamSnapshotsComplete:false`。其 [Strict #37896217679](https://github.com/chainlesschain/chainlesschain/actions/runs/37896217679) 五个 job 全部成功，包含 Windows、Linux x64/ARM64、macOS 15 与额外 macOS latest，[原始 API 回读](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/strict-61d91325d0/readback.json)保留准确 SHA、实际 runner 和时间。[CLI CI #37896218097](https://github.com/chainlesschain/chainlesschain/actions/runs/37896218097)也已完整成功，实际 71 个 job 均成功，[原始回读](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/cli-ci-61d91325d0/readback.json)保留全矩阵；这些结果只属于 `61d91325d0`，不转移到后续提交。

另外实际触发[上游审查 #37896537269](https://github.com/chainlesschain/chainlesschain/actions/runs/37896537269)，两个官方页面抓取成功，但 Codex 版本解析失败，失败步骤之后仍上传原页面和报告。[失败原件](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/model-catalog-upstream-61d91325d0/upstream.json)没有被改写。实际混合 changelog 的版本来自 app/mobile，唯一 `rust-v0.36.0` 链接位于旧条目正文；它没有可核的最新 CLI 版本，不能从任意 semver 推导。

修正已另提交 `a45b76290d`：workflow 固定取官方 `openai/codex/releases/latest` JSON 并保存响应头，parser 核对 stable `rust-vX.Y.Z`、同仓库同 tag 的精确 URL、`draft:false` 与 `prerelease:false`；错误仓库、缺字段、非 stable、错误页及 script/style/navigation 噪声均拒绝。Claude MDX 保留真实 Update label，并排除惰性内容中的假 label。31 项模型目录 Vitest 与 9 项 Node 证据合同通过，不更新原审查事实或自动启用模型。

本地用实际 API 原字节完成[新来源审查](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/model-catalog-api-final-workspace/upstream-api-final.json)：Codex CLI **0.162.0**、Claude Code **2.1.295**，`reviewCompleted:true / reviewRequired:true / automaticEnablement:false`，[真实退出码为 2](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/model-catalog-api-final-workspace/upstream-api-final-execution.json)，表示相对 10-05 基线发现漂移。报告保留当时 dirty 源码状态，不冒称新准确提交的 Actions 结果，更不验证 provider、账单或正式任务。

### 20.10 当前依赖的 critical 阻塞修复

`61d91325d0` 的 [Code Quality & Security #37896217923](https://github.com/chainlesschain/chainlesschain/actions/runs/37896217923) 中 Security Audit 的 critical 检查失败；其他已执行的规则、格式、数据库和构建 job 成功。原始 job/step 回读及日志 API 的 HTTP 403 拒绝[分别保留](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/quality-61d91325d0/readback.json)，不凭无权限读取的日志推断漏洞细节。

随后本地只读 npm 审计确认 Handlebars 4.7.9 在 `GHSA-8r5x-fm3f-whwj` / `GHSA-p8wg-vrv2-v86f` 的受影响范围内。最小升级另提交 `abd2c2155b`：desktop manifest 最低范围为 `^4.7.10`，root、desktop 与 contracts 三份现行 lock 的该节点使用官方 4.7.10 resolved/SRI；仅将其 minimist 范围收紧为官方 `^1.2.8`，既有解析版本 1.2.8 满足要求，其他依赖节点未改变。

[独立验证](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/handlebars-security-20261009/summary.json)核对官方 metadata、tarball SRI、完整依赖语义与实际解析路径，测试专用 preload 将生产 template-manager 指向精确下载的 **4.7.10**，实际 45/45 模板测试通过。本机 node_modules 没有升级，不能把该验证描述为正常安装后的完整应用测试。只读审计真实 exit 1，Handlebars 漏洞消失，仍有 1 critical `decompress` 与其他较低级别问题；原仓库已有该未修复包的豁免，没有新增豁免或宣称 clean audit。操作前后四文件摘要稳定；无 install/lifecycle，冻结项目、lock 和 runtime closure 原件均未修改。后续准确提交的 Actions 才是新代码的完整门，本轮不发布。

### 20.11 custodian 自身崩溃后的有限集合清理

新增独立 `windows-job-custodian-crash-probe.cs`、运行器、证据校验器及 120 个合同。外部 witness 先创建三个固定受控根进程，进程创建使用 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 原子进入独立 safety guard Job；custodian 也以同样方式受 guard 看护。这样 runner 超时杀死 witness 时，不会留下尚未进入目标 Job 的暂停进程。guard 的原始唯一非继承句柄由 witness 持有，目标 unnamed Job 的原始唯一非继承句柄只由 custodian 持有；两个 Job 的证明分开记录。

目标 Job 回读 `KILL_ON_JOB_CLOSE`、limit 3、无 breakaway，三个进程暂停时入 Job 并证明成员身份后才恢复。witness 仅保留由创建句柄缩权且经 `CompareObjectHandles` 对等的 process HANDLE，权限为同步、有限查询与终止，不含 `PROCESS_DUP_HANDLE`，不持有目标 Job 句柄。崩溃前完整集合逐个证明原 HANDLE 未 signal 和已有 TCP challenge 成功，再对原 custodian HANDLE 实际调用 `TerminateProcess`，不执行其清理代码或手动终止目标 Job。

最终[正例与真实控制组](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/custodian-crash-final/report.json)使用独立 nonce。正例 witness **18904** / custodian **23184**，custodian 实际 exit **188**；三成员 **25684/24704/25092** 在 **90 ms** 内原 HANDLE signal、实际 exit **0**、socket reset，`fallbackCleanupUsed:false`。控制组 witness **27848** / custodian **13524** 移除目标 kill-on-close 后，三成员 **9612/26012/23576** 仍为 wait **258** / exit **259**，原连接继续回应；随后以原 HANDLE 显式回收并确认 signal/reset。guard 在两组观测期间一直打开，不能把关闭 guard 或事后 fallback 当作目标 Job 自动清理成功。

guard 的实际 4 个 PID 列表严格匹配四个原始创建对象，收尾 guard accounting 为 0。目标 Job 的最后句柄消失后无法再查询其 accounting，报告明确 `wholeJobEmptyProven:false / jobQueriedAfterCrash:false`；这里只证明预先完整登记的三个受控根进程，未证明服务重启后的持久 journal fencing、同 UID 对抗、受保护服务、WFP 或任意后代树。[主 agent 独立回读](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/custodian-crash-final-source-readback.json)重读四份来源、编译器、Node、实际 exe 与原输出，`originalsRechecked:true / errors:[]`。真实宿主引用 runner 的 `10.0.19045`；未带 OS manifest 的 CLR `Environment.OSVersion=6.2` 是兼容 API 视图，不作真实 OS 版本。

120 个纯合同在 Windows Node 22.22.2、22.12.0 与 Linux Node 22.22.2 均通过、零跳过，不同运行时不相加。Linux 首次 WSL/CreateInstance `E_ACCESSDENIED` 没有启动合同，原 UTF-16 错误保留；按系统要求提权后重试通过，未改源码或运行 Linux 原生探针。

首次[run1](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/custodian-crash-failure-run1/report.json)实际 guard accounting 为 8，拒绝且 cleanup 未确认；[run2](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/custodian-crash-failure-run2/report.json)的原列表证明 8 个不同 PID，未读取额外四进程的 image，不推断它们就是 conhost。`TerminateProcess` 返回失败时仍等待原 HANDLE，仅 signal 才确认退出，仍未 signal 则保留错误并拒绝；run1 原始失败保留，run2 清理成立。改用不需要 stdio 的 `DETACHED_PROCESS` 后[中间成功](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/custodian-crash-intermediate-run3/report.json)与最终实跑均为严格 4 个 guard 成员，没有放宽数量断言。原捕获文件不可读的失败现在逐文件保存，不能让 finally 丢失报告。早期各源码时点的失败/成功保留；编译原件留本机，compiler closure 非 hermetic，整项保持 `NOT_ADMITTED`。

### 20.12 存活反例的当前回归修补与冻结边界

最终 Windows 反例 12 的首次 capsule 未取得测试断言，helper 未注册后被固定终止策略拒绝，原期限/源码和失败保留；新目录单次重试实际 **11/11 通过、0 失败**。反例 20 实际 **4/4 通过、0 失败**，反例 29 实际 **19/19 通过、0 失败**，反例 30b 实际 **13/13 通过、0 失败**。四份报告都有真实变异字节和通过的对应基线，parser 正确拒绝没有检出行为变异的结果；原 frozen gate 保持 **OPEN**，不能把语法/import 错误、再次重试或修改报告当作反例成功。

实际覆盖缺口分别是已解析 argv 中的含空格/空字符串参数，以及同时存在相冲突的 `policy.decision` 与 `approval.decision`。只在当前仓库增加普通单元回归，生产实现及冻结 `.work` 项目、tests、config、plan 不改。[当前 argv 证据](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/verify12-current-regression/report.json)的 20/20 基线包含新增 9 例，对精确同一 `join/split/filter` 变异独立副本为 **11 通过/9 失败**；[当前优先级证据](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/verify20-current-regression/report.json)的两个冲突案例基线 **2/2**，交换优先级后 **0 通过/2 失败**。运行前后当前来源及测试摘要稳定，错误来自真实行为断言。它们修补了当前项目的覆盖，不能移植成原冻结 Windows review 已检出变异或正式 36+9 observations；后续计划签核与重冻结仍由负责人处理。

反例 29 删除 `event.session_id !== conv.sessionId` 的保护，原用例没有 foreign-session ACK。[当前新增 ACK 回归](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/verify29-current-regression/report.json)把 correlation、requested/effective、policy revision 全部匹配，仅 session 不同：必须拒绝且 conversation 完全不变；同一 ACK 只改为正确 session 必须正常接纳。基线 **2/2**，精确同一变异为 **1 通过/1 失败**，正例仍通过；生产实现未改，这份普通 Node unit 证据也不关闭原冻结 29 的存活结果。

反例 30b 删除 **40,000,000** 总 decodedPixels 门。[当前图像边界回归](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/verify30b-current-regression/report.json)使用带真实压缩 scanlines/CRC 的灰度 APNG，独立 fallback IDAT 加一个 fcTL/fdAT 动画帧，共两个解码画布：5000×4000×2 的 **40,000,000** 边界合法；5001×4000×2 的 **40,008,000** 仅总像素超限，字节、单幅像素、帧数及动画自身预算都合格。基线 **2/2**，精确同一变异为 **1 通过/1 失败**。两个新 IDE 测试文件均已加入既有 `test:unit` 显式列表，未改变原冻结 30b 的存活结果。

### 20.13 最终报告一致性加固与合同权限边界

矩阵执行完毕之后，独立 reviewer 发现 worker op4 成功豁免尚未强制 `terminationCallError === 0`；原生 producer 在成功时实际归零，真实原件未受影响。仅给当前 validator 补这一条件，并增加错误码 5、字段缺失和字符串 `"0"` 的三个拒绝合同；不改 native/CJS、driver、依赖 helper、旧报告或基线 byte binding。

[追加轻量审阅](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/private-v4-op4-additional-review.json)重新核对两份基线、十个最终反例及 12 首次失败，共 **13** 份不可变报告的摘要和每份 **12** 个留存 producer 源码，28 个实际成功终止行的错误码均为数值 0。原 producer validator 摘要 `aa71ddcdbb0555fd45d5bbfbe38d8d669f947f7f68b29c1bb2fb41a2d08e32fa`，追加 reviewer 为 `0009649b08d86323e6739bc35973c1cef0d18e1e1e9605e6e23d25de0bd10e01`；其余 11 份 producer 来源仍与当前一致。这是追加字段/来源一致性审阅，**没有重走全部依赖或重跑完整 inspector/native**，不能称新 validator 参与了旧 capsule 生产或已取得新的 baseline 前置绑定。

最终 10 文件 **533 个 Node 合同**：原 408 增加模型证据 2、op4 3 与独立 custodian 120。Windows Node 22.22.2 和 Linux Node 22.22.2 各 **533/533、零跳过**；Windows Node 22.12.0 默认沙箱实际 **520 通过/13 失败**，错误来自未修改的依赖 reader 对 `C:\Users\longfa` 祖先执行 `lstat EPERM`，并非本轮 op4 条件。原失败[报告/TAP](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/final4-node22.12-windows.json)保留；按系统权限要求在主机权限下对同一来源复核为 [533/533](./cli/evidence/gap-2026-10-05/continuation-2026-10-09/final4-node22.12-windows-host.json)，源码前后稳定，未放宽 reader 或祖先 ACL。不能把 host 权限结果写成默认沙箱通过，也不把重复运行累计为新任务样本。

模型目录 31 项 Vitest、Handlebars 实际新版 45 项模板、当前 argv 20 项/precedence 2 项与两个 IDE 文件各 2 项的回归分别保存；旧 408、415 与后续结果包含重叠，不相加为正式分母。所有本轮改动按完成批次提交到 Git，准确提交的后续 Actions 与原生/正式验收仍分开：受保护 durable 服务/authority/journal/WFP/macOS、冻结 Windows 完整失败基线和四个存活反例、官方账号账单、目标机器/独立人工/辅助技术/8h24h/SLO及 **36+9 / NOT_RUN** 未结案，本轮不发布。

### 20.14 CLI 0.166.95 配对候选失败、取证与修复

用户授权功能测试通过后发布 CLI 0.166.95、VS Code 0.37.140、JetBrains 0.4.158。首次准确候选 d4b936395ee40726bff956fd3adfd4f01ff24e77 的 Strict 五个 job、质量安全、常规与全套自动化已通过，但 CLI Windows unit 和 IDE 三平台 browser 失败，不能发布。

Windows 并发 fixture 只对存活锁持有者导致的 STATE_LOCK_UNAVAILABLE 且明确 not-committed 做最多五次、十秒预算内重试，未知提交和其他错误仍失败；生产两秒锁期限不改。等待所有 child 后清理，保留四唯一 ID、generation 4→8 与四 revoked 断言。定向 14/14、真实强制四进程先争用超时再成功均通过。浏览器取证的完整二进制 diff 改为流式 SHA256，不截断字节、不改参数，退出错误或 signal 拒绝；65 MiB 加末尾标记、部分输出后失败及 ENOENT 合同和既有用例共 15/15 通过。

桌面 E2E Linux 与 PM error/performance 在用例开始前被 Playwright 自动收集超大 patch 触发 V8 字符串限制；根配置关闭可选报告 diff 附件，保留 CI commit metadata 和全部测试。3 项 smoke、35 项 error/performance 收集成功，仅为配置检查，真实完整功能测试须由新提交 Actions 执行。VERIFY01 PR macOS 启动退出及上传 DNS 失败的原件和权限拒绝也保留，PR 实际 checkout 为 merge SHA；同 head 的 push 三项 macOS 旅程成功不替代新候选门。

原始 CI API、JUnit、日志、受控争用诊断、来源摘要及失败边界见[配对发布证据](./cli/evidence/gap-2026-10-05/release-0.166.95/README.md)。版本/子包依赖一致性已核对，10 个固定子包公网下载与 SRI/依赖检查通过；源码未变化，不新增子包版本。后续取得准确提交 CLI CI、Strict 全矩阵与 IDE 宿主门后，才通过既有 OIDC 发布 CLI，公开可获取后发布 IDE。此处仍是候选修复记录，尚未发布；冻结正式 36+9、预算、observations、原冻结反例矩阵和平台/人工/账单/长时验收边界不变。

### 20.15 第二候选的 SDK 启动失败与诊断

Astra 对实际 fixture helper 的[独立诊断合同](./cli/evidence/gap-2026-10-05/release-0.166.95/sdk-startup-diagnostics/run2/report.json) 3/3 通过，first/resume 使用真实 Node 子进程输出后 exit 1；真实 spawn ENOENT 保留原 cause，三条路径的临时监听器均归零。该报告明确未复现原 CI 根因，首次 harness 对 Windows cmd 包装的错误假设及修正原件保留；主代理独立核对 fixture 与全部 SDK source SHA256，生产库未改。

准确提交 `43eb29d1f72697d849b6f1aed573fd044ad9da9b` 的 CLI CI #37929591872 为 69 success / 2 failure。原 Windows unit shard 3 已成功；Windows verify-cli job 113855554261 的 SDK `0.2.13` 为 82 通过 / 1 失败，真实 E2E 报 `agent exited (code 1) before init`，耗时 16.066 秒。原 fixture 没有将 startup await 包入 stderr/events catch，无法从原件确定退出原因；默认 ACL 15 秒只是一项未证实线索，不改变生产期限或给原失败标记 infra-only。

后续四份制品在 SDK 失败后未生成，上传的 `No files found` 不能归因网络；Windows PM recovery artifact 11620769736 实际已成功上传，PM 汇总由父 job 完整门失败拒绝。Strict 5/5、IDE 18 成功 / 1 非标签后验证跳过、质量安全、模型审查、PR/CI/Full Test 与 IDE Roadmap Safety Matrix 全部成功，其准确 SHA 回读和失败原日志[分别归档](./cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt2/manifest.json)，不能替代失败 CLI CI。

本机原 Windows SDK E2E 1/1、135.73 秒，保留实际审批写文件和会话 resume 合同；补诊断后的完整 SDK 9 文件、83/83 通过，用时 128.87 秒，不能据本机成功推断原 hosted runner 根因。当前只补测试启动与各结果失败诊断，first/resume 使用独立 stderr/events，保留原 message/cause，明确不声称管道完全排空；waitForInit 对 spawn error 立即拒绝并清理 init/exit/error listeners。SDK runtime、版本、180 秒测试期限、ACL 期限、原断言和 sandbox 条件都不改，无 retry。后续准确提交仍需全矩阵；本轮尚未发布。原冻结 Windows 反例、正式 36+9、预算及 observations、durable/账户/人工/长时开放状态均不变。

### 20.16 Windows 原生恢复功能预算与阶段诊断

候选 `a3cbe918e4f8fcda77dafa7514401d5f643b36df` 的 CI Tests Windows Node 22.x job `113865516304`：governed host suite **230/231**，原恢复用例报告 **8073ms** 并超过 Vitest 默认 **5000ms** 期限；后续 selector/fallback producer 均跳过，强制汇总正确失败。原始日志 SHA256 `0a6f0a39c9f07beb95e570cc5351a42580d1309002ca6d165917b10794a764a5` 及未完成矩阵 API 快照[已保存](./cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt3/manifest.json)，不能把这些快照称全矩阵成功。

该用例注入 protectDirectory/protectFile，不执行 SDK ACL 子进程。Astra 查明 close 先 abort 后 drain、service 定时器在 abort 时取消，runUntilIdle 无 sleep/backoff，未发现跨 await 持有同步事务或原日志 `SQLITE_BUSY`。匹配 CI 堆栈的 Vitest runner 在 promise 完成后也检查 elapsed，因而超时不证明挂住；native I/O 的实际贡献仍未知。

只给原恢复用例 **30_000ms** 有界功能测试预算，未将默认 5 秒解释为业务 SLO；原生 SQLite、原断言、生产锁/ACL/生命周期期限不改，无 retry。单调时钟记录各阶段进入/完成和总时间，挂起时仍有最后进入阶段日志。本机完整宿主文件 **20/20、32.25秒**；[独立原始计时](./cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt3/goal-restart-local-timing2/stdout.log)只选原用例 **1 通过 / 19 未选择**，body **164.49ms**、old close **3.70ms**，没有复现 CI 超期。本机 Vitest **4.1.10**、CI **4.1.11** 分别记载，不能称完全相同环境。

首次本机测试缺 better-sqlite3 binding，随后使用已安装 **12.11.1** 对应的官方 Node22.22.2 预编译包，未改 tracked manifest/lock；首次计时 harness 误用不存在的 nested Vitest 路径，其失败输出保留，修正后通过。只修改测试，不增加子包版本。另据原 IDE API 核准第二候选为 **18 success / 1 非标签 Marketplace 后验证 skip**，修正此前将十九个结束 job 写为全 success 的说明。新提交仍须准确 SHA 完整门，当前尚未发布；所有原冻结 review/正式 36+9、预算与 observations 及平台、人工、账户、长时边界保持。

### 20.17 Windows ARM64 JetBrains 弹窗调度诊断

准确候选 `a3f3ed3dd1fb809fb7fd520ad5a35616ae64bb3b` 的 IDE ARM64 Host Validation run `37947977140`，Windows ARM64 JetBrains **2026.2.0.1** job `113880537429` 在真实 chat/control/resume 旅程中 **7 通过 / 1 失败**：`Restore code + conversation` 动作菜单在 **45 秒**内未出现。后续完整宿主汇总正确失败。原日志 **216526 bytes**、SHA256 `f79aae2aa80b9f49bb586dab677027fe09cbae044208cc986e74f936f5a27804`，API、JUnit、协议和关键截图[按字节归档](./cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt4/manifest.json)。artifact `11625812501` 的原 manifest 全部 **30 文件**摘要匹配，无 DOM 或 idea.log；不能补造这些日志。

协议显示 restore-code 和 restore-conversation 两轮均完成匹配 preview/confirm。第三轮 timeline 在 **15:19:07.328Z** 返回并记录激活 `partial turn-2`，之后无 restore-both preview/confirm 请求；因此失败在时间线选中到动作菜单过渡。相同 selector 已在前两轮成功，不能泛称 IDEA2026 selector 失配；GUI guard 的 WSL updater termination 缺少与此时刻的焦点关联，不能确定其因果关系。

Astra 核对官方 IDEA build **262.8665.337**、commit `15645ead6f20019cc2537dbbd43df4eb344423a8` 的 Enter/closeOk 路径：父 popup 清理后通过 doWhenFocusSettlesDown 调用选中回调；没有依据修改生产同步 `showTimelineActions`。取消后的 deferred Enter 可能不执行 callback 是源码机制，原失败是否确实取消仍未确认。

只修改 UI 测试驱动：IIFE 捕获原目标、label 与 prefix，在同一个 deferred EDT runnable 内重新验证 showing 和唯一匹配，选择并执行真实 Enter，记录 `scheduled → entered → validated → dispatch-returned / failed`、可见性与焦点；目标隐藏、丢失/歧义或 Enter 缺失即失败，无 retry。原 **45 秒**预算内要求 `dispatch-returned|hidden`，这不代表 selected callback 已完成；调用方仍必须观察真实下一菜单、匹配 preview/confirm 与完成文本，未删改任何恢复业务断言。

本机 JDK **21.0.12.1** 编译通过。真实已编译方法导出的 JS 经 Rhino **1.7.15**、Swing JList/Enter Action、真实 EDT 的[调度合同 **10/10**](./cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt4/popup-contract/report.json)；仅 ApplicationManager 队列与 isShowing 为可控替身，没有真实 IDE/GUI/CI，未复现原故障。Astra 另发现 Java 泛型 `callJs` 被 `String.valueOf` 推断为 `char[]` 的调用点错误，已增加 `(Object)`；[新字节码回读](./cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt4/popup-contract/review-resolution.json)确认 `String.valueOf(Object)`，重导出 JS SHA256 `ce69b8534f6b504545f6034c6cd6cb3cae3da11240adee0849fe35ecaf092def` 与 10/10 合同输入相同，未重复计数。

新提交须以自身准确 SHA 通过完整 CLI/Strict、双 IDE 与 ARM64 宿主门，再按子包、CLI 公开可取、IDE 的既有顺序发布。当前 CLI `0.166.95`、VS Code `0.37.140`、JetBrains `0.4.158` 均尚未发布；正式 36+9、预算、observations、冻结 Windows review 与平台/账户/人工/长时验收边界保持原状态。

### 20.18 Windows 检出失败与归档路径映射

准确候选 `9f4df1157e493daaee137655c4e1d37c066c50e8` 的 CLI CI run `37957249938`、Windows unit shard 2 job `113911369726` 在 checkout 阶段报六份新 receipt 路径 `Filename too long`，相对路径均 **236 字符**。其他 Windows 与 ARM64 job 也在 checkout 失败；这些 job 尚未执行测试，后续报告缺失只是结果，未生成 SDK 或 UI 新旅程结果。原日志 **21075 bytes**、SHA256 `40d103ac38bd72468cd439103dac77672093c1a264e17b6a10d460f2b028712f`，原始 API、独立 annotations、原日志 API 的首次 403 和后续成功获取[分别保存](./cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt5/manifest.json)。CLI/ARM64 快照仍未完成，不把它们作为成功门。

仅将 attempt4 的六份归档 basename 缩为 `011-receipt.json` 至 `016-receipt.json`，最长相对路径降为 **202 字符**；全部 **72 份**原件再次逐源/目标摘要与字节核对通过。当前 manifest 明确原归档路径、实际归档路径、artifact 来源、大小和摘要；原 artifact journey manifest 不改，映射归档不等于原提取树。旧 attempt4 manifest 原字节保存在第五候选中，与其原 SHA256 绑定。UI 测试驱动、原生产代码、合同脚本、期限和断言未改，不重复计数合同；新提交须完整准确 SHA 验证。版本尚未发布，冻结 36+9、预算、observations 和所有独立验收边界保持原状态。

### 20.19 Windows 2025.2 审批卡取证与布局验证

准确候选 `8e538362109dbe0bf455d4f72dcab865962e668c` 的 ARM64 完整门 **10/10** 成功；IDE Extensions run `37958205583` 为 **16 success / 1 failure / 2 skip**，Windows 2025.2 job `113925289634` 的真实 UI **7/8**，在 `IdeUiSmokeTest.java:161` 寻找 `Approve Once` 超过原 **45 秒**。此前恢复菜单 helper 尚未执行，ARM64 通过不能覆盖它。原日志 **128202 bytes**、SHA256 `bd1eb10a33a3e325e82dd8a492e36339b47587c6f2747446cef3efbd27da3700`，完整终态、早期快照及[原件清单](./cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt6/manifest.json)均保存；归档采用短路径及 source 映射。

artifact `11632252463` **1905026 bytes**、ZIP SHA256 `c0de3e3330aa052fc78f66dbcaa24711ae7774c4dc3d6f749b25622a3a09c2cd` 与 GitHub 元数据匹配；原 journey **28/28** 文件、artifactBundleDigest 与 evidenceDigest 全部一致。协议显示同一进程 1952 在 **17:00:55.009Z** 接收权限消息、**55.271Z** 确认接受、**55.997Z** 输出 `approval_request`，之后没有 approval 回复。截图无审批卡。fixture 的 stdout.write 先于 trace，仍不证明 IDE 已消费；无原 DOM、host render 或 idea.log，不能将发送丢失、Vulkan 警告、卡片清理或特定布局机制认定为原 CI 根因。

独立真实 JDK21 Swing/EDT 合同另证实 card layout 缺陷：BoxLayout cardsPanel 位于 JScrollPane 验证根内，增删卡后内层验证不重新分配外层 BorderLayout 的高度，preferred 为 126 而 viewport 为 0；验证 southWrap 后 viewport 为 126、按钮 visibleRect 高度为 26。无 Window 的层级需控制最近验证根的调度，组件与几何计算真实，未复现原 CI。新增纯 Swing `ChatCardsLayout.refresh` 在八处卡片增删后同时验证内层及滚动窗格外的布局区域；两个实际 helper 合同覆盖新增、真实单次按钮回调、移除空间回收和多卡 320 高度下 composer 可见，不修改审批状态、事件含义或期限。

默认关闭的 `UiEventDiagnostics` 仅在显式隔离 JVM capture 目录下记录白名单标量元数据和 receive/map/EDT/render/card 阶段，禁录 prompt/command/异常 message，原 RuntimeException/Error 继续传播。失败组件树读取实际 showing/bounds/visibleRect、owner 字段及 card/settlement 状态；限制节点与深度，缺字段/检查错误单独入 errors，ownerCount=0 不证明成功捕获。原功能失败、按钮断言和 **45 秒**期限保持，没有新增 journey retry。IDE 日志/轮转与事件 trace 以 `.bin` 原字节保存；诊断缺失独立报告，不覆盖原功能结果，restart 无 onEvent 也不伪造事件。

本机 UI 编译通过，Java **113 XML / 955 用例：952 通过、3 原有 POSIX 跳过、0 failure/error**；三个跳过为 IdePathGuard 的 POSIX symlink 与 LockfileAcl 两个 POSIX 方法，原 assumptions 不变。smoke **1445 项断言全部通过**，不与 JUnit 合并计数。初次布局合同使用 headful AWT peer 初始化失败原件保留，标准纯 JUnit worker 显式 headless 后通过；真实 uiSmokeTest worker 不改为 headless。定向布局 **2/2**、事件观察 **4/4** 是上述全套的子集；driver **13/13** 与实际编译脚本 Rhino/Swing **6/6** 单独记载，均非真实 IDE。旧 snapshot 节点上限漏报 truncated 的实测失败与修正原件保存；新脚本源码与独立编译后的输出逐字节相同，真实 IDE owner 发现/反射仍待宿主验证。

实际新版采集器到 evidence writer 的合同完整保留 **757780 bytes trace** 与 **300004 bytes IDE log**，来源摘要和 metadata 一致、未截断/改写；合同输入不能冒充原 CI 日志。候选修正尚未发布，新准确提交仍须 CLI CI/Strict、IDE 主门与 ARM64 完整矩阵。冻结 36+9、$99、窗口、分母、observations、原 Windows review 与平台、账户、人工、长时验收状态保持。

### 20.20 CLI 0.166.95 发布复用失败与 0.166.96 候选

CLI `0.166.95` 的准确提交 `3caf14f2ee866335608487ab57add325972709d7` 已取得 CLI CI **71/71**、Strict **5/5**、IDE **18 成功 / 1 条件跳过**及 ARM64 **10/10**。但 OIDC 发布 run `37985598206` 在 Agent SDK `0.2.13` 的整个源码树复用检查失败，CLI 发布步骤明确跳过；它没有成为新公开 CLI。SDK 的签名来源校验通过，实际改变的是测试诊断文件，公开 tarball 字节一致的预检不足以证明整个 Git 子树未变。

新候选为 Agent SDK `0.2.14`、CLI `0.166.96`、VS Code `0.37.140`、JetBrains `0.4.158`。两端 IDE 尚未发布，因此保留插件版本并将推荐 CLI 改为 `.96`；SDK 与锁文件升级，VS Code/Desktop 生成标记同步，SDK 运行时输出摘要未变。保留 `.95` 原标签和失败原件，不移动标签、不削弱复用门。新提交必须重新完成自身的三平台完整矩阵，再按 SDK → CLI → IDE → 合并顺序发行。当前没有发布新版本。

[失败原件](./cli/evidence/gap-2026-10-05/release-0.166.95/npm-publish-failure/manifest.json)保留原 workflow、job、日志及逐文件摘要；[3caf 已验证源码原件](./cli/evidence/gap-2026-10-05/release-0.166.95/validated-source-3caf/manifest.json)保存该提交成功门、真实 Windows IDE 选集与 SDK 终态。这些门不能转移到新候选。Workspace 同 SHA attempt 2 成功；Secret advisory 首次扫描超时且未完成，仍不声明 clean。x64 canonical restart 缺事件 trace、capture-status.complete=false 的事实和原日志保持；旧 8e5 审批失败根因仍未知。

正式 36 tasks + 9 firstRuns 保持 `NOT_RUN`，完整 native review 保持 `NOT_ADMITTED`；冻结源码、配置、分母、$99、observations 以及 Windows/macOS durable、账户账单、独立人工和长时验收状态不变。

### 20.21 CLI 0.166.96 首轮失败与独立收据修复

准确候选 `3900e9bd7f4d610b74b4d1639cf62b39dd9004ed` 的 CLI CI 为 **66 success / 2 failure / 1 skip**（69 个实际 job，SDK 尚未运行），Strict **5/5**；IDE Extensions 为 **15 success / 1 failure / 3 skip**，ARM64 为 **8 success / 2 failure**。完整门未通过，四个候选版本均未发布。

CLI CI run `37987544644` 的 Windows unit shard 11 job `114013174530` 在完整只读事件集合用例超出原全局 90000ms，实际 91619ms，分片 2675 pass / 1 fail / 1 skip；verify-cli 因此跳过，SDK 没有执行。只给该功能用例显式 180000ms，仍验证 600 个事件、顺序、>2MiB、全部冻结/篡改拒绝及最终 journal head；全局预算和生产限制不变，无 retry。七阶段诊断的本地完整文件 7/7，实际集合 3,445,514 bytes；未重现原 CI 超时，不能据本地较快结果确认慢 I/O 根因。

ARM64 run `37987544323` 的 Windows job `114013173246` 中真实 Enter 已完成正确 callback，匹配 preview 与 Confirm visible/enabled；失败来自随后对已销毁 popup fixture 的 callJs。每次 UUID 收据绑定 token/owner/target/label/prefix，java.util.Properties 只保存标量，后续从稳定 IDE frame/rootpane 读取，finally 清理并保留 primary/suppressed 异常。原真实 Enter、45 秒、下一菜单及 preview/Confirm 断言保持。JDK21 compileUiTestJava 通过；实际导出脚本 Rhino/Swing 14/14，含错误绑定拒绝、同 owner 双 token 隔离和 removed list GC 后读取；两种编译导出的脚本逐字节一致。尚无新 head 的真实宿主结果，旧 8e5 审批故障根因仍未知。

IDE run `37987544322` 的 Remote SSH job `114022086463` 首次 docker pull 明确匿名 Docker Hub 限流，未创建容器、启动 SSH 或 IDE journey。仅此错误允许一次 mirror.gcr.io/library/ubuntu 回退，digest 仍为 `019e8eb29a85e74d64925745884f2ec79aa27e3feab36353d24656f4d6b89467`；镜像 manifest GET 200，424 原字节摘要与原 pin 一致。普通网络/auth/其他 quota/signal/不同 image 或 digest 不回退；mirror 失败保留两次失败，inspect/run 不执行。inspect 校验真实 usedRef 的 Id/RepoDigests 后才 run；旧 canonical identity 字段保留，实际源另记，完整两次输出进入原字节 collector。定向 17/17 通过，尚未跑真实 Docker/SSH journey。

CI Tests run `37987544143` 的 global install job `114013172321` 报 AWS tarball E404，Windows unit job `114013172634` 报 ETARGET，均在安装阶段、业务测试未执行。缺失 @aws-sdk/credential-provider-http@3.972.75 后续官方 metadata/tarball GET 200、SRI 匹配，新旧链共六包下载摘要通过；不能确认 global install 边缘失败机制。没有修改 tracked AWS 依赖，不据单个 S3 pin 声称固定全部传递依赖；新 head 的矩阵重新实际安装。

[首轮完整失败归档](./cli/evidence/gap-2026-10-05/release-0.166.96/prepublish-attempt1/index.json)保留 148 原件、4 清单、9,790,022 原件字节、十个门与五个失败日志。CLI/Strict/IDE/ARM64 的历史结果没有转移给新提交；[修复验证](./cli/evidence/gap-2026-10-05/release-0.166.96/repair-attempt1/index.json)按独立来源绑定当前源码，合同结果不累计为正式任务分母。

版本仍为 Agent SDK `0.2.14`、CLI `0.166.96`、VS Code `0.37.140`、JetBrains `0.4.158`。新提交须重新完成自身全部矩阵，再按子包 → CLI → IDE → 合并顺序发行；保留原 `.95` 标签，不移动标签，不改为本地或 token 发布。

正式 36 tasks + 9 firstRuns、$99 和 observations 保持 `NOT_RUN`；冻结 Windows **211 = 194 pass / 16 fail / 1 skip**、**6 检出 / 4 存活 / 4 未运行**以及完整 native review 保持 `NOT_ADMITTED`。Windows/macOS durable authority、受保护 journal、服务自身恢复/WFP、官方账单、独立人工/辅助技术及 8h/24h/SLO 仍开放，本轮无新增付费 provider 调用。

### 20.22 CLI 0.166.96 与双 IDE 发行回读

准确发行源码 `da91e730d802b7c9dcdc075b222ecc257021e552` 的 CLI CI **71/71**、Strict **5/5**、IDE Extensions **18 success / 1 非标签后验证 skip**、ARM64 **10/10** 及其余完整测试门全部通过。既有 GitHub Actions OIDC 已先发布并核验 Agent SDK `0.2.14`，再发布 CLI `0.166.96`；公开包与不可变制品的摘要、SRI、来源证明和十个直接子包安装/精确版本均匹配。随后发布 Open VSX `0.37.140`，公开可下载内容与标签制品一致。JetBrains `0.4.158` 的标签发布已成功提交 Marketplace，当前仍 `pending`，等待公开审批，不能声称已公开可安装。

Windows unit 11/16 的完整集合用例通过，日志记 56,098ms；只读审计文件 7/7、71,140ms，分片 110 文件、2,676 tests 通过及 1 项原有跳过。新 hosted 日志没有阶段标记或分段时长，不填补未记录的数值，仍不确认原超时根因或生产 SLO。本次 Windows ARM64 真实 UI 旅程成功，artifact 原 manifest 51 个引用全部匹配，initial/restart capture 均 complete=true。Remote SSH 真实旅程、48 个 manifest 引用及 9 个 collector 引用全部匹配，wrongCommitBindingCount=0；实际一次 Docker Hub 拉取成功、canonicalRef=usedRef、fallbackReason=null，没有实际触发镜像回退。可信汇总保持原 selected-cases / advisory / releaseReady=null 边界，不把这份选集声明成全面正式验收。三系统 Global Install Smoke 与 Windows 单元任务的独立 production 依赖安装均成功；新安装结果不改写旧 E404/ETARGET 失败。 Windows x64 2024.2 与 2025.2 功能旅程均成功，各自两个原 manifest 共 94 引用均匹配；两宿主 canonical restart 的诊断均仍 complete=false、event-trace-or-capture-root-unavailable，功能成功不代表这两轮取证完整。

- CLI CI：[38012166593](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166593)，71 success
- CLI Strict Sandbox：[38012166296](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166296)，5 success
- IDE Extensions：[38012166401](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166401)，18 success / 1 skipped
- IDE ARM64 Host Validation：[38012166408](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166408)，10 success
- Code Quality & Security：[38012166451](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166451)，7 success / 2 skipped
- Model Catalog Review：[38012166435](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166435)，1 success
- PR Tests：[38012166379](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166379)，2 success
- CI Tests：[38012166446](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166446)，13 success / 1 skipped
- Full Test Automation with Diagnostics：[38012166228](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166228)，3 success / 1 skipped
- IDE Roadmap Safety Matrix：[38012166313](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166313)，4 success
- Publish CLI release to npm：[38019727506](https://github.com/chainlesschain/chainlesschain/actions/runs/38019727506)，5 success / 2 skipped
- IDE Extensions：[38021103046](https://github.com/chainlesschain/chainlesschain/actions/runs/38021103046)，11 success / 3 skipped
- IDE Extensions：[38021102825](https://github.com/chainlesschain/chainlesschain/actions/runs/38021102825)，13 success / 6 skipped

[发行原件选集](./cli/evidence/gap-2026-10-05/release-0.166.96/final-release/manifest.json)保存终态 workflow/latest jobs、制品摘要和公开包逐项验证。归档保留五组选集及原路径映射，不是所有 artifact 的完整解压树。两份大型 CLI smoke bundle 仅保存 metadata，payloadVerified=false；其余已下载的 21 份 CLI ZIP 和 6 份 Strict ZIP 已逐项验证。CLI/Strict/IDE/ARM64 的发行门显式检出准确发行 head；其余 PR 门可能检出 synthetic merge ref，API head_sha 单独不证明 checkout 源码。SDK 和 CLI 来源签名由成功 OIDC job 的 npm audit signatures --include-attestations 及 digest-bound 回读制品证明，补充本地回读未重复执行签名审计。

旧 `3900` 完整门失败、SDK NOT_RUN、AWS 安装失败及后续恢复保持原记录。新 head 的真实 host 与完整矩阵结果属于本次发行，局部合同和冻结正式验收分开记录。旧 x64 canonical restart trace 缺失、capture-status.complete=false 与旧 8e5 根因未确认不因本轮成功改写。

发行标签均绑定 `da91e730d802b7c9dcdc075b222ecc257021e552`，没有移动旧 `.95` 标签或发行未测 merge SHA。发布在合并之前完成；后续文档归档提交需自身六项主分支 required contexts 成功，再用 expected-head guard 合并 PR #425，不使用 admin 绕过。

正式 36 tasks + 9 firstRuns、$99 和 observations 保持 `NOT_RUN`；冻结 Windows **211 = 194 pass / 16 fail / 1 skip**、**6 检出 / 4 存活 / 4 未运行**与完整 native review 保持 `NOT_ADMITTED`。Windows/macOS durable authority、受保护 journal、服务自身恢复/WFP、官方账单、独立人工/辅助技术及 8h/24h/SLO 继续开放；本轮无新增付费 provider 调用。

### 20.23 四版本公开发行后的诊断增量

JetBrains `0.4.158` 的 Marketplace update `1190815` 已 approved、listed、非 hidden，公开下载已回读；与已发行的 Agent SDK `0.2.14`、CLI `0.166.96`、Open VSX `0.37.140` 一起构成本轮四个已发行版本。[Marketplace 原件清单](./cli/evidence/gap-2026-10-05/diagnostics-2026-10-10/marketplace/manifest.json)同时保留此前 pending 与后续 approved 回执。公开 ZIP 与候选 ZIP 容器字节不同，但全部 entry 字节一致，不能表述为整个 ZIP 摘要一致。PR #425 的文档 head `73f5a3550d87db724f0c539223e671fd3ea6d1e1` 六项必需检查全部成功后，已合并为 `2650447476d6358254368b73ddc52b5319982608`；发行标签仍绑定原发行源码 `da91e730d802b7c9dcdc075b222ecc257021e552`。

同一 `73f5` 的 [Scheduler run 38023140779](https://github.com/chainlesschain/chainlesschain/actions/runs/38023140779) 并非全绿：Linux/macOS 成功，Windows job `114128248692` 及 aggregate 失败。[原件清单](./cli/evidence/gap-2026-10-05/diagnostics-2026-10-10/scheduler-original/manifest.json)保留三平台原 artifact 与来源、摘要验证。Windows 第二轮 before-execute replacement 在 `writeEffect` 的 `renewLease()` 失租，发生在 effect 文件 open 之前；原 smoke lease 为 1000ms。现有记录不能区分调度、锁等待或生产缺陷，原根因仍未知；失败 replacement 已退出并移出 active 集合，旧报告只记录两个 steady worker，遗漏该 replacement 的结构化事件及 occurrence/renewal 历史。不能把未完成报告的默认 invariant=false 当作每条不变量均已失败。

当前 Scheduler helper 保留最多 24 个退出 worker 快照，每个最多 40 个末尾事件和 64 KiB stderr 尾部，并记录省略数量；退出快照与活进程清理集合分开。诊断补查关联 occurrence、续租历史和 effect 文件状态/摘要，各项读取独立失败，effect 读取异常不再吞掉可读的数据库历史；recorder 异常单独保留，不阻断等待者拒绝、`done` 完成或原始退出错误传播。worker 的 fatal 增加 occurrence、effect phase、阶段 timing 及 created/flushed 标志；这些是被动观察，不新增续租或重试、不改变 fencing、异步 IO 边界、原 1000ms smoke lease、期限或生产 runtime/store。phase 表示已到达的 effect 阶段，不能单独证明之后的 close/checkpoint/settlement 根因。

JetBrains journey collector 新增 `failureDetails`，按阶段保留错误 stage/type/code/syscall 等有限元数据，不输出 payload 或异常 message。旧 canonical restart 的 `event-trace-or-capture-root-unavailable` 根因仍未知；绿色功能 journey 不等于 `capture-status.complete=true`，已有缺失原件与不完整标志继续保留。此次改动只涉及未进入发行 payload 的 CI/helper 脚本及相应回归、文档和证据，没有改生产代码、45 秒 UI 期限、升版、移动发行标签或再次发布。

当前局部验证：workflow/campaign 三文件 15/15、JetBrains collector 22/22 已通过；Scheduler unit/worker/coordinator 三文件首次 54 项为 53 通过、1 项新增测试断言失败，原因是 `toEqual` 未计入 `safeError` 保留的 stack，真实 child 的 `done` 与原 exit 传播已成功。改为匹配必要字段的 `toMatchObject` 后，定向 worker 文件 10/10 通过；其余 unit 43/43 与真实协调器 1/1 已通过且源码未再修改。这些结果不累计为正式任务；首轮断言失败不是生产故障，也不是原 Windows 失租根因。当前诊断工程仍须新准确 SHA 的相关三平台矩阵及真实宿主验证，旧 `da91` 发行门、`73f5` 必需检查和局部合同不能替代新源码验证。

[本地验证与发布范围回执](./cli/evidence/gap-2026-10-05/diagnostics-2026-10-10/local/validation.json)绑定六个源码文件摘要。`npm pack --dry-run --ignore-scripts` 的 1,523 个文件与相对发行源码的改动没有交集；IDE runtime/build/version 源码也未改变。这是发布范围检查，未独立重建或宣称公开产物字节相同。定向 ESLint 返回一个既有 `no-unsafe-finally` 错误；对发行源码使用同一配置读取，规则及消息一致（旧行 483、当前行 486），其余五文件无发现，不能称完整 lint 全绿。

正式 36 tasks + 9 firstRuns、$99 和 observations 继续 `NOT_RUN`；冻结 Windows **211 = 194 pass / 16 fail / 1 skip**、**6 检出 / 4 存活 / 4 未运行**与完整 native review 的 `NOT_ADMITTED` 不变。Windows/macOS durable authority、受保护 journal、服务自身恢复/WFP、官方 usage/账单、独立人工/辅助技术及 8h/24h/SLO 仍开放。无付费 provider 调用，不能将本轮诊断增量或四版本发行表述为两份差距报告全部任务完成。

### 20.24 Windows 控制接线、真实基线与收尾错误保留

新增显式 `--behavior-controls` 的四文件/五断言诊断，复用既有 Linux donor，不改冻结 specs、review runtime、源闭包、原 setup/config 或正式 observations。校验 raw reporter 的准确文件集合及全部控制名称，并将生成字节、前后 capture、donor source、runtime、依赖与成功基线一起绑定；仅控制文件的真实行为 AssertionError 可作检出，普通应用/加载错误、跳过或超时均拒绝。134 项 Node 合同、原 donor 13 项 Vitest、格式和定向 lint 通过。

最终基线 c 在本机 Windows 10 x64 / 固定 Node 22.22.2 实际 **52/52**；普通用户监督器、同 SID/Job、零 capabilities、原 HANDLE 结算、Job 0、profile 删除均成立，guard **36,262 / 48,000**，未放宽上限。原源/配置/依赖及完整原始 reporter 验证通过，仍 `NOT_ADMITTED`，不冒充 Windows 11 24H2 / Node 22.12.0 正式宿主。中间 a 的 52 项通过与运行期间源码更新后的来源拒绝同时保留；b 在沙箱内 `host-token` 前置检查失败，未启动原生 root，原报告未细分具体拒绝条件。

最初 verify-12/20 并行原生尝试在 Vitest import 阶段退出：`broker-termination-policy / error 13`，root/service/helper exit 125，JSON reporter 为空，两次 Job 0/profile 删除确认。12 helper 已注册并有 installed receipt，20 尚无注册完成记录；不能把二者统一说成 helper 未开始启动。固定 Rollup report-header spawnSync 的 3000ms 与此路径可能有关，但拒绝请求/精确 predicate/时间尚无证据，不确认并行资源竞争或某一具体 policy 分支为根因。原失败 gzip 逐字节保存；原权限与期限保持，最终串行结果单列如下，成功也不将该猜测升级为已确认根因。

| 任务/反例                                    | 原始 reporter         | 结果                                                           | 原件                                                                             |
| -------------------------------------------- | --------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| verify-12 / flatten-spaces-and-empty-argv    | 12 = 11 pass / 1 fail | 新控制文件中的真实 AssertionError 检出；来源/基线/原生结算通过 | [清单](./cli/evidence/gap-2026-10-05/controls-2026-10-10/mutant12/manifest.json) |
| verify-20 / approval-overrides-policy-deny   | 5 = 4 pass / 1 fail   | 同上                                                           | [清单](./cli/evidence/gap-2026-10-05/controls-2026-10-10/mutant20/manifest.json) |
| verify-29 / ack-from-other-session-accepted  | 20 = 19 pass / 1 fail | 同上                                                           | [清单](./cli/evidence/gap-2026-10-05/controls-2026-10-10/mutant29/manifest.json) |
| verify-30 / ignore-animation-fallback-pixels | 15 = 14 pass / 1 fail | 同上；另一个边界控制通过                                       | [清单](./cli/evidence/gap-2026-10-05/controls-2026-10-10/mutant30/manifest.json) |

[新矩阵](./cli/evidence/gap-2026-10-05/controls-2026-10-10/matrix.json)回读四份原始结果，核对 producer/runtime/compiler/准备/依赖来源与最终基线全部相同，留存的 baseline report 与 c 原始字节/摘要一致。每题使用新胶囊，root exit 1 是预期行为拒绝，原 HANDLE、Job 0、profile 删除分别确认；没有把异常退出码单独当作检出。新四项控制的实跑关闭本次诊断接线子项，整体正式准入仍开放。

Scheduler 原子报告写入修复保留主异常对象/code及独立清理异常：文件 close、目录 close、unlink 均独立尝试；正常 replace 后清理失败仍抛出异常。六条新增回归在 Windows **48 pass / 1 POSIX skip**、WSL Ubuntu Node 22.12.0 **49/49**，修复后真实 worker/coordinator **11/11**；`no-unsafe-finally` 已消除。先前本地缺失 CLI 嵌套 Ajv 8 的导入失败保留，按原 lockfile 恢复依赖后成功，不能写成 Scheduler 生产故障。

[本轮归档](./cli/evidence/gap-2026-10-05/controls-2026-10-10/README.md)逐文件保存原始字节/摘要及无损 gzip 摘要，编译二进制仍在本机，compiler closure 非 hermetic。旧 Scheduler run `38029503816` 的 `9feab8bf4dee6837f0df04ab01456a89ce760944` 三平台 smoke 回读与现有 verifier 复核成功，单机持续时间分别 Linux **17.766s**、macOS **17.920s**、Windows **19.965s**；聚合最早/最晚跨度不作为单机连续运行证明，也不确认旧失租根因。[PR #428](https://github.com/chainlesschain/chainlesschain/pull/428) 当前准确 SHA 矩阵仍排队，局部结果和旧成功不能替代。

旧完整 Windows **211 = 194/16/1**、**6 检出 / 4 存活 / 4 未运行**和正式 **36+9 / NOT_RUN / INSUFFICIENT_EVIDENCE**、$99、observations 不改写。Windows/macOS durable 后端仍待实现，完整 review 的其余失败与平台冲突、官方账号/账单、独立人工、真人辅助技术及 8h/24h/SLO 继续开放。本轮无付费模型调用或发布。

### 20.25 只读设置域与审批取消的实际工具结果

本轮继续从 `533e75868dc5c7613524d192a65fcb376e8d44e4` 工作，工程提交为 `147fa9653a`。新增显式 `--fixture-settings`，只选择独立 review 设置域；原 Docker 的 `HOME=/tmp/review-home` 已提供同类测试隔离。宿主预建的 home/program-data 位于现有只读、无 reparse、保留句柄的 workspace 树内，不使用可写 scratch 作为不可变来源。broker 唯一生成五个设置环境键，worker 的重复大小写键、冲突值均拒绝；实际 home、managed 路径、两个来源的真实缺失和父目录 dev/ino 由冻结 observer 观察。各 actor 的真实 open 写探针返回 EPERM；未经归一的原 errno 保留，没有把真实用户配置的访问失败改成 ENOENT。

最初的完整 Windows 基线有 14 项审批用例停在真实 `C:\Users\longfa\.claude\settings.json` 的 EPERM。本轮独立域内，原冻结审批文件 **17/17** 通过；但 `pending.resolve(false)` 改成 true 后仍 **17/17**，是实际存活。旧用例只验证发出的 `approval_resolved.approved:false`，没有检查被阻塞工具实际收到的 permission promise 结果。失败原件保留为 `mutant-survived`，不能把原生进程退出或 parser 拒绝当作行为检出。

共享 Linux donor 已有 `cancelling a pending approval delivers denial to the blocked tool`；Windows 支持集合此前漏掉 verify-19。现将该断言纳入显式 `--behavior-controls`，原 17 项完整保留，新的准确 producer 基线 **18/18**，来源、raw reporter、原 HANDLE/Job 结算和 profile 删除验证通过。两个早期实跑按各自保留的源码字节记录，不借给最终控制 profile；open 成功后的 close 错误也不再能充当写拒绝。

最终匹配反例为 **18 = 17 pass / 1 行为拒绝**：唯一失败是直接工具结果断言，实际 `expected true to be false`；原冻结 17 项仍全部通过。成功基线兼容性、完整 baseline/control reporter 人口、准确源码/原生来源与原 HANDLE/Job/profile 结算均再次核验，`accepted:true / errors:[]` 只适用于这个显式诊断 profile。完整 12 文件的新设置域基线另行重跑，不将此单题结果描述为整体 native review 准入。

完整重跑 b 加载全部 **12** 个原冻结文件，收集错误为 0，实际 **211 = 208 pass / 2 fail / 1 skip**。原 14 项设置来源失败在新诊断域内通过；剩余失败仍为 `owner-only ACL process failed [windows-acl:spawn]` 与 junction parent 被当普通目录，跳过仍被 frozen parser 拒绝。根进程真实 exit 1，原 HANDLE、来源和 Job 0/profile 删除均有记录；settlement 的四条错误均是 baseline 要求成功 root exit 0 的结果约束，不能将此完整失败结果标为准入成功。新域没有替换旧真实用户域的 **194/16/1**。

首轮完整重跑 a 与系统睡眠重叠，外层实际 `SIGTERM / ETIMEDOUT`、空 host stdout、无 reporter，断言人口未知。Windows Event.ToXml 原件记录睡眠 **09:51:16.907Z → 11:50:41.591Z**；总计时包含这段停机，不是两小时连续运行/soak，也不证明准确卡点。原运行未取得 HANDLE/Job/profile 结算。随后仅将胶囊 ACL、注册名和派生 SID 完全匹配的 `cc.private.v4.a989f5d4-78e3-445e-8262-2f88dc21b61c` profile 注册清理，独立 HRESULT 0/注册项不存在，不冒充原 Job 恢复。b 使用临时 per-thread idle-sleep prevention；同一 thread 的获得/释放状态完整记录，结束已释放，原 240 秒期限、生产 runtime 和电源计划均未改。见[睡眠与独立清理](./cli/evidence/gap-2026-10-05/fixture-settings-2026-10-10/suspend-original/manifest.json)及[临时请求回执](./cli/evidence/gap-2026-10-05/fixture-settings-2026-10-10/awake-retry.json)。

fixture helper 107 项合同覆盖真实来源描述的字段/身份/环境/人口/生命周期篡改与错误拒绝目标；精确 op4 终止只允许 worker 缺 exit callback，必须有原 HANDLE/sequence/CompareObject 全部证明及宿主最终观察，不补造 child exit。全部相关 Node 文件在 Windows 22.22.2 与 WSL Ubuntu 22.12.0 分别 **349/349**，零失败、零跳过；重复执行不累计为新样本。初次测试中的三条辅助断言误用 `diagnosticVerified` 而非 settlement 字段，已修正；沙箱 WSL 服务 E_ACCESSDENIED 与获准宿主执行后的成功也分别保存原字节。Prettier、定向 ESLint、spawn inventory 和 diff 检查通过。[本轮证据](./cli/evidence/gap-2026-10-05/fixture-settings-2026-10-10/README.md)另保留两环境原始输出和摘要。

先前准确 SHA `533e75868dc5c7613524d192a65fcb376e8d44e4` 的 CLI CI run `38039055353` 已完整 **71/71**，Strict run `38039055210` **5/5**，Scheduler 三平台加 aggregate **4/4**，IDE Safety **4/4**。[最终 API 原件](./cli/evidence/gap-2026-10-05/fixture-settings-2026-10-10/ci-prior-complete/manifest.json)与[较早快照](./cli/evidence/gap-2026-10-05/fixture-settings-2026-10-10/ci-prior/manifest.json)分别保存；它们只适用于先前提交，不转移给新工程。新提交仍须自己的准确 SHA 完整矩阵。本轮没有发布。

实际宿主仍为 Windows 10 x64 / Node 22.22.2，compiler closure 非 hermetic；本配置域不证明真实宿主个人/组织策略已被读取，也不建立持久 authority。旧 **211 = 194/16/1** 与 **6/4/4**、正式 **36+9 / NOT_RUN / INSUFFICIENT_EVIDENCE**、$99 和 observations 保持原状。只读正式采集器再次真实退出 2，原件见 `frozen-summary.json`；Windows/macOS durable 服务/journal/自身恢复/WFP、其余 native 基线失败及冻结平台冲突、官方账号账单、独立人工/辅助技术和 8h/24h/SLO 仍开放。

### 20.26 CI 归档换行属性与严格源码门

准确 SHA `4928e50ef109712a36e3a39e08405b943ffd136b` 的 Agent Team Soak run `38051917155` 三个 job 均在 round 前失败、结果制品为零。[原始清单](./cli/evidence/gap-2026-10-05/soak-source-attrs-2026-10-10/manifest.json)保留 `awake-script.ps1`、`cleanup-script.ps1` 的同一 `eol=crlf requires an explicit text attribute` 拒绝。目录 `-text` 未清除根目录 PowerShell 的 eol；本次只增加 `!eol`，不归一原件或放宽源码门。

同 SHA 的 CLI CI run `38051917351` 在查询时仍 queued。三平台 integration shard 1/8 原始 JUnit 各含 168 个 testcase，各 1 项失败，均为准确源码合同的相同属性拒绝。[原 ZIP](./cli/evidence/gap-2026-10-05/soak-source-attrs-2026-10-10/cli-failures.json)、[XML 回读](./cli/evidence/gap-2026-10-05/soak-source-attrs-2026-10-10/cli-junit-readback.json)及[API 快照](./cli/evidence/gap-2026-10-05/soak-source-attrs-2026-10-10/cli-snapshot.json)不代表完整门通过。

Windows Node 22.22.2 与 WSL Ubuntu Node 22.12.0 各用独立 Git fixture 复现旧拒绝，提交修复后通过生产 `verifyExactSourceTree`；每环境再实际克隆 `core.autocrlf=false/true`，准确 SHA、源码属性与原脚本工作树/blob 字节均匹配。fixture SHA 仅为局部证明。选定既有源码合同 **3 pass / 6 未选择**；结果来自工具记录，未保存原 stdout，不累计正式样本。首次误用根目录 Vitest 配置的调用已中断排除。十份压缩原件双摘要及两个本地报告来源摘要复核，见[验证清单](./cli/evidence/gap-2026-10-05/soak-source-attrs-2026-10-10/local-validation.json)。受限日志请求曾 403，获准普通用户环境归档成功，未修改 GitHub 权限或凭证配置。

生产 runtime、soak lease/重试/期限和断言均未改变。新 SHA 须自身完整矩阵；正式 **36+9 / NOT_RUN**、$99、observations、旧 **211 = 194/16/1、6/4/4** 与 `NOT_ADMITTED` 不变，native/durable、官方账号账单、真人辅助技术及长时/SLO 继续开放，无付费调用或发布。

属性修复已提交并推送为 `7ded47b376a028e669d2f7a3cad5aa47d5e798ab`。从该准确 SHA 的独立工作树运行产品 `--verify-source-only`，实际 exit 0、**24,944 tracked entries / 1,304,408,083 bytes** 全部匹配；原 stdout/stderr、调用与 runner 的四份无损原件见[全量源码清单](./cli/evidence/gap-2026-10-05/soak-source-attrs-2026-10-10/product-source-7ded/manifest.json)。正在开发的 junction 源码不在该独立检出中。此门验证全部产品源码与属性，不等于完整 CI 或三平台 soak 成功；新 CLI CI/Agent Team 三平台尚在执行或排队。

随后同 SHA 的 Agent Team run `38054653688` 已完成 **3/3**，三份[原始制品回读](./cli/evidence/gap-2026-10-05/soak-source-attrs-2026-10-10/ci-7ded-team/manifest.json)均 `success:true`、Node 22.12.0、一次 round、5 tasks 和准确 source bytes。单机 elapsed 分别 Linux **9.859s**、macOS **36.696s**、Windows **42.708s**，不作连续长时或正式模型任务证明。Strict **5/5**，而[其他门快照](./cli/evidence/gap-2026-10-05/soak-source-attrs-2026-10-10/ci-7ded-gates/manifest.json)中的完整 CLI CI、Scheduler、IDE Safety 尚未结束；不转移给后续提交。

### 20.27 Junction 共享句柄方案的真实拒绝

Astra 独立确认固定 libuv 拒绝真实 mount-point 的 Global DOS substitute 后 fallback 成普通目录。本轮尝试只改变内核返回值的路径表示，但必须证明身份与防置换条件。六轮[原件](./cli/evidence/gap-2026-10-05/junction-guard-2026-10-10/manifest.json)共 **119** 份无损 gzip、双摘要核验：a 的既有综合 self-test 在新增 parser 前返回 98；b 的 parser test 编译因 unused function / `-Werror` 失败；c/d/e/f 的四项编译与独立 parser 成功；仅 d/f 真正运行 AppContainer，均在共享断言失败、尚未转换。d 未在断言前保存具体权限数组，不能补造。

f 以 FILE_READ_DATA pin 各目录，实际 11 次 access-open：ancestor/target/junction 的 WRITE_DATA 与 GENERIC_WRITE 返回 32，ancestor/target DELETE 返回 32，三个 WRITE_ATTRIBUTES **均返回 0**。source DELETE 设计为共享以容纳 unlink，未探测。保留的 [MS-FSA 原件](./cli/evidence/gap-2026-10-05/junction-guard-2026-10-10/contract/ms-fsa-fsctl-set-reparse-point.html.gz)条件为 `(GrantedAccess & (FILE_WRITE_DATA | FILE_WRITE_ATTRIBUTES)) == 0` 才拒绝，故现共享方案不足以证明阻止 reparse 修改。未通过这些属性句柄在 guard 下尝试 SET，不称实际置换/漏洞复现；fixture junction 本身由正常 Node API 创建。

d/f broker status 2、root exit 1；cleanup、Job 0、profile 删除、loopback absent、host map unchanged 都有记录。七槽安装但四个 reparse 计数全 0；内部 `reparseInspection.verified:true` 只核对零计数回执，不能充当成功。outside/replaced、sync/async lstat/readlink/stat、unlink/rm、worker/esbuild 子进程和 frozen review 均未执行。D control 采集曾 EPERM，升级被用户中止且未重试，只有工具记录；独立 actor/control 原文件未归档，不声称完整采集。

五个尝试源按准确 HEAD 原 blob 恢复，新增测试保留后移除；恢复源、最终尝试与 diff 原字节均归档，不留下可启用的未证实映射入口。更窄的坐标等价命题仍缺实际 Global C alias/root/X 前缀绑定、相关父路径和映射不可重绑定条件的实证；一次 root FileId 匹配或 LowBox map 拒绝不足，不能上升为 authority fencing。junction 仍未修复，完整 native review 仍 `NOT_ADMITTED`；旧 **211 = 194/16/1、6/4/4**、正式 **36+9 / NOT_RUN**、$99、observations、其他 durable/账号账单/真人/长时未完成项保持不变，无付费调用或发布。

### 20.28 LowBox 根坐标只读原生观察

最终源码新增固定无参数 `probeRootCoordinates()`，仍使用六槽 adapter。三个目标在冻结的九个原 native/JS 输入上以 `-Wall -Wextra -Werror` 编译；原 checker、verifier、runner 和输入摘要随[65 份无损 gzip 原件](./cli/evidence/gap-2026-10-05/root-coordinates-2026-10-10/manifest.json)归档。compiler closure 非 hermetic，实际宿主 Windows 10 x64/固定 Node 22.22.2；没有运行普通进程无 X map 时已知失败的旧综合 self-test，也没有把它写成成功。

普通非管理员、未受限 host 启动实际零 capability AppContainer；actor 在当前线程分别调用 NtCreateFile 打开固定 `\\??\\Global\\<rootDos>` 与 `\\??\\X:\\`，access 1048704、share 7、options 2097185。两者 unsigned NTSTATUS/IOSTATUS 均 0，FileId、卷号、NT name 与 inherited root 一致、directory=true/reparse=false。NtOpenSymbolicLinkObject 对精确 `\\??\\Global\\C:` 返回 **3221225506 = 0xC0000022**，无 query、无 fabricated target。拒绝后没有 namespace fallback、host 代开或 ACL 改动。before/after 的线程/PID、无 impersonation、有效 user/AppContainer SID、primary token、capability 0 观察一致；root exit 0、Job 0、profile 删除、loopback absent、host map 未变，带参数调用拒绝。

a 轮的 native 与 cleanup 成功，但之后 runner import 使用 Windows absolute path，工具记录返回 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；原 native stdout/actor/receipt 已保留，该异常没有单独原 stderr 文件。b 轮改为 pathToFileURL，重新冻结、编译并真正运行，runner exit 0，producer/verifier 输入前后摘要一致。最终原件与 tracked 源码须另逐字节复核，不能由第一轮成功转移。观察器接受完整实际 native 拒绝、拒绝签名状态/假身份/namespace/actor PID/token/越权声明及 malformed 输入；Windows 九文件 **544/544**、零失败/跳过，Linux Node 22.12.0 新合同 **50/50**，Linux 原 stdout 只有工具记录。lint、格式及 spawn inventory 无漂移。

根观察相同不证明 Global alias 绑定、前缀不可重绑定、所有 suffix 解析等价或持久 authority；`compatibilityConfirmed/admissionEligible/prefixRebindingExcluded/resolutionContextBound/suffixSemanticsVerified/mappingChanged` 均 false。junction 和完整 native review 仍 NOT_ADMITTED；旧 **211=194/16/1、6/4/4**、正式 **36+9/NOT_RUN/INSUFFICIENT_EVIDENCE**、$99 和 observations、durable/账单/独立人工/辅助技术/8h/24h/SLO 不变，无付费 provider 调用。

Astra 独立变异确认 b 轮会接受 root STATUS_PENDING、失败 IO completion、FILE_CREATED、矛盾 held metadata，以及 alias 失败附带值/成功缺值/奇数 byte length。没有 admission 升级，但 observationsVerified 结论过宽；已补拒绝合同和 native decoded length/completeness，新增 15 个负例。原 runner 只验 sources，现同时在执行前后核验三个 binary 与七份复制产物；最终 c 轮重新冻结、编译、实跑 exit 0，仍 root 相同/alias 拒绝。当前最终 verdict 和 source binding 只取 c 轮；b 的 producerInputsUnchanged 仅覆盖当时 source，不迁移其 binary 或 verifier 结论。

下一配对 CLI **0.166.97**、VS Code **0.37.141**、JetBrains **0.4.159**。13 子包完整 Git subtree 与公开 SDK 来源 `da91e730d802b7c9dcdc075b222ecc257021e552` 一致，本地 pack 与实际 registry tarball 原字节一致；SDK 两端 vendor 重建无 tracked 差异，局部 CLI/VS Code/JetBrains 版本合同 **35/22/14** 通过。JetBrains 初次缺 Java 21，使用既有 JDK21 后成功。最终发布须新准确 SHA 的 CLI CI/Strict 三平台、IDE 主矩阵及独立 ARM64 全门；旧 SHA 的成功不能迁移。用户已授权门通过后 OIDC CLI → 公开可取 → IDE，当前尚未发布，Marketplace pending 不记作公开。

### 20.29 CLI 0.166.97 候选 Windows 失败与诊断修复

首轮准确提交 `17e1e05420c5dc5c1afbc1ec25d47b3d836d83a8`、PR #428。15:22 UTC 的[原始 API、日志和制品](./cli/evidence/gap-2026-10-05/release-0.166.97/prepublish-attempt1/manifest.json)共38份无损gzip/双摘要；Strict run38058378825 **5/5**、IDE run38058378817 **18成功/1非标签post-publish条件跳过**、ARM64 run38058378756 **10/10**通过，CLI CI run38058378994 **53成功/14未完成**（当前67个实际job），完整发布门未通过，尚未发布。后续提交不能迁移这些成功。

CI Tests run38058378845 的 Windows22.x job114231464135，`Verify governed project host boundaries` **230pass/1fail**。唯一失败 `project-goal-monitoring-host.test.js:160` 后台授权case在默认5000ms期限超时，报告9437ms；`Enforce selector or fallback result`因先决失败后selector/fallback均skipped而拒绝，是连带状态，不能写成第二个功能失败或跳过成功。此期间desktop task/config/test workflow/session-core零diff、lock仅CLI版本；无阶段原件不能归因具体await、IO或锁竞争。本次只加该单例30秒功能预算和单调阶段计时，保留SQLite/后台授权/renderer拒绝全部断言，无retry，生产/全局期限不变。最终本机该文件20/20，23.51s、stderr0；该case107.56ms、start59.87ms/tick32.09ms，未复现原CI慢阶段，最终源码和调用stdout/stderr原件保留。

IDE Live Provider Trajectory run38058378923 的 Windows loopback job114231408906失败，Linux/macOS成功，两个真实付费provider job明确skipped，未调用付费API。原 ZIP与GitHub digest一致，报告eventCount9/eventOrder含10标签，read_file已settled、下一model usage unknown；压缩usage已reported。原件没有底层错误类，不推定缺账单、服务端断开或错误响应。只将原已计算的allowlisted错误链name/code/status透过sanitized failure receipt持久保存；链最多3项、严格字段/枚举/HTTP范围，拒绝任意消息、stack、路径和request，历史不带该可选字段的回执仍可读取。失败、provider policy、120s轨迹期限和无重试均保持。

CLI该文件生产loopback两次和全部合同本机 **23/23**，57.97s；原stdout只有工具记录，不补造原件。新增安全边界测试拒绝额外message/任意name/code/非法status/超长链，保证固定错误分类能保留而不能带入provider文本。lint/Prettier、spawn inventory与diff检查通过。此取证修复不是Windows loopback根因完成；后续准确SHA须重跑完整CLI/Strict/IDE/ARM64及相关失败门。版本保持0.166.97/0.37.141/0.4.159；原正式36+9、$99、observations、冻结反例与NOT_ADMITTED及durable/账单/人工/长时状态不变。

### 20.30 2026-10-11 CLI 0.166.97 最终门与公开发行回读

发行源码固定为 `22ef588c1bb8f71c45feaa115df1d75d5ca505c5`，三个发布标签都指向该提交。后续文档提交不继承这个提交的 CI，原 `17e1e05420` 失败与修复记录保留。

| 准确提交的发布/相关门     | run         | 最终结果                                        |
| ------------------------- | ----------- | ----------------------------------------------- |
| CLI CI                    | 38063505050 | 71/71 success；所有 job head_sha/attempt 1 匹配 |
| CLI Strict Sandbox        | 38063504747 | 5/5 success，三系统覆盖                         |
| IDE Extensions            | 38063504784 | 18 success / 1 非标签 post-publish 条件 skip    |
| IDE ARM64 Host Validation | 38063504697 | 10/10 success；独立门未由发布 workflow 自动依赖 |
| CI Tests                  | 38063504676 | 13 success / 1 Full Test Suite 条件 skip        |
| Loopback trajectory       | 38063504706 | 4 success / 2 paid-provider skip；无付费调用    |

[CI 原件索引](./cli/evidence/gap-2026-10-05/release-0.166.97/final-release/ci/manifest.json)保留59份gzip及双摘要，独立回读全部通过。SDK准确范围为三个 `verify-cli` job 各自的 `Test Agent SDK release payload source` 步骤通过，没有独立SDK aggregate。PM exploration recovery三平台与汇总四ZIP（4,587 bytes）摘要和内部引用匹配，按原verifiedAt重算汇总完全一致；各31process、falseSuccessReceipts=0，仍 testAuthority/syntheticFaultInjection、qualifiesForProduction=false，不冒充实际掉电或生产authority。Strict/ARM64/IDE只下载所需小型汇总原件，没有重放全部视频和宿主原件；Remote SSH仍advisory/selected-cases、releaseReady=null。

Windows后台授权host **231/231**、controls **201/201**；selector因 `UNMAPPED_CHANGED_FILES` fail-closed转入完整fallback，**30,500 pass / 473 skip**（1,565 files pass / 9 skip），enforce成功。原超时case此次阶段约621.01ms、Vitest742ms，fallback复跑682ms，未复现原慢阶段；不确认根因已修复。Loopback三平台各100、共300唯一run，四ZIP/内部摘要全匹配，但 manifestMatrixEligible=false、manifestCoverageComplete=false、structural-envelope-only，不能计入正式36+9。

OIDC run **38094605922** / attempt1成功。独立[公开CLI回读](./cli/evidence/gap-2026-10-05/release-0.166.97/final-release/public/npm/readback.json)确认14个archive（CLI+13子包）公共字节/SRI/SHA1、CLI不可变tarball/准确commit/ref/run provenance、三个重要子包的旧签名来源与当前源码tree匹配，独立registry install的13子包全部精确版本/resolved/integrity一致，并验证CLI十个直接子包来源。SDK签名来源commit仍 `da91e730d802b7c9dcdc075b222ecc257021e552`，当前与其完整tree一致，不能要求SDK gitHead冒称本次22ef。签名验证依据成功OIDC workflow的digest-bound `npm audit signatures --include-attestations` 收据，没有另做本机验签；独立install使用ignore-scripts，只验证来源，不声称native功能。

Open VSX `0.37.141` 已公开可下载，内容与标签 VSIX 一致；JetBrains `0.4.159` update `1191159` 已 approved/listed、公开可下载，ZIP 全部 entry 字节与标签制品一致。 JetBrains 标签 workflow `38095423253` 的后台市场后验证现已成功，最终 completed/success（13 success / 6 条件 skip）；追加 completion 归档绑定这一后续状态，保留早期市场回读时 queued/conclusion=null 的原件。 标签制品中 JetBrains 推荐 CLI 的 class 字段 ConstantValue 已直接核验为 `.97`（未执行 JVM），VSIX 的动态 package.json 来源与准确 Git blob 已核验；回读解析器另有 11/11 离线合同及摘要绑定。 默认渠道仍Open VSX/JetBrains，未新增Microsoft Marketplace backfill；公开市场的实际状态以[发行索引](./cli/evidence/gap-2026-10-05/release-0.166.97/final-release/manifest.json)及各市场回读为准。

正式 36 tasks + 9 firstRuns、$99 和 observations 保持 NOT_RUN/INSUFFICIENT_EVIDENCE；旧 Windows 211=194/16/1、mutants 6/4/4 以及新 fixture 211=208/2/1 均未改写，完整 native review 继续 NOT_ADMITTED。Windows/macOS durable、受保护 journal、服务自身恢复/WFP、正式目标宿主、官方 usage/账单、独立人工/辅助技术与 8h/24h/SLO 仍开放。本轮无付费 provider 调用，草稿 PR #428 未合并。

### 20.31 2026-10-11 LowBox scratch ACL 实际读取与兼容缺口

现有 `packages/session-core/lib/private-storage.js` 的Windows私有存储先固定spawn PowerShell，再校验owner、protected DACL、唯一owner ACE和完整继承/权限。冻结journal失败在sessionPath/getSessionsDir/ensurePrivateDirectory阶段，尚未进入恢复断言；非timeout启动错误汇总为 `windows-acl:spawn`，旧原件缺精确launchStage，不能归因路径解析或native hook。

本切片只在 `22ef588c1bb8f71c45feaa115df1d75d5ca505c5` 的独立.work副本增加固定无参数 `observeFixedScratchAcl()`。actor自己新建 `X:\scratch\private-v4-acl-probe`；当前零capability LowBox线程以READ_CONTROL/FILE_READ_ATTRIBUTES和无reparse检查持有scratch与该目录HANDLE，用GetSecurityInfo读取实际owner/DACL/control及全部ACE原字节，没有宿主代开、任意路径、WRITE_DAC、namespace变更、可执行授权扩展或D访问。带参数调用实际拒绝；默认六槽保持。

一次真实运行 **23:36:10.206Z → 23:36:13.723Z**（2026-10-10 UTC / 2026-10-11本地）。GetSecurityInfo Win32 error0、descriptor valid，owner=current user；DACL present=true/null=false/defaulted=false/protected=false。三条ALLOW ACE的flags均 **0x13 = OI|CI|INHERITED**：用户mask **0x1f01ff**、SYSTEM(S-1-5-18)mask **0x1f01ff**、当前AppContainer mask **0x1301bf**。独立解析原始ACL/ACE与SID字节并重算现有精确条件，ownerOnlyContract=**FAIL**；诊断root exit0只说明完成完整负观察，admissionEligible/compatibilityConfirmed/authorityProven/continuousStabilityProven均false。未设置ACL，不能据此推断设置后的语义结果。

root PID28452、thread24784；前后有效primary token、无impersonation、capability0、FileId/卷号/NT路径一致，仅单次观察，不构成连续稳定证明。仅root启动，launchRequests0；原HANDLE wait0/exit0、Job0、profile删除、host map未变。14source、3binary、7copy前后绑定并独立复核；实验adapter仅三处接线，另八份原native/CJS源逐字节匹配22ef。没有工程源码改动，也没有进入已发行CLI/IDE；compiler closure非hermetic，本机Windows10/Node22.22.2不冒充正式目标宿主。

[46份gzip原件索引](./cli/evidence/gap-2026-10-05/acl-observation-2026-10-11/manifest.json)与[独立回读](./cli/evidence/gap-2026-10-05/acl-observation-2026-10-11/archive-validation.json)保存完整header/actor/driver/verifier、源码diff、构建原件和运行结算；大二进制保留.local摘要绑定。归档双摘要/原始字节及verifier重算FAIL全部通过，未再次实跑。没有PowerShell调用，所以旧spawn拒绝仍未定位；未执行完整冻结journal/review。其余owner-only实际实现、junction、protected journal/durable服务、自身恢复/WFP、正式36+9/NOT_RUN/INSUFFICIENT_EVIDENCE、$99/observations、旧211=194/16/1及6/4/4、新211=208/2/1、账单/独立人工/辅助技术/8h/24h/SLO仍保持原状态，无付费调用。
