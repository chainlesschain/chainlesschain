# 第八十四次工程实施：Process/Application/Network/Device 日志脱敏

日期：2026-09-20

## 本批结论

本批把 Process、Application、Network 与 Device Manager 四个 Remote handler 接入严格 `createRemoteLogRedactor`。legacy message 中的命令/PID/进程名、应用名称/路径、host/IP/interface/SSID、DID/peer/device metadata 及 Error 只保留摘要和有界投影，不再明文进入通用 sink。

四个 handler 的业务执行、返回、数据库和 EventEmitter 合同均未改变。本批只关闭普通日志旁路，进程/应用控制、网络探测和设备管理结果仍需独立的权限与最小披露治理。

## 主要实现

- `process-handler` 使用固定 `ProcessHandler` 组件名，覆盖 list/get/search/start/kill/resource 与跨平台命令 Error。
- `application-handler` 使用固定 `ApplicationHandler` 组件名，覆盖 installed/running/info/launch/close/focus/search/recent 的路径、名称和 Error。
- `network-handler` 使用固定 `NetworkHandler` 组件名，覆盖 interface/connection/bandwidth/ping/public IP/DNS/traceroute/Wi-Fi/speed 的地址、host 和 Error。
- `device-manager-handler` 使用固定 `DeviceManagerHandler` 组件名，覆盖 JSON 容错、DID/peer/name/group/permission/status/audit 与 Error。
- 源码合同扩展到六个严格接线模块，禁止重新直接解构通用 logger。

## 验证结果

```text
Process/application/network/device handlers and strict redactor:
  Test Files  7 passed (7)
  Tests      90 passed, 13 skipped (103)

ESLint:
  0 errors (52 pre-existing warnings)
```

## 仍未完成

- clipboard/notification/input/display/media/power/security/remote-desktop/AI/browser/project 等 handlers 尚未接入严格 wrapper。
- 进程/应用列表与控制结果、网络地址/Wi-Fi/DNS、设备 metadata/audit 仍需字段级授权、分页/容量、tenant 隔离与读取审计。
- Remote IPC/logging 子系统、integration example、plugin/provider、Electron/Chromium 原生日志和崩溃转储仍待治理。
- 摘要仍不是 tenant-scoped HMAC；生产密钥、保留/删除、访问告警与真实多平台 E2E 未完成。
