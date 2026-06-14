# PPT生成问题修复 + 流式对话实现建议

## 📋 问题分析

用户反馈的两个问题：
1. **思考太久没有流式输出** - AI响应时间长但看不到进度
2. **PPT只返回文字** - 虽然后端实现了PPT生成，但AI没有按照格式输出大纲

## ✅ 已修复的问题

### 问题1：PPT警告提示阻止了生成

**原始代码** (`ChatPanel.vue` 第353-357行)：
```javascript
if (isPPTRequest) {
  antMessage.warning({
    content: '💡 提示：当前聊天面板不支持创建PPT文件。建议：\n1. 返回主页，在AI对话框中输入您的需求\n2. 或创建Markdown/Word文档替代',
    duration: 5,
  });
}
```

**修复**：已删除此警告提示（第342-343行）
```javascript
// 🔥 删除旧的警告提示，现在已支持PPT生成
console.log('[ChatPanel] 准备调用AI对话（支持PPT生成）');
```

### 问题2：PPT生成结果没有显示

**修复** (`ChatPanel.vue` 第434-456行)：
```javascript
// 🔥 检查PPT生成结果
if (response.pptGenerated && response.pptResult) {
  console.log('[ChatPanel] ✅ PPT已生成:', response.pptResult);
  antMessage.success({
    content: `🎉 PPT文件已生成！\n文件名: ${response.pptResult.fileName}\n幻灯片数: ${response.pptResult.slideCount}`,
    duration: 5,
  });
}

// 创建助手消息
const assistantMessage = {
  // ...
  // 🔥 添加PPT生成结果
  pptGenerated: response.pptGenerated || false,
  pptResult: response.pptResult || null
};
```

### 问题3：系统提示词不够明确

**原始提示词**：简短的指令，AI可能忽略

**增强后的提示词** (`project-ai-ipc.js` 第230-328行)：

关键改进：
1. **明确优先级**：`## 🎯 重要：PPT生成特殊指令（最高优先级）`
2. **详细检测规则**：列出所有PPT相关关键词
3. **严格输出格式**：两步法 + 必须使用标记
4. **完整示例**：提供"新年致辞PPT"的完整示例输出
5. **强制要求**：使用"必须"、"严格遵守"等强制性词汇

```javascript
## 🎯 重要：PPT生成特殊指令（最高优先级）

**检测规则**：如果用户消息包含以下任一关键词，必须生成PPT大纲：
- "PPT" / "ppt"
- "幻灯片"
- "演示文稿" / "演示"
- "presentation"

**必须输出格式**（严格遵守）：

第一步：立即输出JSON大纲（必须使用标记包裹）

**[PPT_OUTLINE_START]**
```json
{
  "title": "PPT标题（必填，20字以内）",
  "subtitle": "副标题（可选）",
  "sections": [...]
}
```
**[PPT_OUTLINE_END]**

第二步：在大纲下方提供文字说明（可选）

**示例**：
用户："做一个新年致辞PPT"

你的回答必须是：

**[PPT_OUTLINE_START]**
```json
{
  "title": "2026新年致辞",
  "subtitle": "迎接新征程",
  "sections": [
    {
      "title": "回顾2025",
      "subsections": [
        {
          "title": "年度成就",
          "points": ["业绩突破历史新高", "团队规模扩大50%", "产品获行业大奖"]
        }
      ]
    },
    // ...更多章节
  ]
}
```
**[PPT_OUTLINE_END]**

我已为您生成了新年致辞PPT大纲...
```

## 🔄 测试验证

### 测试步骤

1. **启动应用**
```bash
cd desktop-app-vue
npm run dev
```

2. **创建项目并打开AI对话**
   - 创建一个新项目或打开现有项目
   - 进入项目详情页面
   - 打开AI对话面板

3. **测试PPT生成**
```
输入: "写一个新年致辞ppt"
```

