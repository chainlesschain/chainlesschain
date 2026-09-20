# RSIAgent 第一批实施：PM 基线工具与验收基础

> 日期：2026-09-17（Asia/Shanghai）<br>
> 对应审计：[RSIAgent 差距分析](./rsiagent-gap-analysis-2026-09-17.md)中的 G01/G02/G05。<br>
> 开始基线：`ea28e0c8ce26d692496e3db4e839361c3d391805`；过程中 HEAD 前进至 `5142f6744220e1ff7af68214e066a8f62b18e02e`，该提交收录此前两份 RSIAgent 文档，不是本批代码交付。<br>
> 状态：基础工具与本地合同测试已交付；真实 Desktop runner、签名 grader 接线及效果基线未完成。不能将本批称为真实试点完成或生产可用。

## 1. 本批结果

| 项目         | 已交付                                                                         | 未完成边界                                                                         |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| G01 运行条件 | 显式预算的 launch profile、只读环境预检、稳定退出码                            | 不启动 Electron，不提供身份，不强制执行预算；仍需受信宿主验证真实配置与隔离        |
| G02 独立评分 | 实际导出文件回读、精确项目状态核对、看板成员集合核对；接入 PM Journey 导出用例 | 本地结果不是签名 Eval receipt；数据库读权限隔离、完整业务 grader、重启验证尚未接线 |
| G05 数据分区 | 复用 Eval Gate 构建 suite；四维分组、训练投影、来源 ID 与训练 digest 校验      | 不代替数据集授权、真正的宿主访问隔离、签名 provenance 或独立隐藏数据集             |

原来的快速 PM E2E 启动器没有修改，模拟 LLM/测试守卫配置仍只属于它自己的测试范围。新的 profile 不会悄悄覆盖用户配置，也不会把模拟配置用于真实能力声明。

## 2. 代码与入口

- [PM 数据集与运行预检](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js)：`buildPmExplorationSuite`、`projectPmExplorationTrainingView`、`assertPmExplorationTrainingSources`、`buildPmExplorationLaunchProfile`、`inspectPmExplorationEnvironment`。
- [只读结果评分器](../../../packages/cli/src/lib/evolution/pm-result-grader.cjs)：`capturePmExportBaseline`、`gradePmExportFile`、`gradePmProjectState`、`gradePmBoardExport`。
- [诊断脚本](../../../packages/cli/scripts/pm-exploration-preflight.mjs)：输出配置建议或当前进程的预检结果，不调用模型、不启动桌面、不写配置。
- [Eval Gate](../../../packages/cli/src/lib/evolution/evolution-eval-gate.js)：新增公开的 `computeEvolutionEvalTrainingPartitionDigest`，验证 suite 后调用已有内部算法，不另造训练分区摘要语义。
- [PM Journey](../../../tests/e2e/project-management-journey.e2e.test.ts)：实际导出内容校验、看板/任务/Sprint ID 集合检查、统计操作成功标记检查。统计内容正确性与重启持久性仍需后续补齐。

仓库根目录可运行：

```powershell
# 只读检查当前进程环境；当前版本不会发放运行授权，退出码为 2。
npm run benchmark:pm:preflight

# 只打印建议配置；所有预算必须显式提供，不应用到当前进程。
npm run benchmark:pm:preflight -- --profile --max-tokens 10000 --max-tool-calls 40 --max-wall-clock-ms 60000
```

退出码：`0` 表示帮助/配置建议已生成；`1` 表示参数非法；`2` 表示运行证据不足。即使环境字段完全匹配，仍返回 `requires-host-verification`、`launchAllowed:false`、`runtimeVerified:false`、`productionQualified:false`。profile 中的预算是请求值，`budgetEnforced:false`，不能替代宿主计量和强制取消。

环境预检只输出所需变量名与期望值，不输出继承环境中的 API key、凭据、路径或不匹配原值。Actor/RBAC 均要求显式 `enforce`；不能依赖 RBAC 未设置时的 report 模式。

## 3. 评分与分区合同

### 3.1 评分器

文件导出先在新建工作区记录“目标尚不存在”，返回仅本进程可用的一次性 baseline handle。执行结束、Actor 停止写入后，宿主调用评分器回读文件，比较预先固定的 SHA-256。拒绝旧文件、与期望不符的内容（包括空文件）、非普通文件、路径穿越、Windows 设备名/路径别名、软链接/目录联接、超出 1 MiB 的文件和可检测的替换竞态。

