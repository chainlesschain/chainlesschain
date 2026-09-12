# Claude Code / Codex 差距优化：G05 插件作者 Eval 实施记录

> 日期：2026-09-13（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)<br>
> 范围：在现有通用 Eval runner 上交付本地 `cc plugin eval` 双臂入口、声明式 suite 和 JSON/HTML 报告。没有执行付费模型评测，也不把本地报告升级为生产 attestation 或插件安全审查。

## 1. 交付结果

```powershell
# 仅校验 suite、快照与双臂编排；必定返回非 PASS
cc plugin eval .\my-plugin --dry-run --json

# 同一 provider/model 下依次运行关闭插件的 control 与候选快照
cc plugin eval .\my-plugin --provider <provider> --model <model> --json

# 同时生成人工可读 HTML；pct 是百分点
cc plugin eval .\my-plugin --provider <provider> --model <model> --min-pass-rate-delta 10 --html .\plugin-eval.html
```

主要实现：

- [插件 Eval suite 与报告](../packages/cli/src/lib/eval/plugin-suite.js)
- [插件命令入口](../packages/cli/src/commands/plugin.js)
- [通用 runner 复用](../packages/cli/src/lib/eval/runner.js)
- [隔离的插件 scope 选择](../packages/cli/src/lib/plugin-runtime/scopes.js)

双臂均复用 `runEvalSuite`，所以执行成功、产物检查、无关改动和耗时仍使用 G02 已收紧的统一定义。control 通过 `CC_PLUGINS=0` 关闭全部插件；candidate 只允许 `project` scope，并在每题 setup 阶段把已读取的插件快照物化到该题临时工作区。任务结束后沿用 runner 的清理策略，`--keep` 时才保留工作区。

真实运行要求显式指定 provider 与 model，避免两个 arm 隐式选择不同目标。Agent 使用 `--ephemeral`，但仍可能按照插件及任务执行工具；该命令不是不可信插件的安全边界。

## 2. 声明式 Suite

默认文件为插件根目录的 `evals/suite.json`。suite 必须位于同一插件根内，且 name/version 必须与实际解析出的 manifest 完全一致。

```json
{
  "schema": "chainlesschain.plugin-eval-suite/v1",
  "plugin": {
    "name": "example-plugin",
    "version": "1.0.0"
  },
  "thresholds": {
    "minPassRateDelta": 0.25,
    "maxUnrelatedChangeRate": 0,
    "maxCandidateCostUsd": 1.5
  },
  "tasks": [
    {
      "id": "expected-use",
      "description": "插件应帮助完成该任务",
      "prompt": "按项目约定生成 result.json。",
      "expectation": "should_trigger",
      "fixtures": [
        {
          "path": "input.txt",
          "content": "fixture\n"
        }
      ],
      "expectedFiles": ["result.json"],
      "assertions": [
        {
          "type": "json_equals",
          "path": "result.json",
          "value": {
            "ok": true
          }
        }
      ]
    }
  ]
}
```

支持的断言是 `file_exists`、`file_absent`、`file_equals`、`file_contains` 和 `json_equals`。不执行 suite 提供的 JavaScript grader，避免把“读取评测定义”静默变成任意宿主代码执行。fixture、任务、文件、payload 大小和目录深度都有上限；绝对路径、`..`、`.chainlesschain` 任务路径、symlink 与特殊文件均失败关闭。断言读取拒绝 symlink 路径并限制单文件大小。

`expectation` 可取：

- `should_trigger`：候选必须出现绑定到该插件的工具 attribution，或调用插件声明的 Skill；
- `should_not_trigger`：候选必须有完整运行指标，且不得出现上述信号；
- `optional`：不将触发与否加入题目 gate，但仍报告观测值。

control 一律要求不得出现插件触发。触发率是显式工具/Skill 证据，不推断 prompt-only 的隐性影响；这类插件应使用 `optional`，并主要依靠候选相对 control 的客观产物增益。

## 3. 报告和 gate

报告使用 `chainlesschain.plugin-eval-report/v1`，并固定标记：

- `scope:"local-plugin-eval"`；
- `productionAttested:false`；
- 插件 payload digest、文件数、字节数；
- suite digest、相对路径和任务数；
- 固定 provider/model 与 dry-run 状态；
- control/candidate 的产物通过、执行成功、effective pass、触发率、无关改动、耗时；
- 从唯一终态读取的 usage、成本、turn 数与工具调用信号；
- pass-rate delta、gain/neutral/regression 和稳定失败原因。

候选题目只有在通用 Eval `pass` 与触发预期同时成立时才得到 `effectivePass`。候选必须全部 effective pass，并满足 suite/CLI 的最小增益、无关改动和可选成本阈值。缺少触发证据、候选退化、无增益未达到阈值、成本未知但配置了成本上限，均不能 PASS。`--dry-run` 始终返回 `INSUFFICIENT_EVIDENCE`。

HTML 使用转义后的静态表格与 JSON `<pre>`，不会把插件控制的名称、detail 或错误作为活动标记插入页面。

## 4. 本地验证

| 检查                                                                                     | 结果                                                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 插件 Eval、真实 CLI dry-run、scope/manifest/skills/hooks/policy/consent 与 Eval 命令回归 | 9 files，120 passed，1 个既有 Windows symlink 条件 skip                                   |
| 通用 Eval runner 扩展回归                                                                | 与本批相关的 4 files 组合为 68 passed、1 skipped；其中包含较慢的内置 checker 真实文件探针 |
| 真实 CLI help                                                                            | `cc plugin eval --help` 正常退出并展示全部参数                                            |
| 目标 ESLint                                                                              | 0 errors/warnings                                                                         |
| 生成物                                                                                   | command manifest、help index、shell completions、CLI reference 无漂移                     |

测试覆盖 payload/suite digest 变化、身份不匹配、危险路径、多行 fixture、双臂增益、无增益、候选退化、应触发/不应触发、dry-run 不得 PASS、usage/成本提取、HTML 注入转义以及真实 CLI 无网络 dry-run。测试模型均为 fake；没有宣称任何真实插件对真实模型产生增益。

## 5. 保留边界

- 本地 suite 和产物可由插件作者控制，不是隐藏 holdout，也不是独立评审。
- 本批不自动运行模型 grader；需要主观判定时，应另行绑定 grader 身份、成本和证据，而不能混入声明式文件断言。
- 未实现重复采样、随机顺序或统计置信区间；服务端漂移和 control-first 顺序效应仍需后续版本处理。
- 没有完成一个真实插件在固定模型上的付费 control/candidate 运行，也没有验证远端 CI/发布提交。
- “Eval PASS”与 manifest 安全、签名、权限、沙箱和人工代码审查继续分开。

因此，G05 的本地作者入口和确定性双臂报告已经可用；真实模型基线、重复采样和独立证据仍属于目标环境验收。
