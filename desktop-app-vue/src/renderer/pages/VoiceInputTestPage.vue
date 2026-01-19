<template>
  <div class="voice-input-test-page">
    <div class="page-header">
      <h1>
        <AudioOutlined />
        实时语音输入测试
      </h1>
      <p class="page-description">
        测试新的实时语音输入功能，包括实时转录、语音命令识别和音频缓存
      </p>
    </div>

    <div class="page-content">
      <a-row :gutter="24">
        <!-- 左侧：语音输入组件 -->
        <a-col :span="16">
          <a-card
            title="语音输入"
            :bordered="false"
          >
            <RealtimeVoiceInput
              :auto-insert="false"
              :enable-commands="true"
              @transcript-completed="handleTranscriptCompleted"
              @command-recognized="handleCommandRecognized"
            />
          </a-card>
        </a-col>

        <!-- 右侧：信息面板 -->
        <a-col :span="8">
          <!-- 缓存统计 -->
          <a-card
            title="缓存统计"
            :bordered="false"
            class="info-card"
          >
            <a-descriptions
              :column="1"
              size="small"
            >
              <a-descriptions-item label="磁盘缓存数">
                {{ cacheStats.diskEntries || 0 }}
              </a-descriptions-item>
              <a-descriptions-item label="内存缓存数">
                {{ cacheStats.memoryEntries || 0 }}
              </a-descriptions-item>
              <a-descriptions-item label="总大小">
                {{ formatSize(cacheStats.totalSize || 0) }}
              </a-descriptions-item>
            </a-descriptions>

            <div class="card-actions">
              <a-button
                :loading="loadingCacheStats"
                @click="refreshCacheStats"
              >
                <ReloadOutlined />
                刷新
              </a-button>
              <a-popconfirm
                title="确定要清空所有缓存吗？"
                @confirm="clearCache"
              >
                <a-button danger>
                  <DeleteOutlined />
                  清空缓存
                </a-button>
              </a-popconfirm>
            </div>
          </a-card>

          <!-- 可用命令列表 -->
          <a-card
            title="可用语音命令"
            :bordered="false"
            class="info-card"
          >
            <a-collapse
              v-model:active-key="activeCommandCategory"
              accordion
            >
              <a-collapse-panel
                v-for="category in commandCategories"
                :key="category.name"
                :header="category.label"
              >
                <a-list
                  size="small"
                  :data-source="category.commands"
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-list-item-meta>
                        <template #title>
                          {{ item.patterns[0] }}
                        </template>
                        <template #description>
                          {{ item.description }}
                        </template>
                      </a-list-item-meta>
                    </a-list-item>
                  </template>
                </a-list>
              </a-collapse-panel>
            </a-collapse>
          </a-card>

          <!-- 识别历史 -->
          <a-card
            title="识别历史"
            :bordered="false"
            class="info-card"
          >
            <a-timeline>
              <a-timeline-item
                v-for="(item, index) in recognitionHistory"
                :key="index"
                :color="item.type === 'command' ? 'green' : 'blue'"
              >
                <template #dot>
                  <ThunderboltOutlined v-if="item.type === 'command'" />
                  <FileTextOutlined v-else />
                </template>
                <div class="timeline-item">
                  <div class="timeline-time">
                    {{ item.time }}
                  </div>
                  <div class="timeline-content">
                    <a-tag
                      v-if="item.type === 'command'"
                      color="green"
                    >
                      命令: {{ item.command }}
                    </a-tag>
                    <span v-else>{{ item.text }}</span>
                  </div>
                </div>
              </a-timeline-item>
            </a-timeline>
          </a-card>
        </a-col>
      </a-row>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  AudioOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';
import RealtimeVoiceInput from '@/components/RealtimeVoiceInput.vue';

// 状态
const cacheStats = ref({
  diskEntries: 0,
  memoryEntries: 0,
  totalSize: 0,
});
const loadingCacheStats = ref(false);
const activeCommandCategory = ref(['navigation']);
const recognitionHistory = ref([]);
const commandCategories = ref([
  {
    name: 'navigation',
    label: '导航命令',
    commands: []
  },
  {
    name: 'operation',
    label: '操作命令',
    commands: []
  },
  {
    name: 'ai',
    label: 'AI命令',
    commands: []
  },
  {
    name: 'system',
    label: '系统命令',
    commands: []
  }
]);

