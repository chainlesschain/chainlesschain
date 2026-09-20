# 第五十八次工程实施：隔离到期清理周期调度器

日期：2026-09-20

## 本批结论

本批在第 57 批单次 expiry sweep 之上新增品牌化周期 scheduler。scheduler 可配置启动即扫和固定周期，只接受同 tenant、同 handler artifact digest 的 retention authority，并以 `overlapMode:skip` 防止多个删除批次重叠。

停止使用 `shutdownMode:drain`：先取消后续 interval，再等待当前 sweep 完成。已经进入事件队列但在停止后才触发的 callback 不会启动新任务，从而为 Desktop 关机生命周期提供明确的排空边界。

## 主要实现

- descriptor 绑定 scheduler ID、tenant、handler digest、1 秒至 24 小时的 interval、启动策略、重叠策略和关机策略；
- `start` 只允许调用一次，先登记 interval，再按配置执行 startup sweep；
- `runNow` 与 interval 使用同一活动任务锁，重叠请求返回 `skipped/already-active`；
- 每次运行只保留脱敏 result digest 或 failure digest，不缓存 artifact 引用；
- `stop` 幂等取消 timer，并等待已经开始的 sweep 返回；
- `inspect` 只暴露 started/running 与最后一次脱敏状态。

## 签名 Deployment 接线

`createBrowserQuarantineRetentionScheduler` 已进入 desktop deployment 内建 factories 和统一 module-digest guard。替换 scheduler handler digest 会在捕获 retention authority 或创建 timer 前失败关闭。

## 验证结果

```text
Retention scheduler / authority / signed deployment loader:
  Test Files  3 passed (3)
  Tests      69 passed (69)

ESLint:
  0 errors
```

覆盖 startup sweep、interval callback、重复启动、活动任务重叠跳过、停止取消 timer、关机排空，以及签名 loader 摘要替换负例。

## 仍未完成

- scheduler 尚未由 Desktop `onReady` 启动并在 `onWillQuit` 停止/排空，因此目标应用内的自动清理仍未最终闭环；
- operator 尚未签发包含 scheduler、retention policy 与真实 audit writer 的生产 deployment；
- 专用 operator revoke、跨进程全生命周期锁、批次恢复/对账、目录 fsync 与断电验收仍待完成。
