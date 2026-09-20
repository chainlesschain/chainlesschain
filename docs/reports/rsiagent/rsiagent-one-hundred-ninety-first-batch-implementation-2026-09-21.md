# 第一百九十一次工程实施：Renderer Logger IPC 授权与最小表面

## 本批目标

保留 renderer 日志工具实际使用的 `logger:write`，为其补齐发送窗口、身份、用途和输入边界；删除没有消费者的配置、清理、日志文件枚举和原文读取入口，避免 renderer 获取绝对路径/日志正文或改变进程级日志状态。

## 实施结果

- `logger:write` 在访问日志 sink 前校验实际主窗口、main frame、可信 origin、当前 actor DID/tenant 与固定 `renderer-diagnostic-write` 用途；用途拒绝和 authority 异常失败关闭。
- entry 只允许 level/module/message/data/timestamp/stack 六个 own data 字段，拒绝 Proxy、accessor、未知字段、扩展/稀疏数组、原型键、非有限数字和非 plain object。
- level 使用五值白名单；module 限 128 bytes，message 限 4 KiB，stack 限 8 KiB，单字符串限 4 KiB，data 总量限 32 KiB、深度 5、节点 256、单集合 100 项。
- password/token/secret/apiKey/privateKey/pin 类键在主进程再次替换为固定脱敏值；调用方 timestamp 不用于日志落盘时间。
- 输入失败只返回固定 code/message，普通诊断不记录 caught Error 或被拒内容。
- 删除 `logger:get-config`、`logger:set-config`、`logger:cleanup`、`logger:get-files`、`logger:read-file` 五个无消费者 handler；Phase 声明从 6 个降为 1 个。
- renderer IPC 类型删除从未实现或消费的 `logger:get-logs`、`logger:clear`，固定 preload capability 只保留 `logger:write`。

## 回归与门禁

- Logger/Phase 定向回归：3 test files、60 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,226 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- `authorizeLoggerPurpose` 仍需由生产 operator policy/RBAC 实际注入并验证撤销与身份切换。
- 动态 message 与 stack 仍可包含敏感正文；后续需建立事件 schema、内容分类和更严格的字段级策略。
- 主日志文件仍是进程级 sink，尚未按 tenant 分区，也没有单 actor 速率/配额与滥用抑制。
- 真实 Electron 多窗口、身份切换、日志轮转和权限拒绝 E2E 仍待完成。
