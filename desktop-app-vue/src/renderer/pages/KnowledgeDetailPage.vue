<template>
  <div class="knowledge-detail-page">
    <a-spin v-if="loading" size="large" style="width: 100%; padding: 48px 0" />

    <div v-else-if="item" class="detail-container">
      <!-- 顶部操作栏 -->
      <div class="detail-header">
        <a-space>
          <a-button @click="goBack">
            <template #icon><ArrowLeftOutlined /></template>
            返回
          </a-button>

          <a-button v-if="!editing" type="primary" @click="startEdit">
            <template #icon><EditOutlined /></template>
            编辑
          </a-button>

          <a-button v-else type="primary" @click="saveItem">
            <template #icon><SaveOutlined /></template>
            保存
          </a-button>

          <a-button v-if="editing" @click="cancelEdit">取消</a-button>

          <a-popconfirm
            title="确定要删除这个项目吗？"
            ok-text="确定"
            cancel-text="取消"
            @confirm="deleteItem"
          >
            <a-button danger>
              <template #icon><DeleteOutlined /></template>
              删除
            </a-button>
          </a-popconfirm>
        </a-space>
      </div>

      <!-- 内容区 -->
      <div class="detail-content">
        <div v-if="!editing">
          <h1>{{ item.title }}</h1>
          <div class="meta-info">
            <a-space>
              <a-tag>{{ typeLabels[item.type] }}</a-tag>
              <span class="meta-text">创建于 {{ formatDate(item.created_at) }}</span>
              <span class="meta-text">更新于 {{ formatDate(item.updated_at) }}</span>
            </a-space>
          </div>

          <a-divider />

          <div class="content-body">
            <p v-if="!item.content" style="color: rgba(0, 0, 0, 0.25)">暂无内容</p>
            <div v-else class="markdown-content" v-html="renderMarkdown(item.content)"></div>
          </div>
        </div>

        <div v-else class="edit-form">
          <a-form layout="vertical">
            <a-form-item label="标题">
              <a-input v-model:value="editForm.title" size="large" />
            </a-form-item>

            <a-form-item label="类型">
              <a-select v-model:value="editForm.type">
                <a-select-option value="note">笔记</a-select-option>
                <a-select-option value="document">文档</a-select-option>
                <a-select-option value="conversation">对话</a-select-option>
                <a-select-option value="web_clip">网页剪藏</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="内容">
              <MarkdownEditor
                v-model="editForm.content"
                style="height: 600px"
                @save="saveItem"
              />
            </a-form-item>
          </a-form>
        </div>
      </div>
    </div>

    <a-empty v-else description="项目不存在" />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  EditOutlined,
  SaveOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';
import { dbAPI } from '../utils/ipc';
import MarkdownEditor from '../components/MarkdownEditor.vue';
import MarkdownIt from 'markdown-it';

const route = useRoute();
const router = useRouter();
const store = useAppStore();

const loading = ref(false);
const item = ref(null);
const editing = ref(false);
const editForm = ref({
  title: '',
  type: 'note',
  content: '',
});

const typeLabels = {
  note: '笔记',
  document: '文档',
  conversation: '对话',
  web_clip: '网页剪藏',
};

onMounted(() => {
  loadItem();
});

watch(
  () => route.params.id,
  () => {
    if (route.params.id) {
      loadItem();
    }
  }
);

const loadItem = async () => {
  const id = route.params.id;
  loading.value = true;

  try {
    const data = await dbAPI.getKnowledgeItemById(id);
    item.value = data;
    store.setCurrentItem(data);
  } catch (error) {
    console.error('加载项目失败:', error);
    message.error('加载项目失败');
  } finally {
    loading.value = false;
  }
};

const goBack = () => {
  router.push('/');
};

const startEdit = () => {
  editForm.value = {
    title: item.value.title,
    type: item.value.type,
    content: item.value.content || '',
  };
  editing.value = true;
};

const cancelEdit = () => {
  editing.value = false;
};

const saveItem = async () => {
  if (!editForm.value.title) {
    message.warning('请输入标题');
    return;
  }

  try {
    const updated = await dbAPI.updateKnowledgeItem(item.value.id, {
      title: editForm.value.title,
      type: editForm.value.type,
      content: editForm.value.content,
    });

    item.value = updated;
    store.updateKnowledgeItem(item.value.id, updated);
    editing.value = false;
    message.success('保存成功');
  } catch (error) {
    console.error('保存失败:', error);
    message.error('保存失败');
  }
};

const deleteItem = async () => {
  try {
    await dbAPI.deleteKnowledgeItem(item.value.id);
    store.deleteKnowledgeItem(item.value.id);
    message.success('删除成功');
    router.push('/');
  } catch (error) {
    console.error('删除失败:', error);
    message.error('删除失败');
  }
};

const formatDate = (timestamp) => {
  return new Date(timestamp).toLocaleString('zh-CN');
};

// Markdown渲染
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

const renderMarkdown = (content) => {
  return md.render(content || '');
};
</script>

<style scoped>
.knowledge-detail-page {
  min-height: 100%;
}

.detail-container {
  max-width: 900px;
  margin: 0 auto;
}

.detail-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.detail-content h1 {
  font-size: 32px;
  margin-bottom: 16px;
}

.meta-info {
  margin-bottom: 16px;
}

.meta-text {
  color: rgba(0, 0, 0, 0.45);
  font-size: 14px;
}

.content-body {
  font-size: 16px;
  line-height: 1.8;
}

/* Markdown渲染样式 */
.markdown-content {
  max-width: 800px;
}

.markdown-content :deep(h1) {
  font-size: 2em;
  font-weight: 600;
  margin-top: 24px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eaecef;
}

.markdown-content :deep(h2) {
  font-size: 1.5em;
  font-weight: 600;
  margin-top: 24px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eaecef;
}

.markdown-content :deep(h3) {
  font-size: 1.25em;
  font-weight: 600;
  margin-top: 16px;
  margin-bottom: 8px;
}

.markdown-content :deep(p) {
  margin: 8px 0;
}

.markdown-content :deep(code) {
  padding: 2px 6px;
  background: #f6f8fa;
  border-radius: 3px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  padding: 16px;
  background: #f6f8fa;
  border-radius: 4px;
  overflow-x: auto;
  margin: 16px 0;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown-content :deep(blockquote) {
  margin: 16px 0;
  padding-left: 16px;
  border-left: 4px solid #dfe2e5;
  color: #6a737d;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 2em;
  margin: 8px 0;
}

.markdown-content :deep(li) {
  margin: 4px 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
}

.markdown-content :deep(table th),
.markdown-content :deep(table td) {
  border: 1px solid #dfe2e5;
  padding: 8px 13px;
}

.markdown-content :deep(table th) {
  background: #f6f8fa;
  font-weight: 600;
}

.markdown-content :deep(a) {
  color: #0366d6;
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid #eaecef;
  margin: 24px 0;
}

.edit-form {
  margin-top: 24px;
}
</style>
