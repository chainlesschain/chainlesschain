<template>
  <div
    class="template-card"
    @click="handleCardClick"
  >
    <!-- 封面图或占位符 -->
    <div class="card-cover">
      <img
        v-if="template.cover_image && template.cover_image.startsWith('http')"
        :src="template.cover_image"
        :alt="template.display_name"
        loading="lazy"
        @error="handleImageError"
      >
      <div
        v-else
        class="placeholder-icon"
      >
        <span class="icon-emoji">{{ template.icon || '📄' }}</span>
      </div>
    </div>

    <!-- 卡片内容 -->
    <div class="card-content">
      <h4 class="card-title">
        {{ template.display_name }}
      </h4>
      <p class="card-description">
        {{ truncatedDescription }}
      </p>

      <!-- 元数据 -->
      <div class="card-meta">
        <span
          class="usage-count"
          :title="`${template.usage_count || 0}次使用`"
        >
          <FireOutlined />
          {{ formatUsageCount(template.usage_count) }}
        </span>
        <span
          v-if="template.rating && template.rating > 0"
          class="rating"
          :title="`评分 ${template.rating.toFixed(1)}`"
        >
          <StarFilled />
          {{ template.rating.toFixed(1) }}
        </span>
      </div>

      <!-- 操作按钮 -->
      <a-button
        type="primary"
        class="use-btn"
        @click.stop="handleUse"
      >
        使用模板
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { FireOutlined, StarFilled } from '@ant-design/icons-vue'

const props = defineProps({
  template: {
    type: Object,
    required: true
  },
  compact: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['use', 'click'])

const imageError = ref(false)

const truncatedDescription = computed(() => {
  const desc = props.template.description || ''
  const maxLength = props.compact ? 60 : 80
  if (desc.length > maxLength) {
    return desc.substring(0, maxLength) + '...'
  }
  return desc
})

function formatUsageCount(count) {
  if (!count || count === 0) {return '0'}
  if (count >= 1000) {return (count / 1000).toFixed(1) + 'k'}
  return count.toString()
}

function handleCardClick() {
  emit('click', props.template)
}

function handleUse() {
  emit('use', props.template)
}

function handleImageError() {
  imageError.value = true
}
</script>

<style lang="scss" scoped>
.template-card {
  position: relative;
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  height: 100%;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.25);

    .card-cover {
      .placeholder-icon {
        background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
      }
    }

    .use-btn {
      opacity: 1;
    }
  }

  .card-cover {
    width: 100%;
    height: 150px;
    overflow: hidden;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .placeholder-icon {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      transition: background 0.3s ease;

      .icon-emoji {
        font-size: 48px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
      }
    }
  }

  .card-content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    flex-grow: 1;

    .card-title {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 600;
      color: #1d1d1f;
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .card-description {
      margin: 0 0 12px 0;
      font-size: 13px;
      color: #6e6e73;
      line-height: 1.5;
      flex-grow: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .card-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
      font-size: 12px;
      color: #86868b;

      .usage-count,
      .rating {
        display: flex;
        align-items: center;
        gap: 4px;

        :deep(.anticon) {
          font-size: 14px;
        }
      }

      .usage-count {
        color: #ff6b6b;

        :deep(.anticon) {
          color: #ff6b6b;
        }
      }

      .rating {
        color: #ffd93d;

        :deep(.anticon) {
          color: #ffd93d;
        }
      }
    }

    .use-btn {
      width: 100%;
      border-radius: 8px;
      font-weight: 500;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      opacity: 0.9;
      transition: opacity 0.3s ease;

      &:hover {
        opacity: 1;
        background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
      }
    }
  }
}

.template-card.compact {
  .card-cover {
    height: 120px;
  }

  .card-content {
    padding: 12px;

    .card-title {
      font-size: 14px;
      -webkit-line-clamp: 1;
    }

    .card-description {
      font-size: 12px;
      -webkit-line-clamp: 1;
    }

    .card-meta {
      margin-bottom: 8px;
      font-size: 11px;
    }
  }
}
</style>
