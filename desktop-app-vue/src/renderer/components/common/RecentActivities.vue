<template>
  <div class="recent-activities">
    <a-card title="最近活动" :bordered="false">
      <!-- 时间范围选择 -->
      <template #extra>
        <a-radio-group v-model:value="timeRange" button-style="solid" size="small">
          <a-radio-button value="today">今天</a-radio-button>
          <a-radio-button value="week">本周</a-radio-button>
          <a-radio-button value="all">全部</a-radio-button>
        </a-radio-group>
      </template>

      <!-- 统计信息 -->
      <div class="activity-stats">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-statistic
              title="总活动数"
              :value="statistics.total"
              :prefix="h(ThunderboltOutlined)"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="最近文件"
              :value="statistics.recentFilesCount"
              :prefix="h(FileOutlined)"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="笔记操作"
              :value="noteActivitiesCount"
              :prefix="h(BookOutlined)"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="对话次数"
              :value="chatActivitiesCount"
              :prefix="h(MessageOutlined)"
            />
          </a-col>
        </a-row>
      </div>

      <a-divider />

      <!-- 最近文件 -->
      <div class="recent-files-section">
        <div class="section-header">
          <h4>
            <FileOutlined />
            最近文件
          </h4>
          <a-button type="link" size="small" @click="clearRecentFiles">
            清空
          </a-button>
        </div>

        <a-empty
          v-if="recentFiles.length === 0"
          description="暂无最近文件"
          :image="Empty.PRESENTED_IMAGE_SIMPLE"
        />

        <div v-else class="recent-files-list">
          <div
            v-for="file in recentFiles.slice(0, 10)"
            :key="file.id"
            class="recent-file-item"
            @click="handleFileClick(file)"
          >
            <div class="file-icon">
              <component :is="getFileIcon(file.type)" />
            </div>
            <div class="file-info">
              <div class="file-title">{{ file.title }}</div>
              <div class="file-meta">
                <span class="file-time">{{ formatTime(file.timestamp) }}</span>
                <span class="file-path">{{ file.path }}</span>
              </div>
            </div>
            <a-button
              type="text"
              size="small"
              danger
              @click.stop="removeFromRecentFiles(file.path)"
            >
              <CloseOutlined />
            </a-button>
          </div>
        </div>
      </div>

      <a-divider />

      <!-- 活动时间线 -->
      <div class="activity-timeline-section">
        <div class="section-header">
          <h4>
            <ClockCircleOutlined />
            活动时间线
          </h4>
          <a-button type="link" size="small" @click="showAllActivities = !showAllActivities">
            {{ showAllActivities ? '收起' : '展开' }}
          </a-button>
        </div>

        <a-empty
          v-if="filteredActivities.length === 0"
          description="暂无活动记录"
          :image="Empty.PRESENTED_IMAGE_SIMPLE"
        />

        <a-timeline v-else class="activity-timeline">
          <a-timeline-item
            v-for="activity in displayedActivities"
            :key="activity.id"
            :color="getActivityColor(activity.type)"
          >
            <template #dot>
              <component :is="getActivityIcon(activity.type)" />
            </template>

            <div class="timeline-content">
              <div class="timeline-title">{{ activity.title }}</div>
              <div v-if="activity.description" class="timeline-description">
                {{ activity.description }}
              </div>
              <div class="timeline-time">{{ formatTime(activity.timestamp) }}</div>
            </div>
          </a-timeline-item>
        </a-timeline>

        <div v-if="filteredActivities.length > 10 && !showAllActivities" class="load-more">
          <a-button type="link" @click="showAllActivities = true">
            查看更多 ({{ filteredActivities.length - 10 }} 条)
          </a-button>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="activity-actions">
        <a-space>
          <a-button @click="handleExport">
            <ExportOutlined />
            导出活动
          </a-button>
          <a-popconfirm
            title="确定清空所有活动记录吗？"
            @confirm="handleClear"
          >
            <a-button danger>
              <DeleteOutlined />
              清空活动
            </a-button>
          </a-popconfirm>
        </a-space>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, h } from 'vue';
import { message, Empty } from 'ant-design-vue';
import {
  ThunderboltOutlined,
  FileOutlined,
  BookOutlined,
  MessageOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  ExportOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  SyncOutlined,
  SaveOutlined,
} from '@ant-design/icons-vue';
import { useActivities, ActivityType } from '@/utils/activityManager';

// 使用活动管理器
const {
  activities,
  recentFiles,
  getActivities,
  getStatistics,
  clear,
  clearRecentFiles: clearRecentFilesAction,
  removeFromRecentFiles,
  exportData,
} = useActivities();

const timeRange = ref('today');
const showAllActivities = ref(false);

// 统计信息
const statistics = computed(() => getStatistics(timeRange.value));

// 过滤后的活动
const filteredActivities = computed(() => {
  switch (timeRange.value) {
    case 'today':
      return getActivities({ startTime: getTodayStart() });
    case 'week':
      return getActivities({ startTime: getWeekStart() });
    default:
      return activities.value;
  }
});

