# CLI / IDE 候选版本范围（2026-09-27）

建议先冻结一轮 CLI、VS Code、JetBrains 兼容版本，在发布门通过后提供试用，再据真实安装和宿主验收决定转稳定版。两份差距报告的全部验收不作为本轮范围。本文为候选范围，不是发布记录；未修改版本号、打发布 tag 或发布到 npm / Marketplace。

实施分支：`feature/cli-ide-gap-closure-2026-09-27`。当前清单版本为 CLI `0.166.77`、VS Code `0.37.118`、JetBrains `0.4.139`；这些数值仅来自源码，不能代表 registry 最新版本。候选号应在冻结提交、核对已发布版本与渠道后确定。

## 1. 候选功能范围

草稿 PR：[#383](https://github.com/chainlesschain/chainlesschain/pull/383)。首轮远端检查绑定 `01b6c0b7e450c3dca60e03d1b0a5e965b1ff7c53`：[CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/36320841003)、[CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36320840760)、[IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/36320840743)。已触发，尚无完整通过结果；之后的新提交仍须重新取得对应 SHA 的证据。

合并前版本检查已有明确待办：`node scripts/lint-publish-staleness.mjs --base=github/main --head=HEAD` 在上述 SHA 报出 Agent SDK `0.2.11` 和 VS Code 扩展 `0.37.118` 源码已变更而版本未增加。当前保留草稿，不跳过检查；候选冻结时须统一递增相关版本及下游依赖，并重新验证。本轮仍未定版或发布。

| 组件           | 本轮已实现、拟纳入内容                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI / 共享协议 | 模型 profile 与计费一致性、外部 Agent 准入和退出处理、MCP 会话恢复；有界会话分页、压缩/回退/分支/摘要来源校验、增量显示历史、输入接受回执和最终消息引用；图片读取限制 |
| VS Code        | 草稿/附件/问题表单恢复；原生 schema review 与连接生命周期；权限状态、历史分页、增量历史与现场输出合并、选区和滚动保留                                                 |
| JetBrains      | 草稿/附件/问题表单恢复；权限 ACK 与已观测进程树退出确认；历史分页、增量合并、用户行写入前身份预约、选区/滚动保护                                                      |

详细实现、分批提交和每次测试的边界见[实施台账](./cli-ide-gap-implementation-2026-09-27.md)。Windows VS Code 1.132.0 实际 VSIX 的[恢复回执](./ide/evidence/vscode-canonical-recovery-windows-5382a8c3be.json)，以及 IntelliJ 2024.2 实际 ZIP 的[恢复回执](./ide/evidence/jetbrains-canonical-recovery-windows-30c1a0e183.json)均已保存，分别绑定所列提交。两者通过双会话历史/草稿重启恢复；模型输出仍为夹具，其他版本/系统和其余场景尚待对应验证。JetBrains 旧复用 profile 曾出现历史加载失败，当前副本恢复通过，原故障唯一根因仍未确定。

## 2. 兼容与安装验收

1. CLI 和两个插件作为一组验证，安装实际打包产物，记录提交 SHA、版本、产物摘要和安装来源。
2. 运行新建会话、连续相同正文、工具中间输出、预算停止、后台完成、重启恢复、Older / Latest、回退与分支流程。
3. 验证输入保存后管道失败、丢失回执、重复回执、恢复到空输入框、附件缺失和权限切换；恢复不得自动重发输入或审批。
4. 覆盖旧 CLI 缺少 history / sync / refs 的行为：明确错误或保留未关联现场文字，不按正文猜测去重。旧会话缺少来源证据时保留快照覆盖边界。
5. 新 branch-history v2 来源元数据可能被旧 reader 明确拒绝；不能将旧版本静默忽略字段当作可回退兼容证明。

## 3. 发布前证据

用户明确要求发布顺序为：**子 npm 包 → CLI → IDE（VS Code / JetBrains）**。有依赖关系的子包先按依赖顺序发布；每一步核对 registry 可安装版本、实际产物与下游依赖对齐后，才进入下一阶段。子包未就绪不发布 CLI，CLI 未发布并验证可用不发布任一 IDE 插件。本地构建和并行测试可提前进行，公开发布遵循此顺序。

npm workflow 已在 CLI 发布前核对公开子包字节并全新安装候选 CLI。IDE workflow 新增共享[前置检查](../../.github/actions/verify-published-cli/action.yml)：仅在发布/补发路径，从公共 npm 全新安装源码清单指定的 CLI 版本，验证 CLI 及 10 个直接内部依赖的精确版本、registry 来源和完整性锁记录，运行版本/Agent capabilities 探测，再允许 Open VSX、VS Code Marketplace 或 JetBrains 上传。检查失败会阻止上传，回执随 Actions 保存；普通分支仍可先构建。

此门验证配套已发布版本可获取及其基本启动能力，不能替代 npm 发布流水线的准确 SHA、签名来源、候选包字节比对和完整平台 CI。新增校验及既有发布契约共 20 项 Node 测试通过，actionlint 和 ESLint 通过；Windows 从公共 npm 新安装现有 `0.166.77`、10 个内部依赖及实际版本/能力探测通过（[回执](./cli/evidence/ide-cli-prerequisite-smoke-windows-2026-09-27.json)）。本次没有发布新版本，也没有把这次安装探测作为当前变更的发布资格。

| 项目           | 要求                                                                                                            | 当前状态                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| CLI npm        | [AGENTS.md](../../AGENTS.md) 要求发布准确提交的 Linux、Windows、macOS `CLI CI` 和 `CLI Strict Sandbox` 全部通过 | 尚未取得本轮最终 SHA 的完整结果                   |
| 双 IDE         | 既有 [IDE Extensions](../../.github/workflows/ide-extensions.yml) 的适用构建、测试、宿主和发布检查通过          | Windows 双 IDE 恢复旅程、JetBrains 旧 profile 副本读取通过；原失败唯一根因未定，其他系统及其余场景待补 |
| 安装与协议     | 对上述同组产物执行实际安装、恢复、交互及协议兼容验收                                                            | 本地 VSIX、ZIP 与真实 CLI history/receipt 已有有限证据；最终配套版本、其他平台与真实模型待验收 |
| 发布后读取核验 | 核对 npm / Marketplace 可获取的版本和产物与发布记录相符                                                         | 发布后执行                                        |

现有 workflow 包含专用 tag 的发布触发器。准备候选范围或构建本地产物不需要创建这些 tag。采用候选渠道前需核实各发布 workflow 的渠道参数，不能假定版本带后缀就不会更新稳定渠道。

补充的[旧七标签配置副本诊断](./ide/evidence/jetbrains-old-profile-diagnostic-windows-9e44569972.json)已恢复 A/B 原六条保存行和双草稿，没有重发。此诊断使用当前夹具和独立目录，原失败根因仍未确定；恢复时的并发版本探测和历史读取排队仍待优化。

后续 `30c1a0e183` 改为选中标签才发起恢复查询，[新诊断](./ide/evidence/jetbrains-old-profile-diagnostic-windows-30c1a0e183.json)再次通过，版本探测 29→6、历史查询 9→3；A/B 历史状态已完成。同一源码的完整 initial/restart ZIP 旅程和 31 个产物独立哈希复核通过。该单轮对照证明查询数量减少，没有冻结延迟 SLO。

`989a46cd6e` 的[恢复 v2 回执](./ide/evidence/jetbrains-canonical-recovery-windows-989a46cd6e.json)进一步通过原生 Stop 取消 init 等待、迟到 init 正常完成及重启保留取消草稿且不重发；34 个产物独立复核通过。此结果仍限定 Windows / IntelliJ 2024.2，其他 Stop 阶段、附件/问题和其他宿主环境继续验收。

canonical recovery v2 已接入 JetBrains 三系统 × 两版本的 CI 宿主矩阵，保留原控制旅程并使用独立证据目录。新增工作流契约及既有发布前置检查共 21 项通过，远端六单元结果待收集；接入矩阵不等于获得发布许可。

## 4. 后续独立任务

本轮不宣称完成：NET-01 Linux 不可绕过域名出口、NET-02 已有连接撤销、CODEX-01 最新固定二进制与官方生成 schema 兼容、PERF-01 三系统正式 SLO、PERF-02 实际 usage 与压缩事实保真、VERIFY-01 30–50 真实任务、PLATFORM-01 完整平台矩阵，以及真人读屏和 8h/24h 观察。未知价格仍保持 unpriced；受限域名执行继续沿用 fail-closed。

## 5. 工作量与时间估算

截至本轮，台账共 20 个分组工作项（IDE-REPLAY / SESSION-01 合并统计）：5 项本地验证通过但仍有外部验证条件，8 项局部实现/验证，5 项待实施/系统验收，2 项持续文档/体验改进。该计数不是完成百分比，也不把所有待验收项计作缺失实现。

早期估算为当前实现批次收尾 1–3 小时、候选版准备约半天到 1 天；宿主验证随后发现并修复 Windows ACL 并发初始化、双 IDE Stop 准备竞态及 JetBrains 测试安装混入额外依赖的问题。上述 Windows 双宿主恢复旅程和旧七标签副本读取已通过，JetBrains 按选中读取的后续完整旅程也通过；候选准备仍取决于剩余场景和 CI 排队/结果，原估算不作为倒计时承诺。全部报告验收仍为 2–4 周量级，依赖账号、三系统环境、真实任务、人工听测及观察窗口。
