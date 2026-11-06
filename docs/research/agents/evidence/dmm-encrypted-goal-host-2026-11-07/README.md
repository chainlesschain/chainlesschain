# 加密桌面数据库的目标宿主接线（2026-11-07）

本批在 Graph 宿主后续检查中修复产品兼容问题：默认加密桌面库经 `DatabaseManager.getDatabase()` 返回实际 `SQLCipherWrapper`，目标服务需要原生 SQLite 的 `transaction().immediate`、`inTransaction` 和原生语句 API。此前只覆盖原生句柄的宿主测试未能验证这条产品路径。

[目标数据库解析器](../../../../../desktop-app-vue/src/main/task/project-goal-native-database.js) 只对真实桌面 `SQLCipherWrapper` 提取已打开的原生连接，个人目标 IPC 与监控宿主共用同一解析。普通 native SQLite 保持原对象；其他形似 wrapper 的对象不被解包。关闭的 wrapper 拒绝访问，不调用会自动重开的 `getHandle()`。同一 wrapper 显式关闭/重开后，真实原生连接身份变化，旧监控引擎随之退出并轮换；异步 Graph 加载期间重开也被拒绝。组织监控复用的宿主同步兼容，组织领域服务与权限规则不变。

## 已运行证据

最新完整范围共 **42 个不重复文件、704 项通过，0 失败、0 跳过**：桌面 business-actions 21 文件/401 项，组织宿主兼容 2/14，renderer 全配置 19/289。九项 wrapper 回归覆盖目标接线、原生/只读句柄保留、关闭不复活、拒绝任意 getHandle、连接轮换/异步加载，以及受控任务创建、取消和确认期间数据库替换。Node 测试使用实际 production wrapper 加注入的真实 better-sqlite3 驱动，不将该层当作加密验证。报告见 [desktop-tests.json](./desktop-tests.json)、[organization-host-tests.json](./organization-host-tests.json) 和 [renderer-tests.json](./renderer-tests.json)。此前本批 23 文件/412 项和 Graph 的 55 文件/870 项与此有重叠，不相加。

真实 GUI 检查还发现受控任务入口未解包加密库，以及模型草稿被拒绝后因父组件绑定等值 sources 数组而循环读取。后续让受控任务复用同一解析器，并在确认后/事务内重验当前原生连接身份；仍保留严格原生确认。模型组件改用 Vue 的逐项 source 监听，实际值不变时不重新加载；两项新增 renderer 回归覆盖未准入和目标暂停后的拒绝，真正版本变化仍触发读取。

另有一条独立的[真实 Electron 加密探针](./electron-probe.json)：Electron **39.8.10**、Node **22.22.1**、ABI **140**、better-sqlite3-multiple-ciphers **12.11.1**，未替换 SQLite、Graph kernel 或 Windows 文件 ACL。它验证：原始 wrapper 不符合原生合同；解析后使用同一个加密原生项目连接；canonical Graph 巡检成功；重复请求保留原 occurrence；参与目标升级 v2；项目/调度/Graph 三个文件独立；关闭 wrapper 后不自动重开；显式重开仍能读取目标。数据库文件无明文 SQLite header，未提供密钥时读取 schema 被拒绝。探针使用合成项目和可信测试身份，未执行产品登录、renderer 操作或原生确认交互；不计入上方 unit/integration 测试数量。

运行命令：

```powershell
node desktop-app-vue/scripts/project-goal-encrypted-electron-probe.mjs --electron <Electron可执行文件> --output <新的结果文件>
node docs/research/agents/evidence/dmm-encrypted-goal-host-2026-11-07/verify-evidence.mjs
```

Electron/原生数据库模块必须匹配 ABI；探针失败时不退回 sql.js，不弱化 ACL。复核器核对报告、探针源码摘要，重跑固定 IPC、diff 和源码出口审计，生成 [summary.json](./summary.json)；它不重新运行测试或 Electron 探针。源码出口审计不授予 paid admission。

完整主进程构建及 renderer 生产构建均返回 0；后者转换 **8018 modules**，耗时约 7 分钟，保留现有大 chunk、eval 和 splash 静态资源提示。它们是本地构建，不是完整安装包。Electron 运行时从本机缓存恢复，zip SHA256 `4478410a35a8399b7745085096695a37877f176755182a71e27eddc245cd98d5` 与锁定 Electron 包内 checksums 一致；原生数据库使用对应 Electron ABI 的预构建文件。缺失依赖按已有 package-lock integrity 补齐，未修改包清单或锁文件，未复制真实用户配置。

## 尚未闭环

真实完整产品启动检查初次 30 秒窗口等待未完成；随后明确使用 180 秒窗口预算，在全新隔离配置、真实加密数据库和实际 production renderer 上读到登录表单并正常退出，见[启动观察](./product-startup.json)及[登录界面截图](./product-login.png)。随后一条[基础目标 GUI 旅程](./product-goal-gui.json)通过：实际 DID API 创建身份、真实密码表单登录、以匹配 DID 创建临时项目，在 Vue 表单保存目标、点击检查、回读 v2、看到检查 1 次并暂停。存档[运行脚本](./product-goal-gui-smoke.cjs)与[暂停界面截图](./product-goal-paused.png)保留修复任务入口和循环读取前的原始快照，截图中的任务错误未被隐藏。没有复制真实用户配置，脚本中的固定密码仅属于每次新建的测试 profile。先前遗漏项目 DID 归属的测试被 GOAL_NOT_FOUND_OR_DENIED 拒绝，修正 fixture 后成功，没有弱化归属检查。

后续最新 renderer 生产重建返回 0；[实际产品复查](./product-followup-observation.json)再次通过基础目标 GUI，受控任务原生数据库错误为 0，模型拒绝列表仅记录 2 次，未再持续循环。原生确认框的 Windows UI Automation 尝试仍未找到目标对话框，整个扩展 runner 返回 1，不能计为通过，也未安装 dialog 或审批替身；该诊断结果与成功的基础 GUI 分开记录。

基础 GUI 成功不等于完整风险→目标 intent→确认→动作→回执→再检查→结束旅程。业务效果需要独立样本/预期；Linux/macOS、完整安装包、准确提交远端矩阵、真实生产来源登记/切换与新包发行均未完成。总体 DMM 目标保持进行中。

草稿 PR [#541](https://github.com/chainlesschain/chainlesschain/pull/541) 依赖 [#540](https://github.com/chainlesschain/chainlesschain/pull/540)。既有 CI Tests 只接受 main/develop 目标分支，本批增加 `DMM Project Host`，对叠加 PR 的准确 head 在 Linux/Windows/macOS 执行上述三个完整配置并保存报告，没有删减 ACL 或忽略失败。工作流尚需实际运行完成；它不是实际 Electron GUI/安装包验证，也不能替代 npm 的 CLI CI/Strict Sandbox 发行门禁。
