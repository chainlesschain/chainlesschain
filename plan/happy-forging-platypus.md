# 项目创建流式调用实现方案

## 需求概述

将项目创建功能从非流式调用改造为流式调用，实时展示AI生成过程和工具使用情况。

**用户需求**：
- ✅ 展示阶段步骤（意图识别、生成规格、HTML/CSS/JS等）
- ✅ 生成的代码实时预览
- ✅ 工具使用元数据（模型、tokens、模板等）
- ✅ 详细日志输出
- ✅ 支持取消操作
- ✅ UI风格参考：`参考资料/可看到当前执行的情况.png`
- ✅ 文件展示：Tab切换方式

## 技术方案

### 数据流架构

```
后端 FastAPI SSE
  → HTTP Client (axios stream)
  → IPC Handler (project:create-stream)
  → Preload API
  → Pinia Store (project.js)
  → Vue Component (NewProjectPage.vue)
  → StreamProgressModal 组件
```

### SSE消息格式（后端已实现）

```javascript
// 1. 进度消息
{type: "progress", stage: "intent|spec|html|css|js", message: "正在识别意图..."}

// 2. 内容消息（流式代码片段）
{type: "content", content: "<html>...", stage: "html", done: false}

// 3. 完成消息
{type: "complete", files: [...], metadata: {model, tokens, template, theme}}

// 4. 错误消息
{type: "error", error: "错误信息"}
```

## 实现步骤

### 第一阶段：后端通信层

#### 1. HTTP Client 新增流式方法

**文件**: `desktop-app-vue/src/main/project/http-client.js`

**新增方法**: `createProjectStream(createData, callbacks)`

```javascript
async createProjectStream(createData, { onProgress, onContent, onComplete, onError }) {
  const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

  const response = await this.client.post(
    `${AI_SERVICE_URL}/api/projects/create/stream`,
    createData,
    {
      responseType: 'stream',
      adapter: 'http',  // 使用Node.js http adapter
      timeout: 600000,  // 10分钟超时
    }
  );

  let buffer = '';
  const cleanup = () => {
    response.data.removeAllListeners();
  };

  response.data.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留不完整的行

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));

          switch (data.type) {
            case 'progress':
              onProgress?.(data);
              break;
            case 'content':
              onContent?.(data);
              break;
            case 'complete':
              onComplete?.(data);
              cleanup();
              break;
            case 'error':
              onError?.(new Error(data.error));
              cleanup();
              break;
          }
        } catch (err) {
          console.error('[StreamParse] Failed to parse SSE:', err);
        }
      }
    }
  });

  response.data.on('error', (err) => {
    onError?.(err);
    cleanup();
  });

  response.data.on('end', () => {
    cleanup();
  });

  return {
    cancel: () => {
      response.data.destroy();
      cleanup();
    }
  };
}
```

**要点**：
- 使用axios的`responseType: 'stream'`和`adapter: 'http'`
- 逐行解析SSE格式（`data: {...}\n`）
- 提供4个回调函数处理不同类型的消息
- 返回cancel方法支持取消操作

---

#### 2. IPC Handler 新增流式通道

**文件**: `desktop-app-vue/src/main/index.js`

**位置**: 约4363行，在现有`project:create` handler附近

**新增handler**: `project:create-stream`