4. **观察控制台输出**
```javascript
[ChatPanel] 准备调用AI对话（支持PPT生成）
[Main] 项目AI对话: {...}
[IntentRecognizer] 开始LLM意图识别...  // 如果使用意图识别
[Main] 🎨 检测到PPT生成请求，开始生成PPT文件...
[PPT Generator] 开始生成PPT: 2026新年致辞
[PPT Generator] PPT生成成功: 2026新年致辞.pptx
[Main] ✅ PPT文件已生成: 2026新年致辞.pptx
[ChatPanel] ✅ PPT已生成: {fileName: '2026新年致辞.pptx', slideCount: 8}
```

5. **验证结果**
   - 应看到绿色成功提示：`🎉 PPT文件已生成！`
   - 项目目录中应有 `.pptx` 文件
   - 文件可用PowerPoint正常打开

### 预期结果

#### AI响应应包含：

1. **结构化大纲**（在标记之间）
```
**[PPT_OUTLINE_START]**
```json
{
  "title": "2026新年致辞",
  "sections": [...]
}
```
**[PPT_OUTLINE_END]**
```

2. **文字说明**
```
我已为您生成了新年致辞PPT大纲，包含3个章节...
```

3. **成功提示**（前端）
```
🎉 PPT文件已生成！
文件名: 2026新年致辞.pptx
幻灯片数: 8
```

## ⚠️ 已知限制

### 1. PPT生成依赖AI配合

虽然增强了提示词，但仍可能出现：
- AI忽略指令，只返回文字
- AI格式不对，无法提取大纲
- AI使用错误的标记

**解决方案**：
- 继续优化提示词措辞
- 添加多次重试机制
- 使用Few-shot learning增强示例

### 2. 流式对话未实现

**问题**：用户需要等待AI完整响应才能看到结果，体验不佳。

**当前状态**：
- 后端已有 `llmManager.chatStream()` 实现
- 前端 ChatPanel 使用非流式 API
- 需要改造为流式通信

## 🚀 流式对话实现建议（待实现）

### 方案概述

将现有的非流式 `project:aiChat` 改为流式 `project:aiChatStream`。

### 后端改造 (`project-ai-ipc.js`)

#### 1. 注册流式handler

```javascript
ipcMain.handle('project:aiChatStream', async (event, chatData) => {
  const webContents = event.sender;

  // 创建唯一的消息ID
  const messageId = `msg_${Date.now()}`;
  let fullResponse = '';

  // 定义chunk回调
  const onChunk = async (chunk) => {
    const chunkContent = chunk.content || chunk.text || chunk.delta?.content || '';

    if (chunkContent) {
      fullResponse += chunkContent;

      // 发送chunk给前端
      webContents.send('project:stream-chunk', {
        projectId: chatData.projectId,
        messageId: messageId,
        content: chunkContent,
        fullText: fullResponse
      });
    }

    return true; // 继续接收
  };

  // 使用流式调用
  const llmResult = await llmManager.chatStream(messages, onChunk, chatOptions);

  // 提取PPT大纲
  const pptOutline = extractPPTOutline(fullResponse);
  if (pptOutline) {
    const pptResult = await generatePPTFile(pptOutline, projectPath, project);

    // 发送PPT生成完成事件
    webContents.send('project:ppt-generated', {
      projectId: chatData.projectId,
      messageId: messageId,
      pptResult: pptResult
    });
  }

  // 发送完成事件
  webContents.send('project:stream-done', {
    projectId: chatData.projectId,
    messageId: messageId,
    fullText: fullResponse
  });

  return { success: true, messageId: messageId };
});
```

### 前端改造 (`ChatPanel.vue`)

#### 2. 添加流式事件监听

