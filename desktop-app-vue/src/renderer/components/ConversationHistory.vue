<template>
  <div class="conversation-history">
    <a-input-search
      v-model:value="searchQuery"
      placeholder="搜索对话..."
      style="margin-bottom: 16px"
    />

    <a-list
      :data-source="filteredConversations"
      :loading="loading"
      size="small"
    >
      <template #renderItem="{ item }">
        <a-list-item
          class="conversation-item"
          :class="{ active: item.id === currentConversationId }"
          @click="handleSelect(item)"
        >
          <a-list-item-meta>
            <template #title>
              <div class="conversation-title">
                {{ item.title }}
              </div>
            </template>
            <template #description>
              <div class="conversation-info">
                <span>{{ item.messages?.length || 0 }} 条消息</span>
                <span class="conversation-time">
                  {{ formatDate(item.updated_at || item.created_at) }}
                </span>
              </div>
            </template>
          </a-list-item-meta>
          <template #actions>
            <a-dropdown :trigger="['click']">
              <a-button type="text" size="small" @click.stop>
                <more-outlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item @click="handleRename(item)">
                    <edit-outlined /> 重命名
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item danger @click="handleDelete(item)">
                    <delete-outlined /> 删除
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </template>
        </a-list-item>
      </template>

      <template #loadMore>
        <div
          v-if="hasMore"
          style="text-align: center; margin-top: 12px"
        >
          <a-button size="small" @click="loadMore">
            加载更多
          </a-button>
        </div>
      </template>
    </a-list>

    <!-- 重命名对话框 -->
    <a-modal
      v-model:open="showRenameModal"
      title="重命名对话"
      @ok="handleRenameConfirm"
    >
      <a-input
        v-model:value="renameTitle"
        placeholder="输入新标题"
        @keydown.enter="handleRenameConfirm"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { useConversationStore } from '../stores/conversation';

const emit = defineEmits(['select']);

const conversationStore = useConversationStore();

// 状态
const searchQuery = ref('');
const loading = ref(false);
const hasMore = ref(false);
const showRenameModal = ref(false);
const renameTitle = ref('');
const renamingConversation = ref(null);
const currentPage = ref(1);
const pageSize = ref(20);

// 当前对话ID
const currentConversationId = computed(() => conversationStore.currentConversation?.id);

// 过滤后的对话列表
const filteredConversations = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  if (!query) {
    return conversationStore.conversations;
  }

  return conversationStore.conversations.filter((conv) =>
    conv.title.toLowerCase().includes(query)
  );
});

// 检查是否还有更多数据
const checkHasMore = () => {
  const total = conversationStore.pagination.total;
  const loaded = conversationStore.conversations.length;
  hasMore.value = loaded < total;
};

// 组件挂载时初始化
onMounted(() => {
  checkHasMore();
});

// 选择对话
const handleSelect = (conversation) => {
  emit('select', conversation);
};

// 重命名
const handleRename = (conversation) => {
  renamingConversation.value = conversation;
  renameTitle.value = conversation.title;
  showRenameModal.value = true;
};

// 确认重命名
const handleRenameConfirm = async () => {
  if (!renameTitle.value.trim()) {
    message.warning('请输入标题');
    return;
  }

  try {
    await conversationStore.updateConversation(
      renamingConversation.value.id,
      { title: renameTitle.value.trim() }
    );
    message.success('重命名成功');
    showRenameModal.value = false;
  } catch (error) {
    console.error('[ConversationHistory] 重命名失败:', error);

    let errorMessage = '重命名失败';
    if (error.message) {
      if (error.message.includes('not found')) {
        errorMessage = '对话不存在';
      } else if (error.message.includes('database')) {
        errorMessage = '数据库错误，请重试';
      } else {
        errorMessage = `重命名失败: ${error.message}`;
      }
    }

    message.error(errorMessage);
  }
};

// 删除
const handleDelete = (conversation) => {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除对话"${conversation.title}"吗？此操作不可恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await conversationStore.deleteConversation(conversation.id);
        message.success('删除成功');

        // 重新检查是否还有更多数据
        checkHasMore();
      } catch (error) {
        console.error('[ConversationHistory] 删除失败:', error);

        let errorMessage = '删除失败';
        if (error.message) {
          if (error.message.includes('not found')) {
            errorMessage = '对话不存在';
          } else if (error.message.includes('database')) {
            errorMessage = '数据库错误，请重试';
          } else {
            errorMessage = `删除失败: ${error.message}`;
          }
        }

        message.error(errorMessage);
      }
    },
  });
};

// 加载更多
const loadMore = async () => {
  if (loading.value || !hasMore.value) {
    return;
  }

  loading.value = true;

  try {
    const offset = conversationStore.conversations.length;
    await conversationStore.loadConversations(offset, pageSize.value);

    // 更新分页状态
    currentPage.value++;
    checkHasMore();

    message.success(`已加载 ${conversationStore.conversations.length} 条对话`);
  } catch (error) {
    console.error('[ConversationHistory] 加载更多失败:', error);

    // 提供友好的错误消息
    let errorMessage = '加载失败';
    if (error.message) {
      if (error.message.includes('database')) {
        errorMessage = '数据库错误，请重试';
      } else if (error.message.includes('timeout')) {
        errorMessage = '加载超时，请重试';
      } else {
        errorMessage = `加载失败: ${error.message}`;
      }
    }

    message.error(errorMessage);
  } finally {
    loading.value = false;
  }
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 86400000) {
    // 今天
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } else if (diff < 172800000) {
    // 昨天
    return '昨天 ' + date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } else if (diff < 604800000) {
    // 本周
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[date.getDay()];
  } else {
    // 更早
    return date.toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    });
  }
};
</script>

<style scoped>
.conversation-history {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.conversation-item {
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.3s;
  padding: 8px !important;
}

.conversation-item:hover {
  background-color: #f5f5f5;
}

.conversation-item.active {
  background-color: #e6f7ff;
}

.conversation-title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.conversation-time {
  color: rgba(0, 0, 0, 0.35);
}
</style>
