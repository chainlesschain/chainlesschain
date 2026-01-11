# 语音输入功能使用指南

## 功能概述

ChainlessChain 桌面应用已集成完整的语音输入功能，支持在 AI 聊天界面中通过语音进行输入。该功能基于 Web Speech API 实现，提供实时语音识别和转录能力。

## 功能特性

### 1. 实时语音识别
- ✅ 支持中文（zh-CN）语音识别
- ✅ 实时显示识别结果
- ✅ 连续语音识别模式
- ✅ 音量可视化指示器

### 2. 录音控制
- ✅ 开始/停止录音
- ✅ 暂停/继续录音
- ✅ 取消录音
- ✅ 录音时长显示

### 3. 用户界面
- ✅ 录音状态模态框
- ✅ 波形动画效果
- ✅ 实时转录文本预览
- ✅ 音量指示器

## 使用方法

### 在 AI 聊天界面使用语音输入

1. **打开 AI 聊天页面**
   - 导航到 AI 聊天功能
   - 找到输入框区域

2. **点击语音输入按钮**
   - 在输入框工具栏中找到麦克风图标按钮
   - 点击按钮开始录音

3. **开始说话**
   - 录音模态框会弹出
   - 对着麦克风清晰地说话
   - 实时转录文本会显示在模态框中

4. **控制录音**
   - **暂停**: 点击"暂停"按钮临时停止录音
   - **继续**: 点击"继续"按钮恢复录音
   - **取消**: 点击"取消"按钮放弃本次录音
   - **完成**: 点击"完成"按钮结束录音并插入文本

5. **查看结果**
   - 识别的文本会自动插入到输入框中
   - 可以继续编辑或直接发送

## 技术架构

### 前端组件

#### EnhancedVoiceInput.vue
位置: `src/renderer/components/common/EnhancedVoiceInput.vue`

**功能**:
- 语音输入按钮组件
- 录音状态管理
- Web Speech API 集成
- 实时转录显示

**事件**:
- `@result`: 识别完成，返回最终文本
- `@error`: 识别错误
- `@partial`: 实时转录结果

**使用示例**:
```vue
<template>
  <EnhancedVoiceInput
    @result="handleVoiceResult"
    @error="handleVoiceError"
    @partial="handlePartialResult"
  />
</template>

<script setup>
import EnhancedVoiceInput from '@/components/common/EnhancedVoiceInput.vue';

const handleVoiceResult = (text) => {
  console.log('识别结果:', text);
  // 将文本插入到输入框
};

const handleVoiceError = (error) => {
  console.error('识别错误:', error);
};

const handlePartialResult = (text) => {
  console.log('实时结果:', text);
};
</script>
```

#### ConversationInput.vue
位置: `src/renderer/components/projects/ConversationInput.vue`

**集成方式**:
```vue
<!-- 语音输入按钮 -->
<div class="voice-input-wrapper">
  <VoiceInput
    @result="handleVoiceResult"
    @error="handleVoiceError"
  />
</div>
```

**处理函数**:
```javascript
// 处理语音输入结果
const handleVoiceResult = (text) => {
  if (text) {
    // 追加语音识别的文本到输入框
    inputText.value += (inputText.value ? ' ' : '') + text;
    autoResize();
    message.success('语音识别成功');
  }
};

// 处理语音输入错误
const handleVoiceError = (error) => {
  console.error('语音输入错误:', error);
};
```

### 后端支持

#### Speech IPC 处理器
位置: `src/main/speech/speech-ipc.js`

虽然当前前端使用 Web Speech API，但后端也提供了完整的语音处理能力：

**支持的功能**:
- 音频文件转录
- 批量转录
- 实时录音
- 音频增强
- 字幕生成
- 语音命令识别

**可用的 IPC 通道**:
```javascript
// 转录音频文件
window.electronAPI.invoke('speech:transcribe-file', filePath, options);

// 批量转录
window.electronAPI.invoke('speech:transcribe-batch', filePaths, options);

// 获取配置
window.electronAPI.invoke('speech:get-config');

// 更新配置
window.electronAPI.invoke('speech:update-config', config);
```

## 浏览器兼容性

### Web Speech API 支持

| 浏览器 | 支持情况 | 备注 |
|--------|---------|------|
| Chrome | ✅ 完全支持 | 推荐使用 |
| Edge | ✅ 完全支持 | 基于 Chromium |
| Safari | ⚠️ 部分支持 | 需要用户授权 |
| Firefox | ❌ 不支持 | 需要使用后端方案 |

