<template>
  <div class="category-tabs-wrapper">
    <a-tabs
      v-model:active-key="activeTab"
      :class="['category-tabs', { 'is-compact': compact }]"
      @change="handleTabChange"
    >
      <a-tab-pane
        v-for="category in categories"
        :key="category.key"
        :tab="category.label"
      >
        <template #tab>
          <span class="tab-label">
            <component
              :is="category.icon"
              v-if="category.icon"
              class="tab-icon"
            />
            {{ category.label }}
            <a-badge
              v-if="category.count !== undefined && showCounts"
              :count="category.count"
              :offset="[8, -2]"
              :number-style="{ backgroundColor: '#1677FF' }"
            />
          </span>
        </template>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import {
  CompassOutlined,
  TeamOutlined,
  ReadOutlined,
  DollarOutlined,
  SmileOutlined,
  ShoppingOutlined,
  CarOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: 'all',
  },
  categories: {
    type: Array,
    default: () => [
      { key: 'all', label: '探索', icon: CompassOutlined },
      { key: 'people', label: '人命相关', icon: TeamOutlined },
      { key: 'education', label: '教育学习', icon: ReadOutlined },
      { key: 'finance', label: '财经分析', icon: DollarOutlined },
      { key: 'life', label: '生活娱乐', icon: SmileOutlined },
      { key: 'marketing', label: '市场营销', icon: ShoppingOutlined },
      { key: 'travel', label: '旅游攻略', icon: CarOutlined },
    ],
  },
  showCounts: {
    type: Boolean,
    default: false,
  },
  compact: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'change']);

const activeTab = ref(props.modelValue);

watch(() => props.modelValue, (newVal) => {
  activeTab.value = newVal;
});

const handleTabChange = (key) => {
  emit('update:modelValue', key);
  emit('change', key);
};
</script>

<style scoped lang="scss">
.category-tabs-wrapper {
  margin-bottom: 24px;
}

.category-tabs {
  :deep(.ant-tabs-nav) {
    margin-bottom: 16px;

    .ant-tabs-tab {
      padding: 8px 16px;
      font-size: 15px;
      color: #666;
      transition: all 0.3s;

      &:hover {
        color: #1677FF;
      }

      &.ant-tabs-tab-active {
        .ant-tabs-tab-btn {
          color: #1677FF;
          font-weight: 600;
        }
      }
    }

    .ant-tabs-ink-bar {
      background: #1677FF;
      height: 3px;
      border-radius: 2px;
    }
  }

  &.is-compact {
    :deep(.ant-tabs-nav) {
      .ant-tabs-tab {
        padding: 6px 12px;
        font-size: 14px;
      }
    }
  }
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;

  .tab-icon {
    font-size: 16px;
  }
}
</style>
