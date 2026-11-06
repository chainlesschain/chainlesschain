# 独立在线创建任务草稿：完成情况

日期：2026-11-06。基线 `09843429a4`，分支 `feature/dmm-native-task-create-20261106` 的未提交组合工作树。在同日内置创建、CLI 文件和 IDE 文件入口之上继续；前批证据保留，各批测试有重叠，不相加。

| 交付项             | 当前完成情况        | 验证或剩余边界                                                                                                        |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| CLI 创建在线入口   | 本地完成            | `draft-create-access/sources/send/receipt`；真实插件发现、信任与能力同意；逐操作激活                                  |
| 桌面独立授权       | 本地完成            | 原生 picker 选择创建 access 文件，单独确认导出 v6；renderer 仅提交目标引用和 profile                                  |
| 端点与权限隔离     | 本地验证完成        | v6 `goal.create-drafts`、`/goal-create-drafts` 和独立 MAC 域；旧 v3 说明 access/连接/授权不扩权                       |
| 待审与实际创建     | 本地集成通过        | 两个样例插件经真实 HTTP/SQLite 保存 pending；原生预览、逐次确认后才创建唯一 pending 任务                              |
| 持久引用与恢复     | 本地验证完成        | 先写无正文/凭据引用；回包丢失、HTTP 状态篡改后查原回执；已有引用含 `not-found` 均不自动重发                           |
| 类型与撤权         | 本地验证完成        | taskType 绑定；同请求跨动作冲突；独立授权计数与撤权；断连/重开保留，终态回执不二次创建                                |
| CLI/共享核心回归   | 14 文件、265 项通过 | [cli-tests.json](./cli-tests.json)，含旧说明、引用、创建文件、组合包生命周期与进程恢复                                |
| 桌面主进程回归     | 5 文件、85 项通过   | [desktop-tests.json](./desktop-tests.json)，真实 Windows ACL、HTTP、SQLite；窗口/身份/确认结果为替身                  |
| Vue 控件回归       | 2 文件、15 项通过   | [renderer-tests.json](./renderer-tests.json)，独立创建按钮、创建类型展示、只传原生保存 ID                             |
| 本批合计           | 21 文件、365 项通过 | 0 失败、0 跳过；不包含初次失败、中间复测、制品或历史批次                                                              |
| 本地制品与静态检查 | 单独记录            | [制品字节及公共导出](./artifacts.json)、[检查](./checks.json)、[来源/命令](./summary.json)；不代表完整隔离 CLI 安装   |
| 剩余工作           | 未闭环              | IDE 在线创建、模型/Memory 输出授权 adapter、真实 Electron/IDE GUI、独立业务样本、准确提交全平台发行门、灰度与迁移回退 |

创建 access schema 为 `chainlesschain.goal-create-draft-access/v1`，descriptor 为 `chainlesschain.project-goal-connection/v6`，持久 grant 为 `chainlesschain.goal-external-create-grant/v1` 并包含 `type: task.create`。身份哈希增加动作类型，原说明记录 shape、grant ID 和 MAC 域不变。独立 v6 请求/响应 MAC 绑定请求字节、nonce、端点和响应状态。15 分钟、512 次/nonce、16 KiB 报文及当前窗口/导航/actor/目标版本/授权检查继续适用。

CLI durable reference 继续使用原无正文合同；不同 grant 身份和 proposal 摘要绑定动作与类型。恢复只查原引用，不把 `not-found` 当成重新提交的许可。创建连接只允许 pending 保存，不提供 prepare/approve/execute 远程操作。实际创建仍须桌面当前预览与逐次原生确认；成功不证明任务已执行、风险已解决或目标达成。

两个真实声明包 `goal-task-creator` 与 `project-delivery-assistant` 0.3.0 完成准入到 HTTP/SQLite/预览/确认旅程。断连/数据库重开后继续原草稿、独立说明/创建撤权、原生同意提示、混合 profile/文件替换拒绝和终态不二次创建均有覆盖。丢失响应与替换状态的传输故障注入使用真实本机 HTTP，CLI 的引用重试另用连接替身验证；不宣称整个 CLI 子进程在线创建崩溃旅程已运行。已有共享创建转换的真实 Node 进程退出回归也包含在 CLI 报告中。

| 运行边界 | 实际执行                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 环境     | Windows x64，Node 22.22.2 / npm 10.9.7 / Vitest 4.1.10；better-sqlite3 12.11.1 / Koffi 2.16.3                                     |
| ACL      | 初次沙箱父路径检查被阻止；获准在沙箱外对隔离临时合成数据执行最终主进程回归，未替换或放宽 ACL                                      |
| 替身     | Electron 窗口/身份/原生确认结果、Vue IPC；业务数据为合成个人项目                                                                  |
| IDE      | 本批未接在线创建；两端先前创建文件入口保留，在线控件仍只用于说明                                                                  |
| 发行     | 未提交/发布，公开 CLI 0.166.142 / Core 0.3.25 / VS Code 0.37.178 / JetBrains 0.4.195 未提升；包同版本号不代表公开包包含工作树内容 |

[verify-artifacts.py](./verify-artifacts.py) 对本地 CLI/Core tarball 逐字节核对指定实现、帮助和 README，并在临时解包目录核验 Core 公共 CJS/ESM 导出。[verify.cjs](./verify.cjs) 检查格式、语法和生成元数据，并从最终报告生成摘要及源码 SHA-256 快照。这些检查独立于 365 项测试，不作为公开发行门禁；发行仍需准确候选提交三平台 Actions 和 OIDC，并遵守子包→CLI→IDE→客户端顺序。