// 显示的活动（限制数量）
const displayedActivities = computed(() => {
  return showAllActivities.value
    ? filteredActivities.value
    : filteredActivities.value.slice(0, 10);
});

// 笔记活动数量
const noteActivitiesCount = computed(() => {
  return filteredActivities.value.filter(a =>
    [ActivityType.NOTE_CREATE, ActivityType.NOTE_EDIT, ActivityType.NOTE_DELETE].includes(a.type)
  ).length;
});

// 对话活动数量
const chatActivitiesCount = computed(() => {
  return filteredActivities.value.filter(a =>
    [ActivityType.CHAT_START, ActivityType.CHAT_MESSAGE].includes(a.type)
  ).length;
});

// 获取今日开始时间
const getTodayStart = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
};

// 获取本周开始时间
const getWeekStart = () => {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);
  return startOfWeek.getTime();
};

// 获取文件图标
const getFileIcon = (type) => {
  const iconMap = {
    [ActivityType.FILE_OPEN]: FileTextOutlined,
    [ActivityType.FILE_CREATE]: PlusOutlined,
    [ActivityType.NOTE_CREATE]: BookOutlined,
    [ActivityType.NOTE_EDIT]: EditOutlined,
    [ActivityType.PROJECT_OPEN]: FolderOutlined,
  };
  return iconMap[type] || FileOutlined;
};

// 获取活动图标
const getActivityIcon = (type) => {
  const iconMap = {
    [ActivityType.FILE_OPEN]: FileOutlined,
    [ActivityType.FILE_CREATE]: PlusOutlined,
    [ActivityType.FILE_EDIT]: EditOutlined,
    [ActivityType.FILE_DELETE]: DeleteOutlined,
    [ActivityType.NOTE_CREATE]: PlusOutlined,
    [ActivityType.NOTE_EDIT]: EditOutlined,
    [ActivityType.NOTE_DELETE]: DeleteOutlined,
    [ActivityType.CHAT_START]: MessageOutlined,
    [ActivityType.CHAT_MESSAGE]: MessageOutlined,
    [ActivityType.PROJECT_CREATE]: PlusOutlined,
    [ActivityType.PROJECT_OPEN]: FolderOutlined,
    [ActivityType.SEARCH]: SearchOutlined,
    [ActivityType.IMPORT]: CloudUploadOutlined,
    [ActivityType.EXPORT]: CloudDownloadOutlined,
    [ActivityType.SYNC]: SyncOutlined,
    [ActivityType.BACKUP]: SaveOutlined,
  };
  return iconMap[type] || FileOutlined;
};

// 获取活动颜色
const getActivityColor = (type) => {
  const colorMap = {
    [ActivityType.FILE_CREATE]: 'green',
    [ActivityType.FILE_DELETE]: 'red',
    [ActivityType.NOTE_CREATE]: 'green',
    [ActivityType.NOTE_DELETE]: 'red',
    [ActivityType.CHAT_START]: 'blue',
    [ActivityType.PROJECT_CREATE]: 'green',
    [ActivityType.SYNC]: 'purple',
    [ActivityType.BACKUP]: 'orange',
  };
  return colorMap[type] || 'gray';
};

// 格式化时间
const formatTime = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return '刚刚';
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  } else if (diff < 7 * day) {
    return `${Math.floor(diff / day)} 天前`;
  } else {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
};

// 处理文件点击
const handleFileClick = (file) => {
  message.info(`打开文件: ${file.title}`);
  // 实际打开文件的逻辑
};

// 清空最近文件
const handleClearRecentFiles = () => {
  clearRecentFilesAction();
  message.success('已清空最近文件');
};

// 导出活动
const handleExport = () => {
  const data = exportData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `activities-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  message.success('活动数据已导出');
};

// 清空活动
const handleClear = () => {
  clear();
  message.success('已清空所有活动记录');
};
</script>

<style scoped>
.recent-activities {
  max-width: 1200px;
  margin: 0 auto;
}

.activity-stats {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: #262626;
}

.recent-files-section,
.activity-timeline-section {
  margin-bottom: 24px;
}

.recent-files-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recent-file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.recent-file-item:hover {
  background-color: #fafafa;
  border-color: #1890ff;
}

.file-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #1890ff;
  background: #e6f7ff;
  border-radius: 6px;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-title {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #8c8c8c;
}

.file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-timeline {
  margin-top: 16px;
}

.timeline-content {
  padding-bottom: 16px;
}

.timeline-title {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 4px;
}

.timeline-description {
  font-size: 13px;
  color: #595959;
  margin-bottom: 4px;
}

.timeline-time {
  font-size: 12px;
  color: #8c8c8c;
}

.load-more {
  text-align: center;
  margin-top: 16px;
}

.activity-actions {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #f0f0f0;
}
</style>
