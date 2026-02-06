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
              allow-clear
            >
              <a-select-option value="">
                全部
              </a-select-option>
              <a-select-option value="org">
                组织共享
              </a-select-option>
              <a-select-option value="public">
                公开
              </a-select-option>
            </a-select>
            <a-button
              type="primary"
              size="large"
              :disabled="!canCreateKnowledge"
              @click="showCreateModal = true"
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
      <a-tabs
        v-model:active-key="activeTab"
        type="card"
      >
        <a-tab-pane
          key="all"
          tab="全部知识"
        >
          <!-- 视图切换 -->
          <div class="view-controls">
            <a-radio-group
              v-model:value="viewMode"
              button-style="solid"
              size="small"
            >
              <a-radio-button value="grid">
                <AppstoreOutlined /> 网格
              </a-radio-button>
              <a-radio-button value="list">
                <UnorderedListOutlined /> 列表
              </a-radio-button>
            </a-radio-group>
            <a-select
              v-model:value="sortBy"
              placeholder="排序方式"
              style="width: 150px"
              size="small"
            >
              <a-select-option value="updated_at">
                最近更新
              </a-select-option>
              <a-select-option value="created_at">
                创建时间
              </a-select-option>
              <a-select-option value="title">
                标题
              </a-select-option>
              <a-select-option value="views">
                浏览量
              </a-select-option>
            </a-select>
          </div>

          <a-list
            v-if="viewMode === 'grid'"
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
                  :show-collaboration-status="true"
                  @view="viewDetail"
                  @edit="editKnowledge"
                  @delete="deleteKnowledge"
                  @share="shareKnowledge"
                  @collaborate="startCollaboration"
                />
              </a-list-item>
            </template>
          </a-list>

          <!-- 列表视图 -->
          <a-table
            v-else
            :columns="tableColumns"
            :data-source="filteredKnowledgeItems"
            :loading="loading"
            :pagination="pagination"
            row-key="id"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'title'">
                <div class="title-cell">
                  <a @click="viewDetail(record)">{{ record.title }}</a>
                  <a-badge
                    v-if="record.is_collaborating"
                    status="processing"
                    text="协作中"
                    style="margin-left: 8px"
                  />
                </div>
              </template>
              <template v-else-if="column.key === 'type'">
                <a-tag :color="getTypeColor(record.type)">
                  {{ getTypeName(record.type) }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'share_scope'">
                <a-tag :color="getScopeColor(record.share_scope)">
                  {{ getScopeName(record.share_scope) }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'collaborators'">
                <a-avatar-group
                  :max-count="3"
                  size="small"
                >
                  <a-avatar
                    v-for="user in record.active_collaborators"
                    :key="user.did"
                    :src="user.avatar"
                  >
                    {{ user.name?.charAt(0) }}
                  </a-avatar>
                </a-avatar-group>
              </template>
              <template v-else-if="column.key === 'actions'">
                <a-space>
                  <a-button
                    type="link"
                    size="small"
                    @click="viewDetail(record)"
                  >
                    查看
                  </a-button>
                  <a-button
                    v-if="canEdit(record)"
                    type="link"
                    size="small"
                    @click="startCollaboration(record)"
                  >
                    协作
                  </a-button>
                  <a-dropdown>
                    <a-button
                      type="link"
                      size="small"
                    >
                      更多 <DownOutlined />
                    </a-button>
                    <template #overlay>
                      <a-menu>
                        <a-menu-item @click="editKnowledge(record)">
                          编辑
                        </a-menu-item>
                        <a-menu-item @click="viewHistory(record)">
                          版本历史
                        </a-menu-item>
                        <a-menu-item @click="shareKnowledge(record)">
                          分享
                        </a-menu-item>
                        <a-menu-divider />
                        <a-menu-item
                          danger
                          @click="deleteKnowledge(record)"
                        >
                          删除
                        </a-menu-item>
                      </a-menu>
                    </template>
                  </a-dropdown>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <a-tab-pane
          key="my"
          tab="我创建的"
        >
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

        <a-tab-pane
          key="recent"
          tab="最近查看"
        >
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

    <!-- 版本历史对话框 -->
    <a-modal
      v-model:open="showHistoryModal"
      title="版本历史"
      width="900px"
      :footer="null"
    >
      <a-timeline mode="left">
        <a-timeline-item
          v-for="version in versionHistory"
          :key="version.id"
          :color="version.id === currentVersion ? 'green' : 'blue'"
        >
          <template #dot>
            <ClockCircleOutlined
              v-if="version.id === currentVersion"
              style="font-size: 16px"
            />
          </template>
          <div class="version-item">
            <div class="version-header">
              <span class="version-number">v{{ version.version }}</span>
              <span class="version-time">{{ formatTime(version.created_at) }}</span>
              <a-tag
                v-if="version.id === currentVersion"
                color="green"
              >
                当前版本
              </a-tag>
            </div>
            <div class="version-author">
              <UserOutlined />
              {{ version.created_by_name || version.created_by }}
            </div>
            <div class="version-content">
              <a-typography-paragraph
                :ellipsis="{ rows: 3, expandable: true }"
                :content="version.content"
              />
            </div>
            <div class="version-actions">
              <a-space>
                <a-button
                  size="small"
                  @click="previewVersion(version)"
                >
                  预览
                </a-button>
                <a-button
                  v-if="version.id !== currentVersion"
                  size="small"
                  type="primary"
                  @click="restoreVersion(version)"
                >
                  恢复此版本
                </a-button>
                <a-button
                  v-if="version.id !== currentVersion"
                  size="small"
                  @click="compareVersions(version)"
                >
                  对比差异
                </a-button>
              </a-space>
            </div>
          </div>
        </a-timeline-item>
      </a-timeline>
    </a-modal>

    <!-- 创建知识对话框 -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建组织知识"
      width="800px"
      :confirm-loading="creating"
      @ok="handleCreateKnowledge"
      @cancel="resetCreateForm"
    >
      <a-form
        :model="createForm"
        :label-col="{ span: 4 }"
        :wrapper-col="{ span: 20 }"
      >
        <a-form-item
          label="知识标题"
          required
        >
          <a-input
            v-model:value="createForm.title"
            placeholder="输入知识标题"
          />
        </a-form-item>

        <a-form-item
          label="知识类型"
          required
        >
          <a-select v-model:value="createForm.type">
            <a-select-option value="note">
              笔记
            </a-select-option>
            <a-select-option value="document">
              文档
            </a-select-option>
            <a-select-option value="conversation">
              对话记录
            </a-select-option>
            <a-select-option value="web_clip">
              网页剪藏
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item
          label="共享范围"
          required
        >
          <knowledge-permission-selector
            v-model:value="createForm.shareScope"
            :org-id="currentOrgId"
            @update:value="handleScopeChange"
          />
        </a-form-item>

        <a-form-item
          label="知识内容"
          required
        >
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
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, watch, h } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useIdentityStore } from '@/stores/identityStore';
import {
  TeamOutlined,
  FileTextOutlined,
  PlusOutlined,
  EditOutlined,
  PlusCircleOutlined,
  UserOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  DownOutlined,
  ClockCircleOutlined,
  ShareAltOutlined
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
const viewMode = ref('grid'); // 'grid' or 'list'
const sortBy = ref('updated_at');

const showCreateModal = ref(false);
const showHistoryModal = ref(false);
const versionHistory = ref([]);
const currentVersion = ref(null);

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

// 表格列定义
const tableColumns = [
  {
    title: '标题',
    dataIndex: 'title',
    key: 'title',
    width: 300
  },
  {
    title: '类型',
    dataIndex: 'type',
    key: 'type',
    width: 100
  },
  {
    title: '共享范围',
    dataIndex: 'share_scope',
    key: 'share_scope',
    width: 120
  },
  {
    title: '协作者',
    key: 'collaborators',
    width: 150
  },
  {
    title: '更新时间',
    dataIndex: 'updated_at',
    key: 'updated_at',
    width: 180,
    customRender: ({ text }) => formatTime(text)
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    fixed: 'right'
  }
];

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

  return items;
});

