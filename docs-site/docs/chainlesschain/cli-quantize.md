# 模型量化 CLI（Phase 20）

> `chainlesschain quantize` — 模型量化任务的创建、执行与管理。
>
> 支持 GGUF 14 级量化与 GPTQ 多位宽，完整的任务生命周期控制。

---

## 目录

- [概述](#概述)
- [目录/枚举](#目录枚举)
- [任务生命周期](#任务生命周期)
- [查询](#查询)
- [统计](#统计)

---

## 概述

量化模块管理将大语言模型从 FP16/FP32 压缩到更低精度的全流程。
支持 GGUF（llama.cpp 生态）和 GPTQ（GPU 推理）两大方案。

---

## 核心特性

- **GGUF 14 级量化** — Q2_K / Q3_K_S / Q3_K_M / Q3_K_L / Q4_0 / Q4_1 / Q4_K_S / Q4_K_M / Q5_0 / Q5_1 / Q5_K_S / Q5_K_M / Q6_K / Q8_0
- **GPTQ 多位宽** — 2 / 3 / 4 / 8 位宽，GPU 推理友好
- **任务生命周期** — pending → running → completed / failed / cancelled 五态
- **进度追踪** — `progress 0-100` 实时更新任务进度
- **产物路径记录** — complete 时登记 `--output-path`，便于后续加载
- **V2 治理层** — 86 V2 tests 覆盖 model maturity + job ticket lifecycle（`quantization_v2_phase20_cli.md`）

---

## 系统架构

```
┌────────────────────────────────────────────────────┐
│         chainlesschain quantize (Phase 20)          │
├────────────────────────────────────────────────────┤
│  Quantization Types                                 │
│  GGUF (14 levels)  │  GPTQ (2/3/4/8 bits)          │
├────────────────────────────────────────────────────┤
│  Job Lifecycle                                      │
│  pending → running → completed / failed / cancelled │
│  + progress (0-100)                                 │
├────────────────────────────────────────────────────┤
│  Catalog Helpers                                    │
│  statuses / types / levels / gptq-bits              │
├────────────────────────────────────────────────────┤
│  SQLite: quantization_jobs                          │
└────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项            | 含义                    | 默认        |
| ----------------- | ----------------------- | ----------- |
| `type`            | 量化方案                | gguf / gptq |
| `level`（GGUF）   | 14 种精度               | Q2_K ~ Q8_0 |
| `bits`（GPTQ）    | 位宽                    | 2 / 3 / 4 / 8 |
| 状态              | pending/running/completed/failed/cancelled | |
| V2 caps           | per-owner active model / running job | 见备忘录 |

查看：`chainlesschain quantize statuses`、`quantize types`、`quantize levels`、`quantize gptq-bits`。

---

## 性能指标

| 操作                           | 典型耗时         |
| ------------------------------ | ---------------- |
| create 任务                    | < 15 ms          |
| start / progress / complete    | < 10 ms          |
| list / show                    | < 10 ms          |
| stats 聚合                     | < 20 ms          |
| 实际量化耗时                   | 依赖模型大小（GGUF Q4_K_M 7B 约 5-15 分钟） |
| V2 createJobV2 dispatch        | < 50 ms          |

注：CLI 仅管理任务元数据与状态，真实量化计算由外部工具（llama.cpp / AutoGPTQ）完成，CLI 负责登记。

---

## 测试覆盖率

```
__tests__/unit/quantization.test.js — 86 tests (1022 lines)
```

覆盖：GGUF 14 级 + GPTQ 4 种位宽创建、状态机全路径（含非法转换拒绝）、
progress 边界（0/100/-1/101）、cancel vs delete 差异、list 过滤、stats 聚合。
V2 surface：86 V2 tests（见 `quantization_v2_phase20_cli.md`）。

---

## 安全考虑

1. **量化不损失模型 fingerprint** — 只改精度，不改权重结构；产物仍需 hash 校验
2. **cancel vs delete 语义** — `cancel` 仅改状态；`delete` 从 DB 彻底移除（只允许非 running 状态）
3. **output-path 不验证** — complete 时登记路径，不做 fs 校验；建议上层再校验产物存在
4. **V2 per-owner 活跃上限** — 防止单 owner 无限创建量化任务
5. **状态机防竞态** — running 中不能再次 start；completed 不能改为 running

---

## 故障排查

**Q: `progress` 报 not in running state?**

只有 running 状态才能更新进度；新建任务先 `start <id>`。

**Q: `complete` 报 output-path missing?**

`complete` 必须带 `--output-path`；用于下游加载量化模型。

**Q: `create` 报 invalid level?**

`quantize levels` 查看 GGUF 14 级枚举；GPTQ 需用 `--bits` 而非 `--level`。

**Q: V2 下任务自动 fail?**

V2 有 auto-fail-stuck 机制：long-running 状态超时的任务自动标记 failed；可通过 `gov-stats-v2` 查看。

---

## 关键文件

- `packages/cli/src/commands/quantization.js` — Commander 子命令（~631 行）
- `packages/cli/src/lib/quantization.js` — 任务生命周期管理
- `packages/cli/__tests__/unit/quantization.test.js` — 单测（86 tests）
- 数据表：`quantization_jobs`
- 设计文档：`docs/design/modules/20_模型量化系统.md`

---

## 使用示例

```bash
# 1. 创建 GGUF 量化任务
jid=$(chainlesschain quantize create --model qwen2-7b --type gguf --level Q4_K_M --json | jq -r .id)

# 2. 执行生命周期
chainlesschain quantize start $jid
chainlesschain quantize progress $jid 25
chainlesschain quantize progress $jid 75
chainlesschain quantize complete $jid --output-path ./models/qwen2-7b-Q4_K_M.gguf

# 3. GPTQ 4-bit
chainlesschain quantize create --model llama3-8b --type gptq --bits 4

# 4. 查询
chainlesschain quantize list --json
chainlesschain quantize show $jid

# 5. 统计
chainlesschain quantize stats
```

---

## 目录/枚举

```bash
chainlesschain quantize statuses     # 列出任务状态（pending/running/completed/failed/cancelled）
chainlesschain quantize types        # 列出量化类型（gguf / gptq）
chainlesschain quantize levels       # 列出 GGUF 14 级量化参数（Q2_K ~ Q8_0）
chainlesschain quantize gptq-bits    # 列出 GPTQ 位宽（2/3/4/8）
```

---

## 任务生命周期

```bash
# 创建量化任务
chainlesschain quantize create --model qwen2-7b --type gguf --level Q4_K_M
chainlesschain quantize create --model llama3-8b --type gptq --bits 4

# 启动待处理任务
chainlesschain quantize start <job-id>

# 更新进度（0~100）
chainlesschain quantize progress <job-id> 75

# 标记完成
chainlesschain quantize complete <job-id> --output-path ./models/qwen2-7b-Q4_K_M.gguf

# 标记失败
chainlesschain quantize fail <job-id> --reason "OOM"

# 取消任务（pending 或 running 状态）
chainlesschain quantize cancel <job-id>

# 删除任务（非 running 状态）
chainlesschain quantize delete <job-id>
```

---

## 查询

```bash
chainlesschain quantize show <job-id>    # 查看任务详情
chainlesschain quantize list             # 列出所有任务
chainlesschain quantize list --json      # JSON 格式
```

---

## 统计

```bash
chainlesschain quantize stats          # 各状态任务计数 + 成功率
chainlesschain quantize stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/20_模型量化系统.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [LLM Providers →](/chainlesschain/cli-llm)
- [Inference Network →](/chainlesschain/cli-inference)
- [Runtime →](/chainlesschain/cli-runtime)
