# Claude Code / Codex 差距优化：第一批实施记录

> 日期：2026-09-12（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)<br>
> 后续进展：[第二批 G06 中文词法召回实施记录](./CLAUDE_CODE_CODEX_GAP_G06_IMPLEMENTATION_2026-09-12.md)；本文保留第一批的范围与验证结论。<br>
> 本批基础提交：`9eb73b0e07f1033bc6a101c22a31d6662bff7342`。该提交包含其他工作已完成的初版 setup/doctor 提示；本批在其上继续完善，不将既有提交计为本轮新增。<br>
> 并发说明：实施期间共享仓库由其他操作推进到 `084586ab59fe1d24a90e3c9a263f67f168c77e1c`，包含部分中间修改。本轮验证针对最终工作区文件；不能把该中间提交当作全部后续测试已经通过的证明。<br>
> 范围：G01 部署准入与诊断、G02 通用 Eval 完整性。不是全部 11 项完成，也不是生产上线或发布证明。

## 1. 已实施内容

| 项目               | 本批实现                                                                               | 保留的边界                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| G01 命令级判断     | 签名、启用状态之外，分别检查 `ask` / `agent` 是否在部署命令白名单                      | 签名验证通过不等于运行时 factory 或模型请求已验证                                              |
| G01 只读诊断路径   | `evolution deployment` 配置子树独立注册，不加载部署模块，也不在失败时回落到 eager 入口 | `configure/enable/disable/revoke` 仍按用户请求变更部署配置；普通 `ask/agent` 仍走原认证 loader |
| G01 多入口说明     | setup、doctor、CLI 状态及 VS Code / JetBrains / `cc ui` 现有配置页显示部署准入         | 保留 bridge READY、签名与自动晋升 HOLD；旧 CLI 缺新字段显示未知，不推断成功                    |
| G02 执行与产物分层 | 产物检查与执行成功分别记录，任务通过要求二者同时成立                                   | 失败执行留下的正确产物仍保留其检查结果，不将其丢弃                                             |
| G02 严格趋势门     | 增加显式严格模式，拒绝缺基线、删题、损坏历史、dry-run 及不可比证据                     | 普通 `--trend` 继续用于诊断；严格结果仅属于本地比较，不是生产 attestation                      |

## 2. G01：部署准入不是实际执行保证

主要实现：[部署状态](../packages/cli/src/lib/evolution/evolution-deployment-config.js)、[命令分派](../packages/cli/src/lazy-dispatch.js)、[配置命令](../packages/cli/src/commands/evolution-deployment.js)。

`cc evolution deployment status --json` 增量返回 `readiness.ask` 和 `readiness.agent`；原来的签名、版本、来源和 HOLD 字段保留。

| 状态                  | 意义                                     | `ready` | `taskReady`            |
| --------------------- | ---------------------------------------- | ------- | ---------------------- |
| `not_configured`      | 没有启用的签名部署                       | `false` | `false`                |
| `disabled`            | 保存的部署已禁用                         | `false` | `false`                |
| `invalid`             | 校验失败、配置损坏或已撤销等             | `false` | `false`                |
| `command_not_allowed` | 部署未允许对应命令，或未提供命令准入证据 | `false` | `false`                |
| `admitted`            | 部署验证通过，且允许对应命令             | `true`  | `null`（尚未验证执行） |

每项同时包含 `scope:"deployment-admission"`、稳定 `code`、`requiredCommands`、`missingCommands`、`detail`、`remediation` 和 `runtimeVerification:"not_checked"`。

诊断只读取和验证部署字节，不 import 或构造部署 factory，不发模型请求。实际执行时仍需原运行入口完成 factory、权限、模型配置和调用验证，不能用该 JSON 替代运行授权。

```powershell
cc evolution deployment status --json
cc doctor
```

setup 默认检查 `ask` 和 `agent` 两项，分别说明“配置已保存”和“部署前置条件是否完整”；只有 `ask` 获准时，不再输出两者都就绪。IDE 使用服务端返回的逐命令状态，不在客户端仅凭 `verified:true` 重算肯定结果。刷新后缺少新字段会清除此前状态；修复提示只作文本展示，不自动执行其中的命令。

