# 第七十次工程实施：Browser Diagnostics 与 Action 日志脱敏

日期：2026-09-20

## 本批结论

本批完成 `desktop-app-vue/src/main/browser` 内剩余内容型运行日志的统一接线：advanced observer/scanner、diagnostics、keyboard/multi-tab/scroll/upload action 全部改用 Browser redactor，ElementLocator 的直接 console fallback 只输出 element ref 摘要。

至此，Browser 目录内生产运行模块已不再发现绕过 redactor 的通用 logger 导入；保留的直接 console 仅包括已摘要化的 BrowserEngine/ElementLocator，以及 SnapshotEngine 的数量和 opaque target ID。示例脚本、Browser 目录外的 remote/plugin 组件和 Electron/Chromium/provider 原生日志不在本批闭合范围。

## 主要实现

### 1. Advanced 与 diagnostics

- `spa-observer.js`、`shadow-dom-scanner.js`、`iframe-scanner.js` 统一包装既有 logger；target、frame、URL、selector 和 Error 数据在进入 sink 前摘要化。
- `ocr-engine.js`、`screenshot-diff.js`、`smart-diagnostics.js` 统一包装 logger；语言、OCR/AI 结果、diff 元数据、诊断上下文和异常正文不再明文写入。
- 页面 `evaluate()` 回调所需 browser globals 已显式声明，定向 ESLint 可区分页面上下文与主进程上下文。

### 2. Action 与 ElementLocator

- `keyboard-action.js`、`multi-tab-action.js`、`scroll-action.js`、`upload-action.js` 的失败/进度日志进入 redactor，输入、路径、页面上下文和错误内容只保留摘要/数字/布尔值。
- Multi-tab、scroll、upload 页面回调所需 browser globals 已显式声明。
- ElementLocator 的 getByRole、ARIA、ID、text、CSS、XPath 六级 fallback console 不再拼接原始 `element.ref`，而是使用 domain-separated `refDigest`。
- ElementLocator 的业务异常仍返回给调用栈；本批只约束诊断副本，未改变定位策略与调用方错误处理合同。

### 3. 接线验证

新增源接线合同，逐一检查 10 个 advanced/diagnostics/action 模块必须构造 `createBrowserLogRedactor(browserLogSink)`，并禁止重新出现直接 `{ logger }` 导入。ElementLocator 负例注入 ref、label 与 selector sentinel，六级 fallback console 只出现 SHA-256 ref digest。

## 验证结果

```text
Browser diagnostic/action wiring and IPC behavior:
  Test Files  4 passed (4)
  Tests      33 passed (33)

ESLint:
  0 errors (25 pre-existing warnings)
```

## 仍未完成

- `examples/computer-use-example.js` 是手工示例脚本，仍会主动打印分析结果；不得作为生产入口或日志安全证据。
- Browser 目录外的 remote browser-extension、插件/provider SDK、Electron/Chromium、崩溃转储和系统审计日志仍需独立盘点与验收。
- SHA-256 摘要仍需 tenant-scoped HMAC/secret salt，日志还缺生产保留期、访问/导出控制、删除证明与 SIEM 管道。
- 兼容 IPC 的 DID/RBAC/一次性授权、预算、取消和耐久审计边界仍未因日志脱敏而关闭。
