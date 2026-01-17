<template>
  <div class="session-detail">
    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="metadata-section">
        <a-skeleton active :paragraph="{ rows: 0 }" />
        <a-skeleton active :title="false" :paragraph="{ rows: 4, width: ['100%', '80%', '60%', '40%'] }" />
      </div>
      <div class="tags-section">
        <a-skeleton active :title="{ width: '80px' }" :paragraph="{ rows: 0 }" />
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <a-skeleton-button active size="small" style="width: 60px" />
          <a-skeleton-button active size="small" style="width: 80px" />
          <a-skeleton-button active size="small" style="width: 50px" />
        </div>
      </div>
      <div class="actions-section">
        <div style="display: flex; gap: 8px;">
          <a-skeleton-button active style="width: 100px" />
          <a-skeleton-button active style="width: 100px" />
          <a-skeleton-button active style="width: 80px" />
        </div>
      </div>
      <div class="messages-section">
        <a-skeleton active :title="{ width: '100px' }" :paragraph="{ rows: 0 }" />
        <div v-for="i in 3" :key="i" style="margin-top: 16px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <a-skeleton-avatar active size="small" />
            <a-skeleton active :title="false" :paragraph="{ rows: 1, width: '60px' }" style="margin: 0;" />
          </div>
          <a-skeleton active :title="false" :paragraph="{ rows: 2, width: ['100%', '80%'] }" />
        </div>
      </div>
    </template>

    <!-- Actual content -->
    <template v-else>
      <!-- 元数据 -->
      <div class="metadata-section">
        <div class="title-row">
          <h3 v-if="!editingTitle" @click="startEditTitle">
            {{ session.title || "未命名会话" }}
            <EditOutlined class="edit-icon" />
          </h3>
          <a-input
            v-else
            v-model:value="editTitle"
            @blur="saveTitle"
            @keyup.enter="saveTitle"
            @keyup.escape="cancelEditTitle"
            ref="titleInput"
            style="width: 100%"
          />
        </div>

        <a-descriptions :column="1" size="small" class="meta-desc">
          <a-descriptions-item label="会话 ID">
            <a-typography-text copyable :content="session.id">
              {{ session.id.substring(0, 20) }}...
            </a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatDate(session.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="更新时间">
            {{ formatDate(session.updated_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="消息数">
            {{ session.message_count || (session.messages || []).length }}
          </a-descriptions-item>
        </a-descriptions>
      </div>

      <!-- 标签 -->
      <div class="tags-section">
        <div class="section-header">
          <span class="section-title"> <TagsOutlined /> 标签 </span>
          <a-button type="link" size="small" @click="showTagModal = true">
            <PlusOutlined /> 添加
          </a-button>
        </div>
        <div class="tags-list">
          <a-tag
            v-for="tag in session.tags || []"
            :key="tag"
            closable
            color="blue"
            @close="$emit('remove-tags', [tag])"
          >
            {{ tag }}
          </a-tag>
          <span
            v-if="!session.tags || session.tags.length === 0"
            class="no-tags"
          >
            暂无标签
          </span>
        </div>
      </div>

      <!-- 摘要 -->
      <div class="summary-section" v-if="session.summary">
        <div class="section-header">
          <span class="section-title"> <FileTextOutlined /> 摘要 </span>
        </div>
        <div class="summary-content">
          {{ session.summary }}
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="actions-section">
        <a-space wrap>
          <a-button type="primary" @click="$emit('resume', session.id)">
            <PlayCircleOutlined /> 恢复对话
          </a-button>
          <a-button @click="$emit('generate-summary', session.id)">
            <FileTextOutlined /> 生成摘要
          </a-button>
          <a-dropdown>
            <a-button>
              <ExportOutlined /> 导出
              <DownOutlined />
            </a-button>
            <template #overlay>
              <a-menu>
                <a-menu-item @click="$emit('export-json', session.id)">
                  <FileOutlined /> 导出 JSON
                </a-menu-item>
                <a-menu-item @click="$emit('export-markdown', session.id)">
                  <FileMarkdownOutlined /> 导出 Markdown
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-button @click="$emit('save-as-template', session.id)">
            <CopyOutlined /> 保存为模板
          </a-button>
        </a-space>
      </div>

      <!-- 消息列表 -->
      <div class="messages-section">
        <div class="section-header">
          <span class="section-title"> <MessageOutlined /> 消息历史 </span>
          <span class="message-count">
            共 {{ (session.messages || []).length }} 条
          </span>
        </div>
        <div class="messages-list">
          <div
            v-for="(msg, index) in session.messages || []"
            :key="index"
            :class="['message-item', msg.role]"
          >
            <div class="message-header">
              <a-avatar
                :style="{
                  backgroundColor: msg.role === 'user' ? '#1890ff' : '#52c41a',
                }"
                size="small"
              >
                {{ msg.role === "user" ? "U" : "A" }}
              </a-avatar>
              <span class="role">{{
                msg.role === "user" ? "用户" : "AI"
              }}</span>
              <span class="time">{{ formatTime(msg.timestamp) }}</span>
            </div>
            <div class="message-content">
              <template v-if="isMessageExpanded(index) || (msg.content || '').length <= 500">
                {{ msg.content }}
              </template>
              <template v-else>
                {{ truncateContent(msg.content, 500) }}
              </template>
              <a-button
                v-if="(msg.content || '').length > 500"
                type="link"
                size="small"
                class="expand-btn"
                @click="toggleMessageExpand(index)"
              >
                {{ isMessageExpanded(index) ? '收起' : '展开全部' }}
                <DownOutlined v-if="!isMessageExpanded(index)" />
                <UpOutlined v-else />
              </a-button>
            </div>
          </div>
          <a-empty
            v-if="!session.messages || session.messages.length === 0"
            description="暂无消息"
          />
        </div>
      </div>
    </template>

    <!-- 添加标签模态框 -->
    <a-modal
      v-model:open="showTagModal"
      title="添加标签"
      @ok="confirmAddTags"
      :confirm-loading="addingTags"
    >
      <TagManager
        v-model:selected-tags="tagsToAdd"
        :all-tags="allTags"
        :mode="'select'"
        :exclude-tags="session.tags || []"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from "vue";
import { message } from "ant-design-vue";
import {
  EditOutlined,
  TagsOutlined,
  PlusOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  ExportOutlined,
  DownOutlined,
  UpOutlined,
  FileOutlined,
  FileMarkdownOutlined,
  CopyOutlined,
  MessageOutlined,
} from "@ant-design/icons-vue";
import TagManager from "./TagManager.vue";

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  allTags: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "add-tags",
  "remove-tags",
  "export-json",
  "export-markdown",
  "save-as-template",
  "generate-summary",
  "resume",
  "update-title",
]);

// 状态
const editingTitle = ref(false);
const editTitle = ref("");
const titleInput = ref(null);
const showTagModal = ref(false);
const tagsToAdd = ref([]);
const addingTags = ref(false);
const expandedMessages = ref(new Set()); // 追踪展开的消息索引

// 监听会话变化
watch(
  () => props.session,
  () => {
    editingTitle.value = false;
    editTitle.value = "";
    tagsToAdd.value = [];
    expandedMessages.value = new Set(); // 重置展开状态
  },
);

// 检查消息是否展开
const isMessageExpanded = (index) => {
  return expandedMessages.value.has(index);
};

// 切换消息展开/收起状态
const toggleMessageExpand = (index) => {
  const newSet = new Set(expandedMessages.value);
  if (newSet.has(index)) {
    newSet.delete(index);
  } else {
    newSet.add(index);
  }
  expandedMessages.value = newSet;
};

// 开始编辑标题
const startEditTitle = () => {
  editTitle.value = props.session.title || "";
  editingTitle.value = true;
  nextTick(() => {
    titleInput.value?.focus();
  });
};

// 保存标题
const saveTitle = () => {
  if (editTitle.value.trim() && editTitle.value !== props.session.title) {
    emit("update-title", props.session.id, editTitle.value.trim());
  }
  editingTitle.value = false;
};

// 取消编辑标题
const cancelEditTitle = () => {
  editingTitle.value = false;
  editTitle.value = "";
};

// 确认添加标签
const confirmAddTags = async () => {
  if (tagsToAdd.value.length === 0) {
    message.warning("请选择至少一个标签");
    return;
  }

  addingTags.value = true;
  try {
    emit("add-tags", tagsToAdd.value);
    showTagModal.value = false;
    tagsToAdd.value = [];
  } finally {
    addingTags.value = false;
  }
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) return "-";

  const date = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return "";

  const date = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

// 截断内容
const truncateContent = (content, maxLength) => {
  if (!content) return "";
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + "...";
};
</script>

<style lang="less" scoped>
.session-detail {
  .metadata-section {
    margin-bottom: 24px;

    .title-row {
      margin-bottom: 16px;

      h3 {
        font-size: 18px;
        font-weight: 600;
        margin: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;

        .edit-icon {
          font-size: 14px;
          color: #8c8c8c;
          opacity: 0;
          transition: opacity 0.2s;
        }

        &:hover .edit-icon {
          opacity: 1;
        }
      }
    }

    .meta-desc {
      background: #fafafa;
      padding: 12px;
      border-radius: 8px;
    }
  }

  .tags-section,
  .summary-section,
  .actions-section,
  .messages-section {
    margin-bottom: 24px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;

    .section-title {
      font-weight: 500;
      color: #1a202c;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .message-count {
      font-size: 12px;
      color: #8c8c8c;
    }
  }

  .tags-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    .no-tags {
      color: #bfbfbf;
      font-size: 12px;
    }
  }

  .summary-content {
    background: #f6f8fa;
    padding: 12px;
    border-radius: 8px;
    font-size: 14px;
    color: #595959;
    line-height: 1.6;
  }

  .messages-list {
    max-height: 400px;
    overflow-y: auto;
    padding-right: 8px;

    .message-item {
      padding: 12px;
      margin-bottom: 12px;
      border-radius: 8px;
      background: #fafafa;

      &.user {
        background: #e6f7ff;
      }

      &.assistant {
        background: #f6ffed;
      }

      .message-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;

        .role {
          font-weight: 500;
          font-size: 12px;
        }

        .time {
          font-size: 11px;
          color: #8c8c8c;
          margin-left: auto;
        }
      }

      .message-content {
        font-size: 14px;
        line-height: 1.6;
        color: #262626;
        white-space: pre-wrap;
        word-break: break-word;
      }
    }
  }
}
</style>