```javascript
ipcMain.handle('project:create-stream', async (event, createData) => {
  const { getProjectHTTPClient } = require('./project/http-client');
  const httpClient = getProjectHTTPClient();

  // 流式状态
  let streamControl = null;
  let accumulatedData = {
    stages: [],
    contentByStage: {},
    files: [],
    metadata: {},
  };

  try {
    streamControl = await httpClient.createProjectStream(createData, {
      // 进度回调
      onProgress: (data) => {
        accumulatedData.stages.push({
          stage: data.stage,
          message: data.message,
          timestamp: Date.now(),
        });
        event.sender.send('project:stream-chunk', {
          type: 'progress',
          data,
        });
      },

      // 内容回调
      onContent: (data) => {
        if (!accumulatedData.contentByStage[data.stage]) {
          accumulatedData.contentByStage[data.stage] = '';
        }
        accumulatedData.contentByStage[data.stage] += data.content;

        event.sender.send('project:stream-chunk', {
          type: 'content',
          data,
        });
      },

      // 完成回调
      onComplete: async (data) => {
        accumulatedData.files = data.files || [];
        accumulatedData.metadata = data.metadata || {};

        // 保存到SQLite数据库
        if (this.database && data.files?.length > 0) {
          // 构建项目对象
          const localProject = {
            id: this._generateUUID(),
            name: createData.name || '未命名项目',
            projectType: createData.projectType || 'web',
            userId: createData.userId || 'default-user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: JSON.stringify(accumulatedData.metadata),
          };

          await this.database.saveProject(localProject);
          await this.database.saveProjectFiles(localProject.id, data.files);

          // 返回包含本地ID的完整数据
          data.projectId = localProject.id;
        }

        event.sender.send('project:stream-chunk', {
          type: 'complete',
          data,
        });
      },

      // 错误回调
      onError: (error) => {
        event.sender.send('project:stream-chunk', {
          type: 'error',
          error: error.message,
        });
      },
    });

    // 监听取消事件
    const handleCancel = () => {
      if (streamControl) {
        streamControl.cancel();
      }
    };
    ipcMain.once('project:stream-cancel', handleCancel);

    return { success: true };

  } catch (error) {
    console.error('[IPC] Stream create failed:', error);
    event.sender.send('project:stream-chunk', {
      type: 'error',
      error: error.message,
    });
    return { success: false, error: error.message };
  }
});

// 取消handler
ipcMain.handle('project:stream-cancel', () => {
  // 触发取消事件
  ipcMain.emit('project:stream-cancel');
  return { success: true };
});
```

**要点**：
- 累积所有阶段数据用于最终保存
- 通过`event.sender.send`发送流式事件到渲染进程
- 完成时保存到SQLite数据库
- 支持取消操作

---

#### 3. Preload API 暴露

**文件**: `desktop-app-vue/src/preload/index.js`

**修改**: 在`project`对象中添加流式API

```javascript
project: {
  // ... 现有方法

  /**
   * 流式创建项目
   */
  createStream: (createData, callbacks) => {
    return new Promise((resolve, reject) => {
      const handleChunk = (chunkData) => {
        const { type, data, error } = chunkData;

        switch (type) {
          case 'progress':
            callbacks.onProgress?.(data);
            break;
          case 'content':
            callbacks.onContent?.(data);
            break;
          case 'complete':
            callbacks.onComplete?.(data);
            ipcRenderer.off('project:stream-chunk', handleChunk);
            resolve(data);
            break;
          case 'error':
            callbacks.onError?.(new Error(error));
            ipcRenderer.off('project:stream-chunk', handleChunk);
            reject(new Error(error));
            break;
        }
      };

      // 监听流式事件
      ipcRenderer.on('project:stream-chunk', handleChunk);

      // 发起流式请求
      ipcRenderer.invoke('project:create-stream', createData)
        .catch((err) => {
          ipcRenderer.off('project:stream-chunk', handleChunk);
          reject(err);
        });
    });
  },

  /**
   * 取消流式创建
   */
  cancelStream: () => {
    return ipcRenderer.invoke('project:stream-cancel');
  },
},
```

---

### 第二阶段：前端Store层

#### 4. Project Store 新增流式方法

**文件**: `desktop-app-vue/src/renderer/stores/project.js`

**新增方法**: `createProjectStream(createData, onProgress)`

