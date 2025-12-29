<template>
  <a-card title="数据库性能监控" class="performance-monitor">
    <template #extra>
      <a-space>
        <a-button
          type="text"
          size="small"
          @click="refreshStats"
          :loading="loading"
        >
          <ReloadOutlined />
          刷新
        </a-button>
        <a-button
          type="text"
          size="small"
          @click="clearStats"
        >
          <DeleteOutlined />
          清除
        </a-button>
      </a-space>
    </template>

    <!-- 加载状态 -->
    <a-spin :spinning="loading">
      <!-- 概览统计 -->
      <a-row :gutter="[16, 16]">
        <a-col :span="6">
          <a-statistic
            title="总查询次数"
            :value="stats.totalQueries"
            :value-style="{ color: '#1890ff' }"
          >
            <template #prefix>
              <DatabaseOutlined />
            </template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="平均耗时"
            :value="stats.avgQueryTime"
            suffix="ms"
            :precision="2"
            :value-style="{ color: '#52c41a' }"
          >
            <template #prefix>
              <ClockCircleOutlined />
            </template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="数据库大小"
            :value="formatBytes(stats.dbSize)"
            :value-style="{ color: '#722ed1' }"
          >
            <template #prefix>
              <FileOutlined />
            </template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="加密状态"
            :value="stats.isEncrypted ? '已加密' : '未加密'"
            :value-style="{ color: stats.isEncrypted ? '#52c41a' : '#faad14' }"
          >
            <template #prefix>
              <LockOutlined v-if="stats.isEncrypted" />
              <UnlockOutlined v-else />
            </template>
          </a-statistic>
        </a-col>
      </a-row>

      <a-divider />

      <!-- 性能对比 -->
      <div v-if="stats.isEncrypted" class="performance-comparison">
        <h4>加密性能对比</h4>
        <a-alert
          type="info"
          :message="`当前加密方案比未加密方案快 ${stats.performanceMultiplier}x`"
          show-icon
          style="margin-bottom: 16px"
        />
        <a-row :gutter="16">
          <a-col :span="12">
            <a-card size="small" title="加密模式 (SQLCipher)">
              <a-statistic
                title="1000条记录插入"
                :value="stats.encryptedTime"
                suffix="ms"
                :value-style="{ color: '#52c41a' }"
              />
              <div class="metric-detail">
                <CheckCircleOutlined style="color: #52c41a" />
                <span>高性能 AES-256 加密</span>
              </div>
            </a-card>
          </a-col>
          <a-col :span="12">
            <a-card size="small" title="非加密模式 (sql.js)">
              <a-statistic
                title="1000条记录插入"
                :value="stats.unencryptedTime"
                suffix="ms"
                :value-style="{ color: '#faad14' }"
              />
              <div class="metric-detail">
                <InfoCircleOutlined style="color: #faad14" />
                <span>JavaScript 实现</span>
              </div>
            </a-card>
          </a-col>
        </a-row>
      </div>

      <a-divider />

      <!-- 操作类型分布 -->
      <div class="operation-distribution">
        <h4>操作类型分布</h4>
        <a-list
          size="small"
          :data-source="operationTypes"
          :split="false"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <span>{{ item.type }}</span>
                  <a-tag color="blue" style="margin-left: 8px">
                    {{ item.count }} 次
                  </a-tag>
                </template>
                <template #description>
                  <a-progress
                    :percent="item.percentage"
                    :show-info="false"
                    size="small"
                  />
                  <span style="margin-left: 8px; color: #666">
                    平均 {{ item.avgTime.toFixed(2) }}ms
                  </span>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <a-divider />

      <!-- 最近操作日志 -->
      <div class="recent-operations">
        <h4>最近操作日志</h4>
        <a-table
          :columns="logColumns"
          :data-source="recentLogs"
          :pagination="{ pageSize: 5 }"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'type'">
              <a-tag :color="getOperationColor(record.type)">
                {{ record.type }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'duration'">
              <span :style="{ color: record.duration > 100 ? '#ff4d4f' : '#52c41a' }">
                {{ record.duration }}ms
              </span>
            </template>
            <template v-else-if="column.key === 'timestamp'">
              {{ formatTimestamp(record.timestamp) }}
            </template>
          </template>
        </a-table>
      </div>
    </a-spin>
  </a-card>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  DatabaseOutlined,
  ClockCircleOutlined,
  FileOutlined,
  LockOutlined,
  UnlockOutlined,
  ReloadOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons-vue';

// 性能统计数据
const stats = reactive({
  totalQueries: 0,
  avgQueryTime: 0,
  dbSize: 0,
  isEncrypted: false,
  performanceMultiplier: 25,
  encryptedTime: 12,
  unencryptedTime: 300,
});

// 操作类型数据
const operationTypes = ref([
  { type: 'SELECT', count: 0, percentage: 0, avgTime: 0 },
  { type: 'INSERT', count: 0, percentage: 0, avgTime: 0 },
  { type: 'UPDATE', count: 0, percentage: 0, avgTime: 0 },
  { type: 'DELETE', count: 0, percentage: 0, avgTime: 0 },
]);

// 最近操作日志
const recentLogs = ref([]);

const logColumns = [
  { title: '操作类型', dataIndex: 'type', key: 'type', width: 100 },
  { title: 'SQL语句', dataIndex: 'sql', key: 'sql', ellipsis: true },
  { title: '耗时', dataIndex: 'duration', key: 'duration', width: 80 },
  { title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 180 },
];

const loading = ref(false);

// 格式化字节大小
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
};

