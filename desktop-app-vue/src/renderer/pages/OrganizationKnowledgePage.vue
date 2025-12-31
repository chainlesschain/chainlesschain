<template>
  <div class="organization-knowledge-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <h1>
            <TeamOutlined />
            组织知识库
          </h1>
          <p>管理和浏览组织内共享的知识</p>
        </div>
        <div class="header-right">
          <a-space>
            <a-input-search
              v-model:value="searchQuery"
              placeholder="搜索组织知识..."
              style="width: 300px"
              @search="handleSearch"
            />
            <a-select
              v-model:value="filterScope"
              placeholder="筛选范围"
              style="width: 150px"
              allowClear
            >
              <a-select-option value="">全部</a-select-option>
              <a-select-option value="org">组织共享</a-select-option>
              <a-select-option value="public">公开</a-select-option>
            </a-select>
            <a-button
              type="primary"
              size="large"
              @click="showCreateModal = true"
              :disabled="!canCreateKnowledge"
            >
              <PlusOutlined />
              创建组织知识
            </a-button>
          </a-space>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="stats-cards">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-card size="small">
              <a-statistic
                title="总知识数"
                :value="stats.total"
                :prefix="h(FileTextOutlined)"
              />
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card size="small">
              <a-statistic
                title="我创建的"
                :value="stats.myCreated"
                :prefix="h(EditOutlined)"
              />
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card size="small">
              <a-statistic
                title="本周新增"
                :value="stats.thisWeek"
                :prefix="h(PlusCircleOutlined)"
              />
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card size="small">
              <a-statistic
                title="成员贡献者"
                :value="stats.contributors"
                :prefix="h(UserOutlined)"
              />
            </a-card>
          </a-col>
        </a-row>
      </div>
    </div>

    <!-- 知识列表 -->
    <div class="knowledge-list">
      <a-tabs v-model:activeKey="activeTab" type="card">
        <a-tab-pane key="all" tab="全部知识">
          <a-list
            :grid="{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }"
            :data-source="filteredKnowledgeItems"
            :loading="loading"
            :pagination="pagination"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <knowledge-card
                  :item="item"
                  :current-user-did="currentUserDID"
                  @view="viewDetail"
                  @edit="editKnowledge"
                  @delete="deleteKnowledge"
                  @share="shareKnowledge"
                />
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>

        <a-tab-pane key="my" tab="我创建的">
          <a-list
            :grid="{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }"
            :data-source="myKnowledgeItems"
            :loading="loading"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <knowledge-card
                  :item="item"
                  :current-user-did="currentUserDID"
                  @view="viewDetail"
                  @edit="editKnowledge"
                  @delete="deleteKnowledge"
                  @share="shareKnowledge"
                />
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>

        <a-tab-pane key="recent" tab="最近查看">
          <a-list
            :grid="{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }"
            :data-source="recentKnowledgeItems"
            :loading="loading"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <knowledge-card
                  :item="item"
                  :current-user-did="currentUserDID"
                  @view="viewDetail"
                  @edit="editKnowledge"
                  @delete="deleteKnowledge"
                  @share="shareKnowledge"
                />
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 创建知识对话框 -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建组织知识"
      width="800px"
      @ok="handleCreateKnowledge"
      @cancel="resetCreateForm"
      :confirmLoading="creating"
    >
      <a-form
        :model="createForm"
        :label-col="{ span: 4 }"
        :wrapper-col="{ span: 20 }"
      >
        <a-form-item label="知识标题" required>
          <a-input
            v-model:value="createForm.title"
            placeholder="输入知识标题"
          />
        </a-form-item>

        <a-form-item label="知识类型" required>
          <a-select v-model:value="createForm.type">
            <a-select-option value="note">笔记</a-select-option>
            <a-select-option value="document">文档</a-select-option>
            <a-select-option value="conversation">对话记录</a-select-option>
            <a-select-option value="web_clip">网页剪藏</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="共享范围" required>
          <knowledge-permission-selector
            v-model:value="createForm.shareScope"
            :org-id="currentOrgId"
            @update:value="handleScopeChange"
          />
        </a-form-item>

        <a-form-item label="知识内容" required>
          <a-textarea
            v-model:value="createForm.content"
            placeholder="输入知识内容..."
            :rows="8"
          />
        </a-form-item>

        <a-form-item label="标签">
          <a-select
            v-model:value="createForm.tags"
            mode="tags"
            placeholder="添加标签"
            style="width: 100%"
          >
            <a-select-option
              v-for="tag in availableTags"
              :key="tag.id"
              :value="tag.name"
            >
              {{ tag.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, h } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { useIdentityStore } from '@/stores/identityStore';
import {
  TeamOutlined,
  FileTextOutlined,
  PlusOutlined,
  EditOutlined,
  PlusCircleOutlined,
  UserOutlined
} from '@ant-design/icons-vue';
import KnowledgeCard from '@/components/KnowledgeCard.vue';
import KnowledgePermissionSelector from '@/components/KnowledgePermissionSelector.vue';

const router = useRouter();
const identityStore = useIdentityStore();

// ==================== State ====================
const loading = ref(false);
const creating = ref(false);
const knowledgeItems = ref([]);
const availableTags = ref([]);

const searchQuery = ref('');
const filterScope = ref('');
const activeTab = ref('all');

const showCreateModal = ref(false);
const createForm = ref({
  title: '',
  type: 'note',
  content: '',
  shareScope: 'org',
  tags: []
});

const pagination = ref({
  current: 1,
  pageSize: 12,
  total: 0,
  showSizeChanger: true,
  showTotal: total => `共 ${total} 条知识`
});

// ==================== Computed ====================
const currentOrgId = computed(() => identityStore.currentOrgId);
const currentUserDID = computed(() => identityStore.currentUserDID);

const canCreateKnowledge = computed(() => {
  const role = identityStore.currentRole;
  return ['owner', 'admin', 'member'].includes(role);
});

// 统计数据
const stats = computed(() => {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const total = knowledgeItems.value.length;
  const myCreated = knowledgeItems.value.filter(
    item => item.created_by === currentUserDID.value
  ).length;
  const thisWeek = knowledgeItems.value.filter(
    item => item.created_at >= oneWeekAgo
  ).length;
  const contributors = new Set(
    knowledgeItems.value.map(item => item.created_by)
  ).size;

  return { total, myCreated, thisWeek, contributors };
});

// 过滤后的知识列表
const filteredKnowledgeItems = computed(() => {
  let items = [...knowledgeItems.value];

  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    items = items.filter(item =>
      item.title?.toLowerCase().includes(query) ||
      item.content?.toLowerCase().includes(query)
    );
  }

  // 范围过滤
  if (filterScope.value) {
    items = items.filter(item => item.share_scope === filterScope.value);
  }

  // 更新分页总数
  pagination.value.total = items.length;

  return items;
});