// 格式化文件大小
const formatSize = (bytes) => {
  if (bytes === 0) {return '0 B';}
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// 刷新缓存统计
const refreshCacheStats = async () => {
  loadingCacheStats.value = true;
  try {
    const result = await window.electronAPI.speech.getCacheStats();
    if (result.success) {
      cacheStats.value = result.stats;
    }
  } catch (error) {
    console.error('获取缓存统计失败:', error);
    message.error('获取缓存统计失败');
  } finally {
    loadingCacheStats.value = false;
  }
};

// 清空缓存
const clearCache = async () => {
  try {
    const result = await window.electronAPI.speech.clearCache();
    if (result.success) {
      message.success('缓存已清空');
      await refreshCacheStats();
    }
  } catch (error) {
    console.error('清空缓存失败:', error);
    message.error('清空缓存失败');
  }
};

// 加载可用命令
const loadAvailableCommands = async () => {
  try {
    const result = await window.electronAPI.speech.getAllCommands();
    if (result.success && result.commands) {
      // 按类别分组命令
      const categorized = {
        navigation: [],
        operation: [],
        ai: [],
        system: []
      };

      result.commands.forEach(cmd => {
        const name = cmd.name;
        if (name.startsWith('navigate_')) {
          categorized.navigation.push(cmd);
        } else if (name.startsWith('create_') || name === 'save' || name === 'search') {
          categorized.operation.push(cmd);
        } else if (name === 'summarize' || name === 'translate' || name === 'generate_outline' || name === 'explain') {
          categorized.ai.push(cmd);
        } else {
          categorized.system.push(cmd);
        }
      });

      commandCategories.value = [
        { name: 'navigation', label: '导航命令', commands: categorized.navigation },
        { name: 'operation', label: '操作命令', commands: categorized.operation },
        { name: 'ai', label: 'AI命令', commands: categorized.ai },
        { name: 'system', label: '系统命令', commands: categorized.system }
      ];
    }
  } catch (error) {
    console.error('加载可用命令失败:', error);
  }
};

// 处理转录完成
const handleTranscriptCompleted = (data) => {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  recognitionHistory.value.unshift({
    type: 'transcript',
    text: data.transcript.substring(0, 50) + (data.transcript.length > 50 ? '...' : ''),
    time: time,
  });

  // 限制历史记录数量
  if (recognitionHistory.value.length > 10) {
    recognitionHistory.value = recognitionHistory.value.slice(0, 10);
  }
};

// 处理命令识别
const handleCommandRecognized = (command) => {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  recognitionHistory.value.unshift({
    type: 'command',
    command: command.command,
    time: time,
  });

  // 限制历史记录数量
  if (recognitionHistory.value.length > 10) {
    recognitionHistory.value = recognitionHistory.value.slice(0, 10);
  }
};

// 初始化
onMounted(async () => {
  await refreshCacheStats();
  await loadAvailableCommands();
});
</script>

<style lang="less" scoped>
.voice-input-test-page {
  padding: 24px;
  min-height: 100vh;
  background: #f5f7fa;

  .page-header {
    margin-bottom: 24px;

    h1 {
      font-size: 28px;
      font-weight: 600;
      color: #1a202c;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .page-description {
      font-size: 14px;
      color: #718096;
      margin: 0;
    }
  }

  .page-content {
    .info-card {
      margin-bottom: 16px;

      .card-actions {
        margin-top: 16px;
        display: flex;
        gap: 8px;
      }
    }

    .timeline-item {
      .timeline-time {
        font-size: 12px;
        color: #a0aec0;
        margin-bottom: 4px;
      }

      .timeline-content {
        font-size: 13px;
        color: #2d3748;
      }
    }
  }
}

:deep(.ant-card) {
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

:deep(.ant-collapse) {
  border: none;
  background: transparent;

  .ant-collapse-item {
    border: none;
    margin-bottom: 8px;

    .ant-collapse-header {
      padding: 8px 12px;
      background: #f7fafc;
      border-radius: 6px;
      font-weight: 500;
    }

    .ant-collapse-content {
      border: none;
      background: transparent;
    }
  }
}

:deep(.ant-list-item) {
  padding: 8px 0;
  border-bottom: 1px solid #e2e8f0;

  &:last-child {
    border-bottom: none;
  }
}

:deep(.ant-timeline) {
  margin-top: 16px;

  .ant-timeline-item-content {
    margin-left: 24px;
  }
}
</style>
