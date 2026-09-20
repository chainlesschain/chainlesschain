# 第四十六次工程实施：浏览器 Popup 失败关闭边界

日期：2026-09-20

## 本批结论

本批继续收敛 G03 的页面自行新建窗口缺口。仅治理显式 `browser:action:open-tab` 仍不足以阻止已批准页面通过 `window.open()`、`target=_blank` 或等效 popup 绕过 tab-open authority。

`BrowserEngine.createContext()` 现在为每个 Playwright BrowserContext 安装 deny-by-default 页面来源 guard。只有经 `BrowserEngine.openTab()` 显式创建并加入批准集合的 Page 才能继续主 frame 网络导航；带 opener 的页面会立即关闭，未登记页面的导航请求会在 context route 层以 `blockedbyclient` 中止。

## 主要实现

### 1. BrowserContext 页面来源隔离

每个新 context 维护私有 WeakSet：

- `approvedPages` 只接收 `BrowserEngine.openTab()` 返回的明确页面；
- `blockedPages` 防止同一 popup 重复关闭或重复产生事件；
- 集合不暴露给 renderer、Agent 或页面脚本。

context 级 `"**/*"` route 对每个 navigation request 读取所属 Page：

- Page 已在 `approvedPages` 时继续交给 page route 或网络层；
- 未登记 Page 的主 frame 导航在网络继续前 abort；
- 无法归属 Page 的导航同样失败关闭；
- 子资源和已批准页面的请求保持原行为。

### 2. Popup 关闭与证据边界

BrowserContext 的 `page` 事件会查询 Playwright `page.opener()`：

- opener 非空即认定为页面自行 popup；
- popup 仅关闭一次，并产生不含 URL 的 `tab:popup-blocked` 事件；
- opener 归因失败时也按失败关闭处理；
- 显式 `context.newPage()` 返回后由 `BrowserEngine.openTab()` 加入批准集合。

这使视觉点击、坐标点击、单次按键或旧页面脚本不能用 popup 取得新的可导航 Page。已有显式新标签页仍需上一批 tab-open authority 批准 URL 与 redirect origins。

### 3. 兼容与限制

该 guard 作用于 BrowserEngine 创建的全部 context，因此历史人工页面中的 page-initiated popup 也会被阻断；人工显式 `browser:openTab` 仍由同一个 `BrowserEngine.openTab()` 创建，保持可用但仍属于待隔离兼容入口。

本批证明的是未登记页面的网络导航在 context route 层被拒绝，并及时关闭 popup。无网络的瞬时 `about:blank` Page 可能在 close 前短暂存在，因此尚不能把它表述为“popup 从未被创建”，也没有提供可授权 popup 合同。

## 负例覆盖

本批新增以下验证：

1. `createContext()` 必须安装 context route 和 page 来源监听；
2. 显式 `BrowserEngine.openTab()` 页面加入批准集合，其导航可继续；
3. 带 opener 的 popup 会关闭；
4. popup 的主 frame navigation 被 `blockedbyclient` 中止；
5. popup 重复经过 page 与 route 边界时只关闭一次；
6. 原有显式新标签页、navigate、history、IPC 与 signed deployment 回归保持通过。

## 验证结果

```text
Desktop  Test Files  5 passed (5)   Tests  78 passed (78)
```

相关 JavaScript 文件通过 ESLint 和 Prettier（0 errors）。

## 仍未完成

- 尚无允许特定 opener/URL/origin 的交互式 popup authority；无网络 `about:blank` 瞬时页面在 close 前的全部本地副作用尚未由独立浏览器进程策略证明不可发生；
- 下载仍缺少真实完成信号、大小硬限制、SHA-256、可信临时路径、恶意文件检查、取消以及耐久结果证据；
- 旧 `browser:openTab`/`closeTab`/`focusTab`、旧 keyboard、人工 UI、显式 workflow/replay 等兼容通道仍需产品身份隔离；
- operator 生产 authority/audit writer、真实 DID/RBAC/隐私审批、进程崩溃演练及真实 Electron/browser/provider E2E 仍待完成。
