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
      <div class="logs-section">
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
        <div v-if="showLogs" class="logs-content">
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
// 根据项目类型动态定义步骤
const getStageDefinitions = () => {
  // 从progressData中推断项目类型
  const stages = props.progressData.stages || [];
  const hasOutlineStage = stages.some(s => s.stage === 'outline');
  const hasHtmlStage = stages.some(s => s.stage === 'html');

  // Document项目步骤
  if (hasOutlineStage) {
    return [
      { key: 'intent', name: '意图识别', number: 1 },
      { key: 'engine', name: '引擎选择', number: 2 },
      { key: 'outline', name: '生成大纲', number: 3 },
      { key: 'content', name: '生成内容', number: 4 },
    ];
  }

  // Web项目步骤（默认）
  return [
    { key: 'intent', name: '意图识别', number: 1 },
    { key: 'spec', name: '生成规格', number: 2 },
    { key: 'html', name: '生成HTML', number: 3 },
    { key: 'css', name: '生成CSS', number: 4 },
    { key: 'js', name: '生成JavaScript', number: 5 },
  ];
};

const getFileStages = () => {
  const stages = props.progressData.stages || [];
  const hasOutlineStage = stages.some(s => s.stage === 'outline');

  // Document项目没有文件预览
  if (hasOutlineStage) {
    return [];
  }

  // Web项目文件预览
  return [
    { key: 'html', label: 'HTML' },
    { key: 'css', label: 'CSS' },
    { key: 'js', label: 'JavaScript' },
  ];
};

const stageDefinitions = computed(() => getStageDefinitions());
const fileStages = computed(() => getFileStages());

// 计算属性
const stageSteps = computed(() => {
  return stageDefinitions.value.map(def => {
    const stageInfo = props.progressData.stages.find(s => s.stage === def.key);
    return {
      ...def,
      status: stageInfo?.status || 'pending',
      message: stageInfo?.message || '等待中...',
    };
  });
});

const overallProgress = computed(() => {
  const total = stageDefinitions.value.length;
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
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
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
