# CLI / IDE 差距续做：Actions 修复与身份诊断

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
