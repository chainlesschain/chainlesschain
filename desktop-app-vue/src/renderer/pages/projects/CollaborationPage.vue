<template>
  <div class="collaboration-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <h1>
            <TeamOutlined />
            协作项目
          </h1>
          <p>基于DID的去中心化协作，支持权限管理和版本控制</p>
        </div>
        <div class="header-right">
          <a-button
            type="primary"
            @click="handleInviteCollaborator"
          >
            <UserAddOutlined />
            邀请协作者
          </a-button>
          <a-button @click="handleBackToProjects">
            <ArrowLeftOutlined />
            返回我的项目
          </a-button>
        </div>
      </div>
    </div>

    <!-- 标签页 -->
    <div class="tabs-container">
      <a-tabs
        v-model:active-key="activeTab"
        @change="handleTabChange"
      >
        <a-tab-pane
          key="owned"
          tab="我创建的"
        >
          <template #tab>
            <span>
              <CrownOutlined />
              我创建的
            </span>
          </template>
        </a-tab-pane>
        <a-tab-pane
          key="joined"
          tab="我参与的"
        >
          <template #tab>
            <span>
              <UsergroupAddOutlined />
              我参与的
            </span>
          </template>
        </a-tab-pane>
        <a-tab-pane
          key="invitations"
          tab="邀请通知"
        >
          <template #tab>
            <span>
              <MailOutlined />
              邀请通知
              <a-badge
                v-if="pendingInvitations.length > 0"
                :count="pendingInvitations.length"
              />
            </span>
          </template>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-left">
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="搜索协作项目..."
          style="width: 300px"
          @search="handleSearch"
          @change="debouncedSearch"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input-search>

        <a-select
          v-model:value="selectedType"
          placeholder="项目类型"
          style="width: 150px"
          @change="handleTypeChange"
        >
          <a-select-option value="">
            全部类型
          </a-select-option>
          <a-select-option value="web">
            Web开发
          </a-select-option>
          <a-select-option value="document">
            文档处理
          </a-select-option>
          <a-select-option value="data">
            数据分析
          </a-select-option>
          <a-select-option value="app">
            应用开发
          </a-select-option>
        </a-select>
      </div>

      <div class="filter-right">
        <a-button
          :loading="loading"
          @click="handleRefresh"
        >
          <ReloadOutlined :spin="loading" />
          刷新
        </a-button>

        <a-radio-group
          v-model:value="viewMode"
          button-style="solid"
          @change="handleViewModeChange"
        >
          <a-radio-button value="grid">
            <AppstoreOutlined />
          </a-radio-button>
          <a-radio-button value="list">
            <UnorderedListOutlined />
          </a-radio-button>
        </a-radio-group>
      </div>
    </div>

    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="loading-container"
    >
      <a-spin
        size="large"
        tip="加载中..."
      />
    </div>

    <!-- 邀请通知列表 -->
    <div
      v-else-if="activeTab === 'invitations'"
      class="invitations-container"
    >
      <div
        v-if="pendingInvitations.length > 0"
        class="invitations-list"
      >
        <div
          v-for="invitation in pendingInvitations"
          :key="invitation.id"
          class="invitation-card"
        >
          <div class="invitation-header">
            <a-avatar
              :size="48"
              :style="{ backgroundColor: getAvatarColor(invitation.inviter.did) }"
            >
              {{ invitation.inviter.name?.charAt(0) || 'U' }}
            </a-avatar>
            <div class="invitation-info">
              <h4>{{ invitation.inviter.name }}</h4>
              <p>邀请你加入项目</p>
            </div>
          </div>

          <div class="invitation-body">
            <h3>{{ invitation.project.name }}</h3>
            <p>{{ invitation.project.description || '暂无描述' }}</p>
            <div class="invitation-meta">
              <span>
                <ClockCircleOutlined />
                {{ formatDate(invitation.created_at) }}
              </span>
              <a-tag :color="getRoleColor(invitation.role)">
                {{ getRoleName(invitation.role) }}
              </a-tag>
            </div>
          </div>

          <div class="invitation-actions">
            <a-button
              type="primary"
              @click="handleAcceptInvitation(invitation.id)"
            >
              <CheckOutlined />
              接受
            </a-button>
            <a-button @click="handleRejectInvitation(invitation.id)">
              <CloseOutlined />
              拒绝
            </a-button>
          </div>
        </div>
      </div>

      <div
        v-else
        class="empty-state"
      >
        <div class="empty-icon">
          <MailOutlined />
        </div>
        <h3>暂无邀请通知</h3>
        <p>你的协作邀请将显示在这里</p>
      </div>
    </div>

    <!-- 协作项目列表 -->
    <div
      v-else-if="filteredProjects.length > 0"
      class="projects-container"
    >
      <!-- 网格视图 -->
      <div
        v-if="viewMode === 'grid'"
        class="projects-grid"
      >
        <div
          v-for="project in filteredProjects"
          :key="project.id"
          class="collaboration-project-card"
        >
          <div class="card-header">
            <div class="project-icon">
              <component :is="getProjectTypeIcon(project.project_type)" />
            </div>
            <a-tag
              v-if="project.isOwner"
              color="gold"
            >
              <CrownOutlined />
              创建者
            </a-tag>
            <a-tag
              v-else
              :color="getRoleColor(project.myRole)"
            >
              {{ getRoleName(project.myRole) }}
            </a-tag>
          </div>

          <div class="card-body">
            <h3>{{ project.name }}</h3>
            <p class="description">
              {{ project.description || '暂无描述' }}
            </p>

            <!-- 协作者头像组 -->
            <div class="collaborators">
              <a-avatar-group :max-count="5">
                <a-avatar
                  v-for="(collaborator, index) in project.collaborators"
                  :key="index"
                  :style="{ backgroundColor: getAvatarColor(collaborator.did) }"
                >
                  <a-tooltip :title="collaborator.name">
                    {{ collaborator.name?.charAt(0) || 'U' }}
                  </a-tooltip>
                </a-avatar>
              </a-avatar-group>
              <span class="collaborator-count">{{ project.collaborators.length }} 人</span>
            </div>

            <div class="meta-info">
              <div class="meta-item">
                <CalendarOutlined />
                {{ formatDate(project.updated_at) }}
              </div>
              <div class="meta-item">
                <SafetyOutlined />
                基于DID加密
              </div>
            </div>
          </div>

          <div class="card-footer">
            <a-button
              type="primary"
              block
              @click="handleViewProject(project.id)"
            >
              <EyeOutlined />
              打开项目
            </a-button>
          </div>
        </div>
      </div>

      <!-- 列表视图 -->
      <div
        v-else
        class="projects-list"
      >
        <div
          v-for="project in filteredProjects"
          :key="project.id"
          class="collaboration-project-item"
        >
          <div class="item-icon">
            <component :is="getProjectTypeIcon(project.project_type)" />
          </div>

          <div class="item-content">
            <div class="item-header">
              <h4>{{ project.name }}</h4>
              <a-tag
                v-if="project.isOwner"
                color="gold"
              >
                <CrownOutlined />
                创建者
              </a-tag>
              <a-tag
                v-else
                :color="getRoleColor(project.myRole)"
              >
                {{ getRoleName(project.myRole) }}
              </a-tag>
            </div>
            <p>{{ project.description || '暂无描述' }}</p>
            <div class="item-meta">
              <div class="collaborators-inline">
                <a-avatar-group
                  :max-count="3"
                  size="small"
                >
                  <a-avatar
                    v-for="(collaborator, index) in project.collaborators"
                    :key="index"
                    :size="24"
                    :style="{ backgroundColor: getAvatarColor(collaborator.did) }"
                  >
                    {{ collaborator.name?.charAt(0) || 'U' }}
                  </a-avatar>
                </a-avatar-group>
                <span>{{ project.collaborators.length }} 人</span>
              </div>
              <span><CalendarOutlined /> {{ formatDate(project.updated_at) }}</span>
              <span><SafetyOutlined /> DID加密</span>
            </div>
          </div>

          <div class="item-actions">
            <a-button
              type="primary"
              @click="handleViewProject(project.id)"
            >
              <EyeOutlined />
              打开
            </a-button>
            <a-dropdown>
              <a-button>
                <MoreOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="({ key }) => handleAction(key, project.id)">
                  <a-menu-item
                    v-if="project.isOwner"
                    key="manage"
                  >
                    <SettingOutlined />
                    管理协作者
                  </a-menu-item>
                  <a-menu-item
                    v-if="!project.isOwner"
                    key="leave"
                  >
                    <LogoutOutlined />
                    退出协作
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-else
      class="empty-state"
    >
      <div class="empty-icon">
        <TeamOutlined />
      </div>
      <h3>{{ searchKeyword || selectedType ? '没有找到匹配的协作项目' : getEmptyMessage() }}</h3>
      <p>{{ searchKeyword || selectedType ? '尝试调整筛选条件' : getEmptyDescription() }}</p>
    </div>

    <!-- 邀请协作者Modal -->
    <a-modal
      v-model:open="showInviteModal"
      title="邀请协作者"
      :confirm-loading="inviting"
      @ok="handleConfirmInvite"
    >
      <a-form layout="vertical">
        <a-form-item
          label="选择项目"
          required
        >
          <a-select
            v-model:value="inviteForm.projectId"
            placeholder="选择要邀请协作的项目"
          >
            <a-select-option
              v-for="project in ownedProjects"
              :key="project.id"
              :value="project.id"
            >
              {{ project.name }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item
          label="协作者DID"
          required
        >
          <a-input
            v-model:value="inviteForm.collaboratorDid"
            placeholder="输入协作者的DID地址"
          />
        </a-form-item>

        <a-form-item
          label="角色"
          required
        >
          <a-select
            v-model:value="inviteForm.role"
            placeholder="选择角色"
          >
            <a-select-option value="admin">
              管理员
            </a-select-option>
            <a-select-option value="editor">
              编辑者
            </a-select-option>
            <a-select-option value="viewer">
              查看者
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="邀请消息">
          <a-textarea
            v-model:value="inviteForm.message"
            placeholder="添加邀请消息..."
            :rows="3"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useProjectStore } from '@/stores/project';
