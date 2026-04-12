# AI 社交增强系统

> **版本: v3.3.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | 本地 LLM 翻译 + 内容质量评估**

ChainlessChain AI 社交增强系统利用本地 LLM 为社交功能提供智能增强，包括实时多语言翻译（50+ 种语言）、自动语言检测、AI 有害内容识别和去中心化共识审核。所有处理均在本地完成，保护用户隐私。

## 概述

AI 社交增强系统通过本地 LLM 为 ChainlessChain 的社交功能提供智能化增强。核心能力包括 50+ 语言的实时互译、自动语言检测、AI 驱动的有害内容识别和去中心化多节点共识审核，所有处理均在本地完成以保护用户隐私。

## 核心特性

- 🌍 **实时多语言翻译**: 本地 LLM 驱动，支持 50+ 种语言互译
- 🔍 **自动语言检测**: 智能识别消息语言，自动选择翻译方向
- 🛡️ **AI 内容质量评估**: 检测有害内容、垃圾信息和不当言论
- 🤝 **去中心化共识审核**: 多节点共识机制，分布式内容审核
- 📊 **翻译统计**: 翻译次数、语言分布、缓存命中率追踪

## 系统架构

```
┌──────────────────────────────────────────────┐
│          AI 社交增强系统                       │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ 翻译请求 │ │ 语言检测 │ │ 质量评估     │ │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│       │            │              │          │
│       ▼            ▼              ▼          │
│  ┌──────────────────────────────────────┐    │
│  │    AI Social IPC (5 处理器)           │    │
│  └──────────────────┬───────────────────┘    │
│         ┌───────────┼───────────┐            │
│         ▼           ▼           ▼            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │Realtime  │ │Language  │ │Content   │     │
│  │Translator│ │Detector  │ │Quality   │     │
│  │(本地LLM) │ │          │ │Assessor  │     │
│  └────┬─────┘ └──────────┘ └────┬─────┘     │
│       │                         │            │
│       ▼                         ▼            │
│  ┌──────────────────────────────────────┐    │
│  │  translation_cache /                 │    │
│  │  content_quality_scores (SQLite)    │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 翻译消息

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "ai-social:translate-message",
  {
    text: "Hello, how are you?",
    targetLanguage: "zh",
    sourceLanguage: "en", // 可选，不提供则自动检测
  },
);
// result = {
//   success: true,
//   translated: "你好，你好吗？",
//   sourceLanguage: "en",
//   targetLanguage: "zh",
//   cached: false,
// }
```

## 检测语言

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "ai-social:detect-language",
  {
    text: "こんにちは世界",
  },
);
// result = { success: true, language: "ja", confidence: 0.95 }
```

## 评估内容质量

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "ai-social:assess-quality",
  {
    content: "这是一段待评估的社交内容...",
    contentType: "post", // post | comment | message
  },
);
// result = {
//   success: true,
//   score: 0.85,
//   categories: {
//     spam: 0.05,
//     harmful: 0.02,
//     quality: 0.85,
//   },
//   recommendation: "approve",   // approve | review | reject
// }
```

## IPC 接口完整列表

### AI 社交增强操作（5 个）

| 通道                              | 功能         | 说明                       |
| --------------------------------- | ------------ | -------------------------- |
| `ai-social:translate-message`     | 翻译消息     | 本地 LLM 翻译，支持缓存    |
| `ai-social:detect-language`       | 检测语言     | 自动识别文本语言           |
| `ai-social:assess-quality`        | 评估内容质量 | AI 检测有害/垃圾/不当内容  |
| `ai-social:get-quality-report`    | 获取质量报告 | 内容审核统计和趋势         |
| `ai-social:get-translation-stats` | 获取翻译统计 | 翻译次数、语言分布、缓存率 |

## 数据库 Schema

**2 张核心表**:

| 表名                     | 用途         | 关键字段                                         |
| ------------------------ | ------------ | ------------------------------------------------ |
| `translation_cache`      | 翻译缓存     | id, source_text_hash, translated_text, languages |
| `content_quality_scores` | 质量评估记录 | id, content_hash, score, categories (JSON)       |

## 前端集成

### AISocialEnhancementPage 页面

**功能模块**:

