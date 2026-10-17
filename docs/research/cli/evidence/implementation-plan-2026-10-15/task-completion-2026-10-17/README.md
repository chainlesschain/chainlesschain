# CLI 与 IDE 任务完成诊断（2026-10-17）

本轮按用户要求优先核对任务实际产物、验收与恢复，不作费用推算。用户已授权火山引擎付费诊断，并允许对失败任务优化及请 Astra 复核。

逐组收据摘要、候选摘要及下载工件 SHA-256 见 [results.json](./results.json)。

| 检查项                             | 当前可核验结果                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| VS Code / JetBrains 三系统宿主流程 | 6/6 组通过，确定性测试服务                                                                                      |
| `verify-22`                        | 修复第 2 轮通过；候选 3/3，故障注入被检出；[验收产物](./accepted-candidates/verify-22-39045268929.test.txt)     |
| `verify-04`                        | 修复第 2 轮通过；候选 6/6，两项故障注入被检出；[验收产物](./accepted-candidates/verify-04-39046343326.test.txt) |

两项 CLI 任务在不同运行中分别验收通过，共 9 项候选测试、3 项故障注入；两项都使用过明确的 checker/源码审阅反馈，因此该结果只证明经过有界修复后完成任务，不能表示首次尝试 2/2 或正式 36+9 通过。

## 真实 IDE 宿主

