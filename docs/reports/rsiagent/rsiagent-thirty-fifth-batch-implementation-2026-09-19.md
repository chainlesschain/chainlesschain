# RSIAgent 第三十五次工程实施：PM Curriculum 进程隔离与一次性任务选择门

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第三十四次工程实施：子进程监督证据耐久回读与 Manifest 绑定](./rsiagent-thirty-fourth-batch-implementation-2026-09-19.md)<br>
> 状态：PM Curriculum/任务选择现可作为第五个独立、受监督、可硬终止的进程角色运行。配置 Curriculum 的 execution host 不再接受调用方直接指定 taskId 后绕过规划角色；每轮必须先取得绑定当前 journal 位置、冻结训练任务集和独立 signer 的一次性选择回执。任务选择成本进入 checkpoint 与证据包。Memory 检索、模型出口、外部网络隔离、operator 生产配置和真实 Electron PM E2E 仍未完成，因此 G01/G04/G05 继续为“部分完成”。

## 1. execution manifest v6 的第五角色

execution manifest v6 新增：

- `curriculum`：独立 `curriculum` receipt authority；
- `curriculumIsolation`：`pm-exploration-select-task` process target；
- target handler ID/revision、模块字节摘要和 authority digest；
- supervisor authority、child evidence store descriptor 绑定与硬 deadline。

Curriculum signer 的 authority ID 和公钥必须与 runner、grader、merger、evaluator 四个 authority 全部不同。v2–v5 manifest 继续兼容：未声明 Curriculum 的旧 host 保持原有显式 taskId 调用合同；声明 Curriculum 时 authority 与 isolation 必须同时出现并使用 v6。

签名 Desktop deployment 新增：

- `createPmExplorationProcessCurriculum()`；
- `inspectPmExplorationCurriculumIsolation()`；
- `selectPmExplorationTask()`。

manifest 工厂会把 Curriculum handler artifact digest 与已验签 deployment 模块摘要绑定。

## 2. 最小任务选择请求

每次选择请求固定绑定：

- plan、suite、training partition、environment 和 execution manifest digest；
- selection ID 与下一 round ID；
- Broad/Deep stage、branch 和当前输入 Memory digest；
- plan 中冻结的 `trainingTaskIds`；
- 已完成轮数与连续无增益计数。

请求不包含 grader target、隐藏期望、grader signer、评估结果、工具 broker、模型凭据或耐久存储端口。Curriculum 子进程使用无 runtime broker 的单输入/单输出协议，只能返回 `taskId` 与 `rationaleDigest`。

返回 taskId 必须属于冻结的 `trainingTaskIds`。进程正常完成但选择分区外任务时，host 将其转换为签名失败回执，不向 Actor 发放可消费选择。

## 3. 签名选择回执与一次性消费

新增 curriculum receipt v1，签名 payload 包含：

- selection request 的全部位置绑定；
- 选中的 taskId 或失败时的 `null`；
- rationale/failure digest、状态和失败类别；
- token、tool-call、wall-clock 指标；
- `curriculumIsolationEvidenceDigest`。

成功选择必须带合法 supervision digest；失败或硬终止显式记录 `null`。supervision digest 可直接定位上一批交付的耐久 supervision 原文。

配置 Curriculum 的 host 对每个 journal 最多保留一个待消费选择。`executePmExplorationRound()` 必须取得原始签名回执，并精确匹配 round、stage、branch、输入 Memory 和 taskId。消费后立即删除；同一回执不能重放，也不能替换 taskId、跨 branch 或跨 Memory 使用。缺少回执时在 Actor 启动前失败。

## 4. 预算与恢复证据

Curriculum 调用与其他 PM 角色共享同一 plan 总预算。选择执行期间，其指标先作为 pending overhead 扣减剩余预算；Actor/grader 完成后，选择指标与 execution/grader 指标一起进入 checkpoint，再从内存 overhead 结算，避免重复计费。

因此 checkpoint 的 aggregate metrics 包含本轮任务选择成本，恢复 snapshot 重放后不会丢失已消费的 Curriculum 预算。

evidence bundle 增加：

- v3：Curriculum-bound、无 provider settlement；
- v4：Curriculum-bound、带 provider settlement。

bundle 按 checkpoint 顺序重新构造每个 task-selection request，验证选择回执、一次性 round 映射、连续无增益输入和 checkpoint taskId，并校验 checkpoint metrics 等于 curriculum + execution + grader 三方签名指标。多余、缺失、重复、跨历史或篡改的选择回执均失败关闭。

## 5. 失败语义

以下条件不能启动 Actor：

- Curriculum 未配置、回执缺失或回执不是当前 host 签发；
- round、stage、branch、input Memory 或 taskId 不匹配；
- 选择回执已消费、重放或存在另一个待消费选择；
- taskId 不在冻结训练分区；
- target 模块在 supervisor 捕获后被替换；
- target/supervisor/store 与 manifest 不同；
- target deadline 或 plan 总预算到期；
- supervision 或耐久 child evidence 校验失败。

失败选择仍产生签名 curriculum receipt，但 `selection: null`，不能转换为执行授权。

## 6. 验证与保留边界

Eval、PM、监督和部署相关回归为 **22 files、365 tests passed**。新增覆盖包括：

- Curriculum 在独立受限子进程运行，私有 grader 文件读取被拒绝；
- manifest v6 与独立 Curriculum signer/target/supervisor/store 绑定；
- 成功选择的 supervision 原文完成耐久保留和精确回读；
- 缺少选择回执不能启动 Actor；
- 成功回执只能消费一次，重放失败；
- taskId、签名摘要或位置绑定篡改失败；
- 分区外任务产生签名失败选择；
- 模块字节替换在 spawn 前失败；
- 挂起 Curriculum 达到 deadline 后被硬终止；
- 带耐久 store 的 Curriculum 不能被无 store supervisor 替换；
- 选择指标进入 checkpoint，并由 evidence bundle v3 重算验证；
- v2–v5 manifest 与无 Curriculum 的旧执行路径继续通过。

仍未完成：

- Memory 检索与模型调用尚未迁入独立、最小权限且可审计的父进程 broker/子进程边界；
- Node 22 permission model 不限制网络访问，生产环境仍需外部 sandbox、network namespace 或 firewall；
- 尚未由 operator 配置真实 Curriculum target、生产 child evidence store、模型出口和保留策略；
- 未运行独立未见隐藏集、污染/泄漏负例和真实 Electron DID/RBAC PM E2E；
- 未执行目标环境的等预算 baseline/candidate 重复采样。

因此，本批关闭的是“taskId 可绕过 Curriculum 直接进入 Actor”的仓库内合同缺口，不代表模型/Memory 隔离或目标环境试点已经完成。