## 3. G02：严格比较的使用方式

主要实现：[Eval 命令](../packages/cli/src/commands/eval.js)、[runner](../packages/cli/src/lib/eval/runner.js)、[证据校验](../packages/cli/src/lib/eval/evidence.js)。

### 3.1 普通诊断与严格门分开

```powershell
# 诊断历史；不表示具备正式可比证据
cc eval --trend --history .\eval-history.jsonl --json

# 严格检查最近两次记录，不运行模型
cc eval --trend --strict --history .\eval-history.jsonl --max-age-hours 168 --json
```

严格门保留 `PASS`、`FAIL`、`INSUFFICIENT_EVIDENCE` 的区别；非 PASS 返回失败退出码。零次/单次运行、旧格式缺证据、重复或乱序运行、过期记录、损坏 JSONL、任务集合变化、模型/环境标识不匹配、dry-run 或执行失败不能得到严格 PASS。选择最新两条原始记录，不通过跳过坏记录或 dry-run 找到一组较旧的成功结果。

结果显式标注 `scope:"local-eval-comparison"` 与 `productionAttested:false`。它不能验证人为编辑的历史、远端模型 checkpoint 或操作者声明的真实性；npm 发布仍要求精确 release commit 的 GitHub Actions 全部规定矩阵通过。

### 3.2 生成可比较记录

运行真实 suite 时需明确 provider/model，并通过 `--comparison-context` 记录操作者声明的比较环境。下例会实际调用模型，**本次实施验证没有执行这些付费命令**：

```powershell
cc eval --suite builtin --provider <provider> --model <model> --comparison-context .\eval-context.json --history .\eval-history.jsonl --label baseline --json
cc eval --suite builtin --provider <provider> --model <model> --comparison-context .\eval-context.json --history .\eval-history.jsonl --label candidate --json
```

`eval-context.json` 需要以下字段；下面是结构说明，尖括号必须替换为真实值：

```json
{
  "schema": "chainlesschain.eval-comparison-context/v1",
  "provider": "<与 --provider 相同>",
  "model": "<与 --model 相同>",
  "modelRevision": "<固定模型版本或有记录的版本声明>",
  "environmentDigest": "sha256:<64位小写十六进制摘要>",
  "permissionDigest": "sha256:<64位小写十六进制摘要>",
  "inferenceDigest": "sha256:<64位小写十六进制摘要>"
}
```

三个摘要应来自固定、可回读的环境/部署、有效权限和推理配置快照；不要随机填值以凑齐严格门。CLI 另外记录 suite 源字节摘要、本地平台/架构/Node 及执行协议。无这份声明的普通运行仍可用于诊断，但不自动获得严格比较资格。

### 3.3 执行结果不能被产物掩盖

runner 分别保留 `artifactCheckPassed` 和 `executionSucceeded`；`pass` 要求二者都为真。真实 headless 子进程还检查退出码和成功流式终态。异常、超时、非零退出、矛盾的 `ok:true + error` 或不完整终态不能只因文件内容正确就得到任务成功。

`executionEvidence.observedFallback` 记录流中观测到的模型/provider 回退。普通任务仍允许回退后成功，但严格比较要求明确为 `false`；观测到回退或缺少该字段的记录不能证明同模型运行。它依赖运行时事件报告，不证明 provider 服务端没有内部变化。

历史记录保留逐题执行证据、错误和产物判定；错误/说明经过脱敏与限长。原来只有 `id/pass` 的旧历史不能重建执行证据，因此不会被自动迁移成可信记录。

“保留产物”指保留检查结果与改动记录；如需保留实际临时工作目录，应显式使用现有 `--keep`。默认工作目录清理策略未改变。

## 4. 验证记录

