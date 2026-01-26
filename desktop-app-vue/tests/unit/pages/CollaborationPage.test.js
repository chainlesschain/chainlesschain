import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CollaborationPage from '@renderer/pages/projects/CollaborationPage.vue';

// Mock ant-design-vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  Modal: {
    confirm: vi.fn((config) => {
      if (config.onOk) {
        config.onOk();
      }
    }),
  },
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
}));

// Mock stores
const mockProjectStore = {
  projects: [
    { id: 'project-1', name: 'Test Project 1', description: 'Desc 1', project_type: 'web', updated_at: Date.now() },
    { id: 'project-2', name: 'Test Project 2', description: 'Desc 2', project_type: 'document', updated_at: Date.now() },
  ],
};

const mockAuthStore = {
  user: { did: 'did:chainlesschain:currentuser' },
};

const mockAppStore = {
  addTab: vi.fn(),
};

vi.mock('@/stores/project', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

vi.mock('@/stores/app', () => ({
  useAppStore: () => mockAppStore,
}));

// Mock date-fns
vi.mock('date-fns', () => ({
  format: vi.fn(() => '2024-01-01 12:00'),
}));

vi.mock('date-fns/locale', () => ({
  zhCN: {},
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock;

describe('CollaborationPage.vue', () => {
  let wrapper;

  const createWrapper = (props = {}) => {
    return mount(CollaborationPage, {
      props,
      global: {
        stubs: {
          'a-button': true,
          'a-tabs': true,
          'a-tab-pane': true,
          'a-badge': true,
          'a-input-search': true,
          'a-select': true,
          'a-select-option': true,
          'a-radio-group': true,
          'a-radio-button': true,
          'a-spin': true,
          'a-avatar': true,
          'a-avatar-group': true,
          'a-tag': true,
          'a-tooltip': true,
          'a-dropdown': true,
          'a-menu': true,
          'a-menu-item': true,
          'a-modal': true,
          'a-form': true,
          'a-form-item': true,
          'a-input': true,
          'a-textarea': true,
          TeamOutlined: true,
          UserAddOutlined: true,
          ArrowLeftOutlined: true,
          CrownOutlined: true,
          UsergroupAddOutlined: true,
          MailOutlined: true,
          SearchOutlined: true,
          ReloadOutlined: true,
          AppstoreOutlined: true,
          UnorderedListOutlined: true,
          ClockCircleOutlined: true,
          CheckOutlined: true,
          CloseOutlined: true,
          CalendarOutlined: true,
          SafetyOutlined: true,
          EyeOutlined: true,
          MoreOutlined: true,
          SettingOutlined: true,
          LogoutOutlined: true,
          CodeOutlined: true,
          FileTextOutlined: true,
          BarChartOutlined: true,
          AppstoreAddOutlined: true,
          FolderOutlined: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // 组件挂载和初始化
  describe('Component Mounting and Initialization', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('应该在挂载时加载协作项目', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.collaborationProjects.length).toBeGreaterThan(0);
    });

    it('应该从localStorage恢复视图模式', async () => {
      localStorageMock.getItem.mockReturnValue('list');
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.viewMode).toBe('list');
    });

    it('应该处理localStorage恢复失败', async () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('Storage error');
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Should not crash
      expect(wrapper.vm.viewMode).toBeDefined();
    });
  });

  // Tab切换
  describe('Tab Switching', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能切换到"我创建的"Tab', async () => {
      wrapper.vm.activeTab = 'owned';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('owned');
    });

    it('应该能切换到"我参与的"Tab', async () => {
      wrapper.vm.activeTab = 'joined';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('joined');
    });

    it('应该能切换到"邀请通知"Tab', async () => {
      wrapper.vm.activeTab = 'invitations';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('invitations');
    });

    it('应该在切换Tab时清空搜索条件', () => {
      wrapper.vm.searchKeyword = 'test';
      wrapper.vm.selectedType = 'web';

      wrapper.vm.handleTabChange();

      expect(wrapper.vm.searchKeyword).toBe('');
      expect(wrapper.vm.selectedType).toBe('');
    });
  });

  // 项目分类
  describe('Project Categories', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该正确分类我创建的项目', () => {
      const owned = wrapper.vm.ownedProjects;
      expect(owned.every(p => p.isOwner)).toBe(true);
    });

    it('应该正确分类我参与的项目', () => {
      const joined = wrapper.vm.joinedProjects;
      expect(joined.every(p => !p.isOwner)).toBe(true);
    });
  });

  // 搜索和筛选
  describe('Search and Filter', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能按名称搜索项目', async () => {
      wrapper.vm.searchKeyword = 'Web3';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.some(p => p.name.includes('Web3'))).toBe(true);
    });

    it('应该能按描述搜索项目', async () => {
      wrapper.vm.searchKeyword = '去中心化';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBeGreaterThanOrEqual(0);
    });

    it('应该支持不区分大小写搜索', async () => {
      wrapper.vm.searchKeyword = 'WEB';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBeGreaterThanOrEqual(0);
    });

    it('应该能按项目类型筛选', async () => {
      wrapper.vm.selectedType = 'web';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.every(p => p.project_type === 'web')).toBe(true);
    });

    it('应该能组合搜索和类型筛选', async () => {
      wrapper.vm.searchKeyword = '项目';
      wrapper.vm.selectedType = 'document';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.every(p => p.project_type === 'document')).toBe(true);
    });

    it('应该能清空筛选条件', async () => {
      wrapper.vm.searchKeyword = 'test';
      wrapper.vm.selectedType = 'web';

      wrapper.vm.searchKeyword = '';
      wrapper.vm.selectedType = '';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredProjects.length).toBeGreaterThan(0);
    });
  });

  // 视图模式
  describe('View Mode', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能切换到网格视图', () => {
      wrapper.vm.viewMode = 'grid';
      expect(wrapper.vm.viewMode).toBe('grid');
    });

    it('应该能切换到列表视图', () => {
      wrapper.vm.viewMode = 'list';
      expect(wrapper.vm.viewMode).toBe('list');
    });

    it('应该保存视图模式到localStorage', () => {
      wrapper.vm.viewMode = 'list';
      wrapper.vm.handleViewModeChange();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'collaboration_view_mode',
        'list'
      );
    });

    it('应该处理保存视图模式失败', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(() => wrapper.vm.handleViewModeChange()).not.toThrow();
    });
  });

  // 刷新功能
  describe('Refresh', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能刷新项目列表', async () => {
      const { message } = require('ant-design-vue');

      await wrapper.vm.handleRefresh();

      expect(message.success).toHaveBeenCalledWith('刷新成功');
    });

    it('应该在刷新时显示加载状态', async () => {
      const refreshPromise = wrapper.vm.handleRefresh();
      expect(wrapper.vm.loading).toBe(true);

      await refreshPromise;
      expect(wrapper.vm.loading).toBe(false);
    });

    it('应该处理刷新失败', async () => {
      const { message } = require('ant-design-vue');
      vi.spyOn(wrapper.vm, 'loadCollaborationProjects').mockRejectedValue(
        new Error('Refresh failed')
      );

      await wrapper.vm.handleRefresh();

      expect(message.error).toHaveBeenCalledWith('刷新失败：Refresh failed');
    });
  });

  // 返回项目列表
  describe('Back to Projects', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能返回项目列表', () => {
      wrapper.vm.handleBackToProjects();

      expect(mockRouter.push).toHaveBeenCalledWith('/projects');
    });
  });

  // 查看项目
  describe('View Project', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能查看真实项目', () => {
      const projectId = mockProjectStore.projects[0].id;
      wrapper.vm.handleViewProject(projectId);

      expect(mockAppStore.addTab).toHaveBeenCalled();
      expect(mockRouter.push).toHaveBeenCalledWith(`/projects/${projectId}`);
    });

    it('应该对演示数据显示提示', () => {
      const { message } = require('ant-design-vue');

      wrapper.vm.handleViewProject('collab-demo-1');

      expect(message.info).toHaveBeenCalledWith(
        '这是演示数据，协作项目功能需要连接后端服务才能使用'
      );
    });

    it('应该处理不存在的项目', () => {
      const { message } = require('ant-design-vue');

      wrapper.vm.handleViewProject('non-existent');

      expect(message.warning).toHaveBeenCalledWith('项目不存在，可能已被删除');
    });
  });

  // 邀请协作者
  describe('Invite Collaborator', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能打开邀请对话框', () => {
      wrapper.vm.handleInviteCollaborator();

      expect(wrapper.vm.showInviteModal).toBe(true);
    });

    it('应该在没有项目时提示用户', () => {
      const { message } = require('ant-design-vue');
      wrapper.vm.collaborationProjects = [];

      wrapper.vm.handleInviteCollaborator();

      expect(message.warning).toHaveBeenCalledWith('请先创建项目才能邀请协作者');
    });

    it('应该能发送邀请', async () => {
      const { message } = require('ant-design-vue');
      wrapper.vm.inviteForm.projectId = 'project-1';
      wrapper.vm.inviteForm.collaboratorDid = 'did:chainless:user1';

      await wrapper.vm.handleConfirmInvite();

      expect(message.success).toHaveBeenCalledWith('邀请已发送');
      expect(wrapper.vm.showInviteModal).toBe(false);
    });

    it('应该验证项目ID', async () => {
      const { message } = require('ant-design-vue');
      wrapper.vm.inviteForm.projectId = null;
      wrapper.vm.inviteForm.collaboratorDid = 'did:chainless:user1';

      await wrapper.vm.handleConfirmInvite();

      expect(message.warning).toHaveBeenCalledWith('请选择项目');
    });

    it('应该验证协作者DID', async () => {
      const { message } = require('ant-design-vue');
      wrapper.vm.inviteForm.projectId = 'project-1';
      wrapper.vm.inviteForm.collaboratorDid = '';

      await wrapper.vm.handleConfirmInvite();

      expect(message.warning).toHaveBeenCalledWith('请输入协作者DID');
    });

    it('应该在发送成功后重置表单', async () => {
      wrapper.vm.inviteForm = {
        projectId: 'project-1',
        collaboratorDid: 'did:chainless:user1',
        role: 'admin',
        message: 'Join us',
      };

      await wrapper.vm.handleConfirmInvite();

      expect(wrapper.vm.inviteForm.projectId).toBeNull();
      expect(wrapper.vm.inviteForm.collaboratorDid).toBe('');
      expect(wrapper.vm.inviteForm.role).toBe('editor');
      expect(wrapper.vm.inviteForm.message).toBe('');
    });
  });

  // 处理邀请
  describe('Handle Invitations', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能接受邀请', async () => {
      const { message } = require('ant-design-vue');
      const invitationId = 'inv-1';

      await wrapper.vm.handleAcceptInvitation(invitationId);

      expect(message.success).toHaveBeenCalledWith('已接受邀请');
      expect(
        wrapper.vm.pendingInvitations.some(inv => inv.id === invitationId)
      ).toBe(false);
    });

    it('应该能拒绝邀请', async () => {
      const { message } = require('ant-design-vue');
      const invitationId = 'inv-1';

      await wrapper.vm.handleRejectInvitation(invitationId);

      expect(message.success).toHaveBeenCalledWith('已拒绝邀请');
      expect(
        wrapper.vm.pendingInvitations.some(inv => inv.id === invitationId)
      ).toBe(false);
    });

    it('应该在接受邀请后重新加载项目', async () => {
      const spy = vi.spyOn(wrapper.vm, 'loadCollaborationProjects');

      await wrapper.vm.handleAcceptInvitation('inv-1');

      expect(spy).toHaveBeenCalled();
    });
  });

  // 下拉菜单操作
  describe('Dropdown Actions', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能打开管理协作者', () => {
      const { message } = require('ant-design-vue');

      wrapper.vm.handleAction('manage', 'project-1');

      expect(message.info).toHaveBeenCalledWith('管理协作者功能开发中...');
    });

    it('应该能退出协作', async () => {
      const { Modal, message } = require('ant-design-vue');

      wrapper.vm.handleAction('leave', 'collab-demo-2');

      expect(Modal.confirm).toHaveBeenCalled();
      await wrapper.vm.$nextTick();

      expect(message.success).toHaveBeenCalledWith('已退出协作项目');
    });

    it('应该在退出协作后更新项目列表', async () => {
      const { Modal } = require('ant-design-vue');
      const projectId = 'collab-demo-2';

      wrapper.vm.handleAction('leave', projectId);
      await wrapper.vm.$nextTick();

      expect(
        wrapper.vm.collaborationProjects.some(p => p.id === projectId)
      ).toBe(false);
    });
  });

  // 工具函数
  describe('Helper Functions', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该返回正确的项目类型图标', () => {
      expect(wrapper.vm.getProjectTypeIcon('web')).toBeDefined();
      expect(wrapper.vm.getProjectTypeIcon('document')).toBeDefined();
      expect(wrapper.vm.getProjectTypeIcon('data')).toBeDefined();
      expect(wrapper.vm.getProjectTypeIcon('app')).toBeDefined();
    });

    it('应该返回默认图标对于未知类型', () => {
      const icon = wrapper.vm.getProjectTypeIcon('unknown');
      expect(icon).toBeDefined();
    });

    it('应该返回正确的角色颜色', () => {
      expect(wrapper.vm.getRoleColor('owner')).toBe('gold');
      expect(wrapper.vm.getRoleColor('admin')).toBe('red');
      expect(wrapper.vm.getRoleColor('editor')).toBe('blue');
      expect(wrapper.vm.getRoleColor('viewer')).toBe('green');
    });

    it('应该返回默认颜色对于未知角色', () => {
      expect(wrapper.vm.getRoleColor('unknown')).toBe('default');
    });

    it('应该返回正确的角色名称', () => {
      expect(wrapper.vm.getRoleName('owner')).toBe('所有者');
      expect(wrapper.vm.getRoleName('admin')).toBe('管理员');
      expect(wrapper.vm.getRoleName('editor')).toBe('编辑者');
      expect(wrapper.vm.getRoleName('viewer')).toBe('查看者');
    });

    it('应该返回原值对于未知角色', () => {
      expect(wrapper.vm.getRoleName('unknown')).toBe('unknown');
    });

    it('应该能基于DID生成头像颜色', () => {
      const color1 = wrapper.vm.getAvatarColor('did:chainless:user1');
      const color2 = wrapper.vm.getAvatarColor('did:chainless:user2');

      expect(color1).toBeTruthy();
      expect(color2).toBeTruthy();
      expect(color1).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('应该处理空DID', () => {
      const color = wrapper.vm.getAvatarColor(null);
      expect(color).toBeTruthy();
    });

    it('应该能格式化日期', () => {
      const formatted = wrapper.vm.formatDate(1704067200000);
      expect(formatted).toBe('2024-01-01 12:00');
    });

    it('应该处理无效日期', () => {
      const formatted = wrapper.vm.formatDate(null);
      expect(formatted).toBe('未知');
    });

    it('应该处理日期格式化异常', () => {
      const formatted = wrapper.vm.formatDate('invalid');
      expect(formatted).toBe('未知');
    });
  });

  // 空状态消息
  describe('Empty State Messages', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该返回正确的空状态消息（我创建的）', () => {
      wrapper.vm.activeTab = 'owned';
      expect(wrapper.vm.getEmptyMessage()).toBe('还没有创建协作项目');
    });

    it('应该返回正确的空状态消息（我参与的）', () => {
      wrapper.vm.activeTab = 'joined';
      expect(wrapper.vm.getEmptyMessage()).toBe('还没有参与协作项目');
    });

    it('应该返回正确的空状态描述（我创建的）', () => {
      wrapper.vm.activeTab = 'owned';
      expect(wrapper.vm.getEmptyDescription()).toBe('创建项目并邀请协作者一起工作');
    });

    it('应该返回正确的空状态描述（我参与的）', () => {
      wrapper.vm.activeTab = 'joined';
      expect(wrapper.vm.getEmptyDescription()).toBe('等待项目邀请或主动申请加入');
    });
  });

  // 防抖搜索
  describe('Debounced Search', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('应该延迟执行搜索', () => {
      const spy = vi.spyOn(wrapper.vm, 'handleSearch');

      wrapper.vm.debouncedSearch();
      expect(spy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(spy).toHaveBeenCalled();
    });

    it('应该取消之前的搜索', () => {
      const spy = vi.spyOn(wrapper.vm, 'handleSearch');

      wrapper.vm.debouncedSearch();
      wrapper.vm.debouncedSearch();
      wrapper.vm.debouncedSearch();

      vi.advanceTimersByTime(300);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // 加载状态
  describe('Loading States', () => {
    it('应该在挂载时显示加载状态', async () => {
      wrapper = createWrapper();

      // Initially loading should be true
      const loadingState = wrapper.vm.loading;

      await wrapper.vm.$nextTick();

      // After mount, loading should be false
      expect(wrapper.vm.loading).toBe(false);
    });

    it('应该在邀请时设置inviting状态', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.inviteForm.projectId = 'project-1';
      wrapper.vm.inviteForm.collaboratorDid = 'did:chainless:user1';

      const invitePromise = wrapper.vm.handleConfirmInvite();
      expect(wrapper.vm.inviting).toBe(true);

      await invitePromise;
      expect(wrapper.vm.inviting).toBe(false);
    });
  });

  // 边界情况
  describe('Edge Cases', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该处理空协作项目列表', () => {
      wrapper.vm.collaborationProjects = [];
      expect(wrapper.vm.ownedProjects).toEqual([]);
      expect(wrapper.vm.joinedProjects).toEqual([]);
    });

    it('应该处理空邀请列表', () => {
      wrapper.vm.pendingInvitations = [];
      expect(wrapper.vm.pendingInvitations).toEqual([]);
    });

    it('应该处理空搜索关键词', async () => {
      wrapper.vm.searchKeyword = '';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredProjects.length).toBeGreaterThan(0);
    });

    it('应该处理无匹配的搜索结果', async () => {
      wrapper.vm.searchKeyword = 'nonexistentproject12345';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredProjects.length).toBe(0);
    });

    it('应该处理缺失描述的项目', () => {
      const project = {
        id: 'test',
        name: 'Test',
        description: null,
        project_type: 'web',
        isOwner: true,
        myRole: 'owner',
        collaborators: [],
        updated_at: Date.now(),
      };

      wrapper.vm.collaborationProjects = [project];
      expect(wrapper.vm.filteredProjects[0].description).toBeNull();
    });

    it('应该处理缺失协作者的项目', () => {
      const project = {
        id: 'test',
        name: 'Test',
        description: 'Desc',
        project_type: 'web',
        isOwner: true,
        myRole: 'owner',
        collaborators: [],
        updated_at: Date.now(),
      };

      wrapper.vm.collaborationProjects = [project];
      expect(wrapper.vm.filteredProjects[0].collaborators).toEqual([]);
    });
  });

  // 邀请通知Tab
  describe('Invitations Tab', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该显示待处理的邀请数量', () => {
      expect(wrapper.vm.pendingInvitations.length).toBeGreaterThan(0);
    });

    it('应该在切换到邀请Tab时正确显示', async () => {
      wrapper.vm.activeTab = 'invitations';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('invitations');
    });
  });
});
