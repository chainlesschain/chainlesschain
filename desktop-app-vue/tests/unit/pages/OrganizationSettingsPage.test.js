import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import OrganizationSettingsPage from '@/pages/OrganizationSettingsPage.vue';

// Mock ant-design-vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
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
  back: vi.fn(),
  replace: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
}));

// Mock identity store
const mockIdentityStore = {
  primaryDID: 'did:chainlesschain:currentuser',
  currentOrgId: 'org-123',
  isOrganizationContext: true,
  organizations: [
    {
      org_id: 'org-123',
      role: 'owner',
    },
  ],
  leaveOrganization: vi.fn().mockResolvedValue(),
  switchContext: vi.fn().mockResolvedValue(),
};

vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => mockIdentityStore,
}));

// Mock window.ipc and window.electronAPI
const mockOrgInfo = {
  org_id: 'org-123',
  org_did: 'did:chainlesschain:org:org-123',
  owner_did: 'did:chainlesschain:owner',
  name: 'Test Organization',
  type: 'startup',
  description: 'A test organization',
  avatar: 'https://example.com/avatar.jpg',
  created_at: 1704067200000,
  updated_at: 1704153600000,
  settings_json: JSON.stringify({
    visibility: 'private',
    maxMembers: 100,
    allowMemberInvite: true,
    defaultMemberRole: 'member',
  }),
};

const mockMembers = [
  { member_did: 'did:user1' },
  { member_did: 'did:user2' },
];

const mockActivities = [
  {
    id: 1,
    action_type: 'create_organization',
    created_at: 1704067200000,
  },
  {
    id: 2,
    action_type: 'add_member',
    created_at: 1704153600000,
  },
];

global.window = global.window || {};
global.window.ipc = {
  invoke: vi.fn(),
};
global.window.electronAPI = {
  invoke: vi.fn(),
};

global.FileReader = class {
  readAsDataURL() {
    setTimeout(() => {
      this.onload({ target: { result: 'data:image/png;base64,ABC123' } });
    }, 0);
  }
};

