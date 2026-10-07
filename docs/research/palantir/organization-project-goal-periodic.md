# 组织目标周期巡检

更新：2026-10-07。第十一批在共享组织目标上增加有期限的原生巡检授权，复用既有 SchedulerRuntime、组织风险服务与全目标预算。源码及本地验证保存到 `main`；本批未发布。本文保留第十一批巡检记录；第十二批的[目标建议与多级审批](./organization-project-goal-actions.md)复用该检查和预算链路；第十三批[独立验收](./organization-project-goal-acceptance.md)成功后持久关闭后续周期并保留在途状态。

## 使用方式

在项目详情的“组织任务与审批”中打开组织目标。所有者明确授予 `goal.monitor` 并重新原生确认政策；启用者还须持有 `goal.read`、`goal.check`、`risk.read`、`risk.evaluate`。创建者只保留归因，巡检身份固定为实际确认启用的当前成员。

选择巡检间隔和本次授权小时数，再点击“确认启用周期巡检”。间隔允许 1 分钟至 24 小时，原生同意最长 24 小时，且不超过目标到期时间。原生确认显示目标、项目/组织、执行 DID、间隔、截止时间、替换的巡检 ID、目标预算和请求摘要。首次检查在一个完整间隔后到期。

| 操作                     | 效果                                                         |
| ------------------------ | ------------------------------------------------------------ |
| 重新确认巡检授权         | 以新的同意替换当前巡检，重新固定目标及权限版本               |
| 关闭后续周期             | 停止产生后续检查；已准入的周期检查仍可完成或核对             |
| 关闭周期并中止其在途检查 | 持久保存当前巡检的中止状态并发出中止请求；保留在途状态供核对 |
| 检查当前风险             | 独立的手动检查，与周期巡检共用全目标预算                     |

两种停止都要求 `goal.read` 与 `goal.monitor`，不要求仍有风险评估权限，且不影响手动检查。停止请求不表示在途 lease 已同步结束，界面保留实际 occurrence 状态。当前授权成员可以停止另一个成员启用的巡检；停止后重新启用须重新原生确认。

## 执行、失效和恢复

应用运行且当前解锁身份等于巡检 executor 时才执行。锁定、切换到其他 DID 或应用关闭暂停调度；同 DID 重新登录可在新 tick 内恢复仍有效的同意。每个 tick 和异步检查固定认证 generation，登录、锁定或切换后在途旧 generation 不可借同 DID 恢复继续写入。

同意固定目标 revision/control generation、定义摘要、组织绑定、成员、政策、映射/schema 和 scheduler authority。目标修订、暂停/恢复、成员或政策变更、绑定/schema 变化使旧同意失效，须重新原生确认。任务内容更新允许下一周期检查新数据：同意有效性比较不包含 `projectSourceRevision`，但每次具体检查固定完整当前 authority，写入前后检查来源 freshness，不能继续使用已经失效的快照。

离线跨过多个间隔只合并为当前到期检查，不补跑全部漏过周期。先持久保存 slot 与 requestId，再 enqueue；入队或结算故障保留原 slot/nonce，后续核对不能通过新 ID 隐藏未决结果。monitor ID 与 slot 绑定周期请求，已有手动记录仍兼容。

启用时以 `expectedMonitorId` 检查原生确认期间的并行替换。旧启用/停止请求只读回既有回执，不能复活旧巡检或停止后来替换的巡检。领域检查和风险用量在同一个 SQLite 事务完成；scheduler 结算是可恢复的独立投影，回复丢失、重启或结算故障不重复评估和扣预算。

## 存储与宿主

| 表                                              | 内容                                                |
| ----------------------------------------------- | --------------------------------------------------- |
| `cc_organization_project_goal_monitor_consents` | 不可变原生同意、executor、期限、目标与权限快照      |
| `cc_organization_project_goal_monitor_states`   | 当前巡检、到期时间、pending slot/请求和持久停止状态 |
| `cc_organization_project_goal_monitor_stops`    | 不可变停止请求及回执                                |

同意和停止回执禁止 UPDATE/DELETE。当前状态包含 generation 和持久 fence；重启后不能执行已经中止或被替换的旧巡检。预算仍按整个目标跨成员、手动与周期累计，受次数、elapsed 和目标到期限制，不能靠换 executor 或巡检 ID 重置。

新增两个精确 IPC：`organization-project:goal-monitor-start`、`organization-project:goal-monitor-stop`，preload 方法为 `startGoalMonitoring`、`stopGoalMonitoring`。组织 IPC 共 43 个，精确清单 1302 个，156 个未注册 renderer 通道拒绝。

组织 controller 复用独立 `organization-goal-monitoring` 受保护路径，应用初始化时启动后台 tick。关闭和数据库轮换等待个人及组织 host 完成关闭；renderer 不指定存储路径或执行身份。界面显示 executor、期限、间隔、阻断和在途状态；身份/组织/权限变化清理事实并丢弃迟到响应，同会话父刷新保留原始待核对请求，重试沿用原 ID 和内容。

## 本地验证与边界

四组隔离回归共 40 个测试文件、954 项通过，0 失败、0 跳过：CLI 571、纯合同 18、原生 228、renderer 137。本批新增周期核心 30 项、原生 28 项、renderer 18 项。源码、报告哈希及命令见[第十一批证据](./evidence/palantir-gap-organization-periodic-2026-10-07.json)；第六至第十批证据保持不变。

验证从 Git 暂存树导出独立源码快照，session-core 解析到快照而非实时工作区；依赖复用既有缓存，排除并行通知与发布诊断修改。使用 Windows / Node 22.22.2、实际 better-sqlite3 12.11.1、Vue 3.5.42、happy-dom 20.11.2；真实文件库重启、单 slot 去重、原生确认竞态、同 DID generation ABA、SQLite 回滚和手动检查隔离有覆盖。Node 语法、Vue script/template 编译、Prettier、IPC 清单及差异检查通过。

原生 dialog/认证与测试 ACL 成功回调是注入边界，未执行真实 Electron GUI、全仓库测试、完整类型检查、准确提交 Linux/macOS 发布矩阵或真实租户业务验收。仅检查逾期与未完成直接依赖，模型费用未知。第十二批已完成本轮组织目标建议与多级审批绑定；第十三批已完成本轮独立验收；组织记忆、附属/看板及其余路线图工作仍待完成；本地通过不替代发布门禁。
