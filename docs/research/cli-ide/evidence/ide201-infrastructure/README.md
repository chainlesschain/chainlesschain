# IDE 0.37.186 / 0.4.201 依赖下载故障（2026-11-11）

准确源码 `674593a1bb21a68d33b56dc0cb6ed420212143a2` 的 ARM64 矩阵 11/11 通过，普通矩阵六个 JetBrains 原生宿主也通过。新 IDE 尚未发布；CLI 0.166.147 已完成独立的正式发布及公开回读。

| 工作流                                                                                                             | 第一次运行                                                                                             | 后续动作                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [IDE Extensions 43039428960](https://github.com/chainlesschain/chainlesschain/actions/runs/43039428960)            | 19 个作业中 12 成功、2 失败、5 跳过；Linux 浏览器和 Remote-SSH 在 Ubuntu apt 依赖安装阶段 DNS 解析失败 | 保留第一轮，原源码完整重跑 attempt 2，结果待完成       |
| [Accessibility/Performance 43039429101](https://github.com/chainlesschain/chainlesschain/actions/runs/43039429101) | Windows、macOS 成功；Linux 安装系统依赖失败，三系统汇总据此拒绝通过                                    | 为保持三平台证据来自同次运行，原源码完整重跑 attempt 2 |
| [通用桌面 E2E 43039429014](https://github.com/chainlesschain/chainlesschain/actions/runs/43039429014)              | Linux 初次及一次重跑均在 Playwright 系统依赖安装时遇到相同 DNS 故障                                    | 两次失败保留；未执行到产品 E2E 断言，不声明通过        |

[receipt.json](./receipt.json) 保存第一轮完整作业结论与重跑范围。Remote-SSH 制品 13868160853 原始 ZIP 共 2,236,570 字节，摘要为 `sha256:1be4620840d424cce559e983b6ad9d2001d355a866357e4b9c7585a1d1f75816`；此处保存两份原字节 JSON 成员，明确记录容器 apt-update 无法解析 Ubuntu 软件源，尚未进入真实 SSH 连接断言。

没有替换源包、切换 npm 发布方式、放宽检查或跳过 Linux。旧候选两次 Rewind 菜单失败及新源码成功记录见[焦点证据](../jetbrains201-focus/README.md)。本归档不执行模型任务，36+9 仍为 PREPARED_NOT_RUN。
