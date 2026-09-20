# 第四十三次工程实施：受治理浏览器历史导航

日期：2026-09-20

## 本批结论

本批继续收敛 G03。旧 `ComputerUseAgent` 已会拒绝 back、forward 和 refresh，但此前没有可执行的受治理替代入口；因此调用方只能停在“禁止”，不能通过一次性审批完成这些操作。

现有 browser navigation action 合同升级为 v3，同一个签名 authority 现在可批准 `navigate`、`back`、`forward` 和 `refresh`。显式 navigate 继续绑定规范化完整 URL；历史操作不在审批前读取或外发浏览器历史 URL，而是绑定具体操作和有限 HTTP(S) origin 集合。BrowserEngine 在页面变更前从 Chromium 历史中解析 back/forward 的真实目标并检查 origin，refresh 则检查当前页面 origin。

## 主要实现

### 1. Navigation action v3

request/receipt 升级为 v3，outcome request 升级为 v2，操作字段现在允许：

- `navigate`：必须绑定非空 HTTP(S) destination，并要求批准集合包含 destination origin；
- `back`、`forward`、`refresh`：destination 必须严格为 `null`，且调用方必须提供至少一个批准 origin；
- 所有操作继续绑定 renderer sender、frame URL digest、target、wait policy、timeout、input digest 和私有 authorization；
- receipt 对历史操作记录 `destinationDigest: null`，但仍记录操作和 redirect origin 集合摘要；
- 一次性 grant 不能跨操作、target、origin 集合或等待参数复用。

历史 URL 不会为了审批而先从浏览器读取并送入 renderer/authority；policy 批准的是“在指定 origin 范围内执行一次 back/forward/refresh”。实际历史目标只在主进程 BrowserEngine 内解析。

### 2. 目标预检与请求级阻断

`BrowserEngine.navigateHistory()` 执行顺序为：

1. 校验 authority 已批准的有限 HTTP(S) origin 集合；
2. 在页面上安装临时主 frame navigation route guard；
3. back/forward 通过 Chromium `Page.getNavigationHistory` 读取相邻目标，目标不存在、历史不可认证或 origin 越界时在页面变更前失败；
4. refresh 在执行前检查当前页面 origin；
5. 执行 Playwright back/forward/reload，并继续阻断跨 origin 重定向；
6. 最终 URL 再次检查 origin，成功或失败后移除 guard 并关闭 CDP session。

guard 在历史读取前安装，避免预检窗口内的网络导航绕过批准范围。普通人工 `browser:navigate` 没有改成 Agent action，也不会自动安装该 guard。

### 3. Desktop IPC 与审计

新增 `browser:action:history`：

- 必须先由签名 deployment 中已有的 navigation authority 签发 grant；
- authority 缺失、操作非法或 origin 范围缺失时，不访问 BrowserEngine；
- grant 在 `navigateHistory()` 前一次性消费；
- 成功与失败均写入现有 authenticated/durable/readback outcome 审计；
- 返回证据只含 authorization、audit 和 durability digest，不把历史 URL 写入 action receipt/outcome。

preload 只新增该受治理 channel 的调用许可，没有恢复 legacy Agent 的直接历史导航路径。

## 负例覆盖

本批新增或调整以下验证：

1. back、forward、refresh 均取得操作绑定且 destination 为空的一次性 receipt；
2. grant 不能换操作、换 origin 集合或重放；
3. 缺少批准 origin 时，在 BrowserEngine 访问前拒绝；
4. back 的批准目标及允许重定向可以完成；
5. forward 的越界历史目标在 `page.goForward()` 前拒绝；
6. refresh 的越界重定向在加载前以 `blockedbyclient` 终止；
7. 成功和失败都会移除临时 route，back/forward 还会关闭 CDP session；
8. navigate v3、签名 deployment 和既有 navigation outcome 绑定继续通过回归。

## 验证结果

```text
CLI      Test Files  2 passed (2)   Tests  71 passed (71)
Desktop  Test Files  4 passed (4)   Tests  61 passed (61)
Total    Test Files  6 passed       Tests  132 passed
```

## 仍未完成

- popup、新标签页和下载仍未纳入独立可执行合同；
- 通用键盘动作及 `executeVisualTask()` 多步变更仍没有逐步授权、预算、停止与恢复合同；
- 人工 UI、显式 workflow/replay 等兼容通道仍需产品身份模型证明 Agent 无法间接调用；
- operator 生产 authority/audit writer、真实用户/任务/tenant/DID/RBAC/页面敏感度与隐私审批、不可逆副作用恢复、断电/进程崩溃审计演练及真实 Electron/browser/provider E2E 仍待目标环境完成。
