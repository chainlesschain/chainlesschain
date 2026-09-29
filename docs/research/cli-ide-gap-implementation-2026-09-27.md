# CLI / IDE 差距实施状态（2026-09-27）

对应 [CLI 审计](./cli/cli-claude-code-codex-gap-analysis-2026-09-27.md) 与 [IDE 审计](./ide/ide-claude-code-codex-gap-analysis-2026-09-27.md)。审计描述修改前快照；本表记录后续实现，避免重复开工或将局部测试当成全部验收。

初始实现分支：`feature/cli-ide-gap-closure-2026-09-27`，现已合入 `main`。基线 SHA：`24911a536c9e9800c1e2e6b1d72e610841be4f5c`。后续 token 校准改动直接进入 `main`，提交记录见下文；本地结果不代表 GitHub Actions 发布验收。

### NET-01 / NET-02 与发布门更新（2026-09-30）

`9daa8ffa96b983e33afc4bff1f0d53786ff2e022` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36525770660) 全部通过。Linux 真实 Docker 扩展探针 4/4 通过，覆盖 IPv6、redirect、WebSocket CONNECT、子进程、broker/relay 故障及容器清理。后续 `0fc1b991bc885cf7d76b5ae70b9d3e50729f6a64` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36528391593) 和 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/36528391871) 全部通过，前者包含 `run_shell` 的真实 Linux Docker 产品路径。该后端已在 CLI 0.166.79 发布；NET-01 的剩余验收仍需逐项对照审计中的 DNS 与持续连接证据，不由一次产品正向探针推定全部完成。

NET-02 的运行中 Docker shell 权威轮询、不可逆撤销锁存、代理/容器回收及回执前复核，已在 `dd6b1318372d91f534469e03fb0607a155e46a38` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36554998759)（包含 Linux 真实 Docker 步骤）和 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/36554790810) 完整矩阵通过。新增真实 Docker 持续 HTTP/WebSocket 撤销和直连 UDP DNS 服务端计数探针在 `56df898a4eeb97230cbb12688b0157db27526977` 的 [Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36635112565) 四个作业全部通过，其中 Ubuntu 作业执行真容器探针。此 DNS 探针仅证明所测直连 UDP 路径，不能推导所有 DNS 传输。轮询仍不是无丢失的 revision 订阅：两次检查之间的收紧再恢复可能漏检。后续发布继续以准确提交的完整 `CLI CI`、`CLI Strict Sandbox` 三系统矩阵为门。

`9780c8d292` 的 CLI CI 失败报告含三系统相同的发布契约旧断言：工作流的 CLI registry 回读已改为最多 90 次，而测试仍要求 30 次。该测试已同步到 90 次，本地 23/23 通过。Windows 另外出现两个隔离服务启动 120 秒超时及 ACL 遍历 15 秒超时；本机将对应三个文件串行运行 12/12 通过。候选 CI 修复给 Windows unit 增加已用于 integration 的 60 秒 ACL 上限，并在每个 Windows unit shard 内串行文件，保留全部断言与安全检查；`actionlint` 通过，效果仍须新提交的准确 CI 验证。

`0d01fb8cecf1cf057529e66fe9adf241639c70e0` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36637005711) 中，Ubuntu 真容器、macOS 15 与 macOS latest 作业通过；Windows 作业在 MCP capsule 真进程测试的宿主观察器全量 CIM 查询上触发 20 秒 `ETIMEDOUT`，尚未执行该测试的隔离效果断言，故整轮仍为失败。后续候选把已知根进程 PID 的身份读取改为定向 CIM 查询，保留 nonce 后代和完整进程树的全量检查及超时失败。Windows 本地非 live 测试 19 通过、3 跳过，定向 CIM 查询在沙箱外返回预期 PID；本机 AppContainer readiness 失败，不能替代新提交的托管 Windows live 结果。准确新 SHA 的完整 `CLI CI` 与 `CLI Strict Sandbox` 仍待验收。

`9544285becf645c65597e7a083e361f28298569d` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36639593195) 已全部通过，包含 Windows 原生 MCP capsule 边界及 Ubuntu 真 Docker 网络边界；该 SHA 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/36639593359) 与 [IDE Extensions 宿主矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/36639966108) 尚未取得完整通过结论。`9ed9dccb0aa41e52c8f3ca80e6088be0c7794622` 为 Strict Sandbox 增加独立 `ubuntu-24.04-arm` 原生隔离作业，覆盖 broker、MCP capsule、bubblewrap 与 Docker 出口；ARM Docker 镜像使用和现有 x64 镜像同一 manifest index 的固定 ARM64 digest，并在运行前核对容器架构。该 [ARM64 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36640984148/job/109652931841) 在原生测试前期因硬编码 x64 的 `O_TMPFILE` 目录位而以 `EINVAL` 拒绝，并未完成隔离效果断言；后续候选从运行时 `O_DIRECTORY` 推导该位并增加 ARM64 定向回归和真实匿名 inode 探针，仍待托管复验。

`c7b10fdc9ddb6698d0ae271d98a97d73ad65dcc1` 的 [ARM64 原生作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36642519601/job/109657844328) 已通过：精确提交和 `aarch64` 身份、匿名 inode 正对照、broker/MCP capsule、bubblewrap 与 ARM64 固定镜像的真实 Docker 出口均成功。该轮 [Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36642519601) 整体仍失败：Ubuntu x64 在进入隔离测试前发现安全映射夹具中的平台测试源码摘要过期。下一候选只同步该摘要；本地映射测试脚本已通过，准确新 SHA 的完整矩阵仍需复验。

