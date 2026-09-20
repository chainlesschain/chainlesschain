# 第五十一次工程实施：真实 Chromium 下载与 Popup 边界验收

日期：2026-09-20

## 本批结论

本批把此前基于 Playwright mock 的 BrowserContext 下载/popup 失败关闭验证提升为本机真实 Chromium 集成测试。测试启动真实 BrowserEngine 和临时本地 HTTP 服务，由页面点击触发原生 attachment 下载及 `target=_blank` popup，确认未授权下载不能取得本地路径，popup 在未登记页面发出导航前被 context route 中止。

真实启动同时暴露并修复了一个 Playwright API 兼容缺陷：BrowserEngine 把 Playwright `Browser` 当成 Puppeteer 调用 `process()`，导致浏览器已经启动后仍抛错并可能泄漏实例。

## 主要实现

### 1. 当前 Playwright Browser API 兼容

新增安全的浏览器 PID 探测：

- 只有 Browser 实际提供直接 `process()` 函数时才读取 PID；
- 当前 Playwright 不提供该函数时返回 `undefined`，启动仍成功；
- `getStatus()` 使用同一逻辑，不再因状态查询抛错；
- launch 后任意初始化步骤失败都会清空实例引用并关闭已启动 Browser；
- `headless:false` 和 `cdpPort:0` 改用 nullish 默认值，不再被 `||` 意外覆盖。

### 2. 真实原生下载失败关闭

集成测试使用已安装的 Playwright Chromium：

1. 启动临时 `127.0.0.1` HTTP 服务；
2. 即使调用方创建 context 时传入 `acceptDownloads:true`，BrowserEngine 仍强制 false；
3. 页面点击带 `download` 属性且响应包含 `Content-Disposition: attachment` 的链接；
4. BrowserEngine 发出不含 URL/文件名的 `tab:download-blocked`；
5. 原生 Download 的 `failure()` 返回 cancel/acceptDownloads 失败状态；
6. `download.path()` 明确拒绝，未向调用方暴露临时文件；
7. BrowserEngine 仍只保留原有受治理页面。

### 3. 真实 Popup 导航失败关闭

同一页面点击 `target=_blank` 链接后，BrowserContext route 在新 Page 尚未进入批准集合时以 `unattributed-page-navigation` 中止主框架导航；随后验证 context 与 BrowserEngine 均只保留原页面。该结果证明 popup guard 不依赖单元测试事件顺序或页面 mock。

旧 BrowserEngine 单测夹具同步补齐 context route/on 能力，使其符合现有 fail-closed popup/download guard，而非绕过新边界。

## 验证结果

```text
Desktop BrowserEngine unit/guard:
  Test Files  2 passed (2)   Tests 41 passed (41)

Real Chromium integration:
  Test Files  1 passed (1)   Tests  1 passed (1)

合计:
  Test Files  3 passed (3)   Tests 42 passed (42)
```

另完成一次真实 BrowserEngine `start({ channel: "chromium" }) → stop()` 探测，启动与资源回收成功。

## 仍未完成

- 尚未在完整 Electron renderer/preload/signed deployment 进程链运行下载 authority、流式 executor、scanner、custody 与 disposal E2E；
- 页面原生 download 请求仍会到达本地测试服务器后再由 Playwright 取消，生产网络层仍需证明响应体不会越过隔离边界；
- operator 网络 egress、隔离 custody、独立扫描和删除端口及其故障演练仍待目标环境配置；
- in-flight cancel、自动过期清理、operator revoke 和受治理领取/导入/导出仍未完成。