import { useAuthStore } from '@/stores/auth';
import { useAppStore } from '@/stores/app';
import {
  TeamOutlined,
  UserAddOutlined,
  ArrowLeftOutlined,
  CrownOutlined,
  UsergroupAddOutlined,
  MailOutlined,
  SearchOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  ClockCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  CalendarOutlined,
  SafetyOutlined,
  EyeOutlined,
  MoreOutlined,
  SettingOutlined,
  LogoutOutlined,
  CodeOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AppstoreAddOutlined,
  FolderOutlined,
} from '@ant-design/icons-vue';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const router = useRouter();
const projectStore = useProjectStore();
const authStore = useAuthStore();
const appStore = useAppStore();

// 响应式状态
const loading = ref(false);
const inviting = ref(false);
const activeTab = ref('owned');
const searchKeyword = ref('');
const selectedType = ref('');
const viewMode = ref('grid');
const showInviteModal = ref(false);

// 邀请表单
const inviteForm = ref({
  projectId: null,
  collaboratorDid: '',
  role: 'editor',
  message: '',
});

// 模拟数据（实际应从后端API获取）
const collaborationProjects = ref([]);
const pendingInvitations = ref([]);

// 计算属性
const ownedProjects = computed(() => {
  return collaborationProjects.value.filter(p => p.isOwner);
});