```javascript
/**
 * 流式创建项目
 */
async createProjectStream(createData, onProgress) {
  return new Promise((resolve, reject) => {
    const progressData = {
      currentStage: '',
      stages: [],
      contentByStage: {},
      logs: [],
      metadata: {},
    };

    window.electronAPI.project.createStream(createData, {
      onProgress: (data) => {
        // 更新当前阶段
        progressData.currentStage = data.stage;
        progressData.stages.push({
          stage: data.stage,
          message: data.message,
          timestamp: Date.now(),
          status: 'running',
        });
        progressData.logs.push({
          type: 'info',
          message: data.message,
          timestamp: Date.now(),
        });

        // 回调给UI
        onProgress?.({
          type: 'progress',
          ...progressData,
        });
      },

      onContent: (data) => {
        // 累积内容
        if (!progressData.contentByStage[data.stage]) {
          progressData.contentByStage[data.stage] = '';
        }
        progressData.contentByStage[data.stage] += data.content;

        // 回调给UI
        onProgress?.({
          type: 'content',
          ...progressData,
        });
      },

      onComplete: (data) => {
        // 标记所有阶段完成
        progressData.stages.forEach(s => s.status = 'completed');
        progressData.metadata = data.metadata || {};
        progressData.logs.push({
          type: 'success',
          message: `成功生成${data.files?.length || 0}个文件`,
          timestamp: Date.now(),
        });

        // 添加到项目列表
        if (data.projectId) {
          this.projects.push({
            id: data.projectId,
            name: createData.name || '未命名项目',
            projectType: createData.projectType || 'web',
            files: data.files || [],
            metadata: data.metadata,
            createdAt: Date.now(),
          });
        }

        // 回调给UI
        onProgress?.({
          type: 'complete',
          ...progressData,
          result: data,
        });

        resolve(data);
      },

      onError: (error) => {
        // 标记当前阶段失败
        const currentStage = progressData.stages.find(s => s.status === 'running');
        if (currentStage) {
          currentStage.status = 'error';
        }
        progressData.logs.push({
          type: 'error',
          message: error.message,
          timestamp: Date.now(),
        });

        // 回调给UI
        onProgress?.({
          type: 'error',
          ...progressData,
          error: error.message,
        });

        reject(error);
      },
    });
  });
},

/**
 * 取消流式创建
 */
async cancelProjectStream() {
  await window.electronAPI.project.cancelStream();
},
```

**要点**：
- 维护progressData对象累积所有信息
- 将stage映射为前端易理解的状态（running/completed/error）
- 生成日志列表供UI展示
- 完成时添加到projects列表

---

### 第三阶段：UI组件层

#### 5. 新建StreamProgressModal组件

**文件**: `desktop-app-vue/src/renderer/components/projects/StreamProgressModal.vue`

**组件结构**：

