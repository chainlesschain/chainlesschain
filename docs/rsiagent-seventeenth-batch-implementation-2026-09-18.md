# RSIAgent 第十七次工程实施：签名数据库路径与 grader source digest 绑定

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十六次 Desktop PM 只读结果端口与真实 SQLite 回读](./rsiagent-sixteenth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第十八次签名 SQLite pre-run seal 与执行门禁](./rsiagent-eighteenth-batch-implementation-2026-09-18.md)<br>
> 状态：Desktop PM reader 现在要求已验签 deployment 声明目标数据库绝对路径摘要，并把路径、plan、environment 和任务白名单共同提交到 reader binding digest。业务 outcome source 升级为 v2，把该 binding digest 纳入 source digest，因而 grader 签名结果与后续 evidence bundle 可以区分不同数据库证据源。

## 1. 签名路径门禁

[Desktop PM 只读 reader](../desktop-app-vue/src/main/evolution/desktop-pm-read-only-outcome-reader.js) 的创建参数新增必填 `databasePathDigest`。摘要算法为：

```text
sha256("chainlesschain.desktop-pm-database-path/v1\0" || normalize(resolve(absolutePath)))
```

该参数由已验签 deployment 模块传入，因此模块字节及其 descriptor 签名固定了预期值。每次项目或看板读取都会先调用 Desktop `DatabaseManager.getCurrentDatabasePath()`，规范化并复算摘要；不匹配时在调用 `getDatabase()`、`prepare()` 和任何 SQL 之前失败关闭。

reader 仍会锁定第一次成功读取时的 `DatabaseManager` 和底层 SQLite 连接。后续轮次同时复核路径摘要和对象身份，不能以相同实体 ID 静默换到另一数据库。

数据库 manager、native database 和 statement 的方法现在均通过 property descriptor 捕获。accessor 或 Proxy 不能伪装成 `getCurrentDatabasePath`、`getDatabase`、`prepare/get/all` 并在校验期间执行代码。

## 2. 证据摘要贯通

reader 对下列规范值计算公开但不可修改的 `bindingDigest`：

- `planDigest`；
- `environmentDigest`；
- `databasePathDigest`；
- 已规范化的 task → project/board 白名单。

[PM business grader](../packages/cli/src/lib/evolution/pm-exploration-business-grader.js) 的 outcome source schema 升级为 `chainlesschain.pm-exploration-read-only-outcome-source/v2`，descriptor 必须包含 `outcomeBindingDigest`。签名 deployment 组装 source 时应把 `reader.bindingDigest` 原样传入。

`outcomeBindingDigest` 进入 `sourceDigest`；`sourceDigest` 已进入 grader 的查询、业务结果摘要和签名 grader receipt。因此，即使 plan/environment 与任务 ID 相同，数据库路径或读取白名单不同也会产生不同证据链，不能复用旧 source digest 冒充同一证据源。

## 3. 真实 SQLite 与负例

reader 集成测试不再使用 `:memory:` 代表真实数据路径，而是在系统临时目录创建实际 `better-sqlite3` 文件，建立 Desktop 对应表、写入数据后开启 `PRAGMA query_only=ON`，再执行项目和看板回读。测试结束关闭连接并删除该临时目录。

新增负例覆盖：

- 签名路径摘要指向另一 clone 时，尚未取得数据库连接即拒绝；
- 首轮成功后 manager 报告不同路径时，下一轮在 SQL 前拒绝；
- database path 方法是 accessor 时 getter 不会被执行；
- 仅数据库路径不同就会产生不同 reader binding digest；
- outcome source 的 binding digest 不同会产生不同 source digest；
- 原有连接替换、跨 plan/task/type、取消、数组 accessor 与真实 UUID 回归继续通过。

## 4. 验证结果

| 检查                                             | 结果                 |
| ------------------------------------------------ | -------------------- |
| Desktop reader + deployment + readiness          | 3 files，43 passed   |
| CLI business grader + execution host + loader    | 3 files，73 passed   |
| CLI PM 全组 + deployment loader + signed fixture | 14 files，172 passed |

本批没有调用火山引擎或产生新的模型费用。第十四批的真实本地火山引擎 ingress/usage/settlement 结果仍是当前 provider 证据；本批只加固本地数据库证据源绑定。

## 5. 保留边界

本批关闭的是“签名模块声明的数据库路径与实际读取路径不一致”以及“grader source digest 未区分 reader 绑定”两个代码缺口，但仍不代表目标 PM Pilot 完成：

- 当前机器没有 operator 签发并实际使用该路径摘要的 Desktop deployment；
- path digest 只绑定规范绝对路径，不是数据库文件内容摘要、文件系统 inode/file-id、加密密钥身份或不可变快照证明；
- Desktop 启动顺序在数据库初始化前装载 deployment；第十八批已在每次 Desktop round 调用时生成并核对 SQLite pre-run seal，但 reader 的 manager/连接仍在第一次 grade 时锁定；
- 尚未复制并重置 workspace/database clone，也未验证 WAL/SHM、副作用清理、进程隔离、重启或断电恢复；
- 尚未在真实 Electron 进程中让 Actor 经 DID/RBAC PM 工具修改隔离 clone，再由独立 grader 回读；
- promotion 继续保持 `hold`，不得据此进入 Pilot 或发布。

第十八批已把 SQLite backup 内容 seal 纳入 execution manifest 并在 Actor 前复核。下一步应补 workspace、执行后状态与恢复后状态证明，再运行隔离的 Electron DID/RBAC PM 工具旅程。