const joinedProjects = computed(() => {
  return collaborationProjects.value.filter(p => !p.isOwner);
});

const filteredProjects = computed(() => {
  let result = activeTab.value === 'owned' ? ownedProjects.value : joinedProjects.value;

  // 类型筛选
  if (selectedType.value) {
    result = result.filter(p => p.project_type === selectedType.value);
  }

  // 搜索筛选
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(p =>
      p.name.toLowerCase().includes(keyword) ||
      (p.description && p.description.toLowerCase().includes(keyword))
    );
  }

  return result;
});

// 项目类型图标
const getProjectTypeIcon = (type) => {
  const iconMap = {
    web: CodeOutlined,
    document: FileTextOutlined,
    data: BarChartOutlined,
    app: AppstoreAddOutlined,
  };
  return iconMap[type] || FolderOutlined;
};

// 角色颜色
const getRoleColor = (role) => {
  const colorMap = {
    owner: 'gold',
    admin: 'red',
    editor: 'blue',
    viewer: 'green',
  };
  return colorMap[role] || 'default';
};

// 角色名称
const getRoleName = (role) => {
  const nameMap = {
    owner: '所有者',
    admin: '管理员',
    editor: '编辑者',
    viewer: '查看者',
  };
  return nameMap[role] || role;
};