watch(filteredKnowledgeItems, (items) => {
  pagination.value.total = items.length;
}, { immediate: true });

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

    const result = await window.electron.ipcRenderer.invoke('org:get-knowledge-items', {
      orgId: currentOrgId.value
    });

    if (result.success) {
      knowledgeItems.value = result.items || [];
      pagination.value.total = result.items?.length || 0;
    } else {
      message.error(result.error || '加载知识列表失败');
    }
  } catch (error) {
    logger.error('加载知识列表失败:', error);
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
    const result = await window.electron.ipcRenderer.invoke('knowledge:get-tags');
    if (result.success) {
      availableTags.value = result.tags || [];
    }
  } catch (error) {
    logger.error('加载标签失败:', error);
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
    const result = await window.electron.ipcRenderer.invoke('org:delete-knowledge', {
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
    logger.error('删除知识失败:', error);
    message.error('删除知识失败');
  }
}

/**
 * 分享知识
 */
function shareKnowledge(item) {
  const shareUrl = `chainlesschain://org/${currentOrgId.value}/knowledge/${item.id}`;

  Modal.confirm({
    title: '分享知识',
    icon: h(ShareAltOutlined),
    content: h('div', { class: 'share-content' }, [
      h('p', `标题: ${item.title}`),
      h('p', { style: 'margin-top: 12px; font-weight: bold' }, '分享链接:'),
      h('div', {
        style: 'padding: 8px 12px; background: #f5f5f5; border-radius: 4px; word-break: break-all; font-family: monospace; margin-top: 8px'
      }, shareUrl)
    ]),
    okText: '复制链接',
    cancelText: '关闭',
    onOk: async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        message.success('链接已复制到剪贴板');
      } catch (error) {
        logger.error('复制链接失败:', error);
        message.error('复制失败，请手动复制');
      }
    }
  });
}

