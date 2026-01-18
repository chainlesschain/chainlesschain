<template>
  <a-card title="告警历史" class="alert-history-card">
    <template #extra>
      <a-space>
        <a-select
          v-model:value="filterLevel"
          placeholder="筛选级别"
          style="width: 120px"
          size="small"
          allowClear
        >
          <a-select-option value="warning">警告</a-select-option>
          <a-select-option value="critical">危险</a-select-option>
        </a-select>
        <a-button
          size="small"
          type="link"
          @click="$emit('clear-history')"
          :disabled="!alerts.length"
        >
          清除历史
        </a-button>
      </a-space>
    </template>

    <a-skeleton :loading="loading" active>
      <div v-if="filteredAlerts.length > 0" class="alert-timeline">
        <a-timeline>
          <a-timeline-item
            v-for="alert in filteredAlerts"
            :key="alert.id"
            :color="getAlertColor(alert.level)"
          >
            <template #dot>
              <ExclamationCircleOutlined
                v-if="alert.level === 'critical'"
                style="font-size: 16px"
              />
              <AlertOutlined v-else style="font-size: 16px" />
            </template>
            <div class="alert-item">
              <div class="alert-header">
                <a-tag :color="getAlertColor(alert.level)" size="small">
                  {{ alert.level === "critical" ? "危险" : "警告" }}
                </a-tag>
                <span class="alert-type">{{ alert.type }}</span>
                <span class="alert-time">{{
                  formatTime(alert.timestamp)
                }}</span>
              </div>
              <div class="alert-message">{{ alert.message }}</div>
              <div class="alert-details" v-if="alert.details">
                <a-descriptions size="small" :column="2">
                  <a-descriptions-item label="预算类型">
                    {{ alert.details.budgetType || "-" }}
                  </a-descriptions-item>
                  <a-descriptions-item label="使用率">
                    {{
                      alert.details.percentage
                        ? alert.details.percentage.toFixed(1) + "%"
                        : "-"
                    }}
                  </a-descriptions-item>
                  <a-descriptions-item label="已用">
                    {{
                      alert.details.spent
                        ? "$" + alert.details.spent.toFixed(4)
                        : "-"
                    }}
                  </a-descriptions-item>
                  <a-descriptions-item label="限额">
                    {{
                      alert.details.limit
                        ? "$" + alert.details.limit.toFixed(2)
                        : "-"
                    }}
                  </a-descriptions-item>
                </a-descriptions>
              </div>
              <div class="alert-actions" v-if="!alert.dismissed">
                <a-button
                  size="small"
                  type="link"
                  @click="$emit('dismiss-alert', alert.id)"
                >
                  忽略此告警
                </a-button>
              </div>
              <div class="dismissed-badge" v-else>
                <CheckCircleOutlined /> 已处理
              </div>
            </div>
          </a-timeline-item>
        </a-timeline>

        <a-pagination
          v-if="totalAlerts > pageSize"
          v-model:current="currentPage"
          :total="totalAlerts"
          :page-size="pageSize"
          size="small"
          simple
          class="alert-pagination"
        />
      </div>

      <a-empty
        v-else
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        description="暂无告警历史"
      >
        <template #description>
          <span class="empty-hint">预算超出告警将显示在这里</span>
        </template>
      </a-empty>
    </a-skeleton>
  </a-card>
</template>

<script setup>
import { ref, computed } from "vue";
import { Empty } from "ant-design-vue";
import {
  ExclamationCircleOutlined,
  AlertOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  alerts: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["dismiss-alert", "clear-history"]);

const filterLevel = ref(null);
const currentPage = ref(1);
const pageSize = 10;

const filteredAlerts = computed(() => {
  let filtered = props.alerts;
  if (filterLevel.value) {
    filtered = filtered.filter((a) => a.level === filterLevel.value);
  }
  const start = (currentPage.value - 1) * pageSize;
  return filtered.slice(start, start + pageSize);
});

const totalAlerts = computed(() => {
  if (filterLevel.value) {
    return props.alerts.filter((a) => a.level === filterLevel.value).length;
  }
  return props.alerts.length;
});

const getAlertColor = (level) => {
  return level === "critical" ? "red" : "orange";
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // Less than 1 hour
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes} 分钟前`;
  }

  // Less than 24 hours
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours} 小时前`;
  }

  // Less than 7 days
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days} 天前`;
  }

  // Format as date
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
</script>

<style lang="less" scoped>
.alert-history-card {
  margin-bottom: 16px;

  .alert-timeline {
    max-height: 400px;
    overflow-y: auto;
    padding-right: 8px;

    // Custom scrollbar
    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-track {
      background: #f0f0f0;
      border-radius: 3px;
    }

    &::-webkit-scrollbar-thumb {
      background: #d9d9d9;
      border-radius: 3px;

      &:hover {
        background: #bfbfbf;
      }
    }
  }

  .alert-item {
    .alert-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;

      .alert-type {
        font-weight: 500;
        color: #262626;
      }

      .alert-time {
        margin-left: auto;
        font-size: 12px;
        color: #8c8c8c;
      }
    }

    .alert-message {
      color: #595959;
      font-size: 13px;
      margin-bottom: 8px;
    }

    .alert-details {
      background: #fafafa;
      padding: 8px 12px;
      border-radius: 6px;
      margin-bottom: 8px;

      :deep(.ant-descriptions-item-label) {
        font-size: 12px;
        color: #8c8c8c;
      }

      :deep(.ant-descriptions-item-content) {
        font-size: 12px;
        color: #262626;
      }
    }

    .alert-actions {
      margin-top: 4px;
    }

    .dismissed-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #52c41a;
      margin-top: 4px;
    }
  }

  .alert-pagination {
    margin-top: 16px;
    text-align: center;
  }

  .empty-hint {
    color: #bfbfbf;
    font-size: 13px;
  }
}

// Mobile responsiveness
@media (max-width: 767px) {
  .alert-history-card {
    .alert-item {
      .alert-header {
        flex-wrap: wrap;

        .alert-time {
          width: 100%;
          margin-left: 0;
          margin-top: 4px;
        }
      }

      .alert-details {
        :deep(.ant-descriptions) {
          .ant-descriptions-item {
            padding-bottom: 4px;
          }
        }
      }
    }
  }
}
</style>