```vue
<template>
  <a-modal
    :open="open"
    title="创建项目中"
    :width="900"
    :closable="false"
    :maskClosable="false"
    :footer="null"
  >
    <div class="stream-progress-modal">
      <!-- 1. 总进度条 -->
      <div class="overall-progress">
        <a-progress
          :percent="overallProgress"
          :status="progressStatus"
          stroke-color="#667eea"
        />
        <div class="progress-text">{{ currentMessage }}</div>
      </div>

      <!-- 2. 阶段步骤 -->
      <div class="stages-section">
        <h3>执行步骤</h3>
        <div class="stage-list">
          <div
            v-for="stage in stageSteps"
            :key="stage.key"
            class="stage-item"
            :class="stage.status"
          >
            <div class="stage-icon">
              <CheckCircleOutlined v-if="stage.status === 'completed'" />
              <LoadingOutlined v-else-if="stage.status === 'running'" spin />
              <CloseCircleOutlined v-else-if="stage.status === 'error'" />
              <span v-else class="stage-number">{{ stage.number }}</span>
            </div>
            <div class="stage-content">
              <div class="stage-name">{{ stage.name }}</div>
              <div class="stage-message">{{ stage.message }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. 代码预览（Tab切换） -->
      <div v-if="hasContent" class="code-preview-section">
        <h3>生成内容</h3>
        <a-tabs v-model:activeKey="activeTab" type="card">
          <a-tab-pane
            v-for="file in fileStages"
            :key="file.key"
            :tab="file.label"
          >
            <div class="code-content">
              <pre><code>{{ progressData.contentByStage[file.key] || '生成中...' }}</code></pre>
              <span v-if="isGenerating(file.key)" class="typing-cursor">▊</span>
            </div>
          </a-tab-pane>
        </a-tabs>
      </div>

      <!-- 4. 元数据展示 -->
      <div v-if="hasMetadata" class="metadata-section">
        <h3>生成信息</h3>
        <a-descriptions :column="2" size="small">
          <a-descriptions-item label="模型">
            {{ progressData.metadata.model || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="Tokens">
            {{ progressData.metadata.tokens || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="模板">
            {{ progressData.metadata.template || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="主题">
            {{ progressData.metadata.theme || '-' }}
          </a-descriptions-item>
        </a-descriptions>
      </div>

      <!-- 5. 详细日志 -->
      <div v-if="showLogs" class="logs-section">
        <div class="logs-header">
          <h3>详细日志</h3>
          <a-button
            type="link"
            size="small"
            @click="showLogs = !showLogs"
          >
            {{ showLogs ? '收起' : '展开' }}
          </a-button>
        </div>
        <div class="logs-content">
          <div
            v-for="(log, idx) in progressData.logs"
            :key="idx"
            class="log-item"
            :class="log.type"
          >
            <span class="log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="log-message">{{ log.message }}</span>
          </div>
        </div>
      </div>

      <!-- 6. 错误信息 -->
      <div v-if="error" class="error-section">
        <ExclamationCircleOutlined />
        {{ error }}
      </div>

      <!-- 7. 操作按钮 -->
      <div class="actions">
        <!-- 进行中 -->
        <template v-if="isStreaming">
          <a-button @click="handleCancel" danger>
            取消
          </a-button>
        </template>

        <!-- 完成 -->
        <template v-else-if="isCompleted">
          <a-button type="primary" @click="handleViewProject">
            查看项目
          </a-button>
          <a-button @click="handleContinue">
            继续创建
          </a-button>
        </template>

        <!-- 错误 -->
        <template v-else-if="error">
          <a-button type="primary" @click="handleRetry">
            重试
          </a-button>
          <a-button @click="handleClose">
            取消
          </a-button>
        </template>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  open: Boolean,
  progressData: {
    type: Object,
    default: () => ({
      currentStage: '',
      stages: [],
      contentByStage: {},
      logs: [],
      metadata: {},
    }),
  },
  error: String,
});

const emit = defineEmits(['cancel', 'retry', 'close', 'viewProject', 'continue']);

// 状态
const activeTab = ref('html');
const showLogs = ref(false);

// 阶段定义
const stageDefinitions = [
  { key: 'intent', name: '意图识别', number: 1 },
  { key: 'spec', name: '生成规格', number: 2 },
  { key: 'html', name: '生成HTML', number: 3 },
  { key: 'css', name: '生成CSS', number: 4 },
  { key: 'js', name: '生成JavaScript', number: 5 },
];

const fileStages = [
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
  { key: 'js', label: 'JavaScript' },
];

// 计算属性
const stageSteps = computed(() => {
  return stageDefinitions.map(def => {
    const stageInfo = props.progressData.stages.find(s => s.stage === def.key);
    return {
      ...def,
      status: stageInfo?.status || 'pending',
      message: stageInfo?.message || '等待中...',
    };
  });
});

const overallProgress = computed(() => {
  const total = stageDefinitions.length;
  const completed = stageSteps.value.filter(s => s.status === 'completed').length;
  return Math.round((completed / total) * 100);
});

const progressStatus = computed(() => {
  if (props.error) return 'exception';
  if (isCompleted.value) return 'success';
  return 'active';
});

const currentMessage = computed(() => {
  const runningStage = stageSteps.value.find(s => s.status === 'running');
  return runningStage?.message || '准备中...';
});

const isStreaming = computed(() => {
  return stageSteps.value.some(s => s.status === 'running');
});

const isCompleted = computed(() => {
  return stageSteps.value.every(s => s.status === 'completed');
});

const hasContent = computed(() => {
  return Object.keys(props.progressData.contentByStage).length > 0;
});

const hasMetadata = computed(() => {
  return Object.keys(props.progressData.metadata).length > 0;
});

// 方法
const isGenerating = (stage) => {
  return props.progressData.currentStage === stage;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
};

const handleCancel = () => emit('cancel');
const handleRetry = () => emit('retry');
const handleClose = () => emit('close');
const handleViewProject = () => emit('viewProject');
const handleContinue = () => emit('continue');

// 监听当前阶段，自动切换Tab
watch(
  () => props.progressData.currentStage,
  (newStage) => {
    if (fileStages.some(f => f.key === newStage)) {
      activeTab.value = newStage;
    }
  }
);
</script>

<style scoped>
.stream-progress-modal {
  padding: 20px 0;
}

/* 总进度 */
.overall-progress {
  margin-bottom: 24px;
}

.progress-text {
  text-align: center;
  margin-top: 12px;
  font-size: 16px;
  font-weight: 500;
  color: #374151;
}

/* 阶段步骤 */
.stages-section {
  margin-bottom: 24px;
}

.stages-section h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #1f2937;
}

.stage-list {
  background: #f9fafb;
  border-radius: 8px;
  padding: 16px;
}

.stage-item {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  margin-bottom: 8px;
  background: white;
  border-radius: 6px;
  border-left: 4px solid #e5e7eb;
}

.stage-item.running {
  border-left-color: #667eea;
  background: #eef2ff;
}

.stage-item.completed {
  border-left-color: #10b981;
}

.stage-item.error {
  border-left-color: #ef4444;
  background: #fef2f2;
}

.stage-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  font-size: 20px;
}

.stage-item.completed .stage-icon {
  color: #10b981;
}

.stage-item.running .stage-icon {
  color: #667eea;
}

.stage-item.error .stage-icon {
  color: #ef4444;
}

.stage-number {
  display: inline-block;
  width: 24px;
  height: 24px;
  line-height: 24px;
  text-align: center;
  border-radius: 50%;
  background: #e5e7eb;
  color: #6b7280;
  font-size: 14px;
  font-weight: 600;
}

.stage-content {
  flex: 1;
}

.stage-name {
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 4px;
}

.stage-message {
  color: #6b7280;
  font-size: 14px;
}

/* 代码预览 */
.code-preview-section {
  margin-bottom: 24px;
}

.code-preview-section h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #1f2937;
}

.code-content {
  position: relative;
  max-height: 300px;
  overflow-y: auto;
  background: #2d2d2d;
  border-radius: 6px;
  padding: 16px;
}

.code-content pre {
  margin: 0;
  color: #f8f8f2;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.typing-cursor {
  display: inline-block;
  width: 8px;
  height: 16px;
  background: #667eea;
  animation: blink 1s infinite;
  margin-left: 2px;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 元数据 */
.metadata-section {
  margin-bottom: 24px;
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
}

.metadata-section h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #1f2937;
}

/* 日志 */
.logs-section {
  margin-bottom: 24px;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.logs-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.logs-content {
  max-height: 200px;
  overflow-y: auto;
  background: #1f2937;
  border-radius: 6px;
  padding: 12px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

.log-item {
  margin-bottom: 4px;
  display: flex;
  gap: 8px;
}

.log-time {
  color: #9ca3af;
  flex-shrink: 0;
}

.log-message {
  color: #f3f4f6;
}

.log-item.error .log-message {
  color: #fca5a5;
}

.log-item.success .log-message {
  color: #6ee7b7;
}

/* 错误 */
.error-section {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 操作按钮 */
.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}
</style>
```