```javascript
import { onMounted, onBeforeUnmount } from 'vue';

// 流式响应状态
const isStreaming = ref(false);
const streamingMessageId = ref('');
const streamingText = ref('');

// 监听流式chunk
const handleStreamChunk = (event, data) => {
  if (data.projectId === props.projectId) {
    streamingText.value = data.fullText;

    // 更新最后一条消息
    const lastMessage = messages.value[messages.value.length - 1];
    if (lastMessage && lastMessage.id === data.messageId) {
      lastMessage.content = data.fullText;
    }

    scrollToBottom();
  }
};

// 监听PPT生成完成
const handlePPTGenerated = (event, data) => {
  if (data.projectId === props.projectId) {
    console.log('[ChatPanel] ✅ PPT已生成:', data.pptResult);
    antMessage.success({
      content: `🎉 PPT文件已生成！\n文件名: ${data.pptResult.fileName}\n幻灯片数: ${data.pptResult.slideCount}`,
      duration: 5,
    });
  }
};

// 监听流式完成
const handleStreamDone = (event, data) => {
  if (data.projectId === props.projectId) {
    isStreaming.value = false;
    streamingText.value = '';
  }
};

onMounted(() => {
  window.electronAPI.on('project:stream-chunk', handleStreamChunk);
  window.electronAPI.on('project:ppt-generated', handlePPTGenerated);
  window.electronAPI.on('project:stream-done', handleStreamDone);
});

onBeforeUnmount(() => {
  window.electronAPI.removeListener('project:stream-chunk', handleStreamChunk);
  window.electronAPI.removeListener('project:ppt-generated', handlePPTGenerated);
  window.electronAPI.removeListener('project:stream-done', handleStreamDone);
});
```

#### 3. 修改sendMessage函数

```javascript
const sendMessage = async () => {
  // ...前面的代码保持不变

  try {
    isStreaming.value = true;
    streamingMessageId.value = `msg_${Date.now()}_assistant`;

    // 添加空的助手消息（用于流式填充）
    const assistantMessage = {
      id: streamingMessageId.value,
      conversation_id: currentConversation.value.id,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    messages.value.push(assistantMessage);

    // 调用流式API
    const response = await window.electronAPI.project.aiChatStream({
      projectId: props.projectId,
      userMessage: input,
      conversationHistory: conversationHistory,
      contextMode: contextMode.value,
      currentFile: cleanCurrentFile,
      projectInfo: projectInfo,
      fileList: fileList
    });

    // 流式调用会通过事件接收结果
    console.log('[ChatPanel] 流式对话已启动, messageId:', response.messageId);

  } catch (error) {
    console.error('[ChatPanel] 发送消息失败:', error);
    isStreaming.value = false;
  }
};
```

### 4. 注册IPC方法 (`preload.js`)

```javascript
project: {
  // ...existing methods
  aiChat: (data) => ipcRenderer.invoke('project:aiChat', data),
  aiChatStream: (data) => ipcRenderer.invoke('project:aiChatStream', data),
},

// 流式事件监听
on: (channel, callback) => {
  const validChannels = ['project:stream-chunk', 'project:ppt-generated', 'project:stream-done'];
  if (validChannels.includes(channel)) {
    ipcRenderer.on(channel, callback);
  }
},
removeListener: (channel, callback) => {
  ipcRenderer.removeListener(channel, callback);
}
```

## 📊 实现优先级

### 高优先级 ✅ (已完成)

1. ✅ 删除PPT警告提示
2. ✅ 添加PPT生成结果显示
3. ✅ 增强系统提示词

### 中优先级 (建议实现)

4. ⏳ **流式对话基础设施**
   - 注册 `project:aiChatStream` handler
   - 添加 chunk 事件发送
   - 前端监听流式事件

5. ⏳ **PPT生成优化**
   - 添加重试机制（如果AI第一次没有输出大纲）
   - 支持主题选择（让用户指定 business/creative/dark）
   - 添加生成进度提示

### 低优先级 (可选)

6. ⏳ **流式Thinking展示**
   - 解析AI的思考过程标记
   - 实时显示思考步骤
   - 需要特殊的提示词设计

7. ⏳ **停止生成功能**
   - 添加"停止"按钮
   - 实现流式中断
   - 保存部分结果

