<template>
  <div class="database-performance-page">
    <div class="page-header">
      <h1>
        <DatabaseOutlined />
        数据库性能监控
      </h1>
      <p class="page-description">实时监控数据库性能，优化查询效率</p>
    </div>

    <div class="page-content">
      <!-- 性能概览 -->
      <a-row :gutter="16" class="stats-row">
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="总查询数"
              :value="stats.totalQueries"
              :prefix="h(ThunderboltOutlined)"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="平均查询时间"
              :value="stats.avgQueryTime"
              suffix="ms"
              :precision="2"
              :value-style="{
                color: stats.avgQueryTime > 50 ? '#cf1322' : '#3f8600',
              }"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="慢查询数"
              :value="stats.slowQueries"
              :prefix="h(WarningOutlined)"
              :value-style="{
                color: stats.slowQueries > 0 ? '#cf1322' : '#3f8600',
              }"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="缓存命中率"
              :value="cacheHitRate"
              suffix="%"
              :precision="2"
              :value-style="{
                color: cacheHitRate > 80 ? '#3f8600' : '#cf1322',
              }"
            />
          </a-card>
        </a-col>
      </a-row>

      <!-- 操作按钮 -->
      <a-card title="数据库操作" class="operations-card">
        <a-space>
          <a-button type="primary" :loading="loading" @click="refreshStats">
            <template #icon>
              <ReloadOutlined />
            </template>
            刷新统计
          </a-button>

          <a-button :loading="resetting" @click="resetStats">
            <template #icon>
              <ClearOutlined />
            </template>
            重置统计
          </a-button>

          <a-button :loading="clearingCache" @click="clearCache">
            <template #icon>
              <DeleteOutlined />
            </template>
            清空缓存
          </a-button>

          <a-popconfirm
            title="优化数据库可能需要一些时间，确定要继续吗？"
            @confirm="optimizeDatabase"
          >
            <a-button type="primary" danger :loading="optimizing">
              <template #icon>
                <ToolOutlined />
              </template>
              优化数据库
            </a-button>
          </a-popconfirm>
        </a-space>
      </a-card>

      <!-- 慢查询日志 -->
      <a-card title="慢查询日志" class="slow-queries-card">
        <a-table
          :columns="slowQueryColumns"
          :data-source="slowQueries"
          :pagination="{ pageSize: 10 }"
          :loading="loading"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'sql'">
              <a-tooltip :title="record.sql">
                <code class="sql-preview"
                  >{{ record.sql.substring(0, 100) }}...</code
                >
              </a-tooltip>
            </template>
            <template v-else-if="column.key === 'duration'">
              <a-tag :color="getDurationColor(record.duration)">
                {{ record.duration }}ms
              </a-tag>
            </template>
            <template v-else-if="column.key === 'timestamp'">
              {{ formatTime(record.timestamp) }}
            </template>
          </template>
        </a-table>
      </a-card>

      <!-- 索引建议 -->
      <a-card title="索引优化建议" class="index-suggestions-card">
        <a-alert
          v-if="indexSuggestions.length === 0"
          message="暂无索引建议"
          description="系统会自动分析慢查询并生成索引建议"
          type="success"
          show-icon
        />

        <a-list v-else :data-source="indexSuggestions" item-layout="horizontal">
          <template #renderItem="{ item }">
            <a-list-item>
              <template #actions>
                <a-button
                  type="link"
                  :loading="applyingIndex"
                  @click="applyIndexSuggestion(item)"
                >
                  应用
                </a-button>
              </template>
              <a-list-item-meta>
                <template #title>
                  <a-tag color="blue">
                    {{ item.table }}
                  </a-tag>
                  <a-tag color="green">
                    {{ item.column }}
                  </a-tag>
                </template>
                <template #description>
                  <div>
                    <p>{{ item.reason }}</p>
                    <code class="sql-code">{{ item.sql }}</code>
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>

        <div v-if="indexSuggestions.length > 0" class="apply-all-btn">
          <a-button
            type="primary"
            :loading="applyingAllIndexes"
            @click="applyAllIndexSuggestions"
          >
            应用所有建议
          </a-button>
        </div>
      </a-card>

      <!-- 缓存统计 -->
      <a-card title="查询缓存统计" class="cache-stats-card">
        <a-descriptions :column="2" bordered>
          <a-descriptions-item label="缓存大小">
            {{ stats.cache?.size || 0 }} / {{ stats.cache?.maxSize || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="命中率">
            {{ stats.cache?.hitRate || "0%" }}
          </a-descriptions-item>
          <a-descriptions-item label="命中次数">
            {{ stats.cache?.hits || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="未命中次数">
            {{ stats.cache?.misses || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="驱逐次数">
            {{ stats.cache?.evictions || 0 }}
          </a-descriptions-item>
        </a-descriptions>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted, h } from "vue";
import { message } from "ant-design-vue";
import {
  DatabaseOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  ReloadOutlined,
  ClearOutlined,
  DeleteOutlined,
  ToolOutlined,
} from "@ant-design/icons-vue";

// 状态
const stats = ref({
  totalQueries: 0,
  slowQueries: 0,
  avgQueryTime: 0,
  cache: {
    hits: 0,
    misses: 0,
    hitRate: "0%",
    size: 0,
    maxSize: 0,
    evictions: 0,
  },
});

const slowQueries = ref([]);
const indexSuggestions = ref([]);

const loading = ref(false);
const resetting = ref(false);
const clearingCache = ref(false);
const optimizing = ref(false);
const applyingIndex = ref(false);
const applyingAllIndexes = ref(false);

// 计算属性
const cacheHitRate = computed(() => {
  const hitRate = stats.value.cache?.hitRate || "0%";
  return parseFloat(hitRate);
});

// 慢查询表格列
const slowQueryColumns = [
  {
    title: "SQL语句",
    dataIndex: "sql",
    key: "sql",
    width: "50%",
  },
  {
    title: "执行时间",
    dataIndex: "duration",
    key: "duration",
    width: "15%",
  },
  {
    title: "时间",
    dataIndex: "timestamp",
    key: "timestamp",
    width: "20%",
  },
];

/**
 * 刷新统计信息
 */
const refreshStats = async () => {
  loading.value = true;
  try {
    // 获取性能统计
    const statsResult = await window.electronAPI.dbPerformance.getStats();
    if (statsResult.success) {
      stats.value = statsResult.data;
    }

    // 获取慢查询
    const slowQueriesResult =
      await window.electronAPI.dbPerformance.getSlowQueries(20);
    if (slowQueriesResult.success) {
      slowQueries.value = slowQueriesResult.data;
    }

    // 获取索引建议
    const suggestionsResult =
      await window.electronAPI.dbPerformance.getIndexSuggestions();
    if (suggestionsResult.success) {
      indexSuggestions.value = suggestionsResult.data;
    }

    message.success("统计信息已刷新");
  } catch (error) {
    logger.error("刷新统计失败:", error);
    message.error("刷新统计失败");
  } finally {
    loading.value = false;
  }
};

/**
 * 重置统计信息
 */
const resetStats = async () => {
  resetting.value = true;
  try {
    const result = await window.electronAPI.dbPerformance.resetStats();
    if (result.success) {
      message.success("统计信息已重置");
      await refreshStats();
    } else {
      message.error(result.error || "重置失败");
    }
  } catch (error) {
    logger.error("重置统计失败:", error);
    message.error("重置统计失败");
  } finally {
    resetting.value = false;
  }
};

/**
 * 清空缓存
 */
const clearCache = async () => {
  clearingCache.value = true;
  try {
    const result = await window.electronAPI.dbPerformance.clearCache();
    if (result.success) {
      message.success("缓存已清空");
      await refreshStats();
    } else {
      message.error(result.error || "清空缓存失败");
    }
  } catch (error) {
    logger.error("清空缓存失败:", error);
    message.error("清空缓存失败");
  } finally {
    clearingCache.value = false;
  }
};

/**
 * 优化数据库
 */
const optimizeDatabase = async () => {
  optimizing.value = true;
  try {
    const result = await window.electronAPI.dbPerformance.optimize();
    if (result.success) {
      message.success("数据库优化完成");
      await refreshStats();
    } else {
      message.error(result.error || "优化失败");
    }
  } catch (error) {
    logger.error("优化数据库失败:", error);
    message.error("优化数据库失败");
  } finally {
    optimizing.value = false;
  }
};

/**
 * 应用索引建议
 */
const applyIndexSuggestion = async (suggestion) => {
  applyingIndex.value = true;
  try {
    const result =
      await window.electronAPI.dbPerformance.applyIndexSuggestion(suggestion);
    if (result.success) {
      message.success(`索引已创建: ${suggestion.table}.${suggestion.column}`);
      await refreshStats();
    } else {
      message.error(result.error || "创建索引失败");
    }
  } catch (error) {
    logger.error("应用索引建议失败:", error);
    message.error("应用索引建议失败");
  } finally {
    applyingIndex.value = false;
  }
};

/**
 * 应用所有索引建议
 */
const applyAllIndexSuggestions = async () => {
  applyingAllIndexes.value = true;
  try {
    const result =
      await window.electronAPI.dbPerformance.applyAllIndexSuggestions();
    if (result.success) {
      const successCount = result.data.filter((r) => r.success).length;
      const failCount = result.data.filter((r) => !r.success).length;

      if (failCount === 0) {
        message.success(`成功创建 ${successCount} 个索引`);
      } else {
        message.warning(
          `成功创建 ${successCount} 个索引，失败 ${failCount} 个`,
        );
      }

      await refreshStats();
    } else {
      message.error(result.error || "批量创建索引失败");
    }
  } catch (error) {
    logger.error("应用所有索引建议失败:", error);
    message.error("应用所有索引建议失败");
  } finally {
    applyingAllIndexes.value = false;
  }
};

/**
 * 获取执行时间颜色
 */
const getDurationColor = (duration) => {
  if (duration < 50) {
    return "green";
  }
  if (duration < 100) {
    return "orange";
  }
  return "red";
};

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
};

// 定时刷新
let refreshInterval = null;

// 初始化
onMounted(() => {
  refreshStats();

  // 每30秒自动刷新
  refreshInterval = setInterval(() => {
    refreshStats();
  }, 30000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
});
</script>

<style lang="less" scoped>
.database-performance-page {
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
    .stats-row {
      margin-bottom: 16px;
    }

    .operations-card,
    .slow-queries-card,
    .index-suggestions-card,
    .cache-stats-card {
      margin-bottom: 16px;
    }

    .sql-preview {
      font-family: "Courier New", monospace;
      font-size: 12px;
      background: #f5f5f5;
      padding: 2px 6px;
      border-radius: 3px;
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sql-code {
      display: block;
      font-family: "Courier New", monospace;
      font-size: 12px;
      background: #f5f5f5;
      padding: 8px;
      border-radius: 4px;
      margin-top: 8px;
      overflow-x: auto;
    }

    .apply-all-btn {
      margin-top: 16px;
      text-align: right;
    }
  }
}

:deep(.ant-card) {
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

:deep(.ant-statistic-title) {
  font-size: 14px;
  color: #718096;
}

:deep(.ant-statistic-content) {
  font-size: 24px;
  font-weight: 600;
}
</style>