| 定向验证                                                         | 结果                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CLI deployment config、doctor checkup、deployment topic handlers | 65 passed，3 skipped（既有平台条件）                                   |
| setup 向导逻辑（mock 提示/配置，不启动下载或 Docker）            | 4 passed                                                               |
| 独立部署路由、正常 CLI 模块隔离、既有 deployment loader          | 64 passed                                                              |
| VS Code `settings-panels.test.cjs`                               | 22 passed                                                              |
| `cc ui` Vue 部署状态挂载测试                                     | 3 passed                                                               |
| JetBrains `EvolutionDeploymentConfigTest`                        | 4 passed，0 failed/error/skipped；主源与测试编译通过                   |
| Eval 正常 CLI 严格模式与旧 trend 兼容                            | 2 文件、8 passed；合成历史不代表真实效果                               |
| Eval 五文件整组                                                  | 83 passed，5 个旧 runner 用例超过原 90 秒阈值；该轮 exit 1，不视为全绿 |
| 原 5 个超时用例隔离复跑                                          | 先 1 项、再 4 项，全部通过；仅一次复跑，保持原 90 秒上限与真实 checker |
| lazy-dispatch 完整回归                                           | 25 passed；帮助索引更新后的漂移检查通过                                |
| CLI 生成文件一致性                                               | help-index、completions、command-manifest、CLI reference 检查通过      |

上述 Eval 记录不是“首轮 88 项全绿”：首轮 5 项超时仍保留；独立复跑分别为 31.01 秒和四项合计 152.09 秒，均正常退出。额外强化的终态参数组 10 项通过，与五文件中的用例重叠，不重复计数。`-t` 选择未运行的其他测试也不计为新通过。

主要复跑命令：

```powershell
# packages/cli
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/evolution-deployment-config.test.js __tests__/unit/doctor-checkup.test.js __tests__/unit/evolution-deployment-topic-handlers.test.js __tests__/unit/setup-deployment-readiness.test.js
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/evolution-deployment-dispatch.test.js __tests__/integration/evolution-deployment-cli-isolation.test.js __tests__/unit/evolution-deployment-loader.test.js
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/eval-runner.test.js __tests__/unit/eval-trend.test.js __tests__/unit/eval-timeout-kill.test.js __tests__/unit/eval-evidence.test.js __tests__/unit/eval-command.test.js
..\..\node_modules\.bin\vitest.cmd run __tests__/integration/eval-strict-cli.test.js __tests__/integration/eval-trend-cli.test.js
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/lazy-dispatch.test.js

# packages/vscode-extension
node --test test/settings-panels.test.cjs

# packages/web-panel
node node_modules/vitest/vitest.mjs run __tests__/unit/evolution-deployment-readiness.test.js

# packages/jetbrains-plugin，使用兼容 JBR
.\gradlew.bat test --tests com.chainlesschain.ide.EvolutionDeploymentConfigTest --offline
```

CLI 改动的 ESLint 检查为 0 errors，保留 doctor-checkup 原有 6 项 unused-vars warnings；不将告警称为全零。测试数据使用隔离配置、合成历史或 fake provider，不构造生产 authority，不解除 HOLD。未运行付费模型比较、完整 IDE 真宿主矩阵或远端发布 CI，也未执行 npm/扩展发布。

## 5. 尚未完成的工作

- Windows 同等并行负载下的整组稳定性仍需后续 CI 验证。原 5 个超时用例已在单 worker、原阈值下各复跑一次并通过，但本轮没有再次获得整组并发全绿；不将超时成因直接认定为环境，也没有放宽阈值或替换真实 checker。

- G01 的真实身份、公开安装产物、指定 OS/IDE 到真实模型任务的完整旅程仍待目标环境验收；诊断显示不是该旅程的替代物。
- G02 的操作者声明不等于已签名、独立采集的生产证据；本批不替换 Graph/Evolution 已有正式门，不更改 npm 发布权威。
- G03 最新模型协议、G05 插件作者评测、G06 中文召回及其余路线仍未在本批实施。
- G04 实验 Codex App Server 适配器没有接线，其协议反例仍是接线前待办；G08 非阻塞澄清也未在本批扩展。

建议下一批优先处理 G06 的可复现中文召回盲点，再推进 G03/G05；如决定接入实验 Codex 适配器，先关闭 G04 失败终态与不明提交反例。
