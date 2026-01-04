# 流式AI对话集成指南

本文档说明如何在前端组件中集成流式AI对话功能。

## 概述

流式AI对话功能已集成到两个核心模块：
1. **对话管理** (`conversation:chat-stream`) - 通用AI对话
2. **项目AI对话** (`project:aiChatStream`) - 项目上下文增强的AI对话

两者都支持：
- 实时流式输出
- 暂停/恢复/取消控制
- Token统计和性能指标
- 自动保存对话历史

## 一、对话管理流式API

### 1.1 基本用法

```typescript
// Vue 3 Composition API 示例
import { ref, onMounted, onUnmounted } from 'vue';

const conversationId = ref('conv_123');
const userMessage = ref('');
const aiResponse = ref('');
const isStreaming = ref(false);

// 发送流式对话
async function sendMessage() {
  if (!userMessage.value.trim()) return;

  isStreaming.value = true;
  aiResponse.value = '';

  try {
    const result = await window.electron.ipcRenderer.invoke('conversation:chat-stream', {
      conversationId: conversationId.value,
      userMessage: userMessage.value,
      conversationHistory: [], // 可选：对话历史
      options: {
        temperature: 0.7,
        maxTokens: 2000
      }
    });

    if (result.success) {
      console.log('流式对话已启动:', result.aiMessageId);
    } else {
      console.error('启动失败:', result.error);
    }
  } catch (error) {
    console.error('发送消息失败:', error);
  } finally {
    isStreaming.value = false;
  }
}
```

### 1.2 监听流式事件

```typescript
// 1. Chunk事件 - 实时接收AI响应片段
window.electron.ipcRenderer.on('conversation:stream-chunk', (event, data) => {
  console.log('收到chunk:', data);
  // data: { conversationId, messageId, chunk, fullContent }

  if (data.conversationId === conversationId.value) {
    aiResponse.value = data.fullContent;
  }
});

// 2. Complete事件 - 流式输出完成
window.electron.ipcRenderer.on('conversation:stream-complete', (event, data) => {
  console.log('流式输出完成:', data);
  // data: { conversationId, messageId, fullContent, tokens, stats }

  if (data.conversationId === conversationId.value) {
    isStreaming.value = false;
    console.log('总Token数:', data.tokens);
    console.log('性能统计:', data.stats);
  }
});

// 3. Error事件 - 处理错误
window.electron.ipcRenderer.on('conversation:stream-error', (event, data) => {
  console.error('流式输出错误:', data);
  // data: { conversationId, messageId, error }

  if (data.conversationId === conversationId.value) {
    isStreaming.value = false;
    alert('AI对话出错: ' + data.error);
  }
});
```

### 1.3 清理事件监听器

```typescript
onUnmounted(() => {
  // 组件卸载时移除事件监听器
  window.electron.ipcRenderer.removeAllListeners('conversation:stream-chunk');
  window.electron.ipcRenderer.removeAllListeners('conversation:stream-complete');
  window.electron.ipcRenderer.removeAllListeners('conversation:stream-error');
});
```

## 二、项目AI对话流式API

### 2.1 基本用法

```typescript
const projectId = ref('project_123');
const userMessage = ref('');
const aiResponse = ref('');
const isStreaming = ref(false);

async function sendProjectMessage() {
  if (!userMessage.value.trim()) return;

  isStreaming.value = true;
  aiResponse.value = '';

  try {
    const result = await window.electron.ipcRenderer.invoke('project:aiChatStream', {
      projectId: projectId.value,
      userMessage: userMessage.value,
      conversationHistory: [],
      contextMode: 'project', // 'project' | 'file' | 'selection'
      currentFile: null, // 可选：当前文件路径
      projectInfo: {
        name: '我的项目',
        description: '项目描述',
        type: 'code'
      },
      fileList: [], // 可选：相关文件列表
      options: {
        temperature: 0.7,
        maxTokens: 2000
      }
    });

    if (result.success) {
      console.log('项目AI对话已启动:', result.messageId);
    } else {
      console.error('启动失败:', result.error);
    }
  } catch (error) {
    console.error('发送消息失败:', error);
  } finally {
    isStreaming.value = false;
  }
}
```

