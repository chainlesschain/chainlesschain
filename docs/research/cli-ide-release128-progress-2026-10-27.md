# CLI .128 与配套 IDE / 客户端发布记录

日期：2026-10-27。用户已授权推送和发布。准备基线为 `237abe18578a16990575e2bec142c0543a80ddf0`，远端 `main` 已包含前八批优化；各阶段只依据对应准确提交和公开制品证据更新。

## 当前阶段

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
