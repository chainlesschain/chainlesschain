# 2026-10-09 剩余工程续做证据

起点为 `976c4f394fbab4fccc041787051f00abe08113c9`，记录的是工作区改动；报告包含实际源码字节摘要，不能将起点 SHA 当作新代码的干净提交或发行证明。正式 36+9、$99、原窗口及 observations 保持冻结。实际 Windows 为 `10.0.19045` / x64，原生诊断使用 Node 22.22.2；Node 22.12.0 和 Linux 的重复合同执行不等于正式目标宿主验收。

| 材料                                                                                                                                   | 内容和边界                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [model-review-local.json](./model-review-local.json)                                                                                   | 本地目录合同成功、dirty 源码和实际输入摘要；没有上游页面或 provider 账单验收                                                            |
| [历史 workflow 原件](./model-review-prior-workflow.stdout) / [artifact 回读](./model-review-prior-artifacts.stdout)                    | #37297653237 原成功属旧准确提交；artifact 数为 0，不能重用为新工作区的 CI 结果                                                          |
| [最终 private service v2](./esbuild-private-service-final-v2/report.json)                                                              | 冻结 main.js 调真实零 capability AppContainer service：bundle/TS/非法语法/原 config bundle；host JS client 在容器外，完整 review 未通过 |
| [完整 frozen 导入尝试](./esbuild-private-frozen-attempt-final/report.json)                                                             | 私有 X 根、Node/builtin 导入已建立，Vitest 导入后超时；真实 wait/error/退出和空 Job 清理保留                                            |
| [最终 Job 回收](./windows-job-recovery-final/report.json) / [原生回执](./windows-job-recovery-final/native.stdout.json)                | 错 Job/旧身份拒绝，owner 崩溃后两个后代仍有活跃 TCP，原始 Job 终止后句柄/空组/socket 三证明；未测 custodian 自身重启或 WFP              |
| [未入 Job 的原始 HANDLE 清理负例](./windows-job-recovery-final/unassigned.stdout.json)                                                 | 注入创建成功/入 Job 前失败，exit 2/completed false，独立原始 HANDLE 兜底清理                                                            |
| [Windows 22.22 TAP](./node22.22-windows.tap) / [Windows 22.12 TAP](./node22.12-windows.tap) / [Linux 22.22 TAP](./node22.22-linux.tap) | 各 208 通过/零跳过；源码不同运行时的重复测试不相加                                                                                      |
| [冻结采集摘要](./frozen-collection-summary.json) / [原始输出](./frozen-collection-readback.stdout)                                     | 真 exit 2，task 36/firstRun 9、observed 0、NOT_RUN、INSUFFICIENT_EVIDENCE；总费用 null                                                  |

`esbuild-private-service-failure-a`、`esbuild-private-frozen-attempt-c`、`windows-job-recovery-failure-v1/v2` 和较早 `esbuild-private-service-final` 保留各自源码时点的原始失败/结果；最终代码使用后缀 `final-v2` service 与 `windows-job-recovery-final`，不能把旧摘要移植到新源码。原件及 archive manifest 保存字节摘要，不覆盖失败；原生二进制留在本机 .work，归档不声称 compiler closure 为 hermetic。

完整条目与后续继承实验见[验证第 20 节](../../../../cli-ide-gap-validation-2026-10-05.md#20-2026-10-09-剩余工程与验收边界)。官方账号费用授权、独立人工审阅、Windows 11/macOS 正式宿主、NVDA/Orca/VoiceOver 听测、8h/24h 和获批 SLO 继续独立开放，没有用局部诊断填入正式 observations。

最新完成项使用最终 guard/helper/driver 的当前源码字节，较早同名实验保留各自时点：

| 材料                                                                                                                                            | 结果与范围                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [final2 original](./private-v4-final2-original/report.json) / [当前 12 份源码回读](./private-v4-final2-source-readback.json)                    | 同 SID/Job 的真实 esbuild、固定 helper 和原冻结 forks/maxWorkers2，65/65；strict inspector true、Job0/profile 删除；NOT_ADMITTED                                           |
| [协议负例](./private-v4-final2-protocol-negative/report.json) / [未入 Job 负例](./private-v4-final2-unassigned-worker/report.json)              | 分别真实拒绝错误请求、回收原始未入 Job 暂停进程；原 HANDLE wait0/exit125；失败保持失败，不计作正式任务                                                                     |
| [精确 CLI 必需依赖及 alias](./frozen-cli-runtime-closure/manifest.json) / [preflight](./frozen-cli-runtime-closure/preflight.json)              | 389 registry 包、18,804 文件、15 空文件；原 lock/嵌套版本，source/before/after 实读；36,257 guard 节点，上限48,000；optional native 源码尚未全部构建，不声称整体可执行准入 |
| [完整 Windows 基线](./private-v4-final-full-baseline/report.json) / [真实失败 causes](./private-v4-final-full-baseline/journal.jsonl)           | 211=194通过/16失败/1跳过，12文件均加载；实际 home lstat EPERM、owner ACL 与 junction/原skip保持OPEN；清理成立，完整review拒绝                                              |
| [9 任务组合基线](./private-v4-final-clean-baseline/report.json)                                                                                 | exact IDs01,02,03,10,12,20,28,29,30，159/159、零跳过，parser/native0均成功；不覆盖其余失败任务                                                                             |
| [反例01](./private-v4-final-mutant-01/report.json) / [反例02](./private-v4-final-mutant-02/report.json)                                         | 逐项绑定同一已通过组合基线后新鲜capsule运行，分别18/5个真实行为断言失败，baseline/parser/native1三门均成立；其余8个eligible反例仍进行中，4个blocked反例NOT_RUN             |
| [失败基线预启动拒绝](./private-v4-failed-baseline-refusal/report.json)                                                                          | 重新验证真实失败full baseline后拒绝：compile0、无capsule/nativeexecution，未借已有失败冒充反例拒绝                                                                         |
| [Windows22.22](./final3-node22.22-windows.json) / [Windows22.12](./final3-node22.12-windows.json) / [Linux22.22](./final3-node22.22-linux.json) | 各408/408、零跳过、源码前后稳定；三个runtime不相加。另7个既有model Vitest通过，共415不同测试，与原配置/组合基线的重叠用例单独记录                                          |

本目录由 `.gitattributes -text !eol` 保留 raw CRLF/源码字节；archive manifest 与输入摘要均按原字节核对。编译二进制、完整 registry tarball 和巨大 staged tree 留在本机 `.work`，未把compiler closure或目录下载结果标成正式执行准入。未改原36+9、$99、窗口或observations，未调用新付费模型或发布包。
