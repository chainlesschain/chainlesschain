# 第八十六次工程实施：Remote 安全、桌面、AI、浏览器与项目 Handler 日志脱敏

日期：2026-09-20

## 本批结论

本批把 Security、Remote Desktop、基础/增强 AI、Browser、Project Management、Mobile Approval Transport 与 System Info 八个 Remote handler 接入严格 `createRemoteLogRedactor`。账户/登录/安全产品状态、桌面 session/frame/input/display、对话/prompt/检索/Agent、URL/tab/action、项目/文件路径与正文标识、审批 peer/request/reason，以及系统/硬件/服务/日志信息和 Error 只保留摘要与有界投影，不再明文进入通用 sink。

至此，`src/main/remote/handlers` 中已不存在直接解构通用 logger 的模块。handler 的业务执行、返回、数据库和事件合同均未改变；业务 payload 的授权、字段级最小披露、容量、保留和耐久审计仍是独立未完成边界。

## 主要实现

- `security-handler` 与 `system-info-handler` 使用固定组件名，收拢用户、登录历史、防火墙/杀毒/加密/更新、硬件、服务、性能、系统日志与跨平台 Error。
- `remote-desktop-handler` 收拢 robot/sharp 加载、session、frame、display、输入事件与 Error。
- `ai-handler`、`ai-handler-enhanced` 收拢会话、prompt、RAG 查询、Agent、模型、stream/task 与 Error。
- `browser-handler` 收拢 browser lifecycle、URL、tab/target、action/screenshot 与 Error。
- `project-management-handler` 收拢项目/文件 ID、名称、路径、字节数与 Error。
- `mobile-approval-transport` 收拢 peer/request、approval decision/reason、timeout 与 Error。
- 源码合同覆盖二十个严格接线模块，并允许 Prettier 的单行或多行 wrapper 调用格式。

## 验证结果

```text
Security/desktop/AI/browser/project/approval/sysinfo handlers and strict redactor:
  Test Files  14 passed (14)
  Tests      263 passed, 4 skipped (267)

ESLint:
  0 errors (53 pre-existing warnings)

Static inventory:
  direct generic logger imports under src/main/remote/handlers: 0
```

## 仍未完成

- `remote-ipc`、Remote workflow/logging 子系统与 `integration-example` 仍直接使用通用 logger。
- handler 的对话、项目正文、系统/桌面/安全信息和控制结果仍需字段级授权、容量限制、tenant 隔离与耐久审计。
- plugin/provider、Electron/Chromium 原生日志和崩溃转储仍待治理。
- 摘要仍不是 tenant-scoped HMAC；生产密钥、保留/删除、访问告警与真实多平台 E2E 未完成。
