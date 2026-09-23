# Laya 本地真实权重联调记录（2026-09-23）

## 范围与环境

这是一次 Windows CPU 本地冒烟联调，不是冻结数据集评测，也不构成 `suggest` 放量证据。测试服务只监听 `127.0.0.1:8000`，使用 `LAYA_SERVE_BACKEND=laya`、`LAYA_SERVE_DEVICE=cpu`、`LAYA_SERVE_PRELOAD=false`；没有使用 `fake` 后端或远程推理服务。主机约 16 GiB 内存，无可用 CUDA GPU。

| 组件                  | 本次版本或身份                                                            |
| --------------------- | ------------------------------------------------------------------------- |
| Python / PyTorch      | 3.12.10 / 2.14.0+cpu                                                      |
| Laya / laya-serve     | 0.3.6 / 0.1.0                                                             |
| Transformers          | 5.17.0                                                                    |
| CLI 源码基线          | `5cd77be414` 加本次未发布工作区修复；不是 npm `0.166.71` 二进制           |
| Hugging Face 权重仓库 | `convaiinnovations/laya`，提交 `1c5edc17a7acd8701df6fc341c0d179f1c62c982` |
| 英文权重 SHA256       | `891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c`        |
| 多语言权重 SHA256     | `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`        |

两份本地 `model.safetensors` 的 SHA256 均与仓库 LFS 对象一致。英文配置 `max_len=512`，多语言配置 `max_len=1024`。以下延迟是端到端单次墙钟时间；首请求包含下载与加载，热请求只有少量重复，不能称为 p95。

## 实测

使用 [本地探针](../../../packages/cli/scripts/laya-live-probe.mjs)构造与 CLI 相同的 `state` 和类型化问题，并通过正式的 Laya provider 发送；`runtime` 模式还经过决策运行时、用量事件和观察事件。两个候选分别为单元测试修复和旅行规划，真实任务是修复 JavaScript 单元测试。

| 请求                                               | 延迟                         | 响应与决策                                                                   | 用量/观察                                |
| -------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| 英文，provider 首次请求                            | 220.6 s                      | `best_skill=c1`，置信度 `0.4949`；本地阈值下弃权                             | `input_tokens=640`，`output_tokens=0`    |
| 英文，provider 热请求                              | 9.22 s                       | 同上                                                                         | 同上                                     |
| 英文，`shadow` runtime，30 s 截止                  | 7.25 s                       | `abstain`，`choice-confidence-below-threshold`，Agent 不可见                 | 2 条用量边界事件、1 条观察事件           |
| 中文，CLI 完整 `state`，provider 热请求            | 10.84 s                      | `best_skill=c1`，置信度 `0.5453`；本地阈值下建议 `c1`                        | `input_tokens=692`，`output_tokens=0`    |
| 中文，CLI 完整 `state`，`shadow` runtime           | 7.75 s                       | `suggestion`，Agent 不可见                                                   | 2 条用量边界事件、1 条观察事件           |
| 英文，`shadow` runtime，默认 800 ms 截止（修复后） | 0.823 s                      | `unavailable`，`provider-timeout`，无可见建议                                | started + unknown 用量事件、1 条观察事件 |
| 中文，仅任务文本作为 `state` 的服务诊断请求        | 首次 119.2 s；热请求 0.710 s | 多语言权重被载入；`needs_skill=0.0707`、`fits_c1=0.0793`，按本地阈值为无匹配 | `input_tokens=232`，`output_tokens=0`    |

`laya-serve` 对两种实际权重均返回 `model=laya-english` 标签，不能据此判断载入的 checkpoint。CLI 完整中文 `state` 的候选名称、描述、分类和标签以英文为主；直接调用 Laya Router 对同等结构的 `state` 得到 `RouteDecision(model='english', reason='English Latin text')`。当时本地缓存也只有英文权重。随后仅中文任务文本的诊断请求下载并载入了多语言权重。该诊断请求改变了 `state` 格式，不能作为现有 CLI 中文路径的效果数据。

首次加载英文权重时，Laya 对 checkpoint 的 `choice:11+` 温度参数输出了钳制警告；本次三选项请求不在该桶。`usage.input_tokens` 是服务回执，不能直接解释为有效上下文长度；截断和信息保留仍需单独测量。运行时观察记录的是配置模型别名 `laya`，并非实际权重身份。

## 结论与后续

真实权重已通过 System One 协议、响应校验、用量事件与 `shadow` 观察链路。当前 CPU 环境中的 CLI 格式热请求为约 7–11 秒，明显超过 800 ms 单次截止；默认配置按修复后的语义失败闭合。中文完整请求会被上游自动路由到英文 checkpoint，不能按多语言模型效果解释。仅中文任务文本虽然触发多语言权重且热请求较快，但单题输出与预期不符，不能据此推断总体质量。

继续推进前应先固定服务端 checkpoint 身份，并解决“任务语言被英文候选元数据覆盖”的路由问题；随后在冻结的中文、英文、无匹配和多正确答案数据集上分别评估质量、延迟、截断及用量。单题结果不能替代模块 114 的统计和端到端放量门。

复跑方式：先按[用户指南](../../../docs-site/docs/chainlesschain/jev-decision-layer.md)启动真实 Laya 后端，再在 `packages/cli` 执行 `node scripts/laya-live-probe.mjs en provider`、`node scripts/laya-live-probe.mjs zh provider` 或 `node scripts/laya-live-probe.mjs en runtime 800`。首次下载时，provider 探针允许最长 600 秒；runtime 探针的截止范围与 CLI 一致，为 50–30000 ms。探针使用固定的合成任务，不执行 Skill，也不保存生产会话。