### 2.2 监听项目AI流式事件

```typescript
// 1. Chunk事件
window.electron.ipcRenderer.on('project:aiChatStream-chunk', (event, data) => {
  console.log('收到项目AI chunk:', data);
  // data: { projectId, messageId, chunk, fullContent }

  if (data.projectId === projectId.value) {
    aiResponse.value = data.fullContent;
  }
});

// 2. Complete事件
window.electron.ipcRenderer.on('project:aiChatStream-complete', (event, data) => {
  console.log('项目AI流式输出完成:', data);
  // data: { projectId, messageId, fullContent, tokens, stats }

  if (data.projectId === projectId.value) {
    isStreaming.value = false;
    console.log('总Token数:', data.tokens);
    console.log('性能统计:', data.stats);
  }
});

// 3. Error事件
window.electron.ipcRenderer.on('project:aiChatStream-error', (event, data) => {
  console.error('项目AI流式输出错误:', data);
  // data: { projectId, messageId, error }

  if (data.projectId === projectId.value) {
    isStreaming.value = false;
    alert('项目AI对话出错: ' + data.error);
  }
});
```

## 三、流式控制功能

StreamController提供了额外的控制功能（暂停、恢复、取消）。

### 3.1 创建流式控制器

```typescript
// 创建控制器
const controllerId = ref(null);

async function createStreamController() {
  const result = await window.electron.ipcRenderer.invoke('llm:create-stream-controller', {
    enableBuffering: true
  });

  controllerId.value = result.controllerId;
  console.log('控制器已创建:', controllerId.value);
}
```

### 3.2 暂停/恢复流式输出

```typescript
// 暂停
async function pauseStream() {
  if (!controllerId.value) return;

  const result = await window.electron.ipcRenderer.invoke('llm:pause-stream', controllerId.value);
  console.log('已暂停:', result);
}

// 恢复
async function resumeStream() {
  if (!controllerId.value) return;

  const result = await window.electron.ipcRenderer.invoke('llm:resume-stream', controllerId.value);
  console.log('已恢复:', result);
}
```

### 3.3 取消流式输出

```typescript
async function cancelStream() {
  if (!controllerId.value) return;

  const result = await window.electron.ipcRenderer.invoke('llm:cancel-stream',
    controllerId.value,
    '用户取消'
  );
  console.log('已取消:', result);
}
```

### 3.4 获取统计信息

```typescript
async function getStreamStats() {
  if (!controllerId.value) return;

  const result = await window.electron.ipcRenderer.invoke('llm:get-stream-stats', controllerId.value);
  console.log('统计信息:', result);
  // result.stats: { status, totalChunks, processedChunks, duration, throughput, ... }
}
```

### 3.5 销毁控制器

```typescript
async function destroyController() {
  if (!controllerId.value) return;

  const result = await window.electron.ipcRenderer.invoke('llm:destroy-stream-controller', controllerId.value);
  console.log('控制器已销毁:', result);
  controllerId.value = null;
}
```

## 四、完整Vue组件示例

