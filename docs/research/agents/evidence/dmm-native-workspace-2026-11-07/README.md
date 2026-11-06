# Windows 目标记忆与通知组合旅程（2026-11-07）

本批完成 DMM-05/06 的 Windows 合成记忆/通知组合 GUI 工程验收。准确提交 `8ecb5bcfbc0ca4e16a9154c14121a266696781fb` 的组合工作区、基础目标、原生移交及三平台宿主四组远端工作流全部成功，三个 GUI 报告的 `sourceStatus` 均为空。新增 `--workspace` 通过实际 Vue 控件、真实登录与加密库完成操作，不替换 IPC、Kernel、通知投影、审批或时钟。未完成独立业务或已安装客户端验收。

## 已复现并修复的边界

- [首轮失败](./failures/review-binding.json)：自动巡检与手动检查可生成不同的合法 review。运行器错误地把实际 UI 提议执行结果归到最先读取的 review。提议的当前观察也可继续推进，因此后续按已准备 intent 的不可变 reviewId、完整公开 review 的计算摘要、目标历史、同一 ActionRun 及四类证据核对；不跳过血缘检查。
- [第二轮失败](./failures/memory-clone.json)：真实记忆保存没有到达主进程，界面停在结果待核对，目标没有新增记忆引用。Vue ref 内的请求对象不能跨 Electron 原生序列化。组件现在把仅含标量字段的请求复制为普通对象，保留原 requestId、目标版本和原记忆版本。
- [记忆克隆回归修复前](./dmm-memory-clone-before.json)：模拟 API 现先经过 V8 原生序列化；19 项通过、1 项失败，复现普通函数替身遗漏的问题。[完整 renderer 修复后](./dmm-workspace-renderer-after.json)为 19 文件/292 项通过，0 失败/跳过。
- [通知 wrapper 修复前](./dmm-notification-wrapper-before.json)：30 项通过、2 项失败。生产 `DatabaseManager.getDatabase()` 返回真实 `SQLCipherWrapper`，旧通知 IPC 没有取得原生事务连接。现在复用已有严格解析器，只取已打开的原生连接，并在输出和确认期间重验连接身份。[通知专项修复后](./dmm-notification-wrapper-after.json)为 2 文件/44 项通过，包含关闭不复活和同 wrapper 连接替换后回滚。
- [实际重复抽屉](./failures/duplicate-cached-drawers.json)：记忆全部通过、通知已读持久化、点击跳转后，旧缓存项目页也响应共享路由，出现两个目标通知抽屉。[真实 KeepAlive/Teleport 回归修复前](./dmm-notice-keepalive-before.json)为 22 通过、1 失败，同样观察到两个抽屉。修复在缓存页停用时隐藏抽屉、清除旧 review 并丢弃迟到读取，重新激活后重新授权。[最新完整 renderer](./dmm-workspace-renderer-keepalive.json)为 19 文件/293 项通过，0 失败/跳过。

测试维护失败也保留：[原生按钮就绪](./failures/dialog-readiness.json)、[提议观察继续推进](./failures/mutable-proposal-review.json)、[运行器误读不存在的 review 摘要字段](./failures/review-schema-assumption.json)、[项目任务抽屉遮罩](./failures/drawer-mask.json)及[Ant Design 中文按钮可访问名称空格](./failures/refresh-accessible-name.json)。驱动现在等待唯一可见且启用的原生按钮及实际关闭，沿真实抽屉关闭/打开流程操作，并兼容“刷 新”的可访问名称。未选择任意一个重复抽屉、绕过遮罩或强制点击。

前两份及多数后续本机探索报告来自带未提交改动的工作树，`sourceSha` 是当时基线；准确状态以各自 `sourceStatus` 和摘要为准。原生按钮失败报告绑定干净的 `5dedd6ddc3`，但仍是失败。原始 JSON、截图及已有补丁/摘要保留，没有把探索报告改绑新源码，不能将这些失败或局部通过称为组合旅程验收成功。

[完整宿主首次沙箱运行](./dmm-workspace-host-after.json)为 372 通过、33 失败，涉及真实 loopback 与 Windows ACL 所需本机权限，未计为通过。[使用所需权限重跑](./dmm-workspace-host-native-permissions.json)为 21 文件/405 项通过，0 失败/跳过；通知专项是其子集，不相加。main 与完整生产 renderer 重建通过；[本机完整组合旅程](./local-workspace/journey.json)退出 0，包括真实 70 秒停止观察。本机报告的工作树状态仅含本文档证据变化；[构建产物与源码回读](./local-workspace/source-readback.json)核对启动时产物摘要、运行器/helper/原生驱动与提交一致，实际复制的通知模块与源码一致。远端干净源码门禁单独列于下表。