**要点**：
- 5个阶段步骤可视化（圆形图标 → 加载图标 → 勾选图标）
- Tab切换显示HTML/CSS/JS生成内容
- 实时打字光标效果
- 元数据Descriptions展示
- 详细日志可折叠
- 根据状态显示不同操作按钮

---

#### 6. 修改NewProjectPage组件

**文件**: `desktop-app-vue/src/renderer/pages/projects/NewProjectPage.vue`

**修改内容**：

1. **引入新组件**：
```vue
<script setup>
import StreamProgressModal from '@/components/projects/StreamProgressModal.vue';
</script>
```

2. **替换Modal**：
```vue
<!-- 旧的简单Modal -->
<!-- <a-modal v-model:open="showProgressModal" ...> ... </a-modal> -->

<!-- 新的流式Modal -->
<StreamProgressModal
  :open="showProgressModal"
  :progress-data="streamProgressData"
  :error="createError"
  @cancel="handleCancelStream"
  @retry="handleRetryCreate"
  @close="handleCloseStream"
  @view-project="handleViewNewProject"
  @continue="handleContinueCreate"
/>
```

3. **修改状态和方法**：
```javascript
// 新增状态
const streamProgressData = ref({
  currentStage: '',
  stages: [],
  contentByStage: {},
  logs: [],
  metadata: {},
});

// 修改startCreateProcess方法
const startCreateProcess = async (createData) => {
  showProgressModal.value = true;
  createError.value = '';
  streamProgressData.value = {
    currentStage: '',
    stages: [],
    contentByStage: {},
    logs: [],
    metadata: {},
  };

  try {
    const result = await projectStore.createProjectStream(createData, (progressUpdate) => {
      // 更新进度数据
      streamProgressData.value = { ...progressUpdate };

      // 处理不同类型
      if (progressUpdate.type === 'complete') {
        createdProjectId.value = progressUpdate.result.projectId;
        message.success('项目创建成功！');
      } else if (progressUpdate.type === 'error') {
        createError.value = progressUpdate.error;
        message.error('创建项目失败：' + progressUpdate.error);
      }
    });
  } catch (error) {
    console.error('Create project stream failed:', error);
    createError.value = error.message || '创建项目失败';
  }
};

// 新增取消方法
const handleCancelStream = async () => {
  try {
    await projectStore.cancelProjectStream();
    showProgressModal.value = false;
    message.info('已取消创建');
  } catch (error) {
    message.error('取消失败：' + error.message);
  }
};

// 新增关闭方法
const handleCloseStream = () => {
  showProgressModal.value = false;
  streamProgressData.value = {
    currentStage: '',
    stages: [],
    contentByStage: {},
    logs: [],
    metadata: {},
  };
};
```

