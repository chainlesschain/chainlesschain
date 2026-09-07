# IDE 工作台、技能库与 LLM 配置页面

以下功能适用于 CLI `0.166.30` 和 IDE 插件 `0.37.87` 起的版本；只有通过
发布门禁的版本才会上传到 npm / Open VSX。无需启动 Electron 桌面客户端
即可在 VS Code / VSCodium 中打开页面。

## 演化工作台

命令面板运行 `ChainlessChain：演化工作台`：先进入概览页，显示连接模式、
候选数、待审核数、运行状态、当前发布和最近可回滚发布。不要求先输入检索词。

- 左侧直接浏览版本，也可按状态或关键词筛选。
- 点击版本查看内容差异、审核证据、评测和实际使用记录。
- 使用“返回概览”回到首页；“原始记录”保留完整 JSON 检查入口。
- 批准、拒绝、回滚只在宿主声明支持时开放。必须填写原因，再通过 IDE 原生确认框。
- 页面过期时拒绝提交；每次操作前重新读取状态，后端仍独立验证身份、权限和审批证据。
- 未连接时仍保留页面和“连接配置”入口，不发送不受支持的工作台 RPC。

“连接配置”选择受信任的工作台 profile JSON。隔离本地测试环境的初始化、验证方式见
[启动指南](EVOLUTION_WORKBENCH_STARTUP.md)。`local-test` 始终显示测试标识；
不代表已接入真实组织身份或真实审批服务。

## 技能库

运行 `ChainlessChain：技能库（浏览与检索）`，原命令 ID
`chainlesschain.skills.retrieve` 保持兼容。

首页通过当前 CLI 在当前项目目录执行 `skill list --json`，展示技能卡片、
来源、分类、版本、说明、标签，以及每页 12 项的分页。名称、说明、标签筛选在本地进行。

需要推荐时展开“按任务检索”，调用原有 `skill search … --json`，仍校验规范
摘要、冲突及反馈/向量证据。检索最多返回 64 项，可查看“检索依据”或返回全部技能。
卡片详情与“复制技能 ID”均不执行技能、不生成授权。含执行入口不等于当前有运行权限。

## 自定义 LLM / 中转站

运行 `ChainlessChain：配置大模型`，在同一表单中完成：

1. 选择已有服务预设，或“自定义 / 中转站”。
2. 自定义服务选择 OpenAI Chat Completions、Anthropic Messages、Gemini 或 Ollama 兼容协议。
3. 填写基础地址、任意文本模型 ID/别名、可选视觉模型和该服务的 API Key。
4. 保存后点击“测试已保存连接”。测试发送一次简短请求，真实服务可能收费。

基础地址可以包含中转站自定义路径，例如 `https://relay.example/proxy/v1`，
不要包含 `/chat/completions` 等最终接口；不支持 URL 内嵌密码、查询参数鉴权、
任意自定义请求头或 Responses-only 接口。远程明文 HTTP 需要单独确认。

同一协议、同一基础地址可留空密钥保留原值；更换地址必须提供对应密钥，
不会把旧站点密钥自动复用给新站点。保存采用新命令 `llm configure`，配置 JSON
经 stdin 传入，一次锁与原子写入绑定地址、模型及凭据。密钥不进入进程参数、
IDE 设置或 Webview 回显；沿用 CLI 的系统密钥存储/仅限所有者访问的配置存储。

公开安装的旧 CLI 不含 `llm configure` 时，页面会提示更新，不会退回多步部分保存。
开发环境可设置机器级 `chainlesschain.llm.configurationCliPath` 为当前源码
`packages/cli/bin/chainlesschain.js` 的绝对路径，仅供配置和连接测试使用；
普通聊天 CLI 与演化测试环境仍彼此独立。

## 验证

在 `packages/vscode-extension` 运行：

```powershell
npm.cmd run test:unit
npm.cmd run test:settings-ui
```

第二条需要仓库已有 Playwright 与 Chromium。测试使用真实页面和消息控制器、
明确的模拟宿主服务，检查三个页面的默认入口、交互、密钥不回显、文本注入与窄屏布局；
截图写入独立系统临时目录。它不是生产治理认证测试。

CLI 回归：

```powershell
cd packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/llm-connection-config.test.js __tests__/unit/llm-test-target-resolution.test.js __tests__/integration/llm-connection-config.test.js
```

真实身份与审批上线还必须具备实际身份/组织、认证服务、审批服务及信任根；
不能将本地测试 DID、测试签名或演示确认框当成生产认证。
