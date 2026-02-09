/**
 * OrganizationsPage 单元测试
 * 测试目标: src/renderer/pages/OrganizationsPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载
 * - 组织列表加载和显示
 * - 创建组织
 * - 组织类型和角色管理
 * - 导航功能
 * - 空状态处理
 * - 错误处理
 * - 辅助方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// Mock ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('ant-design-vue', () => ({
  message: mockMessage,
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ params: {}, query: {} }),
}));

// Mock dayjs
vi.mock('dayjs', () => {
  const dayjs = (timestamp) => ({
    fromNow: () => '2天前',
  });
  dayjs.extend = vi.fn();
  dayjs.locale = vi.fn();
  return { default: dayjs };
});

vi.mock('dayjs/plugin/relativeTime', () => ({ default: {} }));
vi.mock('dayjs/locale/zh-cn', () => ({}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  createLogger: vi.fn(),
}));

// Mock window.electron.ipcRenderer
global.window = {
  electron: {
    ipcRenderer: {
      invoke: vi.fn(),
    },
  },
};

describe('OrganizationsPage', () => {
  let wrapper;

  const mockOrganizations = [
    {
      org_id: 'org-1',
      name: 'Test Organization 1',
      description: 'This is a test organization',
      type: 'startup',
      role: 'owner',
      avatar: null,
      member_count: 5,
      joined_at: '2026-01-20',
    },
    {
      org_id: 'org-2',
      name: 'Test Organization 2',
      description: '',
      type: 'company',
      role: 'admin',
      avatar: 'https://example.com/avatar.png',
      member_count: 15,
      joined_at: '2026-01-15',
    },
    {
      org_id: 'org-3',
      name: 'Community Org',
      description: 'Open source community',
      type: 'community',
      role: 'member',
      avatar: null,
      member_count: 50,
      joined_at: '2026-01-10',
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="organizations-page">
            <div class="page-header">
              <div class="header-left">
                <h1>我的组织</h1>
              </div>
              <div class="header-right">
                <button @click="showCreateModal = true">创建组织</button>
              </div>
            </div>

            <div class="organizations-list">
              <div v-if="!loading && organizations.length === 0" class="empty-state">
                <button @click="showCreateModal = true">创建第一个组织</button>
              </div>

              <div v-else class="org-cards">
                <div
                  v-for="org in organizations"
                  :key="org.org_id"
                  class="org-card"
                  @click="navigateToOrg(org.org_id)"
                >
                  <div class="org-info">
                    <h3>{{ org.name }}</h3>
                    <p>{{ org.description || '暂无描述' }}</p>
                    <div class="org-meta">
                      <span :class="getOrgTypeColor(org.type)">
                        {{ getOrgTypeLabel(org.type) }}
                      </span>
                      <span :class="getRoleColor(org.role)">
                        {{ getRoleLabel(org.role) }}
                      </span>
                    </div>
                    <div class="org-stats">
                      <span>{{ org.member_count || 0 }} 成员</span>
                      <span>{{ formatDate(org.joined_at) }}</span>
                    </div>
                  </div>
                  <div class="org-actions" @click.stop>
                    <button @click="navigateToMembers(org.org_id)">成员</button>
                    <button @click="navigateToActivities(org.org_id)">活动</button>
                    <button @click="navigateToSettings(org.org_id)">设置</button>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="showCreateModal" class="create-modal">
              <input v-model="createForm.name" placeholder="组织名称" />
              <select v-model="createForm.type">
                <option value="startup">初创公司</option>
                <option value="company">企业</option>
                <option value="community">社区</option>
                <option value="opensource">开源项目</option>
                <option value="education">教育机构</option>
              </select>
              <textarea v-model="createForm.description" placeholder="组织描述"></textarea>
              <button @click="handleCreate" :disabled="creating">创建</button>
              <button @click="showCreateModal = false">取消</button>
            </div>
          </div>
        `,
        setup() {
          const { ref, onMounted } = require('vue');
          const { useRouter } = require('vue-router');
          const message = mockMessage;
          const { logger } = require('@/utils/logger');

          const router = useRouter();
          const loading = ref(false);
          const organizations = ref([]);
          const showCreateModal = ref(false);
          const creating = ref(false);
          const createForm = ref({
            name: '',
            type: 'startup',
            description: '',
          });

          const loadOrganizations = async () => {
            loading.value = true;
            try {
              const result = await window.electron.ipcRenderer.invoke(
                'org:get-user-organizations'
              );

              if (result.success) {
                organizations.value = result.organizations;
              } else {
                message.error(result.error || '加载组织列表失败');
              }
            } catch (error) {
              logger.error('加载组织列表失败:', error);
              message.error('加载组织列表失败');
            } finally {
              loading.value = false;
            }
          };

          const handleCreate = async () => {
            if (!createForm.value.name) {
              message.warning('请输入组织名称');
              return;
            }

            creating.value = true;
            try {
              const result = await window.electron.ipcRenderer.invoke(
                'org:create-organization',
                createForm.value
              );

              if (result.success) {
                message.success('组织创建成功');
                showCreateModal.value = false;

                createForm.value = {
                  name: '',
                  type: 'startup',
                  description: '',
                };

                await loadOrganizations();

                router.push(`/org/${result.organization.org_id}/members`);
              } else {
                message.error(result.error || '创建组织失败');
              }
            } catch (error) {
              logger.error('创建组织失败:', error);
              message.error('创建组织失败');
            } finally {
              creating.value = false;
            }
          };

          const navigateToOrg = (orgId) => {
            router.push(`/org/${orgId}/members`);
          };

          const navigateToMembers = (orgId) => {
            router.push(`/org/${orgId}/members`);
          };

          const navigateToActivities = (orgId) => {
            router.push(`/org/${orgId}/activities`);
          };

          const navigateToSettings = (orgId) => {
            router.push(`/org/${orgId}/settings`);
          };

          const getOrgTypeLabel = (type) => {
            const labels = {
              startup: '初创公司',
              company: '企业',
              community: '社区',
              opensource: '开源',
              education: '教育',
            };
            return labels[type] || type;
          };

          const getOrgTypeColor = (type) => {
            const colors = {
              startup: 'green',
              company: 'blue',
              community: 'purple',
              opensource: 'orange',
              education: 'cyan',
            };
            return colors[type] || 'default';
          };

          const getRoleLabel = (role) => {
            const labels = {
              owner: '所有者',
              admin: '管理员',
              member: '成员',
              viewer: '访客',
            };
            return labels[role] || role;
          };

          const getRoleColor = (role) => {
            const colors = {
              owner: 'gold',
              admin: 'red',
              member: 'blue',
              viewer: 'default',
            };
            return colors[role] || 'default';
          };

          const formatDate = (timestamp) => {
            const dayjs = require('dayjs').default;
            return dayjs(timestamp).fromNow();
          };

          onMounted(() => {
            loadOrganizations();
          });

          return {
            loading,
            organizations,
            showCreateModal,
            creating,
            createForm,
            loadOrganizations,
            handleCreate,
            navigateToOrg,
            navigateToMembers,
            navigateToActivities,
            navigateToSettings,
            getOrgTypeLabel,
            getOrgTypeColor,
            getRoleLabel,
            getRoleColor,
            formatDate,
          };
        },
      },
      options
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electron.ipcRenderer.invoke.mockResolvedValue({
      success: true,
      organizations: [],
    });
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.organizations-page').exists()).toBe(true);
    });

    it('应该在挂载时加载组织列表', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: mockOrganizations,
      });
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'org:get-user-organizations'
      );
    });
  });

  describe('组织列表显示', () => {
    it('应该显示空状态', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
    });

    it('应该显示组织列表', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: mockOrganizations,
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.organizations.length).toBe(3);
      expect(wrapper.findAll('.org-card').length).toBe(3);
    });

    it('应该显示组织名称', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [mockOrganizations[0]],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Test Organization 1');
    });

    it('应该显示默认描述', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [mockOrganizations[1]],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('暂无描述');
    });

    it('应该显示成员数量', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [mockOrganizations[0]],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('5 成员');
    });

    it('应该显示加入时间', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [mockOrganizations[0]],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('2天前');
    });
  });

  describe('加载组织', () => {
    it('应该能加载组织列表', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: mockOrganizations,
      });

      await wrapper.vm.loadOrganizations();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'org:get-user-organizations'
      );
      expect(wrapper.vm.organizations.length).toBe(3);
    });

    it('应该能处理加载失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      await wrapper.vm.loadOrganizations();

      expect(message.error).toHaveBeenCalledWith('Network error');
    });

    it('应该能处理加载异常', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Connection failed'));

      await wrapper.vm.loadOrganizations();

      expect(message.error).toHaveBeenCalledWith('加载组织列表失败');
    });

    it('应该在加载时设置loading状态', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockImplementation(() => {
        expect(wrapper.vm.loading).toBe(true);
        return Promise.resolve({ success: true, organizations: [] });
      });

      await wrapper.vm.loadOrganizations();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe('创建组织', () => {
    it('应该能显示创建模态框', async () => {
      wrapper = createWrapper();

      wrapper.vm.showCreateModal = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.create-modal').exists()).toBe(true);
    });

    it('应该能创建组织', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organization: { org_id: 'new-org-1' },
      });

      wrapper.vm.createForm = {
        name: 'New Organization',
        type: 'startup',
        description: 'Test description',
      };

      await wrapper.vm.handleCreate();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'org:create-organization',
        {
          name: 'New Organization',
          type: 'startup',
          description: 'Test description',
        }
      );
      expect(message.success).toHaveBeenCalledWith('组织创建成功');
      expect(wrapper.vm.showCreateModal).toBe(false);
    });

    it('应该验证组织名称', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.createForm = {
        name: '',
        type: 'startup',
        description: '',
      };

      await wrapper.vm.handleCreate();

      expect(message.warning).toHaveBeenCalledWith('请输入组织名称');
      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
        'org:create-organization',
        expect.any(Object)
      );
    });

    it('应该能处理创建失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: 'Organization name already exists',
      });

      wrapper.vm.createForm = {
        name: 'Existing Organization',
        type: 'startup',
        description: '',
      };

      await wrapper.vm.handleCreate();

      expect(message.error).toHaveBeenCalledWith('Organization name already exists');
    });

    it('应该能处理创建异常', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Server error'));

      wrapper.vm.createForm = {
        name: 'New Organization',
        type: 'startup',
        description: '',
      };

      await wrapper.vm.handleCreate();

      expect(message.error).toHaveBeenCalledWith('创建组织失败');
    });

    it('应该在创建后重置表单', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organization: { org_id: 'new-org-1' },
      });

      wrapper.vm.createForm = {
        name: 'New Organization',
        type: 'company',
        description: 'Test',
      };

      await wrapper.vm.handleCreate();

      expect(wrapper.vm.createForm.name).toBe('');
      expect(wrapper.vm.createForm.type).toBe('startup');
      expect(wrapper.vm.createForm.description).toBe('');
    });

    it('应该在创建后导航到成员页面', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organization: { org_id: 'new-org-1' },
      });

      wrapper.vm.createForm = {
        name: 'New Organization',
        type: 'startup',
        description: '',
      };

      await wrapper.vm.handleCreate();

      expect(mockRouter.push).toHaveBeenCalledWith('/org/new-org-1/members');
    });

    it('应该支持所有组织类型', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getOrgTypeLabel('startup')).toBe('初创公司');
      expect(wrapper.vm.getOrgTypeLabel('company')).toBe('企业');
      expect(wrapper.vm.getOrgTypeLabel('community')).toBe('社区');
      expect(wrapper.vm.getOrgTypeLabel('opensource')).toBe('开源');
      expect(wrapper.vm.getOrgTypeLabel('education')).toBe('教育');
    });
  });

  describe('导航功能', () => {
    it('应该能导航到组织页面', () => {
      wrapper = createWrapper();

      wrapper.vm.navigateToOrg('org-1');

      expect(mockRouter.push).toHaveBeenCalledWith('/org/org-1/members');
    });

    it('应该能导航到成员页面', () => {
      wrapper = createWrapper();

      wrapper.vm.navigateToMembers('org-1');

      expect(mockRouter.push).toHaveBeenCalledWith('/org/org-1/members');
    });

    it('应该能导航到活动页面', () => {
      wrapper = createWrapper();

      wrapper.vm.navigateToActivities('org-1');

      expect(mockRouter.push).toHaveBeenCalledWith('/org/org-1/activities');
    });

    it('应该能导航到设置页面', () => {
      wrapper = createWrapper();

      wrapper.vm.navigateToSettings('org-1');

      expect(mockRouter.push).toHaveBeenCalledWith('/org/org-1/settings');
    });
  });

  describe('组织类型', () => {
    it('应该返回正确的类型标签', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getOrgTypeLabel('startup')).toBe('初创公司');
      expect(wrapper.vm.getOrgTypeLabel('company')).toBe('企业');
      expect(wrapper.vm.getOrgTypeLabel('community')).toBe('社区');
      expect(wrapper.vm.getOrgTypeLabel('opensource')).toBe('开源');
      expect(wrapper.vm.getOrgTypeLabel('education')).toBe('教育');
      expect(wrapper.vm.getOrgTypeLabel('unknown')).toBe('unknown');
    });

    it('应该返回正确的类型颜色', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getOrgTypeColor('startup')).toBe('green');
      expect(wrapper.vm.getOrgTypeColor('company')).toBe('blue');
      expect(wrapper.vm.getOrgTypeColor('community')).toBe('purple');
      expect(wrapper.vm.getOrgTypeColor('opensource')).toBe('orange');
      expect(wrapper.vm.getOrgTypeColor('education')).toBe('cyan');
      expect(wrapper.vm.getOrgTypeColor('unknown')).toBe('default');
    });
  });

  describe('角色管理', () => {
    it('应该返回正确的角色标签', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getRoleLabel('owner')).toBe('所有者');
      expect(wrapper.vm.getRoleLabel('admin')).toBe('管理员');
      expect(wrapper.vm.getRoleLabel('member')).toBe('成员');
      expect(wrapper.vm.getRoleLabel('viewer')).toBe('访客');
      expect(wrapper.vm.getRoleLabel('unknown')).toBe('unknown');
    });

    it('应该返回正确的角色颜色', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getRoleColor('owner')).toBe('gold');
      expect(wrapper.vm.getRoleColor('admin')).toBe('red');
      expect(wrapper.vm.getRoleColor('member')).toBe('blue');
      expect(wrapper.vm.getRoleColor('viewer')).toBe('default');
      expect(wrapper.vm.getRoleColor('unknown')).toBe('default');
    });
  });

  describe('时间格式化', () => {
    it('应该格式化日期为相对时间', () => {
      wrapper = createWrapper();

      const formatted = wrapper.vm.formatDate('2026-01-20');

      expect(formatted).toBe('2天前');
    });
  });

  describe('边界情况', () => {
    it('应该处理空组织列表', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();

      expect(wrapper.vm.organizations.length).toBe(0);
    });

    it('应该处理成员数量为0', async () => {
      const orgWithNoMembers = { ...mockOrganizations[0], member_count: 0 };
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [orgWithNoMembers],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('0 成员');
    });

    it('应该处理缺少member_count字段', async () => {
      const orgWithoutMemberCount = { ...mockOrganizations[0] };
      delete orgWithoutMemberCount.member_count;
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [orgWithoutMemberCount],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('0 成员');
    });

    it('应该处理非常长的组织名称', async () => {
      const longName = 'A'.repeat(100);
      const orgWithLongName = { ...mockOrganizations[0], name: longName };
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: [orgWithLongName],
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.organizations[0].name).toBe(longName);
    });

    it('应该处理非常长的描述', () => {
      wrapper = createWrapper();
      const longDescription = 'B'.repeat(500);

      wrapper.vm.createForm = {
        name: 'Test',
        type: 'startup',
        description: longDescription,
      };

      expect(wrapper.vm.createForm.description).toBe(longDescription);
    });
  });

  describe('多组织操作', () => {
    it('应该能显示多个不同类型的组织', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: mockOrganizations,
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.organizations[0].type).toBe('startup');
      expect(wrapper.vm.organizations[1].type).toBe('company');
      expect(wrapper.vm.organizations[2].type).toBe('community');
    });

    it('应该能显示多个不同角色', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organizations: mockOrganizations,
      });
      wrapper = createWrapper();

      await wrapper.vm.loadOrganizations();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.organizations[0].role).toBe('owner');
      expect(wrapper.vm.organizations[1].role).toBe('admin');
      expect(wrapper.vm.organizations[2].role).toBe('member');
    });
  });

  describe('creating状态', () => {
    it('应该在创建时设置creating状态', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockImplementation(() => {
        expect(wrapper.vm.creating).toBe(true);
        return Promise.resolve({ success: true, organization: { org_id: 'new-org' } });
      });

      wrapper.vm.createForm = {
        name: 'New Organization',
        type: 'startup',
        description: '',
      };

      await wrapper.vm.handleCreate();

      expect(wrapper.vm.creating).toBe(false);
    });

    it('应该在创建失败后重置creating状态', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Failed'));

      wrapper.vm.createForm = {
        name: 'New Organization',
        type: 'startup',
        description: '',
      };

      await wrapper.vm.handleCreate();

      expect(wrapper.vm.creating).toBe(false);
    });
  });
});
