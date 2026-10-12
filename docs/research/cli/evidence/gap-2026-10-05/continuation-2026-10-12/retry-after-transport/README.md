# Retry-After 接线与生产重放边界

已完成共享 Retry-After header/deadline、60 秒等待上限与可取消退避，接入 Agent 四种流式协议和聊天三种协议。HTTP 4xx/5xx 与 Responses 失败终态保持单次请求；只有原本允许的零输出断线恢复才采用 `max(指数退避, Retry-After 剩余时间)`。超出上限直接交还原错误，不截短服务端等待时间。

修复聊天 `504 Gateway Timeout` 被当成连接错误、Responses `failed → ECONNRESET` 绕过终态、纯空白和 thinking-only 输出后重放，以及部分工具参数断流。completed/incomplete 后断线保留原终态与 usage，库侧 AbortError 仍返回取消；截断工具调用不执行。严格费用 observer 仍先于下一次请求持久化失败记录。另修复聊天 token sink 的既存未定义 `options`，保留背压错误身份。

原源码 `83ce1d6d42658bab2e5dcd34045da6873962aef6` 的四模块隔离副本复现 **24 失败 / 0 通过**；另外 10 项后补时序、取消、背压与终态回归未在原源码运行，不计为原失败数。最终 12 文件 Windows Node 22.22.2 与 WSL Ubuntu Node 22.12.0 各 **248/248**，包括严格费用归集 38 项。初始 fixture 六项 Responses 路由错误、修后两项旧断言失败均保留，正确官方端点夹具已独立重跑原源码。

[summary.json](./summary.json) 绑定当前执行源摘要；[manifest.json](./manifest.json) 保存原源码、复现驱动、测试源码、各轮 JSON reporter 与日志的压缩/解压双 SHA256。Astra 实现共享辅助函数并复核生产边界，不作为独立人工签核。

本轮没有付费 provider 请求，没有新发布。当前修改仍需自身准确提交 Actions；已发行 0.166.99 的成绩不转移到本次源码。实际 provider、模型 WebSocket、正式 36+9、账号硬额度/账单、真人辅助技术、native/durable、8h/24h 与正式 SLO 仍开放。
