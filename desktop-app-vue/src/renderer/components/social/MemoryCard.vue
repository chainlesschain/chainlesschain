<template>
  <a-card
    hoverable
    class="memory-card"
    :class="{ 'memory-unread': !isRead }"
    @click="handleClick"
  >
    <!-- Cover image -->
    <template v-if="memory.cover_image" #cover>
      <div class="memory-cover">
        <img
          :src="memory.cover_image"
          :alt="memory.title"
          class="cover-image"
        />
        <div class="cover-overlay">
          <a-tag :color="typeColor" class="memory-type-tag">
            {{ typeLabel }}
          </a-tag>
        </div>
      </div>
    </template>

    <template #title>
      <div class="memory-title-row">
        <span class="memory-title">{{ memory.title }}</span>
        <a-badge
          v-if="!isRead"
          status="processing"
          class="unread-indicator"
        />
      </div>
    </template>

    <template #extra>
      <a-tag :color="typeColor" size="small">
        {{ typeLabel }}
      </a-tag>
    </template>

    <!-- Description -->
    <p class="memory-description">
      {{ memory.description || "No description available." }}
    </p>

    <!-- Footer with meta info -->
    <div class="memory-footer">
      <div class="memory-meta">
        <ClockCircleOutlined />
        <span class="memory-date">{{ formattedDate }}</span>
      </div>
      <div class="memory-actions">
        <a-button
          v-if="!isRead"
          type="link"
          size="small"
          @click.stop="handleMarkRead"
        >
          <CheckOutlined />
          Mark as read
        </a-button>
        <a-button type="link" size="small" @click.stop="handleShare">
          <ShareAltOutlined />
          Share
        </a-button>
      </div>
    </div>

    <!-- Related posts indicator -->
    <div
      v-if="memory.related_posts && memory.related_posts.length > 0"
      class="related-posts"
    >
      <LinkOutlined />
      <span>{{ memory.related_posts.length }} related post(s)</span>
    </div>
  </a-card>
</template>

<script setup>
import { computed } from "vue";
import { message } from "ant-design-vue";
import {
  ClockCircleOutlined,
  CheckOutlined,
  ShareAltOutlined,
  LinkOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  memory: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["mark-read"]);

// Computed
const isRead = computed(() => {
  return props.memory.is_read === 1;
});

const typeLabel = computed(() => {
  const labels = {
    on_this_day: "On This Day",
    milestone: "Milestone",
    annual_report: "Annual Report",
    throwback: "Throwback",
  };
  return labels[props.memory.memory_type] || props.memory.memory_type;
});

const typeColor = computed(() => {
  const colors = {
    on_this_day: "blue",
    milestone: "gold",
    annual_report: "green",
    throwback: "purple",
  };
  return colors[props.memory.memory_type] || "default";
});

const formattedDate = computed(() => {
  if (!props.memory.generated_at) return "";
  const date = new Date(props.memory.generated_at);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
});

// Methods
function handleClick() {
  if (!isRead.value) {
    handleMarkRead();
  }
}

function handleMarkRead() {
  emit("mark-read", props.memory.id);
}

function handleShare() {
  message.info("Share feature coming soon");
}
</script>

<style scoped>
.memory-card {
  border-radius: 12px;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  overflow: hidden;
}

.memory-card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.1),
    0 2px 4px rgba(0, 0, 0, 0.06);
}

.memory-unread {
  border-left: 3px solid #1890ff;
}

.memory-cover {
  position: relative;
  height: 160px;
  overflow: hidden;
}

.cover-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-overlay {
  position: absolute;
  bottom: 8px;
  left: 8px;
}

.memory-type-tag {
  font-size: 11px;
}

.memory-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.memory-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.unread-indicator {
  flex-shrink: 0;
}

.memory-description {
  color: rgba(0, 0, 0, 0.65);
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.memory-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.memory-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.memory-date {
  font-size: 12px;
}

.memory-actions {
  display: flex;
  gap: 4px;
}

.related-posts {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
