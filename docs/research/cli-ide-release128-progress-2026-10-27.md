# CLI .128 与配套 IDE / 客户端发布记录

日期：2026-10-27。用户已授权推送和发布。准备基线为 `237abe18578a16990575e2bec142c0543a80ddf0`，远端 `main` 已包含前八批优化；各阶段只依据对应准确提交和公开制品证据更新。

## 当前阶段

### CLI 与 Open VSX 已公开，JetBrains 等待公开上架（2026-10-28）

CLI `0.166.128` 已经 [OIDC 工作流 40552876222](https://github.com/chainlesschain/chainlesschain/actions/runs/40552876222) 成功发布，官方 registry 版本可读取。[独立公开回读 40556529770](https://github.com/chainlesschain/chainlesschain/actions/runs/40556529770) 也已成功，确认公开归档与不可变 CI 制品逐字节相同，签名来源绑定正式标签和准确提交，10 个直接 child pins 保持一致。详见 [公开状态回执](./cli/evidence/release128-public/publication.json)。安装命令：`npm i -g chainlesschain@0.166.128 --registry https://registry.npmjs.org`。

配套 IDE 正式标签固定到已完整验证的 `6551a06c2f694bb93d0197fa8b82becd25a83173`：[Open VSX .166 工作流 40557016206](https://github.com/chainlesschain/chainlesschain/actions/runs/40557016206) 已成功，公开上架、latest 和下载均已独立核验，VSIX 原始字节与正式工作流制品相同，见 [Open VSX 回执](./cli/evidence/release128-public/open-vsx.json)。[JetBrains .183 工作流 40557015160](https://github.com/chainlesschain/chainlesschain/actions/runs/40557015160) 已通过六格真实宿主、三系统浏览器、单元测试、构建及兼容性检查，并已成功上传；公开市场仍未暴露 `.183`，继续等待审核或索引更新。客户端须在配套 IDE 公开回读通过后再发布。

[Android CLI bundle 40556532158](https://github.com/chainlesschain/chainlesschain/actions/runs/40556532158) 已基于公开 CLI `.128` 与正式源提交构建成功，仅属客户端准备产物；未触发客户端发行或新的内部 binaries 发布。Microsoft Marketplace 仍缺少 `VSCE_PAT`，其未发布状态不由 Open VSX 成功替代。

### 正式发布流程已启动（2026-10-28）

RC7 准确提交 `dfa158e36171e347a40e23356c2ed7bd04e0c061` 的 CLI CI 与 Strict Sandbox 已完整成功，覆盖 Linux、Windows、macOS。CLI CI 的 71 个必需任务成功，只有既定可选 `dry-run-publish` 跳过；严格沙箱 6 个任务全部成功。核验回执见 [gates.json](./cli/evidence/release128-public/gates.json)。

正式标签 `v-npm-0-166-128` 已固定到该提交并推送，已启动 [GitHub Actions OIDC 发布 40552876222](https://github.com/chainlesschain/chainlesschain/actions/runs/40552876222)。当前仅表示发布流程启动，尚不能称为 npm 公开版本；仍需等待工作流成功及公开归档、签名来源和 child pins 回读。CLI 核验完成后才推送 IDE 发行标签，客户端继续最后发布。

### RC7：同步已复核连接探测器的源码审计摘要

固定提交 `dfa158e36171e347a40e23356c2ed7bd04e0c061`、引用 `cli-candidate-v0.166.128-rc7` 已推送。完整门禁为 [CLI CI 40538904177](https://github.com/chainlesschain/chainlesschain/actions/runs/40538904177) 和 [Strict Sandbox 40538930581](https://github.com/chainlesschain/chainlesschain/actions/runs/40538930581)。隔离工作树已快进至该准确提交，出口审查通过（78 个候选、0 个未分类、0 个解析错误）；预算出口审查 19 项与连接探针 39 项离线测试通过，没有真实模型请求。见 [RC7 隔离预检](./cli/evidence/release128-public/rc7-isolated-preflight.json)。以上本地结果不能替代完整云端矩阵。

RC6 已执行的单元测试与 Strict Sandbox 均通过，但后置三系统 `verify-cli` 被源码出口审计拒绝：`llm-connection-probe.js` 摘要过期。干净 CI 检出没有本地生成的 Web Panel 文件，此处只有这一项未通过；不能用本地存在另外生成文件的检查结果混淆此阻塞，也不能跳过审计发布。

已定位最后审查版本 `6b3e946f322d6e28cd705fdecfc18832517f4401` 并复核后续完整差异：连接探测复用模型能力及 Responses 编解码，仍通过原 `providerFetch`、输出上限、超时、重定向拒绝和用量/错误回执边界发送一次请求。保留 `MODEL_REQUEST` 分类，仅同步该项实际字节摘要和审查理由，未修改探测行为或财务准入。新的复测 `--review-changes` 驱动修改暂时保留未提交，不纳入这一发布候选；发布源将明确固定并在干净工作树先复核完整出口审计，再重新执行其准确提交的完整跨平台门禁。

### RC6：修正 macOS 真实路径夹具

RC6 Strict Sandbox 已完整成功。CLI CI 的 macOS unit shard 4/4（job `122240521295`）被 GitHub 取消，检查注释明确为 hosted runner 多次分配未成功，并提示 macOS ARM64 容量不足；`runner_id:0`、`steps:[]`，无测试执行。一次定向重跑命令返回 `job cannot be rerun`，未认定重跑已启动；继续等待该 workflow 的其余任务及重试条件，发布仍需补齐这一分片。源码及候选引用不因此改动，未发布或启动 36+9 原生复测。

固定源码 `ba446d4c6bc9f7ca17fd18a599cc714a6ea12c88`，引用 `cli-candidate-v0.166.128-rc6`。完整门禁为 [CLI CI 40518693223](https://github.com/chainlesschain/chainlesschain/actions/runs/40518693223) 与 [Strict Sandbox 40518705767](https://github.com/chainlesschain/chainlesschain/actions/runs/40518705767)，尚待完成。预检记录：[rc6-preflight.json](./cli/evidence/release128-public/rc6-preflight.json)。候选推送不代表 npm 或市场发布。

RC6 Strict Sandbox 已完整成功。CLI CI 的 macOS unit shard 4（job `122240521295`）在执行测试前被托管平台取消，步骤为空。GitHub 注释明确为 `The job was not acquired by Runner of type hosted even after multiple attempts`，并重复提示 macOS ARM64 runner 容量受限。已保存平台注释；不会将取消项计为通过。GitHub 在全工作流仍运行时拒绝单格重跑（HTTP 403：`The workflow run containing this job is already running`），因此等待其余任务结束后，再在同一准确提交重跑未成功项，不为容量问题修改源码或创建新候选。

RC5 的 Strict Sandbox 在 macOS 15 的新复查测试中出现 11 项失败，统一原因是 `mutation scope worktree root must be its real path`。macOS 临时目录可经 `/var` 指向 `/private/var`，夹具直接传入未规范化的 `mkdtempSync` 路径，未到达被测复查行为。失败任务为 [122229167909](https://github.com/chainlesschain/chainlesschain/actions/runs/40515244727/job/122229167909)。

修复仅将 `agent-core.test.js` 中复查夹具目录经 `fs.realpathSync` 规范化，生产路径约束、预算、来源校验和断言均保留。Windows 本地模拟模型定向测试 11 项全部通过，159 项未选中；未调用真实或付费模型。该测试文件不属于安全映射 producer，现有映射无需更新。RC5 CLI CI 已请求取消，失败版本不发布；准备固定 RC6，为修复后的准确提交重新执行完整 CLI CI 与 Strict Sandbox。

### RC5：纳入复测修复，发布后再执行 36+9

发布执行已收敛到固定源码 `7742d53340788904a1f7e88003d8b60899aa6e29`，CLI CI 为 [40515103060](https://github.com/chainlesschain/chainlesschain/actions/runs/40515103060)。RC4 的只读门禁等待器和进度监视器均已停止，未自动发布；旧 RC4 CI 已请求取消，避免与 RC5 重复占用 runner。本次不从 RC4 创建发行标签，不再为同一修复新建候选。

IDE 固定候选 `6551a06c2f694bb93d0197fa8b82becd25a83173` 的 [40506935492](https://github.com/chainlesschain/chainlesschain/actions/runs/40506935492) 已完整成功；当前主线与该提交的两个 IDE 源码目录无差异。RC4 Strict Sandbox 的成功仅作为历史证据，不能用于放行 RC5。客户端准备继续隔离在 RC5 源码之上，保留 npm 包目录与最终授权 CLI 标签的字节一致性。

用户随后明确要求“那就先发布吧”“等发布完成再测试”。本次发布需包含 `5def22e364` 的通用契约覆盖指导和显式 `--review-changes`，因此此前 RC4 排除该提交的范围不再作为最新发布目标。新候选以已合入 Goal 夹具修复的主线 `ca9a66a87f9be52d8727438db624c17771ce08e0` 为基线，保留 CLI `.128` 与 IDE `.166` / `.183` 的目标版本。

Astra 核对发现，新复查测试仅使组织策略映射所绑定的 `headless-runner.test.js` 字节摘要变化；组织策略拒绝测试及断言未改。仅更新该 producer 摘要，映射静态校验通过。CLI README、根中英文 README 与离线 changelog 同步描述可选复查的范围、费用预算和 final-text-only 行为。

准备固定新引用 `cli-candidate-v0.166.128-rc5` 并为该准确提交运行完整 CLI CI 与 Strict Sandbox。此前 RC4 检查仅保留为历史证据，不能用于 RC5 发布；RC4 本地 watcher 已核实只验证门禁、不自动发布。所有原候选引用保留，不移动已有标签。发布仍使用 GitHub Actions OIDC，并在公开归档、来源与 child pins 核验成功后才进入 IDE 和客户端阶段。36+9 原生生成复测安排在相关公开版本安装核验完成后，当前不派发付费样本。

RC5 已固定为 `7742d53340788904a1f7e88003d8b60899aa6e29`，对应 [CLI CI 40515103060](https://github.com/chainlesschain/chainlesschain/actions/runs/40515103060) 和 [Strict Sandbox 40515244727](https://github.com/chainlesschain/chainlesschain/actions/runs/40515244727)。两套完整门禁正在排队/执行，尚未发布。相同 SHA 的 main push 重复矩阵已请求取消，固定引用上的手动矩阵保留。安全映射 7 项、changelog 与发布门禁 30 项本地补充检查通过；详见 [RC5 预检](./cli/evidence/release128-public/rc5-preflight.json)。

### RC4：Goal 集成夹具修复与固定发布范围

固定源码为 `944c6e321ca0e65d03b9b4b2e1fa61720ac522cf`，候选引用 `cli-candidate-v0.166.128-rc4`。隔离工作树的 4 项定向测试再次全部通过，安全映射 producer 内容绑定有效且无需刷新。完整门禁：[CLI CI 40509241325](https://github.com/chainlesschain/chainlesschain/actions/runs/40509241325)、[Strict Sandbox 40509259153](https://github.com/chainlesschain/chainlesschain/actions/runs/40509259153)。见 [RC4 预检记录](./cli/evidence/release128-public/rc4-preflight.json)。

RC2 的 CLI CI Linux unit shard 4 发现集成夹具仍仅回复 `done`，未提供新的 Goal model judge 所需的成功工具证据。修复让夹具真实读取工作区 `inspection.txt`，并要求 judge 引用本轮 `goal-tool-1`；同时验证辅助模型调用仍处于同一个未完成 Run，以及来源拒绝时不完成 Run。生产完成条件、来源校验和权限检查均未放宽。

Windows 本地沙箱首次运行在 native ACL 初始化阶段失败；在沙箱外执行相同的本地模拟模型测试后，4 项全部通过，263 项未选中，不计为通过。该测试不调用真实或付费模型。

旧 RC2 自动发布等待器已核对父进程与固定 SHA 后停止，旧失败 CI 已请求取消，未创建 npm 发行标签。后续候选从 `6551a06c2f694bb93d0197fa8b82becd25a83173` 建立隔离工作树，仅带入本次测试修复和发布记录；并发提交 `5def22e364` 的 opt-in change review 不自动纳入本次发行，也不覆盖或撤销。新候选必须重新通过自身准确提交的完整 CLI CI 与 Strict Sandbox，RC2 的成功项不能替代。

IDE 修复候选的完整工作流为 [40506935492](https://github.com/chainlesschain/chainlesschain/actions/runs/40506935492)，当前仍在运行，尚未发布市场版本。

RC2 的 IDE Linux / IntelliJ 2025.2 原生旅程发现测试预期过期：canonical peer 对 `llm capabilities --json` 只返回空回复，真实界面正确显示“无法读取配置”，原生性能探针却仍等待旧的“未配置”提示。修复仅将测试探针绑定到该夹具应出现的 `chat.llmReadUnavailable` 诊断；生产配置逻辑、就绪位、60 秒截止及采样标准不变。IDE 修复使用独立候选重跑实机矩阵；CLI 发布源码继续固定在 RC2，不受此 UI 测试修改影响。

该 IDE 修复的 `compileUiTestJava` 与 32 项原生证据 / 实机旅程驱动校验通过，保留迟到提示污染拒绝和所有就绪检查。准备固定引用 `ide-candidate-cli128-rc3` 重跑完整 IDE 工作流，仍未推送市场发布标签。

CLI RC2 源码 `750787a1393d4989d5de89abe7d62bcfe301b066` 的 [Strict Sandbox 40502727218](https://github.com/chainlesschain/chainlesschain/actions/runs/40502727218) 已完整成功；[CLI CI 40502715258](https://github.com/chainlesschain/chainlesschain/actions/runs/40502715258) 尚待完整结束。不以已通过的部分任务代替全矩阵。

准备修复后的固定候选 `cli-candidate-v0.166.128-rc2`，重新调度准确提交的 CLI CI、Strict Sandbox 及 IDE 构建验证。首个候选未发布；过期的等待器已停止，旧验证任务已请求取消，原候选引用保留。

安全映射预检已通过：实际选中的 29 项映射测试通过、0 失败，另 960 项未被该定向模式选中，不计为通过；完整安全映射单元套件另有 7 项通过。见[映射预检记录](./cli/evidence/release128-public/mapped-security-preflight.json)。内容摘要校验、过期摘要拒绝及组织策略拒绝测试继续生效。

## 首个候选记录（未发布）

首个 CLI 候选的 Strict Sandbox Linux 任务在映射安全测试前失败：`cc-2.1.223-agent-org-policy-ceiling` 绑定的 `headless-runner.test.js` 摘要仍为首批 Goal 新测试之前的字节。核对发现仅这一条 producer 摘要过期；安全场景、测试名称、组织策略断言及三系统门禁要求均保留。更新内容绑定后，需以新的固定候选重新执行完整门禁，原候选引用不移动。未创建 npm 发布标签。

CLI 候选提交 `8d529879971d9fb9b0f569238cebd12cc04e73bb` 已推送至 `origin/main`。准确提交的 [CLI CI 40498497152](https://github.com/chainlesschain/chainlesschain/actions/runs/40498497152) 和 [CLI Strict Sandbox 40498496937](https://github.com/chainlesschain/chainlesschain/actions/runs/40498496937) 已创建，当前等待 GitHub runner 调度。尚未创建 npm 发布标签，不以排队状态认定门禁通过。

另固定候选引用 `cli-candidate-v0.166.128` 到同一 SHA，并在该引用上独立调度两套门禁，避免后续主线提交取消候选验证。发布等待器仅在该 SHA 的两套完整门禁均成功、且全部配置平台任务核验通过后，才允许创建并推送 `v-npm-0-166-128`；仍由现有 OIDC 工作流再次核验后发布。

- CLI `0.166.128`：候选版本，准备准确提交的 Linux / Windows / macOS `CLI CI` 与 `CLI Strict Sandbox` 验证；尚未创建发行标签或公开发布。
- 子 npm 包：源码与 `.127` 发行依赖一致，版本固定不变；已下载 10 个固定版本的公开归档并核对 registry 元数据及 SHA-512，见[子包预检](./cli/evidence/release128-public/child-registry-preflight.json)。发布工作流仍需完成干净安装与 provenance 核验后才能发布 CLI。
- 配套 IDE 目标：VS Code / Open VSX `0.37.166`、JetBrains `0.4.183`，计划推荐 CLI `.128`；在 CLI 发布并核验前不触发 IDE 发布。
- 客户端目标：`v5.0.3.143`；在所需 CLI 与 IDE 公开制品核验后准备客户端发行和 Android CLI bundle 刷新。

现有公开组合保留 CLI `.127`、Open VSX `.165`、JetBrains `.182`、客户端 `.142`，见[上次公开回执](./cli/evidence/release127-public/publication.json)。Microsoft Marketplace 未发布的状态不由 Open VSX 成功替代。

## 本次范围

Goal 证据判定及持久检查点、首次连接三态诊断、共享模型推荐及协议探测、会话 `/model` 隔离、MCP 多语言检索与可选紧凑目录、Skills 多语言描述检索、Memory 索引候选合并。各批的本地测试和离线基线见[差距复核及实施索引](./cli-ide-codex-claude-gap-review-2026-10-27.md)。

发布使用现有 GitHub Actions OIDC Trusted Publishing。不得以本地测试、旧 SHA 的 CI 或部分平台通过替代准确提交门禁；子包 → CLI → IDE → 客户端的依赖顺序保留。原不可变发行标签不移动。

候选预检：离线 changelog 已重新生成；命令 manifest、help、completions 和协议文档无漂移；6 个发布 / changelog 测试套件、55 项通过。本地结果仅为补充，等待候选准确提交的 GitHub Actions 矩阵。

IDE 后续候选已准备版本、推荐 CLI、changelog、README 和 JetBrains 离线升级提示。VS Code Marketplace overview、JetBrains 元数据检查与 VS Code 完整 327 项单元测试通过；缓存 JBR `21.0.3` 下 Kotlin / Java / 测试编译及 5 个 JUnit 类、50 项测试通过，0 失败 / 跳过。源码推送只触发构建验证，不触发市场发布；CLI 公开制品核验前不推送 IDE 发布标签。

## 独立验收边界

跨版本合格交付仍为普通 `26/36`、首次 `6/9`，共 `32/45`；剩余 13 项不因本次工程发行自动结案。付费、native、自动晋升分别保留 `NOT_PAID_READY`、`NOT_ADMITTED`、`HOLD`。本次发布任务不发起新的付费模型请求。

MCP token 数字仅为额外定义估算；Memory 新基线仅测内存中的筛选与分页归并，不证明完整磁盘查询 SLO。新紧凑目录默认关闭，已有模型及网关别名继续保留。
