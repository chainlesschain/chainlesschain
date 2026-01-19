<template>
  <div class="audio-upload-panel">
    <!-- 文件拖拽上传区域 -->
    <a-upload-dragger
      v-model:file-list="fileList"
      :before-upload="handleBeforeUpload"
      :custom-request="handleUpload"
      accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
      :multiple="true"
      :show-upload-list="false"
    >
      <p class="upload-icon">
        <InboxOutlined :style="{ fontSize: '48px', color: '#1890ff' }" />
      </p>
      <p class="upload-text">
        点击或拖拽音频文件到此区域
      </p>
      <p class="upload-hint">
        支持 MP3, WAV, M4A, AAC, OGG, FLAC 等格式
      </p>
      <p class="upload-hint">
        单个文件最大 25MB
      </p>
    </a-upload-dragger>

    <!-- 上传文件列表 -->
    <div
      v-if="fileList.length > 0"
      class="file-list"
    >
      <h4>待转录文件 ({{ fileList.length }})</h4>
      <a-list
        :data-source="fileList"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <span>{{ item.name }}</span>
                <a-tag
                  v-if="item.status === 'uploading'"
                  color="blue"
                >
                  处理中
                </a-tag>
                <a-tag
                  v-else-if="item.status === 'done'"
                  color="green"
                >
                  已完成
                </a-tag>
                <a-tag
                  v-else-if="item.status === 'error'"
                  color="red"
                >
                  失败
                </a-tag>
              </template>
              <template #description>
                <div v-if="item.status === 'uploading' && item.progress">
                  <a-progress
                    :percent="item.progress"
                    size="small"
                  />
                  <span class="progress-text">{{ item.statusText }}</span>
                </div>
                <div v-else-if="item.result">
                  时长: {{ formatDuration(item.result.duration) }} |
                  字数: {{ item.result.wordCount }}
                </div>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-button
                v-if="item.status === 'done' && item.result"
                type="link"
                size="small"
                @click="viewResult(item)"
              >
                查看
              </a-button>
              <a-button
                v-if="item.status !== 'uploading'"
                type="link"
                size="small"
                danger
                @click="removeFile(item)"
              >
                移除
              </a-button>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </div>

    <!-- 转录结果列表 -->
    <div
      v-if="results.length > 0"
      class="results-section"
    >
      <h4>转录结果</h4>
      <a-list
        :data-source="results"
        :pagination="{ pageSize: 5 }"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <SoundOutlined class="result-icon" />
                {{ item.fileName }}
              </template>
              <template #description>
                <div class="result-meta">
                  <span>时长: {{ formatDuration(item.duration) }}</span>
                  <span>引擎: {{ getEngineName(item.engine) }}</span>
                  <span>字数: {{ item.wordCount }}</span>
                </div>
                <div class="result-text">
                  {{ truncateText(item.text, 200) }}
                </div>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a @click="copyText(item.text)">复制</a>
              <a @click="insertToEditor(item.text)">插入</a>
              <a @click="viewFullText(item)">查看全文</a>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </div>

    <!-- 查看全文模态框 -->
    <a-modal
      v-model:open="showTextModal"
      title="转录全文"
      width="800px"
      :footer="null"
    >
      <div
        v-if="selectedResult"
        class="full-text-modal"
      >
        <div class="text-header">
          <h4>{{ selectedResult.fileName }}</h4>
          <div class="text-meta">
            <span>时长: {{ formatDuration(selectedResult.duration) }}</span>
            <span>字数: {{ selectedResult.wordCount }}</span>
            <span>置信度: {{ selectedResult.confidence }}%</span>
          </div>
        </div>
        <a-divider />
        <div class="text-content">
          {{ selectedResult.text }}
        </div>
        <a-divider />
        <div class="text-actions">
          <a-space>
            <a-button @click="copyText(selectedResult.text)">
              <CopyOutlined /> 复制全文
            </a-button>
            <a-button
              type="primary"
              @click="insertToEditor(selectedResult.text)"
            >
              <EditOutlined /> 插入编辑器
            </a-button>
          </a-space>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import { InboxOutlined, SoundOutlined, CopyOutlined, EditOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  autoTranscribe: {
    type: Boolean,
    default: true,
  },
  engine: {
    type: String,
    default: 'whisper-api',
  },
});

const emit = defineEmits(['result', 'insert']);

// 状态
const fileList = ref([]);
const results = ref([]);
const showTextModal = ref(false);
const selectedResult = ref(null);

// 上传前检查
const handleBeforeUpload = (file) => {
  // 检查文件大小（25MB限制）
  const isLt25M = file.size / 1024 / 1024 < 25;
  if (!isLt25M) {
    message.error(`${file.name} 文件大小超过 25MB 限制`);
    return false;
  }

  // 检查文件格式
  const validFormats = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm'];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!validFormats.includes(ext)) {
    message.error(`${file.name} 不是有效的音频文件格式`);
    return false;
  }

  return false; // 阻止自动上传，使用自定义上传
};

