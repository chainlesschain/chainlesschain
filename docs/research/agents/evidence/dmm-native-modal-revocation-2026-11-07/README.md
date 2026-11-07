# 真实原生确认期间的并发失效证据

产品验收候选：`4eab7782216dec8356e60574492fb18a5576c676`。草稿 [#547](https://github.com/chainlesschain/chainlesschain/pull/547) 依赖 #546。本批只修改验收脚本和 CI，生产授权、动作规则及公开版本保持不变；原完整计划继续进行。

## 实际场景与证据边界

动作从实际 Vue 按钮发起。Win32 驱动核对真实进程、原生窗口、标题、预期正文和按钮，在确认框仍打开时调用并发操作，核验变更后仍是同一可见 HWND，再发送真实原生按钮点击。没有替换 Electron dialog、审批结果、认证或 IPC 实现。

并发变更通过真实公开的 sandboxed preload / authenticated IPC 发起。**不把它说成在被模态框阻塞的父窗口点击暂停**；另一个人工 GUI 窗口、切换到不同 DID 和其他操作系统 GUI 仍未由这批证明。主进程诊断仅读取实际 actor DID 与认证代次。

| 动作     | 确认框打开后发生的变更           | 原生确认后的结果                                                         |
| -------- | -------------------------------- | ------------------------------------------------------------------------ |
| 创建任务 | 暂停目标                         | 原生 allow 记录保留，最终事务拒绝，ActionRun denied                      |
| 创建任务 | 撤销 `task.create`               | 原生 allow 记录保留，最终事务拒绝，ActionRun denied                      |
| 创建任务 | 真实注销、密码重新认证到同一 DID | 认证代次改变、目标版本不变；旧确认成为 `confirm-error`，ActionRun denied |
| 修改描述 | 暂停目标                         | 原生 allow 记录保留，最终事务拒绝，ActionRun denied                      |
| 修改描述 | 撤销 `task.update-description`   | 原生 allow 记录保留，最终事务拒绝，ActionRun denied                      |
| 修改描述 | 真实注销、密码重新认证到同一 DID | 认证代次改变、目标版本不变；旧确认成为 `confirm-error`，ActionRun denied |

六个回执分别绑定原意图、invocation/action 摘要及证据摘要；操作前后完整任务快照一致，没有 SQLite 创建/修改证据。每个场景后通过实际 Vue 刷新、恢复动作范围、暂停/恢复、开启和检查建立新版本。原逾期风险仍存在，目标不自动完成。

[干净候选本机报告](./local/candidate-passed/journey.json)共有 **11 次真实原生点击**，其中 6 次记录了变更前后的同一 HWND。前置正向风险创建、四类血缘、重放，后续记忆/通知、独立拒绝完成和真实 70 秒停止观察均通过。截图作为确认后的工作区记录，拒绝结果以授权回执及前后任务快照核验。

本机使用 Node 22.22.2 执行器、Electron 39.8.10 / embedded Node 22.22.1、cipher 12.11.1 和未改变生产源码的实际 main/preload/生产 Vue 构建。准确候选的 runner、模态 helper、native driver 和构建产物回读一致。应用日志、密码、密钥和加密 profile 留在私有临时目录，不进入归档。

## 原始失败和探索结果

| 报告目录                         | 源码状态            | 结果与处理                                                                                 |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `boot-exploratory-failed`        | `c869a27906`，dirty | 首窗前退出，没有模态场景或原生点击                                                         |
| `preparation-exploratory-failed` | `c869a27906`，dirty | 前置正向旅程通过，新测试错误地复用了已消费建议；用真实 Vue 暂停/恢复和新检查建立版本后修正 |
| `exploratory-passed`             | `c869a27906`，dirty | 六个真实模态场景与完整后续旅程通过，不重标为干净候选                                       |
| `boot-candidate-failed`          | `4eab778221`，clean | PID 27464，首窗前退出，0 原生点击；作为准确候选失败保留                                    |
| `candidate-passed`               | `4eab778221`，clean | 新 profile 的准确候选完整旅程通过                                                          |

两次启动失败的结束时间附近均有 Windows `AppHangB1` 事件，见[结构化观察](./local/startup-observations.json)。该事件仅按时间关联，不把 WER 1001 的信息冒充测试进程 PID 证明。原生加密 Graph [preflight](./local/encrypted-preflight.json)通过，构建产物与前批成功版本一致。**启动挂起根因未解决**；本批没有绕过初始化、改变依赖、延长超时或把重跑成功当作已修复启动问题。

`early-source` 保留早期实际脚本字节。`recovered-exploratory-source` 的 helper 从候选移除后加的两段断言恢复，并与探索报告运行时记录的摘要严格一致；恢复说明单列，不冒充当时已提交的源码。原始报告、截图和失败保持字节绑定，批次和重跑不累计。

## 准确候选 CI

准确候选的五组工作流全部终态 success：专用真实模态 [42312820280](https://github.com/chainlesschain/chainlesschain/actions/runs/42312820280)、三平台宿主 [42312820124](https://github.com/chainlesschain/chainlesschain/actions/runs/42312820124)、记忆/通知 [42312820037](https://github.com/chainlesschain/chainlesschain/actions/runs/42312820037)、基础目标 [42312820072](https://github.com/chainlesschain/chainlesschain/actions/runs/42312820072) 和默认关闭/风险创建 [42312820086](https://github.com/chainlesschain/chainlesschain/actions/runs/42312820086)。五份 GUI 报告源码干净，四份加密原生 preflight 通过；专用报告单列六个模态场景及 11 次真实原生点击。

三平台各自完整通过宿主 22 文件/424 项、个人 renderer 19/295、组织宿主 17/340 和组织 renderer 11/213；每平台去重后仍为 **61 文件/1,140 项，0 失败/跳过**。这批新增的是实际原生旅程场景，不增加 Vitest 用例计数，不与前批、历史批次或不同平台相加。原生移交代码没有改变，本批没有将父批移交 CI 重标为新候选结果。

## 复核

`manifest.json` 固定 91 份归档文件字节与 50 项候选源码摘要。原始报告保持原字节，恢复说明与诊断摘录单列。验证器读取 Git 中的准确快照，核对原生窗口时序、六个回执与证据摘要、前后任务快照、同 DID 的认证代次、正向旅程、停止时间、失败与远端终态。原始 JSON 和探索脚本受 `.gitattributes` / `.prettierignore` 保护。

```powershell
node docs/research/agents/evidence/dmm-native-modal-revocation-2026-11-07/verify-evidence.mjs
```

未发布、未合并。启动挂起、独立真实业务样本与成本/效果、其他平台/IDE/扩展 GUI、安装迁移/数据库降级回退、生产灰度和新源码发行门仍待完成。