/**
 * 共享范围变更
 */
function handleScopeChange(scope) {
  logger.info('共享范围变更:', scope);
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

    const result = await window.electron.ipcRenderer.invoke('org:create-knowledge', {
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
    logger.error('创建知识失败:', error);
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

/**
 * 开始协作编辑
 */
async function startCollaboration(item) {
  try {
    const result = await window.electron.ipcRenderer.invoke('collaboration:start-session', {
      documentId: item.id,
      orgId: currentOrgId.value,
      userDid: currentUserDID.value
    });

    if (result.success) {
      message.success('已加入协作编辑');
      router.push(`/knowledge/${item.id}/collaborate`);
    } else {
      message.error(result.error || '加入协作失败');
    }
  } catch (error) {
    logger.error('开始协作失败:', error);
    message.error('开始协作失败');
  }
}

/**
 * 查看版本历史
 */
async function viewHistory(item) {
  try {
    const result = await window.electron.ipcRenderer.invoke('knowledge:get-version-history', {
      knowledgeId: item.id
    });

    if (result.success) {
      versionHistory.value = result.versions || [];
      currentVersion.value = item.id;
      showHistoryModal.value = true;
    } else {
      message.error(result.error || '加载版本历史失败');
    }
  } catch (error) {
    logger.error('加载版本历史失败:', error);
    message.error('加载版本历史失败');
  }
}

/**
 * 预览版本
 */
function previewVersion(version) {
  Modal.info({
    title: `版本预览 - ${formatTime(version.created_at)}`,
    width: 800,
    content: h('div', { class: 'version-preview' }, [
      h('div', { style: 'margin-bottom: 12px; color: #666' }, [
        h('span', `修改者: ${version.created_by?.substring(0, 12) || '未知'}...`),
        h('span', { style: 'margin-left: 16px' }, `版本号: ${version.version || 'v1'}`)
      ]),
      h('div', {
        style: 'max-height: 400px; overflow-y: auto; padding: 16px; background: #fafafa; border-radius: 4px; white-space: pre-wrap; font-family: monospace'
      }, version.content || '(无内容)')
    ]),
    okText: '关闭'
  });
}

/**
 * 恢复版本
 */
async function restoreVersion(version) {
  try {
    const result = await window.electron.ipcRenderer.invoke('knowledge:restore-version', {
      knowledgeId: currentVersion.value,
      versionId: version.id
    });

    if (result.success) {
      message.success('版本恢复成功');
      showHistoryModal.value = false;
      await loadKnowledgeItems();
    } else {
      message.error(result.error || '版本恢复失败');
    }
  } catch (error) {
    logger.error('版本恢复失败:', error);
    message.error('版本恢复失败');
  }
}

/**
 * 对比版本差异
 */
function compareVersions(version) {
  // 找到当前版本在历史中的索引
  const currentIndex = versionHistory.value.findIndex(v => v.id === version.id);
  const previousVersion = currentIndex < versionHistory.value.length - 1
    ? versionHistory.value[currentIndex + 1]
    : null;

  if (!previousVersion) {
    message.info('这是最早的版本，无法对比');
    return;
  }

  // 简单的文本差异对比
  const oldContent = previousVersion.content || '';
  const newContent = version.content || '';

  Modal.info({
    title: '版本对比',
    width: 1000,
    content: h('div', { class: 'version-compare' }, [
      h('div', { style: 'display: flex; gap: 16px' }, [
        h('div', { style: 'flex: 1' }, [
          h('h4', { style: 'margin-bottom: 8px; color: #999' }, `旧版本 (${formatTime(previousVersion.created_at)})`),
          h('div', {
            style: 'height: 300px; overflow-y: auto; padding: 12px; background: #fff5f5; border: 1px solid #ffd6d6; border-radius: 4px; white-space: pre-wrap; font-family: monospace; font-size: 12px'
          }, oldContent || '(无内容)')
        ]),
        h('div', { style: 'flex: 1' }, [
          h('h4', { style: 'margin-bottom: 8px; color: #52c41a' }, `新版本 (${formatTime(version.created_at)})`),
          h('div', {
            style: 'height: 300px; overflow-y: auto; padding: 12px; background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 4px; white-space: pre-wrap; font-family: monospace; font-size: 12px'
          }, newContent || '(无内容)')
        ])
      ])
    ]),
    okText: '关闭'
  });
}

/**
 * 检查是否可以编辑
 */
function canEdit(item) {
  const role = identityStore.currentRole;
  if (['owner', 'admin'].includes(role)) {return true;}
  if (item.created_by === currentUserDID.value) {return true;}
  return item.permissions?.includes('edit');
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
  if (!timestamp) {return '-';}
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 1分钟内
  if (diff < 60000) {
    return '刚刚';
  }
  // 1小时内
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }
  // 今天
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  // 其他
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * 获取类型名称
 */
function getTypeName(type) {
  const typeMap = {
    note: '笔记',
    document: '文档',
    conversation: '对话',
    web_clip: '网页剪藏'
  };
  return typeMap[type] || type;
}

/**
 * 获取类型颜色
 */
function getTypeColor(type) {
  const colorMap = {
    note: 'blue',
    document: 'green',
    conversation: 'orange',
    web_clip: 'purple'
  };
  return colorMap[type] || 'default';
}

/**
 * 获取范围名称
 */
function getScopeName(scope) {
  const scopeMap = {
    private: '私有',
    team: '团队',
    org: '组织',
    public: '公开'
  };
  return scopeMap[scope] || scope;
}

/**
 * 获取范围颜色
 */
function getScopeColor(scope) {
  const colorMap = {
    private: 'default',
    team: 'blue',
    org: 'green',
    public: 'orange'
  };
  return colorMap[scope] || 'default';
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
    .view-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding: 12px 16px;
      background: #fafafa;
      border-radius: 8px;
    }

    .title-cell {
      display: flex;
      align-items: center;

      a {
        color: #1890ff;
        &:hover {
          text-decoration: underline;
        }
      }
    }

    :deep(.ant-tabs-card) {
      .ant-tabs-nav {
        margin-bottom: 16px;
      }
    }
  }

  // 版本历史样式
  .version-item {
    padding: 12px;
    background: #fafafa;
    border-radius: 8px;

    .version-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;

      .version-number {
        font-weight: 600;
        color: #1890ff;
      }

      .version-time {
        color: #999;
        font-size: 13px;
      }
    }

    .version-author {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #666;
      font-size: 13px;
      margin-bottom: 12px;
    }

    .version-content {
      margin-bottom: 12px;
      padding: 12px;
      background: white;
      border-radius: 6px;
    }

    .version-actions {
      display: flex;
      justify-content: flex-end;
    }
  }
}
</style>
