# 第一百九十三次工程实施：旧 Web Search IPC 与查询诊断退役

## 本批目标

移除没有 renderer 消费者的旧 Web Search IPC 与 preload 表面，阻止渲染进程绕过项目聊天流程直接发起外部搜索、传入 Bing 凭据或格式化任意结果；保留项目聊天实际使用的主进程内部搜索工具，并收紧其普通诊断输出。

## 实施结果

- Phase 1 删除 Web Search IPC 的唯一生产注册点，注册模块数从 18 个无条件模块降为 17 个。
- 删除 `webSearch:search`、`webSearch:duckduckgo`、`webSearch:bing`、`webSearch:format` 四个无消费者 handler 及专用 IPC 模块。
- preload 删除对应 `electronAPI.webSearch` 包装，renderer 不再取得直接搜索、调用指定 provider 或格式化搜索结果的入口。
- 项目聊天仍直接引用主进程内部 `web-search` 工具；其 `search`、`searchDuckDuckGo`、`searchBing`、`formatSearchResults` 和 `enhanceChatWithSearch` 合同由 Phase 回归锁定。
- DuckDuckGo、Bing、fallback 和搜索增强日志改为固定事件，不再记录查询正文、结果数量或 caught Error。
- Bing 响应解析和网络失败只向内部调用方返回固定异常，不再传播上游错误对象或正文；同时清理未使用的 `http`、language 与 Promise reject 变量。

## 回归与门禁

- Phase 定向回归：1 test file、53 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,226 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 项目聊天 IPC 自身仍需完成生产 actor/tenant/用途授权，并把搜索请求绑定到真实会话和任务 owner。
- Bing API key 仍由内部调用参数传入，尚未接入独立凭据托管、短期 capability 或 provider 级密钥轮换。
- 出站网络仍缺 operator allowlist、请求级预算/速率、DNS/重定向策略和耐久审计。
- 搜索结果正文仍会进入模型上下文，尚未建立来源证明、内容分类、提示注入扫描和字段级最小披露。
- 真实 DuckDuckGo/Bing 网络、Electron 项目聊天和 provider 联调 E2E 仍待完成。
