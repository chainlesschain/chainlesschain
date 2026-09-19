# 第四十五次工程实施：受治理显式新标签页

日期：2026-09-20

## 本批结论

本批继续收敛 G03 的新标签页缺口。历史 `browser:openTab` 会直接创建页面并导航；它面向人工 UI 和兼容调用，没有 Agent 专属的交互审批、一次性 grant、重定向 origin 约束或耐久结果审计。

本批新增独立 browser tab-open action authority 与 `browser:action:open-tab`。新入口只允许在一个既有 profile 中打开一个规范 HTTP(S) 地址，授权同时绑定有限重定向 origin、加载条件和超时。BrowserEngine 在新页面发出首个导航请求前安装 main-frame route guard；越界初始地址会在创建页面前拒绝，越界重定向会中止并关闭、移除半创建页面。

## 主要实现

### 1. Tab-open action authority v1

签名 deployment 的新工厂 `createBrowserTabOpenActionAuthority()` 提供：

- 强制 `interactive` 审批；
- 强制 `authenticated-durable-readback` 结果审计；
- request 绑定 renderer sender、frame URL digest、profile、`open-tab`、规范化目的 URL、有限 redirect origin 集合、waitUntil、timeout、input digest 和私有 authorization；
- receipt 只保存目的 URL 与 origin 集合的摘要，不保存原始 URL；
- 成功或失败 outcome 绑定 action receipt、request、profile、operation、input digest 和结果摘要；
- 一次性 issued state 防止替换 profile、URL、origin、加载参数或重复结算。

factory 继续由认证 deployment 模块摘要约束；Desktop 只取得 opaque 窄 host，不能取得 policy 或 audit writer。

### 2. 新标签页首请求与重定向约束

`BrowserEngine.openTab()` 现在可接收治理入口传入的 `allowedRedirectOrigins`：

1. 初始 URL 不属于授权 origin 时，在 `context.newPage()` 前失败关闭；
2. 新页面创建后、`page.goto()` 前安装 main-frame route guard；
3. 只有明确列入 grant 的 HTTP(S) origin 能继续首请求和后续重定向；
4. 导航、标题读取或 guard 失败时，从页面映射移除 target 并关闭半创建页面；
5. 成功或失败后均移除临时 route guard。

未提供该字段的历史人工 `browser:openTab` 保持兼容语义；它没有被误标为 Agent 治理入口。

### 3. Desktop IPC 与结果证据

新增 `browser:action:open-tab`：

- authority 在 BrowserEngine 访问前执行；
- grant 紧邻 `openTab()` 副作用前消费；
- 引擎只接收 host 规范化后的 profile、URL、origin、waitUntil 与 timeout；
- 成功和失败都必须取得认证、耐久、精确回读的 acknowledgement 后返回；
- outcome 只发送 target 与最终 URL 的摘要，不把原始 target/URL 写入 authority audit 请求。

preload 只增加新治理 channel。旧 `browser:openTab`、`browser:closeTab`、`browser:focusTab`、页面自行发起的 popup，以及 workflow/replay 等兼容入口仍需身份隔离或独立合同。

## 负例覆盖

本批新增以下验证：

1. profile、URL、redirect origins、waitUntil 与 timeout 绑定一次性 receipt；
2. receipt/outcome 不保存原始目的 URL、最终 URL 或 target；
3. `file:`、带凭据 URL、缺失初始 origin、未知 option 和错误 input digest 在 policy/BrowserEngine 前拒绝；
4. profile、URL、origin 范围替换以及 grant/outcome 重放失败关闭；
5. authority 缺失时，在 BrowserEngine 访问前拒绝；
6. 初始 URL 越界时不创建页面；
7. 跨 origin 重定向越界时请求被中止，半创建页面被关闭并从映射移除；
8. signed deployment 只暴露 opaque Desktop tab-open host，替换模块摘要失败关闭。

## 验证结果

```text
CLI      Test Files  3 passed (3)   Tests  78 passed (78)
Desktop  Test Files  5 passed (5)   Tests  75 passed (75)
Total    Test Files  8 passed       Tests  153 passed
```

相关 JavaScript 文件通过 ESLint（0 errors，10 个既有 unused-variable warnings）和 Prettier。

## 仍未完成

- 页面脚本、链接 target 或浏览器事件自行产生的 popup/新页面还没有在请求发生前取得专属 grant；
- 下载的触发、路径、内容类型、大小、摘要、恶意文件检查、取消与耐久证据尚未形成浏览器执行合同；
- 旧 `browser:openTab`/`closeTab`/`focusTab`、旧 keyboard、人工 UI、显式 workflow/replay 等兼容通道仍需产品身份模型证明 Agent 无法间接调用；
- 任意文本、按键序列、多步任务、operator 生产 authority/audit writer、真实 DID/RBAC/隐私审批、崩溃演练及真实 Electron/browser/provider E2E 仍待完成。
