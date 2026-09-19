# 第八十五次工程实施：Clipboard/Notification/Input/Display/Media/Power 日志脱敏

日期：2026-09-20

## 本批结论

本批把 Clipboard、Notification、Input、Display、Media 与 Power 六个 Remote handler 接入严格 `createRemoteLogRedactor`。legacy message 中的剪贴板类型与历史状态、通知标题/类型/ID、按键/文本长度/坐标、窗口与屏幕信息、音频文件/设备/音量，以及电源操作/DID/定时任务 ID 和 Error 只保留摘要与有界投影，不再明文进入通用 sink。

六个 handler 的业务执行、返回、数据库和事件合同均未改变。本批只关闭普通日志旁路；剪贴板正文、通知数据、输入与屏幕操作结果、媒体及电源控制仍需独立授权、最小披露和审计治理。

## 主要实现

- `clipboard-handler` 使用固定 `ClipboardHandler` 组件名，覆盖内容读取/写入、监听、历史和数据库 Error。
- `notification-handler` 使用固定 `NotificationHandler` 组件名，覆盖标题、类型、移动端广播、历史、设置、ID/action 和 Error。
- `input-handler` 使用固定 `InputHandler` 组件名，覆盖按键、组合键、文本长度、鼠标坐标/按钮/滚动和跨平台命令 Error。
- `display-handler` 使用固定 `DisplayHandler` 组件名，覆盖显示器、分辨率、亮度、缩放、刷新率、截图、窗口、鼠标位置和 Error。
- `media-handler` 使用固定 `MediaHandler` 组件名，覆盖音量、音频设备、文件/声音、播放状态、媒体动作和 Error。
- `power-handler` 使用固定 `PowerHandler` 组件名，覆盖关机/重启/睡眠/锁屏/注销、调用 DID、定时任务和 Error。
- 源码合同扩展到十二个严格接线模块，禁止这些模块重新直接解构通用 logger。

## 验证结果

```text
Clipboard/notification/input/display/media/power handlers and strict redactor:
  Test Files  8 passed (8)
  Tests      85 passed, 24 skipped (109)

ESLint:
  0 errors (75 pre-existing warnings)
```

## 仍未完成

- security/remote-desktop/AI/browser/project/mobile-approval 等 handlers 尚未接入严格 wrapper。
- 剪贴板、通知、输入、显示、媒体和电源业务结果仍需字段级授权、容量限制、tenant 隔离与耐久审计。
- Remote IPC/logging 子系统、integration example、plugin/provider、Electron/Chromium 原生日志和崩溃转储仍待治理。
- 摘要仍不是 tenant-scoped HMAC；生产密钥、保留/删除、访问告警与真实多平台 E2E 未完成。
