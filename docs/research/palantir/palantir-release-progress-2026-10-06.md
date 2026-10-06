# Palantir 改进配对发布进度

更新日期：2026-10-06。用户已授权直接提交主分支、推送 GitHub Actions，测试通过后按依赖顺序发布，并持续修复发布失败。

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
| 子包核对           | PDH、Session Core                          | 已确认必须更新                             | 两包实现均不同于公开版本；其余子包无实现变更                               |
| 发布准备           | 版本、精确依赖、锁文件、变更说明           | 完成，已推送 main                          | `2c3e3ca851`；两个锁文件同步，CLI 锁定 PDH `0.4.63`、Session Core `0.3.15` |
| GitHub Actions     | CLI CI、CLI Strict Sandbox、IDE Extensions | 修复 PDH helper 跨平台兼容性后重启完整检查 | Bash 3.2 空数组和 Windows tar 路径问题已定位；须最新提交全部通过后发布     |
| Session Core       | `0.3.14` → `0.3.15`                        | 待门禁通过                                 | GitHub Actions OIDC 发布；公开包下载核验                                   |
| Personal Data Hub  | `0.4.62` → `0.4.63`                        | 待门禁通过                                 | 新增三平台完整 PDH 原生测试，声明的 SQLCipher 依赖必须实际加载             |
| CLI                | `0.166.89` → `0.166.90`                    | 待子包发布和核验                           | 精确依赖对齐、公开子包逐包校验后 OIDC 发布                                 |
| VS Code / Open VSX | `0.37.134` → `0.37.135`                    | 待 CLI 公开可用                            | 配对 CLI `0.166.90`；三平台 IDE 测试和发布工作流                           |
| JetBrains          | 候选 `0.4.153`                             | 待 CLI 公开可用                            | 旧 `0.4.152` 发布仍在进行，候选不复用其版本；上传与公开审核状态分别记录    |

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
