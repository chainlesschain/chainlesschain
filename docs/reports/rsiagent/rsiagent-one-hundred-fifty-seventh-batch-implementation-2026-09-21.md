# 第一百五十七次工程实施：CLI Volcengine 跨进程耐久重放门禁

## 本批目标

继续优先完成 CLI 函数执行缺口：把仅存在于单个进程内存中的 request ID fence 提升为重启和多进程共享的耐久 reservation，在任何业务副作用发生前取得可回读的持久化确认。

## 实施结果

- Volcengine function authority、request、audit evidence 与 receipt 合同升级到 v4；v1–v3 descriptor 均失败关闭。authority 新增 `replayStoreId`、`replayRetentionMs` 和固定 `cross-process-exclusive-file-fsync` 模式，Desktop 请求也绑定 store 身份。
- 新增品牌化 `createVolcengineFunctionReplayStore`。store descriptor 必须与 authority 的 ID、tenant、已验签模块摘要、policy revision、store ID、保留期和模式精确一致，错配时不能创建执行 authority。
- 文件 store 复用仓库严格 `withFileLock` owner fence，活 owner 不会按时间误抢占，已确认死亡的 owner 才能恢复；请求 ID 只形成 domain-separated SHA-256 文件名，不进入宿主路径。
- reservation 在锁内以 `wx` 独占创建，循环完成全部字节写入，随后执行文件 fsync、reservation 目录 fsync 和精确回读。只有三步均成功才返回 `durable:true/readbackVerified:true` acknowledgement，之后才允许调用业务端口。
- reservation 摘要绑定 store、authority、tenant、模块、policy、request ID/digest 和 `deadline + retention` 到期时间；该摘要进入冻结执行 context、认证审计证据及最终 receipt，Desktop 会从原 request 和签名 descriptor 独立复算。
- 文件或目录同步、关闭及回读状态不明时返回固定 `CC_VOLCENGINE_FUNCTION_REPLAY_DURABILITY_UNKNOWN`，保留已创建记录且不调用业务端口；同 ID 后续调用继续失败关闭。崩溃残留的不可解析记录被保留并计入上限，只阻断对应 ID，不关闭其他合法请求。
- 过期清理与新 reservation 在同一跨进程锁内执行，目录同步后才释放；store 最多保留 4096 条记录。进程内快速 fence 的到期时间也改为 `deadline + retention`，避免长执行期间过早释放 ID。
- replay store 创建器已进入已验签 Desktop deployment 的模块摘要绑定工厂集合；替换 store 实现或 handler artifact digest 会在打开 state root 前失败。

## 回归与门禁

- CLI replay store、function authority 与签名 deployment loader 定向回归：3 test files、93 tests passed。
- Desktop capability 与 deployment loader 定向回归：2 test files、61 tests passed。
- 完整 LLM 主进程回归：39 test files、566 tests passed、15 tests skipped；仅出现既有 Node `punycode` 弃用提示。
- 覆盖重开 store/authority 后重放、两个真实 Windows 子进程竞争、目录 fsync 故障、失败后执行端口零调用、过期清理、崩溃残留隔离、descriptor 错配、reservation/audit/receipt 摘要替换及 v1–v3 降级拒绝。
- 相关 JavaScript 语法、Prettier、`git diff --check`、CLI/Desktop ESLint 与 Desktop `build:main` 通过。

## 未完成边界

- 当前 durability 是单机文件系统保证；真实断电、控制器缓存故障、macOS/Linux、SMB/NFS、跨主机副本和 WORM 留存尚未验证。
- production 签名 deployment 仍需配置稳定且受保护的 replay state root；崩溃残留的目标 ID 需要独立管理员诊断与修复 authority，本批未提供删除入口。
- 撤销决定的认证耐久审计与跨进程广播、企业身份切换/tenant/RBAC、忽略取消信号代码的硬终止，以及真实 Electron/preload/renderer/Volcengine 工具循环 E2E 仍待目标环境完成。