// 我创建的知识
const myKnowledgeItems = computed(() => {
  return knowledgeItems.value.filter(
    item => item.created_by === currentUserDID.value
  );
});

// 最近查看的知识（模拟）
const recentKnowledgeItems = computed(() => {
  return knowledgeItems.value.slice(0, 8);
});

// ==================== Methods ====================

/**
 * 加载组织知识列表
 */
async function loadKnowledgeItems() {
  try {
    loading.value = true;

    const result = await window.electron.invoke('org:get-knowledge-items', {
      orgId: currentOrgId.value
    });

    if (result.success) {
      knowledgeItems.value = result.items || [];
      pagination.value.total = result.items?.length || 0;
    } else {
      message.error(result.error || '加载知识列表失败');
    }
  } catch (error) {
    console.error('加载知识列表失败:', error);
    message.error('加载知识列表失败');
  } finally {
    loading.value = false;
  }
}

/**
 * 加载可用标签
 */
async function loadTags() {
  try {
    const result = await window.electron.invoke('knowledge:get-tags');
    if (result.success) {
      availableTags.value = result.tags || [];
    }
  } catch (error) {
    console.error('加载标签失败:', error);
  }
}

/**
 * 搜索
 */
function handleSearch() {
  pagination.value.current = 1;
}

/**
 * 查看详情
 */
function viewDetail(item) {
  router.push(`/knowledge/${item.id}`);
}

/**
 * 编辑知识
 */
function editKnowledge(item) {
  router.push(`/knowledge/${item.id}/edit`);
}

/**
 * 删除知识
 */
async function deleteKnowledge(item) {
  try {
    const result = await window.electron.invoke('org:delete-knowledge', {
      orgId: currentOrgId.value,
      knowledgeId: item.id
    });

    if (result.success) {
      message.success('删除成功');
      await loadKnowledgeItems();
    } else {
      message.error(result.error || '删除失败');
    }
  } catch (error) {
    console.error('删除知识失败:', error);
    message.error('删除知识失败');
  }
}

/**
 * 分享知识
 */
function shareKnowledge(item) {
  // TODO: 实现分享功能
  message.info('分享功能开发中...');
}

/**
 * 共享范围变更
 */
function handleScopeChange(scope) {
  console.log('共享范围变更:', scope);
}

/**
 * 创建知识
 */
async function handleCreateKnowledge() {
  try {
    // 表单验证
    if (!createForm.value.title || !createForm.value.content) {
      message.error('请填写标题和内容');
      return;
    }

    creating.value = true;

    const result = await window.electron.invoke('org:create-knowledge', {
      orgId: currentOrgId.value,
      title: createForm.value.title,
      type: createForm.value.type,
      content: createForm.value.content,
      shareScope: createForm.value.shareScope,
      tags: createForm.value.tags,
      createdBy: currentUserDID.value
    });

    if (result.success) {
      message.success('创建成功');
      showCreateModal.value = false;
      resetCreateForm();
      await loadKnowledgeItems();
    } else {
      message.error(result.error || '创建失败');
    }
  } catch (error) {
    console.error('创建知识失败:', error);
    message.error('创建知识失败');
  } finally {
    creating.value = false;
  }
}

/**
 * 重置创建表单
 */
function resetCreateForm() {
  createForm.value = {
    title: '',
    type: 'note',
    content: '',
    shareScope: 'org',
    tags: []
  };
}

// ==================== Lifecycle ====================
onMounted(async () => {
  await Promise.all([
    loadKnowledgeItems(),
    loadTags()
  ]);
});
</script>

<style scoped lang="less">
.organization-knowledge-page {
  padding: 24px;

  .page-header {
    margin-bottom: 24px;

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;

      .header-left {
        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 12px;

          :deep(.anticon) {
            color: #1890ff;
          }
        }

        p {
          margin: 8px 0 0;
          color: #666;
          font-size: 14px;
        }
      }
    }

    .stats-cards {
      :deep(.ant-card-body) {
        padding: 16px;
      }
    }
  }

  .knowledge-list {
    :deep(.ant-tabs-card) {
      .ant-tabs-nav {
        margin-bottom: 16px;
      }
    }
  }
}
</style>
