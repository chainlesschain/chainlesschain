# 费用语义与公开 SQLite 安装诊断（2026-10-11）

费用题第三轮候选虽然通过原结构checker的6/6及两个bucket反例，但没有金额断言；此前公开CLI安装又禁用了lifecycle，不能证明native SQLite。此次落实两项独立诊断，不修改旧冻结review或原模型结果。

- **费用语义校准 v1**：从第三轮归档读取4924字节原候选，固定压缩及原始SHA256；在冻结b2aa项目、无账户且断网Docker checker中，分别检查忽略请求分桶、关闭长输入倍率、关闭长输出倍率、在272000边界错误收费四项实际计费变异。原候选与工程六例分别重放，逐项保存baseline/candidate/mutant reporter和源恢复摘要；只有真实通过的完整测试才算survived，语法/import/超时/空例不能算。预期原候选四项survived、工程四项killed；校准成功与模型题成功分别记录，CI实跑之前不宣称已观察该预期。
- **公开安装 v1**（Astra协助）：Ubuntu24.04 x64 / Node22.12.0独立HOME、profile、npmrc/cache，正常lifecycle公开npm安装CLI.97，核对registry lock及八项发行源码字节；运行实际cc db init，再通过已安装CLI bootstrap/core-db及CLI sync vault写入、关闭、新进程重开和更新。按实际consumer分别绑定nested native-cipher/native/WASM驱动和已加载.node摘要。WASM回退即使读写成功也退出2，不能报native通过；不以根require(wrapper)成功替代数据库执行。不是五阶段正式首次旅程，也没有证明签名provenance、GUI或人工验收。

两个诊断的合同测试Windows Node22.22.2 **12/12**、WSL Node22.12.0 **12/12**，零skip（相同12项不累加）；ESLint与Prettier通过。原raw reporter和实现快照见[contracts/manifest.json](./contracts/manifest.json)。本机WSL不能运行Docker，公开正常安装及语义候选重放须由新增PR Actions实跑，当前待结果。两项工作流仅pull_request + workflow_dispatch，避免双触发；checkout/回执绑定准确PR head SHA，contents:read，无账户、模型、发布或自动重试。后续结果追加，不能继承f8f或5e23的旧CI门。

正式36+9仍NOT_RUN/observed=0，预算$99与旧冻结窗口保持；独立预审/外部review锁、账单/硬额度、正式目标GUI和真人辅助技术、8h/24h/SLO与native durable继续开放。旧计划不得通过诊断升级或延长窗口而静默改写。本次没有第四轮付费调用、合并或发行。