// 自定义上传
const handleUpload = async ({ file }) => {
  // 添加到文件列表
  const fileItem = {
    uid: file.uid,
    name: file.name,
    path: file.path,
    status: 'uploading',
    progress: 0,
    statusText: '准备转录...',
    result: null,
  };

  fileList.value.push(fileItem);

  if (props.autoTranscribe) {
    await transcribeFile(fileItem);
  }
};

// 转录文件
const transcribeFile = async (fileItem) => {
  try {
    fileItem.status = 'uploading';
    fileItem.statusText = '正在转录...';

    // 调用后端转录
    const result = await window.electronAPI.speech.transcribeFile(fileItem.path, {
      engine: props.engine,
      saveToDatabase: true,
      saveToKnowledge: true,
    });

    // 更新状态
    fileItem.status = 'done';
    fileItem.progress = 100;
    fileItem.result = result;

    // 添加到结果列表
    results.value.unshift({
      fileName: fileItem.name,
      text: result.text,
      duration: result.duration,
      wordCount: result.wordCount,
      confidence: result.confidence * 100,
      engine: result.engine,
      timestamp: new Date(),
    });

    message.success(`${fileItem.name} 转录完成`);
    emit('result', result);
  } catch (error) {
    console.error('转录失败:', error);
    fileItem.status = 'error';
    fileItem.statusText = error.message || '转录失败';
    message.error(`${fileItem.name} 转录失败: ${error.message}`);
  }
};

// 监听进度事件
onMounted(() => {
  window.electronAPI.speech.on('speech:progress', handleProgress);
});

onUnmounted(() => {
  window.electronAPI.speech.off('speech:progress', handleProgress);
});

const handleProgress = (progress) => {
  console.log('转录进度:', progress);

  // 查找对应的文件项并更新进度
  const fileItem = fileList.value.find(f => f.status === 'uploading');
  if (fileItem && progress.percent !== undefined) {
    fileItem.progress = Math.round(progress.percent);
    fileItem.statusText = progress.step || '转录中...';
  }
};

// 移除文件
const removeFile = (file) => {
  const index = fileList.value.findIndex(f => f.uid === file.uid);
  if (index > -1) {
    fileList.value.splice(index, 1);
  }
};

// 查看结果
const viewResult = (file) => {
  if (file.result) {
    selectedResult.value = {
      fileName: file.name,
      text: file.result.text,
      duration: file.result.duration,
      wordCount: file.result.wordCount,
      confidence: file.result.confidence * 100,
    };
    showTextModal.value = true;
  }
};

// 查看全文
const viewFullText = (result) => {
  selectedResult.value = result;
  showTextModal.value = true;
};

// 复制文本
const copyText = (text) => {
  navigator.clipboard.writeText(text).then(() => {
    message.success('已复制到剪贴板');
  }).catch(() => {
    message.error('复制失败');
  });
};

// 插入到编辑器
const insertToEditor = (text) => {
  emit('insert', text);
  message.success('已插入到编辑器');
};

// 格式化时长
const formatDuration = (seconds) => {
  if (!seconds) {return '0:00';}
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// 截断文本
const truncateText = (text, maxLength) => {
  if (!text) {return '';}
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
};

// 获取引擎名称
const getEngineName = (engine) => {
  const names = {
    'whisper-api': 'Whisper API',
    'whisper-local': 'Whisper Local',
    'webspeech': 'Web Speech',
  };
  return names[engine] || engine;
};
</script>

<style scoped lang="scss">
.audio-upload-panel {
  padding: 20px;
}

.upload-icon {
  margin-bottom: 16px;
}

.upload-text {
  font-size: 16px;
  color: #333;
  margin-bottom: 8px;
}

.upload-hint {
  font-size: 14px;
  color: #999;
  margin: 4px 0;
}

.file-list {
  margin-top: 24px;

  h4 {
    margin-bottom: 16px;
    font-size: 16px;
    font-weight: 600;
  }
}

.progress-text {
  margin-left: 12px;
  font-size: 12px;
  color: #666;
}

.results-section {
  margin-top: 32px;

  h4 {
    margin-bottom: 16px;
    font-size: 16px;
    font-weight: 600;
  }
}

.result-icon {
  margin-right: 8px;
  color: #1890ff;
}

.result-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #999;
  margin-bottom: 8px;
}

.result-text {
  color: #666;
  line-height: 1.6;
  margin-top: 8px;
}

.full-text-modal {
  .text-header {
    h4 {
      margin-bottom: 8px;
      font-size: 18px;
      font-weight: 600;
    }

    .text-meta {
      display: flex;
      gap: 16px;
      font-size: 14px;
      color: #999;
    }
  }

  .text-content {
    max-height: 400px;
    overflow-y: auto;
    line-height: 1.8;
    white-space: pre-wrap;
    word-wrap: break-word;
    padding: 16px;
    background: #f5f5f5;
    border-radius: 4px;
  }

  .text-actions {
    text-align: right;
  }
}
</style>