- **翻译面板**: 输入文本，选择目标语言，实时翻译
- **语言检测**: 自动识别输入文本的语言
- **质量评估**: 提交内容进行 AI 质量评估
- **统计仪表板**: 翻译次数、语言分布图表

### Pinia Store (aiSocialEnhancement.ts)

```typescript
const useAiSocialEnhancementStore = defineStore("aiSocialEnhancement", {
  state: () => ({
    translationStats: null,
    qualityReport: null,
    loading: false,
    error: null,
  }),
  actions: {
    translateMessage, // → ai-social:translate-message
    detectLanguage, // → ai-social:detect-language
    assessQuality, // → ai-social:assess-quality
    fetchQualityReport, // → ai-social:get-quality-report
    fetchTranslationStats, // → ai-social:get-translation-stats
  },
});
```

## 关键文件

| 文件                                                    | 职责               | 行数 |
| ------------------------------------------------------- | ------------------ | ---- |
| `src/main/social/realtime-translator.js`                | 实时翻译引擎       | ~200 |
| `src/main/social/content-quality-assessor.js`           | 内容质量评估器     | ~180 |
| `src/main/social/ai-social-ipc.js`                      | IPC 处理器（5 个） | ~130 |
| `src/renderer/stores/aiSocialEnhancement.ts`            | Pinia 状态管理     | ~100 |
| `src/renderer/pages/social/AISocialEnhancementPage.vue` | AI 社交增强页面    | ~100 |

## 测试覆盖率

```
✅ realtime-translator.test.js               - 翻译/检测/缓存测试
✅ content-quality-assessor.test.js           - 质量评分/分类/推荐测试
✅ stores/aiSocialEnhancement.test.ts         - Store 状态管理测试
✅ e2e/social/ai-social-enhancement.e2e.test.ts - 端到端用户流程测试
```

## 使用示例

### 实时翻译社交消息

1. 打开「AI 社交增强」页面，进入翻译面板
2. 输入或粘贴待翻译文本
3. 选择目标语言（支持 50+ 种语言）
4. 点击「翻译」，系统自动检测源语言并翻译
5. 翻译结果自动缓存，相同内容再次翻译直接命中缓存

### 内容质量评估

1. 切换到「质量评估」标签页
2. 粘贴待评估的社交内容
3. 选择内容类型（帖子/评论/消息）
4. 查看 AI 评分结果：质量分数、垃圾信息概率、有害内容概率
5. 系统给出处理建议：approve（通过）/ review（需人工审核）/ reject（拒绝）

### 查看翻译统计

1. 进入「统计仪表板」
2. 查看翻译次数、语言分布图表、缓存命中率
3. 分析高频翻译语言对，优化翻译策略

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 翻译结果为空 | 本地 LLM 服务未启动 | 确认 Ollama 服务运行中，执行 `chainlesschain llm test` |
| 语言检测不准确 | 文本过短或混合语言 | 提供更长的文本片段，避免多语言混合输入 |
| 质量评估返回错误 | 内容为空或格式异常 | 检查输入内容是否为有效文本，长度不少于 10 字符 |
| 翻译延迟较高 | LLM 模型较大或 GPU 资源不足 | 切换到更小的模型，或启用 GPU 加速 |
| 缓存命中率低 | 缓存表数据量过大或过期 | 检查 `translation_cache` 表，清理过期记录 |
| 统计数据加载失败 | 数据库连接异常 | 重启应用，检查 SQLite 数据库文件完整性 |

## 安全考虑

- **本地处理**: 所有翻译和内容评估均在本地 LLM 完成，文本内容不上传到外部服务器
- **缓存安全**: 翻译缓存存储在加密数据库中，使用文本哈希作为索引避免明文泄露
- **内容审核隐私**: 质量评估结果仅存储评分和分类信息，不记录原始内容
- **去中心化共识**: 多节点审核机制防止单一节点操控审核结果
- **输入验证**: 所有 IPC 输入参数经过严格校验，防止注入攻击
- **速率限制**: 翻译和评估接口设有调用频率限制，防止资源滥用
- **数据最小化**: 缓存记录定期清理，不长期保存用户内容

## 相关文档

- [去中心化社交 →](/chainlesschain/social)
- [协议融合 →](/chainlesschain/protocol-fusion)
- [Social AI 社交智能 →](/chainlesschain/social-ai)