// 头像颜色（基于DID生成）
const getAvatarColor = (did) => {
  const colors = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068'];
  const hash = did?.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) || 0;
  return colors[hash % colors.length];
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) {return '未知';}
  try {
    return format(new Date(timestamp), 'yyyy-MM-dd HH:mm', { locale: zhCN });
  } catch {
    return '未知';
  }
};

// 空状态消息
const getEmptyMessage = () => {
  return activeTab.value === 'owned' ? '还没有创建协作项目' : '还没有参与协作项目';
};

const getEmptyDescription = () => {
  return activeTab.value === 'owned'
    ? '创建项目并邀请协作者一起工作'
    : '等待项目邀请或主动申请加入';
};

// 防抖搜索
let searchTimeout;
const debouncedSearch = () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    handleSearch();
  }, 300);
};

// 处理搜索
const handleSearch = () => {
  // 搜索逻辑在computed中实现
};

// 处理类型筛选
const handleTypeChange = () => {
  // 筛选逻辑在computed中实现
};

// 处理标签页切换
const handleTabChange = () => {
  searchKeyword.value = '';
  selectedType.value = '';
};

// 处理视图模式切换
const handleViewModeChange = () => {
  localStorage.setItem('collaboration_view_mode', viewMode.value);
};

// 刷新
const handleRefresh = async () => {
  loading.value = true;
  try {
    await loadCollaborationProjects();
    message.success('刷新成功');
  } catch (error) {
    console.error('Refresh failed:', error);
    message.error('刷新失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

// 返回我的项目
const handleBackToProjects = () => {
  router.push('/projects');
};

// 查看项目
const handleViewProject = (projectId) => {
  // 查找项目信息
  const project = filteredProjects.value.find(p => p.id === projectId);

  // 检查是否是演示数据
  if (project?._isDemo || projectId.startsWith('collab-demo-')) {
    message.info('这是演示数据，协作项目功能需要连接后端服务才能使用');
    return;
  }

  // 检查项目是否真实存在于项目store中
  const realProject = projectStore.projects.find(p => p.id === projectId);
  if (!realProject) {
    message.warning('项目不存在，可能已被删除');
    return;
  }

  const projectName = project ? project.name : realProject.name;

  // 添加标签页
  appStore.addTab({
    key: `project-${projectId}`,
    title: projectName,
    path: `/projects/${projectId}`,
    closable: true,
  });

  // 跳转到项目详情页
  router.push(`/projects/${projectId}`);
};

// 邀请协作者
const handleInviteCollaborator = () => {
  if (ownedProjects.value.length === 0) {
    message.warning('请先创建项目才能邀请协作者');
    return;
  }
  showInviteModal.value = true;
};

// 确认邀请
const handleConfirmInvite = async () => {
  if (!inviteForm.value.projectId) {
    message.warning('请选择项目');
    return;
  }
  if (!inviteForm.value.collaboratorDid) {
    message.warning('请输入协作者DID');
    return;
  }

  inviting.value = true;
  try {
    // TODO: 调用后端API发送邀请
    await new Promise(resolve => setTimeout(resolve, 1000));

    message.success('邀请已发送');
    showInviteModal.value = false;
    inviteForm.value = {
      projectId: null,
      collaboratorDid: '',
      role: 'editor',
      message: '',
    };
  } catch (error) {
    console.error('Invite failed:', error);
    message.error('邀请失败：' + error.message);
  } finally {
    inviting.value = false;
  }
};

// 接受邀请
const handleAcceptInvitation = async (invitationId) => {
  try {
    // TODO: 调用后端API接受邀请
    await new Promise(resolve => setTimeout(resolve, 500));

    pendingInvitations.value = pendingInvitations.value.filter(
      inv => inv.id !== invitationId
    );
    message.success('已接受邀请');
    await loadCollaborationProjects();
  } catch (error) {
    console.error('Accept invitation failed:', error);
    message.error('接受失败：' + error.message);
  }
};

// 拒绝邀请
const handleRejectInvitation = async (invitationId) => {
  try {
    // TODO: 调用后端API拒绝邀请
    await new Promise(resolve => setTimeout(resolve, 500));

    pendingInvitations.value = pendingInvitations.value.filter(
      inv => inv.id !== invitationId
    );
    message.success('已拒绝邀请');
  } catch (error) {
    console.error('Reject invitation failed:', error);
    message.error('拒绝失败：' + error.message);
  }
};

// 处理下拉菜单操作
const handleAction = (key, projectId) => {
  if (key === 'manage') {
    // TODO: 打开管理协作者对话框
    message.info('管理协作者功能开发中...');
  } else if (key === 'leave') {
    Modal.confirm({
      title: '确认退出',
      content: '确定要退出这个协作项目吗？',
      okText: '退出',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          // TODO: 调用后端API退出协作
          await new Promise(resolve => setTimeout(resolve, 500));

          collaborationProjects.value = collaborationProjects.value.filter(
            p => p.id !== projectId
          );
          message.success('已退出协作项目');
        } catch (error) {
          console.error('Leave project failed:', error);
          message.error('退出失败：' + error.message);
        }
      },
    });
  }
};

// 加载协作项目（混合真实数据和模拟数据）
const loadCollaborationProjects = async () => {
  // TODO: 从后端API获取实际数据

  // 1. 从真实项目中获取（作为示例）
  const realProjects = projectStore.projects.slice(0, 2).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    project_type: p.project_type,
    isOwner: true,
    myRole: 'owner',
    collaborators: [
      { did: 'did:chainless:self', name: '我' },
    ],
    updated_at: p.updated_at,
  }));

  // 2. 模拟协作数据（用于演示）
  const mockProjects = [
    {
      id: 'collab-demo-1',
      name: '【演示】ChainlessChain Web3协作文档',
      description: '去中心化协作文档项目，使用DID进行身份验证和权限管理（演示数据）',
      project_type: 'document',
      isOwner: true,
      myRole: 'owner',
      collaborators: [
        { did: 'did:chainless:abc123', name: '张三' },
        { did: 'did:chainless:def456', name: '李四' },
        { did: 'did:chainless:ghi789', name: '王五' },
      ],
      updated_at: Date.now() - 3600000,
      _isDemo: true,
    },
    {
      id: 'collab-demo-2',
      name: '【演示】去中心化交易平台前端',
      description: 'Web3交易平台的React前端开发（演示数据）',
      project_type: 'web',
      isOwner: false,
      myRole: 'editor',
      collaborators: [
        { did: 'did:chainless:owner1', name: '项目负责人' },
        { did: 'did:chainless:member1', name: '成员A' },
        { did: 'did:chainless:member2', name: '成员B' },
        { did: 'did:chainless:member3', name: '成员C' },
        { did: 'did:chainless:member4', name: '成员D' },
        { did: 'did:chainless:member5', name: '成员E' },
      ],
      updated_at: Date.now() - 7200000,
      _isDemo: true,
    },
  ];

  // 3. 合并真实项目和模拟数据
  collaborationProjects.value = [...realProjects, ...mockProjects];

  // 模拟邀请数据
  pendingInvitations.value = [
    {
      id: 'inv-1',
      inviter: {
        did: 'did:chainless:inviter1',
        name: '赵六',
      },
      project: {
        name: '数据分析项目',
        description: '基于区块链的数据分析平台',
      },
      role: 'editor',
      created_at: Date.now() - 1800000,
    },
  ];
};

