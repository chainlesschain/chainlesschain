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