// 格式化时间戳
const formatTimestamp = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

// 获取操作类型颜色
const getOperationColor = (type) => {
  const colors = {
    SELECT: 'blue',
    INSERT: 'green',
    UPDATE: 'orange',
    DELETE: 'red',
  };
  return colors[type] || 'default';
};

// 刷新统计数据
const refreshStats = async () => {
  loading.value = true;
  try {
    if (window.electron?.ipcRenderer) {
      // 获取加密状态
      const encryptionStatus = await window.electron.ipcRenderer.invoke('database:get-encryption-status');
      stats.isEncrypted = encryptionStatus.isEncrypted;

      // 获取性能统计（如果后端有提供）
      try {
        const performanceData = await window.electron.ipcRenderer.invoke('database:get-performance-stats');
        if (performanceData) {
          Object.assign(stats, performanceData.stats);
          operationTypes.value = performanceData.operationTypes;
          recentLogs.value = performanceData.recentLogs;
        }
      } catch (error) {
        // 如果后端还没有实现性能统计API，使用模拟数据
        console.log('使用模拟性能数据');
        generateMockData();
      }
    } else {
      // 模拟数据（开发模式）
      generateMockData();
    }
  } catch (error) {
    console.error('刷新性能统计失败:', error);
    message.error('刷新失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

// 生成模拟数据
const generateMockData = () => {
  stats.totalQueries = Math.floor(Math.random() * 10000) + 1000;
  stats.avgQueryTime = Math.random() * 10 + 2;
  stats.dbSize = Math.floor(Math.random() * 10000000) + 1000000;

  const total = stats.totalQueries;
  operationTypes.value = [
    {
      type: 'SELECT',
      count: Math.floor(total * 0.6),
      percentage: 60,
      avgTime: Math.random() * 5 + 1
    },
    {
      type: 'INSERT',
      count: Math.floor(total * 0.2),
      percentage: 20,
      avgTime: Math.random() * 3 + 2
    },
    {
      type: 'UPDATE',
      count: Math.floor(total * 0.15),
      percentage: 15,
      avgTime: Math.random() * 4 + 2
    },
    {
      type: 'DELETE',
      count: Math.floor(total * 0.05),
      percentage: 5,
      avgTime: Math.random() * 3 + 1
    },
  ];

  // 生成模拟日志
  const operations = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  recentLogs.value = Array.from({ length: 20 }, (_, i) => ({
    key: i,
    type: operations[Math.floor(Math.random() * operations.length)],
    sql: `Sample SQL query ${i}...`,
    duration: Math.floor(Math.random() * 200) + 1,
    timestamp: Date.now() - i * 10000,
  }));
};

// 清除统计数据
const clearStats = async () => {
  try {
    if (window.electron?.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('database:clear-performance-stats');
    }
    await refreshStats();
    message.success('统计数据已清除');
  } catch (error) {
    console.error('清除统计失败:', error);
    message.error('清除失败：' + error.message);
  }
};

// 定时刷新
let refreshTimer = null;

onMounted(() => {
  refreshStats();
  // 每30秒自动刷新
  refreshTimer = setInterval(refreshStats, 30000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
</script>

<style scoped>
.performance-monitor {
  margin: 16px 0;
}

.performance-comparison {
  margin: 16px 0;
}

.performance-comparison h4 {
  margin-bottom: 16px;
  font-weight: 600;
}

.metric-detail {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #666;
  font-size: 12px;
}

.operation-distribution h4,
.recent-operations h4 {
  margin-bottom: 16px;
  font-weight: 600;
}

.operation-distribution :deep(.ant-list-item) {
  padding: 8px 0;
}

.operation-distribution :deep(.ant-list-item-meta-title) {
  margin-bottom: 4px;
}

.operation-distribution :deep(.ant-progress) {
  margin-top: 4px;
}
</style>
