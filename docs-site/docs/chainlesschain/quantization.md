# 模型量化系统

> **版本: v1.0.0+ | GGUF 14级量化 | AutoGPTQ | Ollama 集成**

## 概述

模型量化系统支持将大语言模型量化为更小、更快的格式，以便在本地设备上高效运行。系统提供 GGUF 14 级量化（Q2_K 到 F16）和 AutoGPTQ 4-bit/8-bit GPU 量化两种方案，内置 SQLite 任务队列管理和进度追踪，量化完成后可自动生成 Modelfile 并一键导入 Ollama。

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

## 使用示例

### GGUF 量化并导入 Ollama

```bash
# 在桌面应用中通过 IPC 发起量化任务
# 选择模型 → 选择量化级别 → 开始量化

# 量化完成后自动生成 Modelfile 并导入 Ollama
# 在 AI 对话中即可选择量化后的模型
```

```javascript
// 通过 IPC 创建量化任务
const job = await window.electronAPI.invoke('quantization:create-job', {
  modelPath: '/path/to/original-model',
  format: 'gguf',
  level: 'Q4_K_M'  // 推荐：质量与大小的最佳平衡
});

// 查询量化进度
const status = await window.electronAPI.invoke('quantization:get-status', {
  jobId: job.id
});
// { status: 'running', progress: 65.2 }
```

### 根据设备内存选择量化级别

```bash
# 8GB 内存设备 → 使用 Q3_K_M 或 Q4_0
# 16GB 内存设备 → 使用 Q4_K_M（推荐）
# 32GB+ 内存设备 → 使用 Q6_K 或 Q8_0
```

---

## 故障排查

### 量化任务失败

- **磁盘空间不足**: 量化过程需要约 2 倍原始模型大小的临时空间，确保有足够的磁盘空间
- **模型文件损坏**: 重新下载原始模型后再尝试量化
- **llama.cpp 不可用**: 确认 llama.cpp 的 `quantize` 工具已安装并在 PATH 中

### GPTQ 量化报错

- **GPU 内存不足**: GPTQ 量化需要 GPU，确保 NVIDIA 显卡内存 >= 8GB
- **校准数据集缺失**: 确认指定了有效的校准数据集路径（128-256 条样本）
- **CUDA 版本不匹配**: 检查 PyTorch 和 CUDA 版本兼容性

### 量化后模型质量下降明显

- 尝试使用更高的量化级别（如从 Q3_K_M 升级到 Q4_K_M）
- 对比量化前后的困惑度（perplexity），差异 >5% 建议换用更高精度

---

## 安全考虑

- **模型来源验证**: 仅从可信来源（Hugging Face、Ollama 官方库）下载原始模型，避免使用来路不明的模型文件
- **量化输出保护**: 量化后的模型文件存储在本地，不自动上传到任何外部服务
- **任务隔离**: 量化任务在独立子进程中运行，不影响主应用稳定性
- **资源限制**: 量化过程受系统资源限制保护，防止耗尽 CPU/内存导致系统不可用
- **完整性校验**: 量化完成后自动验证输出文件的完整性，确保模型可正常加载

---

## 相关文档

- [AI 模型配置](/chainlesschain/ai-models) - 本地模型管理与配置
- [Context Engineering](/chainlesschain/context-engineering) - KV-Cache 与推理优化
- [自进化 AI](/chainlesschain/self-evolving-ai) - AI 模型自动架构搜索与升级
