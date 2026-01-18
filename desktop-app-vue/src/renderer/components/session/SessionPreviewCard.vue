<template>
  <div class="session-preview-card">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <a-spin size="small" />
      <span>加载中...</span>
    </div>

    <template v-else>
      <!-- 会话标题 -->
      <div class="preview-header">
        <h4 class="title">{{ session.title || "未命名会话" }}</h4>
        <div class="meta">
          <MessageOutlined />
          <span>{{ messageCount }} 条消息</span>
        </div>
      </div>

      <!-- 摘要 -->
      <div v-if="summary" class="preview-summary">
        <p>{{ summary }}</p>
      </div>

      <!-- 最近消息预览 -->
      <div v-if="recentMessages.length > 0" class="preview-messages">
        <div class="messages-header">
          <ClockCircleOutlined />
          <span>最近对话</span>
        </div>
        <div class="message-list">
          <div
            v-for="(msg, index) in recentMessages"
            :key="index"
            class="message-item"
            :class="msg.role"
          >
            <span class="role-icon">{{ msg.role === "user" ? "Q" : "A" }}</span>
            <span class="content">{{ truncateText(msg.content, 60) }}</span>
          </div>
        </div>
      </div>

      <!-- 标签 -->
      <div v-if="tags.length > 0" class="preview-tags">
        <TagOutlined />
        <a-tag
          v-for="tag in tags.slice(0, 5)"
          :key="tag"
          color="blue"
          size="small"
        >
          {{ tag }}
        </a-tag>
        <span v-if="tags.length > 5" class="more-tags"
          >+{{ tags.length - 5 }}</span
        >
      </div>

      <!-- 时间信息 -->
      <div class="preview-footer">
        <div class="time-info">
          <span class="label">创建:</span>
          <span class="value">{{ formatDate(session.createdAt) }}</span>
        </div>
        <div class="time-info">
          <span class="label">更新:</span>
          <span class="value">{{ formatDate(session.updatedAt) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watchEffect } from "vue";
import {
  MessageOutlined,
  ClockCircleOutlined,
  TagOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

// 计算属性：消息数量
const messageCount = computed(() => {
  if (props.session?.messages) {
    return props.session.messages.length;
  }
  return (
    props.session?.message_count || props.session?.metadata?.messageCount || 0
  );
});

// 计算属性：摘要
const summary = computed(() => {
  const meta = props.session?.metadata || {};
  if (meta.summary) {
    return truncateText(meta.summary, 200);
  }
  // 如果没有摘要，尝试从第一条用户消息生成
  if (props.session?.messages?.length > 0) {
    const firstUserMsg = props.session.messages.find((m) => m.role === "user");
    if (firstUserMsg) {
      const content =
        typeof firstUserMsg.content === "string"
          ? firstUserMsg.content
          : JSON.stringify(firstUserMsg.content);
      return truncateText(content, 200);
    }
  }
  return null;
});

// 计算属性：最近消息
const recentMessages = computed(() => {
  if (!props.session?.messages) return [];

  return props.session.messages.slice(-3).map((msg) => ({
    role: msg.role,
    content:
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content),
  }));
});

// 计算属性：标签
const tags = computed(() => {
  return props.session?.metadata?.tags || props.session?.tags || [];
});

// 工具函数：截断文本
function truncateText(text, maxLength) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

// 工具函数：格式化日期
function formatDate(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<style lang="less" scoped>
.session-preview-card {
  width: 320px;
  max-height: 400px;
  overflow-y: auto;

  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    color: #8c8c8c;
  }

  .preview-header {
    margin-bottom: 12px;

    .title {
      margin: 0 0 4px 0;
      font-size: 14px;
      font-weight: 600;
      color: #1a202c;
      line-height: 1.4;
      word-break: break-word;
    }

    .meta {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #8c8c8c;
    }
  }

  .preview-summary {
    padding: 8px 12px;
    background: #f5f7fa;
    border-radius: 6px;
    margin-bottom: 12px;

    p {
      margin: 0;
      font-size: 12px;
      color: #4a5568;
      line-height: 1.5;
      word-break: break-word;
    }
  }

  .preview-messages {
    margin-bottom: 12px;

    .messages-header {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #8c8c8c;
      margin-bottom: 8px;
    }

    .message-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .message-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;

      &.user {
        background: #e3f2fd;

        .role-icon {
          background: #1890ff;
          color: #fff;
        }
      }

      &.assistant {
        background: #f5f5f5;

        .role-icon {
          background: #52c41a;
          color: #fff;
        }
      }

      .role-icon {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 600;
      }

      .content {
        flex: 1;
        color: #4a5568;
        line-height: 1.4;
        word-break: break-word;
      }
    }
  }

  .preview-tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 12px;
    color: #8c8c8c;

    .anticon {
      font-size: 12px;
    }

    .more-tags {
      font-size: 11px;
      color: #8c8c8c;
    }
  }

  .preview-footer {
    display: flex;
    justify-content: space-between;
    padding-top: 8px;
    border-top: 1px solid #f0f0f0;

    .time-info {
      font-size: 11px;

      .label {
        color: #8c8c8c;
        margin-right: 4px;
      }

      .value {
        color: #4a5568;
      }
    }
  }
}
</style>
