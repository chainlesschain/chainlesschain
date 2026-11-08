# IDE 模型输入诊断入口与 VS Code 原生宿主验证（2026-11-08）

本批继续[差距复核第 2 项](../plans/cli-ide-codex-claude-gap-review-2026-11-08.md)。VS Code 代码已提交 `fdaead01e067ad4db3024b3eb8e9e81747a6fd25`，分支 feature/ide-model-input-diagnostics-20261108。JetBrains 入口已在后续提交 bb27c9091637235dc86f9238a473b0e1514209a1 完成并推送，目标 SDK 编译结果见下文。

**VS Code 入口**

命令面板提供“ChainlessChain：查看模型输入诊断”（chainlesschain.session.modelInputs），使用当前会话执行 canonical CLI 的 session show --json --model-inputs --limit 50。接收结果再次白名单投影，打开纯文本摘要快照；不另算 token，也不输出任意 CLI 字段或错误 stderr。

查询前无会话时不启动进程；CLI 不支持、记录为空、输出损坏、会话不匹配均有明确提示。查询完成和异步文档创建完成后都核对当前会话，防止旧会话结果打开到新会话。使用原生文本编辑器，保留编辑器已有的键盘和读屏能力；尚未进行真人可访问性验收。

原生测试发现并修复了共享 runCliResult 的 Windows 原生程序路径问题：此前将 .exe 按 npm 批处理双重转义，参数中的文件名带上 ^ 后无法打开。现在绝对路径的 .exe/.com 走无 shell argv，其他 Windows npm shim 保留原批处理转义。真实 Node 子进程回归确认空格、中文、&、%PATH%、引号和 ^ 保持原参数，没有执行额外命令。

**验证与证据**

| 范围                        | 结果                                                       | 边界                                                                                                           |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 完整 VS Code test:unit      | 342 项通过                                                 | [原始日志](./evidence/ide-model-input-20261108/vscode-model-input-full-unit.log)                               |
| VS Code 原生 Extension Host | 通过，VS Code 1.96.2                                       | [回执](./evidence/ide-model-input-20261108/vscode-host-result.json)；全新 profile / extensions-dir / workspace |
| 原生编辑器显示              | plaintext，当前编辑器 URI 对应返回文档，原文哨兵未进入正文 | 文档 720 字节，摘要在回执中；不是截图或真人读屏证据                                                            |
| 进程边界                    | 实际 Node 子进程接收预期 CLI 参数并返回 fixture            | 使用生产 runCliResult，不调用真实模型                                                                          |
| 共享 SDK                    | vendored SDK / 桌面共享客户端一致性专项通过                | 未新增 SDK 方法、未发布任何包                                                                                  |

复现原生宿主检查：在 packages/vscode-extension 执行 npm run test:model-input-host -- <已安装 VS Code 原生可执行文件绝对路径>。脚本使用新的隔离目录并保留 code.log / host-result.json。它验证开发扩展的实际命令注册、生产摘要解析与原生编辑器显示；调用的是受控 CLI 进程 fixture，realCanonicalSessionJourney:false，不能替代打包安装、真实 canonical 会话、双任务或完整恢复旅程。

保留了首次原生超时、定位后的原生程序参数错误，以及修复后成功回执。测试驱动也修正了等待错误通知关闭和展开 VS Code API 对象误触 experimental getter 的问题；没有启用 proposed API 或放宽产品校验。一次驱动预检失败却误启动的重复测试已按独立 profile 进程身份停止，不计入通过。

**JetBrains 验证结果**

Tools / Find Action 已提供“当前会话模型输入诊断”，使用 nullable 当前会话选择、后台 CLI 查询、返回时会话核对及只读文本对话框。没有会话时不会改查 default；错误 stderr 和原始正文不进入 UI。

- JDK 21 + 默认 IntelliJ IDEA Community 2024.2 的 compileJava / compileTestJava / processResources 已取得 BUILD SUCCESSFUL：[编译日志](./evidence/jetbrains-model-input-20261108/sdk-compile-result.log)。
- 使用这批 Gradle 编译产物、项目 JUnit 5.10.2 和 SDK 自带 JBR 21 直接执行专项，5/5 通过：[测试日志](./evidence/jetbrains-model-input-20261108/sdk-junit-result.log)。
- 原 Gradle test worker 在执行测试之前无法连接本机 127.0.0.1:61354，保留[失败记录](./evidence/jetbrains-model-input-20261108/gradle-test-worker-failure.json)；没有将这次 Gradle test 声明为通过。
- 官方 JDK / SDK 下载与校验信息一并归档；未降低目标 SDK、修改 JVM 目标或放宽生产限制。
- 原生 JetBrains GUI、真实 canonical 会话组合与真人可访问性旅程尚未验收。

**剩余验收**

继续完成 JetBrains 原生入口验证、使用真实 CLI 会话的双 IDE 组合旅程，以及逐来源失败归因和独立任务验收。现有公开 CLI 版本不自动具备未发布的 --model-inputs；旧 CLI 失败会提示检查功能支持。生产可用性与版本配对仍需按既有发布顺序及 GitHub Actions 准确提交门禁验证。本批未发布版本或扩展付费准入。
