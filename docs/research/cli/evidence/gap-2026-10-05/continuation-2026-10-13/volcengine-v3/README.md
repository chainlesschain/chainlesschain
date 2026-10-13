# VERIFY01 全火山 v3 验收进展

用户授权全部 36 个任务和 9 次首次安装使用火山引擎，并授权 Astra AI 代替人工预审。本轮创建新 [v3 计划](../../../../verify01-plan-2026-10-13-volcengine/README.md)，保留 v1/v2、原任务、样本 ID、宿主要求、窗口及共享 $99。新指纹为 `sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13`。

正式状态仍为 **NOT_RUN：0/36 任务、0/9 首次安装；native NOT_ADMITTED；paidReady=false**。这份增量证据不把诊断、静态脚本审阅或本地工程观察计入正式分母。

## 已完成的工程工作

- 全火山 v3 在 Windows/Linux Node 22.12 各通过 28 项校验，旧计划仍通过原合同；没有迁移旧审批。
- Astra 审阅新准确 72 个 Linux Docker 脚本、42 个行为变异锚点和 45 个比较绑定，结论 `APPROVED_FOR_DECLARED_EVALUATOR_SCOPE`。新 review 指纹 `sha256:70b1e2db16afe0664db90a76415bb6ffed528f89ef81e9134ca53b5d7ff626d9`；镜像 ID `sha256:344dbe71e1c47a59db0e94bebdcc94ef3a7bc8bd828393c820168993539048da`。70 个脚本与 v2 字节相同，只有 verify-34 的两个脚本内嵌计划变化。该批准来自 AI，`independentHumanReview=false`；不包括 native、付费门或真实候选成果的批准。
- 预算分配适配保留旧 18+18 合同；新 v3 必须携带准确完整冻结 bundle，并逐样本绑定 ID、kind、cap、provider、model、官方 endpoint。遗漏 bundle 后冒用 v3 摘要的绕过已被负控发现并修复。原费用、未决 liability 和 run slots 保留；没有启用 fixture 证据作为真实账户凭证。
- 新诊断调用器将实际火山密钥留在可信父进程，模型子进程仅获得随机本机访问能力。诊断限定每题 14 次物理调用、80KiB 请求、1MiB 响应、4096 answer tokens、45 秒调用超时；关闭 thinking 仅适用于诊断。无重试、重定向或 fallback；完整 usage 与原始响应/收据落盘后才向 CLI 返回成功。usage 未知或证据错误阻止下一次调用。它没有提供账户硬额度或正式付费准入。
- 原 Windows junction/lstat 组合回归及负对照见 [上一轮原件](../acceptance-continuation/README.md)。普通 Windows 10 工程回归为 38 pass / 0 fail / 1 原 skip；不是 LowBox/native 正式准入。

合并预算模块与新 observer epoch 后，准确工程源码 `8bdad513b9f1d0ecf5339281c7d60221dbd65a3b` 的 Windows Node 22.12 联合回归 **147/147、零 skip**。子模块独立 Linux 回归保存在 Astra 原件。该结果尚不替代最终提交的 GitHub Actions 三系统矩阵。

## 真实公开 CLI 诊断

首轮 [run 38357481753](https://github.com/chainlesschain/chainlesschain/actions/runs/38357481753) 使用公开 CLI `0.166.99`，核对原发行源码 `311e01a5ec34a8e433c7abde0e4b6b05bce4513b`、npm integrity、冻结任务项目和 Docker image。verify-04 的原 baseline **22/22**、verify-22 的原 baseline **19/19**；目录配置预检也通过。

首轮整体 **失败**：公开 CLI 的 `stream-json` 是事件格式，实际模型传输使用非流式 JSON；原诊断 broker 只允许 SSE，因此在本机拒绝 `DIAGNOSTIC_STREAM_REQUIRED`，物理火山请求 **0**。verify-04 留下非答案 placeholder，候选检查正确拒绝；verify-22 在已拒绝的 broker 状态下没有调用模型。原 stderr、事件、候选、checker 收据和失败 summary 全部保留。费用字段仍区分 token estimate 与真实账单，不从未知账单推导正式剩余额度。JSON 路径修复及后续真实执行将另附原件。

## 长期观察

原冻结 `.99` workload 始终保持运行：Windows PID 13412；Ubuntu 24.04.3/WSL1 Linux PID 8，Windows wrapper PID 9148。Linux 原 observer PID 28616 继续运行。

Windows 原 observer 在 `2026-10-13T06:22:58.670Z` 记录 `PROCESS_PROOF_UNAVAILABLE` 后退出，原 **OBSERVATION_REJECTED** 没有改写。后续两次实际身份查询完整匹配，耗时约 5.02/4.14 秒；原日志未保存子进程错误细节，因此当时原因只能列 **UNDETERMINED**，不能倒推为超时或宣称未发生。

新的 Windows observer PID **33536** 将后续状态写入独立 epoch，首个完整身份核验完成于 `2026-10-13T06:54:42.897Z`。原失败字节已归档；保留约 **5863 秒未监测前缀**及原最后成功观察 `06:21:35.070Z` 至新首观约 **33 分 8 秒**的空档，不拼接成持续合格观察。新代码保留 15 秒查询超时，并记录未来失败的 exit/error/signal/elapsed/stderr 摘要。Windows/Linux 回归各 **27/27**。

`2026-10-13T07:02:30Z` 真实回读中，两条 workload/observer 均 running/MONITORING；Windows 6320 秒、2384 循环；Linux 6083 秒、2345 循环；双方丢失消息、重复效果和不变量违例均为 0。均 `monitoringCompleteFromLaunch=false / qualifyingEvidence=false / formalHostAcceptance=false`。预计达到 8h 的北京时间为 10 月 13 日约 21:17/21:21，达到 24h 为 10 月 14 日约 13:17/13:21；必须核验实际报告、身份、原件及 producer 的完成 validator 后再记录结果。

## 仍缺的正式条件

准确 Windows 11 24H2、macOS 15 arm64 公共 CLI/IDE 宿主及九次首次安装、accessibility 和入口长期验收尚无完整回执。Windows LowBox 与精确 owner-only 存储仍需要受保护 broker 与 journal/CAS/flush/recovery；固定平台 skip 和旧禁止 skip parser 的冲突需要版本化等效 review。旧 native admission 仍拒绝，未删除断言或改写旧成绩。

预算分配适配已经完成，但可信账户计费、含全部输入开销与默认 thinking 的责任上界、结算 FX、原 lineage 注册/fencing、防回滚和所有真实付费出口接线仍缺。公开价与诊断额度不是这些凭证；不得把预算重置为新 $99。

原草稿 PR #439 已关闭且未合并；其准确提交对象被保留。并发清理移除旧工程工作树的 Git 元数据后，本轮从准确提交恢复到独立临时工作树，未操作主目录的未完成工作，也未重启长期 workload。后续成果将进入新草稿 PR。

## 原件索引

[manifest.json](./manifest.json) 将来源路径映射到短 `objects/<SHA256>.gz` 文件，避免 Windows MAX_PATH 丢失。每个条目同时保存原字节、存储字节和压缩字节摘要；[validation.json](./validation.json) 核对解压后的摘要。审阅、初版反例、修复后批准、真 CI 首轮失败及本地受限 token 失败原件均保留。镜像包保存全部准确脚本。对象数量是证据数量，不是正式测试或观察数量。
