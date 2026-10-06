# OpenAI Dots、Meta Muse、Claude Mods 对 ChainlessChain 的借鉴

研究日期：2026-10-06。

[返回 Agent 研究索引](./README.md) · [返回研究索引](../README.md)

参考：[ChainlessChain 对照 Palantir 的能力差距与优化建议](../palantir/chainlesschain-palantir-gap-analysis-2026-10-06.md)及其[实施进度](../palantir/palantir-gap-implementation-progress-2026-10-06.md)。

本文后半部分附可执行实施计划，包含六个交付批次、代码落点、依赖、验收用例及发布门禁。计划状态为待开发，已有底座与拟新增能力分别标明。

**三者对 ChainlessChain 的启发可以组合成一条路线：学习 Dots 的持续目标管理、Muse 的持久执行与授权隔离、Claude Mods 的可编程扩展，再用 Palantir 报告中的“业务对象—受控动作—结果证据”把它们贯通。**

适合本项目的产品方向是：**本地优先、可持续跟进、可扩展、结果可核验的工作代理。**

| 对象 | 最值得学习的机制 | 对 ChainlessChain 的价值 |
| --- | --- | --- |
| **OpenAI Dots** | 跨对话持续推进工作，支持中途调整、事件唤醒、后台任务和结果通知 | 将聊天、调度、记忆组织成持续承担目标的体验 |
| **Meta Muse** | 持久工作空间、目标与记忆管理、执行环境和授权服务分离 | 让长期运行既有连续性，也有清楚的数据与操作边界 |
| **Claude Code Mods** | 通过 JS/TS 扩展执行事件和界面，并随插件分发 | 将项目已有能力包装成可组合、可定制的业务工作台 |

