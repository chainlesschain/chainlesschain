# CLI / IDE 差距优化第四批：会话模型与全局连接隔离

日期：2026-10-27。承接[差距复核报告](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.4 节及[第三批共享推荐记录](./cli-ide-llm-onboarding-progress-2026-10-27.md)。本批在 VS Code 和 JetBrains 增加会话级模型覆盖，复用各自已有的独立子进程、持久化及 CLI 参数接口。

## 用户入口

双 IDE 的斜杠命令补全、帮助与执行目录新增 `/model`：

| 命令                       | 行为                                               |
| -------------------------- | -------------------------------------------------- |
| `/model`                   | 查看当前会话选择，并显示覆盖和恢复默认的用法       |
| `/model team/custom-alias` | 仅为当前会话选择指定模型，支持端点提供的自定义别名 |
| `/model --default`         | 清除当前会话覆盖，继续跟随 IDE / CLI 连接默认模型  |

`default` 本身仍可作为模型别名；恢复默认使用明确的 `--default` 参数。模型 ID 长度上限为 256，拒绝空白、控制字符及当前 Windows 命令路径不接受的 shell 语法；错误提示不回显提交的无效内容。标签恢复时也验证持久化值，旧记录没有该字段时继续使用默认模型。

该操作保留当前提供商、基础地址及凭据来源，只覆盖模型 ID。选择不会写入全局连接配置，也不触发模型请求、自动连接测试或账号权限验证。更换全局提供商后，会话仍保留明确选择的模型；用户可选择新端点支持的型号或执行 `/model --default`。

## 切换与任务执行

A 会话选择新模型时，A 的当前任务继续使用原进程；B 会话的模型、子进程与任务不变。待 A 空闲后的下一次输入，才停止 A 的旧进程并以原 session ID 和新模型重建，保留已有对话。

审批等待、已经开始准备的输入和运行中的任务继续使用原进程。运行时提交的排队输入也留在该进程中；本批没有把队列迁移到另一个模型。提示明确使用“下一次空闲输入生效”，避免将当前任务中途换模。

VS Code 的持久化输入路径先等待旧进程确认结束，再准备并发送下一条输入；终止未确认时保留输入，不绕过已有停止屏障。清除覆盖也通过同一路径恢复默认模型。

全局连接变更继续沿用各端现有策略：VS Code 通知所有运行会话停止，并显示受影响数量；JetBrains 按连接配置 revision 在既有重载边界更新。会话模型选择不会调用这些全局重载入口。

## 标签保存与恢复

模型覆盖作为会话标签的非敏感字段保存：

- VS Code 使用现有 workspaceState 的标签快照。
- JetBrains 使用现有 PropertiesComponent 的标签记录。
- 最近关闭的标签重开时保留覆盖；新建独立会话仍跟随连接默认值。

没有把凭据加入标签存储、CLI argv 或新增的子进程环境字段。模型请求仍通过原有 CLI 与安全配置存储解析密钥。

## 上下文与迟到结果

每个会话保留实际启动进程使用的非敏感模型与提供商快照。切换待生效期间，`/context` 和容量指示器继续反映当前进程；重建后再使用新模型。

VS Code 的上下文窗口缓存键加入提供商、模型和端点，切换后清除原会话的旧用量。两端都在应用异步查询结果前复查进程代次，避免旧模型的迟到结果覆盖新状态；JetBrains 在 EDT 上更新窗口缓存及展示状态。

主要实现：

- [VS Code 会话模型校验](../../packages/vscode-extension/src/chat/session-model.js)、[聊天接线](../../packages/vscode-extension/src/chat/chat-view.js)、[命令目录](../../packages/vscode-extension/src/chat/slash-commands.js)。
- [JetBrains 会话模型逻辑](../../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SessionModel.java)、[聊天接线](../../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConversationView.java)、[标签保存与恢复](../../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ChatToolWindowFactory.java)。

## 验证

Windows x64、Node `22.22.2`、Vitest `4.1.11`。Java 使用已验证的 JBR / javac `21.0.3`，Gradle 离线编译。

| 检查                       | 结果                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| VS Code 完整单元套件       | 串行运行 327 项全部通过，0 失败；本批新增 7 项会话模型回归                                            |
| CLI 仓库中的扩展回归       | 5 个文件、115 项通过，覆盖上下文指示器、会话模型、查询参数、斜杠命令及聊天面板                        |
| JetBrains 编译与定向 JUnit | Kotlin / Java / 测试编译通过；4 个测试类、42 项通过，0 失败、0 跳过，其中新增 `SessionModelTest` 3 项 |
| 共享推荐与静态检查         | 共享目录同步检查、JavaScript 语法、Prettier 及 `git diff --check` 通过                                |

VS Code 的 7 项新回归验证双会话隔离、恢复默认后的实际启动参数、标签保存及无效恢复值、关闭重开、无效输入、审批及输入准备边界、实际模型的上下文查询和迟到结果丢弃。它们包含在完整 327 项中，不另外累加。

JetBrains 的 42 项由 `ConversationManagerTest` 14 项、`SessionArgsTest` 12 项、`SlashCommandsTest` 13 项、`SessionModelTest` 3 项组成。纯逻辑测试与完整插件编译覆盖模型选择的合同和接线；尚未执行真实 IDE 窗口中的双任务操作旅程。

主要命令：

```bash
# packages/vscode-extension：使用 package.json 的完整 test:unit 文件列表，串行运行
node -e "const files=require('./package.json').scripts['test:unit'].replace(/^node --test /,'').split(/\s+/);const result=require('node:child_process').spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit',windowsHide:true});process.exitCode=result.status??1"

# packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/vscode-ext-chat-context-indicator.test.js __tests__/unit/vscode-ext-conversation-manager.test.js __tests__/unit/vscode-ext-introspect-commands.test.js __tests__/unit/vscode-ext-slash-commands.test.js __tests__/unit/vscode-ext-chat-panel.test.js

# packages/jetbrains-plugin：JAVA_HOME 指向已验证的 JBR 21
gradlew --offline --no-daemon test --tests com.chainlesschain.ide.SessionModelTest --tests com.chainlesschain.ide.ConversationManagerTest --tests com.chainlesschain.ide.SessionArgsTest --tests com.chainlesschain.ide.SlashCommandsTest
```

## 交付边界

本批已完成源码及本地回归，未发布、未执行真实付费模型调用。第三批记录的两项 Windows 凭据 ACL 集成阻断仍需在具备原生权限条件的环境验证，本批没有修改该安全校验。

327 项完整 VS Code 单元测试本轮通过；第三批出现过的 Windows 进程查询超时保留在原记录中。本地 ESLint 仍沿用第二批依赖缺失的限制，不记为通过。跨平台准确提交 CI、真实 IDE 操作和独立任务验收仍需各自记录，整份 IDE-03 计划尚未全部验收。