// 组件挂载
onMounted(async () => {
  loading.value = true;
  try {
    // 从localStorage恢复视图模式
    const savedViewMode = localStorage.getItem('collaboration_view_mode');
    if (savedViewMode) {
      viewMode.value = savedViewMode;
    }

    // 加载协作项目
    await loadCollaborationProjects();
  } catch (error) {
    console.error('Failed to load collaboration projects:', error);
    message.error('加载失败：' + error.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.collaboration-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

/* 页面头部 */
.page-header {
  background: white;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #1f2937;
}

.header-left p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

.header-right {
  display: flex;
  gap: 12px;
}

/* 标签页 */
.tabs-container {
  background: white;
  border-radius: 8px;
  padding: 0 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.tabs-container :deep(.ant-tabs-tab) {
  font-size: 15px;
  padding: 16px 0;
}

/* 筛选栏 */
.filter-bar {
  background: white;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-left {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

/* 加载状态 */
.loading-container {
  background: white;
  border-radius: 8px;
  padding: 80px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 邀请通知 */
.invitations-container {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.invitations-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.invitation-card {
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  transition: all 0.3s;
}

.invitation-card:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}

.invitation-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.invitation-info h4 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.invitation-info p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

.invitation-body h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: #374151;
}

.invitation-body p {
  margin: 0 0 12px 0;
  color: #6b7280;
  font-size: 14px;
}

.invitation-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: #9ca3af;
  margin-bottom: 16px;
}

.invitation-meta span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.invitation-actions {
  display: flex;
  gap: 8px;
}

/* 项目容器 */
.projects-container {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 网格视图 */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

.collaboration-project-card {
  border-radius: 8px;
  border: 2px solid #e5e7eb;
  overflow: hidden;
  transition: all 0.3s;
  background: white;
}

.collaboration-project-card:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
}

.card-header {
  padding: 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.project-icon {
  font-size: 24px;
  color: white;
}

.card-body {
  padding: 20px;
}

.card-body h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.description {
  color: #6b7280;
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 16px 0;
  height: 42px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.collaborators {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.collaborator-count {
  font-size: 13px;
  color: #6b7280;
}

.meta-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #9ca3af;
}

.meta-item :deep(.anticon) {
  font-size: 14px;
}

.card-footer {
  padding: 16px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

/* 列表视图 */
.projects-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.collaboration-project-item {
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 20px;
  transition: all 0.3s;
  background: white;
}

.collaboration-project-item:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.15);
}

.item-icon {
  font-size: 40px;
  color: #667eea;
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.item-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.item-content p {
  margin: 0 0 12px 0;
  color: #6b7280;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  gap: 24px;
  align-items: center;
  font-size: 13px;
  color: #9ca3af;
}

.item-meta span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.collaborators-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 空状态 */
.empty-state {
  background: white;
  border-radius: 8px;
  padding: 80px 40px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.empty-icon {
  font-size: 80px;
  color: #d1d5db;
  margin-bottom: 24px;
}

.empty-state h3 {
  font-size: 20px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 8px 0;
}

.empty-state p {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}
</style>
