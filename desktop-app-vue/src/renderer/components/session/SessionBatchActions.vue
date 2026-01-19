<template>
  <transition name="slide-up">
    <div
      v-if="selectedCount > 0"
      class="batch-actions-bar"
    >
      <div class="bar-content">
        <div class="selection-info">
          <CheckCircleOutlined />
          <span>已选择 {{ selectedCount }} 个会话</span>
          <a-button
            type="link"
            size="small"
            @click="$emit('clear-selection')"
          >
            清空选择
          </a-button>
        </div>

        <div class="actions">
          <a-space>
            <a-tooltip title="批量添加标签">
              <a-button @click="$emit('add-tags')">
                <TagsOutlined /> 添加标签
              </a-button>
            </a-tooltip>

            <a-tooltip title="批量导出">
              <a-button @click="$emit('export')">
                <ExportOutlined /> 导出
              </a-button>
            </a-tooltip>

            <a-tooltip title="批量删除">
              <a-button
                danger
                @click="$emit('delete')"
              >
                <DeleteOutlined /> 删除
              </a-button>
            </a-tooltip>
          </a-space>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import {
  CheckCircleOutlined,
  TagsOutlined,
  ExportOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";

defineProps({
  selectedCount: {
    type: Number,
    default: 0,
  },
  allTags: {
    type: Array,
    default: () => [],
  },
});

defineEmits(["delete", "add-tags", "export", "clear-selection"]);
</script>

<style lang="less" scoped>
.batch-actions-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 12px 24px;
  min-width: 500px;

  .bar-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .selection-info {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #1890ff;

    span {
      font-weight: 500;
    }
  }

  .actions {
    display: flex;
    gap: 8px;
  }
}

// 动画
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateX(-50%) translateY(100%);
  opacity: 0;
}

// 响应式
@media (max-width: 768px) {
  .batch-actions-bar {
    left: 16px;
    right: 16px;
    transform: none;
    min-width: auto;

    .bar-content {
      flex-direction: column;
      gap: 12px;
    }
  }

  .slide-up-enter-from,
  .slide-up-leave-to {
    transform: translateY(100%);
  }
}
</style>
