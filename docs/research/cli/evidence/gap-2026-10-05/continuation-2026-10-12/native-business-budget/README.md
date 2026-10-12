# 原生业务旅程的统一功能预算

848e6e4 的准确 CI Tests run38199228810、Windows job114648667343 在两项实际 SQLite 旅程超过默认 5000ms；原失败为 project-goal-notification-journey 与 project-goal-monitoring-host 的不同用例，原 start/check/status/stop 修复后的断言已经通过。本次完整日志和实际 job/step 元数据保留。

仅对 vitest.business-actions.config.mjs 的窄原生业务套件设置 testTimeout:30_000，覆盖实际 SQLite、通知、授权与主进程 IPC 功能旅程，仍单 worker/forks；不改通用桌面配置、hook预算、生产期限、断言或 retry。Windows Node v22.22.2 全套 **231/231、12 文件**通过，结果为功能验证，不是性能 SLO。新准确提交 Actions 另验。

双摘要原件见 [manifest.json](./manifest.json)，验证范围见 [summary.json](./summary.json)。正式 36+9 / NOT_RUN / observed=0 / $99 不变。
