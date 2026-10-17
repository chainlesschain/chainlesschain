# CLI 与 IDE 任务完成诊断（2026-10-17）

本轮按用户要求优先核对任务实际产物、验收与恢复，不作费用推算。用户已授权火山引擎付费诊断，并允许对失败任务优化及请 Astra 复核。

逐组收据摘要、候选摘要及下载工件 SHA-256 见 [results.json](./results.json)。

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

- [39039938906](https://github.com/chainlesschain/chainlesschain/actions/runs/39039938906)，源码 `1e8e7942c3e1979dfab6625a4bd23f6035a8a910`：首个请求约 348 ms 后发生请求错误，HTTP 状态未知、响应为空；无候选产物。旧收据不足以证明未发送，保持未知结果。
- [39041797746](https://github.com/chainlesschain/chainlesschain/actions/runs/39041797746)，源码 `fabecfacf4414bab3d24d17854d94eb44933fcd2`：15 个持久化尝试槽、14 个完整 usage。`verify-04` 的第二次尝试在 TCP/TLS 建立前约 254 ms 失败，收据为 `ETIMEDOUT`、`dispatchStarted:false`；任务失败，下一任务正常进入模型。
- 同次 `verify-22` 完成 13 次模型调用并正常终止，写出三项测试；checker 因相对导入路径错误收集到 0 项候选测试，基线 19/19 通过。Astra 核对准确冻结源码后还发现故障注入发生在发布之前、记录版本与存储版本混淆，因此不能仅修路径就声称通过。

原始 `verify-22` 候选按字节保留在 [诊断 fixture](../../../../../../packages/cli/scripts/fixtures/verify01-volcengine/verify-22-39041797746.test.txt)，摘要为 `sha256:c3c99c33ff24851d26d3ecc90da783b3a77d8fea2d5e9fde0f86ae6696f4f229`。后续模型修复从副本开始，并记录来源，原始失败不覆盖。

### 本轮改进

- 请求正文上限从 80 KiB 调至 256 KiB；超限在发送前拒绝，只使当前任务失败。
- HTTP 请求在新 TLS 连接完成后才交给 `ClientRequest.end`；阶段收据记录是否开始发送。发送后不明结果仍停止共享代理，自动 HTTP 重试为零。
- 地址选择的单次连接尝试期限设为 2 秒，总请求期限仍为 45 秒；保留有界的地址族尝试与嵌套错误代码。254 ms 的失败与 Node 默认连接尝试期限相符，具体原因仍需新收据确认。
- 修正可能误导缓存 bucket 语义的提示；要求沿源码推导分组、版本及发布边界。`verify-22` 使用原失败候选及普通 checker/源码审阅反馈进行有界修复。

本地两个 Node 诊断测试文件 23/23 通过；Prettier 与 `git diff --check` 通过。另有一次真实本地 TLS 往返验证发送门槛正常，临时证书已清理。Astra 已复核网络边界与任务失败原因。

后续准确提交 `a0414280ce407d121e08f5aa050cf9662fb33510` 的真实运行：[39043024352](https://github.com/chainlesschain/chainlesschain/actions/runs/39043024352)，结果待读回。

## 正式采集状态

本页所有结果为诊断，不写入冻结 36 项任务或 9 次首次安装。正式采集继续 `NOT_RUN`（0/36、0/9），预算 `paidReady:false`、native `NOT_ADMITTED`、晋升 `HOLD`。后续通过也须保留原失败，标明经过反馈修复。
