<template>
  <div class="history-panel">
    <a-drawer
      v-model:open="modalVisible"
      title="操作历史"
      placement="right"
      :width="420"
    >
      <template #extra>
        <a-space>
          <a-button size="small" @click="handleRefresh">
            <template #icon><ReloadOutlined /></template>
          </a-button>
          <a-button size="small" danger @click="handleClearAll">
            <template #icon><DeleteOutlined /></template>
            清空
          </a-button>
        </a-space>
      </template>

      <!-- 统计信息 -->
      <div class="history-stats">
        <a-row :gutter="8">
          <a-col :span="8">
            <a-statistic
              title="总记录"
              :value="historyStore.statistics.total"
              :value-style="{ fontSize: '18px' }"
            />
          </a-col>
          <a-col :span="8">
            <a-statistic
              title="技能"
              :value="historyStore.statistics.skills"
              :value-style="{ fontSize: '18px', color: '#1890ff' }"
            />
          </a-col>
          <a-col :span="8">
            <a-statistic
              title="工具"
              :value="historyStore.statistics.tools"
              :value-style="{ fontSize: '18px', color: '#52c41a' }"
            />
          </a-col>
        </a-row>
      </div>

      <a-divider />

      <!-- 筛选 -->
      <div class="history-filters">
        <a-space>
          <a-select
            v-model:value="filterEntity"
            style="width: 100px"
            size="small"
            @change="handleFilterChange"
          >
            <a-select-option value="all">全部</a-select-option>
            <a-select-option value="skill">技能</a-select-option>
            <a-select-option value="tool">工具</a-select-option>
          </a-select>

          <a-select
            v-model:value="filterAction"
            style="width: 120px"
            size="small"
            @change="handleFilterChange"
          >
            <a-select-option value="all">所有操作</a-select-option>
            <a-select-option value="create">创建</a-select-option>
            <a-select-option value="update">更新</a-select-option>
            <a-select-option value="delete">删除</a-select-option>
          </a-select>
        </a-space>
      </div>

      <!-- 历史记录列表 -->
      <div class="history-list">
        <a-timeline v-if="filteredRecords.length > 0">
          <a-timeline-item
            v-for="record in filteredRecords"
            :key="record.id"
            :color="historyStore.getActionColor(record.actionType)"
          >
            <template #dot>
              <component
                :is="getIcon(record.actionType)"
                style="font-size: 14px"
              />
            </template>

            <div class="record-item">
              <div class="record-title">
                {{ historyStore.formatRecord(record) }}
              </div>
              <div class="record-time">
                {{ formatTime(record.timestamp) }}
              </div>
              <div v-if="record.details" class="record-details">
                {{ record.details }}
              </div>
            </div>
          </a-timeline-item>
        </a-timeline>

        <a-empty v-else description="暂无操作记录" />
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  ReloadOutlined,
  DeleteOutlined,
  PlusCircleOutlined,
  EditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CheckSquareOutlined,
  CloseSquareOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons-vue';
import { useHistoryStore, ACTION_TYPES, ENTITY_TYPES } from '../../stores/history';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const historyStore = useHistoryStore();

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const filterEntity = ref('all');
const filterAction = ref('all');

// 筛选后的记录
const filteredRecords = computed(() => {
  let records = historyStore.records;

  if (filterEntity.value !== 'all') {
    records = records.filter(r => r.entityType === filterEntity.value);
  }

  if (filterAction.value !== 'all') {
    records = records.filter(r => r.actionType === filterAction.value);
  }

  return records;
});

// 获取图标组件
const getIcon = (actionType) => {
  const iconMap = {
    [ACTION_TYPES.CREATE]: PlusCircleOutlined,
    [ACTION_TYPES.UPDATE]: EditOutlined,
    [ACTION_TYPES.DELETE]: DeleteOutlined,
    [ACTION_TYPES.ENABLE]: CheckCircleOutlined,
    [ACTION_TYPES.DISABLE]: CloseCircleOutlined,
    [ACTION_TYPES.BATCH_ENABLE]: CheckSquareOutlined,
    [ACTION_TYPES.BATCH_DISABLE]: CloseSquareOutlined,
    [ACTION_TYPES.BATCH_DELETE]: DeleteOutlined,
  };

  return iconMap[actionType] || InfoCircleOutlined;
};

// 格式化时间
const formatTime = (timestamp) => {
  return dayjs(timestamp).fromNow();
};

// 刷新
const handleRefresh = () => {
  message.success('已刷新');
};

// 清空所有记录
const handleClearAll = () => {
  Modal.confirm({
    title: '确认清空所有历史记录？',
    content: '此操作不可恢复',
    okText: '确认',
    okType: 'danger',
    cancelText: '取消',
    onOk() {
      historyStore.clearHistory();
      message.success('已清空历史记录');
    },
  });
};

// 筛选变化
const handleFilterChange = () => {
  // 筛选自动触发computed更新
};
</script>

<style scoped lang="scss">
.history-panel {
  .history-stats {
    margin-bottom: 16px;

    :deep(.ant-statistic-title) {
      font-size: 12px;
    }
  }

  .history-filters {
    margin-bottom: 16px;
  }

  .history-list {
    margin-top: 16px;

    .record-item {
      .record-title {
        font-weight: 500;
        color: #262626;
        margin-bottom: 4px;
      }

      .record-time {
        font-size: 12px;
        color: #8c8c8c;
      }

      .record-details {
        font-size: 12px;
        color: #595959;
        margin-top: 4px;
        padding: 4px 8px;
        background: #f5f5f5;
        border-radius: 4px;
      }
    }
  }
}

// 暗色主题适配
.dark-theme {
  .history-panel {
    .record-item {
      .record-title {
        color: rgba(255, 255, 255, 0.85);
      }

      .record-time {
        color: rgba(255, 255, 255, 0.45);
      }

      .record-details {
        color: rgba(255, 255, 255, 0.65);
        background: rgba(255, 255, 255, 0.04);
      }
    }
  }
}
</style>
