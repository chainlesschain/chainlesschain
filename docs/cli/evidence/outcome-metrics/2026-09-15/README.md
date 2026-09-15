# Windows CLI + Volcengine 小规模真实任务基线

## 结论

2026-09-15 在 Windows、Node `v22.22.2`、`volcengine/deepseek-v4-flash-ga-260731` 上完成三轮内置真实 Agent Eval。第一轮用于验证任务链并暴露费用证据缺口；补齐费用归因后，以相同任务、环境、权限和模型完成两次可比运行。

两次可比运行共 20 次任务尝试，20 次成功，执行终态和独立产物检查均通过，无 fallback、超时或无关文件改动。严格本地 Eval 门返回 `PASS`。这是内置 10 题在当前本机配置上的小样本结果，不是 30–50 个真实项目需求、干净安装首次运行、多平台或生产发布验收。

| 指标 | 结果 |
| --- | --- |
| 实际任务成功率 | 20/20，100% |
| 无关改动率 | 0/20，0% |
| 总任务耗时 | 672,965 ms |
| 单任务耗时 | p50 29,798 ms；p95 68,692 ms |
| 模型记录费用 | USD 0.0672595 |
| 每个成功任务费用 | USD 0.003362975 |
| tokens | input 329,775；output 22,205；cache read input 1,062,400 |

费用取自每个 Agent 成功终态的 `total_cost_usd`，没有按公开价格重新估算。token 字段按 CLI 返回值原样聚合；cache read 与 input 的供应商计量语义可能重叠，不能将三者简单相加解释为唯一“总 token”。

## 运行记录

| runId | 结果 | 耗时 | 费用 | 用途 |
| --- | --- | --- | --- | --- |
| `24ac3cd6-1a3c-44be-991e-65934814f590` | 10/10 | 300,636 ms | 未采集 | 发现 Eval 历史缺少费用/token；不计入费用聚合和严格可比对 |
| `6dbca5a2-4efc-4fa5-92b6-b0cda54f4bf4` | 10/10 | 350,193 ms | USD 0.034648908 | 可比基线 |
| `b17031ab-c066-4885-a564-fd57c2b7ce09` | 10/10 | 322,772 ms | USD 0.032610592 | 可比重复采样 |

原始 Eval 记录见 [history.jsonl](./history.jsonl)，任务级时间线见 `telemetry*.json`，声明的比较上下文见 [comparison-context.json](./comparison-context.json)。证据不包含 API key 或提示/响应正文。

## 首次运行卡点及修复

运行前只读诊断发现：ChainlessChain 用户配置为 `volcengine/deepseek-v4-flash-ga-260731`，但通用 `~/.claude/settings.json` 的 `claude-fable-5[1m]` 被 `config effective` 投影为 Volcengine 的有效模型。真实连接返回模型/endpoint 不存在；直接读取 ChainlessChain 配置并测试原模型后，连接在 1,605–2,173 ms 内成功。

本批修正继承模型的 provider 配对：普通 Claude settings 或 `ANTHROPIC_MODEL` 中明显属于其他 provider 的模型，不再覆盖 ChainlessChain 已配置 provider 的模型；显式 CLI `--model`、显式 `--settings` 和受管设置仍保留其明确/受管优先级。修复后 `config effective --json` 显示：

- 有效模型为 `deepseek-v4-flash-ga-260731`；
- settings model 的 `applied:false`、`reason:"provider_mismatch"` 可诊断；
- `cc llm test` 不带模型参数即可连接正确 endpoint。

随后真实核心 Agent 探针成功返回 `OK`，约 2,947 ms，记录费用 USD 0.00140266。受限执行环境第一次因用户级 audit lock 无写权限失败；授权用户级审计状态写入后成功。这属于本次工具执行沙箱边界，未计为产品干净安装结果。

## 可比性与限制

比较绑定 HEAD `2dc0aac62b2d9dcee0e8b473357a8aa5a452ea98` 及 dirty source fingerprint；环境摘要为操作者声明，并非已发布不可变产物的远端证明。两次可比运行的 comparison digest 为 `sha256:2dc4ddeac676059003436a3f57bcefba3757d8ab6983570165294ae8cd04e480`。

严格门命令：

```powershell
# 工作目录：packages/cli
node bin/chainlesschain.js eval --trend --strict --history ..\..\docs\cli\evidence\outcome-metrics\2026-09-15\history.jsonl --json
```

仍缺少：预先冻结的 30–50 项真实项目任务；公开产物在干净环境的安装→配置→真实任务首次旅程；Linux/macOS/IDE 分层；固定观察窗口的支持、兼容和发布维护工时。这些缺口不能用本报告的 100% 覆盖，也不能据此声称整体产品成功率为 100% 或维护成本已下降。
