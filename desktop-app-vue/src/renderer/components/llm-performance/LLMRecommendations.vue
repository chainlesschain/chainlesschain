<template>
  <a-card
    v-if="recommendations.length > 0"
    class="recommendations-card"
    title="成本优化建议"
  >
    <template #extra>
      <a-tag color="blue">
        <BulbOutlined /> 智能分析
      </a-tag>
    </template>
    <a-list
      :data-source="recommendations"
      :loading="loading"
      size="small"
    >
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #avatar>
              <a-avatar
                :style="{
                  backgroundColor: getRecommendationColor(item.priority),
                }"
              >
                <template #icon>
                  <ThunderboltOutlined v-if="item.type === 'model'" />
                  <SettingOutlined v-else-if="item.type === 'cache'" />
                  <CompressOutlined v-else-if="item.type === 'compression'" />
                  <DollarOutlined v-else />
                </template>
              </a-avatar>
            </template>
            <template #title>
              <span>{{ item.title }}</span>
              <a-tag
                v-if="item.savingsPercent"
                color="green"
                style="margin-left: 8px"
              >
                可节省 {{ item.savingsPercent }}%
              </a-tag>
            </template>
            <template #description>
              {{ item.description }}
            </template>
          </a-list-item-meta>
        </a-list-item>
      </template>
    </a-list>
  </a-card>
</template>

<script setup>
import {
  BulbOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  DollarOutlined,
  CompressOutlined,
} from "@ant-design/icons-vue";

defineProps({
  recommendations: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const getRecommendationColor = (priority) => {
  switch (priority) {
    case "high":
      return "#ff4d4f";
    case "medium":
      return "#faad14";
    default:
      return "#1890ff";
  }
};
</script>

<style lang="less" scoped>
.recommendations-card {
  margin-bottom: 16px;
  border-left: 4px solid #1890ff;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}
</style>
