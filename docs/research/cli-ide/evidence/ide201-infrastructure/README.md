# IDE 0.37.186 / 0.4.201 依赖下载故障（2026-11-11）

准确源码 `674593a1bb21a68d33b56dc0cb6ed420212143a2` 的 ARM64 矩阵 11/11 通过，普通矩阵六个 JetBrains 原生宿主也通过。新 IDE 尚未发布；CLI 0.166.147 已完成独立的正式发布及公开回读。

| 工作流                                                                                                             | 第一次运行                                                                                             | 后续动作                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [IDE Extensions 43039428960](https://github.com/chainlesschain/chainlesschain/actions/runs/43039428960)            | 19 个作业中 12 成功、2 失败、5 跳过；Linux 浏览器和 Remote-SSH 在 Ubuntu apt 依赖安装阶段 DNS 解析失败 | attempt 2 的 Remote-SSH 同样失败，原始制品 13870310661 保留；后续由新提交验证替代 |
| [Accessibility/Performance 43039429101](https://github.com/chainlesschain/chainlesschain/actions/runs/43039429101) | Windows、macOS 成功；Linux 安装系统依赖失败，三系统汇总据此拒绝通过                                    | 原源码完整重跑 attempt 2，后被新提交验证替代；首轮失败保持原样                    |
| [通用桌面 E2E 43039429014](https://github.com/chainlesschain/chainlesschain/actions/runs/43039429014)              | Linux 初次及一次重跑均在 Playwright 系统依赖安装时遇到相同 DNS 故障                                    | 两次失败保留；未执行到产品 E2E 断言，不声明通过                                   |

[receipt.json](./receipt.json) 保存第一轮完整作业结论与重跑范围。Remote-SSH 制品 13868160853 原始 ZIP 共 2,236,570 字节，摘要为 `sha256:1be4620840d424cce559e983b6ad9d2001d355a866357e4b9c7585a1d1f75816`；此处保存两份原字节 JSON 成员，明确记录容器 apt-update 无法解析 Ubuntu 软件源，尚未进入真实 SSH 连接断言。

没有替换源包、切换 npm 发布方式、放宽检查或跳过 Linux。旧候选两次 Rewind 菜单失败及新源码成功记录见[焦点证据](../jetbrains201-focus/README.md)。本归档不执行模型任务，36+9 仍为 PREPARED_NOT_RUN。

## 2026-11-12 解析与权限交接修复

Remote-SSH 第二次失败制品 13870310661 共 2,236,598 字节，SHA-256 为 `aa1488919b8c4a5f64b2e41d5a17f79e71f00d8045347ea408162d4a48c88d4d`。此处另保存两份该 ZIP 的原始 JSON 成员；两次失败均未进入真实 SSH 连接断言。

首次 DNS 修正 `c1b8a72dc60c9253688f1cc8355351b94bd16d88` 的单元测试通过，但托管 Linux x64/ARM64 在提权 HTTPS 查询时超时。两份选定作业日志以连接器解码后的 UTF-8/LF 形式保留，不宣称是原始 HTTP 响应字节。日志支持超时结论，尚未单独证明代理环境丢失是完整根因。

当前修正 `703b22e895bff2c0f40cd7f350aef0757dc3bdd5` 使用正常 OS 解析；需要恢复时，由普通 runner 进程调用保留代理/CA 环境的 curl，通过经证书校验的 HTTPS 查询四个固定 Ubuntu 域名。固定 resolver 引导地址仅解决解析器自身的 DNS 依赖；Ubuntu 地址来自实际响应，不写死。仅有界且经过校验的 JSON 通过 stdin 交给提权进程写入宿主映射；容器通过明确的 `--add-host` 参数获取映射。Ubuntu 官方源、签名校验、TLS、原镜像摘要和 SSH host key 断言均保留。

本地定向测试 **53/53**、标准 VS Code 单元 **353/353**、工作流 YAML/格式检查及四个域名的真实只读 HTTPS 探针通过。[托管阶段观察](./hosted-bootstrap-observation.json) 还记录历史 ca941473a 源 Linux 的系统依赖安装、工作区依赖安装和真实 canvas 加载均成功；这些是部分阶段证据，不代表整个作业或发行矩阵已经完成。

当前源 `703b22e89` 的完整工作流结果分别记录，部分宿主通过不替代完整矩阵：

| 工作流                                                                                                | 当前结果                                           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798017)           | 完整通过：18 成功、1 项发布后按条件跳过            |
| [ARM64](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798113)                    | 完整 11/11 成功                                    |
| [无障碍与性能](https://github.com/chainlesschain/chainlesschain/actions/runs/43061797894)             | 4/4 成功                                           |
| [构建与质量](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798091)               | 完整通过：8 成功、2 项无关后端按条件跳过，共 10 项 |
| [桌面 E2E](https://github.com/chainlesschain/chainlesschain/actions/runs/43061797961)                 | 4/4 成功                                           |
| [Linux x64/ARM64 进程恢复](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798050) | 2/2 成功                                           |

Open VSX **0.37.186** 已公开并与官方 VSIX 逐字节核验，推荐 CLI **0.166.147**；JetBrains **0.4.201** 正式标签工作流仍在运行，尚未核验上传。36+9 尚未执行。完整门禁作业名单、原始无障碍汇总及历史失败保留在[回执](./receipt.json)。

补充门禁已完成：

| 工作流                                                                                     | 当前结果                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [通用 CI Tests](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798082) | 完整通过：14 成功、Full Test Suite 按条件跳过 1 项；三平台单元、CLI 全局安装及配置的构建检查通过 |

## 2026-11-12 ARM64 ports 与 Windows 观测证据

中间源 `ca941473ad55f47956090787dac39cbbeafcb408` 的 HTTPS/stdin 交接已在托管环境执行成功，但 ARM64 后续 apt 访问 `ports.ubuntu.com` 时仍遇到 DNS 故障，最终耗尽原 15 分钟作业预算。当前源 `703b22e895bff2c0f40cd7f350aef0757dc3bdd5` 补齐第四个固定域名及完整权限交接/容器映射回归，未提高作业超时；[真实进程恢复矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798050) 的 Linux x64/ARM64 已 **2/2 通过**。进程恢复、完整 IDE 和 ARM64 门禁各自按准确源记录，见上表。

同一中间源的 Windows 无障碍 attempt 1 因初始 `Win32_Process` CIM 快照在原 **10 秒**限额内超时而失败；后续快照成功不补回初次缺失的观测。原始制品 13871913075 的 ZIP 摘要与四个原始 JSON 成员已绑定于回执；UI 断言和观测时限均未放宽。旧失败与后续新源验证分开记录；正式渠道状态见上表及公开回读。

发行调度另保留[重复 CI 核对记录](./duplicate-ci-scheduling.json)：文档合并源 `58b0350ec` 与发行源 `703b22e89` 的 10 个产品、工作流及测试目录 Git 树完全一致，53 个变更均为文档。四项 `main` 推送产生的非发行重复验证已确认取消；准确源准入、正式标签发行及其他未完成检查分别保留。原 npm OIDC 发布方法保持不变。

## 合并后主分支的 Babel 上游发布窗口

后续主分支 `5044641ff` 的 [Full Test Automation 43083563555](https://github.com/chainlesschain/chainlesschain/actions/runs/43083563555) 首轮 Windows 成功；Linux 在 CLI 独立依赖安装阶段三次 ETARGET，尚未执行测试断言。最后错误时间为 2026-11-11 19:54:22.902 UTC；npm 官方记录显示 generator 7.29.14 在 19:53:05.027 发布并要求 parser/types ^7.29.14，parser 到 19:54:23.671、types 到 19:55:50.462 才发布。这是已观察到的上游先后发布窗口；不归因为工作树 HEAD 修正或产品断言失败。

已核对相关版本和 tarball 可访问，仅请求重跑失败作业，成功 Windows 作业不重跑。attempt 2 的依赖安装、完整测试及强制检查均成功，但随后测试结果上传步骤失败；作业日志接口读取超时，尚未断定上传失败的具体原因。工作流未确认成功，不将首轮或重跑的失败改为通过。详见 `main504-attempt2-upload-failure-observation.json` 的生成步骤观察。生成的官方 registry 元数据/HEAD 观察见 `main504-upstream-babel-observation.json`；`main504.upstream-babel.decoded.log.raw` 是连接器解码后选定的 UTF-8/LF 日志片段，不是原始 HTTP 响应字节。此前发行源 `703b22e89` 的完整成功结果保留各自源码范围。