```vue
<template>
  <div class="streaming-chat">
    <div class="messages">
      <div v-for="msg in messages" :key="msg.id" :class="msg.role">
        {{ msg.content }}
      </div>

      <!-- 流式输出的AI响应 -->
      <div v-if="isStreaming" class="assistant streaming">
        {{ aiResponse }}
        <span class="cursor">▊</span>
      </div>
    </div>

    <div class="input-area">
      <input
        v-model="userMessage"
        @keyup.enter="sendMessage"
        :disabled="isStreaming"
        placeholder="输入消息..."
      />

      <button @click="sendMessage" :disabled="isStreaming">
        {{ isStreaming ? '发送中...' : '发送' }}
      </button>

      <!-- 控制按钮 -->
      <button v-if="isStreaming" @click="pauseStream">暂停</button>
      <button v-if="isStreaming" @click="resumeStream">恢复</button>
      <button v-if="isStreaming" @click="cancelStream">取消</button>
    </div>

    <!-- 统计信息 -->
    <div v-if="stats" class="stats">
      <p>Token数: {{ stats.tokens }}</p>
      <p>耗时: {{ stats.duration }}ms</p>
      <p>吞吐量: {{ stats.throughput }} chunks/秒</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const conversationId = ref('conv_' + Date.now());
const messages = ref([]);
const userMessage = ref('');
const aiResponse = ref('');
const isStreaming = ref(false);
const stats = ref(null);
const currentMessageId = ref(null);

// 发送消息
async function sendMessage() {
  if (!userMessage.value.trim() || isStreaming.value) return;

  // 添加用户消息到列表
  messages.value.push({
    id: 'msg_' + Date.now(),
    role: 'user',
    content: userMessage.value
  });

  const messageToSend = userMessage.value;
  userMessage.value = '';
  isStreaming.value = true;
  aiResponse.value = '';

  try {
    const result = await window.electron.ipcRenderer.invoke('conversation:chat-stream', {
      conversationId: conversationId.value,
      userMessage: messageToSend,
      conversationHistory: messages.value.slice(-10), // 最近10条消息作为上下文
      options: {
        temperature: 0.7,
        maxTokens: 2000
      }
    });

    if (result.success) {
      currentMessageId.value = result.aiMessageId;
    } else {
      alert('发送失败: ' + result.error);
      isStreaming.value = false;
    }
  } catch (error) {
    console.error('发送消息失败:', error);
    alert('发送失败: ' + error.message);
    isStreaming.value = false;
  }
}

// 暂停流式输出（需要集成StreamController）
async function pauseStream() {
  // TODO: 实现暂停逻辑
  console.log('暂停功能待实现');
}

// 恢复流式输出
async function resumeStream() {
  // TODO: 实现恢复逻辑
  console.log('恢复功能待实现');
}

// 取消流式输出
async function cancelStream() {
  // TODO: 实现取消逻辑
  isStreaming.value = false;
  aiResponse.value = '';
  console.log('取消功能待实现');
}

// 事件监听器
function setupEventListeners() {
  // Chunk事件
  window.electron.ipcRenderer.on('conversation:stream-chunk', (event, data) => {
    if (data.conversationId === conversationId.value) {
      aiResponse.value = data.fullContent;
    }
  });

  // Complete事件
  window.electron.ipcRenderer.on('conversation:stream-complete', (event, data) => {
    if (data.conversationId === conversationId.value) {
      // 添加AI响应到消息列表
      messages.value.push({
        id: data.messageId,
        role: 'assistant',
        content: data.fullContent
      });

      isStreaming.value = false;
      aiResponse.value = '';
      stats.value = {
        tokens: data.tokens,
        duration: data.stats.duration,
        throughput: data.stats.throughput.toFixed(2)
      };

      // 3秒后清除统计信息
      setTimeout(() => {
        stats.value = null;
      }, 3000);
    }
  });

  // Error事件
  window.electron.ipcRenderer.on('conversation:stream-error', (event, data) => {
    if (data.conversationId === conversationId.value) {
      alert('AI对话出错: ' + data.error);
      isStreaming.value = false;
      aiResponse.value = '';
    }
  });
}

// 清理事件监听器
function cleanupEventListeners() {
  window.electron.ipcRenderer.removeAllListeners('conversation:stream-chunk');
  window.electron.ipcRenderer.removeAllListeners('conversation:stream-complete');
  window.electron.ipcRenderer.removeAllListeners('conversation:stream-error');
}

onMounted(() => {
  setupEventListeners();
});

onUnmounted(() => {
  cleanupEventListeners();
});
</script>

<style scoped>
.streaming-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 20px;
}

.messages > div {
  margin: 10px 0;
  padding: 10px;
  border-radius: 8px;
}

.user {
  background: #e3f2fd;
  text-align: right;
}

.assistant {
  background: #f5f5f5;
}

.streaming .cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.input-area {
  display: flex;
  gap: 10px;
}

.input-area input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.input-area button {
  padding: 10px 20px;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.input-area button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.stats {
  margin-top: 10px;
  padding: 10px;
  background: #fff3cd;
  border-radius: 4px;
  font-size: 12px;
}

.stats p {
  margin: 2px 0;
}
</style>
```

