# AI 社交增强系统

> **版本: v3.3.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | 本地 LLM 翻译 + 内容质量评估**

ChainlessChain AI 社交增强系统利用本地 LLM 为社交功能提供智能增强，包括实时多语言翻译（50+ 种语言）、自动语言检测、AI 有害内容识别和去中心化共识审核。所有处理均在本地完成，保护用户隐私。

## 核心特性

- 🌍 **实时多语言翻译**: 本地 LLM 驱动，支持 50+ 种语言互译
- 🔍 **自动语言检测**: 智能识别消息语言，自动选择翻译方向
- 🛡️ **AI 内容质量评估**: 检测有害内容、垃圾信息和不当言论
- 🤝 **去中心化共识审核**: 多节点共识机制，分布式内容审核
- 📊 **翻译统计**: 翻译次数、语言分布、缓存命中率追踪

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

## 相关文档

- [去中心化社交 →](/chainlesschain/social)
- [协议融合 →](/chainlesschain/protocol-fusion)
- [Social AI 社交智能 →](/chainlesschain/social-ai)
