# 第八十三次工程实施：严格 Remote Logger 与文件/历史日志脱敏

日期：2026-09-20

## 本批结论

本批新增用途单一的 `createRemoteLogRedactor`，用于快速收敛仍含大量动态模板的 legacy Remote 模块。sink 只看到经语法校验的固定组件名；完整原始 message 和第二参数 data 分别转换为 domain-separated digest/字节数与有界脱敏投影，不再依赖逐条识别模板中的路径、ID 或正文。

首批将 `file-transfer-handler.js` 与 `command-history-handler.js` 接入该严格边界。文件名/路径、transfer/request/device 标识、命令 method/params/result/error、查询条件和导出信息不再以原始日志消息进入通用 sink。

## 主要实现

### 1. 严格 Remote logger

- 组件名只接受以字母开头、最长 64 字符的 ASCII 字母/数字/连字符；组件名不能由 URL、路径、DID 或用户文本构造。
- 每个 level 输出固定 `[Component] redacted event`，原始 message 仅保留 domain-separated SHA-256、字节数和 `redacted: true`。
- data 复用 Browser redactor 的 Error、Proxy/accessor、循环、深度、数组和字段数量边界。
- logger 与每次 projection 均冻结，projection 使用 null prototype，降低原型污染和事后补写风险。

### 2. 文件传输与命令历史接线

- File Transfer 的路径、名称、transfer ID、chunk/checksum、设备标识和 Error 无需逐条模板重写即可统一脱敏。
- Command History 的 request/method/params/result/error/context、搜索/统计/导出条件与数据库 Error 同样进入严格投影。
- 两个 handler 的业务返回、数据库记录和文件字节合同均未改变。

### 3. 防回退合同

运行时测试向 message、path 和 Error 注入 sentinel，验证 sink 的序列化调用中不存在明文；同时验证非法组件名、缺失 sink level 会失败关闭，并以源码合同禁止两个模块重新直接解构通用 logger。

## 验证结果

```text
File transfer / command history / remote and browser redaction:
  Test Files  6 passed (6)
  Tests      96 passed (96)

ESLint:
  0 errors (18 pre-existing warnings)
```

## 兼容与取舍

严格 wrapper 不保留可读的 legacy message 正文，只保留组件名和稳定摘要；这会降低无需授权的现场可读性，但能覆盖字符串拼接、模板、Error message 和未来新增动态字段。若确需可读事件名，应迁移为固定枚举字段，而不能恢复原始 message。

## 仍未完成

- process/application/network/device/clipboard/notification 等 Remote handlers 仍未接入严格 wrapper。
- 文件传输字节、路径返回和 Command History 正文/查询/导出属于业务数据，仍需 tenant 授权、容量、保留/删除和读取审计。
- Remote IPC/logging 子系统、integration example、plugin/provider、Electron/Chromium 原生日志和崩溃转储仍待治理。
- 当前摘要不是 tenant-scoped HMAC；生产密钥轮换、访问告警与真实多端 E2E 仍未完成。
