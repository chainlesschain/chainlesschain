# CLI / IDE 差距优化第二批：配置读取状态与首次使用提示

日期：2026-10-27。承接[差距复核报告](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.4 节，以及[首批 Goal 实施记录](./cli-ide-goal-completion-progress-2026-10-27.md)。首批源码已进入提交 `67c085115b`；本批继续处理双 IDE 的首次使用与配置诊断。

## 本批行为

### 明确区分三种配置状态

VS Code 和 JetBrains 的首次检测均使用三态结果：

| 状态         | 含义                                           | 用户可见行为                                     |
| ------------ | ---------------------------------------------- | ------------------------------------------------ |
| configured   | 已读到提供商选择                               | 正常进入聊天；这不代表模型连接或账号权限已验证   |
| unconfigured | 可用配置明确没有提供商值                       | 显示首次配置引导                                 |
| unavailable  | 文件不可读、格式无效、CLI 失败或诊断格式不支持 | 提示检查诊断和配置文件，避免误导用户重新填写密钥 |

默认配置文件可读时仍优先直接读取，避免 CLI 更新中的短暂故障造成重复配置提示。该状态结果只保留提供商、来源和状态，不返回 API Key、文件路径或底层错误正文。

配置文件损坏或读取权限不足时，检测不会再通过可能修复文件的读取命令兜底。对于显式配置目录覆盖、缺失文件及旧式配置，复用现有 `cc llm capabilities --json`，由 CLI 解析实际配置位置。此接口严格读取配置、不解析密钥、不调用网络或模型；探测进程上限为 12 秒。

配置目录覆盖存在时不会读取默认用户目录。过旧 CLI 不支持诊断接口或返回未知格式时，保持 unavailable，并提供诊断提示。旧字段读取 API 保留兼容；本批改造聚焦首次使用检测，并未声称重构所有配置读取入口。

实现：

- [VS Code 配置读取](../../packages/vscode-extension/src/llm-config.js)：增加 `getLlmConfigurationState()`。
- [JetBrains 配置读取](../../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/LlmConfig.java)：增加 `ConfigurationState` 与 `getConfigurationState()`。

### 阻止迟到检测结果覆盖新状态

[VS Code 聊天入口](../../packages/vscode-extension/src/chat/chat-view.js)记录检测请求身份及目标视图。视图替换、关闭，或者用户已更新全局连接后，尚未返回的旧检测结果被忽略。

[JetBrains 聊天入口](../../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConversationView.java)在 UI 更新前复查 CLI 身份、配置 revision、项目及视图存活状态。读取失败使用中英文诊断提示，明确区别于“尚未配置”。

### 全局连接修改显示受影响范围

VS Code 在应用全局连接变更时，明确提示已请求停止多少个运行中的会话，以及新连接在后续消息生效。现有凭据和连接更新的停止策略继续使用。

会话级模型覆盖、共享模型推荐目录和默认值同步仍需后续实现。本批没有把预设字符串直接替换成某个新型号，也没有宣称第 4.4 节全部完成。

## 验证

Windows x64，Node `22.22.2`，Vitest `4.1.11`。Java 使用实际验证的 IDE 内置 **JBR / javac 21.0.3**；先前临时目录中的工具链不完整，未作为通过依据。

| 检查                            | 结果                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| VS Code 完整单元套件            | 319 项通过，0 失败、0 跳过；包含本批新增的 11 项配置和聊天入口用例                                  |
| CLI 仓库内的扩展兼容回归        | 4 个文件、80 项通过，覆盖旧字段读取、配置面板、连接测试和 Webview 协议                              |
| CLI 能力诊断合同及真实进程检查  | 2 个文件、29 项通过；覆盖禁止网络、禁止密钥解析、禁止写入和损坏配置的实际 CLI 行为                  |
| JetBrains 编译与定向 JUnit      | Kotlin / Java / 测试编译成功，2 个 JUnit 类共 31 项通过，0 失败、0 跳过；包含空格覆盖路径的最终复测 |
| JavaScript 语法、格式及文档检查 | `node --check`、Prettier、本地链接检查及 `git diff --check` 通过                                    |

VS Code 的 33 项定向测试包含在完整 319 项内，不重复累加。测试使用注入的 CLI 输出、读取异常及异步时序；CLI 诊断集另包含实际子进程验证。本批不调用真实模型。

收尾另补 Webview 在提示投递时关闭的回归：该提示失败不会导致面板初始化拒绝。完整套件已再次通过。ESLint 因本地缺少 `@eslint-community/eslint-utils` 未能启动，此项不记为通过。

主要命令：

```bash
# packages/vscode-extension
npm run test:unit

# packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/vscode-ext-chat-panel.test.js __tests__/unit/vscode-ext-llm-config-detect.test.js __tests__/unit/vscode-ext-llm-connection-test.test.js __tests__/unit/vscode-ext-chat-webview-protocol.test.js --maxWorkers 1
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/llm-capabilities.test.js __tests__/integration/llm-capabilities-cli.test.js --maxWorkers 1

# packages/jetbrains-plugin；使用经验证的 Java 21 工具链并启用离线模式
gradlew --offline --no-daemon test --tests com.chainlesschain.ide.LlmConfigTest --tests com.chainlesschain.ide.LlmConnectionPanelTest
```

## 交付范围

本批为源码和本地验证结果，尚未发布，也未执行真实 IDE 窗口上的首次安装旅程。正式任务 campaign、发布门禁与公开包验收继续各自记录，本地通过不增加其任务合格数。

后续进展：CLI 与双 IDE 的新连接推荐已接到共享目录，并补充协议一致性和旧配置保留回归，见[第三批实施记录](./cli-ide-llm-onboarding-progress-2026-10-27.md)。会话级模型选择与全局连接修改的隔离、独立产物验收、Codex 兼容证据和 MCP 检索效率继续跟踪。
