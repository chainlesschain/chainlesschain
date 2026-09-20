# 第六十八次工程实施：浏览器捕获与操作审计内容脱敏

日期：2026-09-20

## 本批结论

本批把旧 `ConsoleCapture` 与 Computer Use `AuditLogger` 接入浏览器日志脱敏边界，消除两条会把页面内容、请求 URL、输入参数、动作结果和错误详情直接保存在内存、经 IPC 导出或追加到 JSONL 的路径。

捕获和审计记录现在只保留稳定摘要、字节数、时间、计数、布尔值以及受控枚举。原始业务值仍用于当次浏览器操作，但不进入捕获记录、事件载荷、查询结果或导出文件。该变更没有把旧 IPC 提升为受治理生产入口；它只收窄兼容路径的泄漏面。

## 主要实现

### 1. ConsoleCapture 失败关闭

- 页面 console message、location URL、JavaScript error message/stack、失败请求 URL 和 failure text 均在写入内存前转换为 domain-separated SHA-256/字节数。
- console argument 不再调用 `toString()`，只保留参数数量，避免页面对象借诊断功能执行 getter 或暴露正文。
- log level、HTTP method 和 resource type 只接受固定枚举，未知动态字符串统一归一为 `unknown`。
- JSON/text 导出只包含脱敏记录；原来的模糊正文搜索收窄为完整原值的摘要等值搜索，不能从索引恢复或枚举子串。
- 写入内存的 entry 会冻结，事件监听器不能在记录完成后补写明文。

### 2. Computer Use AuditLogger 失败关闭

- operation type 只接受固定枚举；action、params、result、error、target/url/title/userAgent context 与 metadata 在构造 `AuditEntry` 时统一脱敏。
- `AuditEntry` 在创建完成后冻结，同一脱敏对象用于内存查询、`logged`/`highRiskOperation` 事件、JSON/CSV 导出和 JSONL 文件写入。
- `targetId` 查询改为摘要匹配，日志文件路径在 stats 中只返回摘要；文件系统错误也通过 Browser redacted logger 输出。
- keyboard typing 保守归为 medium risk；desktop click/type 继续归为 high risk。无效 success/duration/type 不再作为任意动态内容写入审计结构。
- 文件系统 adapter 可注入，测试能够直接验证实际 JSONL 行而不依赖真实磁盘。

### 3. Redactor 补强

- 公共 `redactBrowserLogValue()` 供捕获和审计边界复用，避免各模块重复实现掩码规则。
- sensitive-key 规则补入 password/token/secret/apiKey/credential。
- Error code 与 message 一样摘要化；Error stack 仍不记录，Proxy/accessor 仍不求值。

## 验证结果

```text
Browser redaction / console capture / audit / Browser IPC:
  Test Files  5 passed (5)
  Tests      114 passed (114)

ESLint:
  0 errors (1 pre-existing warning)
```

回归注入了唯一 console 文本、页面 URL、本地路径、console argument、页面异常、请求 URL、operation type/action、键盘输入、password、result、error、targetId、title、user agent、metadata prompt 与 `__proto__` 字段；内存记录、事件参数、IPC 可返回结构、JSON/text/CSV/JSONL 序列化均不包含 sentinel。console argument 的 `toString()` 未执行，未知审计 type 归一为 `unknown`，摘要化 targetId 仍可精确查询，脱敏投影保持 null prototype。

## 仍未完成

- recording、workflow、OCR/smart diagnostics、element locator、上传与部分插件型 Browser 模块仍有独立 logger/console 输出，需要继续迁移。
- 旧 console/audit IPC 本身仍缺少与签名 Browser ingress 等价的 DID、RBAC、一次性授权和耐久访问审计；本批脱敏不等于授权完成。
- Electron/Chromium、provider SDK、崩溃转储与系统审计日志尚未纳入；生产摘要仍需 tenant-scoped HMAC/secret salt，避免低熵值离线枚举。
- 日志保留期、读取/导出权限、删除证明、SIEM 管道与真实 Electron E2E 仍待生产验收。
