# 第六十七次工程实施：浏览器主链日志脱敏

日期：2026-09-20

## 本批结论

本批为 Browser IPC core/automation、Browser 生命周期事件和 BrowserEngine 直接 console 输出增加统一日志脱敏边界。动态字符串默认不再明文记录，而是转换为带 domain separation 的 SHA-256、字节数和有限结构；URL、文件路径、页面文本、输入、prompt/content、DID、签名、authorization、cookie/header、错误消息与堆栈均不会原样进入这些日志。

脱敏只作用于日志副本，不改变 IPC 返回值、浏览器执行参数或 authority digest。因而业务行为保持兼容，日志仍能用稳定 digest 关联同一值，但不能从日志直接恢复页面地址、用户输入或本地路径。

## 主要实现

### 1. 专用 Browser log redactor

- `createBrowserLogRedactor()` 包装 debug/info/warn/error 四个级别，在调用现有 logger 前处理 message 与 data。
- 所有动态字符串默认替换为 `{redacted, valueDigest, byteLength}`；number/boolean/null 保留，数组限制 32 项，对象限制 64 key/6 层并保留结构。
- URL、Windows/POSIX 路径若嵌入 message 字符串，会原位替换成短摘要 token。
- Error 只保留 name、code 与 message digest，不记录 stack。Proxy、accessor、非 plain object、循环引用和深度超限不会被求值或展开；renderer proxy 不能借日志触发 getter。
- digest 使用用途标签做 domain separation，同一原值在 URL 与 path 等字段不会产生可互换摘要。

### 2. 主链接线

- `browser-ipc.js` 的 Browser/AI 生命周期、统一 IPC error wrapper，以及 `browser-ipc-core.js`、`browser-ipc-automation.js` 的结构化日志均改用 redacted logger。
- Tab open/navigate 的返回 URL 仍供正常调用方使用，但日志只记录 digest；AI task/result/history、元素动作结果和异常消息也经过同一边界。
- BrowserEngine 原先明文 console 输出的 tab URL、navigation URL、profile name、session state path 已改为 domain-separated digest；target ID、计数和耗时等非内容指标仍可用于运行诊断。

## 验证结果

```text
Browser log redaction / IPC / computer-use / navigation guard:
  Test Files  4 passed (4)
  Tests      57 passed (57)

ESLint:
  0 errors (7 pre-existing warnings)
```

新增回归以唯一 sentinel URL、Windows/POSIX path、输入文本、DID、签名、Error message、accessor 与 Proxy 注入日志；序列化后的 sink 调用不包含任何 sentinel，getter 未执行，domain-separated digest 可稳定关联且跨字段不同。

## 仍未完成

- 旧 recording/workflow/diagnostics、element locator 与部分插件型 Browser 模块仍各自持有 logger/console，需要逐模块迁移或统一 logger namespace policy 后才能宣称全部 Browser 日志闭合。
- 生产日志采集器、崩溃转储、Electron/Chromium 原生日志、第三方 provider SDK 与操作系统审计日志尚未纳入同一脱敏验收。
- digest 仍可能对低熵候选做离线枚举；生产部署还需 tenant-scoped secret salt/HMAC、保留期、访问控制和删除策略。
