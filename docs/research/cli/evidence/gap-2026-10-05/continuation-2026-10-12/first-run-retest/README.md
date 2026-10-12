# 2026-10-12 公开 CLI 0.166.98 首次旅程实际复测

[GitHub Actions run 38198687103](https://github.com/chainlesschain/chainlesschain/actions/runs/38198687103) / attempt 1 已实际完成，执行源码 e5b58f18ff826460a268f25127215c9e2d39177c，公开发行源码 e0d4e9caaa0ce6a6145c0d5b66a53b9559e154c9，最终 completed/failure。保持原 verify-04 提示、冻结项目、20 轮上限与 $0.25 工具估算停止线；没有修改冻结题目或增加正式样本。

| 阶段         | 结果                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| install      | 通过，公开包来源核验完成                                                        |
| configure    | 通过，隔离配置未持久化凭据                                                      |
| authenticate | 通过；usage 89 input / 58 output，估算 USD 0.0000287                            |
| tool         | 失败；实际进程达到 480 秒期限后 SIGKILL，缺少完整终态；候选文件 0 字节          |
| artifact     | 失败；原基线与四项语义结果分别保留，候选断言未执行时 outcome 为 not-established |

实际主模型 usage 19 条，另有 1 条 semantic-compaction；不能写成 20 轮耗尽。工具/完整旅程估算与实际账单均未知，缺终态和价目核对不按零计费；认证估算不是完整账单或硬额度证明。

只读轨迹确认两个工程缺口：使用 query 而缺 required pattern 的 search_files 被旧代码转成空搜索，返回 node_modules 路径；两次 read_file 暂停拒绝没有对应 tool_use 请求声明。对应工程补强在 PR #431 单独验证，不能回填本次模型任务成功。语义压缩约 137 秒，usage output=13975，而实际压缩摘要 compressedTokens=3055；没有原请求证据时不认定客户端发错上限参数。

静态 collector 显式绑定 main dispatch、execution SHA、公开源码、run/attempt、ZIP digest/路径/大小及费用边界。第一次原 collector API 403 原件保留；随后使用 gh 既有认证，只把凭据放入采集进程内存，没有写入文件。完整 178 份 gzip 原件的双摘要见 [manifest.json](./manifest.json)，范围见 [summary.json](./summary.json)。collector 不执行候选或证明 invoice。

正式 **36+9 / NOT_RUN / observed=0 / $99**、冻结指纹、原窗口和独立人工/正式宿主/辅助技术/native durable/8h/24h/SLO 状态不变。本次仅一次实际复测，后续未再次付费调用。
