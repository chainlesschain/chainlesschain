# CLI .130：Goal 预算、证据绑定与后续主线边界

## 公开制品来源

| 渠道        | 公开版本     | 准确源码 / 回执                                                                                        |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| CLI         | `0.166.130`  | `f3015e799624b81af564aaaa1b7701c0a5c70e26`；完整三系统 CLI CI 72/72、Strict、OIDC 发布及独立回读通过。 |
| Open VSX    | `0.37.168`   | 同一 f301；公开 VSIX 字节与原发布回执一致，推荐 CLI `.130`。                                           |
| JetBrains   | `0.4.185`    | 同一 f301；更新 `1205656` 批准 / 列出 / 未隐藏，公开 ZIP 与原回执一致。                                |
| Kernel      | `0.1.10`     | 已公开 CLI `.130` 的依赖；主线 `0.1.11` 仍未发行。                                                     |
| PC / mobile | `v5.0.3.143` | 保留独立既有产品发行，不因 CLI / IDE 更新而增加客户端功能验收。                                        |

[原发布回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release130-public/publication.json)与[新回读](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release130-reconcile-2026-10-29/review.json)分别保留 OIDC / provenance 与公开元数据、字节摘要、准确 workflow 结果。Microsoft Marketplace 继续暂缓；原 [.129 设计](./release-runtime-update-2026-10-29.md)保留历史范围。

## 本版 Goal 运行时

模型 Goal 评审与作者请求共享 `IterationBudget`、费用用量、取消信号和输出上限；先预留调用，再结算可确认用量。未知用量、传输失败或持久化失败阻止完成和后续自动请求。

工具证据在执行和评审前后与当前工作区 / 产物摘要、文件身份绑定。外部改写、删除、同路径替换或不完整覆盖使原观察失效；模型返回成功也不能覆盖这一拒绝。公开 tarball 中三个 Goal 文件已与 f301 Git 字节逐一核对。

Git 范围不包含被忽略依赖 / 构建目录和外部环境；具体产物可由 `read_file` 绑定。读取有项数、字节与时间上限，超限不能截断后声称完整。没有跨进程排他锁，摘要也不证明产物语义质量。

## 后续主线能力

| 范围                | 主线已完成的限定工作                                                                      | 仍待完成                                                             |
| ------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 独立 Goal `verify:` | 冻结验收定义，要求本次外部断言回执                                                        | 真实任务误报率、跨平台后代与双 IDE 恢复；未发行。                    |
| Memory              | 查询取消 / bundle / 身份复查、recall revision 守卫及语义候选等待取消                      | 完整查询 SLO、真实语义质量、准确新提交三系统 CI；未发行。            |
| Memory 恢复         | 真正终止 writer 后，独立进程核对 supersede / purge / 幂等恢复；用量意图缺失提交保持待核对 | 仅 canonical 适配器的明确终止点，不是完整 CLI / IDE 或全部写入窗口。 |
| 临时 worktree       | 派发前拒绝无所有者的后台消费者；前台 callback 未结束时保留目录                            | 任意自 detach / daemon、完整后代树和崩溃恢复仍未完成；未发行。       |
| Terra               | Responses 能力、输入限制和缓存 TTL 计费合同修复                                           | 真实账号、端点、账单及官方字段自动更新；未发行。                     |

以上限定实现和本地回归不属于公开 f301。后续发行必须选择新的未占用版本，先发布变化的 Kernel 子包，再处理 CLI、IDE 和客户端；不能移动 `.130` 标签或将 e7 失败原型当成当前公开源码。

## 验收、取消与恢复边界

跨版本真实合格产物仍为 **34/45**，剩余 **11** 项。`.130` 发布与无模型回归没有增加真实交付通过数；原 `.129 verify-11` 派发仍 `REQUEST_UNRESOLVED`，只读核对，不重放。

取消信号不等于进程已退出；缺少费用或工具回执不证明副作用回滚。`NOT_PAID_READY / NOT_ADMITTED / HOLD` 保留。默认 `model:` 判定没有因未发布的独立 checker 而改变。

## 文档与部署

`docs/design/` 为设计权威源，两个 VitePress 站点使用同步副本。官网的数据只更新已核实的当前公开渠道，旧发行对象和客户端归档继续保留历史时间。源码同步、准确提交构建、线上部署 / 公网回读分别记账。

- [当前用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-29-130.html)
- [任务完成情况表](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-codex-claude-gap-review-2026-10-27.md)
