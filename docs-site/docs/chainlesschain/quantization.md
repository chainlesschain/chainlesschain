# 模型量化系统

> **版本: v1.0.0+ | GGUF 14级量化 | AutoGPTQ | Ollama 集成**

模型量化系统支持将大语言模型量化为更小、更快的格式，以便在本地设备上高效运行。

## 核心特性

- 🔧 **GGUF 14级量化**: 从 Q2_K 到 F16，覆盖全精度范围，灵活适配不同硬件
- ⚡ **AutoGPTQ 加速**: 基于校准数据集的 4-bit/8-bit GPU 量化，推理性能优异
- 📊 **任务队列管理**: SQLite 持久化的量化任务调度，支持进度追踪与取消
- 🔗 **Ollama 一键集成**: 量化完成后自动生成 Modelfile 并导入 Ollama
- 💾 **智能内存适配**: 根据设备内存自动推荐最佳量化级别

## 系统架构

```
┌─────────────────────────────────────────────┐
│            QuantizationManager              │
│         (任务调度 / 进度追踪 / DB)           │
└──────────┬──────────────┬───────────────────┘
           │              │
           ▼              ▼
┌──────────────┐  ┌───────────────┐
│ GGUFQuantizer│  │ GPTQQuantizer │
│ (llama.cpp)  │  │ (AutoGPTQ)    │
│ 14级精度     │  │ 4-bit/8-bit   │
└──────┬───────┘  └───────┬───────┘
       │                  │
       ▼                  ▼
┌──────────────────────────────────┐
│     Ollama 模型导入 / 本地推理    │
└──────────────────────────────────┘
```

## 系统概述

### 量化格式

```
模型量化系统
├─ GGUF 量化 (llama.cpp)
│   ├─ 14 级量化精度 (Q2_K ~ F16)
│   ├─ CPU/GPU 混合推理
│   ├─ 适合消费级硬件
│   └─ 通过 Ollama 导入使用
└─ GPTQ 量化 (AutoGPTQ)
    ├─ 4-bit/8-bit 量化
    ├─ GPU 加速推理
    ├─ 需要校准数据集
    └─ 适合 NVIDIA GPU 用户
```

### 核心特性

- **GGUF 14级量化**: 从 Q2_K（最小）到 F16（最高精度），灵活选择
- **AutoGPTQ 量化**: 基于校准数据的 4-bit/8-bit 量化
- **任务管理**: 基于 SQLite 的量化任务队列
- **进度追踪**: 实时量化进度和状态通知
- **Ollama 集成**: 量化完成后自动导入到 Ollama
- **任务取消**: 支持取消进行中的量化任务

---

## GGUF 量化

### 量化级别

| 量化级别 | 大小比例 | 精度损失 | 推荐场景           |
| -------- | -------- | -------- | ------------------ |
| Q2_K     | ~25%     | 较高     | 极限压缩，快速预览 |
| Q3_K_S   | ~30%     | 中高     | 资源极度受限       |
| Q3_K_M   | ~33%     | 中等     | 低端设备           |
| Q3_K_L   | ~35%     | 中等     | 低端设备（稍优）   |
| Q4_0     | ~37%     | 中等     | 通用量化           |
| Q4_K_S   | ~39%     | 中低     | 推荐：性价比最优   |
| Q4_K_M   | ~41%     | 中低     | 推荐：质量优先     |
| Q5_0     | ~45%     | 低       | 高质量             |
| Q5_K_S   | ~47%     | 低       | 高质量             |
| Q5_K_M   | ~49%     | 很低     | 接近原始精度       |
| Q6_K     | ~55%     | 极低     | 几乎无损           |
| Q8_0     | ~65%     | 微小     | 近无损量化         |
| F16      | ~100%    | 无       | 半精度（原始）     |

### 使用建议

```
内存 ≤ 8GB  → Q3_K_M 或 Q4_0
内存 8-16GB → Q4_K_M（推荐）
内存 16-32GB → Q5_K_M 或 Q6_K
内存 ≥ 32GB → Q8_0 或 F16
```

---

## GPTQ 量化

### AutoGPTQ 流程

```
1. 加载原始模型
2. 准备校准数据集（128-256 条样本）
3. 分层量化（逐层计算最优量化参数）
4. 评估量化质量（困惑度对比）
5. 保存量化模型
```

### 配置

```json
{
  "gptq": {
    "bits": 4,
    "groupSize": 128,
    "descAct": true,
    "calibrationSamples": 128,
    "batchSize": 1
  }
}
```

---

## 任务管理

### 任务状态

```
pending → running → completed
                  → failed
         → cancelled
```

### 数据库表: `quantization_jobs`

| 字段                 | 类型     | 说明         |
| -------------------- | -------- | ------------ |
| `id`                 | TEXT     | 任务 ID      |
| `model_path`         | TEXT     | 原始模型路径 |
| `format`             | TEXT     | gguf / gptq  |
| `quantization_level` | TEXT     | 量化级别     |
| `status`             | TEXT     | 任务状态     |
| `progress`           | REAL     | 进度 (0-100) |
| `output_path`        | TEXT     | 输出文件路径 |
| `error`              | TEXT     | 错误信息     |
| `created_at`         | DATETIME | 创建时间     |
| `completed_at`       | DATETIME | 完成时间     |

---

## Ollama 集成

量化完成后自动导入到 Ollama：

```
量化完成 → 生成 Modelfile → ollama create → 模型可用
```

可直接在 AI 对话中使用量化后的模型。

---

## 关键文件

| 文件                                            | 职责            |
| ----------------------------------------------- | --------------- |
| `src/main/quantization/quantization-manager.js` | 量化任务管理器  |
| `src/main/quantization/gguf-quantizer.js`       | GGUF 量化执行器 |
| `src/main/quantization/gptq-quantizer.js`       | GPTQ 量化执行器 |

---

## 相关文档

- [AI 模型配置](/chainlesschain/ai-models) - 本地模型管理与配置
- [Context Engineering](/chainlesschain/context-engineering) - KV-Cache 与推理优化
- [自进化 AI](/chainlesschain/self-evolving-ai) - AI 模型自动架构搜索与升级
