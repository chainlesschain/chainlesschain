# 第五十三次工程实施：声明式下载的请求前阻断

日期：2026-09-20

## 本批结论

本批把普通页面 `<a download>` 从“请求到达后由 Playwright 取消”前移为“点击默认行为发生前阻断”。BrowserContext 在任何页面脚本执行前安装捕获阶段 click guard；真实 Chromium 集成测试证明声明式下载点击后本地 HTTP 服务收到 0 次文件请求。

该结果不等同于完整网络隔离。同一测试同时证明：没有 `download` 属性、仅由响应 `Content-Disposition: attachment` 触发的原生下载仍会先到达服务端，再由 `acceptDownloads:false` 与 download guard 取消，且 `download.path()` 不可取得。因此生产 network egress 端口和进程级隔离仍是退出条件。

## 主要实现

### 1. 页面脚本前的声明式下载 guard

BrowserEngine 的 context init script 现在：

- 在捕获阶段监听 document click；
- 从事件 composed path 识别任意 `a[download]`（包括子元素点击与 shadow path）；
- 同步调用 `preventDefault()` 和 `stopImmediatePropagation()`，不让默认下载行为进入网络栈；
- 在页面代码运行前捕获 `Reflect.apply`、EventTarget、Event、Array、Object 与 Element 的相关原生方法，避免页面稍后替换这些原型方法绕过 guard；
- 继续以 `acceptDownloads:false` 和原生 Download cancel/delete 作为响应触发型下载的第二道失败关闭边界。

### 2. 真实 Chromium 双路径验收

集成测试在同一受治理页面依次执行：

1. 点击带 `download` 属性的链接，随后通过独立 barrier 请求等待浏览器事件队列；服务端声明式文件请求计数保持 0；
2. 点击不带 `download` 属性、但服务器返回 attachment 响应头的链接；服务端请求计数为 1，原生 Download 被 cancel，路径不可取得；
3. 点击 `target=_blank` 链接；popup 导航仍在未登记 Page 边界被中止，context 只保留原页面。

## 验证结果

```text
BrowserEngine unit / navigation guard / real Chromium integration:
  Test Files  3 passed (3)
  Tests      42 passed (42)
```

## 仍未完成

- 响应头触发型下载仍会先发出网络请求，当前浏览器层无法在未知响应头出现前判定；
- 页面 fetch/XHR、service worker、location 导航、blob/object URL 等非声明式路径仍需要生产 network policy egress 与进程级隔离统一约束；
- 真实 Electron renderer/preload/signed deployment/download provider/custody/scanner 全链 E2E 仍待完成；
- 目标环境的恶意文件、网络中断、卡死 provider、断电和审计故障演练仍未完成。
