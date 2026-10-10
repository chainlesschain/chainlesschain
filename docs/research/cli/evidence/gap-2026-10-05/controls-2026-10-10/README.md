# Windows 原生行为控制增量（2026-10-10）

本目录记录新的显式 `--behavior-controls` 诊断，不改写旧冻结矩阵或正式 observations。实现见 [草稿 PR #428](https://github.com/chainlesschain/chainlesschain/pull/428)，控制源码提交 `b471bfe441b2266bc47478110840b07f3702c170`；`7ece0f75232f0465dc7a0faa79709e1c85b321cb` 只更新进程启动清单，`c6bda4c4851e2c22d68eabebca6deb48c45e8266` 修复 Scheduler 报告写入异常覆盖。

## 执行状态

| 运行                               | 实际结果                                                                    | 证据                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 中间基线 a                         | 52/52 assertions 通过；运行期间控制校验源码更新，最终来源一致性检查正确拒绝 | [清单](./intermediate-a/manifest.json)                                            |
| 沙箱内基线 b                       | `host-token` 阶段拒绝；未创建原生 root，不能计为执行成功                    | [清单](./restricted-token-b/manifest.json)                                        |
| 最终基线 c                         | 52/52 assertions 通过，原始 reporter、来源和原生结算全部确认                | [清单](./baseline/manifest.json)                                                  |
| verify-12 / argv 边界              | 串行轮 **12 = 11 pass / 1 行为断言拒绝**，检出及原生结算确认                | [新结果](./mutant12/manifest.json)，[并行失败](./failed12-parallel/manifest.json) |
| verify-20 / deny 优先              | 串行轮 **5 = 4 pass / 1 行为断言拒绝**，检出及原生结算确认                  | [新结果](./mutant20/manifest.json)，[并行失败](./failed20-parallel/manifest.json) |
| verify-29 / session-bound ACK      | 串行轮 **20 = 19 pass / 1 行为断言拒绝**，检出及原生结算确认                | [新结果](./mutant29/manifest.json)                                                |
| verify-30 / 动画 fallback 像素预算 | 尚未执行                                                                    | 待归档                                                                            |

控制来自现有 Linux diagnostic donor，额外生成四个文件、五条行为断言。冻结的基线源码、原 setup/config 和旧任务 specs 均不改动。新结果要求原始 reporter 包含每个冻结基线文件和完整控制断言，禁止缺失、重复、额外文件、跳过、超时，以及用应用错误或其他文件的 AssertionError 充当检出。反例执行还必须重新验证同一 driver、validator、控制源码、runtime、依赖及原生结算的成功基线。

最终基线 c 采用普通用户的非受限、非 elevated 监督器，root/service 同 SID 与 Job、零 capability、原 HANDLE 退出、Job 0、profile 删除均成立；guard 实际 **36,262**，固定上限 **48,000** 未放宽。b 的原始报告只保留合并的 `host-token` 阶段，没有细分前置检查的具体拒绝字段，因此不把某一个 token 分支写成已确认根因。

本地新合同 **134/134** 通过，定向 ESLint 和 Prettier 通过。Scheduler 的 worker/coordinator **11/11** 在按 lockfile 恢复 CLI 依赖后通过；之前缺少 CLI 嵌套 Ajv 8 的导入失败保留在 readbacks，不能归为 Scheduler 生产故障。

Scheduler 修复还关闭旧 `no-unsafe-finally`：主 write/fsync/rename 错误与 close/unlink 清理错误分别保存，收尾动作独立执行，成功 replace 后的清理失败仍报错。新增六项故障回归在 Windows **48 pass / 1 POSIX skip**、WSL Ubuntu Node 22.12.0 **49/49**；修复后真实 worker/coordinator 再次 **11/11** 通过。当前准确 SHA CI 尚在排队。

两份并行失败原件均为 `broker-termination-policy / error 13`、空 reporter、root/service/helper exit 125，原 HANDLE 清理、Job 0、profile 删除确认。12 的 helper 已注册并有 installed receipt，20 尚无注册完成记录。未保留精确拒绝 predicate 与时间，不能确定具体 policy 分支或并行竞争根因，也不能把这两次计为反例检出。

## Scheduler 回读

[原始回读清单](./readbacks/manifest.json)保存 `9feab8bf4dee6837f0df04ab01456a89ce760944` 的 run `38029503816`、四个成功 job、原始 artifact ZIP 和提取的三平台结果。现有 verifier 回验通过；每个平台分别连续运行 Linux **17.766 s**、macOS **17.920 s**、Windows **19.965 s**，profile 为 smoke、lease **1000ms**。

聚合文件的最早开始至最晚完成跨度不能作为单一宿主的连续 soak 时长。这次成功也不确认旧 `73f5` 失租根因，不能替代后续 `1f06`、merge 或本轮提交的准确 SHA 检查。

## 归档与边界

每份清单记录原文件路径、原始长度和 SHA-256，以及无损 gzip 的长度和 SHA-256。解压后是未改写的原始字节；不是重新序列化的报告。编译二进制留本机，compiler closure 不是 hermetic，未宣称已完成正式安装或 production admission。

本机为 Windows 10 x64 / Node 22.22.2，仍不是冻结的 Windows 11 24H2 / Node 22.12.0 正式目标。旧完整 Windows **211 = 194 pass / 16 fail / 1 skip**、**6 检出 / 4 存活 / 4 未运行**原件保留；新控制结果单列，不改旧分母。完整 native review 继续 `NOT_ADMITTED`，正式 **36 tasks + 9 firstRuns / NOT_RUN / INSUFFICIENT_EVIDENCE**、$99 和 observations 不变。

Windows/macOS 受保护 durable authority、journal、服务自身恢复与网络撤销仍需实现；完整原生 review 的其余失败和冻结平台规范冲突、官方账号/账单、独立人工 setup/check、真人辅助技术与 8h/24h/SLO 验收继续开放。本轮没有付费 provider 调用或发布。
