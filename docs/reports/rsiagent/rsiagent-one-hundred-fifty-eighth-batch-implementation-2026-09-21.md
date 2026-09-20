# 第一百五十八次工程实施：CLI Volcengine 跨进程耐久撤销

## 本批目标

继续优先完成 CLI 函数执行缺口：把仅作用于单个 authority 实例的内存撤销提升为重启可恢复、同机多进程可观察的耐久撤销，并在撤销状态无法验证时失败关闭。

## 实施结果

- Volcengine function authority、request、audit evidence 与 receipt 合同升级到 v5，replay store descriptor 升级到 v2；v1–v4 authority descriptor 均失败关闭。authority、request、receipt 与 Desktop 独立校验共同绑定固定 `cross-process-durable-readback-poll` 撤销模式。
- replay store 新增 authority 唯一撤销记录。记录摘要绑定 store、authority、tenant、已验签 handler artifact、policy revision、撤销 ID、原因摘要、授权证据摘要、审计事件摘要、耐久回执摘要和规范 UTC 撤销时间；字段替换、额外字段、Proxy/accessor、绑定错配和摘要错配均被拒绝。
- 撤销记录与 replay reservation 共用严格跨进程 owner lock，并通过 `wx` 独占创建、完整字节写入、文件 fsync、state root 目录 fsync 和精确回读后才返回 `durable:true/readbackVerified:true`。相同记录可幂等重试，不同撤销记录冲突失败；目录同步失败会返回固定 `CC_VOLCENGINE_FUNCTION_REVOCATION_DURABILITY_UNKNOWN`、保留记录，后续重试必须重新同步目录并回读成功后才能确认耐久。
- 新增只接受品牌化 authority 的 `revokeVolcengineFunctionExecutionAuthorityDurably`。入口先锁定本地 authority 并取消在途执行，再提交完整撤销证据；持久化 acknowledgement 的字段、摘要及 `durable/readbackVerified` 必须精确匹配，工厂已纳入已验签 deployment loader 的内建依赖集合。
- 每次新执行会在时钟读取、请求解析和 replay reservation 前读取耐久撤销状态；业务调用前再次读取，执行期间每 50 ms 轮询，业务结果返回后再核验。发现撤销会锁定当前 authority、abort 全部私有 controller，并以固定 `CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED` 拒绝；记录损坏或不可读取则以固定 `CC_VOLCENGINE_FUNCTION_REVOCATION_STATUS_UNAVAILABLE` 失败关闭。
- 新 authority 实例会从同一 state root 恢复撤销状态，后续请求不会触发业务端口；独立 Windows Node 子进程已验证撤销记录可见，在途 sibling authority 已验证轮询取消和迟到结果拒绝。

## 回归与门禁

- CLI replay store、function authority 与签名 deployment loader 定向回归：3 test files、100 tests passed。
- Desktop capability 与 deployment loader 定向回归：2 test files、62 tests passed。
- 完整 LLM 主进程回归：39 test files、567 tests passed、15 tests skipped；仅出现既有 Node `punycode` 弃用提示。
- 覆盖耐久发布与重开恢复、真实子进程可见性、在途 sibling authority 撤销、目录 fsync 故障及修复重试、相同记录幂等、冲突记录拒绝、损坏状态失败关闭、v1–v4 降级拒绝，以及 request/receipt 的撤销模式绑定。
- 相关 JavaScript 语法、Prettier、`git diff --check`、CLI/Desktop ESLint 与 Desktop `build:main` 通过；Desktop ESLint 仅保留目标测试文件既有的 curly warnings，无新增 error。

## 未完成边界

- 本批把授权、审计和耐久回执的摘要绑定进撤销记录，但没有在该模块内独立验证这些上游证据的签名、RBAC 决策或签发者身份；production 调用方仍必须先完成撤销授权和审计落盘。
- 50 ms 轮询能拒绝迟到成功结果并协作取消在途执行，但不能撤销轮询窗口内已经提交的外部副作用，也不能硬终止忽略 `AbortSignal` 的业务代码；进程级隔离、补偿事务和不可逆操作恢复仍待完成。
- 当前传播与 durability 仍是单机文件系统边界；真实断电、控制器缓存故障、macOS/Linux、SMB/NFS、跨主机副本、WORM 留存和 state root 权限加固尚未验证。
- profile 热重载、企业身份切换/tenant/RBAC 联动，以及真实 Electron/preload/renderer/Volcengine 工具循环 E2E 仍待目标环境完成。