[工作流 39040127653](https://github.com/chainlesschain/chainlesschain/actions/runs/39040127653) 在提交 `1e8e7942c3e1979dfab6625a4bd23f6035a8a910` 的六组宿主全部通过，工件已逐组下载并读回 `diagnostic-result.json`。

| 宿主                            | Linux x64 | Windows x64 | macOS Intel |
| ------------------------------- | --------- | ----------- | ----------- |
| VS Code 1.132.0 / 插件 0.37.149 | 通过      | 通过        | 通过        |
| IntelliJ 2024.2 / 插件 0.4.166  | 通过      | 通过        | 通过        |

VS Code 三组均保留提交、输入接收回执、最终结果及重载后恢复记录；初始与恢复结果摘要一致。VSIX 摘要为 `sha256:08fe72fded4eeadee0373ac3f891e393f9e350b07b9ae3fb9aa75010ef63316b`。JetBrains 三组的对话捕获、冷启动、冷启动边界和入门身份流程均通过。

上述宿主使用确定性测试服务，收据明确为 `providerAssessed:false`、`formalSample:false`。它们证明插件流程可完成和恢复，不是模型代码任务质量或冻结九入口首次公开安装的结果。

## CLI 真实模型诊断

诊断固定公开 CLI `0.166.99`、冻结项目 `b2aa3aba082873570e85dce39b00754e5504ff37`，使用 `volcengine / deepseek-v4-flash-ga-260731`。模型只能修改指定测试文件，候选代码由无网络、无凭据的 Linux Docker 独立 checker 执行。

### 已保存的失败

另有两次取消运行：[39039829095](https://github.com/chainlesschain/chainlesschain/actions/runs/39039829095) 在排队且步骤为空时取消；[39041490474](https://github.com/chainlesschain/chainlesschain/actions/runs/39041490474) 在修正任务反馈时申请取消，但取消完成前执行步骤已经启动。后者不用于判断任务质量，也不据此声称模型调用为零。

- [39039938906](https://github.com/chainlesschain/chainlesschain/actions/runs/39039938906)，源码 `1e8e7942c3e1979dfab6625a4bd23f6035a8a910`：首个请求约 348 ms 后发生请求错误，HTTP 状态未知、响应为空；无候选产物。旧收据不足以证明未发送，保持未知结果。
- [39041797746](https://github.com/chainlesschain/chainlesschain/actions/runs/39041797746)，源码 `fabecfacf4414bab3d24d17854d94eb44933fcd2`：15 个持久化尝试槽、14 个完整 usage。`verify-04` 的第二次尝试在 TCP/TLS 建立前约 254 ms 失败，收据为 `ETIMEDOUT`、`dispatchStarted:false`；任务失败，下一任务正常进入模型。
- 同次 `verify-22` 完成 13 次模型调用并正常终止，写出三项测试；checker 因相对导入路径错误收集到 0 项候选测试，基线 19/19 通过。Astra 核对准确冻结源码后还发现故障注入发生在发布之前、记录版本与存储版本混淆，因此不能仅修路径就声称通过。

原始 `verify-22` 候选按字节保留在 [诊断 fixture](../../../../../../packages/cli/scripts/fixtures/verify01-volcengine/verify-22-39041797746.test.txt)，摘要为 `sha256:c3c99c33ff24851d26d3ecc90da783b3a77d8fea2d5e9fde0f86ae6696f4f229`。后续模型修复从副本开始，并记录来源，原始失败不覆盖。

### 本轮改进

- 请求正文上限从 80 KiB 调至 256 KiB；超限在发送前拒绝，只使当前任务失败。
- HTTP 请求在新 TLS 连接完成后才交给 `ClientRequest.end`；阶段收据记录是否开始发送。发送后不明结果仍停止共享代理，自动 HTTP 重试为零。
- 地址选择的单次连接尝试期限设为 2 秒，总请求期限仍为 45 秒；保留有界的地址族尝试与嵌套错误代码。254 ms 的失败与 Node 默认连接尝试期限相符，具体原因仍需新收据确认。
- 修正可能误导缓存 bucket 语义的提示；要求沿源码推导分组、版本及发布边界。`verify-22` 使用原失败候选及普通 checker/源码审阅反馈进行有界修复。

本地两个 Node 诊断测试文件最新 27/27 通过（包含 JSON/SSE 截断响应判定及任务选择器）；Prettier 与 `git diff --check` 通过。另有一次真实本地 TLS 往返验证发送门槛正常，临时证书已清理。Astra 已复核网络边界、截断判定与任务失败原因。

准确提交 `a0414280ce407d121e08f5aa050cf9662fb33510` 的真实运行 [39043024352](https://github.com/chainlesschain/chainlesschain/actions/runs/39043024352) 已读回：27/27 次模型请求完整返回，无网络失败。两项任务仍均未通过。`verify-04` 正常终止，候选四项测试 1 项通过、3 项失败：辅助函数误以为 bucket 合并会更新顶层计数，并误读 `priceRollup` 的模型行总额字段。`verify-22` 候选三项测试 0 项通过，仍在第二次 `_collect` 注入发布前故障，成功对照也误断言两次调用；模型耗尽 14 轮迭代。基线分别 22/22、19/19 通过。

下一轮使用这次的两个候选副本及普通 checker 错误，要求核对实际 API 字段、计数和完整发布调用链；保留行为断言，补足缓存贡献跨越阈值的源码边界覆盖。提示限制最多三次定向读取、第四轮前写入、第八轮前结束，CLI 硬上限为 10 轮。`verify-04` 记为修复第 1 轮，`verify-22` 记为修复第 2 轮；这些经过源码反馈的结果不能用于声称首次尝试成功。

准确提交 `9785536429f248f10ec9371f07fd1d6e877485c9` 的有界修复运行 [39044546005](https://github.com/chainlesschain/chainlesschain/actions/runs/39044546005) 在 `verify-04` 第八次请求返回 `finish_reason:length`，完成输出恰为 4096 token，完整 JSON envelope 中包含用量，但写文件参数截断，因此未执行新写入。旧诊断器先拒绝终态再核对用量，将该响应记为 `DIAGNOSTIC_INCOMPLETE_STREAM` 并停止，`verify-22` 未运行。该次保持失败，不能判断修复候选已完成。

随后把有界输出上限调至 8192，并要求简短工具调用和局部编辑；完整且用量已校验的 `length` 响应会保存原文与收据、使当前任务失败，禁止向 CLI 转发截断参数，但允许下一项任务。缺失用量、协议不完整、模型/档位不符或证据落盘失败仍停止共享代理，HTTP 自动重试保持为零。

准确提交 `9b1ddce5d0b8e4c8d297db1f85ec2968be1f6e91` 的有界修复运行 [39045268929](https://github.com/chainlesschain/chainlesschain/actions/runs/39045268929) 已读回：15/15 请求完整返回。`verify-22` 在修复第 2 轮通过：模型 6 次请求、正常终态、指定产物且无源文件变化，基线 19/19、候选 3/3，通过故障注入检查（错误的 `committed:false` 使 2 项断言失败）。`verify-04` 模型 9 次请求正常终止，候选 6 项通过 4 项；两项仍误用 provider 的默认缓存倍率，忽略模型自身条款的覆盖。

后续只重测 `verify-04`：普通 checker 给出的两个数值差异及准确冻结源码均指向 `rate.terms.cacheReadMultiplier` 优先于 provider fallback。模型继续从该次六项候选副本修复所有关联断言与注释，记为修复第 2 轮；已通过的 `verify-22` 不重复执行。任务选择记录在 `selectedTasks`，仅支持 `both`、`verify-04`、`verify-22`，不改变正式分母。

准确提交 `7bc147b7c6fa5f7c674c91eeb461171f5a2a5797` 的单任务运行 [39046343326](https://github.com/chainlesschain/chainlesschain/actions/runs/39046343326) 成功，已读回收据：`selectedTasks:["verify-04"]`、10/10 请求完整返回，模型正常终态且只修改指定产物；基线 22/22、候选 6/6 通过。合并长短请求 bucket、忽略缓存输入贡献这两项错误实现分别使 2 项、3 项候选断言失败，故障均被检出。验收产物摘要为 `sha256:fb6f52080dc74baf7244ab354732bf4201d709611f730c8e07cebe276f6a942f`，原始失败候选、失败收据和修复轮次继续保留。

## 正式采集状态

本页所有结果为诊断，不写入冻结 36 项任务或 9 次首次安装。正式采集继续 `NOT_RUN`（0/36、0/9），预算 `paidReady:false`、native `NOT_ADMITTED`、晋升 `HOLD`。后续通过也须保留原失败，标明经过反馈修复。