baseline handle 不能跨进程持久化，不是恢复协议。该检查也不是 OS 沙箱：宿主仍必须停止 Actor、隔离评分器与私有答案、限制文件及网络访问。不能把 Actor 自报的状态对象传给状态评分器充当数据库回读。

所有结果明确分离 `executionSucceeded` 与 `artifactCheckPassed`，只有两者均为真时本地 `pass` 才为真；结果固定 `authenticated:false` 和 `qualifiesForPromotion:false`。签名、身份、环境和评测请求绑定继续由正式 Eval Gate 的受信 adapter 负责。

### 3.2 数据集

`buildPmExplorationSuite` 接收 `suiteId`、`datasetVersion`、`tasks`。每个任务含 `id`、`split`、`groups`、`prompt`、`expected`；分区为 `training/validation/test`，四个分组维度为 `template/project/principal/timeWindow`。相同来源必须保留相同 group 值，不能为绕过隔离而给近重复题换组名。

当前支持两类私有期望：

```json
{
  "kind": "project-state",
  "id": "project-id",
  "name": "Delivery",
  "status": "completed"
}
```

```json
{
  "kind": "file-export",
  "relativePath": "out/requirements.md",
  "sha256": "sha256:<64位小写十六进制摘要>"
}
```

第二个示例中的摘要是占位说明，必须替换为实际摘要。私有 suite 留在可信宿主，不能复制到 Actor 工作区。探索只接收 `projectPmExplorationTrainingView` 的输出：训练任务 ID/提示词与冻结摘要，没有验证/测试题、私有答案、grader ID 或分组原值。

来源检查拒绝验证/测试/未知任务 ID、重复 ID、空来源和不匹配的训练摘要。它是结构校验，不证明调用者诚实列出了全部来源。实际上下文/文件/工具隔离和签名 provenance 仍必须由现有治理宿主及 Eval Gate 证明。

## 4. 本地验证

新增测试位于 [PM 基线工具测试](../../../packages/cli/__tests__/unit/pm-exploration-benchmark.test.js)与[结果评分器测试](../../../packages/cli/__tests__/unit/pm-result-grader.test.js)。覆盖配置降级、预算边界、隐藏信息投影、跨组泄漏、摘要篡改、旧文件、错误产物、链接、越界路径、错误执行终态等。

| 本次检查（Windows 本机）        | 结果                    | 边界                                                                 |
| ------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| 两个新增单元测试文件            | 62 passed，0 failed     | 使用本地文件与测试数据，不调用真实模型                               |
| Eval Gate 定向回归              | 4 passed，125 未选择    | 仅复核 canonical suite、分区、输入结构与来源约束，不是完整 Gate 测试 |
| PM Journey `--list`             | 成功加载 33 个用例      | 只证明语法/导入与用例发现，不代表用例执行通过                        |
| 新增 JS/CJS/MJS 与测试的 ESLint | 0 error，0 rule warning | Node 对仓库既有 ESLint 配置的模块类型提示仍存在，未扩大修改范围      |
| 新增模块与文档 Prettier         | 已格式化                | 保留现有 PM Journey 文件的其他历史排版，避免整文件无关改写           |

```powershell
# 工作目录：packages/cli
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/pm-result-grader.test.js __tests__/unit/pm-exploration-benchmark.test.js
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/evolution-eval-gate.test.js -t "keeps public suite|rejects group and exact-input|rejects oversized|rejects signed artifact provenance"

# 工作目录：仓库根目录。仅检查加载和用例发现，不启动 Electron。
.\node_modules\.bin\playwright.cmd test tests/e2e/project-management-journey.e2e.test.ts --list
```

本批未执行完整 Electron PM Journey、真实模型/身份旅程、Linux/macOS 矩阵或远端发布门；没有生成能力提升报告，没有开启自动晋级、提交或发布。

## 5. 下一步与退出条件

下一批应先把 profile、数据集和 grader 接入受信 Desktop host：实际探测已解锁身份、模型 ingress、工具权限、一次性工作区与真实持久化；将私有 grader 与 Actor 运行空间分离；生成正式 execution/grade/provenance 证据。通过合法/越权角色、重启回读、重置无残留等验证后，才建立真实 baseline。

在这些条件满足前，G01/G02/G05 保持“部分实施”，第一批路线图的“真实任务可运行”退出条件仍未满足。此后再推进 G04 的逐轮候选 Memory 与有界 Broad/Deep，而不是用本地 PASS 替代真实运行条件。
