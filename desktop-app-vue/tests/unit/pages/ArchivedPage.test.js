import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ArchivedPage from '../../../src/renderer/pages/projects/ArchivedPage.vue';
import { useProjectStore } from '@/stores/project';
import { message, Modal } from 'ant-design-vue';

// Mock logger utility
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock date-fns
vi.mock('date-fns', () => ({
  format: vi.fn((date) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('zh-CN');
  }),
}));

vi.mock('date-fns/locale', () => ({
  zhCN: {},
}));

// Mock Ant Design Vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  Modal: {
    confirm: vi.fn(),
  },
}));

// Mock Vue Router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
}));

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

global.localStorage = localStorageMock;

describe('ArchivedPage.vue', () => {
  let wrapper;
  let projectStore;

  const mockArchivedProjects = [
    {
      id: 1,
      name: 'Archived Project 1',
      description: 'Description 1',
      type: 'knowledge',
      status: 'archived',
      created_at: '2024-01-01T10:00:00Z',
      archived_at: '2024-01-15T10:00:00Z',
      tags: ['tag1', 'tag2'],
    },
    {
      id: 2,
      name: 'Archived Project 2',
      description: 'Description 2',
      type: 'social',
      status: 'archived',
      created_at: '2024-01-05T10:00:00Z',
      archived_at: '2024-01-20T10:00:00Z',
      tags: ['tag3'],
    },
    {
      id: 3,
      name: 'Archived Project 3',
      description: 'Description 3',
      type: 'trading',
      status: 'archived',
      created_at: '2024-01-10T10:00:00Z',
      archived_at: '2024-01-25T10:00:00Z',
      tags: [],
    },
  ];

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    projectStore = useProjectStore();

    // Mock store methods
    projectStore.fetchProjects = vi.fn();
    projectStore.updateProject = vi.fn();
    projectStore.deleteProject = vi.fn();

    vi.clearAllMocks();
    localStorageMock.clear();

    wrapper = mount(ArchivedPage, {
      global: {
        plugins: [pinia],
        stubs: {
          'a-card': { template: '<div><slot /></div>' },
          'a-input-search': { template: '<input />' },
          'a-select': { template: '<div><slot /></div>' },
          'a-select-option': { template: '<div><slot /></div>' },
          'a-radio-group': { template: '<div><slot /></div>' },
          'a-radio-button': { template: '<button><slot /></button>' },
          'a-row': { template: '<div><slot /></div>' },
          'a-col': { template: '<div><slot /></div>' },
          'a-empty': { template: '<div>Empty</div>' },
          'a-tag': { template: '<span><slot /></span>' },
          'a-button': { template: '<button><slot /></button>' },
          'a-dropdown': { template: '<div><slot /></div>' },
          'a-menu': { template: '<div><slot /></div>' },
          'a-menu-item': { template: '<div><slot /></div>' },
          'a-menu-divider': { template: '<div />' },
          'a-pagination': { template: '<div />' },
          'a-spin': { template: '<div><slot /></div>' },
          'AppIcon': { template: '<span />' },
          'InboxOutlined': { template: '<span />' },
          'ArrowLeftOutlined': { template: '<span />' },
          'SearchOutlined': { template: '<span />' },
          'AppstoreOutlined': { template: '<span />' },
          'BarsOutlined': { template: '<span />' },
          'FolderOutlined': { template: '<span />' },
          'MoreOutlined': { template: '<span />' },
          'CalendarOutlined': { template: '<span />' },
        },
      },
    });

    // Set mock data
    projectStore.projects = [...mockArchivedProjects];
  });

  afterEach(() => {
    wrapper.unmount();
  });

  // ==================== 组件初始化 ====================
  describe('组件初始化', () => {
    it('应该正确渲染组件', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('应该初始化默认数据', () => {
      expect(wrapper.vm.searchKeyword).toBe('');
      expect(wrapper.vm.selectedType).toBe('all');
      expect(wrapper.vm.viewMode).toBe('grid');
      expect(wrapper.vm.currentPage).toBe(1);
      expect(wrapper.vm.pageSize).toBe(12);
      expect(wrapper.vm.loading).toBe(false);
    });

    it('挂载时应该加载归档项目', async () => {
      await wrapper.vm.$nextTick();
      expect(projectStore.fetchProjects).toHaveBeenCalled();
    });

    it('应该从localStorage恢复视图模式', () => {
      localStorageMock.setItem('archived-view-mode', 'list');

      const newWrapper = mount(ArchivedPage, {
        global: {
          plugins: [createPinia()],
          stubs: {
            'a-card': { template: '<div><slot /></div>' },
            'a-input-search': { template: '<input />' },
            'a-select': { template: '<div><slot /></div>' },
            'a-radio-group': { template: '<div><slot /></div>' },
            'a-row': { template: '<div><slot /></div>' },
            'a-empty': { template: '<div>Empty</div>' },
            'a-button': { template: '<button><slot /></button>' },
            'a-pagination': { template: '<div />' },
            'a-spin': { template: '<div><slot /></div>' },
          },
        },
      });

      expect(newWrapper.vm.viewMode).toBe('list');
      newWrapper.unmount();
    });
  });

  // ==================== 归档项目列表 ====================
  describe('归档项目列表', () => {
    it('应该显示所有归档项目', () => {
      const archived = wrapper.vm.archivedProjects;
      expect(archived.length).toBe(3);
    });

    it('应该只显示归档状态的项目', () => {
      projectStore.projects = [
        ...mockArchivedProjects,
        {
          id: 4,
          name: 'Active Project',
          status: 'active',
        },
      ];

      const archived = wrapper.vm.archivedProjects;
      expect(archived.every(p => p.status === 'archived')).toBe(true);
      expect(archived.length).toBe(3);
    });

    it('应该按归档时间倒序排列', () => {
      const archived = wrapper.vm.archivedProjects;

      for (let i = 0; i < archived.length - 1; i++) {
        const current = new Date(archived[i].archived_at);
        const next = new Date(archived[i + 1].archived_at);
        expect(current >= next).toBe(true);
      }
    });
  });

  // ==================== 搜索功能 ====================
  describe('搜索功能', () => {
    it('应该能按名称搜索', async () => {
      wrapper.vm.searchKeyword = 'Project 1';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Archived Project 1');
    });

    it('应该能按描述搜索', async () => {
      wrapper.vm.searchKeyword = 'Description 2';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(1);
      expect(filtered[0].description).toBe('Description 2');
    });

    it('搜索应该不区分大小写', async () => {
      wrapper.vm.searchKeyword = 'project 1';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Archived Project 1');
    });

    it('搜索无结果应该返回空数组', async () => {
      wrapper.vm.searchKeyword = 'NonExistent';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(0);
    });

    it('清空搜索应该显示所有项目', async () => {
      wrapper.vm.searchKeyword = 'Project 1';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredProjects.length).toBe(1);

      wrapper.vm.searchKeyword = '';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredProjects.length).toBe(3);
    });

    it('应该能搜索标签', async () => {
      wrapper.vm.searchKeyword = 'tag1';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(1);
      expect(filtered[0].tags).toContain('tag1');
    });
  });

  // ==================== 类型过滤 ====================
  describe('类型过滤', () => {
    it('应该显示所有类型', async () => {
      wrapper.vm.selectedType = 'all';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(3);
    });

    it('应该能过滤知识库类型', async () => {
      wrapper.vm.selectedType = 'knowledge';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(1);
      expect(filtered[0].type).toBe('knowledge');
    });

    it('应该能过滤社交类型', async () => {
      wrapper.vm.selectedType = 'social';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(1);
      expect(filtered[0].type).toBe('social');
    });

    it('应该能过滤交易类型', async () => {
      wrapper.vm.selectedType = 'trading';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(1);
      expect(filtered[0].type).toBe('trading');
    });

    it('过滤应该与搜索同时生效', async () => {
      wrapper.vm.searchKeyword = 'Project';
      wrapper.vm.selectedType = 'knowledge';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(1);
      expect(filtered[0].type).toBe('knowledge');
    });
  });

  // ==================== 视图模式 ====================
  describe('视图模式', () => {
    it('应该能切换到网格视图', async () => {
      wrapper.vm.viewMode = 'list';
      await wrapper.vm.$nextTick();

      wrapper.vm.viewMode = 'grid';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.viewMode).toBe('grid');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('archived-view-mode', 'grid');
    });

    it('应该能切换到列表视图', async () => {
      wrapper.vm.viewMode = 'grid';
      await wrapper.vm.$nextTick();

      wrapper.vm.viewMode = 'list';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.viewMode).toBe('list');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('archived-view-mode', 'list');
    });

    it('切换视图模式应该保存到localStorage', async () => {
      await wrapper.vm.handleViewModeChange('list');

      expect(localStorageMock.setItem).toHaveBeenCalledWith('archived-view-mode', 'list');
    });
  });

  // ==================== 恢复项目 ====================
  describe('恢复项目', () => {
    it('应该能恢复项目', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      const project = mockArchivedProjects[0];
      projectStore.updateProject.mockResolvedValueOnce({ success: true });

      await wrapper.vm.handleRestore(project.id);

      expect(Modal.confirm).toHaveBeenCalled();
      expect(projectStore.updateProject).toHaveBeenCalledWith(project.id, {
        status: 'active',
        archived_at: null,
      });
      expect(message.success).toHaveBeenCalledWith('项目已恢复');
    });

    it('恢复项目应该显示确认对话框', async () => {
      Modal.confirm.mockImplementation(() => Promise.resolve());

      await wrapper.vm.handleRestore(1);

      expect(Modal.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '确认恢复',
          content: expect.stringContaining('确定要恢复这个项目吗'),
        })
      );
    });

    it('取消恢复应该不执行操作', async () => {
      Modal.confirm.mockImplementation(() => Promise.resolve());

      await wrapper.vm.handleRestore(1);

      // onOk not called, so updateProject should not be called
      expect(projectStore.updateProject).not.toHaveBeenCalled();
    });

    it('恢复失败应该显示错误', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      projectStore.updateProject.mockRejectedValueOnce(new Error('Restore failed'));

      await wrapper.vm.handleRestore(1);

      expect(message.error).toHaveBeenCalledWith('恢复失败: Restore failed');
    });

    it('恢复后应该刷新列表', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      projectStore.updateProject.mockResolvedValueOnce({ success: true });

      await wrapper.vm.handleRestore(1);

      expect(projectStore.fetchProjects).toHaveBeenCalled();
    });
  });

  // ==================== 删除项目 ====================
  describe('删除项目', () => {
    it('应该能永久删除项目', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      const project = mockArchivedProjects[0];
      projectStore.deleteProject.mockResolvedValueOnce({ success: true });

      await wrapper.vm.handleDelete(project.id);

      expect(Modal.confirm).toHaveBeenCalled();
      expect(projectStore.deleteProject).toHaveBeenCalledWith(project.id);
      expect(message.success).toHaveBeenCalledWith('项目已永久删除');
    });

    it('删除项目应该显示警告确认对话框', async () => {
      Modal.confirm.mockImplementation(() => Promise.resolve());

      await wrapper.vm.handleDelete(1);

      expect(Modal.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '确认删除',
          content: expect.stringContaining('此操作不可恢复'),
          type: 'warning',
        })
      );
    });

    it('取消删除应该不执行操作', async () => {
      Modal.confirm.mockImplementation(() => Promise.resolve());

      await wrapper.vm.handleDelete(1);

      expect(projectStore.deleteProject).not.toHaveBeenCalled();
    });

    it('删除失败应该显示错误', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      projectStore.deleteProject.mockRejectedValueOnce(new Error('Delete failed'));

      await wrapper.vm.handleDelete(1);

      expect(message.error).toHaveBeenCalledWith('删除失败: Delete failed');
    });

    it('删除后应该刷新列表', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      projectStore.deleteProject.mockResolvedValueOnce({ success: true });

      await wrapper.vm.handleDelete(1);

      expect(projectStore.fetchProjects).toHaveBeenCalled();
    });
  });

  // ==================== 查看项目详情 ====================
  describe('查看项目详情', () => {
    it('应该能导航到项目详情', async () => {
      const project = mockArchivedProjects[0];

      await wrapper.vm.handleViewDetails(project.id);

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: 'project-detail',
        params: { id: project.id },
      });
    });

    it('应该能查看不同类型的项目详情', async () => {
      await wrapper.vm.handleViewDetails(1);
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ params: { id: 1 } })
      );

      await wrapper.vm.handleViewDetails(2);
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ params: { id: 2 } })
      );
    });
  });

  // ==================== 分页功能 ====================
  describe('分页功能', () => {
    beforeEach(() => {
      // Create 20 projects for pagination testing
      const manyProjects = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: `Project ${i + 1}`,
        type: 'knowledge',
        status: 'archived',
        archived_at: new Date().toISOString(),
      }));
      projectStore.projects = manyProjects;
    });

    it('应该正确分页显示', () => {
      wrapper.vm.currentPage = 1;
      wrapper.vm.pageSize = 12;

      const paged = wrapper.vm.pagedProjects;
      expect(paged.length).toBe(12);
    });

    it('应该能切换到下一页', async () => {
      wrapper.vm.currentPage = 1;
      wrapper.vm.pageSize = 12;

      await wrapper.vm.handlePageChange(2);

      expect(wrapper.vm.currentPage).toBe(2);
      const paged = wrapper.vm.pagedProjects;
      expect(paged.length).toBe(8); // 20 - 12 = 8
    });

    it('应该能切换每页大小', async () => {
      await wrapper.vm.handlePageSizeChange(1, 20);

      expect(wrapper.vm.pageSize).toBe(20);
      expect(wrapper.vm.currentPage).toBe(1);
      const paged = wrapper.vm.pagedProjects;
      expect(paged.length).toBe(20);
    });

    it('过滤后应该重置到第一页', async () => {
      wrapper.vm.currentPage = 2;
      wrapper.vm.searchKeyword = 'Project 1';
      await wrapper.vm.$nextTick();

      // Filtering should reset to page 1
      expect(wrapper.vm.currentPage).toBe(1);
    });

    it('应该正确计算总数', () => {
      expect(wrapper.vm.totalProjects).toBe(20);
    });
  });

  // ==================== 统计信息 ====================
  describe('统计信息', () => {
    it('应该显示总归档数', () => {
      const stats = wrapper.vm.statistics;
      expect(stats.total).toBe(3);
    });

    it('应该按类型统计', () => {
      const stats = wrapper.vm.statistics;
      expect(stats.byType.knowledge).toBe(1);
      expect(stats.byType.social).toBe(1);
      expect(stats.byType.trading).toBe(1);
    });

    it('应该统计今日归档数', () => {
      const today = new Date().toISOString().split('T')[0];
      projectStore.projects = [
        {
          id: 1,
          status: 'archived',
          archived_at: today + 'T10:00:00Z',
        },
        {
          id: 2,
          status: 'archived',
          archived_at: '2024-01-01T10:00:00Z',
        },
      ];

      const stats = wrapper.vm.statistics;
      expect(stats.today).toBe(1);
    });

    it('应该统计本周归档数', () => {
      const now = new Date();
      const thisWeek = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

      projectStore.projects = [
        {
          id: 1,
          status: 'archived',
          archived_at: thisWeek.toISOString(),
        },
        {
          id: 2,
          status: 'archived',
          archived_at: '2024-01-01T10:00:00Z',
        },
      ];

      const stats = wrapper.vm.statistics;
      expect(stats.thisWeek).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== 批量操作 ====================
  describe('批量操作', () => {
    it('应该能选择多个项目', async () => {
      wrapper.vm.selectedProjects = [1, 2];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedProjects.length).toBe(2);
    });

    it('应该能批量恢复', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      wrapper.vm.selectedProjects = [1, 2];
      projectStore.updateProject.mockResolvedValue({ success: true });

      await wrapper.vm.handleBatchRestore();

      expect(projectStore.updateProject).toHaveBeenCalledTimes(2);
      expect(message.success).toHaveBeenCalledWith('已恢复 2 个项目');
    });

    it('应该能批量删除', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      wrapper.vm.selectedProjects = [1, 2];
      projectStore.deleteProject.mockResolvedValue({ success: true });

      await wrapper.vm.handleBatchDelete();

      expect(projectStore.deleteProject).toHaveBeenCalledTimes(2);
      expect(message.success).toHaveBeenCalledWith('已删除 2 个项目');
    });

    it('批量操作后应该清空选择', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      wrapper.vm.selectedProjects = [1, 2];
      projectStore.updateProject.mockResolvedValue({ success: true });

      await wrapper.vm.handleBatchRestore();

      expect(wrapper.vm.selectedProjects.length).toBe(0);
    });
  });

  // ==================== 项目类型标识 ====================
  describe('项目类型标识', () => {
    it('应该显示知识库类型', () => {
      const type = wrapper.vm.getTypeLabel('knowledge');
      expect(type).toBe('知识库');
    });

    it('应该显示社交类型', () => {
      const type = wrapper.vm.getTypeLabel('social');
      expect(type).toBe('社交');
    });

    it('应该显示交易类型', () => {
      const type = wrapper.vm.getTypeLabel('trading');
      expect(type).toBe('交易');
    });

    it('应该处理未知类型', () => {
      const type = wrapper.vm.getTypeLabel('unknown');
      expect(type).toBe('其他');
    });

    it('应该显示类型颜色', () => {
      expect(wrapper.vm.getTypeColor('knowledge')).toBe('blue');
      expect(wrapper.vm.getTypeColor('social')).toBe('green');
      expect(wrapper.vm.getTypeColor('trading')).toBe('orange');
      expect(wrapper.vm.getTypeColor('unknown')).toBe('default');
    });
  });

  // ==================== 时间格式化 ====================
  describe('时间格式化', () => {
    it('应该正确格式化归档时间', () => {
      const project = mockArchivedProjects[0];
      const formatted = wrapper.vm.formatDate(project.archived_at);

      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
    });

    it('应该处理null日期', () => {
      const formatted = wrapper.vm.formatDate(null);
      expect(formatted).toBe('-');
    });

    it('应该处理undefined日期', () => {
      const formatted = wrapper.vm.formatDate(undefined);
      expect(formatted).toBe('-');
    });

    it('应该显示相对时间', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const formatted = wrapper.vm.formatRelativeTime(yesterday.toISOString());
      expect(formatted).toContain('天前');
    });
  });

  // ==================== 排序功能 ====================
  describe('排序功能', () => {
    it('应该能按归档时间排序', () => {
      wrapper.vm.sortBy = 'archived_at';
      wrapper.vm.sortOrder = 'desc';

      const sorted = wrapper.vm.filteredProjects;
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = new Date(sorted[i].archived_at);
        const next = new Date(sorted[i + 1].archived_at);
        expect(current >= next).toBe(true);
      }
    });

    it('应该能按名称排序', () => {
      wrapper.vm.sortBy = 'name';
      wrapper.vm.sortOrder = 'asc';

      const sorted = wrapper.vm.filteredProjects;
      for (let i = 0; i < sorted.length - 1; i++) {
        expect(sorted[i].name.localeCompare(sorted[i + 1].name) <= 0).toBe(true);
      }
    });

    it('应该能切换排序顺序', async () => {
      wrapper.vm.sortOrder = 'asc';
      await wrapper.vm.handleSortOrderToggle();

      expect(wrapper.vm.sortOrder).toBe('desc');

      await wrapper.vm.handleSortOrderToggle();
      expect(wrapper.vm.sortOrder).toBe('asc');
    });
  });

  // ==================== 加载状态 ====================
  describe('加载状态', () => {
    it('加载时应该显示加载状态', async () => {
      wrapper.vm.loading = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.loading).toBe(true);
    });

    it('加载完成应该隐藏加载状态', async () => {
      wrapper.vm.loading = true;
      await wrapper.vm.$nextTick();

      wrapper.vm.loading = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  // ==================== 空状态 ====================
  describe('空状态', () => {
    it('无归档项目应该显示空状态', () => {
      projectStore.projects = [];

      const archived = wrapper.vm.archivedProjects;
      expect(archived.length).toBe(0);
    });

    it('搜索无结果应该显示空状态', async () => {
      wrapper.vm.searchKeyword = 'NonExistent';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(0);
    });

    it('过滤无结果应该显示空状态', async () => {
      wrapper.vm.selectedType = 'nonexistent';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBe(0);
    });
  });

  // ==================== 错误处理 ====================
  describe('错误处理', () => {
    it('加载项目失败应该显示错误', async () => {
      projectStore.fetchProjects.mockRejectedValueOnce(new Error('Load failed'));

      await wrapper.vm.loadProjects();

      expect(message.error).toHaveBeenCalledWith('加载归档项目失败: Load failed');
    });

    it('恢复项目失败应该显示错误', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      projectStore.updateProject.mockRejectedValueOnce(new Error('Restore failed'));

      await wrapper.vm.handleRestore(1);

      expect(message.error).toHaveBeenCalledWith('恢复失败: Restore failed');
    });

    it('删除项目失败应该显示错误', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      projectStore.deleteProject.mockRejectedValueOnce(new Error('Delete failed'));

      await wrapper.vm.handleDelete(1);

      expect(message.error).toHaveBeenCalledWith('删除失败: Delete failed');
    });

    it('应该处理网络错误', async () => {
      projectStore.fetchProjects.mockRejectedValueOnce(new Error('Network error'));

      await wrapper.vm.loadProjects();

      expect(message.error).toHaveBeenCalledWith('加载归档项目失败: Network error');
    });
  });

  // ==================== 边界情况 ====================
  describe('边界情况', () => {
    it('应该处理空项目列表', () => {
      projectStore.projects = [];
      expect(wrapper.vm.archivedProjects.length).toBe(0);
    });

    it('应该处理无效的项目ID', async () => {
      await wrapper.vm.handleRestore(999);

      // Should not throw error
      expect(true).toBe(true);
    });

    it('应该处理缺少archived_at的项目', () => {
      projectStore.projects = [
        {
          id: 1,
          name: 'Project 1',
          status: 'archived',
          archived_at: null,
        },
      ];

      const archived = wrapper.vm.archivedProjects;
      expect(archived.length).toBe(1);
    });

    it('应该处理缺少tags的项目', () => {
      projectStore.projects = [
        {
          id: 1,
          name: 'Project 1',
          status: 'archived',
          tags: undefined,
        },
      ];

      const archived = wrapper.vm.archivedProjects;
      expect(archived.length).toBe(1);
    });

    it('应该处理超长项目名称', () => {
      const longName = 'A'.repeat(200);
      projectStore.projects = [
        {
          id: 1,
          name: longName,
          status: 'archived',
        },
      ];

      const archived = wrapper.vm.archivedProjects;
      expect(archived[0].name).toBe(longName);
    });
  });

  // ==================== 导航和路由 ====================
  describe('导航和路由', () => {
    it('应该能返回上一页', async () => {
      await wrapper.vm.handleBack();
      expect(mockRouter.back).toHaveBeenCalled();
    });

    it('应该能导航到活跃项目列表', async () => {
      await wrapper.vm.handleGoToActive();

      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'projects' });
    });
  });
});