## 🔍 调试技巧

### 1. 检查AI响应格式

在 `project-ai-ipc.js` 第368行后添加：
```javascript
console.log('[Main] AI原始响应:', aiResponse);
console.log('[Main] 响应长度:', aiResponse.length);
console.log('[Main] 包含PPT标记:',
  aiResponse.includes('**[PPT_OUTLINE_START]**'),
  aiResponse.includes('**[PPT_OUTLINE_END]**')
);
```

### 2. 测试大纲提取

```javascript
const testResponse = `
我为您生成了PPT大纲：

**[PPT_OUTLINE_START]**
\`\`\`json
{
  "title": "测试PPT",
  "sections": [...]
}
\`\`\`
**[PPT_OUTLINE_END]**

这是说明文字...
`;

const outline = extractPPTOutline(testResponse);
console.log('提取结果:', outline);
```

### 3. 强制使用PPT格式

如果AI仍不配合，可以添加后处理：

```javascript
// 如果检测到PPT关键词但没有大纲，再次请求
if (isPPTRequest && !extractPPTOutline(aiResponse)) {
  console.warn('[Main] AI未按格式输出PPT大纲，尝试二次请求...');

  const retryPrompt = `请严格按照以下格式输出PPT大纲（必须包含标记）：

**[PPT_OUTLINE_START]**
\`\`\`json
{
  "title": "PPT标题",
  "sections": [...]
}
\`\`\`
**[PPT_OUTLINE_END]**

用户需求: ${userMessage}`;

  const retryResponse = await llmManager.chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: retryPrompt }
  ], chatOptions);

  const retryOutline = extractPPTOutline(retryResponse.content);
  if (retryOutline) {
    await generatePPTFile(retryOutline, projectPath, project);
  }
}
```

## 📚 相关文件

### 已修改文件

- `/desktop-app-vue/src/renderer/components/projects/ChatPanel.vue`
  - 第342-343行：删除PPT警告提示
  - 第434-456行：添加PPT生成结果显示

- `/desktop-app-vue/src/main/project/project-ai-ipc.js`
  - 第230-328行：增强系统提示词
  - 第14-102行：PPT提取和生成函数（之前已添加）
  - 第439-485行：PPT检测和生成逻辑（之前已添加）

### 参考文件

- `/desktop-app-vue/src/main/conversation/conversation-ipc.js` - 流式对话实现示例
- `/desktop-app-vue/src/main/llm/llm-manager.js` - chatStream方法
- `/desktop-app-vue/src/main/engines/ppt-engine.js` - PPT生成引擎

## ✅ 总结

### 已解决

1. ✅ **PPT警告提示已删除** - 用户现在可以在项目AI对话中请求PPT
2. ✅ **PPT生成结果已显示** - 生成成功会显示绿色提示框
3. ✅ **系统提示词已增强** - AI更可能按照格式输出PPT大纲

### 待实现

1. ⏳ **流式对话** - 需要后端和前端共同改造（已提供详细方案）
2. ⏳ **PPT重试机制** - 如果AI第一次不配合，自动重试

### 测试建议

请使用以下测试用例验证修复效果：

```
测试1: "写一个新年致辞ppt"
测试2: "做一个产品介绍PPT，包含公司介绍、产品特点、应用案例三部分"
测试3: "生成培训课件幻灯片，主题是《团队协作技巧》"
```

观察：
1. 是否还显示"当前聊天面板不支持创建PPT"警告？ → 应该没有
2. AI是否返回了带标记的JSON大纲？ → 查看控制台
3. 是否生成了实际的.pptx文件？ → 检查项目目录
4. 是否显示了成功提示？ → 应该看到绿色通知

---

**修复完成时间**: 2026-01-04
**负责人**: Claude Sonnet 4.5
**状态**: ✅ PPT生成问题已修复，流式对话方案已提供

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：PPT生成问题修复 + 流式对话实现建议。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