---

## 测试计划

### 单元测试

1. **HTTP Client测试**：
   - SSE消息解析正确性
   - 错误处理
   - 取消操作

2. **Store测试**：
   - 进度数据累积
   - 状态映射
   - 错误处理

### 集成测试

1. **完整流程测试**：
   - Web项目创建
   - Document/Data项目创建
   - 模板创建

2. **边缘场景**：
   - 网络中断
   - 超时处理
   - 取消操作
   - 重试操作

### UI测试

1. **视觉测试**：
   - 阶段步骤动画
   - 代码预览滚动
   - Tab切换
   - 响应式布局

2. **交互测试**：
   - 取消按钮
   - 重试按钮
   - 日志折叠

---

## 关键文件清单

### 需要修改的文件（5个）

1. **desktop-app-vue/src/main/project/http-client.js**
   - 新增 `createProjectStream()` 方法

2. **desktop-app-vue/src/main/index.js**
   - 新增 `project:create-stream` handler
   - 新增 `project:stream-cancel` handler

3. **desktop-app-vue/src/preload/index.js**
   - 新增 `project.createStream()` API
   - 新增 `project.cancelStream()` API

4. **desktop-app-vue/src/renderer/stores/project.js**
   - 新增 `createProjectStream()` 方法
   - 新增 `cancelProjectStream()` 方法

5. **desktop-app-vue/src/renderer/pages/projects/NewProjectPage.vue**
   - 引入StreamProgressModal组件
   - 修改startCreateProcess方法
   - 新增取消/关闭handlers

### 需要新建的文件（1个）

6. **desktop-app-vue/src/renderer/components/projects/StreamProgressModal.vue**
   - 完整的流式进度Modal组件（约450行）

---

## 实施优先级

### P0 - 核心功能（第1-2天）

1. HTTP Client流式方法
2. IPC Handler
3. Preload API
4. Store方法
5. 基础StreamProgressModal（不含代码预览和日志）

### P1 - 增强功能（第3-4天）

6. 代码预览Tab
7. 实时打字光标
8. 元数据展示
9. 详细日志

### P2 - 优化和测试（第5天）

10. 取消操作完善
11. 错误处理优化
12. 动画效果调优
13. 集成测试

---

## 风险和注意事项

1. **SSE连接稳定性**：
   - 后端需确保每30秒至少发送一次消息（心跳）
   - 前端需要处理连接中断重连

2. **内存管理**：
   - 流式内容可能很大，需要考虑限制contentByStage的大小
   - 建议只保留最后1000个字符用于预览

3. **UI性能**：
   - 高频更新可能导致UI卡顿
   - 建议使用节流（throttle）限制更新频率为100ms

4. **数据库保存**：
   - 确保在complete时才保存，避免保存不完整数据
   - 需要transaction支持以保证原子性

5. **向后兼容**：
   - 保留现有的`createProject()`方法
   - 用户可以在设置中选择使用流式或非流式模式

---

## 配置项（可选）

在用户设置中添加：

```javascript
{
  project: {
    useStreamingCreate: true,  // 是否使用流式创建
    showCodePreview: true,     // 是否显示代码预览
    showDetailedLogs: false,   // 是否默认展开日志
    streamTimeout: 600000,     // 流式超时时间（毫秒）
  }
}
```

---

## 参考资源

- **后端API文档**: `backend/ai-service/STREAMING_API.md`
- **前端SSE Demo**: `backend/ai-service/streaming_demo.html` (375-444行)
- **现有流式实现**: `desktop-app-vue/src/renderer/components/ChatPanel.vue` (336-370行)
- **UI参考图片**: `参考资料/可看到当前执行的情况.png`
