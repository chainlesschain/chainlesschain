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

本地 host DOM 与 extension-host runner **86/86** 通过，CLI 引用侧 20 个文件分轮 **260/260** 通过；最初两个 DOM 文件因本地缺少锁定 `happy-dom` 没有加载，隔离补齐 lock 中的 20.11.1 后通过，未修改仓库依赖。ESLint、Prettier 和 diff 检查通过。同一旧提交的 JetBrains 三系统 × 两版本六宿主全部成功，IDE 工作流最终只有上述 macOS VS Code 作业失败；Linux 发布门因此跳过。修复后的准确提交仍须完整 CLI 双门与 IDE 宿主矩阵，当前候选 CLI 0.166.89、VS Code 0.37.134、JetBrains 0.4.152 均未发布。

## 4. JetBrains 身份旅程

真实 Windows IntelliJ 2024.2 / 插件 0.4.152 的同一 IDE 进程完成八阶段诊断：有效 CLI、显式错误路径且存在 managed fallback、修复显式路径、同路径替换为 GCC、PATH 上 GCC、四个命令别名均缺失、managed fallback、安装到 PATH 后无需重启恢复。两次手动更新也显示正确的身份失败原因。

该诊断只使用本地命令 fixture，没有发送模型请求、运行 agent 任务或安装公开产品。[安全归档与回读](./ide/evidence/gap-2026-10-05/onboarding-identity-windows/readback.json) 包含 29 份原始文件，其中 10 张截图限定 IDE/对话框；前两次失败尝试的整桌面截图不公开，前三次失败原因和清理结果分别保留。最终回执绑定 `ae6adbe13c` 加 dirty 工作区及逐文件字节摘要，五份源码摘要与当前文件一致；不能将其描述为干净提交的 CI 或首次公开安装样本。实际 IDE 正常退出，Gradle owner exit 0、taskkill 未使用、已记录进程身份均已消失。

## 5. 仍需独立完成的任务

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