这些机制分别见官方 [Dots 文档](https://learn.chatgpt.com/docs/dots)、[Muse 设计说明](https://introducing.muse.ai/)和 [Mods 文档](https://code.claude.com/docs/en/plugins/mods/overview)。以下落地方案是结合项目代码提出的建议。本文讨论的 Muse 是个人 Agent 产品，Muse Spark 是其底层模型；Mods 则是 Claude Code 的扩展机制，三者并非同一层级的产品。

需要先校准项目现状：Palantir 分析保留了原始审计基线；其实施进度已记录个人任务受控创建/编辑、风险到动作回执的血缘、派生恢复和部分审计治理。因此，新工作应重点组合这些能力，组织权限、多级审批和真实外部连接器仍需补齐。实施记录中的本地工程验证不能直接代表真实业务成效或已发布能力。

**1. 从 Dots 学习：让用户交付一个目标，系统持续维护这项责任。**

Dots 支持在工作过程中补充信息、改变优先级，并按时间或支持的事件继续推进；其文档也明确，运行完成并不自动证明用户要求的结果已经实现。[任务与记忆](https://learn.chatgpt.com/docs/dots/tasks-and-memory)

本项目已有 [goal-store](../../../packages/cli/src/lib/goal-store.js) 的跨会话目标、关键结果、关联会话和进度，以及 [goal-context](../../../packages/cli/src/lib/goal-context.js) 的每轮上下文注入。建议扩展现有目标契约并接入调度器，补齐或统一以下内容：

- 预期结果及完成条件。
- 关联项目、任务、文档和证据。
- 已授权动作、预算与截止时间。
- 下次检查条件，以及当前等待的人或事件。
- 停止条件和最后一次可核验进展。

现有 [scheduler runtime](../../../packages/cli/src/lib/scheduler-kernel/runtime.js)已有检查点和恢复基础。最有价值的增量，是让这些状态出现在统一的目标界面中，允许用户边执行边调整方向。

例如，“持续关注项目 A 的交付风险”可以持续数周；每次对话只是对这个目标的补充。系统应在发生值得关注的变化时通知用户，并明确展示“停止本次执行”“停止后续检查”“停止相关子任务”的不同影响。Dots 官方也区分暂停主任务、停止委派任务和取消定时任务。[控制与停止工作](https://learn.chatgpt.com/docs/dots/controls)

**2. 从 Muse 学习：把长期工作空间、记忆和执行权限设计成明确的边界。**

Muse 将 Agent 放在持久工作空间中，并使用运行环境之外的 Sentinel 管理外部动作与网络访问，凭据通过独立服务处理。这种分离值得借鉴。[Muse 安全架构](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)

结合 ChainlessChain 的定位，建议这样落实：

| 方面 | 适合本项目的实现方向 |
| --- | --- |
| 持久执行 | 先用本地或用户自托管的常驻执行节点保存目标、检查点和产物，随后扩展可选远端节点 |
| 运行位置 | 界面显示任务正在何处执行；宿主离线时明确等待恢复，避免把关闭窗口和执行节点离线混为一谈 |
| 凭据使用 | 模型使用凭据引用，由连接器在实际请求时取得授权凭据 |
| 权限判定 | Agent 提出操作，宿主在执行边界复核身份、对象版本和授权 |
| 记忆管理 | 用户能够查看、修正和删除记忆，并看到来源、适用范围和更新时间 |

项目已有 [Memory Kernel](../../../packages/context-memory-kernel/README.md)的作用域、版本与删除基础。下一步可以重点补充“与目标相关的记忆”体验，区分用户明确事实、Agent 推断、任务执行状态；跨端使用记忆时仍要遵守接收者和用途范围。

这也延续了 Palantir 报告的思路：判断应能回到来源，操作应能回到授权和回执。

**3. 从 Claude Mods 学习：让业务流程和工作界面一起扩展。**

Mods 的价值是提供统一的事件中间件和界面扩展能力：插件可以参与提示、工具调用等事件，也可以增加面板、按钮和状态展示。不同宿主的 UI 支持范围有明确区别。[事件机制](https://code.claude.com/docs/en/plugins/mods/reference)、[宿主支持范围](https://code.claude.com/docs/en/plugins/mods/overview)

ChainlessChain 的 [Plugin Manifest](../../../packages/cli/src/lib/plugin-runtime/manifest.js)已经包含 skills、agents、hooks、MCP、monitors 等组件，可以在此基础上提供稳定的扩展 SDK：

- 明确哪些扩展点只能观察、哪些可以改写、哪些可以阻止操作。
- 声明支持的桌面、CLI、IDE 宿主和最低版本。
- 将证据面板、业务规则、动作入口和回执查询放进同一个场景包。
- 为没有图形界面的宿主提供文本或结构化输出。
- 提供版本兼容、组合冲突、取消及卸载后的验证工具。

一个很适合的首个扩展包是：

> **项目交付助手：风险规则 + 证据面板 + 待确认任务建议 + 受控任务操作 + 执行历史。**

权限边界需要单独设计。Claude 官方明确 Mods 不受沙箱隔离，`sec-default` 也不能限制 Mod 自行使用全部文件和进程能力。[管理与安全说明](https://code.claude.com/docs/en/plugins/mods/admin)

对本项目，应由宿主保留最终授权权威。同时，当前[插件能力检查](../../../packages/cli/src/lib/plugin-runtime/capabilities.js)对没有声明 `permissions` 的旧插件存在兼容路径；扩展 SDK 落地时，需要明确这些插件的准入和迁移规则。

建议三者共同落到一个首期场景：**个人项目风险持续跟进**。

用户给出这样的目标：

> “未来两周持续关注项目 A，发现逾期或阻塞时更新风险摘要；需要新增或修改任务时，向我展示依据和修改预览。”

完整流程应是：

1. 保存目标、监控范围、期限和通知规则。
2. 根据任务变化或定时检查读取当前数据。
3. 生成带来源版本的风险判断和动作建议。
4. 用户审阅后，通过已有受控服务创建任务或修改描述。
5. 保存实际回执，更新目标状态，并继续跟进处理结果。

这条流程已经有[个人任务动作服务](../../../packages/session-core/lib/task-description-action-service.js)作为起点。它目前明确限定个人路径，团队与组织能力应在对应权限和审批合同完成后扩展。

| 顺序 | 建议交付 | 核心验收条件 |
| --- | --- | --- |
| **P1：持续目标试点** | 目标契约、调度接入、进度与待处理事项界面 | 重启后状态可恢复；调整目标有效；完成状态有业务证据 |
| **P1：首个业务扩展包** | 项目风险面板、规则、动作与回执组合 | 各入口保持相同动作身份；扩展调用经过宿主权限检查 |
| **P2：扩大执行范围** | 自托管后台、真实连接器、移动端审阅、组织审批 | 离线、撤权、版本冲突、取消和结果未知均有明确处理 |

上述顺序是实施建议，并非工期承诺。验收指标可以沿用 Palantir 报告，再补充持续代理特有的指标：**风险发现是否及时、通知是否有用、人工修正量、每个目标的实际成本、停止是否有效，以及恢复后是否产生重复操作。**

**4. 实施计划：首期范围与交付方式。**

首期交付“个人项目风险持续跟进”：用户在现有项目详情页设定一个目标，系统按约定检查当前项目，生成证据与建议，用户回到桌面确认后执行规范任务创建或描述修改。首期采用单个已授权桌面宿主执行；界面关闭但主进程仍运行时可继续检查，进程退出或身份锁定后记录等待恢复。常驻系统服务、自托管远端节点和组织权限作为后续批次扩展。

现有能力按以下边界复用：

| 已有底座 | 代码落点 | 本轮增量 |
| --- | --- | --- |
| 跨会话目标与自评 | [goal-store.js](../../../packages/cli/src/lib/goal-store.js)、[goal-assess.js](../../../packages/cli/src/lib/goal-assess.js)、[cc goal](../../../packages/cli/src/commands/goal.js) | 版本化目标、业务对象绑定、调度与证据引用；保留原命令兼容性 |
| 会话完成条件与预算 | [goal-condition-engine.js](../../../packages/cli/src/lib/goal-condition-engine.js) | 复用单次运行的预算和评估能力；补跨运行总账与独立业务完成判定 |
| 调度与恢复 | [runtime.js](../../../packages/cli/src/lib/scheduler-kernel/runtime.js)、[store.js](../../../packages/cli/src/lib/scheduler-kernel/store.js)、[service.js](../../../packages/cli/src/lib/scheduler-kernel/service.js) | 目标到 job/occurrence 的适配、桌面宿主生命周期接入、目标修订失效与通知去重 |
| 风险和受控动作 | [风险服务](../../../packages/session-core/lib/project-risk-review-service.js)、[动作服务](../../../packages/session-core/lib/task-description-action-service.js) | 后台只读检查、待确认建议、目标与 review/ActionRun 关联；风险到创建动作的关联单独验收 |
| 现有桌面工作区 | [IPC](../../../desktop-app-vue/src/main/task/task-description-ipc.js)、[风险面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectRiskReviewPanel.vue)、[任务抽屉](../../../desktop-app-vue/src/renderer/components/projects/ProjectTaskDescriptionDrawer.vue) | 嵌入目标卡片、运行位置、下次检查、待处理事项和控制入口 |
| 记忆与插件 | [Memory Kernel](../../../packages/context-memory-kernel/README.md)、[插件清单](../../../packages/cli/src/lib/plugin-runtime/manifest.js)、[Hook Runner](../../../packages/cli/src/lib/hook-runner.js) | 目标记忆引用、宿主扩展声明、首个项目交付场景包 |

任务编号统一使用 `DMM-*`。下表描述新增工作，初始状态均为“待开发”。责任角色用于后续分工，不代表已经指定具体人员；每批以出口验收进入下一批，工期在人员和基线回归确定后估算。

| 批次 | 任务 | 责任角色 | 前置依赖 | 可审阅交付物与完成条件 |
| --- | --- | --- | --- | --- |
| B0：接入基线 | DMM-00 宿主与契约接入 | 运行时、桌面 | 当前源码与 Palantir 实施记录 | 固定源码 SHA；列出能力/权限/存储矩阵；以测试证明桌面可通过中立入口调用既有 scheduler，处理 CLI ESM 与桌面 CJS/打包边界；业务服务保持桌面主进程身份权威 |
| B1：目标合同 | DMM-01 版本化目标与状态 | 领域、运行时 | DMM-00 | 扩展现有目标语义，新增 schema/revision、范围、对象引用、完成条件、预算、期限和控制代次；旧目标读取兼容，修订冲突明确拒绝，单次运行与长期目标状态分开 |
| B1：目标存储 | DMM-02 存储适配与兼容 | 领域、桌面 | DMM-01 | 把现有目标读写封装为可注入适配器；CLI 保留文件适配，桌面目标使用当前项目数据库的受控存储；同一目标只有一个权威存储，迁移失败保留原数据 |
| B2：持续执行 | DMM-03 目标调度适配器 | 运行时 | DMM-01、DMM-02 | 注册个人项目风险检查 adapter，绑定 goal/job/occurrence；持久唤醒、租约、检查点、过期检查合并、停止和预算结算通过真实进程恢复用例 |
| B2：受控操作 | DMM-04 授权与证据衔接 | 领域、桌面 | DMM-01、DMM-02 | 后台生成建议；桌面重读来源和版本、原生确认后执行；goal/review/admission/ActionRun 可关联查询；过时、撤权、取消和 unknown 路径均有证据 |
| B2：目标记忆 | DMM-05 记忆与通知合同 | 记忆、产品界面 | DMM-01、DMM-02 | 目标只关联授权记忆及其版本；提供查看/修正/删除入口；通知按目标、来源版本和风险变化去重，静默时段及待处理事项可查询 |
| B3：用户闭环 | DMM-06 工作区与首期旅程 | 桌面、领域、验证 | DMM-03、DMM-04、DMM-05 | 在既有风险面板和任务抽屉接通目标创建、查看、调整、暂停、恢复、停止；真实 Electron 旅程完成检查→确认→写入→回执→再次检查 |
| B4：扩展契约 | DMM-07 最小扩展 SDK | 插件、运行时、桌面 | DMM-00、DMM-04 | 发布宿主版本/能力声明、只读事件、动作提议和声明式 UI 插槽；扩展无法替换权限决策或伪造回执；版本不兼容和旧插件准入规则有明确结果 |
| B4：业务场景包 | DMM-08 项目交付助手包 | 插件、桌面 | DMM-06、DMM-07 | 用受信场景包组合风险规则、证据面板、动作入口；安装、升级扩权、禁用、卸载和目标保留策略可验证；缺 UI 的宿主提供已验收的文本投影或明确不支持 |
| B5：效果验收 | DMM-09 业务样本与恢复验收 | 验证、业务代表 | DMM-06、DMM-08 | 冻结样本和独立预期；采集来源、结果、人工修正、通知与费用；完成故障注入和真实宿主旅程；各项保留通过/失败/未运行结论 |
| B5：交付 | DMM-10 灰度、发行与回退 | 发布、验证 | DMM-09 | 功能开关默认关闭，试点显式启用；候选准确提交通过适用 CI；迁移/禁用/回退演练完成；若涉及 npm，按 OIDC 和子包→CLI→IDE 顺序发布并回读 |

执行主线为 `B0 → B1 → B2 → B3 → B4 → B5`。DMM-03/04/05 可以在目标合同固定后分别推进；DMM-07 的契约设计可提前，但其动作写入必须依赖 DMM-04。每个任务宜形成独立、可回退的 PR；契约、行为与对应回归一起提交。

**5. 核心合同与各批次的具体实现约束。**

**目标与存储（DMM-01/02）。** 沿用 `active/paused/done/abandoned` 生命周期，另设执行状态和等待原因。建议新增字段如下；字段名是计划草案，最终以版本化 schema 为准。

| 字段组 | 最小内容 | 语义 |
| --- | --- | --- |
| 身份与版本 | `schemaVersion`、`goalId`、`revision`、`storeId`、`ownerRef` | 通过宿主确定身份；并发修改比较 revision；不同存储中的同名 ID 不自动等同 |
| 业务范围 | `projectRef`、`objectRefs`、`allowedActionTypes`、`authorizationRefs` | 引用规范业务对象；目标文本和插件清单不能自行授予动作权限 |
| 目标完成 | `acceptanceCriteria`、`evidenceRefs`、`verifiedAt` | 完成依赖独立业务断言或明确记录的人工验收；LLM 自评进度是辅助信息 |
| 调度与控制 | `triggerRefs`、`nextCheckAt`、`expiresAt`、`controlGeneration` | 关联既有调度账本；修改范围、暂停或停止后，旧代次不能继续提交新动作 |
| 使用量与结果 | `budgetPolicy`、`usageRefs`、`lastReviewRef`、`actionRunRefs` | 预算跨运行累计；usage 缺失标记 unknown，不按零费用记账 |
| 通知与记忆 | `notificationPolicy`、`memoryRefs`、`waitingReason` | 记录来源版本和可见范围；活动状态不作为长期事实自动写入记忆 |

桌面首期目标由当前宿主的项目数据库保存并授权；CLI 的现有文件目标继续使用旧适配器。通过完整目标引用指定权威存储，跨宿主展示经授权服务读取，避免把同一目标同时写入两套存储。旧目标仅补兼容缺省值，不因读取而自动开启后台监控、绑定 DID 或扩大权限。将既有 CLI 目标导入个人项目时需显式选择，保留原 ID 映射、来源版本和备份；迁移失败回到原适配器。

共享的目标校验/存储接口可放入 `packages/session-core/lib/goal-contract.js` 与 `goal-repository.js`，两者为拟新增文件；CLI 的 `goal-store.js` 保留兼容入口。调度逻辑继续复用现有 kernel，通过公开的宿主中立入口接入桌面。B0 必须验证源码和打包后两种加载方式，桌面 renderer 不直接导入 CLI 私有模块。

**调度与停止（DMM-03）。** 新增或扩展既有 adapter，把持久 occurrence 绑定至目标 revision 和控制代次。首期提供固定时间检查、显式“立即检查”；仅在已接通持久领域事件时启用事件触发。任务变更通过事务事件意图或水位补扫衔接，UI 临时事件只作为加速提示。每次执行前从宿主重验授权、期限和预算。

- “暂停目标”停止新检查，在已有安全检查点暂停活动执行；只有适配器确认后才显示已暂停。
- “停止本次执行”只影响指定 occurrence，界面明确后续检查是否仍启用。
- “结束持续跟进”禁用后续触发，处理当前活动执行和待确认建议，展示尚不能确认停止的工作；已完成的业务变更仍保留。
- 到期和预算耗尽进入明确的停止/等待原因，不能直接标成目标达成。服务离线后合并过期的只读检查，并记录原本应检查的时间范围。
- 使用既有租约和 fence 控制一个 occurrence 的提交者。旧进程恢复后不能提交迟到结果；新进程先核查原 ActionRun，业务结果未知时不换键重放。

目标状态与业务回执可能位于不同事务域。业务对象和 ActionRun 继续由既有服务原子提交；目标侧通过持久关联意图与恢复核查更新投影，不能声称跨账本原子提交。幂等键在意图建立时持久化，重试沿用原意图身份。

**操作与记忆（DMM-04/05）。** 首期后台只读检查并生成待确认建议，无交互宿主不能代签或保持隐藏确认框。打开桌面待处理事项后重新读取项目、来源和对象版本，再交由现有主进程确认与动作服务执行。等待期间的撤权、目标暂停、截止或参数变化使旧确认失效。仅在已有 action 合同和来源关联验收完成的路径开放写入。

“风险→描述修改”已有局部血缘；“风险→创建任务”需要补充对应关联和回归，不能从前一路径推定完成。描述改写和新建任务成功，只证明该动作完成；再次读取截止时间、依赖等业务字段后，才能判断原风险是否变化。当前规则只识别逾期和直接依赖信号，零命中不能表述为项目全面无风险。

目标记忆继续使用 Memory Kernel 的 scope、revision 和墓碑机制。删除或撤权先阻止后续读取，运行中的结果在输出前重验；跨目标引用不复制受限正文。首期通知仅进入应用内活动/待处理中心，保存去重键和用户已读状态；新增风险、风险变化和需要决策可通知，同一来源的重复检查只更新检查时间。

**工作区与扩展（DMM-06/07/08）。** 在现有项目页增加目标卡片，展示目标、最近真实检查时间、运行宿主、下次检查、等待原因、预算、证据及动作回执。界面同时显示“本次检查结束”和“长期目标是否达成”，并在切换项目/身份/目标修订时丢弃迟到响应。

最小扩展 SDK 首期只开放授权后的只读事件、声明式面板和动作提议。事件类型可先覆盖目标状态、风险检查完成和动作回执更新；宿主负责按权限投影。提议仍经过同一主进程服务，插件不能直接写业务表、提供可信用户身份、消费审批或伪造执行终态。

每个扩展声明包版本、支持宿主、接口版本、事件、UI 插槽与能力上限。普通观察器出错记录诊断并隔离；宿主必需的权限检查缺失或出错则拒绝执行。旧插件仍走既有兼容路径，但进入新的持续目标与动作扩展接口前必须显式声明能力并获得对应准入。首期采用受信声明式场景包；任意第三方 JS/TS 改写执行流程，待独立隔离和跨平台验收后另行开放。

禁用/卸载场景包时禁止创建新运行，按能力停止活动执行，保留目标与历史回执，并把无法继续运行的目标标记为缺少扩展。扩展重新安装后由用户恢复；升级扩大能力范围沿用重新同意机制。

**6. 验收用例、测试入口与证据。**

下面各项是新试点必须完成的验收，不因已有模块单测通过而自动满足。测试层次分为合同/存储、真实 SQLite 与进程恢复、组件交互、真实 Electron 宿主旅程和真实业务样本。

| 用例 | 操作 | 必须观察到的结果 |
| --- | --- | --- |
| 旧目标兼容 | 读取/修改旧 JSON 目标，模拟迁移失败 | 既有目标和关键结果保留；不自动获得监控或项目写权限；可继续使用原存储 |
| 中途修订 | 检查执行期间修改范围或期限 | 旧 revision 的建议不能作为新版本结果提交；新检查使用当前范围 |
| 重复事件 | 多次投递同一任务变更并执行定时补扫 | 保留可核查检查记录；同一风险无重复通知或重复创建任务 |
| 并发宿主 | 两个进程争取同一 occurrence，旧进程迟到 | 只有有效租约/fence 的进程可提交；跨进程测试使用隔离的测试目录与数据库 |
| 暂停与旧确认 | 展示确认后暂停目标、撤权或切换项目归属 | 旧确认不能写入；控制命令有真实受理和停止结果 |
| 崩溃与未知 | 分别在执行前、业务提交后、目标投影更新前终止进程 | 沿原 ActionRun 查询和恢复；已提交动作不重放；无法核实的结果保留 unknown |
| 数据不完整 | 缺字段、来源删除或转移、损坏依赖、超过读取上限 | 明确不足/拒绝/失败；不能转成“无风险”或空项目成功 |
| 记忆纠正与删除 | 用户修改事实或撤销访问，后台仍有旧结果 | 后续读取及展示重验；旧记忆不被再次自动导入；来源和修订可追溯 |
| 扩展生命周期 | 升级扩权、版本不兼容、禁用、卸载 | 未经对应准入不启用新能力；停止未来触发；历史可读；不能绕过宿主授权 |
| 预算和离线 | 超出次数/token/时间上限；费用未知；宿主重启 | 不启动超预算运行；费用不伪装为零；离线时间和恢复后的合并检查可解释 |
| 业务完成 | 自评进度为 100%，但独立业务断言未满足 | 长期目标不因自评或调度成功而自动完成；回执与判断分别展示 |
| 完整用户旅程 | 真实 Electron 中建立目标、发现风险、确认动作、再次检查、结束跟进 | UI、原生确认、真实业务数据和回执一致；结束后无新的巡检执行 |

开发前可从仓库根运行以下现有针对性回归作为基线；这是后续实施命令，本次文档补充未执行产品测试。Windows 使用 `npm.cmd`，其他系统使用 `npm`。依赖按仓库现有锁文件准备。

```powershell
# 长期目标与单次会话完成条件
npm.cmd --prefix packages/cli test -- __tests__/unit/goal-store.test.js __tests__/unit/goal-context.test.js __tests__/unit/goal-assess.test.js __tests__/unit/goal-condition-engine.test.js __tests__/unit/agent-goal-binding.test.js

# 调度、持久化及执行授权
npm.cmd --prefix packages/cli test -- __tests__/unit/scheduler-kernel-runtime.test.js __tests__/unit/scheduler-kernel-store.test.js __tests__/unit/scheduler-kernel-service.test.js __tests__/unit/scheduler-kernel-authority-resolver.test.js

# 业务对象合同及确定性风险规则
npm.cmd --prefix packages/session-core test -- __tests__/business-object-contract.test.js __tests__/project-risk-evaluation.test.js

# 实际 SQLite 服务、动作与血缘；测试位于 CLI 包
npm.cmd --prefix packages/cli test -- __tests__/unit/project-risk-review-service.test.js __tests__/unit/project-risk-lineage.test.js __tests__/unit/project-risk-lineage-audit.test.js __tests__/unit/task-description-action-service.test.js __tests__/unit/task-create-action-service.test.js

# 插件合同、能力与执行策略
npm.cmd --prefix packages/cli test -- __tests__/unit/plugin-runtime-manifest.test.js __tests__/unit/plugin-runtime-hooks.test.js __tests__/unit/plugin-runtime-capabilities.test.js __tests__/unit/plugin-runtime-policy.test.js __tests__/unit/plugin-runtime-consent-enforce.test.js

# 桌面主进程/IPC 与组件测试，不能替代真实 Electron 旅程
npm.cmd --prefix desktop-app-vue test -- --config vitest.business-actions.config.mjs
npm.cmd --prefix desktop-app-vue test -- --config vitest.business-actions-renderer.config.mjs
```

新增合同和联调用例随相应批次加入现有测试包；DMM-06 补真实 Electron 旅程并登记执行命令，DMM-09 补可复现的进程故障演练。命令、配置和用例集合必须纳入 CI，不能仅记录一次本地通过。

真实业务样本先固定项目来源、时间范围、独立标注和验收标准，再运行候选实现。衡量风险发现率、误报、通知接受情况、人工修正、实际业务结果与成本；所有指标记录分母、缺失和 unknown。与相同样本上的现有手动风险检查流程比较，保留无提升的结果。现有固定 36+9 评测口径保持独立。

每个任务的证据至少包含 `taskId`、源码 SHA、宿主/OS、依赖版本、场景 ID、执行命令、真实/替身环境、业务断言、回执引用、通过/失败/未运行结果。建议随实施新增独立进度表和证据目录；本计划本身不记录尚未发生的测试成功。

**7. 发布、回退与第二阶段依赖。**

DMM-10 发布前先验证关闭功能开关时旧目标、旧项目页和已有任务操作仍正常；开启后按个人试点逐步放量。停止新运行后再切换版本，保留 queued/running/unknown 回执供核查。数据库升级优先采用向后兼容的增量迁移；旧版本不能理解的目标 schema 应明确拒绝写入。回退默认关闭新功能、保留数据并恢复兼容适配；恢复备份前停止写入并核对水位，禁止直接覆盖仍有新业务写入的数据库。

涉及 npm 包时，按仓库既有规则验证准确候选提交的 Linux、Windows、macOS 工作流。CLI 要求 `CLI CI` 和 `CLI Strict Sandbox` 的全部配置平台通过；GitHub Actions 是正式发布门。本地结果、旧提交检查或部分矩阵不能替代该门禁。使用 GitHub Actions OIDC Trusted Publishing，顺序为所需子 npm 包 → CLI → VS Code / JetBrains 扩展；每阶段检查依赖版本并从公开渠道回读后进入下一阶段。产品桌面旅程和数据恢复验收单独保留，不能由 npm 发布门代替。

| 第二阶段任务 | 启动条件 | 交付与验收 |
| --- | --- | --- |
| DMM-P2-01 自托管常驻节点 | 首期进程恢复、单写者和停止语义通过，明确目标操作系统与部署位置 | 用户显式配置服务；健康/离线可见；凭据与本地数据库权限明确；租约转移、升级及回退实测后才声明跨节点恢复 |
| DMM-P2-02 一个真实外部连接器 | 确定服务、测试账号和具体动作，补齐该动作的授权与回执合同 | 凭据引用和请求时注入；幂等/限流/撤权/回执丢失验收；无法核验结果时阻止自动重发 |
| DMM-P2-03 团队与移动端 | Palantir 组织归属、最终事务权限、多级审批合同完成 | 先提供授权摘要、通知与审批；审批绑定操作/对象版本和单次消费；移动端拒绝旧确认；再扩展组织写入 |
| DMM-P2-04 第三方可编程扩展 | 宿主能力上限、插件隔离和生命周期已跨平台验证 | 开放受控改写接口与开发工具；验证异常、超时、进程退出和冲突顺序，保持宿主最终权限判定 |

首期本地只读检查、个人受控动作和工作区闭环可直接进入开发，不依赖外部租户。真实业务效果验收需要业务代表提供可用样本；P2 连接器和常驻部署在具体目标明确后分别实施。

最值得投入的是把已有底座变成用户每天能委托、能观察、能纠正的完整流程。上述判断来自官方资料与本地源码核查，未对三家产品进行实际运行效果比较；目标契约扩展、SDK 增量和完整试点流程均为待开发计划。
