# 第三十八次工程实施：独立审批与耐久审计的 Agent 导航入口

日期：2026-09-19

## 本批结论

本批继续收敛 G03，为单次 Agent URL 导航增加独立的 navigation action authority、Desktop opaque host 和 `browser:action:navigate` IPC。该合同不伪造截图关联，也不复用视觉点击或文本输入许可；普通用户界面的 `browser:navigate` 兼容入口保持不变。

这完成的是一个明确 Agent 入口的初始 URL 授权、一次性消费和结果审计，不代表全部自动化导航路径已经收口。旧 `BrowserAutomationAgent`、`ComputerUseAgent`、workflow/replay 仍存在直接导航路径，跨 origin 重定向也尚无请求级拦截，因此 G03 继续为“部分完成”。

## 主要实现

### 1. 独立 navigation authority

新增 `browser-navigation-action-authority.js`：

- descriptor 强制 `interactive` 审批和 `authenticated-durable-readback` 审计；
- authority request 绑定 renderer sender、frame 摘要、target、操作、规范化目标 URL、`waitUntil`、timeout 和授权材料；
- URL 只允许 HTTP/HTTPS，拒绝内嵌用户名/密码、无效 URL 和超过 16 KiB 的值；
- 策略 handler 可在批准前读取规范化目标 URL，但 receipt 和 outcome evidence 只保留 destination/input/result digest，不耐久保存 URL；
- grant 最长 30 秒、一次性消费，target、URL、等待策略或 timeout 替换均失败关闭；
- 成功结算后不能再次记录结果。

### 2. Desktop 动作边界

新增 `desktop-browser-navigation-action.js`，把签名 authority 缩窄为不暴露原始端口的 opaque host：

1. Browser IPC 在浏览器引擎访问前请求短期 action grant；
2. 主进程取得引擎后，在 `engine.navigate()` 紧邻前消费 grant；
3. 成功结果把最终 URL 转为摘要，失败结果使用固定失败分类；
4. 两类结果都必须取得认证、耐久、精确回读的 acknowledgement 后才返回；
5. 页面已经导航但审计确认不明时抛出 `CC_AGENT_ACTION_AUDIT_UNCERTAIN`，不会自动重放。

### 3. 产品与签名部署接线

- 新增 renderer 可调用的 `browser:action:navigate`，并同步 preload 能力清单；
- 原 `browser:navigate` 保留为用户 UI 兼容通道，避免把用户操作授权与 Agent 审批混为同一合同；
- 签名 Desktop deployment loader 新增 `createBrowserNavigationActionAuthority`，强制 handler artifact digest 等于已认证模块摘要；
- Desktop loader 只接受枚举 data property，并通过已认证 capture 函数生成 `desktopBrowserNavigationActionHost`；
- Browser IPC handler 计数由 23 更新为 24。

## 负例覆盖

本批新增或扩展以下验证：

1. `file:`、带用户名/密码 URL 和伪造 input digest 在策略 handler 前被拒绝；
2. authority 拒绝不会签发 receipt；
3. outcome target 替换、重复结算和 receipt 重放失败关闭；
4. Desktop grant 绑定 URL 与导航参数，替换或二次消费被拒绝；
5. 缺少 navigation host 时，IPC 在浏览器引擎访问前拒绝；
6. 成功与失败导航都产生耐久审计证据，审计调用不包含原始 URL；
7. 外部模块不能以错误 handler digest 伪装为签名部署的 navigation authority。

## 验证结果

视觉/导航 authority、Desktop adapter、deployment、模型入口、动作与 IPC 相关回归：

```text
Test Files  12 passed (12)
Tests       187 passed (187)
```

相关 JavaScript 文件通过 ESLint（0 errors，保留 10 个既有 unused-variable warnings），全部本批文件通过 Prettier。

## 仍未完成

- 旧 `BrowserAutomationAgent`、`ComputerUseAgent`、workflow、recording replay 等直接导航路径尚未统一改为此 authority 或显式失败关闭；
- 初始 URL 获得批准后，跨 origin 重定向尚无网络请求级预阻断；最终 URL 目前仅在动作后以摘要审计；
- back/forward/refresh、通用键盘动作和多步视觉任务仍无各自的 action 合同；
- operator 尚未签发生产 navigation authority，也未提供真实耐久 audit writer 与 URL/tenant/DID/RBAC/隐私策略；
- 页面不可逆副作用恢复、断电/进程崩溃审计演练和真实 Electron/browser E2E 仍未完成。
