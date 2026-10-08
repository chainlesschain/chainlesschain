# 0.166.93 / v5.0.3.140 发行与 Windows 验证增量设计

日期：2026-10-08；源码基线：`1e5477aebe1a69eba0932af915ea24ea545f66d7`。本文以已提交代码、Git 祖先关系、实际公开包及 GitHub Actions 回读为准。未提交的 NUL v3 和锁修复不纳入本次完成声明。

## 当前发行与能力归属

2026-10-08 最新回读：公开 CLI **0.166.93**、Open VSX **0.37.138**、JetBrains **0.4.156**，IDE 推荐 CLI `0.166.93`；Session Core **0.3.18**、Context/Memory Kernel **0.1.8**、PDH **0.4.64**。CLI/IDE 发行提交 `65e8c21d3a`；独立产品 **v5.0.3.140** 来自 `f733f92cb9`，已公开桌面、Android 与 iOS 制品。源码核对至 `1e5477aebe`。组织目标、授权记忆、站内通知、IDE 调查恢复与 RRSI 有界读取已进入本轮对应制品；后续 Windows 冻结工具链及 Node runtime 验证仍是实验，未获生产准入。

| 组件                         | 公开版本           | 精确来源与验证                                                |
| ---------------------------- | ------------------ | ------------------------------------------------------------- |
| CLI                          | 0.166.93           | `65e8c21d3a`；公共归档 SRI、包身份与 provenance 提交声明回读  |
| Session Core / Memory Kernel | 0.3.18 / 0.1.8     | 公开归档已下载，CLI 精确依赖匹配                              |
| Open VSX / JetBrains         | 0.37.138 / 0.4.156 | 标签绑定 `65e8c21d3a`；实际插件归档可下载，推荐 CLI 0.166.93  |
| Desktop / Android / iOS      | v5.0.3.140         | `f733f92cb9`；独立公开产品，22 个安装包、更新元数据及伴随资产 |

CLI 发行提交的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/37702363181) 为 71 成功，[Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/37702364146) 为 5/5 成功，覆盖配置中的 Linux、Windows、macOS；[npm OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/37711516449) 成功。该提交另有被取消的重复 push 工作流，不能计入成功。产品发布、IDE 宿主验证和源码基线的质量状态分别核对，不能由 CLI 门推广为全仓全绿。

