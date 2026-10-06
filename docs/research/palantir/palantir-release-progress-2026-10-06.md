# Palantir 改进配对发布进度

更新日期：2026-10-06。用户已授权直接提交主分支、推送 GitHub Actions，测试通过后按依赖顺序发布，并持续修复发布失败。

## 最新门禁状态

当前工作目录为 `main`，并行文档更新已提交。准确候选提交的全部发布门禁及 npm 正式 OIDC 发布已成功；三个子包和 CLI 已公开下载并核验完整性，IDE 标签发布正在运行。

最新发布候选：`28cff6adc82a4f358d785baada110e48884527ea`。

| 当前门禁                                  | 状态                     | Actions                                                                                                                                                                       |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security Audit                            | 已通过                   | [安全审计](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644385/job/112088668636)；原有三个阻塞项已修复                                                  |
| Code Quality & Security                   | 全部通过（9/9）          | [完整质量与安全检查](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644385)                                                                               |
| CLI CI                                    | 已通过（70 成功）        | [三平台完整矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644585)；三平台 SDK、Session Core、恢复验证及聚合门禁全部通过；PR 专用 dry-run 按条件跳过 |
| CLI Strict Sandbox                        | 已通过（5/5）            | [严格沙箱](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644409)                                                                                         |
| IDE Extensions                            | 已通过（18 成功）        | [宿主完整矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/37407686847)；全部宿主、构建和兼容性检查通过，标签发布专用市场核验按条件跳过                     |
| IDE Safety                                | 已通过                   | [安全矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644400)                                                                                         |
| macOS MCP Launcher                        | 已通过                   | [启动门禁](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644396)                                                                                         |
| PDH 原生完整测试                          | 三平台已通过             | 当前候选 Linux、Windows、macOS 均为 4482 项通过、0 失败；报告已下载核验                                                                                                       |
| Full Test Automation                      | 已通过                   | [完整自动化测试](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644417)；Linux、Windows 全套测试通过，失败创建 issue 步骤按条件跳过                       |
| E2E Tests                                 | 全部通过（4/4）          | [E2E](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644449)                                                                                              |
| CI Tests                                  | 全部通过（14/14）        | [CI Tests](https://github.com/chainlesschain/chainlesschain/actions/runs/37407644441)                                                                                         |
| SDK / PDH / Session Core → CLI → IDE 发布 | npm 成功；IDE 发布运行中 | [npm 正式发布](https://github.com/chainlesschain/chainlesschain/actions/runs/37413002340)；子包先发布并下载核验，CLI 公开核验后已推送两个 IDE 标签                            |
| VS Code / Open VSX 正式发布               | 运行中                   | [Open VSX 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/37414359683)                                                                                    |
| JetBrains 正式发布                        | 运行中                   | [JetBrains 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/37414370365)；上传和公开审核分别记录                                                           |

本轮又取消 11 个旧候选活动任务，另有一个在请求取消前已结束；剩余旧清理步骤已确认终态。保留当前候选、正式发布和其他分支任务，未删除历史记录。

再次核查全部 queued / in-progress 记录：除当前候选外，仅剩三条 5 月 / 8 月的历史异常记录 `32212457155`、`25907303349`、`25907160592`。普通取消和 force-cancel 均返回 HTTP 409（不在运行中或未进入队列）；两条无 job，另一条所有 job 的 runner_id / runner_name 均为空，没有实际占用 runner。未删除历史记录。

当前候选三平台 PDH 报告的提交身份均为 `28cff6adc82a4f358d785baada110e48884527ea`，Node `22.22.2` / ABI `127`，SQLCipher 驱动 `12.11.1`、普通 SQLite 驱动 `11.10.0` 均实际加载。每个平台 4482 项通过、0 失败，另有 125 项源码显式停用的历史 Evolution ingress 测试跳过（未计为通过）；跨包 20 项和新增派生恢复 35 项全部通过。原始报告保存在 `.work/palantir-release-evidence/28cff6ad/`。

可提交的三平台核验摘要：[PDH 当前候选证据](./evidence/palantir-release-pdh-28cff6ad-2026-10-06.json)。该证据仅确认 PDH 门禁，其他门禁由下述完整证据记录。

全部准确提交门禁和三平台子包测试结果另存：[完整发布前门禁证据](./evidence/palantir-release-gates-28cff6ad-2026-10-06.json)。三个平台 Core DB 均 85 项、Session Core 均 709 项、SDK 均 83 项全部通过且无跳过，SDK protocol:check 和构建成功。三个发布标签均已推送至上述候选 SHA。Session Core `0.3.15`、SDK `0.2.13`、PDH `0.4.63`、CLI `0.166.90` 均已公开下载，SRI 和包内版本核验通过；CLI 公开包精确锁定 Session Core `0.3.15` 和 PDH `0.4.63`。官方签名读回证据确认 CLI 来源为本次 npm 标签、上述提交和 OIDC 发布工作流，invalid / missing 均为 0。

[npm 正式发布与独立下载核验证据](./evidence/palantir-npm-release-28cff6ad-2026-10-06.json) 包含四个公开包的 SRI、归档大小、下载地址以及 CLI / SDK 绑定准确提交和发布标签的签名来源证明。

### Security Audit 依赖修复

用户指出的 [Security Audit](https://github.com/chainlesschain/chainlesschain/actions/runs/37405057910/job/112080724554) 和 [文档提交上的重复失败](https://github.com/chainlesschain/chainlesschain/actions/runs/37406700794/job/112085761252) 均由同一组依赖漏洞阻塞：`proxy-addr 2.0.7` 的 IP 信任漏洞，以及 Agent SDK 的 Vitest 3 带入 `tinypool 1.1.1` 的两项 RCE 漏洞；`vitest` 是后者的依赖链标记。

修复将 root 和 desktop 的 `proxy-addr` 锁定 `2.0.8`，Agent SDK 测试依赖改为 `Vitest ^4.1.11`，清除旧 Tinypool 依赖，更新三个锁文件和 vendored SDK 清单。SDK 公开清单发生变更，因此版本递增为 `0.2.13`，用户已要求也先发布此子包。CLI CI 新增 SDK 构建和全套测试的 Linux、Windows、macOS 门禁。本地 SDK 构建和 83 项全套测试通过，CI 完整性 51 项通过；没有扩大漏洞豁免，复查 JSON 中原来的三个阻塞项均消失。仅剩仓库既有 `decompress` critical 豁免，不能将本次结果描述为全部依赖零漏洞。最终安全和发布结果仍以修复提交的 Actions 为准。

安全修复已提交为 `01dad7e9ba`。Astra 随后在旧候选 CLI Ubuntu 单元分片中定位到一条过期契约断言：仍匹配修复前直接写 reporter 参数的命令。已同步为非空参数数组及调用，并保护 Windows 临时路径正规化；发布契约和 exact-SHA 门禁的 31 项测试通过。此次契约修复提交将作为新候选，旧候选活动任务按用户要求取消。

以下为上轮候选 `85181932ae178a537d409331e386ba882d47544f` 的测试证据，不能替代新安全修复提交的门禁。

| 检查                  | 状态          | 依据                                                                                                                                                                                 |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PDH Linux 原生测试    | 通过          | 4482 项通过、0 失败；两个 SQLite 驱动实际加载                                                                                                                                        |
| PDH macOS 原生测试    | 通过          | 4482 项通过、0 失败；Bash 3.2 修复已验证                                                                                                                                             |
| PDH Windows 原生测试  | 通过          | 4482 项通过、0 失败；Git Bash 临时路径修复已验证                                                                                                                                     |
| CLI 完整矩阵          | 运行 / 排队中 | [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/37405058068)；含 Session Core 三平台测试                                                                      |
| CLI Strict Sandbox    | 运行 / 排队中 | [严格沙箱](https://github.com/chainlesschain/chainlesschain/actions/runs/37405104768)                                                                                                |
| IDE 测试              | 运行 / 排队中 | [IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/37405110614)、[IDE Safety](https://github.com/chainlesschain/chainlesschain/actions/runs/37405116443) |
| macOS MCP Launcher    | 通过          | [发布门禁](https://github.com/chainlesschain/chainlesschain/actions/runs/37405057992)                                                                                                |
| 子包 → CLI → IDE 发布 | 待完整门禁    | 全部 npm 包使用 GitHub Actions OIDC；逐包下载核验后继续下游                                                                                                                          |

三平台 PDH 报告均已下载核验，原先隐式漏跑的 20 项跨包测试及新增 35 项派生恢复测试全部执行通过。每个平台另有 125 项源码显式停用的历史 Evolution ingress 测试跳过，未计为通过。当前排队任务未执行完毕，不计为通过；旧候选活动任务已取消。Astra 协助复核日志和排队情况，目前没有证据需要缩减矩阵或放宽门禁。

上一轮候选：`main@2f96e07a57d4ae80ec0c438fbbbb912f0649d37b`（因下述完整性断言修复而替代）。工作流：
[CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/37366164477)、
[Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/37366163952)、
[IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/37366189246)。
完整性断言修复 `50496cb9b0` 已直接推送 main。该轮 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/37404709208)、[Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/37404714522)、[IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/37404720763) 已启动；旧候选活动任务已取消。

该轮暴露 PDH helper 两个跨平台问题：macOS Bash 3.2 在 `set -u` 下展开空数组报 `VITEST_ARGS[@]: unbound variable`；Windows `mktemp` 返回反斜杠路径，`tar -C` 无法打开目录。最新修复将 Vitest 通用参数放入非空数组，并通过 `pwd -P` 将临时目录正规化为 Git Bash POSIX 路径。修复仍需重新绑定完整三平台测试；尚未发布本轮版本。

## 截图失败项排查与处理

| 检查                                   | 已核实原因 / 结果                                                        | 处理                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| CLI Strict Sandbox                     | 上轮重试后 5 项全部通过                                                  | 新修复提交仍需重新通过                                               |
| CLI Windows unit 14、integration 5 / 7 | hosted runner lost communication；steps 为空且无测试日志归档             | 作为基础设施失败重跑，不修改源码或放宽超时                           |
| CLI recovery 三平台聚合                | 上游平台未完成，聚合门禁正确失败                                         | 保持门禁，补齐上游                                                   |
| JetBrains Linux 2024.2                 | buildPlugin、两个 UI smoke 测试通过后 runner 收到 shutdown signal        | 同提交完整重跑，不能用局部通过发布                                   |
| Code Quality / Quality Gate            | rules-validation 未获 runner，结果 abandoned；Lint、Build、Database 通过 | 重跑上游与聚合                                                       |
| IDE P0-S safety gate                   | Linux 未获 runner；Windows、macOS 通过，聚合正确失败                     | 补跑 Linux 与聚合                                                    |
| Full Test Automation / Ubuntu          | CI 完整性测试仍预期 4 处 Node 配置；新增 PDH job 后实际为 5 处           | 更新数量为 5，继续强制每处 Node 22.22.2；51 项完整性测试通过、0 跳过 |

GitHub 官方 Actions 分配故障于 `2026-10-05T22:49:42Z` 报告已解决。本轮先重试已核实的基础设施失败，同时修复上述真实计数断言遗漏；完整发布结果仍以修复后的新提交矩阵为准。

| 阶段               | 目标版本 / 范围                            | 状态                                       | 验证依据                                                                   |
| ------------------ | ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------- |
| 功能实现           | 四批 Palantir 对照改进                     | 已提交                                     | 第四批 `9f28073673`；本地 330 项通过，历史证据保留                         |
| 子包核对           | PDH、Session Core、Agent SDK               | 已确认必须更新                             | 前两包实现更新；SDK 公开清单升级测试依赖，不能复用旧 npm 包字节            |
| 发布准备           | 版本、精确依赖、锁文件、变更说明           | 完成，已推送 main                          | `2c3e3ca851`；两个锁文件同步，CLI 锁定 PDH `0.4.63`、Session Core `0.3.15` |
| GitHub Actions     | CLI CI、CLI Strict Sandbox、IDE Extensions | 修复 PDH helper 跨平台兼容性后重启完整检查 | Bash 3.2 空数组和 Windows tar 路径问题已定位；须最新提交全部通过后发布     |
| Session Core       | `0.3.14` → `0.3.15`                        | OIDC 发布及公开下载核验成功                | 三平台 709 项全套测试均通过，包内版本和 SRI 已核验                         |
| Personal Data Hub  | `0.4.62` → `0.4.63`                        | OIDC 发布及公开下载核验成功                | 三平台 4482 项通过；两个 SQLite 驱动实际加载；包内版本和 SRI 已核验        |
| Agent SDK          | `0.2.12` → `0.2.13`                        | OIDC 发布及公开下载核验成功                | 三平台构建成功，83 项全套测试均通过；签名来源证明核验成功                  |
| CLI                | `0.166.89` → `0.166.90`                    | OIDC 发布及公开下载核验成功                | 子包字节比较、纯 npm 依赖安装、固定归档和签名来源证明全部通过              |
| VS Code / Open VSX | `0.37.134` → `0.37.135`                    | 正式标签发布运行中                         | CLI 已公开可用；标签绑定完整测试通过的准确提交                             |
| JetBrains          | `0.4.153`                                  | 正式标签发布运行中                         | CLI 已公开可用；不复用旧版本；上传与公开审核状态分别记录                   |

发布标签依次为 `v-npm-0-166-90`、`ide-vscode-v0.37.135`、`ide-jetbrains-v0.4.153`。npm 工作流先发布缺失的子包并核验公开归档，再发布 CLI。仅本地测试、部分矩阵或旧提交检查均不能满足发布条件。

本地发布准备检查：VS Code 单元测试 254 项通过；发布工作流契约和门禁 31 项通过；命令 manifest/help/completions、版本同步和包版本滞后检查通过。JetBrains smokeTest 1445 项、定向 JUnit 14 项通过，完整原生 IDE 验证以 Actions 为准。

首轮 Actions：

- [CLI CI 工作流解析失败](https://github.com/chainlesschain/chainlesschain/actions/runs/37363962753)
- [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/37363964482)
- [IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/37363964413)

第二轮候选 `3d234bd8841e3c582213fc6bf5337adcca67cb6d`（由下述布局修复替代）：

- [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/37364245400)
- [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/37364244876)
- [IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/37364278953)

已修复新增 PDH job 在 job 级 env 使用不支持的 `runner.temp` 上下文问题，移至 step env 后通过 actionlint 和 31 项门禁测试。GitHub 官方当前报告 [Actions runner 分配延迟](https://www.githubstatus.com/incidents/3q1yb5m7ltvb)，排队并非测试通过。

第二轮 Windows PDH 日志审计发现 20 项测试因缺少 CLI bin 和 Python bridge 被隐式跳过。已改为从准确提交归档完整候选源码，使用现有生产依赖安装器校验并安装 10 个本地子包，三平台显式安装 Python 3.12；报告强制检查这些 20 项测试与新增 35 项派生恢复测试均实际通过。

补齐布局后的本地独立环境验证：288 个文件通过，4482 项通过、0 失败，125 项源码显式停用的历史 Evolution ingress 测试保持跳过；本轮未将这些跳过计为通过。原缺失 20 项全部执行通过，两个 native 驱动均实际加载。该结果作为补充，发布仍等待新提交的三平台 Actions。

旧 IDE run `37364278953` 的失败注解为 “The job was not acquired by Runner of type hosted even after multiple attempts”，未执行测试。最新候选的能力清单检查已通过，后续宿主矩阵仍需完成。旧 JetBrains `0.4.152` 已上传成功，其市场核验同样因 runner 分配失败未执行；该版本不复用、不重复上传。

按用户要求清理过期队列：19 个旧候选任务已取消；3 条 5 月 / 8 月的旧记录虽然 API 显示 queued，取消接口却返回已完成或未排队，无法取消且未删除历史。当前候选与正式 JetBrains 发布任务保留。

当前 VS Code 配置的发布渠道为 Open VSX；Microsoft Marketplace 的 `VSCE_PAT` 未配置。JetBrains 作者签名密钥未配置，不能声称本次包已完成作者签名。JetBrains 上传完成后仍需以市场公开版本确认最终可用状态。

Android 终端 `USR_VERSION` 同步递增以避免将来更新 APK 时复用旧 CLI 解压缓存，本轮不包含 Android APK 发布。

实现进度与尚未完成的产品范围见[实施进度表](./palantir-gap-implementation-progress-2026-10-06.md)。本文件记录发布状态，历史功能验证证据不因版本号变更重写。
