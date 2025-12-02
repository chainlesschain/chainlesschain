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
            <pre v-else style="white-space: pre-wrap; font-family: inherit">{{ item.content }}</pre>
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
              <a-textarea
                v-model:value="editForm.content"
                :rows="20"
                placeholder="输入内容..."
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

.edit-form {
  margin-top: 24px;
}
</style>
