# 第七十一次工程实施：Remote Browser Console 捕获脱敏

日期：2026-09-20

## 本批结论

本批修复 remote browser-extension console capture 的“仅截断、未脱敏”问题。CDP 的 console 参数、Log 文本、异常详情、stack description、function name 和 URL 不再存入扩展内存或经 `page.getConsole` / `console.getLogs` 回传 Desktop。

扩展环境没有可同步使用的 Node `crypto`，而事件缓存是同步时序，因此本批采用更严格的内容丢弃：只保留 `{redacted, byteLength, truncated}`、受控 console/remote type、时间戳和行列号，不生成可被低熵枚举的无密钥摘要。该策略牺牲正文搜索与同值关联，优先保证兼容入口不泄漏页面内容。

## 主要实现

### 1. CDP console 投影

- `Runtime.consoleAPICalled` 的 args 不再保存 `value`/`description`，只保留 redaction metadata 与白名单 remote type。
- `Log.entryAdded` 的 text/url 和 `Runtime.exceptionThrown` 的 text/exception/url 均在进入 capture registry 前丢弃正文。
- stack description、functionName、frame URL 同样只保留 metadata；line/column/timestamp 仅接受有限 number，否则写为 `null`。
- console level/type 使用固定枚举，任意未知动态字符串归一为 `unknown`。
- entry、args、stack 和 frame 投影被冻结，读取方不能向已捕获对象补写明文。

### 2. 错误边界

- debugger attach/enable 失败不再把扩展 API 的动态 `error.message` 回传，统一返回 `CONSOLE_CAPTURE_FAILED`。
- Runtime/Log disable 或 debugger detach 失败统一返回 `CONSOLE_CAPTURE_SHUTDOWN_FAILED`。
- admission、容量、lease、detach 清理和 retained ring 的既有有界状态机保持不变。

### 3. 兼容影响

`page.getConsole` / `console.getLogs` 的 text、url、args 和 stack 字符串字段现在是 redaction metadata 对象。依赖原始正文的调试 UI 需要明确的受治理明文查看能力后才能恢复，不能通过兼容开关绕过本批边界。

## 验证结果

```text
Remote browser console capture / registry / boundary:
  Test Files  3 passed (3)
  Tests      12 passed (12)

ESLint:
  0 errors (1 pre-existing warning)
```

回归注入 console argument/description、Log text、exception value、stack description、function name 和多组 URL sentinel；捕获结果序列化不包含任何 sentinel。启动失败只返回稳定错误码，既有 duplicate admission、detach、serialized disable、ring eviction 与容量限制继续通过。

## 仍未完成

- browser-extension `background.js`、`content.js` 和 `popup.js` 自身仍有直接 console 输出，其中 content URL、popup message 和 Error 可能包含动态内容。
- remote command/server logging、其他插件/provider、Electron/Chromium 与崩溃转储仍需继续盘点。
- console 捕获尚未接入签名用户授权、页面敏感级别、保留/删除策略和读取审计；脱敏不替代权限控制。
- 若未来需要正文诊断，必须由独立 authority 签发短期授权并提供 tenant-scoped 加密、访问审计和删除证明，不能恢复默认明文缓存。
