<template>
  <div class="ai-control-panel">
    <a-card title="🤖 AI 浏览器控制" :bordered="false">
      <!-- AI 指令输入区 -->
      <div class="ai-input-section">
        <a-textarea
          v-model:value="prompt"
          placeholder="输入自然语言指令，AI 将自动操作浏览器...

示例：
• 打开 Google 并搜索 'Electron 教程'
• 登录 GitHub 账号（用户名：xxx，密码：xxx）
• 填写这个表单并提交
• 点击第一个搜索结果
• 滚动到页面底部并截图"
          :rows="4"
          :disabled="executing"
        />

        <div class="input-controls">
          <a-space>
            <a-button
              type="primary"
              size="large"
              @click="handleExecute"
              :loading="executing"
              :disabled="!prompt.trim() || !targetId"
            >
              <template #icon><ThunderboltOutlined /></template>
              {{executing ? '执行中...' : '执行 AI 指令'}}
            </a-button>

            <a-button
              @click="handleParseOnly"
              :loading="parsing"
              :disabled="!prompt.trim() || !targetId"
            >
              <template #icon><EyeOutlined /></template>
              预览步骤
            </a-button>

            <a-button
              @click="handleClear"
              :disabled="executing"
            >
              <template #icon><ClearOutlined /></template>
              清除
            </a-button>

            <a-dropdown v-if="!executing">
              <a-button>
                <template #icon><BulbOutlined /></template>
                示例
              </a-button>
              <template #overlay>
                <a-menu @click="handleSelectExample">
                  <a-menu-item key="google-search">
                    Google 搜索
                  </a-menu-item>
                  <a-menu-item key="form-fill">
                    填写表单
                  </a-menu-item>
                  <a-menu-item key="click-first">
                    点击第一个链接
                  </a-menu-item>
                  <a-menu-item key="screenshot">
                    截图保存
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </div>
      </div>

      <a-divider />

      <!-- 执行进度和结果 -->
      <div v-if="executionResult || parsedSteps" class="execution-section">
        <!-- 操作步骤预览/时间线 -->
        <div v-if="parsedSteps || executionResult" class="steps-section">
          <h4>
            <HistoryOutlined />
            操作步骤
            <a-tag v-if="parsedSteps" color="blue">
              {{ parsedSteps.length }} 步
            </a-tag>
          </h4>

          <a-timeline mode="left">
            <a-timeline-item
              v-for="(step, index) in displaySteps"
              :key="index"
              :color="getStepColor(step, index)"
            >
              <template #dot>
                <LoadingOutlined v-if="isStepExecuting(index)" spin />
                <CheckCircleOutlined v-else-if="isStepCompleted(index)" />
                <ClockCircleOutlined v-else />
              </template>

              <div class="step-content">
                <div class="step-header">
                  <span class="step-number">步骤 {{ index + 1 }}</span>
                  <a-tag :color="getActionColor(step.action)">
                    {{ step.action }}
                  </a-tag>
                  <span v-if="step.ref" class="step-ref">{{ step.ref }}</span>
                </div>

                <div class="step-description">
                  {{ step.description }}
                </div>

                <div v-if="step.url" class="step-detail">
                  <GlobalOutlined /> {{ step.url }}
                </div>

                <div v-if="step.text" class="step-detail">
                  <EditOutlined /> "{{ step.text }}"
                </div>

                <!-- 执行结果 -->
                <div v-if="getStepResult(index)" class="step-result">
                  <a-alert
                    :type="getStepResult(index).success ? 'success' : 'error'"
                    :message="getStepResult(index).success ? '执行成功' : '执行失败'"
                    :description="getStepResult(index).error"
                    size="small"
                    show-icon
                  />
                </div>
              </div>
            </a-timeline-item>
          </a-timeline>
        </div>

        <!-- 执行统计 -->
        <div v-if="executionResult" class="execution-stats">
          <a-space>
            <a-statistic
              title="总步骤"
              :value="executionResult.steps.length"
              prefix=""
            />
            <a-statistic
              title="成功"
              :value="successCount"
              :value-style="{ color: '#3f8600' }"
            />
            <a-statistic
              title="失败"
              :value="failedCount"
              :value-style="{ color: '#cf1322' }"
            />
          </a-space>
        </div>
      </div>

      <!-- 空状态 -->
      <a-empty
        v-else
        description="输入 AI 指令开始自动化操作"
      >
        <BulbOutlined style="font-size: 48px; color: #faad14; margin-bottom: 16px" />
      </a-empty>

      <!-- 执行历史 -->
      <div v-if="history.length > 0" class="history-section">
        <a-divider />

        <h4>
          <HistoryOutlined />
          执行历史
          <a-button type="text" size="small" @click="handleClearHistory">
            清除
          </a-button>
        </h4>

        <a-list :dataSource="history" size="small">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  {{ item.prompt }}
                </template>
                <template #description>
                  <a-space>
                    <span>{{ new Date(item.timestamp).toLocaleString() }}</span>
                    <a-tag v-if="item.success" color="success">成功</a-tag>
                    <a-tag v-else color="error">失败</a-tag>
                    <span v-if="item.steps">{{ item.steps.length }} 步</span>
                  </a-space>
                </template>
              </a-list-item-meta>

              <template #actions>
                <a-button type="text" size="small" @click="handleReusePrompt(item.prompt)">
                  重用
                </a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  ThunderboltOutlined,
  EyeOutlined,
  ClearOutlined,
  BulbOutlined,
  HistoryOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  GlobalOutlined,
  EditOutlined
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  targetId: {
    type: String,
    default: null
  }
});