describe('OrganizationSettingsPage.vue', () => {
  let wrapper;

  const createWrapper = (props = {}) => {
    return mount(OrganizationSettingsPage, {
      props,
      global: {
        stubs: {
          'a-card': true,
          'a-form': true,
          'a-form-item': true,
          'a-row': true,
          'a-col': true,
          'a-input': true,
          'a-select': true,
          'a-select-option': true,
          'a-textarea': true,
          'a-avatar': true,
          'a-upload': true,
          'a-button': true,
          'a-space': true,
          'a-descriptions': true,
          'a-descriptions-item': true,
          'a-typography-paragraph': true,
          'a-alert': true,
          'a-radio-group': true,
          'a-radio': true,
          'a-input-number': true,
          'a-checkbox': true,
          'a-switch': true,
          'a-typography-text': true,
          'a-tag': true,
          'a-divider': true,
          'a-list': true,
          'a-list-item': true,
          'a-list-item-meta': true,
          'a-modal': true,
          SettingOutlined: true,
          DeleteOutlined: true,
          TeamOutlined: true,
          UploadOutlined: true,
          QuestionCircleOutlined: true,
          CloudSyncOutlined: true,
          DatabaseOutlined: true,
          SafetyOutlined: true,
          SafetyCertificateOutlined: true,
          CheckCircleOutlined: true,
          ExportOutlined: true,
          SyncOutlined: true,
          UserAddOutlined: true,
          EditOutlined: true,
          LogoutOutlined: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.ipc.invoke.mockImplementation((channel, ...args) => {
      if (channel === 'org:get-organization') {
        return Promise.resolve(mockOrgInfo);
      }
      if (channel === 'org:get-members') {
        return Promise.resolve(mockMembers);
      }
      if (channel === 'org:get-activities') {
        return Promise.resolve(mockActivities);
      }
      if (channel === 'db:get-context-path') {
        return Promise.resolve('/path/to/database');
      }
      return Promise.resolve();
    });
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

    it('应该在挂载时加载组织信息', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.ipc.invoke).toHaveBeenCalledWith('org:get-organization', 'org-123');
      expect(wrapper.vm.currentOrgInfo).toEqual(mockOrgInfo);
    });

    it('应该填充组织表单数据', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.orgForm.name).toBe('Test Organization');
      expect(wrapper.vm.orgForm.type).toBe('startup');
      expect(wrapper.vm.orgForm.description).toBe('A test organization');
    });

    it('应该解析设置JSON', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.settingsForm.visibility).toBe('private');
      expect(wrapper.vm.settingsForm.maxMembers).toBe(100);
      expect(wrapper.vm.settingsForm.allowMemberInvite).toBe(true);
    });

    it('应该加载成员数量', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.memberCount).toBe(2);
    });

    it('应该加载数据库路径', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.databasePath).toBe('/path/to/database');
    });

    it('应该加载活动日志', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.recentActivities).toEqual(mockActivities);
    });

    it('应该在非组织上下文时警告用户', async () => {
      mockIdentityStore.isOrganizationContext = false;
      const { message } = require('ant-design-vue');
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizationInfo();

      expect(message.warning).toHaveBeenCalledWith('请先切换到组织身份');
      mockIdentityStore.isOrganizationContext = true;
    });

    it('应该处理加载组织信息失败', async () => {
      window.ipc.invoke.mockRejectedValue(new Error('Load failed'));
      const { message } = require('ant-design-vue');
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith('加载组织信息失败');
    });
  });

  // 保存基本信息
  describe('Save Basic Info', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能保存组织基本信息', async () => {
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: true });

      wrapper.vm.orgForm.name = 'Updated Organization';
      wrapper.vm.orgForm.type = 'company';

      await wrapper.vm.handleSaveBasicInfo();

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        'org:update-organization',
        expect.objectContaining({
          orgId: 'org-123',
          name: 'Updated Organization',
          type: 'company',
        })
      );
      expect(message.success).toHaveBeenCalledWith('保存成功');
    });

    it('应该在保存成功后重新加载信息', async () => {
      window.ipc.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.handleSaveBasicInfo();

      expect(window.ipc.invoke).toHaveBeenCalledWith('org:get-organization', 'org-123');
    });

    it('应该处理保存失败（返回错误）', async () => {
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({
        success: false,
        error: 'Name already exists',
      });

      await wrapper.vm.handleSaveBasicInfo();

      expect(message.error).toHaveBeenCalledWith('Name already exists');
    });

    it('应该处理保存失败（异常）', async () => {
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockRejectedValue(new Error('Save failed'));

      await wrapper.vm.handleSaveBasicInfo();

      expect(message.error).toHaveBeenCalledWith('保存失败');
    });

    it('应该在未找到组织时显示错误', async () => {
      mockIdentityStore.currentOrgId = null;
      const { message } = require('ant-design-vue');

      await wrapper.vm.handleSaveBasicInfo();

      expect(message.error).toHaveBeenCalledWith('未找到当前组织');
      mockIdentityStore.currentOrgId = 'org-123';
    });
  });

  // 保存设置
  describe('Save Settings', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能保存组织设置', async () => {
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: true });

      wrapper.vm.settingsForm.p2pEnabled = true;
      wrapper.vm.settingsForm.syncMode = 'auto';

      await wrapper.vm.handleSaveSettings();

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        'org:update-organization',
        expect.objectContaining({
          orgId: 'org-123',
          p2pEnabled: true,
          syncMode: 'auto',
        })
      );
      expect(message.success).toHaveBeenCalledWith('设置已保存');
    });

    it('应该处理保存设置失败', async () => {
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({
        success: false,
        error: 'Invalid settings',
      });

      await wrapper.vm.handleSaveSettings();

      expect(message.error).toHaveBeenCalledWith('Invalid settings');
    });
  });

  // 上传头像
  describe('Upload Avatar', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能上传组织头像', async () => {
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: true });

      const file = new File([''], 'avatar.png', { type: 'image/png' });

      const result = wrapper.vm.handleAvatarUpload(file);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        'org:update-organization',
        expect.objectContaining({
          orgId: 'org-123',
          avatar: 'data:image/png;base64,ABC123',
        })
      );

      expect(result).toBe(false);
    });

    it('应该在上传成功后更新表单头像', async () => {
      window.ipc.invoke.mockResolvedValue({ success: true });

      const file = new File([''], 'avatar.png', { type: 'image/png' });
      wrapper.vm.handleAvatarUpload(file);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(wrapper.vm.orgForm.avatar).toBe('data:image/png;base64,ABC123');
    });

    it('应该处理上传失败', async () => {
      window.ipc.invoke.mockResolvedValue({
        success: false,
        error: 'Upload failed',
      });
      const { message } = require('ant-design-vue');

      const file = new File([''], 'avatar.png', { type: 'image/png' });
      wrapper.vm.handleAvatarUpload(file);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(message.error).toHaveBeenCalledWith('Upload failed');
    });
  });

  // 跳转到角色管理
  describe('Navigate to Roles Page', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能跳转到角色管理页面', () => {
      wrapper.vm.handleGoToRolesPage();

      expect(mockRouter.push).toHaveBeenCalledWith('/organization/roles');
    });
  });

  // 备份数据库
  describe('Backup Database', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能备份数据库', async () => {
      const { message } = require('ant-design-vue');
      window.electronAPI.invoke.mockResolvedValue({
        success: true,
        backupPath: '/path/to/backup.db',
      });

      await wrapper.vm.handleBackupDatabase();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith('db:backup');
      expect(message.success).toHaveBeenCalledWith('数据备份成功: /path/to/backup.db');
    });

    it('应该处理备份失败', async () => {
      const { message } = require('ant-design-vue');
      window.electronAPI.invoke.mockResolvedValue({
        success: false,
        error: 'Backup failed',
      });

      await wrapper.vm.handleBackupDatabase();

      expect(message.error).toHaveBeenCalledWith('Backup failed');
    });

    it('应该处理备份异常', async () => {
      const { message } = require('ant-design-vue');
      window.electronAPI.invoke.mockRejectedValue(new Error('Error'));

      await wrapper.vm.handleBackupDatabase();

      expect(message.error).toHaveBeenCalledWith('备份失败');
    });
  });

  // 立即同步
  describe('Sync Now', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能触发P2P同步', async () => {
      const { message } = require('ant-design-vue');
      window.electronAPI.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.handleSyncNow();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'p2p:sync-organization',
        { orgId: 'org-123' }
      );
      expect(message.success).toHaveBeenCalledWith('同步完成');
    });

    it('应该处理同步失败', async () => {
      const { message } = require('ant-design-vue');
      window.electronAPI.invoke.mockResolvedValue({
        success: false,
        error: 'Sync failed',
      });

      await wrapper.vm.handleSyncNow();

      expect(message.error).toHaveBeenCalledWith('Sync failed');
    });

    it('应该处理同步异常', async () => {
      const { message } = require('ant-design-vue');
      window.electronAPI.invoke.mockRejectedValue(new Error('Error'));

      await wrapper.vm.handleSyncNow();

      expect(message.error).toHaveBeenCalledWith('同步失败');
    });
  });

  // 离开组织
  describe('Leave Organization', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能离开组织', async () => {
      const { Modal, message } = require('ant-design-vue');
      mockIdentityStore.leaveOrganization.mockResolvedValue();

      wrapper.vm.handleLeaveOrg();

      expect(Modal.confirm).toHaveBeenCalled();
      await wrapper.vm.$nextTick();

      expect(mockIdentityStore.leaveOrganization).toHaveBeenCalledWith('org-123');
      expect(message.success).toHaveBeenCalledWith('已离开组织');
      expect(mockRouter.push).toHaveBeenCalledWith('/');
    });

    it('应该处理离开组织失败', async () => {
      const { Modal, message } = require('ant-design-vue');
      mockIdentityStore.leaveOrganization.mockRejectedValue(new Error('Failed'));

      wrapper.vm.handleLeaveOrg();

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith('离开组织失败');
    });
  });

  // 删除组织
  describe('Delete Organization', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该能删除组织', async () => {
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue();
      mockIdentityStore.switchContext.mockResolvedValue();

      wrapper.vm.deleteConfirmName = 'Test Organization';
      await wrapper.vm.handleDeleteOrg();

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        'org:delete-organization',
        'org-123',
        'did:chainlesschain:currentuser'
      );
      expect(message.success).toHaveBeenCalledWith('组织已删除');
      expect(wrapper.vm.showDeleteOrgModal).toBe(false);
      expect(mockIdentityStore.switchContext).toHaveBeenCalledWith('personal');
      expect(mockRouter.push).toHaveBeenCalledWith('/');
    });

    it('应该在名称不匹配时显示错误', async () => {
      const { message } = require('ant-design-vue');

      wrapper.vm.deleteConfirmName = 'Wrong Name';
      await wrapper.vm.handleDeleteOrg();

      expect(message.error).toHaveBeenCalledWith('组织名称不匹配');
      expect(window.ipc.invoke).not.toHaveBeenCalledWith('org:delete-organization');
    });

    it('应该处理删除组织失败', async () => {
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockRejectedValue(new Error('Delete failed'));

      wrapper.vm.deleteConfirmName = 'Test Organization';
      await wrapper.vm.handleDeleteOrg();

      expect(message.error).toHaveBeenCalledWith('删除组织失败');
    });
  });

  // 工具函数
  describe('Utility Functions', () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it('应该格式化DID', () => {
      const shortDID = 'did:chainlesschain:abc';
      expect(wrapper.vm.formatDID(shortDID)).toBe(shortDID);

      const longDID = 'did:chainlesschain:verylongidentifierstring12345678901234567890';
      const formatted = wrapper.vm.formatDID(longDID);
      expect(formatted).toContain('...');
    });

    it('应该处理空DID', () => {
      expect(wrapper.vm.formatDID(null)).toBe('');
      expect(wrapper.vm.formatDID(undefined)).toBe('');
    });

    it('应该格式化时间戳', () => {
      const timestamp = 1704067200000;
      const formatted = wrapper.vm.formatDate(timestamp);
      expect(formatted).toBeTruthy();
    });

    it('应该处理空时间戳', () => {
      expect(wrapper.vm.formatDate(null)).toBe('');
    });

    it('应该返回正确的活动图标', () => {
      const icons = {
        create_organization: 'TeamOutlined',
        join_organization: 'UserAddOutlined',
        add_member: 'UserAddOutlined',
        remove_member: 'DeleteOutlined',
        update_member_role: 'EditOutlined',
        leave_organization: 'LogoutOutlined',
      };

      Object.keys(icons).forEach(actionType => {
        const icon = wrapper.vm.getActivityIcon(actionType);
        expect(icon).toBeDefined();
      });
    });

    it('应该返回默认图标对于未知活动类型', () => {
      const icon = wrapper.vm.getActivityIcon('unknown_action');
      expect(icon).toBeDefined();
    });

    it('应该返回正确的活动标题', () => {
      expect(wrapper.vm.getActivityTitle({ action_type: 'create_organization' })).toBe(
        '创建了组织'
      );
      expect(wrapper.vm.getActivityTitle({ action_type: 'add_member' })).toBe('添加了新成员');
    });

    it('应该返回原action_type对于未知活动', () => {
      const activity = { action_type: 'unknown_action' };
      expect(wrapper.vm.getActivityTitle(activity)).toBe('unknown_action');
    });
  });

  // 权限检查
  describe('Permissions', () => {
    it('应该识别所有者可以管理组织', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canManageOrg).toBe(true);
    });

    it('应该识别管理员可以管理组织', async () => {
      mockIdentityStore.organizations[0].role = 'admin';
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canManageOrg).toBe(true);
      mockIdentityStore.organizations[0].role = 'owner';
    });

    it('应该识别普通成员不能管理组织', async () => {
      mockIdentityStore.organizations[0].role = 'member';
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canManageOrg).toBe(false);
      mockIdentityStore.organizations[0].role = 'owner';
    });

    it('应该识别所有者身份', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isOwner).toBe(true);
    });

    it('应该识别非所有者身份', async () => {
      mockIdentityStore.organizations[0].role = 'admin';
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isOwner).toBe(false);
      mockIdentityStore.organizations[0].role = 'owner';
    });

    it('应该在非组织上下文时返回null角色', () => {
      mockIdentityStore.isOrganizationContext = false;
      wrapper = createWrapper();

      expect(wrapper.vm.currentUserRole).toBeNull();
      mockIdentityStore.isOrganizationContext = true;
    });
  });

  // 加载状态
  describe('Loading States', () => {
    it('应该在加载时设置loading状态', async () => {
      let resolvePromise;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      window.ipc.invoke.mockReturnValue(promise);

      wrapper = createWrapper();
      expect(wrapper.vm.loading).toBe(true);

      resolvePromise(mockOrgInfo);
      await wrapper.vm.$nextTick();
      await promise;

      expect(wrapper.vm.loading).toBe(false);
    });

    it('应该在保存时设置saving状态', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      let resolvePromise;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      window.ipc.invoke.mockReturnValue(promise);

      const savePromise = wrapper.vm.handleSaveBasicInfo();
      expect(wrapper.vm.saving).toBe(true);

      resolvePromise({ success: true });
      await savePromise;

      expect(wrapper.vm.saving).toBe(false);
    });

    it('应该在同步时设置syncing状态', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      let resolvePromise;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      window.electronAPI.invoke.mockReturnValue(promise);

      const syncPromise = wrapper.vm.handleSyncNow();
      expect(wrapper.vm.syncing).toBe(true);

      resolvePromise({ success: true });
      await syncPromise;

      expect(wrapper.vm.syncing).toBe(false);
    });

    it('应该在删除时设置deleting状态', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.deleteConfirmName = 'Test Organization';

      let resolvePromise;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      window.ipc.invoke.mockReturnValue(promise);

      const deletePromise = wrapper.vm.handleDeleteOrg();
      expect(wrapper.vm.deleting).toBe(true);

      resolvePromise();
      await deletePromise;

      expect(wrapper.vm.deleting).toBe(false);
    });

    it('应该在加载活动时设置loadingActivities状态', async () => {
      wrapper = createWrapper();

      let resolvePromise;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      window.ipc.invoke.mockReturnValue(promise);

      const loadPromise = wrapper.vm.loadActivities();
      expect(wrapper.vm.loadingActivities).toBe(true);

      resolvePromise(mockActivities);
      await loadPromise;

      expect(wrapper.vm.loadingActivities).toBe(false);
    });
  });

  // 边界情况
  describe('Edge Cases', () => {
    it('应该处理缺失settings_json', async () => {
      const orgWithoutSettings = { ...mockOrgInfo, settings_json: null };
      window.ipc.invoke.mockImplementation((channel) => {
        if (channel === 'org:get-organization') {
          return Promise.resolve(orgWithoutSettings);
        }
        return Promise.resolve([]);
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.settingsForm.visibility).toBeDefined();
    });

    it('应该处理空成员列表', async () => {
      window.ipc.invoke.mockImplementation((channel) => {
        if (channel === 'org:get-organization') {
          return Promise.resolve(mockOrgInfo);
        }
        if (channel === 'org:get-members') {
          return Promise.resolve(null);
        }
        return Promise.resolve([]);
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.memberCount).toBe(0);
    });

    it('应该处理空活动列表', async () => {
      window.ipc.invoke.mockImplementation((channel) => {
        if (channel === 'org:get-organization') {
          return Promise.resolve(mockOrgInfo);
        }
        if (channel === 'org:get-activities') {
          return Promise.resolve(null);
        }
        return Promise.resolve([]);
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.recentActivities).toEqual([]);
    });

    it('应该处理缺失描述和头像', async () => {
      const orgWithoutOptionals = {
        ...mockOrgInfo,
        description: null,
        avatar: null,
      };
      window.ipc.invoke.mockImplementation((channel) => {
        if (channel === 'org:get-organization') {
          return Promise.resolve(orgWithoutOptionals);
        }
        return Promise.resolve([]);
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.orgForm.description).toBe('');
      expect(wrapper.vm.orgForm.avatar).toBe('');
    });
  });
});