## 准确提交远端证据

`5dedd6ddc3c3b65edeb0022cabbd4b7c78f484f1` 的原始制品见 [ci-5ded](./ci-5ded/)：

| 工作流                                                                                              | 终态与范围                                                                              |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [宿主 42296760094](https://github.com/chainlesschain/chainlesschain/actions/runs/42296760094)       | 三平台全部 success；每平台排除重叠后 52 文件/957 项通过，0 失败/跳过。                  |
| [目标 42296760332](https://github.com/chainlesschain/chainlesschain/actions/runs/42296760332)       | success；真实原生动作、血缘、独立拒绝完成及 70 秒停止观察。                             |
| [移交 42296760365](https://github.com/chainlesschain/chainlesschain/actions/runs/42296760365)       | success；签名恢复/重导与实际 UI 修订后拒绝回退。                                        |
| [组合工作区 42296760521](https://github.com/chainlesschain/chainlesschain/actions/runs/42296760521) | failure；报告源码干净，全部记忆操作通过，任务抽屉遮罩阻止通知按钮点击；不计为完整成功。 |

最终候选 `8ecb5bcfbc0ca4e16a9154c14121a266696781fb` 增加缓存页停用修复与运行器修正，草稿 [#544](https://github.com/chainlesschain/chainlesschain/pull/544) 依赖 #543。

| 最终候选工作流                                                                                      | 终态与原始证据                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [组合工作区 42299509463](https://github.com/chainlesschain/chainlesschain/actions/runs/42299509463) | success；[干净源码完整旅程](./ci-8ec/workspace/dmm-native-goal-workspace/journey.json)、两张组合截图、真实加密预检。                                                |
| [基础目标 42299509428](https://github.com/chainlesschain/chainlesschain/actions/runs/42299509428)   | success；[完整旅程](./ci-8ec/goal/dmm-native-goal-journey/journey.json)与真实 70 秒停止观察。                                                                       |
| [原生移交 42299509420](https://github.com/chainlesschain/chainlesschain/actions/runs/42299509420)   | success；[完整旅程](./ci-8ec/transfer/dmm-native-goal-transfer/journey.json)、22 份原生业务窗口回执、2 个选择器探针、9 次 CLI 命令；签名恢复/重导与修订后拒绝回退。 |
| [三平台宿主 42299509555](https://github.com/chainlesschain/chainlesschain/actions/runs/42299509555) | Linux、Windows、macOS 全 success；[原始报告](./ci-8ec/host/)每平台去重后 **52 文件/958 项通过，0 失败/跳过**：桌面 21/405、renderer 19/293、组织排除重叠后 12/260。 |

上述成功绑定最终候选本身，不借用 5ded 或 cb6。三个平台、历史批次、本地与远端重跑、两次 70 秒观察及重叠测试均不相加。所有终态、步骤和 GitHub 制品身份摘要保留于 [ci-8ec/runs](./ci-8ec/runs/)；本批不是完整 CLI CI / Strict Sandbox 发行许可。

## 证据校验

```powershell
node docs/research/agents/evidence/dmm-native-workspace-2026-11-07/verify-evidence.mjs
```

`manifest.json` 保存原始证据摘要及按提交分组的源码摘要。校验器使用 `git show <原提交>:<路径>`，不把旧报告改绑新工作树；分别核验失败/通过数量、干净源码的远端组合报告、记忆生命周期、不可变 review 摘要与四类血缘、通知结果、真实停止时间及每个平台的去重数量。它不重新运行应用，也不将旧失败或本地证据变化当成发行批准。

## 场景范围

组合场景已验证明确保存与分类、修正生成 successor、旧正文不可再读、撤权清屏、取消删除与二次确认删除、无正文的持久操作历史；真实通知中心已读、授权目标深链接与唯一抽屉、同风险去重且不重置已读、静默下检查继续，以及命名时区/跨午夜设置持久化。风险仍在时独立验收不完成目标，结束后跨真实 70 秒无新增检查。

免打扰本轮只验证设置保存与回读，不能证明实际跨夜投递。删除证明权威拒绝读取及在线 Kernel 逻辑清理，不证明 SQLite WAL、备份或此前导出文件的物理擦除。仍需其他平台/IDE/扩展组合 GUI、独立业务效果、安装升级/整体数据库迁移回退、生产观察和准确提交发行门禁。没有版本提升或发布；原始应用日志、凭据、密钥和数据库不公开。
