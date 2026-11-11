# JetBrains Windows ARM64 Rewind 菜单关闭（2026-11-11）

CLI 0.166.147 已公开；配套 IDE 仍等待完整门禁。旧候选源码 `c3ac7485b2e671864acc52da1fa36fa13ad134fa` 的主 IDE 矩阵通过，但 [ARM64 运行 42976178479](https://github.com/chainlesschain/chainlesschain/actions/runs/42976178479) 的两次 Windows 2026.2.0.1 原生执行保留为失败：

| Attempt | 实际观察                                                                                              | 产物        |
| ------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| 1       | `Branch from here` 前的 actions 菜单已显示，约 94.4ms 后关闭，未观察到 chosen 回调。                  | 13836700943 |
| 2       | 相同源码和断言；`Restore conversation` 前的 timeline 菜单显示约 11.0ms 后关闭，未观察到 chosen 回调。 | 13864445789 |

两次事件记录均显示菜单创建时焦点仍在编辑器。该观察支持排查原生焦点恢复与菜单生命周期的竞争，但不单独证明其全部根因。没有把重跑失败改写为通过，也没有从这份失败矩阵发布插件。

[receipt.json](./receipt.json) 保存原始 ZIP 摘要、八份原始成员摘要、菜单代次与时间，以及修正源码的三份 Git 绑定。两份截图、两份宿主事件 JSONL、两份原始失败 XML 和两份旅程报告保留原字节；`.raw` 避免格式化重写。数据来自合成宿主测试，没有真实模型请求。

[PR #605](https://github.com/chainlesschain/chainlesschain/pull/605) 的准确源码 `674593a1bb21a68d33b56dc0cb6ed420212143a2` 将显示安排为：当前 UI dispatch 结束 → 实际 `IdeFocusManager` 焦点稳定 → 下一次 UI dispatch。各边界重新核对原会话、面板显示及非运行状态，失效后不再请求焦点或打开菜单。原菜单归属、确认、动作与预算断言没有改变。

新增 JDK21/JUnit5 五项测试通过，涵盖同步/异步焦点回调及三个阶段的上下文失效。两份变更生产源码也通过真实缓存 IntelliJ 2024.2 SDK 编译，依赖原公开 0.4.200 配套类；这不是完整插件构建或 GUI 验收。本地标准 Gradle 因已有回环 daemon 连接问题失败，未调整防火墙或构建门禁。

焦点修正源 `674593a1b` 的 Windows ARM64 2026.2.0.1 原生任务已通过（run 43039429061，job 130596694778，attempt 1）。制品 13868105187 的 ZIP 摘要为 `sha256:dda9edce950b1bb87adc7977b0d3fe169d3ca03b215a924072695d63ee535228`，共 1,897,928 字节；下载后核对旅程所列 55 份制品绑定。初次宿主事件记录的 12 次菜单显示均有 chosen 回调，原生测试失败、错误、跳过均为 0。另保留四份成功原始成员；旧源码两次失败保持原样。该任务使用确定性 CLI 夹具，没有真实模型调用。

焦点源码 `674593a1b` 的 [ARM64](https://github.com/chainlesschain/chainlesschain/actions/runs/43039429061) 完整矩阵已 11/11 通过，三系统 11 个实际宿主单元均有汇总绑定；原始汇总保存在 `success.arm64-aggregate.json.raw`。普通矩阵六个 JetBrains 原生宿主也已通过；[IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/43039428960) 的 Linux 浏览器/Remote-SSH 因依赖下载 DNS 故障失败，attempt 2 的 Remote-SSH 也失败，原始回执保留。

2026-11-12 发行准确源为 `703b22e895bff2c0f40cd7f350aef0757dc3bdd5`。该源自身的 [IDE](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798017)完整门禁为 18 成功、1 项发布后条件跳过，[ARM64](https://github.com/chainlesschain/chainlesschain/actions/runs/43061798113)完整矩阵 **11/11 通过**。Windows ARM64 的 55 项绑定及 12/12 菜单选择回调已核对，四份 `703.success.*.raw` 原始成员和原始 ARM64 汇总保留。三份焦点源码 Git 字节与焦点修正源一致；Open VSX 0.37.186：已公开并核验；JetBrains 0.4.201：官方发行中，公开回读未完成。
