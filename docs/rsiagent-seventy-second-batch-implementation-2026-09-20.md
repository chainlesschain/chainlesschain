# 第七十二次工程实施：Browser Extension 自有日志脱敏

日期：2026-09-20

## 本批结论

本批收紧 browser-extension 自身的 `background.js`、`content.js` 与 `popup.js` 日志边界。三个脚本的 `console.log`、`console.warn` 和 `console.error` 现在都只接收单个固定字符串字面量，不再把桥接地址、页面 URL、消息类型、命令名、popup 消息、annotation ID 或运行时 Error 写入浏览器扩展日志。

这项变化只约束扩展自有 console，不改变 WebSocket 地址、页面注册消息或命令参数的业务传输，也不代表 remote server、插件、provider、Chromium 或崩溃转储已完成日志治理。

## 主要实现

### 1. Background 日志与错误响应

- WebSocket 连接、错误和重连日志改为固定事件文本，不再输出 bridge URL、Error、延迟或重试次数。
- 收到与执行命令时不再输出动态 message type/method；popup 消息也不再整体落日志。
- 命令异常响应改为稳定的 `-32603 / Command failed`，不再向 Desktop 回传动态 `error.message`。
- 异常响应使用已经解析的 `message.id`；修复此前对原始字符串 `data.id` 的无效判断。
- 删除被后置同名实现覆盖、运行时不可达的旧 `setViewport` 声明，避免保留会返回原始 `error.message` 的死代码。

### 2. Content 与 Popup 日志

- content message、annotation 保存/读取/恢复和脚本加载日志不再输出消息类型、annotation ID、页面 URL 或异常对象。
- popup 的状态读取、tab 列表、连接和断开异常统一记录固定失败事件，不再输出扩展 API Error。
- 移除将内建 `TextEncoder` 重复声明为扩展 global 的注释，保持静态检查边界清晰。

### 3. 静态防回退合同

新增源码级回归，扫描三个扩展脚本的全部 console 调用，要求每次调用只有一个固定双引号字符串参数；同时锁定命令异常的稳定消息、解析后 request ID 回传，以及禁止恢复 `error.message`。

## 验证结果

```text
Remote browser extension regression:
  Test Files  6 passed (6)
  Tests      13 passed (13)

Prettier:
  All matched files use Prettier code style

ESLint (repository default scope):
  0 errors (3 ignored-file warnings for extension scripts)
```

强制以 `--no-ignore` 检查完整历史扩展脚本时仍会命中既有 `no-new-func` 错误及历史 warning；本批未扩大为整份近八千行脚本的规则清理，新增静态合同和测试文件本身通过项目检查。

## 仍未完成

- remote command/server、其他 plugin/provider、Electron/Chromium 原生日志和崩溃转储仍需继续盘点与脱敏。
- 扩展与 Desktop 命令通道的身份、权限、重放和调用审计仍需独立治理；固定日志不替代授权。
- 日志尚未接入 tenant-scoped HMAC、生产保留/删除策略、访问审计与告警流程。
- 若需要可诊断的动态字段，应先定义受控枚举或由独立 authority 授权的摘要/加密投影，不能恢复默认明文 console。
