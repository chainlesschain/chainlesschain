# CLI / IDE 在线待审草稿连接：本地验证

2026-10-18，DMM-07 / DMM-08。本批新增独立 v3 待审草稿连接、持久来源授权与撤权、原生来源分页、发送前持久请求引用，以及 CLI / VS Code / JetBrains 提交和回执查询入口。任务修改仍须桌面当前预览与逐次原生确认。

最终 **52 个独立测试文件、943 项通过、0 失败、3 项 Windows 符号链接用例跳过**：CLI / 共享核心 36 文件 701 项，桌面 9 文件 144 项，Vue 6 文件 81 项，JetBrains 1 类 17 项。命令以 [summary.json](./summary.json) 为准。CLI 首轮报告包含后续修正前的 VS Code 文件；[最终 VS Code 报告](./vscode-final-tests.json)替换其中相同文件。汇总按不同测试文件取最终结果，禁止相加重叠报告或历史批次。Vue 新面板在组件回归后仅作 Prettier 格式修正；语义未变。

- [CLI / 共享核心](./cli-tests.json)：真实插件准入与 SDK、持久 grant / epoch CAS、SQLite、协议、未知结果及既有个人/组织目标回归。
- [桌面宿主](./desktop-tests.json)：真实 Windows 私有 DACL、loopback HTTP、SQLite、真实 CLI 准入及 SDK 到原生动作旅程；Electron 登录、窗口和原生对话框为替身。
- [Vue 组件](./renderer-tests.json)：真实组件与模拟 preload，验证原生接口参数、文本展示、撤权和来源/身份变化清缓存、迟到响应丢弃。
- [JetBrains JUnit](./jetbrains-tests.xml)：17 项；[构建记录](./jetbrains-build.log)保存已有完成输出摘要，不含未保存的完整 stdout，未为补日志重跑。
- [检查](./checks.json)：命令 manifest/help/completions、固定 renderer IPC、Prettier 与差异空白校验。
- [隔离 Session Core 包](./packed-session-core.json)及[已执行探针](./packed-session-core-probe.cjs)：真实 npm archive 的 CJS/ESM 公共出口、SQLite pending-only/幂等/原生预览/撤权，未导入 CLI 私有模块。
- [CLI archive](./cli-package.json)、[VSIX](./vscode-package.json)、[JetBrains ZIP](./jetbrains-package.json)：核对包内源码或编译类与当前来源，不是公开发布或干净 registry 安装验证。

[初始快照](./source-snapshot.json)与[最终快照](./source-final-snapshot.json)记录测试中的关键源码字节。Astra 复核发现 VS Code 跨页未保留完整 goal/plugin/version/declaration/grant binding；修正后追加四文件针对性复测。初始快照后的变更逐项登记，最终源码再次核对。既有失败/超时证据保留在各自历史批次，本批不改写历史报告。

请求 HMAC 包含实际正文 hash，响应包含 HTTP 状态。独立协议测试验证篡改、重放、超限、浏览器 Origin、收包期间撤权、保存后断包及查询恢复。持久引用含请求/digest/goal/grant/plugin，不含正文、凭据或连接路径；已有引用只查询，没有自动重发。`not-found` 是查询时观察，不能证明迟到请求不会保存。来源标签和摘要均不鉴定插件代码。

用户要求把已完成工作提交 Git。九批 DMM 源码清单取并集，在独立功能工作树整理；混有任务看板、RRSI 或 VERIFY-01 的五个文件仅提取 DMM 部分，并重新生成/校验该组合的 IPC 清单，详见 [提交范围](./commit-scope-paths.json)。历史共享工作树哈希包含并行改动，不能作为这个隔离提交的全量准确提交 CI 证明。

未运行真实 Electron / IDE GUI 或独立业务效果评测，未升级版本、发布 npm / IDE 或运行远端准确候选提交矩阵。发行仍要求完整配置的 Linux / Windows / macOS `CLI CI` 和 `CLI Strict Sandbox`、GitHub Actions OIDC，以及子 npm 包→CLI→IDE 顺序。事件订阅、完整交付助手、灰度/迁移/回退验收仍待继续。
