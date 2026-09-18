# RSIAgent 第十六次工程实施：Desktop PM 只读结果端口与真实 SQLite 回读

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十五次独立 PM 业务 grader 与签名任务绑定](./rsiagent-fifteenth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第十七次签名数据库路径与 grader source digest 绑定](./rsiagent-seventeenth-batch-implementation-2026-09-18.md)<br>
> 状态：Desktop 主进程现在可向已验签 deployment 提供一个调用方私有的 PM 只读 outcome reader。reader 使用固定参数化 `SELECT` 回读真实项目、看板、任务和 Sprint 表，并把规范结果交给第十五批业务 grader；没有新增 renderer/IPC 入口，也没有开放通用 SQL capability。

## 1. 实际数据端口

[Desktop PM 只读 reader](../desktop-app-vue/src/main/evolution/desktop-pm-read-only-outcome-reader.js) 接受预先固定的：

- `planDigest` 与 `environmentDigest`；
- PM exploration `taskId`；
- 任务类型：`project-state` 或 `board-export`；
- 唯一允许读取的 `projectId` 或 `boardId`。

每次业务 grader 查询必须同时匹配 plan、environment、task 和类型。Actor 不能在输出中指定数据库 ID，未注册任务、跨 plan 请求、把项目任务改成看板任务、accessor/proxy 输入和已取消请求都会在准备 SQL 前失败。

Desktop 的签名 deployment loader 现在通过调用方私有 `additionalFactories.createDesktopPmReadOnlyOutcomeReader` 提供该端口。deployment 可将返回的两个直接函数交给 `createPmExplorationReadOnlyOutcomeSource()`，但不能取得通用数据库对象或任意 SQL 执行函数。

## 2. 真实表回读

项目状态使用固定参数化查询，只投影：

```sql
SELECT id, name, status, deleted
FROM projects
WHERE id = ?
LIMIT 1
```

不存在或 `deleted != 0` 的项目返回失败 observation。成功 observation 只包含 `id/name/status`，不会返回路径、用户、metadata 或其他数据库字段。

看板结果使用一条 compound `SELECT` 同时读取：

- `task_boards.id`；
- 相同 `board_id` 的 `team_tasks.id`；
- 相同 `board_id` 的 `task_sprints.id`。

这样三个实体集合来自同一 SQLite statement snapshot，不会因为分三次异步查询而混入中间并发写。结果上限为 20,001 个实体；reader 额外读取一个哨兵行，超过上限时失败关闭，而不是把截断结果交给 grader。

## 3. 数据库身份与取消

reader 在第一次实际查询时绑定 `DatabaseManager` 和底层 SQLite 对象。后续轮次如果 singleton 或连接被替换，即使新连接包含相同 ID，也会以 `database identity changed` 失败，防止同一 grader 在运行中静默切换证据源。

业务 source 传入 grader budget runtime 的 `AbortSignal`。reader 在解析数据库前和 SQL 返回后都检查 signal；取消后不再打开数据库，超时期间完成的同步查询也不会把结果交给 grader。SQLite 同步驱动本身不能在 JavaScript 事件循环中途抢占，因此目标库仍需限制规模并使用本批的行数上限。

## 4. UUID 兼容修正

Desktop 的看板、任务和 Sprint 使用裸 UUID，首字符可能是数字。第十五批业务 grader 最初错误复用了协议对象的字母开头 ID 规则。本批将业务实体 ID 改为独立的受限字符串规则，同时保留 `roundId/taskId/sourceId` 等协议 ID 的严格格式。

回归使用以数字开头的 board/task/sprint ID，避免这一问题退化为概率性线上失败。

## 5. 验证结果

[Desktop reader 测试](../desktop-app-vue/src/main/evolution/__tests__/desktop-pm-read-only-outcome-reader.test.js) 覆盖：

- `better-sqlite3 :memory:` 中创建与 Desktop 对应的四张表；
- 写入项目、看板、任务与 Sprint 后切换 `PRAGMA query_only=ON`；
- 在真实 SQLite prepared statement 上成功读取项目和完整看板集合；
- 看板只调用一条 compound `SELECT`；
- missing/deleted/orphaned 数据返回失败 observation；
- 跨 plan、跨类型、未注册 task、取消、重复 binding 和 accessor 输入失败；
- 首次查询后替换 DatabaseManager 或连接失败关闭；
- 以数字开头的真实 UUID 形态可被 reader 和业务 grader 接受。

本批验证：

| 检查                                             | 结果                 |
| ------------------------------------------------ | -------------------- |
| Desktop reader + deployment + readiness          | 3 files，39 passed   |
| CLI business grader + execution host + loader    | 3 files，73 passed   |
| CLI PM 全组 + deployment loader + signed fixture | 14 files，200 passed |

本批没有再次调用火山引擎；模型 ingress、usage 和 settlement 的真实付费验证沿用第十四批结果，本批变化仅位于本地结果回读链路。

## 6. 保留边界

该 reader 是生产数据结构上的最小权限代码端口，但还不是目标环境完成证明：

- 当前机器没有 operator 签发的 Desktop deployment 使用该 additional factory；
- 尚未在真实 Electron 进程中让 Actor 经 DID/RBAC 工具修改隔离 PM 数据库，再由 grader 回读；
- reader 只执行固定 `SELECT`，但与应用其他模块共享同一 SQLite 连接；`query_only=ON` 只用于隔离测试，生产连接并非数据库凭据级只读；
- 第十六批首次数据库身份只在第一次 grade 时绑定；第十七批已增加签名 database path digest 与每次查询前的路径复核，但连接对象仍在第一次 grade 时锁定；
- 没有验证 workspace/database clone 重置、不可逆副作用清理、进程隔离或断电恢复；
- promotion 继续保持 `hold`，该结果不能直接用于 Pilot 或发布。

下一步应建立一次隔离的 Desktop PM 工具旅程：预先复制数据库与 workspace，冻结 clone/path digest，经真实 DID/RBAC 工具执行一项项目或看板任务，再用本 reader、签名 grader receipt、恢复快照和清理证据闭环验收。
