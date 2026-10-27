# CLI / IDE 差距优化第三批：共享模型推荐与连接测试协议

日期：2026-10-27。承接[差距复核报告](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.4、4.5 节及[第二批配置体验记录](./cli-ide-llm-configuration-progress-2026-10-27.md)。本批完成新连接推荐的共享来源、已有配置保留，以及连接测试与现有模型能力 profile 的协议对齐。

## 新连接推荐使用同一份目录

新增[推荐目录](../../packages/cli/src/lib/llm-onboarding-catalog.json)，由 CLI setup 直接读取，再通过[同步脚本](../../packages/cli/scripts/sync-llm-onboarding.mjs)生成 VS Code 的 JSON 和 JetBrains 的 Java 预设区段。目录包含 10 个原生服务预设以及 CLI 现有的代理、自定义选项；双 IDE 保持原有的自定义协议表单。

本批对齐的主要推荐值：

| 提供商    | 新连接推荐          | 依据与范围                                               |
| --------- | ------------------- | -------------------------------------------------------- |
| OpenAI    | `gpt-6.1-sol`       | 对齐项目已维护的精确能力 profile；官方端点使用 Responses |
| Anthropic | `claude-sonnet-5-5` | 对齐项目已维护的精确能力 profile；继续使用 Messages      |
| Ollama    | `qwen2.5:7b`        | CLI 与原有 IDE 建议一致；仍需用户自行安装本地模型        |
| MiniMax   | `MiniMax-Text-01`   | IDE 与原有 CLI 建议一致；没有将这次同步作为上游能力刷新  |

其他预设维持已有选择。中文 CLI 名称及 IDE 显示名称由同一目录分别提供；火山引擎视觉模型建议也从目录读取，移除表单中的重复字符串。

该目录的 `scope` 为 `new-connections`，`capabilityCatalogVersion` 仍为现有能力目录版本 `2026-10-15`，并保留 `runtimeVerified:false`、`accountVerified:false`。它没有把产品可用、API 文档支持、账号权限和实际运行验证合并为一个结论，也没有完成 Terra 或全部提供商的最新能力核对。

生成摘要使用 UTF-8 内容并统一为 LF 后计算 SHA-256，避免 Windows 与其他系统的换行差异导致误报。同步脚本支持 `--check`，CLI CI 已接入该检查，阻止三端推荐再次独立漂移。生成区段之外的 Java 代码保持原有维护方式。

```bash
# 仓库根目录：修改目录后生成并检查
node packages/cli/scripts/sync-llm-onboarding.mjs
node packages/cli/scripts/sync-llm-onboarding.mjs --check
```

## 加载旧配置保留模型与端点

[CLI setup](../../packages/cli/src/commands/setup.js)读取配置时不解析密钥，读取失败明确退出。同一提供商已保存的非空模型、端点作为再次设置的初始值；选择其他提供商时才使用对应新推荐。保存凭据仍沿用原有事务与验证流程。

VS Code 和 JetBrains 加载表单时保留已保存的模型、视觉模型与网关地址；用户明确选择服务预设后才应用新推荐。OpenAI 等基础协议的自定义地址显示为自定义模式。火山引擎、DeepSeek 等提供商的自定义地址仍保留其提供商身份，避免加载表单就改变密钥复用判断及费用识别。

默认运行配置、运行时旧模型回退及代理预设未随新推荐自动迁移。用户已有的 `gpt-4o`、自建网关别名等不会因加载配置或扩展升级而被替换。

## 连接测试复用现有协议适配器

[CLI 连接测试](../../packages/cli/src/lib/llm-connection-probe.js)先根据模型、提供商和端点解析现有能力 profile。官方端点中选择 Responses 的精确模型，通过已有 [Responses 编解码器](../../packages/cli/src/lib/openai-responses.js)构造请求、提取最终回答及解析用量；自定义网关仍保留兼容协议行为。

测试请求继续限制为一次，输出上限为 1024 token；Responses 使用 `store:false`，不增加自动重试或协议回退请求。未完成响应、没有最终文本或 HTTP 200 内的 provider 错误均不能显示为连接成功。错误提示不回显 provider 错误正文或私有推理内容。

Responses 的输出计数保留已包含的 reasoning token，缓存输入与普通输入分开计算，避免重复计费。已返回用量在失败回执中保留；缺失、畸形或不支持的缓存写入信息仍记为未知，价格未知也保持未知，不显示为免费。费用结果继续为 token 估算，`billingVerified:false`。

官方参考：[GPT-6.1 Sol 模型说明](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[文本生成](https://developers.openai.com/api/docs/guides/text)、[推理与输出耗尽](https://developers.openai.com/api/docs/guides/reasoning)。本批只核对连接测试与已有适配器的接线，没有执行真实模型请求。

## 验证

验证环境为 Windows x64、Node `22.22.2`、Vitest `4.1.11`；JetBrains 使用实际验证的 JBR / javac `21.0.3`，离线 Gradle 编译。

| 检查                           | 结果                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| CLI 定向与兼容回归             | 14 个文件、345 项通过，0 失败；覆盖共享推荐、setup、连接测试、Responses、能力 profile、配置诊断和双 IDE 兼容入口                |
| VS Code 完整单元套件           | 首轮 320 项全部通过；最终表单修复后的完整复测为 319 项通过、1 项 Windows 进程查询超时失败                                       |
| VS Code 超时用例隔离复查       | 未改动该诊断实现及断言；`verify01-diagnostic.test.cjs` 3 项全部通过，其中进程清理测试完成于约 24 秒                             |
| JetBrains 编译与 JUnit         | Kotlin / Java / 测试编译成功；`LlmConfigTest` 28 项、`LlmConnectionPanelTest` 5 项，共 33 项通过，0 失败、0 跳过                |
| 共享目录同步、语法、格式与文档 | 生成同步 `--check`、修改入口的 `node --check`、Prettier、146 个本地文档链接及 `git diff --check` 通过                           |
| 真实进程配置集成               | `llm-connection-config.test.js` 2 项在保存凭据时被 `owner-only native ACL verification failed` 阻断；尚未进入连接测试，不计通过 |

最终完整 VS Code 复测中的失败来自 `verify01-diagnostic.test.cjs`：调用 Windows PowerShell 获取进程身份时 `spawnSync ... ETIMEDOUT`，未达到测试期望的清理截止错误；隔离复查通过。本批表单与配置回归均已通过，仍保留该完整运行的失败记录，不将隔离复查写成整套再次通过。

CLI 早期分批运行的 86 项及后续 91 项包含在最终 345 项中，不重复累加。两项 ACL 阻断测试使用本机模拟 HTTP 服务，未访问真实模型；没有为通过测试而降低 Windows 凭据权限校验。ESLint 沿用第二批记录的本地依赖缺失问题，未获得通过结果。

主要命令：

```bash
# packages/cli：最终 14 个套件，使用本地 Vitest
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/llm-onboarding-catalog.test.js __tests__/unit/setup-deployment-readiness.test.js __tests__/unit/llm-connection-probe.test.js __tests__/unit/agent-core-openai-responses.test.js __tests__/unit/llm-capabilities.test.js __tests__/integration/llm-capabilities-cli.test.js __tests__/integration/setup-flow.test.js __tests__/unit/llm-connection-config.test.js __tests__/unit/model-capabilities.test.js __tests__/unit/llm-providers.test.js __tests__/unit/vscode-ext-chat-panel.test.js __tests__/unit/vscode-ext-llm-config-detect.test.js __tests__/unit/vscode-ext-llm-connection-test.test.js __tests__/unit/vscode-ext-chat-webview-protocol.test.js

# packages/vscode-extension
npm run test:unit
node --test --test-reporter=spec test/verify01-diagnostic.test.cjs

# packages/jetbrains-plugin：JAVA_HOME 指向已验证的 JBR 21
gradlew --offline --no-daemon test --tests com.chainlesschain.ide.LlmConfigTest --tests com.chainlesschain.ide.LlmConnectionPanelTest
```

## 交付范围与后续

本批为源码和本地回归，尚未发布。Windows、Linux、macOS 的准确提交 CI 门禁、真实账号的付费测试和真实 IDE 窗口中的安装旅程仍需分别验证；本地用例不增加正式任务 campaign 的合格数。

后续进展：双 IDE 会话级模型覆盖、标签恢复及查询代次保护已完成源码接线和本地回归，见[第四批实施记录](./cli-ide-session-model-progress-2026-10-27.md)。模型能力变化追踪、Terra 精确 profile、Codex 兼容证据、MCP 检索与 Memory 性能仍按复核报告继续推进，不以本批关闭整份 IDE-03 或模型更新验收。
