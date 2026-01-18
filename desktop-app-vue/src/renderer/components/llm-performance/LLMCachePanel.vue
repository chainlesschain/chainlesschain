<template>
  <a-card title="响应缓存详情" class="cache-panel">
    <template #extra>
      <a-tag color="blue"> <DatabaseOutlined /> 缓存系统 </a-tag>
    </template>
    <a-skeleton :loading="loading" active>
      <div class="cache-stats-grid">
        <a-statistic
          title="缓存条目"
          :value="stats.totalEntries"
          :value-style="{ fontSize: '20px' }"
        />
        <a-statistic
          title="总命中次数"
          :value="stats.totalHits"
          :value-style="{ fontSize: '20px', color: '#3f8600' }"
        />
        <a-statistic
          title="命中率"
          :value="stats.hitRate"
          suffix="%"
          :precision="1"
          :value-style="{
            fontSize: '20px',
            color: stats.hitRate > 50 ? '#3f8600' : '#cf1322',
          }"
        />
        <a-statistic
          title="节省 Tokens"
          :value="stats.totalTokensSaved"
          :formatter="formatTokens"
          :value-style="{ fontSize: '20px' }"
        />
        <a-statistic
          title="节省成本"
          :value="stats.totalCostSaved"
          prefix="$"
          :precision="4"
          :value-style="{ fontSize: '20px', color: '#52c41a' }"
        />
        <a-statistic
          title="平均命中/条目"
          :value="stats.avgHitsPerEntry"
          :precision="1"
          :value-style="{ fontSize: '20px' }"
        />
      </div>
      <a-divider style="margin: 16px 0" />
      <div class="cache-info">
        <a-space>
          <span>过期条目: {{ stats.expiredEntries }}</span>
          <a-button
            size="small"
            type="link"
            @click="$emit('clear-cache')"
            :loading="clearing"
          >
            清理过期缓存
          </a-button>
        </a-space>
      </div>
    </a-skeleton>
  </a-card>
</template>

<script setup>
import { DatabaseOutlined } from "@ant-design/icons-vue";

defineProps({
  stats: {
    type: Object,
    default: () => ({
      totalEntries: 0,
      expiredEntries: 0,
      totalHits: 0,
      totalTokensSaved: 0,
      totalCostSaved: 0,
      avgHitsPerEntry: 0,
      hitRate: 0,
    }),
  },
  loading: {
    type: Boolean,
    default: false,
  },
  clearing: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["clear-cache"]);

const formatTokens = (value) => {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(2) + "M";
  } else if (value >= 1000) {
    return (value / 1000).toFixed(2) + "K";
  }
  return value.toString();
};
</script>

<style lang="less" scoped>
.cache-panel {
  height: 100%;

  .cache-stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .cache-info {
    font-size: 13px;
    color: #8c8c8c;
  }
}

// Mobile responsiveness
@media (max-width: 767px) {
  .cache-panel {
    .cache-stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
}
</style>
