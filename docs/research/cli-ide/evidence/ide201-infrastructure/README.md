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

同源 [IDE](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798017)、[ARM64](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798113)、[无障碍](https://github.com/chainlesschain/chainlesschain/actions/runs/43061797894)、[构建/质量](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798091)、[E2E](https://github.com/chainlesschain/chainlesschain/actions/runs/43061797961) 和 [进程恢复](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798050) 仍待完整通过。新插件尚未发布；36+9 尚未执行。

## 2026-11-12 ARM64 ports 与 Windows 观测证据

中间源 `ca941473ad55f47956090787dac39cbbeafcb408` 的 HTTPS/stdin 交接已在托管环境执行成功，但 ARM64 后续 apt 访问 `ports.ubuntu.com` 时仍遇到 DNS 故障，最终耗尽原 15 分钟作业预算。当前源 `703b22e895bff2c0f40cd7f350aef0757dc3bdd5` 补齐第四个固定域名及完整权限交接/容器映射回归，未提高作业超时；[真实进程恢复矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798050) 的 Linux x64/ARM64 已 **2/2 通过**。该结果不替代仍待完成的完整 IDE/ARM64 门禁。

同一中间源的 Windows 无障碍 attempt 1 因初始 `Win32_Process` CIM 快照在原 **10 秒**限额内超时而失败；后续快照成功不补回初次缺失的观测。原始制品 13871913075 的 ZIP 摘要与四个原始 JSON 成员已绑定于回执；UI 断言和观测时限均未放宽。旧失败与当前新源验证分开记录，新版插件未发布，36+9 仍为 NOT_RUN。
