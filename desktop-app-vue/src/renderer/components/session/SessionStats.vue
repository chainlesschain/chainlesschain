<template>
  <a-row :gutter="[16, 16]" class="session-stats">
    <a-col :xs="12" :sm="12" :md="6" :lg="6">
      <a-card class="stat-card" hoverable>
        <a-skeleton :loading="loading" active :paragraph="{ rows: 1 }">
          <a-statistic
            title="总会话数"
            :value="stats.totalSessions"
            :prefix="h(MessageOutlined)"
          />
        </a-skeleton>
      </a-card>
    </a-col>
    <a-col :xs="12" :sm="12" :md="6" :lg="6">
      <a-card class="stat-card" hoverable>
        <a-skeleton :loading="loading" active :paragraph="{ rows: 1 }">
          <a-statistic
            title="总消息数"
            :value="stats.totalMessages"
            :prefix="h(CommentOutlined)"
          />
        </a-skeleton>
      </a-card>
    </a-col>
    <a-col :xs="12" :sm="12" :md="6" :lg="6">
      <a-card class="stat-card" hoverable>
        <a-skeleton :loading="loading" active :paragraph="{ rows: 1 }">
          <a-statistic
            title="节省 Tokens"
            :value="stats.totalTokensSaved"
            :prefix="h(ThunderboltOutlined)"
            :formatter="formatNumber"
            :value-style="{ color: '#52c41a' }"
          />
        </a-skeleton>
      </a-card>
    </a-col>
    <a-col :xs="12" :sm="12" :md="6" :lg="6">
      <a-card class="stat-card" hoverable>
        <a-skeleton :loading="loading" active :paragraph="{ rows: 1 }">
          <a-statistic
            title="标签数"
            :value="stats.uniqueTags"
            :prefix="h(TagsOutlined)"
          />
        </a-skeleton>
      </a-card>
    </a-col>
  </a-row>
</template>

<script setup>
import { h } from "vue";
import {
  MessageOutlined,
  CommentOutlined,
  ThunderboltOutlined,
  TagsOutlined,
} from "@ant-design/icons-vue";

defineProps({
  stats: {
    type: Object,
    default: () => ({
      totalSessions: 0,
      totalMessages: 0,
      totalTokensSaved: 0,
      uniqueTags: 0,
    }),
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

/**
 * 格式化数字
 */
const formatNumber = (value) => {
  const num = value?.value || value;
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K";
  }
  return num;
};
</script>

<style lang="less" scoped>
.session-stats {
  .stat-card {
    transition: all 0.3s ease;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
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