`eb5a6f91be61498038f884ae10cbfe22612b7a96` 同步映射摘要后，ARM64、Ubuntu x64 和 macOS latest 的 [Strict Sandbox 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36643157855) 已通过，其余作业当时仍在运行。另一 [CLI Native Release Readback](https://github.com/chainlesschain/chainlesschain/actions/runs/36643157857) 静态契约测试仍按旧矩阵计数，只期待两个精确 SHA checkout，新增 ARM64 作业使实际为三个。后续候选同步契约计数并保留每作业的 checkout 与 SHA 校验；本地 23 项发布契约测试通过，准确新 SHA 的完整门仍待复验。

`c220cd1554786110d4576482407d01d634fc6444` 的 [CLI Native Release Readback](https://github.com/chainlesschain/chainlesschain/actions/runs/36644143434) 已通过；[Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36644143343) 的 ARM64、Ubuntu x64 和 macOS latest 作业通过，macOS 15 作业在通用 Linux bubblewrap 的模拟测试中失败。该模拟夹具从宿主 `fs.constants` 继承 macOS 的 `O_DIRECTORY`，与模拟 Linux x64 `O_TMPFILE` 不匹配，生产 macOS Seatbelt 测试并非此处的失败点。后续候选让模拟夹具始终使用 Linux ABI 常量；本地相关 27 项测试及格式、lint 通过，仍需 macOS 托管复验。

| ID                      | 当前状态               | 实现与有效证据                                                                                                                                                               | 剩余条件                                                                                         |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| MODEL-01                | 本地合同验证通过       | GPT-6 Astra/Sol/Luna、Opus 5.5 精确 profile；官方 endpoint 与自定义网关隔离；三个 GPT-6 型号的 Responses stream/tool/reasoning 回归                                          | 目标账号真实调用；未更改用户默认模型                                                             |
| MODEL-02                | 本地合同验证通过       | tracker、预算、durable usage、恢复结算和 Eval 统一定价；逐请求长上下文/缓存/服务层级；未知价为 NULL/unpriced。已纳入 45 文件 822 项回归                                      | 目标账号与账单对照；旧聚合缺逐请求信息时保持 unpriced                                            |
| READY-01                | 本地验证通过           | CLI-only 在 Run/付费分解/通知前拒绝；help、detect JSON、status 区分安装与准入；API 标为 text-only；`--cli-tool` 真正选后端。router/orchestrator 73 项通过，实际命令 4 项通过 | 精确提交 CI；保留逐请求治理门                                                                    |
| CODEX-01                | 局部实现并验证         | 官方 schema、thread/turn 隔离与有界协议；0.157.1 Windows 真进程交错线程、三终态、审批取消及已接纳断连拒绝重跑通过，52 通知及审批对独立复核；相关 45 项回归通过               | 固定二进制真实 turn/schema 三系统 CI、实际工具执行与 provider 验收；未扩大生产白名单             |
| BRIDGE-01               | 局部实现并验证         | Broker/bridge 回收；静态 helper/npm 包探针；`71919bc5c1` 托管 x64/ARM64 无编译器单元通过                                                                                     | standalone 分发、监督器丢失后恢复、macOS 及最终三系统验收；主路由拒绝未 attested CLI             |
| IDE-REPLAY / SESSION-01 | 局部实现并验证         | v2 历史与双 IDE 增量合并、来源与身份检查；Windows 双 IDE 实际包恢复通过；JetBrains 旧七标签副本恢复和按选中读取后的完整旅程通过                                              | 原旧 profile 失败唯一根因未定；其他宿主版本/系统、旧历史边界及真实 rewind/compaction             |
| IDE-DRAFT               | 局部实现并验证         | 双 IDE composer/附件/问题草稿、发送前保存与回执核对；Windows 双宿主草稿重启恢复；JetBrains 实际 GUI 的 init 等待中 Stop、迟到 init、取消草稿重启且不重发已通过               | 附件/问题表单真实宿主、跨平台和可访问性待验收；其余准备/写入阶段及再次发送后的 Stop 宿主专项待补 |
| IDE-STREAM              | 本地验证通过           | 稳定文本节点增量 append，结束解析一次；选择区延迟格式化；follow-bottom；10K/100K/200K 与生成 Webview 滚动测试                                                                | 真实宿主 frame p95/最长 task 基准与验收                                                          |
| IDE-MODE                | 局部实现并验证         | 双 IDE requested/effective/pending/failed/unconfirmed；CLI init 关联 ID、实际模式与 policy digest；JetBrains 独立停止线程、退出确认、启动取消与过期响应隔离                  | 真实组织策略/宿主旅程与全平台进程树证明；观测句柄不是 OS 进程隔离                                |
| IDE-IMAGE               | 局部实现并验证         | 双 IDE 4 张/20 MiB turn/40MP 单图；异步处理、逐项错误；CLI 保留 8 张上限，并补齐 20 MiB turn/40MP/header/有界同句柄读取；CLI 图片相关 4 文件 61 项通过                       | 真实宿主测量；完整 codec/动画帧与读取延迟不在 header 准入证明内                                  |
| NET-01                  | Linux 产品路径局部验收 | Docker 强制出口、固定镜像、`run_shell` 异步执行及真实产品路径在 `0fc1b991` 通过；`56df898a4e` 增加直连 UDP DNS 真容器拒绝证据                                                | 其他 DNS 传输及审计列明的剩余绕过项仍须按真实流量逐项验收                                        |
| NET-02                  | 真实产品撤销局部验收   | 代理 revision CAS 和活连接撤销；Docker shell 有界复核、撤销锁存及回收；`dd6b131837` 三系统门与 `56df898a4e` 的四作业 Strict Sandbox（含 Linux 持续 HTTP/WS 真容器探针）通过  | 当前候选准确 SHA 的完整 CLI CI/Strict Sandbox 及无丢失 revision 订阅仍缺                         |
| VERIFY-01               | 待实施/验收            | 保留历史真实模型试点及其范围                                                                                                                                                 | 冻结 30–50 任务、干净安装、实际项目、双 IDE、成本/维护窗口                                       |
| PLATFORM-01             | 局部补强，待完整矩阵   | Windows detached 文件 fd 真载荷与正对照；`9544285` macOS latest 能力探针通过；`c7b10fd` 的 Linux ARM64 原生 broker/MCP、bubblewrap、真 Docker 出口作业通过                   | 修正安全映射摘要后的准确 SHA 完整三系统门；其余 OS/架构/后端/stdio 组合及真实进程验收            |
| PERF-01                 | 局部实现并验证         | 同磁盘夹具全扫/首进程建索引/已有索引新进程/热首页与下一页/失效重建对照；逐页全量内容校验；路径观测失败不报告完整索引验证                                                     | 精确 SHA 三系统 formal、目标硬件与冻结 SLO；Memory 仍为原全文件端口                              |
| PERF-02                 | 单模型分层试点         | 复用压缩与工具配对保护；Volcengine 四类真实请求各 5 个长度，20 次请求中 15 次低估；修复非流式响应带入 `reasoning_content` 的续接错误；真实压缩旅程仍未通过                   | 其他目标 provider 与多轮真实请求；定位压缩阶段失败、冻结误差门限，测压缩后的事实保真和任务成功率 |
| MCP-01                  | 本地验证通过           | 真实 loopback HTTP 验证 stateless 404、过期 session、并发单次重建、重建失败；只恢复连接，不重放结果未知的工具调用。相关 57 项回归通过                                        | 目标 MCP 服务端互操作与最终提交 CI                                                               |
| MAINT-01                | 局部实现并验证         | JetBrains 问答字段合同、存储/请求生命周期和原生表单抽取；保留原 child 交付、schema 校验和草稿恢复不变量                                                                      | 其余 runtime 与平台职责抽取、保行为验证                                                          |
| DOC-01                  | 本地索引已补齐         | 本表为两份报告共享状态入口；下方按全部 20 个 ID 记录代表提交、可复核证据与被替代的旧结论                                                                                     | 新提交及最终发布结果仍须持续回填                                                                 |
| UX-01                   | 按现有入口改进         | READY-01 改进 help/status；MODEL-02 改进费用未知值                                                                                                                           | 复用 doctor/instructions/cost；语音/主题不自动立项                                               |

真人 NVDA/VoiceOver/Orca 听测及 8h/24h 生产观察尚无本轮新增结果。Volcengine 真实账号仅用于下述 input usage 试点，不构成双 IDE 真实任务验收。真实宿主新增 Windows VS Code 1.132.0 与 IntelliJ 2024.2 的有限恢复旅程证据，分别绑定下述提交；这些宿主旅程的模型输出仍为夹具。云恢复与新交互产品仍为报告中的条件性产品决策。

### NET-01 Linux 候选后端与验收边界（2026-09-29 历史切片）

已增加宿主 Worker 的私有 Unix socket 监听，以及 Linux Docker 双容器候选后端：relay 容器使用 `--network none` 并独占宿主策略 broker socket；目标容器共享 relay 的网络命名空间，只挂载工作区，使用默认拒绝的 seccomp 限制 socket 家族和其他系统调用。容器创建、运行与按身份回收均通过 ProcessExecutionBroker 审计；创建结果未知时保留不含命令或路径的恢复记录并报告清理未完成。新增真实 Docker 探针列入 `CLI Strict Sandbox` 的 Ubuntu 作业，包含允许请求正对照、清除代理变量后直连 TCP、UDP、工作区 Unix socket 拒绝及宿主连接计数。

本地 Docker daemon 未运行。`c1f761dc32b73bbfe30c9d35126c33bf91ada48c` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36469139935) 四个作业全绿；Ubuntu 作业中真实 Docker 探针 1/1 通过，证明该提交下允许请求可到达宿主 nonce 上游，清空代理变量后的 IPv4 直连、UDP 与工作区 Unix socket 探针受阻。该提交时的候选后端尚未接入 agent shell；后续接线与 CI 结果见表首。这个早期探针不能替代策略撤销、DNS 和完整 NET-01/02 验收。

### NET-02 代理层撤销切片（2026-09-29 历史切片）

出口代理现在对策略保存不可变快照，用单调 revision 和预期版本 CAS 更新。更新时撤销所有存量 HTTP 响应与 CONNECT 隧道；DNS 等待、上游连接回调和响应回调均检查原租约版本，防止旧请求在策略变化后建立连接。普通 HTTP 上游 Host 固定为已校验 URL 的 authority，真实上游回执确认客户端伪造 Host 不会透传。原始 WebSocket upgrade 明确拒绝，避免进入未登记连接。Windows 真实 loopback 测试覆盖 HTTP 已收首帧后撤销、CONNECT 已收首帧后撤销、DNS 延迟期间撤销、旧 revision 重放和新请求拒绝；代理集成测试共 27 项通过。

这是当时的代理控制面证据。该提交时 NET-01 的 Linux 不可绕过出口后端尚未接入产品；环境变量代理可以被忽略，所以这里的测试不能证明受限域名命令已安全联网。NET-02 的最终验收须在该后端内，以真实 HTTP/WS 持续连接复核撤销和上游零后续帧。

出口代理现有的主线程实现会被同步的 `executeSandboxedShell` 阻塞。本轮新增独立 Worker 承载相同的 HTTP/CONNECT 策略代理，只绑定宿主 loopback；控制面使用有界消息请求、revision CAS、共享关闭确认和异常终止回调。真实子进程阻塞主线程期间，独立上游 HTTP 正对照仍能收到允许请求；跨 Worker 策略更新使后续请求返回 403，并关闭已经建立的 CONNECT；Worker 强制终止后端口不再服务。Agent shell 接线已改用该 Worker，受限域名执行仍由能力评估在启动前拒绝。新增 Worker 集成测试 3 项连同原代理和远端授权回归共 93 项通过。Worker 本身不是 NET-01 的强制出口，既不提供 namespace 内 relay，也不阻止清空代理变量或直接 socket；同步 shell 执行期间主线程仍无法接收新撤销命令，最终出口需要异步监督或独立控制面。Linux 真实工作区可能包含宿主 Unix socket；独立 netns 不隔离这些 pathname socket，最终后端必须继续拒绝目标进程的 AF_UNIX，并用不同权限的可信 relay 接到宿主策略 broker。

### PLATFORM-01 当前验证边界（2026-09-29）

`3bd8d9d012` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36460431722) 四个作业均通过，包含 macOS latest 真进程能力探针；同一提交的 [Env-Blocked Verification](https://github.com/chainlesschain/chainlesschain/actions/runs/36460431518) 中 Go/Rust 真 LSP 与 Linux bubblewrap 通过，Java 真 LSP 因 JDTLS 以代码 13 退出而失败。该工作流原先下载可变的 `latest` snapshot 并使用 JDK 21（可回退 JDK 17）；当日 snapshot 的 `org.eclipse.core.filesystem` 与 `org.eclipse.equinox.security.linux` bundle 声明需要 JavaSE-25。下一提交将 JDTLS 固定为 1.61.0 milestone，以官方 SHA-256 校验下载包，明确安装 Temurin 21，并在失败时打印 Eclipse 日志。该修复需以新提交的真实 Java LSP 作业通过为准；旧提交的失败或成功均不能转移。

`403a1f0bb5` 的 [Env-Blocked Verification](https://github.com/chainlesschain/chainlesschain/actions/runs/36461909363) 证明固定版 JDTLS 在 Java 21 上能完成 initialize、definition 与 diagnostics；Java references 查询仍触发客户端默认 15 秒请求超时，Go/Rust 和 bubblewrap 均通过。下一提交只为真实 Java references 查询设置 60 秒有界请求预算，保留完整引用数量断言，并修复日志步骤遇到无权限 `/tmp` 目录时提前退出的问题；是否足够仍须由新提交的真 LSP 作业判断。

`8d8f0bdab8` 的 [Env-Blocked Verification](https://github.com/chainlesschain/chainlesschain/actions/runs/36462843768) 全部通过：Go、Rust、Java 共 9 项真实 LSP 测试通过，Linux bubblewrap 真进程作业通过。[CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36462843899) 四个作业全部通过，覆盖 macOS latest 能力探针及 Ubuntu、Windows、macOS 15 strict cell。此证据绑定 `8d8f0bdab8`；后续修改仍需按新 SHA 单独验收。

| 系统 / 架构                     | 后端与 stdio                                    | 现有或待运行证据                                             | 结论范围                                                          |
| ------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Ubuntu 24.04 / 托管 x64         | prlimit 与 bubblewrap；平台合同中的标准 stdio   | Strict Sandbox 的现有真进程作业                              | 仅限该 runner 和已测试组合                                        |
| macOS 15 / 托管架构             | Seatbelt `sandbox-exec`；平台合同中的标准 stdio | Strict Sandbox 的现有真进程作业                              | 仅限仍提供后端的镜像                                              |
| macOS latest / 实际架构写入回执 | Seatbelt；pipe stdio                            | 新增独立真进程探针；后端可用时验越界写入，缺失时验拒绝和审计 | `enforced` 与 `unavailable-fail-closed` 分开记录，须待精确 SHA CI |
| Windows latest / 托管 x64       | restricted token / Job；detached 文件 fd        | 原有真进程验收加有效载荷正对照和严格拒绝                     | 本地定向测试通过；待精确 SHA CI                                   |

以上不能推导 Linux ARM64、其他 macOS 架构或全部 stdio 组合已有强制隔离。`macos-latest` 的缺后端成功回执只证明拒绝准确，不证明隔离后端可用。

`5027bb6236` 的独立 [macOS latest 回执](./cli/evidence/platform-macos-latest-arm64-5027bb6236.json)记录 macOS 26 / ARM64 的 `sandbox-exec` 实际可用，原生写入正对照成功，严格 broker 阻止宿主 home 写入并记录 `macos-seatbelt` enforcement。这推翻了工作流原注释中 latest 镜像缺少该二进制的假设，但只覆盖该提交、镜像及 pipe stdio；该提交的 Strict Sandbox 总作业因安全映射文件摘要未更新而失败，不能计作整个矩阵通过。下一提交同步摘要并重跑。

`ee2d378fa5631eb3073bcf90b6267344f35f9e05` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36457365658) 四个作业均成功：Ubuntu 24.04、macOS 15、Windows latest 完整 strict cell，以及 macOS latest 独立能力探针。这是该精确提交的平台工作流结果；CLI CI 和后续提交仍须各自验收。

`d170ac87454ce4597b1ed346274cd06cdf2e1a16` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36459154624) 也在四个作业全部通过，覆盖代理 revision 撤销切片提交。其 CLI CI 仍按该 SHA 单独等待；下一轮 Host 归一化提交同样必须重跑准确提交矩阵。

共 20 个分组工作项：5 项本地验证通过、11 项局部实现/验证、2 项待实施/系统验收、2 项持续文档/体验。该计数不是最终验收完成率。[候选发布范围](./cli-ide-release-candidate-2026-09-27.md)单独冻结；长期差距仍按本表继续追踪。用户要求先按依赖顺序发布子 npm 包，再发布并验证 CLI，最后发布 VS Code / JetBrains 插件，已同步到根 AGENTS.md。

### 当前状态索引与审计结论替代关系（2026-09-28）

本索引对应两份 09-27 审计的全部任务 ID。提交列是能在本仓库 `git cat-file` 复核的代表性实现；本轮尚待精确 CI 的新切片用范围文字标注。代表提交不表示该 ID 的所有工作已经完成；没有实现提交的项目保留原审计结论。证据列只在其实际覆盖的系统、入口和场景内有效，剩余验收以表首“剩余条件”为准。`d6fc25c073d0261809ba421498b6e6d28753145b` 是当时的发布候选提交，其 CI 与发布资格须按准确 SHA 另行核对，不能由下列旧提交或本地证据推导。

| ID                      | 代表实现提交                                                         | 可复核证据与替代边界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODEL-01                | `3571acda0e`                                                         | 精确模型 profile 与 Responses 合同替代审计时的旧窗口/协议选择；目标账号的真实请求仍未验证。                                                                                                                                                                                                                                                                                                                                                                                                                   |
| MODEL-02                | `3571acda0e`                                                         | 统一价格及 durable usage 回归替代静态计价分叉；官方账单、旧聚合缺失字段仍未验证。                                                                                                                                                                                                                                                                                                                                                                                                                             |
| READY-01                | `42010e7148`                                                         | router/orchestrator 与实际命令回归替代“已安装即可运行”的提示；外部 CLI 仍须逐请求准入。                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CODEX-01                | `42010e7148`、`795434f144`、`312cdba006`                             | [真实 turn](./cli/evidence/codex-real-turns-windows-795434f144.json)和[审批取消](./cli/evidence/codex-approval-cancel-windows-312cdba006.json)替代早期 snake_case/跨 thread 反例；不构成生产白名单或真实 provider 准入。                                                                                                                                                                                                                                                                                      |
| BRIDGE-01               | `40addcedf1`、`915653abfa`、`e106b753d8`                             | [生命周期](./cli/evidence/bridge-lifecycle-windows-wsl-40addcedf1.json)、[隔离失败](./cli/evidence/process-ownership-quarantine-windows-wsl-915653abfa.json)和[持久阻断](./cli/evidence/durable-process-ownership-windows-wsl-e106b753d8.json)替代早期提前释放任务的行为；异常树回收和安全解除仍未实现。                                                                                                                                                                                                      |
| IDE-REPLAY / SESSION-01 | `44db0e64ab`、`c6852748ba`、`604ae5db28`                             | [VS Code Windows 回执](./ide/evidence/vscode-canonical-recovery-windows-5382a8c3be.json)及[JetBrains Windows 回执](./ide/evidence/jetbrains-canonical-recovery-windows-989a46cd6e.json)替代后台正文无恢复的原始反例；其余宿主与真实模型范围不随之扩大。                                                                                                                                                                                                                                                       |
| IDE-DRAFT               | `4889036941`、`38fc29e634`、`e5dc0aa6ed`、`989a46cd6e`               | 同两份 Windows 宿主回执证明有限 composer/Stop 恢复；附件和问题表单真实宿主旅程尚未由这些回执证明。                                                                                                                                                                                                                                                                                                                                                                                                            |
| IDE-STREAM              | `025dddcd46`                                                         | 增量节点/选择区本地基准替代每帧全文重绘路径；真实宿主 frame p95 与最长 task 待测。                                                                                                                                                                                                                                                                                                                                                                                                                            |
| IDE-MODE                | `025dddcd46`、`d45175eeac`                                           | CLI ACK 与双 IDE 状态/退出回归替代“请求值即生效值”的界面行为；组织策略及完整 OS 进程树仍待验收。                                                                                                                                                                                                                                                                                                                                                                                                              |
| IDE-IMAGE               | `6b5da7f538`、`8e9c6f9d4d`                                           | CLI/双 IDE 图片大小、像素和格式前置检查替代原无预算路径；真实宿主吞吐、完整 codec/动画帧不在现有 header 证明内。                                                                                                                                                                                                                                                                                                                                                                                              |
| NET-01                  | `960168dc6a`、`0fc1b991bc`、`56df898a4e`                             | Docker 强制出口已接入 `run_shell`；`0fc1b991` 的 Linux 真实产品路径和三系统 Strict Sandbox 通过，`56df898a4e` 增加直连 UDP DNS 服务端计数。其他 DNS 传输和其余真实绕过证据仍未齐。                                                                                                                                                                                                                                                                                                                            |
| NET-02                  | `ad6c2f2478`、`969ba05408`、`dd6b131837`、`56df898a4e`               | 代理 revision CAS 与活连接撤销、运行中 Docker shell 锁存/回收已有 `dd6b131837` 的准确提交三系统 CI 和 Linux 真实产品撤销步骤；`56df898a4e` 的四作业 Strict Sandbox 与 Ubuntu 新持续 HTTP/WS、直连 UDP DNS 真容器探针通过。当前候选完整 CLI CI 及无丢失 revision 订阅仍缺。                                                                                                                                                                                                                                    |
| VERIFY-01               | 无本轮实现                                                           | 历史 Windows/Volcengine 试点仍按原范围记录，不能替代冻结的 30–50 个真实项目任务及双 IDE 旅程。                                                                                                                                                                                                                                                                                                                                                                                                                |
| PLATFORM-01             | 无本轮完整实现                                                       | 现有 Strict Sandbox 真 cell 与 unsupported 分支有效，不替代最新 OS/架构/stdio 完整矩阵。                                                                                                                                                                                                                                                                                                                                                                                                                      |
| PERF-01                 | `6c47788623`、`f6f7840502`                                           | [Windows 容量回执](./cli/evidence/persistent-capacity-smoke-windows-6c47788623.json)替代“只有全扫”的审计快照；formal SLO、其他系统及 Memory 生产端口仍开放。                                                                                                                                                                                                                                                                                                                                                  |
| PERF-02                 | `bc2b09add2`、`2a976216f8`、`a74b03cdd6`、`fd9cd4ca69`、`27fa60cdde` | 原 bytes/4 估算和压缩/工具配对保护不变；[四类单点回执](./cli/evidence/context-token-calibration-volcengine-windows-2a976216f8.json)及[20 请求分层回执](./cli/evidence/context-token-calibration-volcengine-windows-a74b03cdd6.json)量化同一 Volcengine 型号的偏差。[真实旅程失败](./cli/evidence/ide-roadmap-live-provider-trajectory-volcengine-windows-e3591426b9.json)及[传输诊断](./cli/evidence/perf02-volcengine-transport-windows-e3591426b9.json)定位第二轮摘要结果未知，不替代整段压缩事实保真验收。 |
| MCP-01                  | `42010e7148`                                                         | loopback HTTP 回归替代短暂 404 必然断连的反例；目标 MCP 服务端互操作仍待验证。                                                                                                                                                                                                                                                                                                                                                                                                                                |
| MAINT-01                | `f9fb1ec91b`、`e5dc0aa6ed`                                           | IDE 问答字段与请求生命周期已拆出，替代这部分混杂职责；agent-core 与平台职责拆分仍开放。                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DOC-01                  | 本文                                                                 | 此索引将历史审计、现行实现和待验收条件分开；每次新实现与发布结果需更新准确提交和证据。                                                                                                                                                                                                                                                                                                                                                                                                                        |
| UX-01                   | `42010e7148`、`3571acda0e`                                           | help/status 与费用未知值已经改进；语音、主题等仍是条件性产品决策。                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 子 npm 包与 IDE 发布路径复核（2026-09-28）

重新逐一查询 15 个非 private workspace 包的公开 npm `latest`：Agent Protocol 源码 `0.1.12` 对应公开 `0.1.11`，Agent SDK `0.2.12` 对应 `0.2.11`，CLI `0.166.78` 对应 `0.166.77`；其余 11 个子 npm 包的源码版本均等于公开版本。另一个非 private 包 `chainlesschain-ide` 源码为 `0.37.119`，npm `latest` 仍是 2026-08-03 更新的 `0.37.40`；它是 VS Code 扩展的历史 npm 记录，当前 IDE 发布由 `ide-extensions.yml` 的 VSIX/Marketplace 路径负责，不能因 npm 版本落后就把它混入 CLI 之前的子包批次。

通用 `workspace-npm-publish.yml` 原先会把这个 VS Code 扩展选作普通包，可能绕过“子 npm 包 → CLI → IDE”的顺序。下一批修复在检测器和发布循环两处拒绝 `vscode-extension`/`chainlesschain-ide`，仍允许 Agent Protocol 由通用发布器选择；Agent SDK 与 CLI 保持由 `npm-publish.yml` 按依赖顺序发布。本地隔离夹具的 tag 选择和手工 IDE 请求两项行为测试通过，`actionlint` 与 Prettier 通过。此处尚无该修复提交的 GitHub Actions 证据，也没有触发任何发布。

### 首轮 GitHub Actions 失败定位与修复

草稿 [PR #383](https://github.com/chainlesschain/chainlesschain/pull/383) 的首轮检查绑定 `01b6c0b7e450c3dca60e03d1b0a5e965b1ff7c53`。用户要求同时处理 Actions 错误；截至本次日志核对，23 个失败作业主要归于下列原因，包含下游聚合失败，不能当作 23 个独立产品缺陷。

| 类别                                      | 失败证据与原因                                                                                                                        | 本批处理与验证边界                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict Sandbox / Session Host Consistency | 三系统 MCP 恢复报 `completion-authority-malformed`；新 canonical projection 增加 `replayEvents`，严格字段校验仍只接受原三字段         | 明确允许可选函数字段，保留未知字段、accessor、head/count 拒绝；不调用 replay lease。原 3 项在 Windows 复现失败，修复后 4 文件 115 项通过                                                                                                                              |
| Execution Location                        | Local 三系统、WSL、Container、SSH 共 6 作业在 npm 安装报 `Cannot read properties of null (reading 'edgesOut')`，下游 aggregate 无产物 | 源宿主与隔离目标均从仓库根使用锁文件及指定 CLI workspace 的 `npm ci`，保留 ignore-scripts。隔离清单目录 dry-run、7 项矩阵合同、actionlint、Bash/PowerShell 语法检查通过；真实各目标仍需新 SHA Actions                                                                 |
| VS Code ARM64                             | Linux / Windows 完整旅程末尾 DOM 缺已出现过的 permission/interrupt 状态                                                               | 普通和 canonical 旅程均在状态出现时保存独立 DOM，仍强制核验两种状态与完整协议记录；不要求瞬时状态在历史重建后保留。69 项宿主/relay 回归通过；新宿主矩阵待跑                                                                                                           |
| JetBrains ARM64                           | 四个 macOS/Linux × 2024.2/2025.2 作业等待旧 `force-stopped the agent process` 提示，实际已显示等待退出确认                            | 使用当前提示，并在双击 Stop 前只读观测真实 child/descendant PID，等待观测进程全部退出后才继续 resume。UI driver 编译通过，远端实机结果待新提交                                                                                                                        |
| Accessibility / Performance               | 三系统同一失败摘要；Linux 原始产物含 1 个页面错误、1 个语义播报遗漏，无性能阈值超限                                                   | 本地真实 Chromium 复现 about:blank 缺 `crypto.randomUUID`，发送未发生；夹具改为本地拦截 HTTPS 来源，与实际 webview 安全上下文一致，不模拟 UUID。完整 Chromium 分支页面错误、关键播报遗漏、重复播报、stream replay、heading 遗漏均为 0；不等于人工听测或完整 P2-4 验收 |
| Workspace Publish Staleness               | Agent SDK 和 VS Code 源码改动未递增版本                                                                                               | 保留门禁失败；候选冻结时统一版本和依赖，本批没有发布或改版本                                                                                                                                                                                                          |

另补 v3 宿主旅程检查“取消准备后显式再次发送，第一次 Stop 应为普通中断且保留同一 child”。验证器 51 项、真实 CLI peer/夹具 16 项通过。`1c4cfc08b8` 首次实际 ZIP 尝试在第一个 init gate 前已用尽发送等待时间，未执行到新场景，失败证据摘要为 `sha256:640425af19c82410eaf7f5aa886de5fb6d3bf52a66b0b529cf4cab1bad9c08e6`。夹具 gate 已移到 canonical store 导入/首次 ACL 初始化之前；该失败不作为产品 Stop 缺陷已复现或已修复的证据，后续实机结果另记。

后续在 `e71ace3dc1` 的实际 ZIP 中已经复现产品缺陷：取消准备时没有派发 user，却向空闲 child 写了 interrupt 并保留 `interruptRequested`；随后显式发送的新一轮第一次 Stop 进入了强停分支。失败证据 `sha256:436d269a9e8b4d5fe863160a41a4f75095dccb45d0c2ce6e557425508ed81532` 保留原样。修复在无活动 turn、无待结束 turn 且没有预约 stdin 写入时只取消本地准备/保持空闲，不发送 interrupt 或预约下一次强停；已预约写入和已有活动 turn 仍走原中断及二次 Stop 升级。v3 驱动同时覆盖取消后的空闲 Stop、再次显式发送及同一 child 的普通 Stop；51 项证据/runner 测试通过，实际修复后 ZIP 验收待执行。

修复后准备/预约写入、Agent/进程树停止和草稿相关 4 类共 18 项 Java 回归无失败、无跳过；实际 ZIP 构建与 UI driver 编译通过。

### 第二轮 CI 与 Stop v3 宿主验收

`bcb94c585147e3cf2b98ce1adcc73effd19361e9` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36322601225) 三系统全部通过；[Accessibility/Performance](https://github.com/chainlesschain/chainlesschain/actions/runs/36322600985) 三系统作业全部通过，聚合检查另行收集。Session Host Consistency 的 Windows/Linux 已通过，macOS 尚待结果。以上仅属于该 SHA，不能替代后续发布提交的完整矩阵。

JetBrains `bcb94c5851` 的 initial/restart GUI 均通过，但聚合验证器将 Windows `cmd.exe` 启动器 PID 与 Node 夹具 PID 直接比较，整体失败；原失败证据 `sha256:a458e3e38f13af213d24e4af7de9270ab7fb573aad63a6152ac9ee669a9237b7` 保留。验证器改为要求启动器 PID 不变、夹具 PID 始终属于只读观测到的子进程树，并按夹具 PID 关联真实协议记录；增加缺失进程树、无关进程和启动器/Node PID 不同的回归，54 项 Node 测试及驱动编译通过。

干净源码 `c54e902b6346cbc54e6bd3515ddb151c6948c213` 的完整实际 ZIP v3 旅程重新通过，[独立回执](./ide/evidence/jetbrains-canonical-recovery-windows-c54e902b63.json) 复核 **37 个产物长度与 SHA-256**、ZIP 安装逐文件一致性、真实 history/receipt 子进程及 A/B 六行引用。证据摘要 `sha256:61f7a017e588681a6fcd12fed50af6fd055507240fbb96d02df3210a1d2a72ca`。新增证据包括取消准备、迟到 init、空闲 Stop、显式再次发送后第一次 Stop 只中断该 turn 且保留同一启动器和 Node 进程；仍限 Windows x64 / IntelliJ 2024.2 与确定性模型夹具。

第二轮远端 JetBrains ARM64 越过原双 Stop 检查后，普通旅程在重启发送遇到 8 条未知输入保护上限。该旧夹具没有提供 input receipts；增加隔离磁盘的合成回执与只读查询，按 session/client ID 关联、跨进程去重并拒绝 ID 换内容，不修改产品上限或把未知输入自动标为成功。实际子进程回执/Workbench 2 项及 54 项 evidence/runner 测试通过；该普通夹具不作为真实 canonical 存储证据，远端宿主复验待新 SHA。

Execution Location 的依赖安装已通过，后续 Linux/SSH/WSL 日志显示 `session resume` 未向新版 Chat REPL 传入 authenticated evolution ingress；本地 Node 22.22.2 与 CI 固定 Node 22.12.0 均复现。Windows CI 另有更早的 target prepare 失败，本地两版 Node 未复现同一错误。继续分别处理，尚不宣称迁移矩阵通过。Workspace Publish Staleness 仍需候选冻结时统一版本。

`session resume` 已复用当前目标的 Chat 部署授权和 Run 绑定，等待同一 ingress 的交互生命周期结束；仅恢复入口加载部署，read-only history 不受影响。迁移脚本在隔离目标配置临时签名 Chat 测试部署，不传递源账号凭证，也不授予未签名调用权限。真实 CLI 子进程三种场景通过：无部署/仅 Agent 部署拒绝 Chat 恢复，有 Chat 部署正常恢复后 `/exit`，三种情况下只读历史均可用。相关部署、usage 和迁移合同另 4 文件 22 项通过；actionlint、Bash/PowerShell 语法及修改源 ESLint 通过。完整迁移过程和跨平台结果仍待提交后重跑；此处不证明真实 provider 或正式部署权限策略。

`949695433a` 的干净源码 Windows local `prepare-reconnect` 已完成真实目标 prepare、attestation、handoff 与 Chat `/exit`，产出 `reconnect-prepared.json`；未完成 100 次 campaign 或故障阶段，不能报整个矩阵通过。该结果也不能确定此前 Windows CI prepare 失败的唯一根因。

第二轮 VS Code ARM64 Linux 的两阶段 DOM relay 已执行成功，但聚合缺少 `initial-permission-dom.txt`：上一批仅修正 CDP 分支，relay 仍把快照写入限定于 canonical 模式。现在两种模式均保存原始观察快照，明确使用 artifactDir 而非 trace 文件所在目录；测试同时要求权限快照不含尚未出现的 interrupt。69 项真实驱动/runner 模拟回归通过，远端宿主待重跑。

### 第三轮平台修复与普通宿主复验

`c448c08305` 的远端 Linux/Windows Accessibility/Performance 已通过，JetBrains Linux ARM64 的 2024.2 / 2025.2 也已通过；CLI Strict Sandbox 三系统和 Local Linux 100 次迁移随后通过。其余排队或运行中的作业仍按对应 SHA 收集，不能将旧截图中的失败数作为当前缺陷数。版本检查继续保留失败，未升版本或发布。

该提交的 Windows IntelliJ 2024.2 普通控制旅程 initial/restart 均通过：[本地回执](./ide/evidence/jetbrains-control-windows-c448c08305.json) 独立复核 44 个产物长度/摘要，重新检查 rewind、模型设置与 Workbench 协议，并验证 100 个可见性样本。模型与输入回执为合成夹具，不替代 canonical 存储验收；收集目录包含旧共享截图，旧截图不作为本次成功证据。运行开始时源码干净，独立复核时已有后续未提交修复，回执明确区分两者。

同一干净提交的 Windows local [缩小迁移冒烟](./cli/evidence/execution-location-local-windows-c448c08305.json) 完成 prepare、断连/重连、生命周期故障、结果收集/审查/导入和 finalize，共 2 条轨迹；9 个产物哈希/长度复核通过。秘密转移、重复 handoff/settlement、孤儿进程、过期授权接受和静默 fallback 均为 0。此结果不满足 100 次门槛，也没有确定 Windows CI prepare 失败原因。

| 失败类别                      | 已核实原因与处理                                                                                                      | 验证与剩余条件                                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container target provisioning | Docker exec 默认从 `/` 启动，使 home 防护将临时 home 视为工作目录后代而正确拒绝；测试部署配置改用已知仓库路径作为 cwd | 真实子进程从文件系统根启动配置 Chat 部署通过；保持仓库外 home 和签名部署校验，远端 Container 待重跑                                                                                                                                      |
| WSL1 ArtifactStore identity   | 实机内核 `4.4.0-19041-Microsoft` 将 birthtime 回退为 ctime，创建子目录后该值变化而 dev/inode 未变                     | 只在 Linux / 4.4 Microsoft 内核且两时间相等时不将该值作为创建身份；dev/inode、无链接、包含关系和句柄校验保留。Node 22.12.0 实机正常 start/complete 通过，目录替换、root/files/index 符号链接四负例仍拒绝；不宣称能防所有 inode reuse/ABA |
| Windows target prepare        | 本地两版 Node 和完整缩小流程未复现 CI 退出 1；现有上层错误丢弃目标输出，不能判断根因                                  | 增加固定枚举失败类别，不回传目标 stdout/stderr、路径或参数，不影响授权/重试决策。12 类回归含秘密哨兵，相关目标/监督器共 34 项通过；等待远端类别后继续修复，不能标为已解决                                                                |

ArtifactStore、WSL1 身份、根目录启动的 Chat 部署、迁移合同共 4 文件 58 项通过、1 项 Windows 符号链接测试按既有条件跳过；上述 WSL1 实机负例补充验证了实际符号链接拒绝。修改源 ESLint 通过。迁移证据的 producer 清单补入部署 helper、签名测试夹具、session resume 和 ArtifactStore 身份依赖，后续最终提交须重新取得完整矩阵。

后续 `8db732245f` 的 Windows CI prepare 仍返回退出 1，固定类别为 `unknown`，因此未将其标为修复。进一步增加白名单源码标签/行号（例如 `session-store:5422`）：目标 JSON 命令在失败时发出有界标记，源端只允许已知标签和合法行号，不返回完整堆栈、目标路径或消息；未知格式丢弃，失败继续阻止迁移。相关 55 项单元/合同通过，真实命令路由与协议升级回归另 27 项通过。工作流路径过滤同步覆盖目标部署 helper、签名夹具、Chat resume 和 ArtifactStore 依赖。

`c448c08305` 的 JetBrains ARM64 五个版本/系统单元最终均通过，SSH 100 次迁移也通过。VS Code Windows/macOS 的 minimum 宿主都在等待 interrupt 结果时超时，Windows 失败证据为 `sha256:7456b01e40422d7ff8289ebe0a225e8dbe914fcaa0cd2855fb85e3fc8425b2a8`；原始协议确认 Stop 已送达且 CLI 在 3 秒后返回 interrupted。产品 Webview 在有流式历史行时抑制了非错误终态文字，使中断提示只剩短暂的读屏播报。修复将 interruption 保留为独立 info 状态行，不覆盖已有回答，不依赖 aria-live 文本；缓存与切换会话的重绘使用同一行身份，内部 UI 协议 6→7 使旧保留 Webview 正常重载。带/不带流的两个回归先失败后通过，历史同步/恢复/流式渲染共 23 项通过，host/relay/SDK Node 测试 77 项通过；远端 minimum 宿主复验仍待新 SHA，不提前算通过。

`8db732245f` 的本地 Windows→WSL1 缩小运行完成 prepare、断连/重连、生命周期故障、1 次 campaign 和 finalize，产物记录 2 条轨迹、graceful SIGTERM、结果收集/审查/导入各 2 次，以及秘密转移/重复/孤儿/静默 fallback 均为 0。不过外层 PowerShell 工具返回退出 1，日志仅有 Node 22.12 的 CJS/ESM ExperimentalWarning，尚未独立确认最外层退出状态；暂记为成功观察产物，不计作干净退出或完整 100 次 CI 验收。

### IDE-REPLAY 规范压缩前历史分页

新增 `session show --json --history --page-size 50 [--before <cursor>] <id>`，使用 `chainlesschain.session-transcript-page/v2`；不带 `--history` 的 v1 active context 页保持兼容。规范 Kernel compaction 的摘要、类型及输出投影一致时，显示历史保留此前原始消息，不重复加入压缩摘要；不改变模型 resume context。每条显示消息按 session/event hash/item index 标识，重复正文仍是独立消息。游标包含 session、generation、revision、eventCount 与 before，读完整 hash chain/namespace/anchor 后核对历史前缀；追加消息和规范压缩不使旧页重复，回退或替换使旧游标失效。

旧式 `compact` 同时承担迁移、session-end 保存和上下文替换，不能一概视为保留历史的压缩。无法确认规范压缩、缺少可验证来源的 timeline rewind 或旧 snapshot branch 均明确返回 `coverage=snapshot-boundary`；VS Code 显示历史起于保存快照，不能借此恢复已撤销的消息。完整复制 fork 保留父链历史，显示身份绑定新 session，不允许跨 session 游标。旧 snapshot branch 本身只保存了所选上下文；新写入的回退前缀和分支继承见下文，不能据此将旧记录标为全历史验收。

VS Code 显式请求 v2，检查消息身份、连续序号、重复 ID、revision/coverage 及下一页边界；切换回 live cache 保留分页入口与覆盖范围说明。旧 CLI 不支持新 flag 时明确加载失败，不悄悄宣称完整历史。读取不启动 Agent、不执行工具、不重新发送用户输入。仍是快照分页替换，尚未实现 durable/live 事件增量合并与去重；JetBrains 后续接入见下节。

页面保留至多 100 条/1 MiB 行载荷，单条文字最多 200K 字符；省略标记通过 truncated 返回，旧页逐步遍历。完整性验证每次仍需 O(N) 扫描，规范压缩校验临时空间受单个 canonical record 大小限制，不宣称索引页性能或全文不截断。

本批相关回归 8 文件 72 项通过；新增历史/宿主 2 文件 15 项最终通过。首次扩展运行的摘要夹具预算过小，Kernel 正确排除摘要而未覆盖预期路径；提高夹具预算后，已断言 active context 确实包含摘要、显示历史仍只含原正文。覆盖真实磁盘、两次规范压缩、保留摘要、追加后的旧游标、回退、两类分叉、无效 revision、篡改尾记录、有界多页遍历、只读命令及宿主身份校验。修改源文件 ESLint 0 errors/warnings；Prettier、三个命令 drift check 与本地 VSIX 构建通过。实现边界见 [Chat history recovery](../../packages/vscode-extension/docs/CHAT_TRANSCRIPT_HISTORY.md)。未执行真实双 IDE GUI 或精确提交 Actions。

### IDE-REPLAY 回退的有效祖先前缀

CLI timeline `restore-conversation` / `restore-both` 在既有同步会话事务中写入 `historyPrefix`：绑定实际当前 head、源上下文长度与保留前缀长度。历史读取同时核对前一事件 hash、完整保留消息及被选 user 的来源；不能仅凭相同正文猜测原事件。规范压缩的直接消息按 source sequence / source digest 追踪，摘要按可核对的 parent digests 合并来源区间；来源未知、区间跨越回退点或替换正文不匹配时仍只使用显式快照。

验证通过后保留回退点之前的原始显示行及身份，排除已撤销路径，generation 改变并使旧游标失效。回退后追加、再次压缩、再次回退及完整复制 fork 沿用这条有效祖先范围；先前已存在的 snapshot coverage 不升级为 from-origin。仅改变显示历史选择，不改变模型恢复上下文、文件恢复事务、绑定表裁剪或审批权限。

回退点可能早于内存页缓存，因此按最终选定范围在同一读锁内重扫完整链，再核对相同 head / event count / namespace / anchor；只读 visitor 在 finish 返回时失效，禁止异步或重入。页仍最多 100 条 / 1 MiB 行 JSON；可选来源映射最多 32,768 条 / 8 MiB 当前消息 JSON，超限丢弃映射并在回退时退到快照。最多 16,384 个不连续范围，超限明确失败；解析单条 canonical record 的临时内存另受原记录限制。可能需要两次 O(N) 扫描，不宣称索引查询或延迟改善。

本批当时的旧回退记录、timeline summary-from/to、snapshot branch、无法匹配持久化布局或摘要 parent 的来源仍是明确边界；后续新分支和新摘要记录的改进见下文。本批没有回填旧会话、借父文件恢复分支或合并 durable/live 事件。真实双 IDE 宿主、精确 SHA 跨平台 Actions 仍待验收。

本批 9 文件 224 项：222 通过、2 项既有目录 fsync 用例在 Windows 条件跳过、0 失败。覆盖真实 JSONL/Kernel、真实 CLI timeline 预览与确认、回退到页缓存之外、连续回退/摘要压缩、重复正文的来源身份、追加后分页、完整复制 fork、快照覆盖边界、错误前缀/未知 parent/交叉摘要/映射超量、只读重扫期间篡改及 lease 失效；同时回归 canonical store、输入回执、v1 分页和 checkpoint 权威路径。最后避免映射超量后继续解码消息的优化，另 4 项来源回归通过。修改源文件 ESLint 0 errors/warnings，只有根 package.json 既有 ESM 提示；Prettier 与 diff 检查通过。未将这些本地结果视作真实宿主或发布验收。

### IDE-REPLAY 分支的独立显示历史

新 timeline branch 在父会话事务内以限定同步读取凭据取得有效前缀，再在目标分支锁内流式复制显示记录。父源完整验证及 head 检查、来源范围与相同上下文核对均保留；读取过程中不能向父 writer 追加，凭据离开读锁后失效。分支持久化自身的消息、来源事件/item、上下文 origin 区间、条数与完整创建摘要，读取时不再依赖父会话路径。父会话删除后仍可分页；重复正文、嵌套分支、后续压缩/回退及完整复制 fork 各自保留有效范围与 session 命名空间。

显示归档使用独立事件，模型上下文沿用原有 branch 投影，不继承父会话审批、输入回执、工具执行请求或计费权威。完整可显示文字按每片最多 128K 字符写入，避免将页面的 200K 显示限制变成永久存储截断；不拆开 surrogate pair。每条逻辑行按最后一片的事件标识，分片顺序、来源一致性、context message digest、行/上下文计数和完成摘要均核对。最多组装 16 MiB 文字 / 256 片，源单条 canonical record 仍有 16 MiB 限制；图片保留显示占位，不宣称复制完整原始媒体或工具事件日志。

创建与重试不再把整条分支读入 event 数组；按流比较准确前缀后续写。未完成历史分支不提前发布 sidecar/witness，第二次失败也不会将半份副本变为可恢复会话；较高的既有 anchor 不回退。旧版本已创建的 snapshot branch 保持原内容与幂等性，不在重试时重写成新历史。未知来源、旧回退/摘要记录及旧 snapshot branch 的覆盖缺口仍明确保留；后续新摘要来源验证见下文。源验证、摘要与复制需要多次全扫和逐记录持久化，不宣称创建延迟 SLO。

同时修复 v1/v2 页面对大量转义字符的字节边界：单行 JSON 超过 1 MiB 时保留带 truncated 标记的文字前缀，不再整行丢失；分页显示限制与分支完整存储分开。真实 IDE GUI、可访问性听测、durable/live 增量去重和精确提交三系统 Actions 仍待完成。

本批最终 9 文件 234 项：232 通过、2 项既有目录 fsync 用例在 Windows 条件跳过、0 失败。覆盖真实 CLI 的分支预览/确认与回退、父会话删除后读取、嵌套分支、摘要压缩后继承/回退、完整复制 fork、两代大文本原文保存、emoji 分片、旧分支幂等、两个连续失败后的前缀恢复、较高 anchor 回退拒绝、复制期间源篡改、分片顺序/完成摘要/上下文来源验证、过期凭据/读期间写入拒绝；同时回归 canonical store、v1/v2 分页、输入回执和 checkpoint 权威路径。首轮两处夹具误用了删除函数名与命令响应层级，已修正并复跑。修改源文件 ESLint 0 errors/warnings（只有根 package.json 既有 ESM 提示），格式与 diff 检查通过；没有运行真实 IDE GUI、发布插件或精确提交 Actions。

### IDE-REPLAY 时间线摘要的可验证来源

新 `summary-from` / `summary-to` 在现有会话事务内写入 `historySummary` v1：绑定提交前的实际 head、源上下文条数及替换范围。计划器和读取器共用确定性摘要投影，读取器核对完整输出与 durable system provenance 后保留原正文；不是凭 action 名称或相同文字猜测来源。模型仍使用原有摘要上下文，原显示行、generation 与已有分页游标不因可验证摘要而改变；后续真实回退仍使游标失效。

摘要的 system 消息继续携带保守来源区间，参与后续摘要、Kernel compaction、分支导入与回退的交叉检查；未知来源或横跨回退点时退到快照，不能因 system 不显示而绕过验证。`summary-to` 的首条 system、已授权 durable system、未标记 system 排除规则，以及绑定表裁剪均沿用既有行为。区间只表示依赖范围，不宣称摘要保留全部事实或已校准压缩保真。

连续摘要、压缩前后摘要、新分支独立复制、父会话删除及完整复制 fork 均沿用这条来源链。早先 snapshot coverage 不升级；旧摘要缺少证书、head/count/range/output 不一致、上下文映射超过 32,768 条 / 8 MiB 时仍显示快照边界。v1 投影及 extractive formatter 的改变须升级来源协议或保留 v1 reader；不兼容时不能声称完整历史。每次历史读取仍验证完整链并重建摘要，无索引或延迟改善承诺。

带 system 摘要来源的分支使用 branch-history descriptor v2，其余仍写 v1；新 reader 同时读取两版，并校验 system 的 durable tag 及来源区间。旧 reader 拒绝 v2，避免忽略新来源；v1 的 system 空来源规则保持不变。扩展回归首次发现旧分支 reader 拒绝非空 system 来源，已据此补齐版本化协议并复跑。

本批最终 9 文件 252 项：250 通过、2 项既有 Windows 目录 fsync 条件跳过、0 失败。覆盖两种摘要后的原行身份与旧游标、连续摘要、system 来源移动/交叉/缺失、压缩前后摘要、分支幂等与父会话删除后读取、完整复制 fork、v1/v2 来源规则、非法证书/输出、映射超量及旧记录快照边界；同时回归 canonical store、checkpoint 权威路径、v1/v2 分页与输入回执。CLI 旅程在 Vitest 中直接执行实际 Commander 预览/确认实现，未启动已安装 CLI 子进程。修改源文件 ESLint 0 errors/warnings（只有根 package.json 既有 ESM 提示）；Prettier 与 diff 检查通过。本批未修改 IDE 实现、重建或发布插件；真实双 IDE GUI、durable/live 增量合并、精确提交跨平台 Actions、生产观察和发布验收仍未完成。

### IDE-REPLAY 持久历史增量读取

最新 v2 history 页增加 `syncCursor`，绑定 session/generation、实际 head/eventCount 和下一条显示 ordinal；旧页导航返回 null，不推进最新视图的同步基线。新增 `session show --json --history --after <cursor> --page-size 50 -- <id>`，返回 `chainlesschain.session-transcript-changes/v1`，包括 `from`、连续显示行、`nextCursor` 与 `hasMore`。每次返回游标之后的首个有界批次；达到条数或字节限制时将下一行留给续页，不能跳过大消息后返回更晚的小消息。

消费者需按 session/event/item 身份去重重试；批次之间继续追加不会遗漏。只有元数据变化时可返回空行并推进 verified revision。规范压缩和已验证 timeline summary 保持游标；回退、快照替换、跨 session/fork 或错误版本明确失败，不能把新路径追加到旧 durable 视图。增量命令的 JSON 错误对象与非零退出码保留 stale/不可读/存储错误的区分，完整性错误不能伪装成普通游标过期。即使当前批次已满，仍验证完整尾链及 anchor；既有历史回退需要的同锁重扫不变。单批至多 100 行 / 1 MiB 行 JSON，单行至多 200K 字符，复杂度仍是 O(N) 验证，不声称索引或延迟改善。

协议与消费规则见 [CLI transcript changes](../../packages/cli/docs/SESSION_TRANSCRIPT_CHANGES.md)。本批是后续 durable/live 合并所需的持久读取合同；双 IDE 仍使用快照页，尚未接入现场流输出与 canonical 行的稳定对应及增量合并，不将新增 API 计为 IDE-REPLAY 全部完成。

相关 7 文件 89 项通过；补充 JSON 错误路径后，相关 2 文件 34 项再次通过，结果有重叠不相加。新增 9 项场景包括真实磁盘、Kernel 压缩、timeline 摘要/回退、批次间追加、重试、同正文身份、metadata-only 空页、快照覆盖、字节上限、跨 fork/错误游标及满页之后的坏尾链。独立 Node 进程实际运行仓库 CLI 入口，验证只读增量、参数互斥、stale JSON 与完整性错误区别；不是已安装发布包或真实 IDE 宿主。修改源文件 ESLint 0 errors/warnings（只有根 package.json 既有 ESM 提示）；Prettier、diff 与四项命令生成 drift check 通过。生成器记录顶层命令信息，本次子命令选项没有产生生成文件变更。真实宿主、当前跨平台、发布与完整增量合并仍待验收。

### IDE-REPLAY 最终回复与持久事件引用

stream-json 每轮最终 `result` 可带 `transcript_refs` v1：绑定 session 与本轮已提交的 assistant event hash，已知时附带 user event hash 和 client message ID。普通消息写入函数实际返回同步提交回执；仅 `commitState:committed` 与合法字符串 hash 可生成引用，不将回执误当完整消息事件。用户 ID 来自本轮普通 append 或已验证输入接受回执；无持久化、重复输入 ACK、未确认/失败的 assistant append 和未落盘的提前结束均不产生最终回复引用。预算/错误结果若保存了最终文字仍可携带引用，引用不修改执行结果或接受状态。

共享 schema 增加可选字段及正反 fixture，并生成 TypeScript/Python/Kotlin/Swift/CLI 产物；SDK 公共 ResultEvent 提供类型。消费者仍须核对原 child/session/view、外层 session ID 及经完整历史验证的行和角色，再按完整 row ID 合并；不能按正文相等去重，不能把最终回复 ID 套到所有流片段/工具卡，也不能从引用恢复执行权。双 IDE 本批仍未接入引用和增量合并，IDE-REPLAY / SESSION-01 保持局部验收。

本批 CLI headless 71 项、SDK 3 文件 44 项、共享协议 19 项、Python 3.12 协议 17 项与 JetBrains ProtocolFixturesTest 9 项通过，共 160 项，无跳过或失败。真实临时 canonical 存储测试连续运行三轮相同输入/回复，核对六条历史行与各自事件身份，覆盖带/不带 client ID；模型循环为注入夹具，未调用真实模型。另覆盖未确认/缺失/非法/异步/失败 append、重复接受 ACK、SDK 原样传递及共享 schema 正反样例。首次 Python 命令选到本机 3.8，低于项目 >=3.10 要求；改用已安装 3.12 后通过，不计旧解释器运行作通过。SDK build、schema 与 VS Code/Desktop vendor drift check、Prettier 和 diff check 通过；修改源文件 ESLint 0 errors、3 项既有 unused-variable warnings。Kotlin 编译通过并保留既有冗余 `?` 提示；未编译 Swift，也未进行真实双 IDE GUI、最终提交 Actions 或发布。

### IDE-REPLAY VS Code 增量合并与原位显示

VS Code 已接入 latest `syncCursor` / `--history --after`，校验连续 ordinal、完整 row ID、session/generation、revision/eventCount 与下一游标；每次至多读取 8 个 50 行批次，应用后才推进游标，余量通过 Latest 继续读取。Older 独立浏览，不推进增量基线，也不被后台流输出替换。后台标签继续更新自身缓存；活动 turn 延后读取，异步结果核对 conversation、child、session、request、异步代次与 transcript revision，重置/替换/关闭后的迟到结果不落入新视图。

输入接受回执和最终回复引用只建立候选关联：原 child 的 client ID 对应用户行，最终 assistant segment 对应已提交 event hash；核对已验证历史的 session/event/role/item 后才变成 saved row。重复回执和重试批次可复用此前验证行；同正文的不同事件保留为独立消息。未关联的过程文字、工具活动和诊断保留为 live-only；旧 CLI 无引用时不能按文字猜测对应，可能同时显示无法关联的 live 与 saved 行。只有明确 stale 错误触发新基线；完整性/解析/进程错误保留缓存和游标并显式提示。

Webview 通过稳定显示 ID 原位更新，保持未变化节点、工具控件与滚动位置。选区内的冲突修改/删除/重排延后到取消选择；新的 live 事件使旧延后投影失效。显式切换 Older/Latest 可重建当前页，UI 协议升级为 v6 以替换保留的旧脚本。合并缓存仍限制 100 行 / 500K 字符，DOM 仍限制 800 节点，早期持久行通过分页查看。本批未给所有工具/过程片段补持久化，也未完成 JetBrains 增量合并或真实双宿主验收。

本批相关 25 个 Vitest 文件 312 项通过，扩展原生 `test:unit` 最终 215 项通过；覆盖真实 canonical 临时磁盘、生产 ChatViewProvider（VS Code API stub）、共享输入引用、生成 Webview 的 DOM/选区、停止后 partial 与诊断分离、八批次上限与继续读取。新增测试统一使用扩展实际 CommonJS 加载路径，避免测试转译与原生 require 产生两份进程归属记录；旧断言补充新增显示 ID。首次原生全量出现 1 项失败且输出截断，未定位失败项；随后两次原生全量均 215 项通过，保留该未复现记录，不声称已查明并修复其原因。修改源文件 ESLint 0 errors/warnings；本地 VSIX 打包成功（保留既有未 bundle 提示）。这些是本地实现与回归证据，未运行真实 VS Code GUI、跨平台或精确提交 Actions。

最后补充“从 Older 返回时只重建一次，迟到读取不再次清空选区”的防护后，相关 2 文件 14 项通过（与前述结果重叠）；Prettier / diff check 通过。最终本地 VSIX 中 5 个修改/新增聊天模块的 SHA-256 与当前源码一致；未安装或发布该包。

### IDE-REPLAY JetBrains 历史恢复与只读分页

JetBrains 重建/选择已有会话读取 v2 page；Older 使用独立历史面板，Live 回到保留的现场正文，Latest 显式读取最新页。发送输入回到现场，不将新回复拼接到旧页。后台完成仍保留各自正文，迟到读取按 session/view epoch/request/live revision 隔离；活动 turn 推迟替换，重置/切换 session/关闭取消旧请求。自动更新保留选中文字及向上阅读位置；失败、interrupt 和退出提示不被自动快照清掉。历史替换不执行工具、不重发审批、不重复播报结束事件。

使用独立读取通道，2 个后台 worker、32 项队列；stdout 最多 2 MiB，stderr 最多保留 16 KiB 并继续排空，非零退出、错误 UTF-8、非法页、超时/超量均显示失败。解析核对 session/event/item ID、重复项、连续序号、revision 与游标范围；页中至多 100 条/1 MiB 文本/每条 200K 字符完整显示，避免旧 live document 的 200K cap 把同页前半部分静默丢掉。下一次现场输出恢复 live cap；显示为可选择的纯文本。CLI 二进制解析仍复用原机制，35 秒 timeout 从 query capture 开始；退出证明沿用已观测子孙机制，不宣称隔离容器或捕获已脱离子孙。

实现与剩余边界见 [JetBrains saved conversation history](../../packages/jetbrains-plugin/docs/CHAT_TRANSCRIPT_HISTORY.md)。新增同一份真实 CLI 输出 fixture 供 Java 与 VS Code 消费，另有真实 Java 子进程输出/取消/超时及 Swing 双会话、迟到结果、选择/滚动保留、分页、错误与大页测试。全量 JDK 21 test/smokeTest/buildPlugin：103 个 suite、889 项 JUnit，886 通过、3 项既有平台跳过，0 failures/errors；1,436 项 smoke 断言通过，并生成本地 ZIP。首次 UTF-8 子进程夹具沿用 Windows stdout 默认编码，严格解码正确拒绝；夹具改为显式 UTF-8 字节后全量通过。CLI/VS Code 历史回归 2 文件 16 项通过。最后补充滚动/紧凑导航、停止提示在切 tab 后仍保留的行为后，相关 4 个 JUnit 文件 25 项及打包再次通过；ZIP 内 8 个相关 class 与当前编译产物 SHA-256 一致。滚动夹具在初始 caret 布局完成后模拟读者上滚，避免把初始布局误作刷新行为。真实 IntelliJ GUI、可访问性听测和最终提交 Actions 均未执行。

### IDE-REPLAY JetBrains 增量合并与现场身份

JetBrains 现接入 latest sync cursor 与 `--history --after`，核对 session/generation/head/count、连续 ordinal 和续页边界，应用成功才推进游标。每轮最多八批，剩余通过 Latest 继续。Older 保持独立面板/游标；metadata-only 更新推进 revision 而保留可见消息范围。只在非零退出的合法 changes-error 对象明确声明原 session 游标 stale 时读取新基线；完整性、无效 UTF-8、跨 session、解析和其他进程失败均保留原正文与游标。

发送 worker 在写 stdin 前通过 EDT 固定用户行的 client ID / child / session 身份；快速接受回执可找到已显示的输入。终态引用仅绑定同 child 的用户候选和最终 assistant 段，经已验证 row/event/role/item 核对后合并；过程文字、工具和停止诊断保持独立。相同正文的不同事件不去重，重复回执/重复批次不复制已识别行；旧 CLI 没有引用时不猜测匹配，可能同时保留现场与保存行。

Swing document 按范围修改，保留未变化文字、选区及上滚阅读位置。冲突删除/替换/重排或受选区阻止的淘汰延后至选择结束；child/session/epoch/request/live revision 变化后旧结果不再应用。历史缓存最多 100 条 saved 行 / 1 MiB 加 16,384 标题字符，metadata 最多 4,096 项；saved 行淘汰同时移除正文，不能丢身份后伪装成 live-only。live append 沿用 200K cap，早期 saved 内容通过分页查看。选中的最终 assistant Markdown 保留纯文本，本批没有实现取消选择后的延迟 Markdown 格式化。

本地 JDK 21 全量 `test smokeTest buildPlugin`：107 suite、907 项 JUnit，其中 904 通过、3 项既有平台跳过，0 failures/errors；1,436 smoke 断言通过。随后补充 100 行缓存淘汰、metadata-only 可见范围与 4,096 项范围上限期间的候选身份保护后，最终相关 8 suite、44 项全部通过，并再次生成本地插件 ZIP。测试使用真实 CLI 子进程输出的共享 baseline/changes/metadata/rewind/九批续页 fixture，及真实 Java 错误/UTF-8 子进程、Swing selection/document/viewport。首次发现历史插入触发 DefaultCaret 延迟滚动，已通过更新策略和可见性保护修复；新增选区夹具最初混用 Windows 序列化 CRLF 偏移，改为真实 Document 偏移并断言所选文本后通过。

CLI / VS Code 共享历史回归 2 文件、49 项通过；新 fixture 由隔离临时 home/security 下的实际 CLI stdout 生成，生成脚本可重跑。最终插件 ZIP 内 28 个相关 class（含内部类）与当前编译产物 SHA-256 一致。新增生成脚本 ESLint 0 errors/warnings，保留根 package.json 既有 ESM 提示；Prettier / diff check 通过。以上运行有重叠，不累加成独立覆盖率。

这些是本地组件/协议/打包证据，未执行真实 IntelliJ GUI、双 IDE 安装旅程、真人读屏或最终 SHA Actions。本批没有将 IDE-REPLAY / SESSION-01 标记为全部完成。

### IDE-DRAFT 输入回执边界

新增可选 `client_message_id`，CLI 仅在 canonical 持久化可用时声明 `input_receipts.version=1`。原始输入摘要与 user event 一同写入已有 writer authority，完整验证 chain/anchor 后才返回接受回执；重复 ID 不再调用模型，冲突/校验异常/存储失败不能降级为普通发送。`session show --json --input-receipt <id>` 只读查询，压缩后仍可查询原回执。SDK 已提供可选传参，并同步 VS Code / Desktop vendor。

接受不等于执行完成；落盘后、执行前崩溃可能仅留下已接受输入。丢失 ACK 时应先只读核对，不自动重放。当前查询与去重仍为 O(N) 全历史验证，未宣称索引性能或跨进程外部副作用 exactly-once。双 IDE composer 与问题表单草稿已接入；不能将后端合同或局部宿主实现计为 IDE-DRAFT 全部验收。

本批 CLI 回执/stream/session page/lazy dispatch：4 文件 93 项通过；SDK 发送与共享协议映射：2 文件 33 项通过；SDK 构建及 schema drift check 通过；修改的 CLI 源文件 ESLint 0 errors、3 项既有 unused-variable warnings。

JetBrains `ProtocolFixturesTest` 也已通过，包含同一份新增回执 fixture；这验证旧宿主可忽略新 ACK 并处理重复输入的终止事件，不代表 UI 已实现持久接受状态。

### IDE-DRAFT VS Code composer 与发送状态

工作区专属存储使用稳定 draft key，正文与校验过的附件快照分开保存，Memento 只保留 tab/key。生成的 Webview 使用有界文字备份保留等待 host 保存的输入；发送先保存待确认记录，再写入 UNKNOWN，最后写 stdin。init 的可用性确认、会话 ID、child token 与 generation 都参与发送检查；只有匹配的 CLI 回执或只读查询可标记 accepted。旧 CLI 和 EPIPE 不伪装成持久接受；恢复不自动发送。图片尚未加载、缺失或被改写时阻止发送，延迟恢复不覆盖新的文字。关闭/重置后的草稿可通过恢复入口打开，reopen shortcut 保持原 draft key。

限制为单条文本 100K 字符、4 张/20 MiB/40MP 图片、每草稿 8 条未解决输入、128 个存储目录与 100 MiB；保存队列限制 64 项及 40 MiB 图片载荷。元数据临时文件 flush 后 rename，失败保留旧记录并清理新快照。未宣称断电耐久、多 Extension Host 并发写同一存储的协调，或完成真实宿主验收。实现说明见 [Chat draft recovery](../../packages/vscode-extension/docs/CHAT_DRAFT_RECOVERY.md)。

本批最终聊天回归：23 文件、281 项通过，其中新增草稿/host/生成 Webview 场景 15 项。覆盖真实临时目录、rename 失败注入、快速连续编辑、缺失/改写附件、旧 CLI、延迟 ACK、写入失败、重建 host、reset/close、异步查询期间先恢复 composer。修改的 VS Code 源文件 ESLint 0 errors / 0 warnings；`git diff --check` 通过。未将此结果视为真实 GUI 或发布产物验收。

### IDE-DRAFT VS Code 问题表单与原生 review

问题草稿绑定 session/request/完整 interaction binding 与 schema/问题摘要；host 为每个 live request 生成独立实例，Webview 重建恢复同实例，Extension Host 重建仅对后端重新发出的精确绑定请求恢复字段。旧式无 binding 请求只允许原 host 实例恢复。表单文本、checkbox、select 保持 DOM 顺序；密码、writeOnly 及无法判断敏感性的 JSON fallback 不落盘、不进入 Webview 备份。普通自由文本仍为本地明文草稿，不宣称能够自动识别所有秘密。

发送回答先预约再保存，重复点击不会重复写管道；仅 `question_resolved` 将请求标为结束，pipe 失败或明确 reject 留在未知/未完成状态，不自动重试。URL elicitation 使用 host 保存的原 URL 和原 session，并在 await 后重验，已覆盖切 tab / stop / 替换 session 的回调隔离。取消、schema 变化、blocking turn 结束及 child 退出均归档；迟到字段只能更新归档文本，不能恢复旧执行权；deferred 请求可跨 turn 保留。归档内容可从现有草稿入口复制到空 composer 继续编辑，不自动回答旧问题。

App Server 原生 InputBox/QuickPick 初始增量捕获半输入文字、筛选词和选择值，与 Chat 共用串行 store。崩溃后精确重发才能恢复 live 字段，cancel/accept 后只保留归档文字；保存失败阻止提交。后续结构化 schema review 与原连接生命周期实现见下节；未将原生 callback 返回值当成服务端接受确认。

每草稿最多 16 条问题记录、128 字段、单字段 32K 字符、字段总载荷 64 KiB；record 上限 128 KiB、host request map 上限 256。Webview 文字备份最多 16 表单/64K JSON 字符；schema 身份计算有深度、节点数与字符预算。限制达到时显式显示保存失败，不声称 forced exit 无损恢复。

本批最终聊天回归为 24 文件、295 项通过（含新增问题草稿场景 14 项）；原生对话框 / App Server pilot / Host DOM relay 的 Node 回归 3 文件、25 项通过。新增场景覆盖真实临时文件存储、生成 HTML、原生 API stub、匹配重发、schema 变化、tab 切换、迟到恢复/编辑、密码排除、重复点击、失败保存与 URL 回调隔离。修改的 VS Code 源文件 ESLint 0 errors / 0 warnings，Prettier 与 `git diff --check` 通过。仍未执行真实 VS Code/JetBrains GUI 或精确提交 Actions。

### IDE-DRAFT VS Code 原生结构化表单与确认状态

补齐 App Server `_questionRequest` 丢失 MCP metadata 的调用链：通知与 question/answer RPC 均保留 form/URL、server、schema 与 elicitation ID，普通问题保持既有形态。原生界面使用字段列表、InputBox/QuickPick 编辑与显式 Submit；复用共享 schema core 的文本、数值、布尔和单/多选校验及类型转换，支持 Back 和 250 ms 编辑合并保存。password/writeOnly 不进入保存投影或列表值预览；未知 schema 仅明确的 JSON object fallback，不落盘。

新增 native request lifecycle，按原 client connection generation、thread、turn、question ID/digest 保留至多 256 个身份。相同 live request 共用一次 review，已结束请求不复活；退出、连接替换、interrupt、到期与 blocking turn 结束使旧 UI 失效，deferred 可跨 turn。SDK 仍向原 child 回复，host 另检查原 client/generation，迟到字段或原生回调不能给新进程回答。URL 使用不可变目标及 HTTPS 显式确认，await 前后检查撤销。没有 workspace store 时也能立即关闭失效原生输入。完整原生 review 串行占用 QuickInput，最多 128 个等待项；并发问题不互相隐藏当前字段，排队期间也可撤销。

原生 callback 返回仅进入 awaiting；匹配服务端 question/resolved 后才显示 resolved，状态栏显示变化，原有 App Server status 命令展示 review/awaiting/unknown 数量。复用 ID 改内容的回执不伪造确定结束；连接故障/超时保留 unknown，不重试。状态为 host 内存观察，不是 durable 接受回执，也不证明外部副作用 exactly-once。最终保存期间撤销会等待同一次写入；旧 MCP digest 未区分 form/URL 时仅保留文字恢复，不自动套入新身份。

扩展 `npm run test:unit` 213 项通过，新增原生测试已纳入此命令。最后补充无 workspace 撤销及原生 review 队列后，原生/生命周期/pilot 4 文件 25 项再次通过。CLI App Server 16 项、共享 schema 与 Chat 问题草稿 2 文件 17 项通过；覆盖真实临时磁盘、崩溃前文件恢复、半输入、数值校验、敏感值排除、保存失败、重复提交、读/写期间撤销、URL 等待期间替换与元数据协议往返。修改源文件 ESLint 0 errors/warnings；已构建本地 VSIX。这些仍是本地 API stub / 协议与打包验证，未执行真实 VS Code GUI、最新双宿主旅程或精确提交 Actions。App Server 继续 opt-in pilot。

### IDE-DRAFT JetBrains composer、附件与接受回执

在 IDE config 目录按 workspace hash / 稳定 draft key 保存本地文本和图片快照，项目属性只保存本功能的 tab 元数据。编辑合并后保存；发送先排队保存当前 composer，再做 CLI 探测和启动，随后保存独立 submission 并在写 stdin 前记为 unknown。缺失/旧 CLI capability 不伪造接受；只有原 child/session 的匹配 ID 与合法 hash 回执可标 accepted。CLI 解析可能从正文发现图片路径，host 不把未解析的本地 wire digest 强充 CLI inputDigest。

Saved inputs 提供只读核对与恢复到空 composer；Recover drafts 可找回关闭 tab，恢复不启动 Agent。稳定 key 贯穿重启、关闭重开与手动恢复。迟到恢复不覆盖新输入，关闭冲突 tab 时新输入另存；缺失/篡改图片阻止发送，但文字修改仍可保存，显式 Clear attachments 后才放弃原附件。接受回执早于执行完成，图片保留到无待处理 turn 的后续发送或用户安全丢弃记录。

上限为每条 100K 字符、4 张/20 MiB/40MP、每草稿 8 条 submission、128 个草稿目录、100 MiB 存储、2 MiB 元数据；独立 I/O 队列最多 64 个操作。同 IDE 进程内串行，原子临时文件 flush + rename；失败保留旧记录并清理未引用图片。普通文本为本地明文；未证明断电持久性、强制退出最后一次编辑无损或多个独立 IDE 并发写同一 config 目录的协调。问题/elicitation 表单草稿后续增量见下文；不保存或重放审批。实现说明见 [JetBrains Chat draft recovery](../../packages/jetbrains-plugin/docs/CHAT_DRAFT_RECOVERY.md)。

本批全量 `test smokeTest`：96 个 suite、846 项，843 通过、3 项既有平台跳过、0 failures/errors，另 1,436 项 smoke 断言通过。补充“附件缺失时保存文字”和“恢复冲突关闭时另存新输入”后，新增 2 文件 9 项再次通过。覆盖真实临时磁盘、原子替换失败、快照/校验/预算与 Swing 组件恢复竞态；不是实际 IntelliJ GUI 旅程。`buildPlugin` 已成功生成本地 ZIP，搜索选项构建为 headless；未进行 Marketplace 发布、真实 IDE 手工交互或最终提交 Actions。

### IDE-DRAFT JetBrains 问题表单与请求归属

普通问题与受支持 MCP schema 现为聊天面板内的原生表单；保留声明顺序、文本/checkbox/select、数值校验和 coerced answer。多个 deferred 问题使用有界滚动区域，composer 保持可达。字段草稿绑定 session/request/完整 interaction binding 及问题/schema 摘要；跨 host 恢复仅对 CLI 重新发出的相同完整绑定请求恢复字段，无 binding 仅原 live 实例保留；迟到加载不覆盖新输入。密码/writeOnly 不读入持久化投影或恢复文字，未知 schema JSON fallback 不保存。

回答/取消先预约并保存归档字段，I/O 成功后才允许 send worker 向原 child/generation 写一次；普通表单不再通过模态弹窗结束时重新选择当前 child。仅原 child/session 的 question_resolved 确认结束；管道失败/reject 保留 unknown，不自动重试。持久化失败且未发送可显式重试；复用 ID 改 schema 的回执不能伪造确定结束。URL 显式 HTTPS 确认后再次检查原请求归属。blocking turn 结束、Stop、替换、退出/关闭归档，deferred 可跨 turn。归档不恢复执行权，Saved inputs 可复制到空 composer 或显式丢弃；归档保存失败时表单保持可读和可复制，保存成功后才自动移除。关闭仍未保存的 tab/强制退出不保证数据无损。

每草稿最多 16 条问题记录、128 字段、单字段 32K 字符、字段 64 KiB、记录 128 KiB；每个 child 保留至多 256 个请求身份，已结束请求重发不能复活。schema snapshot/hash 限深度、节点与字节；沿用独立 I/O 队列及原子替换。元数据写 v2、读 v1/v2，旧宿主拒绝 v2，避免丢失新字段。常规自由文本仍为本地明文，不宣称自动识别所有秘密、跨进程写协调或断电无损。

本批全量 JDK 21 test/smokeTest/buildPlugin：100 个 suite、872 项，869 通过、3 项既有平台跳过，0 failures/errors；1,436 项 smoke 断言通过，并生成本地插件 ZIP。最后补充请求 session 隔离后，4 个新增文件 27 项回归和打包再次验证。覆盖真实临时文件、v1 迁移、保存失败/重试、迟到恢复、重复点击、跨 child 拒绝、secret 排除、原生 Swing 字段校验及归档保存失败。没有运行真实 IntelliJ GUI、跨平台宿主旅程、Marketplace 发布或最终提交 Actions；IDE-DRAFT 仍为局部验收。

### IDE-MODE JetBrains 状态与进程替换

新增纯 Java `PermissionModeState`，按 child generation、session、request correlation、requested mode 与 policy digest 接受 CLI ACK；旧 CLI、缺失/无效 ACK 和 15 秒超时显示 unconfirmed。切换立即使旧 ACK 与排队的旧模式输入失效，停止失败保留 last confirmed 模式与原进程句柄；状态栏与聊天面板不将请求值显示成已生效值。组织策略覆盖的有效模式可以不同于请求值。

`AgentChatSession.stopAndWait()` 使用独立线程，TERM 后升级 FORCE，等待根进程与已观测子孙退出；不等待 stdin 写锁，因此管道阻塞不再挡住停止。并发停止共用 future，失败保留句柄供重试，超过 1,024 观测句柄或进程枚举失败不能报告成功。ConversationView 在后台等待确认，再处理替换、配置重载、时间线恢复和会话交接；回答/审批绑定原 session/generation。启动前后检查取消，二进制解析或环境准备期间的停止不会在返回后重新启动 Agent。

这里确认的是**已观测句柄**退出：在首次观测之前已脱离/被重挂的子孙仍可能遗漏，未实现 Windows Job Object / Linux cgroup 隔离，不将自然根进程退出等同于完整树退出。真实组织策略、真实 JetBrains GUI、Linux/macOS 探针及最终提交 Actions 均未验收。输入在切换期间写出时通过 composer 或 Saved inputs 保留并提示交付未知；JetBrains 的 composer 与输入回执增量见上文。

共享协议补充可选 `permission_mode_state` schema/类型与正反 fixture，已重新生成 TypeScript/Python/Kotlin/Swift/CLI 产物并同步 VS Code/Desktop SDK vendor。CLI headless/mode/stop 回归 3 文件 85 项、SDK 协议回归 2 文件 24 项、协议 Node 回归 3 项通过；SDK build、schema/vendor drift check 通过。未执行 Swift 编译。详细设计与限制见 [JetBrains approval mode lifecycle](../../packages/jetbrains-plugin/docs/APPROVAL_MODE_LIFECYCLE.md)。

最终 JetBrains JDK 21 `test smokeTest`：94 个 JUnit suite、837 项，834 通过、3 跳过、0 失败/错误；PureLogicSmokeMain 1,436 项断言通过。新增模式/终止测试 11 项全部通过，包括真实 Java 根进程/子孙、8 MiB 阻塞写入、环境准备期间取消与模式切换。跳过项为 Windows 无可用符号链接时的路径用例及 2 项仅限 POSIX 的 lockfile ACL 用例；不将跳过计入通过。生成 Kotlin 的既有冗余 `?` 警告不影响编译。

### IDE-IMAGE CLI 最终读取边界

普通 `--image`、REPL 自动识别与 stream-json 共用最终文件读取限制：单条消息合计最多 20 MiB，文件必须为 regular file，扩展名匹配 PNG/JPEG/GIF/WebP header，单图尺寸最多 40MP。先检查句柄上的文件大小，再在最多 1 MiB 内读取尺寸；后续完整读取最多分配原始大小加 1 字节，读取期间文件增长、截短或观察到修改会拒绝。错误指出附件序号；超过 8 张明确报错，不再静默截断。真实临时文件及模拟短读/增长测试覆盖这些条件，另验证无效图片不会进入模型循环且后续文本仍可处理。

图片边界连同 stream 输入回执的扩展回归：5 文件 123 项通过；CLI 修改源文件 ESLint 0 errors、3 项既有 warnings；SDK 构建与 protocol schema drift check 通过。

### PERF-01 后台列表真实分页对照

容量 harness 保留原全扫基线，新增固定 50 条页大小的实际分页对照。首次建索引与已有索引分别运行新 Node 进程；热首页/下一页/权威记录原子替换后的重建分别计时。每阶段比较完整投影摘要，计时外遍历所有页防止遗漏/重复/乱序，失效测试同时改变排序与正文并最终恢复夹具。`indexObserver` 只提供读取路径与数量，回调抛错不改变结果；新进程失败或回退全扫不能标记 pathsVerified。

保留 O(N) inventory/stat/sort 边界，RSS 新增进程高水位且明确包含此前分配，分页锁等待标为不适用而非 0。smoke / formal 仍为测量，不宣称 SLO 或生产 PASS。说明见 [容量对照记录](./cli/cli-persistent-capacity-comparison-2026-09-27.md)。

相关回归 3 文件：130 通过、22 项既有平台条件跳过；最后的测量计时与夹具目录校验修改后，容量/index 2 文件 8 项再次通过。包含真实磁盘/Node 子进程、105 条三页遍历、失效重建/恢复、冷进程失败和观测回调异常。修改源文件 ESLint 0 errors / 0 warnings（Node 提示现有根 package.json 未声明 ESM），`git diff --check` 通过。

干净 SHA `6c47788623d6bc4ab64afa096d8ce739ebbacf0a` 默认 smoke 23.279 秒完成；Windows 10.0.19045 / x64 / Node 22.22.2。后台 100/1k 均 pathsVerified，1k 全扫/热首页/失效重建 p95 分别 336.129 / 164.045 / 694.739 ms（3 样本）。Memory 两档可读，并发读/更新/删除全部成功；[原始 receipt](./cli/evidence/persistent-capacity-smoke-windows-6c47788623.json) 的 canonical digest 已核对。保留单机少样本与重建成本边界，未设定性能 PASS。

### PERF-02：真实 usage 对照工具（2026-09-28）

`c1f761dc32` 的本地安全诊断补充固定白名单 `compactionCode` 和 `compactionUsageStatus`，将 usage 未知、已报告、等待结果与尚未开始分开；“已报告”不代表持久账本已结算。stale CAS、provider transport outcome unknown 和敏感字段拒绝的定向测试连同自动压缩测试 28/28 通过。该改动没有新增真实 provider 成功样本，也不改变未知传输结果不得自动重试的结论。

新增 `packages/cli/scripts/context-token-calibration.mjs`，从按行 JSON 请求记录读取 provider 返回的输入 token 数，并调用生产用的 `messagesToContextItems()` 与 `toolDefinitionsToContextItems()` 计算同一估算口径。每行必须包含 `category`（`chinese` / `code` / `emoji` / `tool-schema`）、`provider`、`model`、实际发送的 `messages`、`toolDefinitions` 和原始响应 `usage`。`usage` 接受 OpenAI `prompt_tokens` 或 `input_tokens`；Anthropic 的 `input_tokens` 加上独立报告的 cache creation/read token。两种输入字段同时出现或缺失、非整数及不明类别均拒绝。

从 `packages/cli` 运行 `node scripts/context-token-calibration.mjs --input requests.jsonl`。输出按 provider/model/category 汇总实际与估算 token、p95 相对绝对误差及低估量，仅保存请求 SHA-256，不输出提示词或工具 schema。输入文件可能包含敏感正文，应留在本地受控目录；脚本不联网、不写回输入文件。输入必须是最终送给 provider 的请求及**同一次响应**的 usage，不能把预压缩消息与压缩后 usage 混用。provider 的隐含开销和格式框架也计入 usage，因此对照值用于测量端到端预算偏差，不声称是 tokenizer 的逐字节真值。

新增五个本地 Node 合同测试，覆盖缓存 usage、分组且不泄露正文、无效输入拒绝、坏 JSON 的命令行诊断不泄露正文，以及付费探针缺确认旗标时拒绝。测试使用合成 usage，仅证明工具行为。另用 `packages/cli/scripts/context-token-volcengine-live-probe.mjs --confirm-live` 在 Windows / Node 22.22.2 对配置的内建 Volcengine 端点发出四个固定、低输出上限、20 秒超时请求；按 `2a976216f8` 源码得到[原始回执](./cli/evidence/context-token-calibration-volcengine-windows-2a976216f8.json)，独立重读 JSON，确认四类及四个响应 ID 哈希、请求哈希、无提示词正文，格式化后文件 SHA-256 为 `3b8bc1814112f0797cb97bcb594d5c81f2ccb11d65472529d52f7c7e92dc11ca`。

同一模型 `deepseek-v4-flash-ga-260731` 的估算/实际 input tokens：中文 987/751，代码 792/895，emoji 592/1090，大工具 schema 1709/2134；合计估算 4080、实际 4870，四类中三类低估。四次请求输出共 246 tokens，按配置价估算成本 `$0.000492632`，不是账单回读。每类只有一个样本，报告里的 p95 只等于该样本，不能设通用阈值；也没有模拟压缩后的事实保真或任务成功率。当前生产 bytes/4 估算及留白未更改。

`a74b03cdd6` 将付费探针扩为每类最多五个固定输入长度，显式 `--confirm-live --repeats 5` 才运行 20 次，其他参数或超过五次均拒绝。Windows / Node 22.22.2 的[20 请求回执](./cli/evidence/context-token-calibration-volcengine-windows-a74b03cdd6.json)在同一 Volcengine 型号上独立记录 20 个请求与响应哈希；只含 token、成本估算和统计，不含提示词或响应正文。输入估算/实际合计分别为中文 3045/2435、代码 2456/2865、emoji 1860/3450、工具 schema 5485/7310。20 次中 15 次低估；每类五条的 p95 相对绝对误差依次约为 31.4%、24.3%、47.6%、38.6%，低估量 p95 依次为 0、103、498、425 token。总估算 12846、实际 16060；输出共 672 token，按配置价估算费用 `$0.002178512`，未核对官方账单。五种输入长度仍是同一固定模板及单一型号，不能据此外推多轮工具旅程、其他 provider、压缩事实保真或任务成功率；生产预算参数继续保持原值。

`fd9cd4ca69` 在非流式 OpenAI 兼容响应入口把 assistant 消息限定为可续接的 `role`、`content`、`tool_calls`，丢弃 Volcengine 返回的 `reasoning_content`；不放宽治理投影的字段白名单。含真实响应字段形状、第二轮工具结果续接及异常角色拒绝的定向回归连同既有旅程测试共 145 项通过；Prettier 和 diff 检查通过，ESLint 0 errors（既有 warnings）。在该精确提交上运行一次 Windows/Volcengine 真实压缩旅程，先前的治理协议形状错误不再出现，但运行最终返回 `trajectory_invariant_failed`。[脱敏失败回执](./cli/evidence/ide-roadmap-live-provider-trajectory-volcengine-windows-fd9cd4ca69-failure.json)仅含提交、失败码和摘要；本次执行未取得可验证的冻结事实保留率、工具顺序或完整 usage，不能计作成功样本。下一步须在不保存提示词或响应正文的前提下细化固定约束失败分类，再判定是模型未遵守严格夹具还是实现错误；Linux 100 次真实 provider 门仍未运行。

后续安全诊断在 `4569b3de77` 复现 `trajectory_invariant_failed`，固定约束类别为事件顺序；在 `2b5ba8c208` 定位到首个偏离位于索引 2，观测标签不在当时的允许列表，事件总数 4。`cf69ba0efb` 扩展固定诊断标签后，单次真实调用以 `trajectory_timeout` 结束，未取得更细类别；[该次脱敏失败回执](./cli/evidence/ide-roadmap-live-provider-trajectory-volcengine-windows-cf69ba0efb-failure.json)不含提示词、响应正文或密钥。诊断函数对未知事件名只输出 `other`，避免模型生成的工具名进入日志；对应本地旅程测试 10/10、增量安全测试 1/1 通过，格式和 diff 检查通过。以上三次后续调用均非成功样本，仍不能确认冻结事实保真或任务成功率。后续应先在单次有界运行中记录固定的压缩失败类型和 usage 结算状态，再决定是否调整夹具或实现；跨平台与 Linux 100 次发布门仍未完成。

`27fa60cdde` 修正本地旅程校验的遮蔽顺序：压缩降级、usage 未知或预算耗尽先按固定事件类别报告，再比较严格事件顺序。失败回执可选保存最多 32 个白名单事件标签、事件总数、固定压缩原因与 usage 未知原因；模型生成的工具名、自由文本失败原因和响应正文均不进入这些字段。provider 异常与超时也附同样的有界诊断；不改变生产压缩或实际模型请求。既有真实失败回执没有这些新字段，不能事后推导其根因。本地旅程及自动压缩 2 文件 25 项通过；ESLint 0 errors、Prettier 和 diff 检查通过。真实 Volcengine 旅程与最终提交的跨平台 CI 仍待复核。

在 `e3591426b9` 上的一次独立真实旅程留下[固定类别失败回执](./cli/evidence/ide-roadmap-live-provider-trajectory-volcengine-windows-e3591426b9.json)：第二轮开始后只记录 `run-started`、摘要 usage 边界、`compaction-degraded`、`compaction-usage-unknown`，原因为 `semantic-summary-provider-outcome-unknown` / `provider_transport_outcome_unknown`。随后同一提交的一次仅观测 HTTP 状态的[脱敏传输回执](./cli/evidence/perf02-volcengine-transport-windows-e3591426b9.json)记录连续三次 HTTP 200，第四次约 95 秒后抛出 `Error`，未取得 HTTP 状态；独立重算其摘要并核对四次结果。仓库 loopback 单轮恰好三次模型请求，本地再次运行一轮 6 次请求的 loopback 旅程通过，因此这些序列与第一轮三次请求完成、第二轮摘要传输失败一致。失败回执目前没有保存已完成轮次的逐轮证据，不能据此计算整段冻结事实保留率或任务成功率；这次结果也不能证明服务端已接受第四次请求、是否计费或具体断线原因，故不自动重试未知结果。

对 `e3591426b9` 的准确提交 CI，[CLI CI 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36453175772)中 Ubuntu unit 1/4 失败；从已上传的 `unit-1.xml` 核对，唯一失败为本旅程测试要求每种运行时栈格式都必须有仓库内源码位点，Linux 实际返回 `null`。随后将安全栈位点解析扩展到 Linux 绝对路径，并用合成的本机绝对路径验证允许的仓库内位点；运行时无法可靠解析的栈仍保持 `null`。Windows 本地该旅程 11/11、Prettier、ESLint（0 errors）和 diff 检查通过；修复是否通过 Linux 与最终 SHA 的全矩阵，以新 CI 为准。

## Windows 并发初始化与真实存储宿主夹具

新增宿主夹具的可选 canonical 模式：模型回复仍为确定性测试内容，输入接受回执、去重、最终事件引用和历史查询使用生产存储与真实 CLI 子进程；数据根为工作区外的临时目录，home/security 为同级隔离目录。相同正文与输入 ID 的双会话并发测试暴露了 Windows ACL 初始化竞态。

修复包括：会话目录在首次使用前完成显式权限校验；单项与批量 PowerShell ACL 修复使用同一路径互斥并在锁内重新检查，已有合规 ACL 不再重写；进程内权限缓存核对 dev/ino/birthtime，避免同路径替换目录命中旧缓存。保留物理 witness 的 ctime 检查以及 owner/reparse 拒绝边界。重复修复真实目录/文件不改变子文件身份和时间戳，替换目录会重新校验。

Windows 本地验证：存储、安全及 canonical peer 3 文件 208 项通过、2 项既有平台条件跳过；补充安全、生成 Webview、Workbench 与 JetBrains 宿主夹具 4 文件 74 项通过。两轮有重叠，不相加为独立覆盖率。CLI CI / Strict Sandbox 的精确 SHA 三系统门禁尚未运行，这些结果不构成发布批准。

VS Code 新增 `CC_UI_CONVERSATION_RECOVERY=1` 真实宿主旅程：复用原 user-data profile 进行进程重启，停用旧的合成 deep-link resume；通过现有令牌保护的 DOM 控件编辑草稿、创建/切换会话并读取行 ID。验收步骤覆盖后台完成时间边界、相同正文的独立保存行、A/B 未发送中文草稿、重启后行 ID 与草稿恢复及协议日志无重放。生成 Webview 测试核对输入事件和保存 ACK，宿主驱动 69 项本地测试通过；VSIX 已本地打包。此处仅记录旅程实现与本地回归，真实宿主运行结果另行记录；尚不覆盖 canonical rewind/compaction、附件、问题表单或人工无障碍验收。

首次真实 VS Code 1.132.0 运行（源码 `6ea65d987d`）通过多窗口/双工作区启动，但在 interrupt 阶段失败：协议记录显示 interrupt 先于异步保存中的下一条 user 输入抵达 CLI。失败 evidence digest 为 `sha256:bf757c755db626449d573247b41a5492e48a3d263f87f9a15828b8c83e8c6cbd`，未计为恢复验收通过。后续修复为 Stop / session stop 推进独立输入取消 revision，保存、init 等待和 UNKNOWN 落盘后均检查取消，未发送的已保存输入标记 rejected 并可恢复；图片准备取消后删除新建临时文件并恢复输入。普通中断旅程同时改为等待该轮开始，避免将“取消准备”误认成“中断已运行任务”。相关 4 文件 95 项通过，最后图片取消清理修改后 2 文件 31 项通过，宿主 relay 18 项通过；真实宿主须在新提交上重新验证。

第二次（源码 `e0d1ad3fd7`）通过初始双会话、重复正文、后台完成及草稿切换检查，但整个旅程仍失败，digest 为 `sha256:a0ed0a6fda121d27a7758134cb8c3eac7ed8e053503d91a1a7908ddf1756c169`。检查宿主 `main.js` 确认 `extensionTestsLocationURI` 会令 `getStorageOptions()` 返回 `useInMemoryStorage: true`；因此原 Extension Tests 启动方式即使复用 profile 也不能证明 Memento 重启恢复。canonical 模式改用不含 `--extensionTestsPath` 的普通隔离宿主，以已有令牌驱动命令运行旅程，并通过正常 Quit 保存状态。默认 smoke 模式保留原启动方式。启动器/relay 的 69 项本地回归通过；必须重新运行完整旅程后才能计入恢复验收。

第三次（源码 `f2f3bbd554`）实际磁盘 profile 的初始/重启恢复步骤均通过：A/B 保存行 ID 与中文草稿不变、协议无自动重发。整体仍为失败（digest `sha256:df5f9cdcaab2ee37f7c603d5be7f3d170a8226a6be19e0fda89b1094f9584fc7`）：旧 DOM 聚合断言在切回原会话后要求临时 permission/interrupted 提示仍留在最终画面；规范 final 回复会替换相应 assistant 正文，而 ready 状态会替代 interruption 状态。驱动改为在两条提示实际被观察到时保存各自 DOM 文件；聚合继续要求这些原标记、初始/重启其余标记和恢复证据全部存在。不回写旧运行状态，须用新提交再跑整轮。相关 69 项启动器/relay 测试通过。

### Windows VS Code 实际安装与重启恢复通过

干净源码 `5382a8c3be6f5525c1332c1b2a0e24553dfb5b4e` 的第四次运行于 2026-09-27 16:53:41～16:58:49（北京时间）完成，VS Code `1.132.0` / Windows x64 / 本地 VSIX `0.37.118`。通过双工作区/双窗口启动、stream/retry/plan/permission/interrupt、100 次 Workbench 采样、A 后台完成、A 同正文两轮独立保存行、A/B 草稿切换、同磁盘 profile 的真实进程重启、原保存行 ID/中文 emoji 草稿恢复及协议无自动重发。P95 `1125 ms` 是本地夹具 Workbench 可见性，不能外推至真实模型或网络。

证据摘要 `sha256:3a4743eecdcc83c2485d2777993e7e0f068954e3caf6f17880be8055d7f31e83`；独立重跑所有产物断言并核对 31 个证据文件的字节数/SHA-256、bundle digest、源码 HEAD 和干净工作树，通过后保存[本地回执](./ide/evidence/vscode-canonical-recovery-windows-5382a8c3be.json)。VSIX SHA-256 为 `FC725F46070D130D4CE5DA106E842D5FF4B5B9BFB580F718FB3803AB6EB3E1E4`。完整本地 bundle 在 `.tmp/vscode-canonical-recovery-5382a8c3be`。PowerShell 的 stderr 重定向令外层工具报 exit 1；已用正常退出的独立 Node 文件复现，并验证显式传递 LASTEXITCODE 为 0。宿主 runner 的完整 passed manifest 与所有断言/哈希另行验证通过；该细节保留于回执，不将外层工具状态隐去。

范围仍有限：canonical 会话存储、回执和 history 子进程为生产实现，模型/Workbench/checkpoint 响应为夹具。尚未通过 JetBrains 对应旅程、其他系统、canonical rewind/compaction、附件/问题表单真实宿主、真人听测或长时观察。CLI CI / Strict Sandbox 精确发布 SHA 矩阵仍待运行；未推送、打 tag 或公开发布。

### JetBrains Stop 取消发送准备与管道顺序

复核发现 Stop 原先只向已存在的 child 发送 interrupt，无法取消等待 composer 保存、启动或 init 能力确认的输入。新增每次发送独立的原子状态：Stop 在写入预约前取消该输入；`AgentChatSession` 在同一 stdin monitor 内取得预约后才写入，预约后的 interrupt 因此排在该输入之后。EDT 取消不获取管道锁，保留第二次 Stop 的独立强制停止路径。能力等待可被取消，但不破坏该会话共享的 init future；文件保存完成后再检查取消，不中断持久化写入。

从未取得写入预约的 saved submission 记为 `rejected`，保留文本和附件，composer 恢复可编辑；清除仅属于原 child/client ID、没有回执或保存身份的临时用户行。开始写入后失败仍保持 `unknown`，不误报为未发送；已有 canonical acceptance 不会被本地取消降级。Stop 按钮与 `/stop` 共用此路径，模式切换及关闭也取消尚未发送的准备。

本地 Gradle 编译及 8 类共 **56 项测试通过，0 skipped/failures/errors**，包含真实 Java 子进程、受控管道阻塞、EDT 响应、预约前后 Stop 顺序、拒绝重复写入、共享 init 后续复用、持久化重新读取、草稿恢复、历史行身份隔离、模式状态与进程终止回归。未把这批结果记作真实 JetBrains GUI、其他系统或发布 CI 验收；JetBrains 恢复旅程仍待执行。

### JetBrains 实际宿主恢复旅程准备

`CC_UI_CONVERSATION_RECOVERY=1 node packages/jetbrains-plugin/scripts/run-ui-host-journey.mjs --ide-version 2024.2 --artifact-dir <新证据目录>` 启用独立的 `jetbrains-canonical-conversation-recovery` 旅程。沿用 Remote Robot 和原生 Swing 按钮、输入框、标签页；只读反射采集实际渲染行对应的保存身份，驱动不调用插件内部发送/恢复方法或写草稿存储。CLI `home` / `security` 位于仓库外新建的临时目录。

检查 A 在 B 激活期间完成、A 两次相同正文保留四条独立保存行、A/B 中文 emoji 草稿隔离，以及使用相同磁盘 profile、不同 IDE PID 重启后的身份和草稿保留；协议台账必须恰有 A 两次和 B 一次输入，并有实际 CLI history 查询。该独立旅程不替代原有 chat/control/Workbench/rewind 旅程，也不声称夹具 checkpoint 是真实 canonical rewind。

UI 驱动编译通过；证据验证器与启动器 23 项 Node 测试、既有宿主夹具 11 项 Vitest 测试通过；修改的 JS 文件 ESLint 无错误。真实 GUI 执行结果尚未取得，不能将准备完成计作宿主验收通过。

首次 Windows IntelliJ 2024.2 实际宿主运行（源码 `bf5829ba7f`）失败于驱动读取第一个快照：`String.valueOf(frame.callJs(...))` 的 Java 泛型推断选中 `char[]` 重载，对实际 String 返回值强转失败。改为先接收 Object 再转换，UI 驱动重新编译通过。失败证据保留在 `.tmp/jetbrains-canonical-recovery-bf5829ba7f`，digest `sha256:a6e81d3ca9a256d5197d5a645f1d213baef5831d42d4bbfa1531153631f5badc`；该次未取得恢复验收结果，须用新提交重跑。

第二次（源码 `1b9a0190d1`）初始及真实进程重启的 GUI 断言均通过，保存行身份和双草稿保留，但整体证据验证失败：Windows `JTextPane.getText()` 经 EditorKit 输出 CRLF，而每条保存行从 `Document.getText()` 读取为 LF，严格的“行正文属于渲染文档”比较因此不匹配。驱动统一从同一 Document API 读取全文和行，保留严格归属断言。旧失败 bundle `.tmp/jetbrains-canonical-recovery-1b9a0190d1`（digest `sha256:96d287db4ba4fd126f20d0cfc3cc307c5dfc61e6e07cd7a5377dcf12205659f4`）不回写为成功。

第三次（干净源码 `edc2d89cc6`）完整旅程及证据汇总通过，工具退出码 0。独立复核 24 个产物哈希、bundle/evidence digest、全部恢复断言及六条渲染行与 canonical 提交引用的对应关系，通过后保存[本地回执](./ide/evidence/jetbrains-canonical-recovery-windows-edc2d89cc6.json)。证据 digest 为 `sha256:dd3747653fbdb75161ddf0aa1b6d20544de58ed9c356d490f6c73fd783b2a29f`。

安装核对同时发现：Gradle testing extension 的 GUI 沙箱将 JUnit/Kotlin test runtime 放入本插件目录，且未包含 ZIP 的 searchable-options JAR。生产插件 JAR 与 ZIP 字节相同，但该次不是干净 ZIP 安装验收，回执明确保留这一限制。新增 `installUiJourneyPlugin`：在宿主启动前将本插件目录同步为实际构建 ZIP 的内容，保留独立的 Robot 插件；同步前检查规范路径限定在工作区 `build/idea-sandbox` 内。恢复驱动初始/重启两阶段均读取实际已加载插件路径，逐文件比较 ZIP 的完整清单和 SHA-256，禁止额外测试依赖，记录安装证据。

新增安装任务及 UI 编译通过，实际沙箱本插件目录仅有 ZIP 中两个 JAR；25 项 Node 证据/启动器测试、11 项既有夹具回归通过，JS ESLint 无错误。干净 ZIP 的实际 GUI 重跑待完成，第三次有限通过结果不扩大为这一新增门禁通过。

第四次（源码 `fdbdd382b0`）两次宿主安装均通过实际 ZIP 清单/字节检查，初始恢复旅程通过；重启时 A 历史加载失败，草稿仍保留，整体结果失败（`.tmp/jetbrains-canonical-recovery-fdbdd382b0`，digest `sha256:6ceb244fb203930c192edc0ea238452df14cb3f96d286ab6ce0e4a56171e4706`）。在与 GUI 相同用户环境中直接运行实际 CLI，原 A/B 历史分别读出四条/两条，未发现存储数据丢失；该次诊断没有将宿主失败改写为成功。

后续为每轮指定独立的 IDE profile 和项目目录（同一轮初始/重启共用），避免累积旧轮次标签页；宿主快照新增完整 history 状态及已选 CLI 名称。夹具的 `--version` 移到 canonical 存储初始化前，版本探测不再触发 ACL/存储；四个生产 CLI 候选名均提供隔离的夹具入口，避免 fallback 到全局安装。版本无存储副作用和真实候选入口回归通过；相关 CLI 两文件 15 项、Node 25 项通过，隔离目录下 UI 编译和 ZIP 安装任务通过。这些是隔离和诊断改进，尚不能据此断言第四次失败的唯一根因。

第五次（源码 `b5ec362733`）在构建阶段被隔离目录名校验拒绝：启动器直接使用含 `2024.2` 点号的日志目录名，而 Gradle 只允许字母、数字和连字符。启动器改为将点号转换成连字符，保持路径检查不放宽；尚未启动 GUI 的失败证据保留（digest `sha256:967562311e8e6d901a6601d13ec6e9e02dcc2168aaf3c41b445674cd8323fbf7`）。

### Windows IntelliJ 实际 ZIP 与隔离 profile 重启恢复通过

第六次运行使用干净源码 `510b443ac36099035c7d95aa5ec8c65e5dd560c8`，于 2026-09-27 20:05:02～20:08:25（北京时间）完成，Windows x64 / IntelliJ `2024.2` / 本地插件 ZIP `0.4.139`，工具退出码 0。初始与重启阶段均逐文件核对实际加载的插件目录与 ZIP：只有打包的生产 JAR 和 searchable-options JAR，路径/内容完全一致，没有额外测试运行库。每轮使用独立项目/profile，同一轮重启使用同一磁盘 profile 并验证 IDE PID 已改变。

完整通过 A 在 B 激活时完成、相同正文两轮保留独立身份、中间工具文本保留、A/B 中文 emoji 草稿隔离、重启后的六条保存行身份与双草稿恢复，以及协议恰有 A 两次/B 一次输入、没有自动重发。独立重跑全部证据断言，核对 **31 个产物的字节数和 SHA-256**、bundle/evidence digest、渲染行与真实 canonical 提交引用、完整 ZIP 安装清单及源码干净状态，通过后保存[本地回执](./ide/evidence/jetbrains-canonical-recovery-windows-510b443ac3.json)。证据 digest 为 `sha256:4925c866ffb777ca1536ab2bf073cc3cfc6db1eacef1db5957c83f4900031987`；ZIP SHA-256 为 `111483296646e9f9f084fba46664c9f5e7396478a53536fe3ff2eef724002c0a`。

这是独立恢复旅程，未替代既有 chat/control/Workbench/rewind 流程；模型回复仍为夹具。第四次旧复用 profile 的历史加载失败唯一根因尚未确认，保留旧配置/多标签恢复复核项；新隔离运行通过不抹去该失败。其他 IntelliJ 版本/操作系统、Stop GUI 专项、附件/问题表单、真实模型、人工听测、长时观察及发布准确 SHA 的完整 CI 仍待完成。尚未推送、打 tag 或公开发布。

### 旧七标签 profile 副本读取复核

干净源码 `9e44569972` 下，将第四次失败的项目配置和 profile 复制到独立目录，按新项目路径重映射草稿命名空间，保留七个标签的原会话/草稿身份、原 canonical 存储及原正文。只运行恢复读取阶段，未发送输入或调用模型。Windows / IntelliJ 2024.2 实际 ZIP 清单校验、A/B 六条原保存行及双草稿恢复通过，诊断进程正常退出。

独立复核原始基线的标签/行身份、草稿、协议无输入、ZIP 哈希与安装清单后，保存[诊断回执](./ide/evidence/jetbrains-old-profile-diagnostic-windows-9e44569972.json)，digest `sha256:320f8fc3954921d9e32c61b2cec3641ad0a0e9f79d465d579eefc5dda0f5e7aa`。这是配置副本的读取诊断，不是新的完整双阶段旅程；仅预期 profile 路径作了显式重映射，原失败记录仍为失败。

当前无存储副作用的版本探测和四 CLI 别名隔离下可读取旧配置，但尚未证明原故障的唯一根因。观察到 29 次版本探测和 9 次历史查询，后台标签查询排在 A/B 前；快照时六行已可见，后续增量刷新状态仍为 Loading。版本发现并发去重、恢复读取调度与稳定就绪延迟仍有优化空间，不据本诊断宣称启动性能验收。

### IDE 发布前确认配套 CLI 已公开可安装

根据用户要求的“子 npm 包 → CLI → IDE”顺序，保留现有 npm 子包先发、字节回读和候选 CLI 全新安装门禁，在 IDE 工作流的实际上传步骤前补充共享 composite action。从 npm 公共 registry 安装配套 CLI 精确版本，复用子包验证器检查实际依赖和锁记录，再检查 CLI 自身 registry 锁、依赖集合及真实版本/能力输出；失败阻止 Open VSX、Microsoft 补发和 JetBrains 上传。普通分支构建不要求提前发布 CLI。

本地 20 项 Node 校验/发布契约测试、actionlint 与 ESLint 通过；Windows 从 npm 新安装已发布 `chainlesschain@0.166.77` 后，10 个内部子包及 CLI 版本/能力探测通过，保存[公开安装探测回执](./cli/evidence/ide-cli-prerequisite-smoke-windows-2026-09-27.json)。这仅验证前置检查实现和旧已发布版本的可用性；未验证本批源码的准确 SHA 发布门、完整安装生命周期或真实模型，也没有修改版本号、推送或发布。

### JetBrains 恢复时按选中标签读取

根据旧配置诊断观察，ConversationView 不再在每个后台标签构造时立即发起 CLI 版本/配置及历史读取；首次选中时启动提示探测，历史仍在选中及实际后台 turn 完成时更新。恢复首个标签显式触发读取，避免首次选中事件被批量建标签过程屏蔽；本地草稿和计划状态仍按原流程恢复。此改动减少未访问旧标签对两个历史读取 worker 的占用，没有引入全局缓存失败或改变运行中会话的后台处理。

27 项相关 Java 回归（3 类，0 跳过/失败/错误）、插件 ZIP 构建及 UI 驱动编译通过。GUI 历史断言进一步要求状态为 Saved messages，不再仅凭保存行已出现即通过；旧七标签副本和完整双阶段旅程待在本次源码提交后重新验证。

源码 `30c1a0e183` 后续两项实际宿主验证均通过。旧七标签副本保留原六条保存行和双草稿，版本探测从前次 29 次降至 6 次，历史查询从 9 次降至 3 次；A/B 状态分别为 `Saved messages 1–4 of 4` / `1–2 of 2`，协议无用户输入。[旧配置诊断回执](./ide/evidence/jetbrains-old-profile-diagnostic-windows-30c1a0e183.json)保留副本路径重映射与单次观察的边界，不能据次数下降宣称延迟 SLO 或原故障唯一根因已经查明。

同一干净源码的完整 initial/restart 恢复旅程也通过，模型仍为夹具；实际 ZIP 安装、后台完成、重复正文独立身份、双草稿及真实进程重启恢复均通过，四份 A/B 快照全部显示历史已加载完成。独立核对 31 个产物的长度和 SHA-256、bundle/evidence digest、行身份与真实提交引用及完整 ZIP 清单后保存[完整恢复回执](./ide/evidence/jetbrains-canonical-recovery-windows-30c1a0e183.json)。证据 digest `sha256:8005d099a4aabf8bff1e5125b18324382d1b3d6be15ce76787d5b90b80a42244`，ZIP `sha256:5a89b430908371d980a2cf8e5dd62ab845fb7b57a82ad047e79d94448305541d`。范围仍为 Windows x64 / IntelliJ 2024.2；未替代其他宿主/交互场景、真实模型和最终 SHA Actions。

### JetBrains Stop 初始化等待的真实宿主验收准备

canonical 恢复驱动新增独立 C 标签场景：fixture 按 session/nonce 在 init 前等待显式放行，驱动通过原生 Send/Stop 控件取消准备中的输入，先确认 composer 可编辑、草稿已保存及尚未收到 init，再放行并确认共享 capability future 正常完成。随后运行原 A/B 后台完成与重复正文旅程；重启恢复 C 的未发送草稿，要求真实 CLI 历史为空、不启动 Agent，并从完整协议记录检查没有自动重发。

新证据使用 recovery v2，验证 gate 原始 trace、观察顺序、原 session/标签身份、初始/重启进程以及保存行与加载状态。v1 旧证据仍可按原范围读取，不新增 Stop 通过声明。fixture gate 仅在隔离 GUI 子进程环境启用，不修改生产 CLI 初始化逻辑。

39 项 Node 证据/启动器测试、16 项 CLI 真实 peer/宿主夹具测试及 UI 驱动编译通过；修改 JS 的 ESLint 与 diff check 通过。实际 ZIP 的新 GUI 场景待源码提交后运行，尚不将新增测试代码计为宿主验收完成。

首次 v2 宿主运行（`09c61578d7`）失败：取消提示、可编辑 composer 和 `Draft saved` 已出现，但驱动用 JavaScript `Boolean(...)` 转换反射返回的 Java boxed Boolean，将 false 对象判为 true，导致 `sendInFlight` 一直显示 true。等待至夹具 init gate 超时后失败，不能据此报告 Stop 旅程通过。驱动改为按 Java 布尔值的字符串表示显式比较；原失败 bundle `.tmp/jetbrains-canonical-recovery-09c61578d7`（digest `sha256:923ee464d21e3075afab2c893dac2c2fdb238995339a80fb2aeb365c64831f05`）保留，修正后需要重新运行。

修正后的干净源码 `989a46cd6e` 完整 v2 旅程通过。真实控件确认 send 准备中且无 init → 点击 Stop → composer 可编辑、取消提示及草稿保存 → 显式放行 init → 共享 capability 正常完成；随后原 A/B 旅程和真实进程重启全部通过。重启后 C 草稿仍在，实际 CLI 返回空历史，未启动 C Agent，完整协议无 C 用户输入；模型输出仍为夹具。

独立重跑全部 v2 验证器，核对 **34 个产物的长度/SHA-256**、完整 ZIP 安装清单、bundle/evidence digest、六条 A/B 渲染行与真实 canonical 提交引用，保存[恢复与 Stop 回执](./ide/evidence/jetbrains-canonical-recovery-windows-989a46cd6e.json)。证据 digest `sha256:66c4ed0f29ef58ff288b76e0ce328706230a6836e0fcd529807e5665f95b5d33`；插件 ZIP 与前一生产实现相同（`sha256:5a89b430908371d980a2cf8e5dd62ab845fb7b57a82ad047e79d94448305541d`）。范围仅为 Windows x64 / IntelliJ 2024.2 的 init 等待取消；未覆盖磁盘保存/附件准备/阻塞 stdin 的全部 GUI 分支、再次发送后的 Stop、真实 provider 或其他系统。

### JetBrains canonical 恢复接入发布宿主矩阵

`IDE Extensions` 的 Windows/Linux/macOS × IntelliJ 2024.2/2025.2 六个宿主单元，保留原 chat/control/Workbench/rewind 旅程，额外执行 canonical recovery v2（包括 init 等待中的 Stop）。新增锁文件约束的 CLI workspace 依赖安装，以运行实际 CLI 历史子进程；每个旅程独立 profile/项目及证据目录，使用同一准确源码 SHA，任一旅程失败即阻止该宿主 job 通过。

更新后的发布/前置检查契约共 21 项 Node 测试通过，actionlint 通过。此处记录 CI 配置已接入，尚未取得六单元的远端通过结果；本地 Windows 2024.2 回执不扩大为整套矩阵通过。

## 本地验证与提交记录

- 第一轮跨模块回归：45 文件、822 项通过，覆盖模型/费用/ledger/恢复、编排、外部 adapter/bridge、MCP、Chat/replay/streaming。
- 后续权限模式相关回归：5 文件、137 项通过；退出确认另 4 项通过；附件与 Chat 回归 5 文件、110 项通过，附件边界另 6 项通过。这些运行有重叠，不相加作为独立覆盖率。
- 修改的 CLI / VS Code 源文件 ESLint：0 errors；6 项既有 unused-variable warnings。
- 已重新生成命令 manifest、help index、四种 shell completion 和 CLI reference，三个 drift check 全部通过。
- 扩展回归 64 文件：1011 项通过，1 项旧模式测试未等待退出确认而失败；更新该 fixture 后，相关 3 文件 56 项全部通过。模型/计费/bridge/MCP 的最新补充回归 6 文件 111 项通过。
- JetBrains 初次 Gradle 被缺少完整 JDK 21 阻断；下载官方 Temurin JDK 21.0.12.1+1 并核对 SHA-256 后，`compileKotlin`、`compileJava`、`compileTestJava` 与 `ImageAttachmentsTest` 的 8 项测试通过（0 skipped / failures / errors）。未跑真实 GUI。
- 以下为本地提交，没有推送或发布；后续未完成工作继续沿用上表任务 ID。

| 提交                        | 已提交范围                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `3571acda0e`                | 最新模型 profile、Responses 三型号回归、统一价格与 durable ledger / budget / Eval 计费                                |
| `42010e7148`                | 外部 Agent 生命周期与 Codex 事件关联、MCP 404 安全重建、编排准入状态及生成文档                                        |
| `025dddcd46`                | 有界 canonical context 分页、VS Code 后台正文恢复与流式渲染、CLI mode ACK/退出确认、异步图片与会话内输入隔离          |
| `8e9c6f9d4d`                | JetBrains 图片 header/字节/像素限制、异步处理、错误显示与 JUnit                                                       |
| `2d5084605c`                | CLI canonical 输入接受回执、只读查询与 ID 去重，SDK 可选传参、共享协议 fixture 及 vendor 同步                         |
| `6b5da7f538`                | CLI 普通图片入口的 header/字节/像素校验、固定句柄有界读取及超量明确拒绝                                               |
| `4889036941`                | VS Code composer/附件持久化、发送前保存、输入接受回执核对、关闭草稿恢复                                               |
| `03957c15d4`                | VS Code 问题表单与原生文本/选项草稿恢复、请求绑定隔离及回答交付预约                                                   |
| `d45175eeac`                | JetBrains 权限 ACK、独立进程退出确认、启动取消与过期输入隔离；共享协议类型与生成产物同步                              |
| `6c47788623`                | 实际后台列表全扫/索引分页/失效重建容量对照、完整内容遍历与路径观测回归                                                |
| `f6f7840502`                | 干净 Windows SHA 的实际分页容量对照 receipt；保留少样本与未冻结 SLO 边界                                              |
| `38fc29e634`                | JetBrains composer/附件草稿、稳定 tab 身份、输入接受回执核对与安全恢复                                                |
| `e5dc0aa6ed`                | JetBrains 问题表单草稿、原 child/generation 响应隔离、归档恢复与敏感字段排除                                          |
| `f9fb1ec91b`                | VS Code 原生结构化 schema review、字段草稿、QuickInput 队列、原连接请求生命周期与确认状态；CLI 传递 MCP metadata      |
| `6a3498820c`                | v2 display history 保留规范压缩前正文、revision 游标、fork 隔离与替换边界；VS Code 历史分页及真实 store / Kernel 回归 |
| `0616351a36`                | JetBrains v2 历史页、独立有界读取与取消、历史/现场切换、选择及滚动保留；共享 CLI fixture、真实子进程及 Swing 回归     |
| `e873b93667`                | 新 timeline 回退前缀来源校验、跨规范压缩的有效祖先范围、同锁有界重扫与旧游标失效；真实 CLI / store 回归               |
| `c5cff5f5df`                | 分支流式复制独立显示历史、上下文来源与创建摘要校验、失败重试和父会话删除后读取；完整文字分片及 v1/v2 页字节边界修复   |
| `f60236db18`                | timeline 摘要来源证书、原始正文与游标保留、system 摘要依赖的回退检查及 branch-history v2；连续摘要/分支/压缩回归      |
| `875b15d560`                | verified sync cursor 与连续增量历史读取、JSON 错误分类及真实存储/CLI 回归；双 IDE 仍使用快照读取                      |
| `70a51435da`                | 最终结果关联已提交 user/assistant event，输入 ID 与共享协议类型、生成产物及 SDK 同步；160 项本地回归通过              |
| `44db0e64ab`                | VS Code 连续增量历史合并、原 child 终态引用关联、重复正文独立身份、选区及原位显示保护；相关回归与本地 VSIX 验证       |
| `c6852748ba`                | JetBrains 连续增量历史合并、输入行写入前预约、终态身份关联、选区/滚动与有界淘汰；共享真实 CLI fixture 与本地 ZIP 验证 |
| `71760f5da6`                | Windows ACL 幂等互斥修复、身份缓存及会话目录初始化；真实 canonical 宿主 peer、双进程回执/历史与去重回归               |
| `6ea65d987d`                | VS Code 实际宿主双会话、重复正文、草稿与重启恢复旅程实现                                                              |
| `e0d1ad3fd7`                | Stop 取消保存/init/UNKNOWN/图片准备中的未发送输入，保留恢复记录与清理新建图片                                         |
| `f2f3bbd554`                | 恢复旅程使用实际磁盘 profile 的普通宿主，并正常 Quit 保存状态                                                         |
| `5382a8c3be`                | 单独保留瞬时控制 DOM 证据；此 SHA 的完整 Windows VS Code 恢复旅程通过                                                 |
| `a6bc8a5b0f`                | VS Code Windows 恢复旅程的独立哈希复核与本地回执                                                                      |
| `356d7fd794`                | JetBrains Stop 取消准备、stdin 原子预约、未发送草稿恢复和临时行清理；56 项回归通过                                    |
| `bf5829ba7f`                | JetBrains 独立 canonical 恢复旅程、原生控件驱动及证据验证器                                                           |
| `1b9a0190d1` / `edc2d89cc6` | 修正 Robot 泛型返回类型和 Windows 文档换行；旧沙箱的有限完整旅程通过并保留其安装限制                                  |
| `fdbdd382b0`                | GUI 宿主安装实际 ZIP，初始/重启逐文件校验，排除额外 test runtime                                                      |
| `b5ec362733` / `510b443ac3` | 独立项目/profile、无存储副作用的版本探测与四候选入口隔离；后者的实际 ZIP 完整恢复旅程通过                             |
| `3532bfd45f`                | IDE 上传前验证配套 CLI 和子包已从公共 npm 安装并可执行；发布前置检查及公开旧版本安装探测                              |
| `30c1a0e183`                | JetBrains 按选中标签发起恢复查询；27 项 Java 回归、旧七标签副本与完整实际 ZIP 重启旅程通过                            |
| `09c61578d7` / `989a46cd6e` | 受控 init gate 与 v2 Stop/草稿恢复旅程；后者修正 Java Boolean 取值并完成实际 ZIP 验收                                 |

提交表示这部分实现及其本地回归已经保存，不表示同 ID 下的真实账号、跨平台、完整历史、宿主输入接受旅程或生产观察验收已完成。

### Windows Actions ACL 定位与追加实机回执

`3b0bc23021530d0624ca07e52515d5e8ac040cb7` 的 [Windows Local 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36326262392/job/108639499011) 报 `private-storage:1210`，对应 `ensurePrivateDirectory` 的 ACL 修复失败。固定目录树已经由源端批量创建并修复，目标进程仍会独立校验会话目录；本机 prepare 通过，尚未确认托管 Windows 原生失败原因。

追加 PowerShell 固定操作阶段和 HRESULT；上层仅接受白名单阶段及固定长度十六进制值，不返回目标路径、会话正文、原生异常消息。保持 owner-only、链接拒绝、失败拒绝、原超时与重试预算。相关 3 文件 116 项测试通过；真实 PowerShell 验证权限修复成功、重复检查不改变子文件 ctime、缺失路径仍拒绝且仅输出 `lookup:0x80131501`。这次提交是诊断补全，尚不标为 Windows CI 修复。

干净 `3b0bc23021` 的 Windows VS Code 1.85.2 实际 VSIX 普通控制旅程退出 0，独立复核 29 个产物、bundle/evidence digest、完整初始/重启与双窗口断言，保存[回执](./ide/evidence/vscode-control-minimum-windows-3b0bc23021.json)。覆盖 Stop 可见提示与 Workbench 100 样本，模型和输入回执仍为合成夹具，不扩展为 canonical 恢复或真实 provider 通过。

同一干净源码 Windows→已有 Ubuntu WSL1 的完整缩小流程退出 0；初始化、准备、断连探测、恢复、生命周期故障、结果返回和 finalize 均完成。独立复核 9 个产物及 2 条轨迹 outcome，保存[回执](./cli/evidence/execution-location-wsl-windows-3b0bc23021.json)。临时 home/security 为 `/tmp` 兄弟目录；仓库从 Windows 挂载，不能代替 CI 独立 rootfs 或 100 条轨迹门。旧 `8db732245f` Container 100 条轨迹远端通过；最终 SHA 的三系统发布门仍待齐备。

`a7d2ebb721` 的 [Windows 复跑](https://github.com/chainlesschain/chainlesschain/actions/runs/36327273639/job/108642337841) 明确返回 `windows-acl [timeout]`。原逻辑将单路径 15 秒拆成两次 7.5 秒，批量 30 秒拆成两次 15 秒，冷启动每次重新开始；单路径甚至短于原生互斥锁的 10 秒等待。调整为一次进程使用完整的原预算，超时仍拒绝，不提高总上限、不重试延长阻塞、不跳过 ACL 校验。模拟 10 秒单路径/20 秒批量操作的回归在修改前失败；修复后的相关测试和原生权限/幂等/拒绝探测通过。托管 Windows 是否已解决仍须新 SHA 作业确认。

`ded3eee808` 的 [Windows 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36327648662/job/108643388246) 仍在目标目录 ACL 处超时，完整 15 秒不足，不能将预算修正称为最终解决。现有 `_cli-test.yml` 已对托管 Windows 使用 60 秒 ACL 额度；执行位置工作流未配置该值，Local 目标环境也未转发它。新增相同的 Windows 工作流额度，并仅转发经过既有上下限校验的数值，不转发原字符串或其他凭证环境。生产默认保持 15/30 秒，目标外层命令上限不变；原生脚本发出固定阶段标记，超时仅返回最后已到达的白名单阶段或 `startup`，不输出路径/原异常。下一轮远端结果仍待验证。

### CODEX-01：官方生成 schema 约束协议夹具

从 [OpenAI 官方 App Server 文档](https://developers.openai.com/codex/app-server) 核对 `generate-json-schema`、initialize/initialized 和通知格式，并安装隔离的 npm `@openai/codex@0.157.1`，实际二进制报告 `codex-cli 0.157.1`。保留其未修改的 `ClientRequest.json`（206057 字节，SHA-256 `2ababf80956ae311d1dcee4b595dcd3ef86b29a764d31529d7bbf5c4b2f0f2b8`）和 `ServerNotification.json`（206585 字节，`07d24f16d743d1956dee25ece38ed6656d9c9620519e8cf0c4a4186b2719dae3`）作为协议夹具，附上来源/版本/生成命令/许可证；禁止 formatter 改写这两个生成文件。

旧手写会话夹具在官方 schema 下发现线程元数据、`startedAtMs` 和 `completedAtMs` 缺失，三项测试先失败；补齐后通过。夹具移除上游 stdio 不发送的 jsonrpc 头；刻意未知的 future/telemetry 单独保留，不伪称官方方法。新增验证器检查适配器实际生成的 thread/start、turn/start 请求、完整通知、必填字段负例以及早到通知的输出/usage 投影；兼容白名单未增加 0.157.1，测试仅显式注入局部矩阵。新增三系统 CI 用固定二进制重新生成并逐字节比较两份 schema，避免仅在字符串中搜索方法名就视为协议兼容。

本地 19 项适配器/官方 schema 回归及实际生成字节比较通过。此批没有发起模型请求，未取得最新二进制真实 turn、真实 provider 或三系统 CI 结果；CODEX-01 继续为局部实现，实验模块仍无生产调用方。

### Windows 迁移越过 ACL 后的缓存落点修正

`984be3adbd` 的 [Windows 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36328378916/job/108645440449) 已完成 prepare、断连恢复及两次实际 Chat `/exit`，原 ACL 超时阻塞已越过。新失败在 lifecycle-faults 的干净源码断言：`?? Microsoft/`。保留该失败，不忽略目录、不删除失败证据、不放宽干净提交要求。

Local 目标设置了隔离 APPDATA/LOCALAPPDATA，但未创建这些目录，ACL PowerShell 仍从仓库 cwd 启动；项目既有 formal-quality 分支已有隔离工作目录防护。本批将同一防护用于已配置的 Local runner，把 ACL helper 的 cwd 固定在存在且非链接的目标应用状态目录，并将 AppData/Local/Roaming 纳入原固定树的创建与批量 ACL 修复。真实原生探测核对 helper cwd、权限修复、子文件 ctime 幂等和缺失路径拒绝通过；完整远端迁移仍待新 SHA 结果。

旧 `8db732245f` 的 Local Linux/macOS、Container、SSH、WSL 五个 100 条轨迹单元均已通过；Windows 失败使聚合正确拒绝。旧 `3b0bc23021` 的 JetBrains ARM64 五个单元也全部通过，VS Code ARM64 三系统后续作业继续等待。旧提交成功结果不能替代本轮最终 SHA 发布门。

### JetBrains ARM64 共享夹具状态竞态与版本门诊断

用户指定的 [Linux ARM64 / IntelliJ 2024.2 作业 108645440503](https://github.com/chainlesschain/chainlesschain/actions/runs/36328378841/job/108645440503) 对应 `984be3adbd`，失败于 Workbench readiness 第 14 次：等待 `needs_input` 45 秒，最后状态为 `done`。前 13 次均在 357–368ms 内完成；第 14 次没有 `daemon-resume` 命令。产物中的协议日志显示，第 13 次 reply 写状态的同一毫秒发生投影刷新，返回 13004 字符的初始快照，而正常完成快照为 13844 字符；界面因此暂时得到没有 artifact/PR 的初始 `done` 行，后续精确版本复核拒绝发出命令。

夹具原先使用 `writeFileSync` 直接截断覆盖共享 JSON，`readState` 遇到空文件/解析失败又静默返回初始状态。新增真实双子进程回归，固定暂停在截断与写入之间，修复前稳定复现 `needs_input` 被替换为 `done`；损坏状态负例也先失败。改为同目录临时文件完整写入后原子替换；只有文件不存在才初始化，已有损坏文件明确失败。写入事务复用严格跨进程锁，保留并发会话计数；Windows 短暂共享句柄冲突最多重试替换 1 秒，始终保留旧目标文件。没有修改生产权限/版本校验、100 样本要求或可见性 SLA。

4 个夹具/宿主回归文件 20 项及宿主证据验证器 10 项通过，补充双会话计数断言；格式、ESLint、actionlint 和 IDE 工作流路径契约通过。ARM64 工作流补上共享夹具路径触发。原失败 ZIP 产物为 `10934718198`，其 journey evidence 摘要为 `sha256:b3d33e19a42cf9ffc5fb3595a9b33e67e4faa8d0a9a001c738e71a5a95431e0d`。本地进程回归不能代替修复提交的 Linux ARM64 实际 IDE 复验。

另一个用户指定的 [作业 108645441714](https://github.com/chainlesschain/chainlesschain/actions/runs/36328378862/job/108645441714) 是 `Workspace Publish Staleness`：Agent SDK `0.2.11`、VS Code `0.37.118` 的源码已变而版本未变，退出 2。该门行为正确，重复运行不会解决；候选冻结时须补版本、changelog 和下游依赖对齐。本批保留未完成状态，不跳过检查、不发布。发布顺序继续为子 npm 包 → CLI → IDE，并要求准确最终 SHA 的完整平台结果。

### CODEX-01：固定上游原生进程的交错 turn 与通信故障

新增[可重复探针](../../packages/cli/scripts/codex-app-server-turn-probe.mjs)，验证 npm 固定包和实际原生二进制均为 `0.157.1`，记录二进制 SHA-256。启动目录与 Codex home 位于源码仓库外；环境只继承必要系统项，配置只使用 loopback Responses SSE 合成 provider，未继承账号凭证、代理或 Node 注入变量。使用真实 `CodexAppServerAdapter`，仅探针注入该版本兼容项；生产白名单未变。

真实第一线程先收到文字分片并保持未完成，第二线程返回 HTTP 400 并结束为 `failed`；此时第一线程仍未结束，释放 SSE 后才得到 `completed`、`probe-ok` 与 10/2/12 tokens。第三线程通过实际 `turn/interrupt` 得到 `interrupted`。第四线程在 provider 已收到请求后杀死原生进程，独立观察 `close`，适配器返回 `CC_CODEX_APP_SERVER_FAILED_AFTER_ADMISSION`，fallback 调用为 0。每条请求和通知用固定官方生成 schema 校验；RPC/输出/通知/关闭等待均有界，成功与失败都保存可校验的通知产物。

干净 `795434f14427cdf813201f19e0469cc5c20a0c83` 的 Windows x64 执行退出 0，保存[本地回执](./cli/evidence/codex-real-turns-windows-795434f144.json)。独立复核原始通知文件 SHA-256 `8a262b7a2bb3bd96216d5519dd9bb7b615c2063ce6f2ad21e3c01e398ed8291a`、37 条官方 schema 有效通知、失败先于第一线程完成的顺序、三种终态、usage 原值及第四线程无终态；四次 provider 请求均无 Authorization。前一次 `ce71f16051` 的探针精确 usage 断言遗漏上游 `cacheWriteInputTokens: 0` 而失败，补齐后才获得本回执。

相关 4 文件 34 项回归通过，覆盖隔离环境、UTF-8 分片、畸形协议、进程死亡、RPC 超时和有界关闭；包括额外的服务端请求与客户端 RPC 同 ID 负例，探针明确拒绝未处理的审批请求，不误当成功响应。CI 将同一真进程探针加入最新 schema 的三系统单元，保留通知原始字节，并使总门依赖该单元全部成功。当前仅有 Windows 本地结果；合成 provider 不能冒称真实账号/模型、工具审批或三系统通过，CODEX-01 继续局部完成。

### CODEX-01：真实审批取消暴露的工具终态误投影

固定 `0.157.1` 原生进程实际发出 `item/commandExecution/requestApproval`，探针回复 `cancel` 后，上游命令 item 以 `declined` 结束，turn 为 `interrupted`，预定的临时标记文件不存在。原适配器把所有 `item/completed` 的顶层状态统一改成 `completed`，因而误表示被拒绝的工具；这是无生产调用方的实验模块缺陷，不表述为默认 CLI 已执行未授权命令。

修正 `commandExecution` / `fileChange` 的 item 终态：保留 `completed`、`failed`、`declined`，未知或缺失状态标为 `unknown`，不推定执行成功。新增 8 个状态反例，其中 6 个修复前失败，修复后通过。保留原 turn 归属、最终文本、兼容白名单和不明结果拒绝 fallback 行为。

追加未改字节的上游 `ServerRequest.json`（49887 字节，SHA-256 `f339be472737a0003efa25fba2e6e6c9237e621cd065b6d6995c51256e9dc1fb`）与 `CommandExecutionRequestApprovalResponse.json`（3202 字节，`6d0767113e22f311381809b6b236b0dde2b99b01992879c26bf7b1ea0e003cb7`），纳入原三系统逐字节重生成校验。探针区分服务端请求和同 ID 客户端 RPC，只有该场景的 thread/workspace/turn/item 与已观察到的命令一致才回送取消，硬性拒绝 `accept`；不执行命令、不写入持久放行规则。

干净 `312cdba00653f42d3c03cc138d82e3d1c69aac68` 的完整 Windows x64 探针退出 0，保存[审批取消回执](./cli/evidence/codex-approval-cancel-windows-312cdba006.json)。独立复核 52 条官方 schema 有效通知、1 组审批请求/取消响应、工具 `declined` / turn `interrupted`、空 processId/exitCode 和标记文件不存在。通知原始字节 SHA-256 为 `0be7b880f079009e4df214e680ef5ef89b1bb4016023f9205578398cc5415d18`，审批对为 `e798f4fca558c0989cc3e93a04e7aa0e249782e2bb071f5cd31aad280f265d6f`；5 次 provider 请求均无 Authorization，断连无 fallback。

相关 4 文件共 45 项通过。另行探测普通只读 echo 工具时，上游返回 `blocked by policy`，没有实际工具执行通知；保留该限制，不将其计作工具执行通过。当前证明 Windows 合成 provider 的审批取消与协议投影；三系统、实际工具执行和真实模型验收仍未完成。

### Actions 后续复验：ARM64 状态竞态与 Windows 执行入口（2026-09-28）

用户报告的 Linux ARM64 / IntelliJ 2024.2 竞态修复在 `2c4fe5206393d02b8527c45f75846709e48a2cd1` 的[新作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36329903276/job/108649724765)通过；同次 Linux 2025.2 单元也通过。下载 2024.2 产物后独立复核 39 个文件、整体 evidence digest、初始/重启阶段与样本数，保存[回执](./ide/evidence/jetbrains-linux-arm64-2024.2-2c4fe52063.json)。readiness 40 次、正式 100 样本，p95 为 365 ms、最大 616 ms，门限仍为 2000 ms。模型及网络为 loopback 夹具，rewind 仍标为 partial；这证明该失败单元在修复提交上的恢复，不代替最终提交的完整宿主验收。

旧 `3b0bc23021` ARM64 run `36326262093` 的 11 单元汇总已通过，仍只属于旧提交。`4b9be3c6f4` 的 [Windows execution-location 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36329168064/job/108647674571)已越过准备、断网恢复和资源限制阶段，完成前 8 个 campaign Chat 恢复，随后在下一条 `session location show` 的 sandbox helper 外层 30 秒预算报 `ETIMEDOUT`。它不是前次 ACL 超时或 `Microsoft/` 源码污染的重复证据；现有日志不能唯一归因于 helper 或内部存储检查。

审查发现矩阵全部目标使用预加载所有命令的 `src/index.js`，与 npm 清单的实际 `bin/chainlesschain.js` 入口不一致。`f61a1a548052ac971e9293f22294d25f6fddd9ac` 将 Local/WSL/Container/SSH 改用实际入口，并修正远程 supervisor 相对路径；采用实际 canonical 默认值与按需命令加载，保留原部署授权、隔离、干净源码门、100 轨迹及超时阈值。入口及 dispatcher 纳入 workflow 触发与产物哈希；同时补齐统一审计合同遗漏的 7 个既有 producer 文件，锁定完整 23 文件清单。

原生进程失败原先直接抛出含路径和 argv 的 `spawnSync` 错误。现将超时、输出越界、执行文件缺失和访问拒绝映射为固定类别，只保留经过白名单校验的源位置与 ACL 标记，不携带原始 cause、输出或参数；超时不重试，资源探针的超时也不能误当作资源限制成功。新增 7 项反例修复前失败、修复后通过。相关 8 文件共 138 项通过（含实际 npm 入口的 3 项 Chat 部署恢复验证）；ESLint、Prettier、actionlint、Bash/PowerShell 语法与 diff 检查通过。

干净 `f61a1a5480` 的 Windows 两轨迹真实隔离 smoke 退出 0，保存[回执](./cli/evidence/execution-location-local-windows-f61a1a5480.json)。9 个产物哈希独立复核；3 次恢复、断网拒绝、资源终止、失联/令牌轮换停放及结果回传通过，无静默 fallback、重复结算或孤儿进程。临时 wrapper 导入实际 npm 入口，断网通过重命名该 wrapper 注入；不算 100 条 CI，不宣称 Windows 托管超时已经解决。最终 SHA 的 CLI CI、Strict Sandbox 与 IDE/位置矩阵仍需完整通过；版本 staleness 继续随候选冻结处理。

### BRIDGE-01：Broker 启动后失败不能提前释放任务所有权（2026-09-28）

真实 Broker 的 `tool:start` bookkeeping 在 native spawn 后抛错时，异常附带 `spawnedProcess`、关闭观察 Promise 和终止请求标记。原 bridge 将全部同步异常直接视为未启动，发出完成并允许复用；Windows 真进程反例观察到 `ownedChild:true`、`closedAtSettlement:false`，说明已请求 kill 不等于实际关闭。

`40addcedf10407e37f57489689fe84b167ef6133` 区分未启动拒绝与已启动失败：接管异常中的 child，保留 RUNNING/任务占用与原始 admission 错误，安装 close/error 监听并沿现有 TERM/KILL 路径清理。仅实际 close 或 Broker `observed:true` 的关闭回执允许结算；重复 close、迟到 error、observer reject 与 `observed:false` 不形成第二次完成或伪造退出，原始失败仍返回 `EXTERNAL_AGENT_SPAWN_FAILED`。没有扩展生产 CLI backend 准入。

相关 4 文件 88 项通过，包括真实 Broker 的启动后失败集成测试，后者进入既有 CLI CI 三系统 integration 矩阵。干净提交的 Windows `windows-job-restricted-token` 与 WSL1 `linux-prlimit` 原生进程均观察到关闭先于任务结算；保存[四组本地探针回执](./cli/evidence/bridge-lifecycle-windows-wsl-40addcedf1.json)。ESLint 无新增错误（文件原有两个 unused catch warning）、Prettier 和 diff 检查通过。

独立取消探针保留另一个未解决反例：两个合成 Node 进程均安装 TERM handler，子进程关闭 stdio 但保留 IPC。Windows 父/子进程在 bridge 返回取消时均已退出；WSL1 的 `linux-prlimit` 后端只终止父进程，返回时后代 PID 103 仍存在，`/proc/103/stat` 状态为 `S`。夹具自带 15 秒生命周期上限，探针最终退出 1；不能将其计作取消通过或宣称 Linux 全进程树已收束。下一步需为该后端建立真实进程树所有权与退出证据，覆盖根先退出、后代忽略 TERM、重复取消和身份复用，不能仅依赖父进程 close。BRIDGE-01 继续局部完成。

### BRIDGE-01：保持进程组身份的监督器基础组件（2026-09-28）

`ebfec202c600c3280404b01a53bbbb8c7f62ab7f` 新增 Broker 底层 POSIX 生命周期组件。独立监督器持有存活的 detached 组长，原始目标退出后仍由该组长执行 TERM → KILL；父调用方通过私有 fd 3 控制，不在根退出后向可复用的数字 PID/PGID 发送延迟信号。目标不继承控制描述符，使用原始 argv 和环境；监督器不加载目标 `NODE_OPTIONS`。只读 `/proc` 或 macOS `ps` 检查组内可执行进程，不把未知探测结果、控制通道异常或直接子进程关闭当成确认；回执明确 `processTreeContained:false`。

干净提交的 [Windows / WSL 回执](./cli/evidence/owned-posix-group-windows-wsl-ebfec202c6.json)记录 WSL1 / Node 22.12.0 的 25 项通过，以及 Windows / Node 22.22.2 的 14 项通过、11 项 POSIX 真进程用例按平台跳过。实际覆盖原目标正常退出、响应 TERM 退出、父子均忽略 TERM、重复取消、直接 KILL、调用方控制通道丢失、启动失败和跨分块中文/emoji 参数。新增明确反例：后代通过 detached 新建会话后，原进程组已停止而该后代仍存活；夹具在 5 秒上限后自行退出并复核无可执行残留。这一用例证明能力边界，不能计作全树清理通过。

本次仅完成基础组件，**没有接入生产 Broker/bridge，也没有修复原 `linux-prlimit` bridge 反例**。后续接入必须保持原始命令的权限、凭据、沙箱计划与描述符检查，并让任务结算等待相应所有权关闭证据；`setsid` 逃逸、监督器异常退出和跨平台强后端仍需实现/验收。macOS 实机及最终准确 SHA 的三系统 CI 待收集，不增加准入、不升版本、不发布。进程调用清单重新生成，未修改审计豁免规则；ESLint、格式和清单一致性检查通过。

### BRIDGE-01：Linux subreaper 接管并回收新会话后代（2026-09-28）

`0f0bc7da2a541acdcb8a04863f6fc97a9c22e652` 新增原生 Linux subreaper 监督器及有界二进制启动/JSONL 回执协议。真实 WSL1 探针先确认 `PR_SET_CHILD_SUBREAPER` 有效，随后验证原父进程退出后，新会话后代会被接管。监督器只向当前直接子进程发送信号，读取子进程身份至发信号期间不执行 wait/reap，使退出中的 child PID 仍被保留；清理逐层接管的后代，只有原目标已回收且 `waitpid(-1, WNOHANG)` 返回 `ECHILD` 才确认零子进程。WSL1 不提供 `/proc/<pid>/task/<tid>/children`，该环境使用 `/proc/*/stat` 的父 PID 判断，保持同一身份不变量。

目标 argv/环境走私有 fd 3 的有界长度帧，目标不继承控制描述符；非可执行格式不退回 shell。监督器设置 `dumpable=0`，但尚未以真实 ptrace/句柄窃取攻击验收，不能替代完整沙箱。**外部强杀监督器仍可能留下后代**，实际反例会返回未确认；失联、缺失/重复/乱序/截断回执、非零或被信号终止的监督器均不能形成成功清理证据。生产准入未扩展。

干净提交的 [Linux subreaper 回执](./cli/evidence/linux-subreaper-windows-wsl-0f0bc7da2a.json)记录 WSL1 / Node 22.12.0 的 27 项通过，以及 Windows 的 14 项通过、13 项 Linux 真进程测试按平台跳过。原生 C 使用 `-Wall -Wextra -Werror` 和栈保护编译，报告记录 C 源码/可执行文件摘要及 8 条实际生命周期回执。覆盖忽略 TERM、根先正常退出/响应 TERM 退出、`setsid`、双重 fork、中间进程先由原父进程回收、重复/强制取消、失联和监督器被杀。正常清理确认时所有观测 PID 已消失；从 ready 到返回须小于 2 秒，不能等待夹具 5 秒自退出后冒充取消成功。双重 fork 的中间进程由 Node 父进程先回收，监督器实际回收的是根及被接管的叶进程，未将其错误计成三次 supervisor wait。

本次推进到**原生生命周期组件验证**，仍未接入生产 Broker/bridge，未解决安装分发和 helper 可执行身份/FD 绑定；原 bridge 的 Linux 残留问题仍开放。下一步保持既有命令权限、凭据和沙箱计划，接入可信 helper 与任务结算关闭证据；最终 SHA 的托管 Linux/架构矩阵及 macOS 后端继续验收。原 POSIX 进程组组件的逃逸反例仍成立，不能把它的回执自动升级为本原生实现的能力。

### Actions 后续复验：Linux ARM64 VS Code 双版本（2026-09-28）

`2c4fe5206393d02b8527c45f75846709e48a2cd1` 的 [Linux ARM64 VS Code 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36329903276/job/108656030091)已通过。下载 artifact `10936184083`，独立复核 stable `1.139.1` 和 minimum `1.85.2` 的 60 个文件、两个 evidence/bundle digest、同一 VSIX 摘要、初始/重启宿主 ARM64 身份及九个实际 DOM 旅程步骤，保存[回执](./ide/evidence/vscode-linux-arm64-2c4fe52063.json)。两版本均验证 stream、retry、plan approval、permission、interrupt、Workbench 调度/回复/产物、IDE 重启及 Workbench 恢复；真实主/伴随窗口同时监听，bridge token 和 workspace identity 不同，主窗口保留两个 workspace roots。

这两单元使用合成模型夹具，属于记录的旧修复提交；不替代最终 SHA，不扩展为真实 provider、完整 canonical replay/rewind/compaction 或真人可访问性验收。部分诊断日志按既有上限截断，回执保留该限制，已校验保存字节而非宣称完整日志。该 run 的五个 JetBrains 单元已通过，VS Code Windows/macOS 作业及 11 单元总验收在本次查询时仍未齐备。

### BRIDGE-01：可信 Linux helper 接入实际 Broker 与 bridge（2026-09-28）

`59ef6116e447adaeac1fa56b719df0170e08eaaa` 把 subreaper 接入实际 `ClaudeCodeAgent` → Broker → `linux-prlimit` 启动路径。先执行原命令权限、凭据、工作区和沙箱准入，再监督已经批准的 command/argv/env/cwd；已有强进程树后端继续使用其既有路径。生命周期回执不增加 `process-tree` 沙箱保证。拒绝不支持的 shell、detached、stdio、身份和异步控制选项，防止包装后默默改变原计划。真实参数/环境/目录回归与拒绝命令负例通过；另一个负例发现 prlimit 已把 `shell:true` 转换为显式 shell 命令，因而同时检查原始请求和转换后的选项。

helper 只从包内固定摘要的 C 源码构建，canonical LF 摘要为 `sha256:e920e24b4a79121484f2e8e97886755f88eaa1af93b55326dfa68c7a7f571424`。使用 root 所有且不可被普通用户写入的系统编译器、固定参数和干净环境；源码通过同一 FD 有界读取校验，再从 stdin 编译。构建目录通过继承 FD 绑定，产物校验 ELF/架构/权限/身份后 unlink，单次私有 lease 经 fd 4 启动同一镜像，不再打开可替换的可执行路径。缓存有界，验证失败、原生启动抛错和重复消费均有描述符释放回归；真实原生目标确认不继承 fd 3/4 等安装控制句柄。编译失败、源码漂移和错误 ELF 明确拒绝，不输出编译器原始诊断。

Broker-facing child 仅在监督器正常关闭且收到有效零子进程回执时发出目标 exit/close，保留目标退出码、信号和 exec 失败。Bridge 沿该关闭证据结算，启动后 bookkeeping 失败也等待后代清理；审计保留 lifecycle receipt 和真实目标 PID。取消宽限支持 Node 计时器的非负整数范围，不将调用方超过 5 秒的设置默默截断。

WSL1 真进程的 8 个生产路径场景通过：同组父子忽略 TERM、新会话后代、根正常先退出、根响应 TERM 退出、双重 fork、超时、后代启动后 bookkeeping 抛错、监督器被外部强杀。前 7 个场景确认回收，所有观测 PID 均消失；取消类从 ready 到结算须小于 2 秒，超时类小于 4 秒，不能借夹具 6 秒自退出冒充成功。第 8 个场景保留反例：后代仍执行时回执为 unconfirmed，Bridge 不发完成、不允许新任务复用，夹具随后自行退出。此进展验证原 bridge 的 Linux 正常取消残留修复，但不证明监督器死亡后的强制回收。

安装分发仍未完成：当前 Linux 主机需要可用的系统 C 编译器，预编译/无编译器安装与 Linux 架构矩阵待补；未确认清理后的有界失败展示、持久隔离及恢复也待实现。macOS、最终准确 SHA 的托管三系统和真实 provider 继续验收，生产 AgentRouter attestation gate 不变。BRIDGE-01 继续局部完成，不升版本、不发布。

相关 11 个文件的扩大回归：WSL1 480 项通过、9 项平台跳过；Windows 450 项通过、39 项平台跳过。覆盖 Broker 沙箱/工作区事务、helper 身份与 FD 生命周期、实际 bridge 树清理及既有 bridge 合同。ESLint 无新增错误（两个既有文件合计 10 个 unused warning）、Prettier 和进程调用清单一致性检查通过；本地结果不替代 GitHub Actions 的准确最终 SHA 发布门。

干净 `59ef6116e4` 的[独立回执](./cli/evidence/bridge-subreaper-windows-wsl-59ef6116e4.json)记录 WSL 142 项通过、Windows 103 项通过及 39 项 Linux 专属平台跳过，附 8 条实际 bridge 生命周期记录、源码/测试文件摘要和每条 helper 镜像摘要。7 条确认清理中，非超时场景 ready→结算最大 186.49 ms，超时场景为 1975.65 ms。最初的父子忽略 TERM 探针保持原夹具和断言，仅更换回执文件名/限制说明，在 Windows 和 WSL 原样复验均退出 0；任务返回时 `liveAtSettlement:[]`，旧失败回执保留。新 SHA 的 `CLI CI` run `36336971821` 和 `CLI Strict Sandbox` run `36336971698` 查询时仍在等待，不计作远端通过。

### BRIDGE-01：预编译 Linux helper 的 npm 分发与安装验证（2026-09-28）

`3385b2871dfaad491bddd539fea44308f09611dc` 新增 x64 / ARM64 的静态构建与受限 ELF 校验：固定 canonical C 源码摘要、原生架构编译、无动态加载器/动态段，并记录源码提交、架构、字节长度和二进制摘要。运行时从包内固定目录读取 manifest 与镜像，同 FD 有界读取并校验，再复制到私有目录、unlink 并沿原继承 FD 启动。目录和文件均禁止链接替换，目录 FD 绑定后再读取子项。只有完全没有预编译目录的源码开发环境可使用系统编译器；已安装目录缺失某个文件、内容损坏或身份不匹配均拒绝，不通过重新编译掩盖损坏。

`CLI CI` 新增原生 Linux x64 / ARM64 两个必需单元，复用同一构建工作流；每个单元先实际 `npm pack --ignore-scripts` 并解包，再在 `node:22.12.0-bookworm-slim`、无网络的容器中检查标准编译器路径确实不存在，针对解包目录运行 detached 后代取消/回收探针。探针还把任何运行时 compiler 调用设为失败。npm 发布在准确 SHA 门通过后运行相同矩阵，再下载两个准确 SHA 的产物，才允许打包。不可变 tarball 的创建与发布前复核均必须读到两种架构的有效静态镜像、匹配源码及 commit；缺 ARM64、旧 commit、坏镜像、源码漂移和伪造 attestation 均被拒绝，即使重新计算外层压缩包摘要也不能跳过内部检查。子 npm 包 → CLI → IDE 的发布次序不变。

本地原生 x64 静态构建成功，安装副本执行 detached 后代取消时编译器调用为 0。7 项真实安装回归验证正常回收、缺文件、损坏、源码漂移、坏 manifest、符号链接及验证后路径替换；后者仍执行已绑定的原镜像。46 项 Linux helper/Broker/bridge 集成回归通过，80 项 artifact/发布合同/协议单测通过；ESLint、Prettier、actionlint 和进程调用清单检查通过。

另外从实际项目执行 npm pack、解包后运行同一探针，确认 `files: ["src/"]` 会包含生成的静态 helper、manifest 及运行时模块，编译器调用仍为 0，实际后代回收通过。此次开发工作区探针标记 `sourceDirty:true`，不作为干净提交或发布资格；干净代码提交后另存回执。

本机 Docker daemon 未运行，本地证明的是安装加载路径不调用编译器，**尚未取得物理上无编译器容器或 ARM64 的实际通过结果**。新矩阵实现不等于该验收已完成，必须复核远端结果及对应产物。完整 CLI 首次公开安装、standalone native 打包分发、监督器丢失后的有界失败/持久隔离恢复、macOS 和最终三系统门仍待验收；本批未发布、未扩展外部 Agent 准入，BRIDGE-01 继续局部完成。

干净 `3385b2871d` 的[实际 npm 包回执](./cli/evidence/packaged-subreaper-wsl-3385b2871d.json)确认开始/结束源码干净，8,776,555 字节 tarball 的 SHA-256 为 `c914fbdd57a10ecc5163748c151278f7e619dda1c1d79be74009cc0cea117346`。独立重新读取压缩包中的 4 个运行时源码/C 文件、manifest 和 ELF，逐项核对源文件及镜像摘要；实际运行镜像摘要 `af72f1689be8bebaa6b8221103169144015dc86002dfec7b11c29f4e8c1ff66b` 与打包字节一致。ready 后 135.05 ms 完成取消和两进程回收，compiler 调用为 0，`compilerAbsent:false` 如实保留。此本地 tarball 只含 x64，按新的完整发布门不能发布；x64/ARM64 无编译器托管单元和最终 SHA 的 CI 继续等待。

### BRIDGE-01：监督器丢失的失败反馈与运行时执行阻断（2026-09-28）

监督器丢失后，Bridge 现在返回 `quarantined` / `EXTERNAL_AGENT_CLEANUP_UNCONFIRMED`，明确 `processOwnershipReleased:false`、`recoveryRequired:true`，不再让调用方永久等待。失败报告不代表进程关闭：保留 child、当前任务和池内占用，只发 `task:quarantined` / `agent:quarantined`，不发任务完成事件或伪造 terminal evidence。运行中、取消中、超时中及 native spawn 后 bookkeeping 失败四条路径均覆盖；收到迟到 close、重复错误或之后 PID 消失也不解除隔离。

池内故障会请求取消已启动的同批任务，各自仍等待原关闭证据；后续批次及重复 dispatch 返回未启动结果。每次尝试使用独立 agent ID，防止重复 task ID 覆盖保留的实例。同一 JS 运行时的所有 Broker 共享内存准入阻断，错误回调重入、新建 Broker、换 cwd、清空审计历史都不能恢复执行。spawn / spawnSync / PTY 及它们的 exec、execFile、fork 包装在原生调用前拒绝；Broker 的工作区新事务、恢复、restore/undo 入口也拒绝，诊断查询保持可读。既有工作区事务仍只接受真实 close 和原 process-tree 保证，本次没有复用 checkpoint-restore 专属恢复租约，也没有另造可释放的工作区锁。

扩大 10 文件回归：WSL 466 项通过、9 项平台跳过；Windows 467 项通过、8 项 Linux 场景跳过。覆盖原沙箱、工作区事务、AgentRouter 准入及 bridge 生命周期。真实 Linux 强杀监督器场景要求后代仍活着时在 ready 后 2 秒内返回失败，并验证没有 close、未释放句柄、新池执行被 Broker 拒绝；夹具自退出后仍保持隔离。ESLint 无新增错误或 warning（3 个既有文件共 11 个 unused warning），Prettier、diff 和进程调用清单检查通过。

此阻断仅在当前运行时内有效，诊断明确 `durable:false`、`restartSafe:false`，**重启不能当作已清理或安全恢复**。持久隔离、跨重启恢复、监督器死亡后的实际后代回收及其他平台仍未完成。原始报告快照、20 组任务统计与生产 AgentRouter attestation gate 保持不变；未升版本、未发布。用户链接的 Workspace Publish Staleness 仍需候选版本冻结时修正 SDK / VS Code 版本及下游依赖；最新托管 CI 仍在等待，不据此称 Actions 全部修复。

干净 `915653abfa` 的[独立回执](./cli/evidence/process-ownership-quarantine-windows-wsl-915653abfa.json)记录 Windows 117 项通过 / 8 项 Linux 跳过、WSL 125 项通过及 8 个真实进程场景。重新读取两个原始测试报告，并将 17 个源码/测试/清单文件逐项与该提交 Git blob 比较。监督器强杀后，仍有一个后代执行时在 ready 后 2.81 ms 返回 `quarantined`；没有 close、未释放句柄，Broker 继续阻断。回执 SHA-256 为 `f685a617531d30006836c5ee8c75ed7cb2dd5aafb7f3e864d628b1d616644fe9`。该验证不证明异常后代已被强制回收，也不扩展到持久恢复或最终托管矩阵。

### BRIDGE-01：Linux 启动前持久记录与跨运行时阻断（2026-09-28）

Linux subreaper 启动前现在先写入独立安全状态目录的有界 ownership journal，再进入 helper / native 启动。复用既有严格 `withFileLock` 与原子 security-store 写入、文件及目录 fsync；记录只保存 execution ID、owner PID 和随机 token，不保存提示词、命令、环境或工作区正文。目录/文件必须属于当前用户且权限私有，拒绝链接、硬链接、特殊文件、过大或损坏记录；读取与写入绑定已打开的目录 FD。通用写入器补上已有 FD 目录不重复 mkdir 的处理，修复 WSL1 对 `/proc/self/fd/N` 的 EPERM，原子替换和 fsync 要求不变。

只有确认尚未进入 native spawn 的前置失败，或真实 facade close（确认树清理 / 确认未创建 supervisor）才能结算记录。进入 native 后发生同步异常也保留记录；监督器丢失后撤销本进程的内存放行资格，记录跨 CLI 退出继续存在。PID 不存在、记录变旧、重启或改用另一个 `CHAINLESSCHAIN_HOME` 均不作为清理证据。关闭已确认但持久结算失败时，Bridge 如实返回“已执行但记录结算失败”，不错误标为未启动。

并发边界：本运行时的多个受监督任务仍可并行；共享安全状态目录的另一个 CLI 运行时只要读到未结算记录，就拒绝新的 Broker 执行，等待原运行时确认关闭。该保守限制也覆盖活跃 owner，没有用 PID 存活推断它仍拥有全部后代。当前没有跨运行时所有权移交或安全人工解除接口；`restartSafe:false` 继续保留。持久记录是协作型准入阻断，不是同 UID 沙箱，主动删除/迁移整个安全 anchor、直接绕过 Broker 写文件不在该保证内；既有工作区事务锁及 process-tree 保证没有放宽。

六个真实多进程场景通过：持久写入失败、helper 构建失败、native 入口前强杀 CLI、执行中强杀 CLI、强杀 supervisor、正常确认关闭。前三类启动前行为区分准确：写入失败不启动；helper 失败在未进入 native 时结算；CLI 在已持久化后突然死亡则保持阻断。新 CLI 使用另一 home 读取同一安全 anchor，三种崩溃场景均拒绝实际写文件命令，夹具进程全部消失后仍拒绝；正常清理后新 CLI 实际命令可执行。11 项 journal 单测覆盖本进程并行、同 PID 新实例、损坏/链接/权限/超限、删除、fsync 失败及目录替换；既有 17 项真实 Linux Broker/bridge 生命周期回归通过。

Windows 的 bridge 与四类信任存储回归共 146 项通过。WSL 扩大 10 文件回归为 501 通过、9 跳过、2 失败；两处为 `workspace-trust` 重定位身份和 `project-mcp-trust` 记录后身份变化。在独立的旧 `6971b97c98` 工作区重跑相同两个文件，得到相同 2 失败 / 9 通过，证明它们在本批之前存在；没有跳过或放宽断言，仍列为 PLATFORM / 工作区信任待修问题，不能将该扩大集写成全绿。ESLint 无新增 warning/error，进程调用清单一致。

该进展补上 Linux 进程重启后的准入记忆，尚不提供丢失 supervisor 后的实际树回收或可信恢复解除。其他平台、无编译器 x64/ARM64 托管单元、最终准确 SHA 的完整 CI 和两份原报告的其他验收继续开放；未升版本、未发布。

干净 `e106b753d8` 的[独立回执](./cli/evidence/durable-process-ownership-windows-wsl-e106b753d8.json)记录 Windows 54 项通过 / 33 项 Linux 专属跳过、WSL 87 项通过，附 6 条真实重启轨迹与 8 条 bridge 生命周期轨迹。独立重新读取原始报告、逐项比对 20 个源码/测试/清单文件和 Git blob；三种崩溃轨迹均保留 1 条 pending 记录，新运行时返回 `BROKER_PROCESS_OWNERSHIP_PENDING`，正常关闭或已证明未进入 native 的失败不留下错误占用。回执 SHA-256 为 `495ce92c3962112709a2fb19b2bd86e3e71c2c4d0e488d08e2814d9bce4ee6f6`。这组定向通过不覆盖前述两个 WSL 工作区信任失败，也不代替托管发布矩阵。

### PLATFORM / UX：WSL1 信任身份诊断与环境限制（2026-09-28）

在 WSL1 原生 `/tmp` 与 DrvFs 的独立 Git 夹具中，`statx` 均返回 `mask:0x7ff`，没有 `STATX_BTIME`。Node 22.12.0 的 `birthtimeNs` 与 `ctimeNs` 相同；创建子文件、移动目录后 dev / inode 不变，但时间戳和 canonical workspace ID 改变。只读源码与测试逐字节匹配 `e931170f51` 的 Git blob，原始探针与回归摘要见[诊断回执](./cli/evidence/workspace-trust-wsl1-diagnostic-e931170f51.json)。这说明 ctime 替代创建时间导致身份不稳定；不能通过删除 generation 或仅保留 dev / inode 来假定跨重启、inode 复用安全。

扩大三文件身份/MCP 回归：Windows 17 项通过；WSL 13 项通过、3 项失败，新增确认移动 Git 仓库后 MCP consent 丢失。Windows 额外含大小写身份场景，两个平台的用例数不同。插件与 Hooks 两文件在两平台均为 22 项通过，只有现有场景通过的结论，不代表所有目录变化均已覆盖。此前两个失败的旧提交对照仍有效；第三处失败本轮没有另做旧提交对照。WSL1 的稳定持久信任身份仍未修复。

现有 `doctor` 的 execution section 新增 WSL1 限制诊断，说明目录编辑/移动可能丢失授权，并建议使用原生 Windows CLI。它不执行修复命令、不删除授权、不修改身份算法，也不将 WSL2 或其他系统的未命中视为完整支持证明。内核读取异常只报告固定错误，避免泄露原始错误内容。新增六个场景中，两个缺少诊断的反例先失败；实现后四文件回归为 Windows 63 通过 / 3 平台跳过、WSL 66 通过。ESLint 无错误（保留既有六个 unused warning）、Prettier 和进程调用清单检查通过。

用户确认本机未开启虚拟化，Docker 暂时无法使用。本轮尝试启动的 Docker Desktop 和等待进程均已停止，不继续尝试本地容器，也不更改虚拟化设置。无编译器 x64 / ARM64 容器验收继续由托管 Actions 承担，当前没有新增通过回执。未升版本、未发布，20 组任务状态不变。

### Actions：旧提交积压与取消后仍排队的汇总任务（2026-09-28）

用户反馈最新 Actions 一直没有通过。核查发现同一分支大量旧提交任务仍在排队：首次快照为 168 个旧 PR run 排队及 6 个运行中；后续按 PR #383、来源仓库、分支和当前 head 的祖先关系筛选，锁定 173 个旧 PR run。根因之一是多项长矩阵按 commit SHA 分组且 `cancel-in-progress:false`，新提交不会替代旧提交；IDE Extensions、Android 等另有未设置 workflow 并发组的路径。

先使用普通取消 API：171 个旧 PR run 接受取消，2 个已在请求前结束；另取消 2 个旧 feature push 检查。复查发现部分 run 又停在下游汇总队列：例如 `36338473230` 的 Windows 单元已 cancelled，但 `Trusted Local/WSL/Container/SSH location aggregate` 仍 queued；`36339344861` 同样只剩 `SESSION-RUNTIME three-OS aggregate`。这些 job 的 `if: always()` 使其在 workflow 取消后继续排队，普通取消响应不代表整个 run 已结束。

对普通取消后仍活跃的 79 个旧 PR run、1 个旧 push run 使用 force-cancel，保留当前 head、手工验收、tag / 发布任务及其他分支。最后重新分页读取 queued / pending / in-progress，旧提交活跃数为 0，保留 `e931170f51` 的 40 个当前活跃 run。[清理及验证回执](./cli/evidence/pr-workflow-backlog-cleanup-2026-09-28.json)保存受保护提交、run ID、源码摘要与检查范围。该记录是本次清理时点，不代表后续新提交的 CI 通过。

修正 27 个 workflow 中的 25 项并发策略：同一 PR 按 PR 号替代旧检查，现有非 PR 分组和手工 / 发布取消规则保持原样；原先无并发策略的非 PR run 使用独立 run ID。Context Memory 同时为同一 `feature/*` 分支 push 增加替代，保留 main、tag 和手工运行。14 个 job 级汇总条件在取消的自动检查上停止；普通失败仍进入汇总、step 级产物上传保持原条件，手工验收的原条件不变。

使用 GitHub 官方 `@actions/expressions@0.3.61` 实际求值，272 个分组/隔离场景和 280 个汇总状态场景通过；逐个比较 YAML 数据，除并发策略及这些 job 的取消条件外，矩阵、权限、验证命令、超时、样本阈值与发布前置检查均未变化。27 个 workflow 的 actionlint / Prettier 通过，既有发布及 soak 合同 34 项通过。推送后仍需最终准确 SHA 的完整 CLI CI、Strict Sandbox 及 IDE 检查；源码已改但版本未递增的 publish-staleness 失败继续在候选冻结时处理，不能靠取消任务解除。

`71919bc5c1` 的 `CLI CI` [ARM64 helper 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36356096679/job/108724635955)已在托管 Linux 完成且成功。独立下载 smoke 与 helper 两份产物，核对静态 ELF、manifest、当前提交的 C 源码 Git blob，并重新运行[原始回执](./cli/evidence/linux-subreaper-arm64-no-compiler-hosted-71919bc5c1.json)的验证脚本；回执 SHA-256 为 `fe8f3c98ec8f4d4c8374b059c1364fef34c4551d14cdb7990ca8260cf146e9c2`。Node 22.12.0 / ARM64 无编译器，运行时 compiler 调用 0，两个观测进程已回收，ready 后约 123.33 ms；产物只上传了 tarball 摘要，未上传 tarball 字节，故不宣称已独立重读 tarball，也不宣称恶意进程树已隔离。对应 x64 helper 作业 `108724636035`、CLI CI 其余矩阵、CLI Strict Sandbox 与 IDE Extensions 此时仍排队，不具备发布资格。

再次检查准确提交的队列：当前 feature 分支旧提交的 queued / pending / in-progress 数为 0。仓库列表另显示 3 个 5 月或 8 月的旧 `main` run（`25907160592`、`25907303349`、`32212457155`）仍为 queued；普通取消 API 返回“已完成”，force-cancel 返回 HTTP 409（未排队或非进行中），与读取状态矛盾，不能声称已清理或它们实际占用 runner。当前提交的检查仍在排队，尚无完整矩阵失败结论；不因这些历史记录取消当前验收或重启排队作业。

随后同一 `CLI CI` 的 [x64 helper 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36356096679/job/108724636035)也完成且成功。独立下载其 smoke 与 helper 产物，按同一源码 Git blob 和严格静态 ELF 合同复核[原始回执](./cli/evidence/linux-subreaper-x64-no-compiler-hosted-71919bc5c1.json)，回执 SHA-256 为 `ff1d8b0219c63838ffd193ec397d03a299798d8cae987e4a14a383fad9bcc87e`。Node 22.12.0 / x64 无编译器，运行时 compiler 调用 0，两个观测进程已回收，ready 后约 123.99 ms；静态镜像 934,160 字节、SHA-256 `f162e55ad3f3f72f8a52e9d7f12b5b8db44506c2ca66a14d7d62d5cd4f12498e`。tarball 仍只上传了摘要而未上传字节，两个架构的单元成功不等于完整 CLI CI / CLI Strict Sandbox 或 IDE 发布门通过。

为补足独立包回读，复用工作流现在把 `npm pack` 产生的 tarball 移到固定路径，**同一份字节**用于解包、计算 SHA-256 和上传到架构 smoke artifact；下一轮托管任务完成后才能独立下载并重读新 tarball。发布依赖、两架构无编译器探针及完整矩阵门不变。发布 workflow 合同 23 项、actionlint、修改文件 Prettier 和 diff 检查通过；这是本地工作流验证，不把旧 SHA 的作业结果转移给新提交。

`982123680e` 推送后，旧 `71919bc5c1` 又留下 `CLI CI` 的 PM recovery 汇总及 Android Tests 的 Test Summary / Build Status Check 排队。4 个旧 run 的普通取消请求均接受；其中两条仍有 `always()` 汇总，补用 force-cancel 后才确认结束。再审计自动工作流的 job 级 `always()`，为 8 个 workflow 的 12 个汇总/构建/通知 job 增加取消条件：被取代的自动 PR/push 停止排队，普通测试失败仍进入汇总；手工精确 SHA 验收及原 schedule 汇总保持原准入，schedule 通知在显式取消后停止。发布/回滚专属 workflow 未改。GitHub 官方表达式求值器对最先复现的 3 个 job、18 个事件/取消组合通过；CLI 发布合同 23 项、根 CI 门合同 47 项和 8 个修改 workflow 的 actionlint 通过。新条件仍须由托管 Actions 在准确提交上验证，不能把旧 run 取消或本地合同通过写成发布门通过。

### PR #383 准确提交 CI 失败与下一版候选（2026-09-28）

`3e39a6b76ff56129480e87a374928a09c2587da4` 的所有任务结束后，GitHub 显示 14 个失败检查及 1 个取消任务，非旧提交队列造成。独立原因集中在：测试路径 mock 缺少机器安全锚目录；Windows session-index 夹具在设置 ACL 前记录文件 ctime；桌面 Vite 模块加载时非 `file:` URL 被 Linux subreaper helper 顶层解析；macOS VS Code managed multi-window 主进程在原生 runner 退出时重复触发 workbench quit/close；JetBrains Stop 后配置读取混合 stdout/stderr 且丢弃底层失败分类；Windows Local x100 因 90 分钟 job 预算只完成约 51 条轨迹。PM、ARM64 和执行位置汇总失败是这些上游任务的连带阻断。自动生成的 [#384](https://github.com/chainlesschain/chainlesschain/issues/384) 指向同一 Full Test Automation 运行，Linux/Windows 终端测试复现了非 `file:` URL 错误，不另算独立根因。

本批候选修正了上述源码、夹具和宿主退出路径；JetBrains 将 JSON stdout 与诊断 stderr 分离，改用专用读流线程，并只展示安全失败类别。Windows Local x100 的 50 个相邻轮次平均 101.61 秒，100 条约 169 分钟；独立一条真实轨迹约 66.20 秒，其中 ACL 与目标原生进程占 95.71%。没有删减样本或跳过安全校验，工作流 job 预算改为 210 分钟。JetBrains 旧日志丢弃了底层异常，因此其确切 macOS 触发分支仍需新提交的真实宿主复验。

候选版本按本次改动与 registry 核对为：`@chainlesschain/agent-protocol@0.1.12`、`@chainlesschain/agent-sdk@0.2.12`、`chainlesschain@0.166.78`、VS Code `0.37.119`、JetBrains `0.4.140`。14 个可发布 workspace 包逐一比对 npm registry，另外 11 个版本一致且本 PR 没有其源码变更；Agent Protocol 的 schema/generated 变化虽未被普通 `src/lib/bin` staleness lint 捕获，仍纳入子包发布。Python SDK 生成绑定也变化，但它属于独立 PyPI 轨道，不列入子 npm 包顺序。发布须先 Agent Protocol / Agent SDK 等需更新的子 npm 包，再 CLI，最后两个 IDE 插件；准确候选提交的 CLI CI 与 CLI Strict Sandbox 三系统完整矩阵、相关 IDE 宿主检查及公共包回读仍是未完成的发布门。

提交前本地证据：session-index 14/14、cloud-handoff 与 CLI 发布合同合计 47/47、桌面 ws-cli-loader 21/21、Agent Protocol 19/19、Agent SDK 83/83、VS Code runner/Marketplace 55/55、JetBrains Java 21 定向 23/23 通过；生成协议、vendored SDK 与 Marketplace 描述检查通过。以上不代表新 SHA Actions 已通过，本机 Docker 因虚拟化未开启仍不可用。