## 五、性能优化建议

### 5.1 节流更新UI

对于高频率的chunk更新，可以使用节流来优化UI性能：

```typescript
import { throttle } from 'lodash-es';

const throttledUpdateResponse = throttle((content) => {
  aiResponse.value = content;
}, 100); // 每100ms最多更新一次

window.electron.ipcRenderer.on('conversation:stream-chunk', (event, data) => {
  if (data.conversationId === conversationId.value) {
    throttledUpdateResponse(data.fullContent);
  }
});
```

### 5.2 虚拟滚动

对于长对话历史，使用虚拟滚动组件（如`vue-virtual-scroller`）：

```vue
<RecycleScroller
  :items="messages"
  :item-size="80"
  key-field="id"
>
  <template v-slot="{ item }">
    <div :class="item.role">{{ item.content }}</div>
  </template>
</RecycleScroller>
```

### 5.3 限制对话历史长度

```typescript
// 只保留最近50条消息
if (messages.value.length > 50) {
  messages.value = messages.value.slice(-50);
}
```

## 六、错误处理

### 6.1 处理LLM不可用

```typescript
try {
  const result = await window.electron.ipcRenderer.invoke('conversation:chat-stream', chatData);
  if (!result.success) {
    if (result.error.includes('LLM管理器未初始化')) {
      showLLMConfigDialog();
    } else {
      alert('发送失败: ' + result.error);
    }
  }
} catch (error) {
  console.error('发送失败:', error);
  alert('发送失败: ' + error.message);
}
```

### 6.2 超时处理

```typescript
const STREAM_TIMEOUT = 120000; // 120秒超时

let timeoutId = null;

async function sendMessage() {
  // ... 发送逻辑

  // 设置超时
  timeoutId = setTimeout(() => {
    if (isStreaming.value) {
      console.error('流式输出超时');
      isStreaming.value = false;
      alert('AI响应超时，请重试');
    }
  }, STREAM_TIMEOUT);
}

// 在complete事件中清除超时
window.electron.ipcRenderer.on('conversation:stream-complete', (event, data) => {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  // ...
});
```

## 七、TypeScript类型定义

```typescript
// types/streaming-chat.ts

export interface StreamChunkData {
  conversationId: string;
  messageId: string;
  chunk: string;
  fullContent: string;
}

export interface StreamCompleteData {
  conversationId: string;
  messageId: string;
  fullContent: string;
  tokens: number;
  stats: {
    status: string;
    totalChunks: number;
    processedChunks: number;
    duration: number;
    throughput: number;
    averageChunkTime: number;
    startTime: number;
    endTime: number;
  };
}

export interface StreamErrorData {
  conversationId: string;
  messageId: string;
  error: string;
}

export interface ConversationChatStreamParams {
  conversationId: string;
  userMessage: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  options?: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: any;
  };
}

export interface ProjectAIChatStreamParams {
  projectId: string;
  userMessage: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  contextMode?: 'project' | 'file' | 'selection';
  currentFile?: string;
  projectInfo?: {
    name: string;
    description?: string;
    type?: string;
  };
  fileList?: string[];
  options?: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: any;
  };
}
```

## 八、总结

流式AI对话功能已完全集成到ChainlessChain桌面应用中。关键点：

1. **两个API**: `conversation:chat-stream` 和 `project:aiChatStream`
2. **三个事件**: `*-chunk`, `*-complete`, `*-error`
3. **流式控制**: 暂停、恢复、取消（通过StreamController）
4. **自动保存**: 对话历史自动保存到数据库
5. **性能监控**: 实时统计tokens、吞吐量等指标

使用这些API，可以构建强大的AI对话界面，支持实时流式输出和完整的用户控制。
