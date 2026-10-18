# CLI / IDE 项目历史证据只读桥验证

2026-10-18，本地未提交工作树；与历史批次重叠，不累加。准确命令、源码/报告 SHA-256、制品与边界见 [summary.json](./summary.json)。

| 范围                    | 文件 | 通过 | 跳过 |
| ----------------------- | ---: | ---: | ---: |
| CLI / 共享目标服务      |   27 |  602 |    3 |
| SDK evidence 能力与快照 |    1 |    5 |    0 |
| 桌面主进程              |    7 |  124 |    0 |
| Vue 组件                |    4 |   66 |    0 |
| JetBrains JUnit         |    1 |   10 |    0 |
| 合计                    |   40 |  807 |    3 |

3 项跳过为 Windows 上未运行的符号链接用例；不代表跨平台已验证。`cli-evidence-final-tests.json` 的 27 项 reader/契约复核与主回归重叠，不再计数。隔离包探测也单独记录，不增加测试文件数。

真实 SQLite 创建风险检查与原生动作回执；读取时启用 `PRAGMA query_only=ON`，核对 schema 和 `total_changes()`，包括运行中未解决动作的 usage 不变。最新不完整检查不得退回旧成功结果，24 个新草稿不得遮蔽较旧真实回执。缺少 ActionRun 表必须报告 unavailable。契约拒绝额外正文/审批字段、未知风险伪装为零与重复/超量回执。

桌面使用真实 Windows 私有 DACL、loopback HTTP 和双向 HMAC；已安装样例走真实插件信任、能力同意和策略检查。单独的 5 项 SDK 用例使用连接替身，验证 evidence consent、summary 能力隔离及投影期间风险/回执变化的拒绝；不以这些替身声称传输安全。Electron 登录、原生对话框与 IDE 界面仍为测试边界。

Session Core 从实际 npm archive 隔离加载新 CJS/ESM 公共出口，以真实 SQLite 验证只读接口；[探测脚本](./packed-session-core-probe.cjs)接收 better-sqlite3 入口作为第一个参数。CLI archive 核对新样例及连接源码。VSIX 核对源码，JetBrains ZIP 核对编译类。制品保存在临时目录，记录路径和 SHA-256；CLI 未做清洁注册表安装。JetBrains 使用缓存 IntelliJ Community 2024.2 / JBR 21 工具链构建。

Astra 源码复核发现的部分缺表问题已修复并确认，无剩余实质阻断项。`source-snapshot.json` 为测试期间 31 处关键来源快照；最终汇总再次核对，并附上新增测试、文档与有效配置哈希。命令生成、固定 IPC、相关源码/README 格式与差异检查记录在 `checks.json`；本批未增加 IPC channel。

这批只交付独立授权的历史摘要读取。提议写入、事件订阅、完整交付助手、真实 GUI/业务效果及准确提交发行门仍未完成；未升级版本、提交或发布。
