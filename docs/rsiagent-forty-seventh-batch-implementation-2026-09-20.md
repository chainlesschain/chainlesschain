# 第四十七次工程实施：未授权浏览器下载失败关闭

日期：2026-09-20

## 本批结论

本批继续收敛 G03 的下载绕过风险。在可信下载工件合同尚未具备真实完成信号、大小硬限制、SHA-256、隔离路径和恶意文件检查前，不能把旧下载入口包装成“已治理”。历史 `FileHandler._downloadViaPage()` 只触发 `<a download>`、等待一秒就报告完成；无 target 时还会退回带调用方 headers/savePath 的无界 fetch。这两条路径都不能提供可信完成证据。

本批改为 deny-by-default：BrowserContext 强制 `acceptDownloads: false`，每个 BrowserEngine Page 监听 download 事件并立即 cancel/delete；旧 `FileHandler.startDownload()` 无论页面或 fetch 分支都只生成脱敏失败记录，不访问 Page、不发网络请求、不写文件，也不再产生虚假的 `downloadStarted`/`downloadCompleted`。

## 主要实现

### 1. BrowserContext 禁止自动接收下载

`BrowserEngine.createContext()` 在合并调用方 options 后强制写入 `acceptDownloads: false`，因此 renderer 或兼容调用不能用同名 option 覆盖失败关闭策略。

每个由 BrowserEngine 观察到或显式创建的 Page 只安装一次 download boundary：

- download event 不读取 URL、suggested filename 或临时路径；
- 立即调用 Playwright `download.cancel()`；
- 随后调用 `download.delete()` 清理由浏览器产生的临时文件；
- 只产生不含下载内容的 `tab:download-blocked` 事件；
- 同一个 Download 对象不会重复取消或删除。

若 Page 不提供事件监听能力，显式 `openTab()` 在导航前失败并关闭页面，不能降级为无下载 guard 的页面。

### 2. 移除旧 FileHandler 虚假成功与 fetch 绕过

`FileHandler.startDownload()` 仍返回兼容形状的失败结果和 downloadId，但执行路径现在：

- 不调用 `browserEngine.getPage()` 或 `page.evaluate()`；
- 不调用全局 fetch，即使 targetId 为空或调用方提供 headers；
- 不使用调用方 savePath，不写文件；
- 不等待固定时间后伪造 completed/progress/hash；
- 失败记录在进入内存历史前将 URL、savePath 和 filename 置空；
- 只增加 failed 统计并发出已脱敏 `downloadFailed`。

旧 MD5、无界内存拼接和 caller-controlled headers/savePath fetch 实现已从该入口移除。

## 负例覆盖

本批新增或收紧以下验证：

1. `acceptDownloads: true` 不能覆盖 BrowserEngine 的 false；
2. Page download event 会执行 cancel 和 delete；
3. 旧页面下载不执行 `page.evaluate()`，不报告成功或进度；
4. targetId 为空时也不能退回 fetch；
5. 调用方 headers/savePath 不触发网络或文件写入；
6. 失败历史与失败事件不保留原始 URL/savePath，且不发 `downloadStarted`；
7. popup、新标签页、导航与 FileHandler 相关回归保持通过。

## 验证结果

```text
Desktop  Test Files  2 passed (2)   Tests  41 passed (41)
```

相关 JavaScript 文件通过 ESLint 和 Prettier（0 errors）。

## 仍未完成

- 尚未提供可授权下载合同：需要绑定 URL/redirect origins、MIME、最大字节数、deadline、网络 egress 与任务/RBAC；
- 尚未提供只写隔离目录、流式 SHA-256、真实完成信号、恶意文件扫描、可信 artifact ID、取消/清理回执与认证耐久结果审计；
- 页面 download event 在浏览器发出后才可 cancel；生产网络层还需证明响应体不会在取消前越过隔离边界；
- 旧 tab/keyboard、人工 UI、显式 workflow/replay 等兼容通道身份隔离，以及真实 Electron/browser E2E 和崩溃演练仍待完成。
