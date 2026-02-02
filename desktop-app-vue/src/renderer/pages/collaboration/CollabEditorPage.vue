<template>
  <div class="collab-editor-page">
    <a-page-header
      title="协作编辑器"
      :sub-title="documentName"
      @back="goBack"
    >
      <template #extra>
        <a-space>
          <a-badge :count="unresolvedCommentCount" :offset="[-5, 5]">
            <a-button @click="showComments = true">
              <template #icon><CommentOutlined /></template>
              评论
            </a-button>
          </a-badge>
          <a-button @click="showHistory = true">
            <template #icon><HistoryOutlined /></template>
            历史
          </a-button>
          <a-avatar-group :max-count="5">
            <a-tooltip v-for="user in collaborators" :key="user.did" :title="user.name">
              <a-avatar :style="{ backgroundColor: user.color }">
                {{ user.name?.charAt(0) }}
              </a-avatar>
            </a-tooltip>
          </a-avatar-group>
        </a-space>
      </template>
    </a-page-header>

    <div class="editor-container">
      <a-spin :spinning="loading" tip="加载文档中...">
        <div class="editor-content">
          <!-- 编辑器内容区域 -->
          <div v-if="currentDocument" class="document-editor">
            <a-textarea
              v-model:value="documentContent"
              :auto-size="{ minRows: 20 }"
              placeholder="开始编辑..."
              @change="handleContentChange"
            />
          </div>
          <a-empty v-else description="文档加载中..." />
        </div>
      </a-spin>
    </div>

    <!-- 评论抽屉 -->
    <a-drawer
      v-model:open="showComments"
      title="评论"
      placement="right"
      :width="400"
    >
      <a-list
        :data-source="comments"
        :loading="loadingComments"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-comment
              :author="item.authorName"
              :content="item.content"
              :datetime="formatTime(item.createdAt)"
            >
              <template #actions>
                <a-button v-if="!item.resolved" type="link" size="small" @click="resolveComment(item.id)">
                  标记已解决
                </a-button>
                <a-tag v-else color="green">已解决</a-tag>
              </template>
            </a-comment>
          </a-list-item>
        </template>
      </a-list>
    </a-drawer>

    <!-- 版本历史抽屉 -->
    <a-drawer
      v-model:open="showHistory"
      title="版本历史"
      placement="right"
      :width="400"
    >
      <a-timeline>
        <a-timeline-item v-for="version in versionHistory" :key="version.id">
          <p><strong>{{ version.editorName }}</strong></p>
          <p>{{ formatTime(version.createdAt) }}</p>
          <a-button type="link" size="small" @click="restoreVersion(version.id)">
            恢复此版本
          </a-button>
        </a-timeline-item>
      </a-timeline>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { CommentOutlined, HistoryOutlined } from '@ant-design/icons-vue';
import { useCollabStore } from '@/stores/collab';
import { useAuthStore } from '@/stores/auth';
import dayjs from 'dayjs';

const route = useRoute();
const router = useRouter();
const collabStore = useCollabStore();
const authStore = useAuthStore();

const documentId = computed(() => route.params.id);
const loading = ref(false);
const loadingComments = ref(false);
const showComments = ref(false);
const showHistory = ref(false);
const documentContent = ref('');
const documentName = ref('');

const currentDocument = computed(() => collabStore.currentDocument);
const collaborators = computed(() => collabStore.collaborators);
const comments = computed(() => collabStore.comments);
const unresolvedCommentCount = computed(() => collabStore.unresolvedCommentCount);
const versionHistory = computed(() => collabStore.versionHistory);

const formatTime = (timestamp) => {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm');
};

const goBack = () => {
  router.back();
};

const handleContentChange = () => {
  // 处理内容变更，触发同步
};

const resolveComment = async (commentId) => {
  try {
    await collabStore.resolveComment(commentId, authStore.currentUser?.did);
    message.success('评论已解决');
  } catch (error) {
    message.error('操作失败');
  }
};

const restoreVersion = async (versionId) => {
  try {
    await collabStore.restoreVersion(documentId.value, versionId, authStore.currentUser?.did);
    message.success('版本已恢复');
  } catch (error) {
    message.error('恢复失败');
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await collabStore.openDocument(
      documentId.value,
      authStore.currentUser?.did,
      authStore.currentUser?.name
    );
    documentName.value = currentDocument.value?.name || '未命名文档';
  } catch (error) {
    message.error('加载文档失败');
  } finally {
    loading.value = false;
  }
});

onUnmounted(async () => {
  if (documentId.value && authStore.currentUser?.did) {
    await collabStore.closeDocument(documentId.value, authStore.currentUser.did);
  }
});
</script>

<style scoped>
.collab-editor-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-container {
  flex: 1;
  padding: 16px;
  overflow: auto;
}

.editor-content {
  min-height: 500px;
}

.document-editor {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
}
</style>