// 状态
const prompt = ref('');
const executing = ref(false);
const parsing = ref(false);
const parsedSteps = ref(null);
const executionResult = ref(null);
const currentStepIndex = ref(-1);
const history = ref([]);

// 示例指令
const examples = {
  'google-search': '打开 Google 并搜索 "Electron 教程"',
  'form-fill': '在搜索框输入 "ChainlessChain" 并点击搜索按钮',
  'click-first': '点击页面中第一个链接',
  'screenshot': '滚动到页面底部并截图'
};

// 计算属性
const displaySteps = computed(() => {
  if (executionResult.value) {
    return executionResult.value.steps;
  }
  return parsedSteps.value || [];
});

const successCount = computed(() => {
  if (!executionResult.value) return 0;
  return executionResult.value.results.filter(r => r.success).length;
});

const failedCount = computed(() => {
  if (!executionResult.value) return 0;
  return executionResult.value.results.filter(r => !r.success).length;
});

// 方法
const handleExecute = async () => {
  if (!props.targetId) {
    message.warning('请先选择一个标签页');
    return;
  }

  if (!prompt.value.trim()) {
    message.warning('请输入指令');
    return;
  }

  executing.value = true;
  parsedSteps.value = null;
  executionResult.value = null;
  currentStepIndex.value = -1;

  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:aiExecute',
      props.targetId,
      prompt.value,
      {
        autoSnapshot: true,
        maxRetries: 2
      }
    );

    executionResult.value = result;
    message.success(`AI 指令执行完成！${successCount.value} 步成功`);

    // 加载历史
    await loadHistory();
  } catch (error) {
    message.error('AI 执行失败: ' + error.message);
    console.error('AI execute error:', error);
  } finally {
    executing.value = false;
  }
};

const handleParseOnly = async () => {
  if (!props.targetId) {
    message.warning('请先选择一个标签页');
    return;
  }

  parsing.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:aiParse',
      props.targetId,
      prompt.value
    );

    parsedSteps.value = result.steps;
    executionResult.value = null;
    message.success(`已解析 ${result.steps.length} 个操作步骤`);
  } catch (error) {
    message.error('解析失败: ' + error.message);
    console.error('AI parse error:', error);
  } finally {
    parsing.value = false;
  }
};

const handleClear = () => {
  prompt.value = '';
  parsedSteps.value = null;
  executionResult.value = null;
  currentStepIndex.value = -1;
};

const handleSelectExample = ({ key }) => {
  prompt.value = examples[key];
};

const handleReusePrompt = (text) => {
  prompt.value = text;
};

const handleClearHistory = async () => {
  try {
    await window.electron.ipcRenderer.invoke('browser:aiClearHistory');
    history.value = [];
    message.success('历史已清除');
  } catch (error) {
    message.error('清除失败: ' + error.message);
  }
};

const loadHistory = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:aiGetHistory', 10);
    history.value = result;
  } catch (error) {
    console.error('Load history error:', error);
  }
};

const getStepColor = (step, index) => {
  if (isStepCompleted(index)) {
    const result = getStepResult(index);
    return result.success ? 'green' : 'red';
  }
  if (isStepExecuting(index)) {
    return 'blue';
  }
  return 'gray';
};

const getActionColor = (action) => {
  const colorMap = {
    navigate: 'blue',
    snapshot: 'cyan',
    click: 'green',
    type: 'orange',
    select: 'purple',
    wait: 'geekblue',
    screenshot: 'magenta'
  };
  return colorMap[action] || 'default';
};

const isStepExecuting = (index) => {
  return executing.value && currentStepIndex.value === index;
};

const isStepCompleted = (index) => {
  return executionResult.value && executionResult.value.results[index];
};

const getStepResult = (index) => {
  if (!executionResult.value || !executionResult.value.results[index]) {
    return null;
  }
  return executionResult.value.results[index];
};

// 生命周期
onMounted(() => {
  loadHistory();
});

// 监听 targetId 变化
watch(() => props.targetId, () => {
  // 切换标签页时清除状态
  handleClear();
});
</script>

<style scoped lang="less">
.ai-control-panel {
  .ai-input-section {
    .input-controls {
      margin-top: 16px;
    }
  }

  .execution-section {
    .steps-section {
      h4 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
      }

      .step-content {
        .step-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;

          .step-number {
            font-weight: 600;
          }

          .step-ref {
            color: #1890ff;
            font-family: monospace;
          }
        }

        .step-description {
          margin-bottom: 8px;
          color: rgba(0, 0, 0, 0.85);
        }

        .step-detail {
          margin-bottom: 4px;
          font-size: 12px;
          color: rgba(0, 0, 0, 0.45);
        }

        .step-result {
          margin-top: 8px;
        }
      }
    }

    .execution-stats {
      margin-top: 24px;
      padding: 16px;
      background: #fafafa;
      border-radius: 4px;
    }
  }

  .history-section {
    margin-top: 24px;

    h4 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
  }
}

:deep(.ant-timeline-item) {
  padding-bottom: 24px;
}
</style>
