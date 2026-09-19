# 第四十四次工程实施：受治理单次浏览器按键

日期：2026-09-20

## 本批结论

本批继续收敛 G03 的通用键盘动作缺口。现有 `browser:action:keyboard` 能接收 text、preset、element、任意组合和延迟，直接进入 `KeyboardAction`；它是历史兼容面，不适合作为 Agent 的最小权限入口。

本批新增独立的 browser keyboard action authority 与 `browser:action:key-press`。新入口只允许一次规范化按键：一个有限 key、最多四个标准 modifier 和一个有界 delay。任意文本、preset、element 定位、按键序列、长按回调，以及会绕过导航/标签页/下载等专用合同的浏览器全局快捷键，都在 authority 和 BrowserEngine 访问前失败关闭。

## 主要实现

### 1. Keyboard action authority v1

签名 deployment 的新工厂 `createBrowserKeyboardActionAuthority()` 提供：

- 强制 `interactive` 审批；
- 强制 `authenticated-durable-readback` 结果审计；
- request 绑定 renderer sender、frame URL digest、target、`key-press`、key、规范 modifier 顺序、delay、input digest 和私有 authorization；
- receipt 只保存 key+modifier 摘要，不保存原始 key；
- 成功或失败 outcome 绑定 action receipt、request、target、operation、input digest 和结果摘要；
- 一次性 issued state 防止替换 target、key、modifier、delay 或重复结算。

factory 仍由部署模块摘要约束，Desktop 只能取得品牌化窄 host，不能得到策略或 audit writer。

### 2. 有限按键语法与专用合同隔离

可授权 key 只包括：

- 单个 ASCII 字母或数字；
- Enter、Escape、Tab、Space、Backspace、Delete、Insert；
- 四个方向键和 Home/End/PageUp/PageDown。

modifier 只允许 Control、Alt、Shift、Meta，去重后按固定顺序规范化。delay 必须为 0–5000 毫秒的安全整数。

协议层额外拒绝已知浏览器全局快捷键，包括：

- back/forward/refresh；
- 地址栏、打开/关闭/恢复标签页与新窗口；
- history、downloads、打开文件、保存、打印和查看源代码；
- DevTools、隐身窗口和退出应用等组合。

这些操作不能借 keyboard authority 绕过 navigation、未来 tab/download 合同或产品控制面。Enter 等可能触发页面业务副作用的按键仍必须由 interactive policy 按任务上下文显式批准。

### 3. Desktop IPC 与执行边界

新增 `browser:action:key-press`：

1. 在 BrowserEngine 访问前取得绑定 key 的一次性 grant；
2. 紧邻 `KeyboardAction.execute()` 前消费 grant；
3. 只向旧动作模块传入已规范化的 `keys`、`modifiers` 和 `delay`；
4. 成功与失败都取得认证、耐久、精确回读的 audit acknowledgement 后返回；
5. outcome 证据不包含原始 key。

preload 只开放新的受治理 channel。旧 `browser:action:keyboard`、workflow/replay 和人工 UI 兼容通道没有被误标为已治理 Agent 入口，仍需后续身份隔离或迁移。

## 负例覆盖

本批新增以下验证：

1. key、modifier 和 delay 被规范化并绑定到一次性 receipt；
2. receipt/outcome 不包含原始 key；
3. text、preset、element、嵌入式组合字符串、未知 modifier 和错误 input digest 被拒绝；
4. F1–F12、Alt+ArrowLeft、Control+t、Meta+l、Control+PageDown 等保留快捷键不能借新入口执行；
5. target、key、modifier 替换及 grant/outcome 重放被拒绝；
6. authority 缺失时，在 BrowserEngine 访问前拒绝；
7. 成功 key press 紧邻消费 grant，并在返回前完成耐久审计；
8. signed deployment 只暴露 opaque Desktop keyboard host，替换模块摘要失败关闭。

## 验证结果

```text
CLI      Test Files  3 passed (3)   Tests  79 passed (79)
Desktop  Test Files  4 passed (4)   Tests  65 passed (65)
Total    Test Files  7 passed       Tests  144 passed
```

相关 JavaScript 文件通过 ESLint（0 errors，10 个既有 unused-variable warnings）和 Prettier。

## 仍未完成

- popup、新标签页和下载尚未纳入独立可执行合同；
- 任意文本、focus/preset、按键序列、长按回调和跨动作组合仍没有逐步授权、预算、停止与恢复合同；
- 旧 `browser:action:keyboard`、人工 UI、显式 workflow/replay 等兼容通道仍需产品身份模型证明 Agent 无法间接调用；
- operator 生产 authority/audit writer、真实用户/任务/tenant/DID/RBAC/页面敏感度与隐私审批、不可逆副作用恢复、断电/进程崩溃审计演练及真实 Electron/browser/provider E2E 仍待目标环境完成。