产品 v5.0.3.140 已通过 [GitHub Actions 最终发布流程 37745138373](https://github.com/chainlesschain/chainlesschain/actions/runs/37745138373) 成功公开，产品源码固定为 f733f92cb9。原 Release 37719495217 的 Android bundle 核验失败；恢复流程 37734804421 完成 Android producer 与完整资产上传，但草稿查询失败；最终流程按 release ID 复核来源、资产与 CLI / IDE 前置条件后发布，未重建或替换资产，未移动标签。保留前两次失败，不写成原 Release 全绿。公开清单不等于本次重跑全部资产下载或安装验收。

| 能力                                          | 本轮对应公开制品                            | 仍开放的边界                                                |
| --------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| 个人 / 组织目标、风险巡检、受控动作、独立验收 | 产品 .140；Session Core 0.3.18 提供共享服务 | 真实租户、GUI 和业务效果需独立验收                          |
| 显式个人 / 组织记忆、站内通知与深链接         | 产品 .140，Kernel 0.1.8                     | 没有自动模型记忆注入；逻辑删除不认证备份物理擦除            |
| 重复调查恢复与 Git 谓词结果                   | CLI .93 / 配对 IDE                          | 停滞结束不是任务成功                                        |
| RRSI 默认三阶段有界读取                       | CLI .93                                     | 非原子快照，非全路径有界，真实实验 NOT_RUN / 自动晋升 HOLD  |
| 冻结工具链与独立 Node runtime 胶囊            | 1e5477aebe 源码实验                         | admissionEligible=false；正式 native36 + 9 firstRuns 未运行 |

## 桌面事务、通知身份与 Memory Kernel

`ada67dba1c` 的 sql.js 适配器补齐 deferred / immediate / exclusive 同步事务，嵌套使用 savepoint；异常回滚，最外层提交后才落盘，Promise 回调明确拒绝。它保护任务、巡检事实与通知投影的事务边界，不建立项目数据库与独立调度账本的跨库原子事务。

通知列表必须在当前宿主完成真实登录后读取；切换 DID 或注销后重验身份，未登录返回 `NOTIFICATION_IDENTITY_REQUIRED`。通知保留授权引用，静默策略、免打扰窗口和点击时当前权限重验沿用既有合同。

组织记忆服务登记为 `capability_client / capability_only`，Memory Kernel 仍是唯一 canonical writer。读 / 写 / 删除分别授权；修正 successor、撤权与删除继续验证精确版本、digest 与授权代次。

## 发布拓扑与 Android CLI bundle

`e012c0f5e7` 与 `f733f92cb9` 将产品 `vX.Y.Z` 标签排除在 workspace npm publishing 之外，保留冻结工作流契约。子包 → CLI → IDE 的 GitHub Actions OIDC 发布顺序继续生效，产品发行独立，不引入 npm token 或本机发布回退。

`31fd6dade0` 增加 Android 已发布 CLI bundle 刷新与原生产品资产完整性检查。刷新从已公开 CLI 与精确子包依赖构造可审计 bundle；需要更新物化文件时，不能只改版本号。缺依赖、缺预期平台文件或签名步骤失败时停止发布。

## Windows 冻结工具链胶囊

`8ade986b04` 从冻结 lock / Git 构建私有工具链，验证 registry integrity、包身份、文件摘要和源码 blob，不执行 npm lifecycle。归档清点 191 包、8,369 文件、111,823,724 字节，但清单仍为 `INVENTORIED_NOT_EXECUTABLE / trusted:false / executionStatus:NOT_RUN`。

独立 v2 胶囊上限为 20,000 文件、单文件 32 MiB、总量 512 MiB，原 v1 上限不变。真实运输验证为 81 文件 / 12 MiB；不将其写成满额容量或 SLO 测量。

## 独立实验 Node runtime

`1e5477aebe` 的 pipe v1 将严格匹配的 libuv 管道映射到 AppContainer LOCAL namespace；v2 仅增加受限私有根 canonical 路径回退。真实本地实验覆盖 sync / async / fork IPC、native realpath、冻结 Vitest / Vite / happy-dom 导入及 globalSetup / teardown。

实验保持同 SID、零 capabilities、Job 监督和清理，胶囊检查限 15 秒；源码强制 `experimental:true`、`admissionEligible:false`、`capabilities:{}`。后代仅有 `observed-receipts-only` 证明，不能声称所有子进程继承或生产 strict 支持已经完成。

提交内归档记录为 Node 391/391、Vitest 52/52、真实 transport 3/3，共 446 项零跳过；本机 Windows 10.0.19045 / Node 22.22.2 / ABI 127，不替代冻结目标 Windows 11 24H2 / Node 22.12.0。NUL、原 forks / config / full review、Rollup GNU 整体 ABI、Windows / macOS durable authority、网络撤销与崩溃恢复仍开放。正式计划保持 36 tasks / 9 firstRuns / NOT_RUN / INSUFFICIENT_EVIDENCE。

`04b836dfb6` 的 PID 原子发布及 `65e8c21d3a` 的大小写路径测试修复属于测试证据可靠性；它们不新增生产 evaluator 身份 authority。

## 代码、证据与使用入口

- 桌面事务：`desktop-app-vue/src/main/database.js`；Kernel writer 清单：`packages/context-memory-kernel/inventory/writers.v1.json`。
- 发布控制：`.github/workflows/release.yml`、`workspace-npm-publish.yml`、`android-cli-bundle-refresh.yml` 和 `.github/scripts/refresh-android-cli-bundle.mjs`。
- 胶囊：`packages/cli/scripts/verify01-native-toolchain-prepare.mjs`、`verify01-native-runtime-capsule.mjs`、`windows-node-runtime-diagnostic.mjs`。
- [实验回读（固定源码）](https://github.com/chainlesschain/chainlesschain/blob/1e5477aebe1a69eba0932af915ea24ea545f66d7/docs/research/cli/evidence/gap-2026-10-05/windows-runtime-adapter-2026-10-08/README.md)。
- [个人目标操作](https://docs.chainlesschain.com/chainlesschain/project-goals-current.html)、[组织协作](https://docs.chainlesschain.com/chainlesschain/organization-project-current.html)、[发布升级](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html)。
- [前次组织 / 记忆 / RRSI 合同](governance-runtime-update-2026-10-08.md)保留旧发行范围作为历史快照。

本次文档工作重新获取公开包和商店数据、校验包身份 / SRI 并回读准确发行门，没有重跑产品业务回归或正式 native36。网站构建与部署回读另存本次部署凭据。
