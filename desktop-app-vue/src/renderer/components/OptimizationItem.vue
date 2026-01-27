<template>
  <a-card size="small" class="optimization-item" :class="{ 'disabled': !optimization.enabled }">
    <div class="item-header">
      <div class="item-info">
        <div class="item-title">
          <CheckCircleOutlined v-if="optimization.enabled" style="color: #52c41a; margin-right: 8px;" />
          <CloseCircleOutlined v-else style="color: #d9d9d9; margin-right: 8px;" />
          <strong>{{ optimization.name }}</strong>
        </div>
        <div class="item-description">
          {{ optimization.description }}
        </div>
      </div>

      <div class="item-actions">
        <a-space>
          <a-tag :color="impactColor">{{ optimization.impact }}</a-tag>

          <a-button
            v-if="optimization.hasStats"
            size="small"
            type="link"
            @click="$emit('view-stats', optimization.key)"
          >
            <template #icon><LineChartOutlined /></template>
            统计
          </a-button>

          <a-switch
            :checked="optimization.enabled"
            @change="handleToggle"
            size="small"
          />
        </a-space>
      </div>
    </div>
  </a-card>
</template>

<script setup>
import { computed } from 'vue';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LineChartOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  optimization: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['toggle', 'view-stats']);

const impactColor = computed(() => {
  const impact = props.optimization.impact;
  if (impact.includes('+') || impact.includes('fast')) {
    return 'green';
  }
  if (impact.includes('-') || impact.includes('减少')) {
    return 'blue';
  }
  return 'default';
});

function handleToggle(checked) {
  emit('toggle', props.optimization.key, checked);
}
</script>

<style scoped>
.optimization-item {
  transition: all 0.3s;
}

.optimization-item.disabled {
  opacity: 0.6;
}

.optimization-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.item-info {
  flex: 1;
}

.item-title {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
  font-size: 14px;
}

.item-description {
  color: #8c8c8c;
  font-size: 12px;
}

.item-actions {
  display: flex;
  align-items: center;
  margin-left: 16px;
}
</style>