### Electron 环境
- ✅ 完全支持（基于 Chromium）
- ✅ 自动请求麦克风权限
- ✅ 支持所有 Web Speech API 特性

## 常见问题

### 1. 无法使用语音输入

**可能原因**:
- 浏览器不支持 Web Speech API
- 麦克风权限未授予
- 麦克风设备未连接

**解决方法**:
1. 检查浏览器兼容性
2. 在浏览器设置中允许麦克风权限
3. 确保麦克风设备正常工作

### 2. 识别准确度低

**可能原因**:
- 环境噪音过大
- 说话不清晰
- 麦克风质量差

**解决方法**:
1. 在安静的环境中使用
2. 清晰地说话，语速适中
3. 使用质量较好的麦克风

### 3. 识别结果延迟

**可能原因**:
- 网络连接不稳定（Web Speech API 需要网络）
- 系统资源不足

**解决方法**:
1. 检查网络连接
2. 关闭其他占用资源的程序
3. 考虑使用本地语音识别引擎（后端方案）

## 未来增强计划

### 短期计划
- [ ] 支持更多语言（英语、日语等）
- [ ] 添加语音命令功能
- [ ] 优化识别准确度
- [ ] 添加语音设置面板

### 长期计划
- [ ] 集成本地 Whisper 模型
- [ ] 支持离线语音识别
- [ ] 添加语音情感分析
- [ ] 支持多人语音识别

## 高级功能（后端方案）

如果需要更强大的语音识别能力，可以使用后端的 Speech Manager：

### VoiceFeedbackWidget 组件
位置: `src/renderer/components/VoiceFeedbackWidget.vue`

**特性**:
- 支持多种识别引擎（Whisper API、Whisper Local、Web Speech API）
- 波形可视化
- 置信度显示
- 语言自动检测
- 命令提示
- 学习统计

**使用示例**:
```vue
<template>
  <VoiceFeedbackWidget
    :auto-start="false"
    :show-panel="true"
    :enable-command-hints="true"
    @result="handleResult"
    @error="handleError"
    @interim="handleInterim"
    @command="handleCommand"
  />
</template>
```

### 配置语音识别引擎

```javascript
// 获取当前配置
const config = await window.electronAPI.invoke('speech:get-config');

// 更新配置
await window.electronAPI.invoke('speech:update-config', {
  engine: 'whisper-local', // 或 'whisper-api', 'webspeech'
  language: 'zh-CN',
  model: 'base', // Whisper 模型大小
  // ... 其他配置
});
```

## 开发指南

### 添加新的语音功能

1. **在前端添加 UI 组件**
   ```vue
   <template>
     <a-button @click="startVoiceInput">
       <AudioOutlined />
       语音输入
     </a-button>
   </template>
   ```

2. **调用语音识别 API**
   ```javascript
   const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
   recognition.lang = 'zh-CN';
   recognition.continuous = true;
   recognition.interimResults = true;

   recognition.onresult = (event) => {
     // 处理识别结果
   };

   recognition.start();
   ```

3. **处理识别结果**
   ```javascript
   const handleRecognitionResult = (event) => {
     let finalTranscript = '';
     for (let i = event.resultIndex; i < event.results.length; i++) {
       if (event.results[i].isFinal) {
         finalTranscript += event.results[i][0].transcript;
       }
     }
     // 使用识别结果
   };
   ```

### 测试语音功能

1. **单元测试**
   ```javascript
   import { mount } from '@vue/test-utils';
   import EnhancedVoiceInput from '@/components/common/EnhancedVoiceInput.vue';

   describe('EnhancedVoiceInput', () => {
     it('should emit result event', async () => {
       const wrapper = mount(EnhancedVoiceInput);
       // 模拟语音识别
       // 验证事件触发
     });
   });
   ```

2. **集成测试**
   - 在实际环境中测试语音输入
   - 验证文本正确插入到输入框
   - 测试各种边界情况

## 参考资料

- [Web Speech API 文档](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Electron 麦克风权限](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesgetmediaaccessstatusmediatype-macos)
- [Whisper API 文档](https://platform.openai.com/docs/guides/speech-to-text)

## 联系支持

如有问题或建议，请通过以下方式联系：
- GitHub Issues: [chainlesschain/issues](https://github.com/chainlesschain/chainlesschain/issues)
- 邮箱: support@chainlesschain.com

---

**最后更新**: 2026-01-12
**版本**: v0.20.0
