# 意图识别 + PPT生成 解决方案

## 📋 问题概述

1. **意图识别太差**：基于正则表达式的关键词匹配不准确（如"写一个新年致辞"被识别为web项目）
2. **PPT只返回文字**：系统有PPT生成引擎，但AI没有调用，只返回文本内容

## ✅ 已完成的改进

### 1. 创建了智能意图识别器 (`intent-recognizer.js`)

**位置**：`desktop-app-vue/src/main/ai-engine/intent-recognizer.js`

**功能**：
- 使用 LLM 进行准确的意图分类
- 支持 5 种项目类型：document、web、app、data、code
- 识别子类型（如 PPT、Word、网站等）
- 输出结构化结果（JSON格式）
- 包含置信度、推理原因、建议名称等
- 智能降级：LLM失败时使用规则匹配

**关键特性**：
```javascript
{
  "projectType": "document",
  "confidence": 0.95,
  "subType": "ppt",
  "reasoning": "用户明确要求制作PPT演示文稿",
  "suggestedName": "新年致辞PPT",
  "detectedKeywords": ["写", "PPT"],
  "outputFormat": "pptx"
}
```

## 🔧 需要集成的步骤

### 步骤1：注册IPC接口

需要在 `ai-engine-ipc.js` 中添加两个handler：

```javascript
// 在 registerHandlers() 方法中添加：

// 意图识别
ipcMain.handle('aiEngine:recognizeIntent', async (_event, userInput) => {
  try {
    const { recognizeProjectIntent } = require('./intent-recognizer');
    const { getLLMManager } = require('../llm/llm-manager');  // 需要获取LLM实例

    const llmManager = getLLMManager(); // 这个方法需要从主进程暴露
    const result = await recognizeProjectIntent(userInput, llmManager);

    return result;
  } catch (error) {
    console.error('[AI Engine IPC] 意图识别失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// PPT生成
ipcMain.handle('aiEngine:generatePPT', async (_event, options) => {
  try {
    const PPTEngine = require('../engines/ppt-engine');
    const pptEngine = new PPTEngine();

    const result = await pptEngine.generateFromOutline(options.outline, {
      theme: options.theme || 'business',
      author: options.author || '作者',
      outputPath: options.outputPath
    });

    return {
      success: true,
      ...result
    };
  } catch (error) {
    console.error('[AI Engine IPC] PPT生成失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});
```

### 步骤2：修改前端调用（ProjectsPage.vue）

替换第767-847行的简单规则匹配：

```javascript
// 原来的代码（第841-847行）
console.log('[ProjectsPage] 智能检测项目类型:');
console.log('  - 用户输入:', text);
console.log('  - 检测结果: projectType =', projectType);
...

// 替换为 LLM 意图识别
let intentResult = null;
try {
  console.log('[ProjectsPage] 🤖 调用LLM进行意图识别...');
  intentResult = await window.electronAPI.aiEngine.recognizeIntent(text);

  if (intentResult && intentResult.success) {
    projectType = intentResult.projectType;
    documentFormat = intentResult.outputFormat || 'txt';

    console.log('[ProjectsPage] ✅ LLM意图识别成功:');
    console.log('  - 项目类型:', projectType);
    console.log('  - 子类型:', intentResult.subType);
    console.log('  - 置信度:', intentResult.confidence);
    console.log('  - 输出格式:', documentFormat);
    console.log('  - 分析理由:', intentResult.reasoning);
  }
} catch (error) {
  console.error('[ProjectsPage] ❌ 意图识别出错:', error);
  // 使用fallback规则识别
}
```

### 步骤3：PPT生成集成

在 `response-parser.js` 或 `conversation-executor.js` 中检测PPT生成意图：

```javascript
// 检测是否需要生成PPT
if (intentResult.subType === 'ppt' && intentResult.outputFormat === 'pptx') {
  // 调用PPT生成
  const pptResult = await window.electronAPI.aiEngine.generatePPT({
    outline: {
      title: intentResult.suggestedName,
      subtitle: '由AI生成',
      sections: extractedSections // 从AI响应中提取大纲
    },
    theme: 'business',
    author: authStore.currentUser?.name || '用户',
    outputPath: projectPath
  });
}
```

### 步骤4：暴露electronAPI

在 `preload.js` 中添加：

```javascript
aiEngine: {
  recognizeIntent: (userInput) => ipcRenderer.invoke('aiEngine:recognizeIntent', userInput),
  generatePPT: (options) => ipcRenderer.invoke('aiEngine:generatePPT', options)
}
```

## 🎯 优势对比

### 旧方案（正则匹配）
```javascript
// ❌ 不准确
"写一个新年致辞" → 被识别为 web 项目（因为包含"一个"）
"做个PPT" → 可能被识别为 web（因为包含"做个"）
```

### 新方案（LLM识别）
```javascript
// ✅ 准确识别
"写一个新年致辞" → document, subType: txt, outputFormat: txt
"做个新年致辞PPT" → document, subType: ppt, outputFormat: pptx
"创建一个电商网站" → web, subType: website, outputFormat: html
```

## 📊 测试示例

```javascript
// 测试意图识别
const testCases = [
  "写一个新年致辞",          // → document/txt
  "做一个产品介绍PPT",       // → document/ppt
  "创建个人博客网站",        // → web/website
  "开发一个记账小程序",      // → app/mobile-app
  "分析销售数据",            // → data/analysis
];

for (const input of testCases) {
  const result = await recognizeProjectIntent(input, llmManager);
  console.log(input, '→', result.projectType, '/', result.subType);
}
```

## 🚀 下一步

1. **集成步骤1-4** 到现有代码
2. **测试验证** LLM意图识别准确性
3. **优化PPT生成** 提示词，让AI输出结构化大纲
4. **添加流式thinking展示**（可选，需要更多时间）

## 📝 注意事项

- LLM调用会增加约0.5-1秒延迟，但准确率大幅提升
- 降级机制确保即使LLM失败也能正常工作
- PPT生成需要AI返回结构化数据（标题、章节、要点）
- 建议在系统提示词中明确告诉AI如何输出PPT结构

## 💡 建议

**立即实现**：LLM意图识别（准确率提升显著）
**逐步完善**：PPT自动生成（需要调整AI提示词）
**未来优化**：流式thinking展示（需要重构通信机制）
