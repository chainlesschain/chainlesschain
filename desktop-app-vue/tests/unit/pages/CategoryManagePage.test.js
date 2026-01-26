import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CategoryManagePage from '@renderer/pages/projects/CategoryManagePage.vue';

// Mock stores
const mockCategoryStore = {
  rootCategories: [
    {
      id: 'cat-1',
      name: '技术开发',
      icon: '💻',
      color: '#1890ff',
      sort_order: 0,
      description: '技术相关分类',
      parent_id: null,
      children: [
        {
          id: 'cat-1-1',
          name: '前端开发',
          icon: '🎨',
          color: '#52c41a',
          sort_order: 0,
          parent_id: 'cat-1',
        },
        {
          id: 'cat-1-2',
          name: '后端开发',
          icon: '⚙️',
          color: '#fa8c16',
          sort_order: 1,
          parent_id: 'cat-1',
        },
      ],
    },
    {
      id: 'cat-2',
      name: '项目管理',
      icon: '📊',
      color: '#722ed1',
      sort_order: 1,
      description: '项目管理相关',
      parent_id: null,
      children: [],
    },
  ],
  initialized: true,
  fetchCategories: vi.fn(),
  initializeDefaults: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
};

vi.mock('@/stores/category', () => ({
  useCategoryStore: () => mockCategoryStore,
}));

// Mock ant-design-vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  Empty: {
    PRESENTED_IMAGE_SIMPLE: 'simple',
  },
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
  })),
}));

describe('CategoryManagePage.vue', () => {
  let wrapper;

  const createWrapper = () => {
    return mount(CategoryManagePage, {
      global: {
        stubs: {
          'a-page-header': {
            template: '<div><slot /></div>',
            props: ['title', 'subTitle'],
          },
          'a-button': { template: '<button><slot /></button>' },
          'a-spin': { template: '<div><slot /></div>' },
          'a-card': { template: '<div><slot /></div>' },
          'a-row': { template: '<div><slot /></div>' },
          'a-col': { template: '<div><slot /></div>' },
          'a-statistic': { template: '<div />' },
          'a-collapse': { template: '<div><slot /></div>' },
          'a-collapse-panel': { template: '<div><slot /></div>' },
          'a-space': { template: '<div><slot /></div>' },
          'a-tag': { template: '<span />' },
          'a-popconfirm': { template: '<div><slot /></div>' },
          'a-table': { template: '<table />' },
          'a-empty': { template: '<div><slot /></div>' },
          'a-modal': { template: '<div><slot /></div>' },
          'a-form': { template: '<div><slot /></div>' },
          'a-form-item': { template: '<div><slot /></div>' },
          'a-input': { template: '<input />' },
          'a-input-number': { template: '<input type="number" />' },
          'a-textarea': { template: '<textarea />' },
          'a-alert': { template: '<div />' },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryStore.rootCategories = [
      {
        id: 'cat-1',
        name: '技术开发',
        icon: '💻',
        color: '#1890ff',
        sort_order: 0,
        description: '技术相关分类',
        parent_id: null,
        children: [
          {
            id: 'cat-1-1',
            name: '前端开发',
            icon: '🎨',
            color: '#52c41a',
            sort_order: 0,
            parent_id: 'cat-1',
          },
          {
            id: 'cat-1-2',
            name: '后端开发',
            icon: '⚙️',
            color: '#fa8c16',
            sort_order: 1,
            parent_id: 'cat-1',
          },
        ],
      },
      {
        id: 'cat-2',
        name: '项目管理',
        icon: '📊',
        color: '#722ed1',
        sort_order: 1,
        description: '项目管理相关',
        parent_id: null,
        children: [],
      },
    ];
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // 组件挂载测试
  describe('Component Mounting', () => {
    it('应该正确挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('应该在挂载时加载分类列表', async () => {
      mockCategoryStore.initializeDefaults.mockResolvedValue();
      mockCategoryStore.fetchCategories.mockResolvedValue();

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(mockCategoryStore.fetchCategories).toHaveBeenCalled();
    });

    it('应该初始化默认分类（如果需要）', async () => {
      mockCategoryStore.initialized = false;
      mockCategoryStore.initializeDefaults.mockResolvedValue();
      mockCategoryStore.fetchCategories.mockResolvedValue();

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(mockCategoryStore.initializeDefaults).toHaveBeenCalled();
    });
  });

  // 分类统计测试
  describe('Category Statistics', () => {
    it('应该计算一级分类数量', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.primaryCount).toBe(2);
    });

    it('应该计算二级分类数量', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.secondaryCount).toBe(2);
    });

    it('应该计算分类总数', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.totalCount).toBe(4);
    });

    it('应该处理没有子分类的情况', () => {
      mockCategoryStore.rootCategories = [
        {
          id: 'cat-1',
          name: '技术开发',
          icon: '💻',
          color: '#1890ff',
          children: [],
        },
      ];

      wrapper = createWrapper();

      expect(wrapper.vm.secondaryCount).toBe(0);
      expect(wrapper.vm.totalCount).toBe(1);
    });

    it('应该处理没有children属性的分类', () => {
      mockCategoryStore.rootCategories = [
        {
          id: 'cat-1',
          name: '技术开发',
          icon: '💻',
          color: '#1890ff',
        },
      ];

      wrapper = createWrapper();

      expect(wrapper.vm.secondaryCount).toBe(0);
    });
  });

  // 显示添加对话框测试
  describe('Show Add Dialog', () => {
    it('应该能显示添加一级分类对话框', () => {
      wrapper = createWrapper();

      wrapper.vm.showAddDialog();

      expect(wrapper.vm.editDialogVisible).toBe(true);
      expect(wrapper.vm.editingCategory).toBeNull();
      expect(wrapper.vm.parentId).toBeNull();
    });

    it('应该能显示添加二级分类对话框', () => {
      wrapper = createWrapper();

      wrapper.vm.showAddDialog('cat-1');

      expect(wrapper.vm.editDialogVisible).toBe(true);
      expect(wrapper.vm.editingCategory).toBeNull();
      expect(wrapper.vm.parentId).toBe('cat-1');
    });

    it('应该重置表单数据', () => {
      wrapper = createWrapper();

      wrapper.vm.formData.name = '旧名称';
      wrapper.vm.formData.icon = '🔥';

      wrapper.vm.showAddDialog();

      expect(wrapper.vm.formData.name).toBe('');
      expect(wrapper.vm.formData.icon).toBe('');
      expect(wrapper.vm.formData.color).toBe('#1890ff');
      expect(wrapper.vm.formData.sort_order).toBe(0);
      expect(wrapper.vm.formData.description).toBe('');
    });
  });

  // 显示编辑对话框测试
  describe('Show Edit Dialog', () => {
    it('应该能显示编辑对话框', () => {
      wrapper = createWrapper();

      const category = {
        id: 'cat-1',
        name: '技术开发',
        icon: '💻',
        color: '#1890ff',
        sort_order: 0,
        description: '技术相关',
        parent_id: null,
      };

      wrapper.vm.showEditDialog(category);

      expect(wrapper.vm.editDialogVisible).toBe(true);
      expect(wrapper.vm.editingCategory).toBe(category);
    });

    it('应该填充表单数据', () => {
      wrapper = createWrapper();

      const category = {
        id: 'cat-1',
        name: '技术开发',
        icon: '💻',
        color: '#1890ff',
        sort_order: 5,
        description: '技术相关',
        parent_id: null,
      };

      wrapper.vm.showEditDialog(category);

      expect(wrapper.vm.formData.name).toBe('技术开发');
      expect(wrapper.vm.formData.icon).toBe('💻');
      expect(wrapper.vm.formData.color).toBe('#1890ff');
      expect(wrapper.vm.formData.sort_order).toBe(5);
      expect(wrapper.vm.formData.description).toBe('技术相关');
    });

    it('应该处理缺失的属性', () => {
      wrapper = createWrapper();

      const category = {
        id: 'cat-1',
        name: '技术开发',
        icon: '💻',
        parent_id: null,
      };

      wrapper.vm.showEditDialog(category);

      expect(wrapper.vm.formData.color).toBe('#1890ff');
      expect(wrapper.vm.formData.sort_order).toBe(0);
      expect(wrapper.vm.formData.description).toBe('');
    });
  });

  // 保存分类测试
  describe('Save Category', () => {
    it('应该能创建新分类', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      mockCategoryStore.createCategory.mockResolvedValue();

      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      wrapper.vm.formData = {
        name: '新分类',
        icon: '🆕',
        color: '#ff0000',
        sort_order: 10,
        description: '新分类描述',
      };

      wrapper.vm.parentId = null;
      wrapper.vm.editingCategory = null;

      await wrapper.vm.handleSave();

      expect(mockCategoryStore.createCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '新分类',
          icon: '🆕',
          color: '#ff0000',
          sort_order: 10,
          description: '新分类描述',
          parent_id: null,
          user_id: 'local-user',
        })
      );
      expect(message.success).toHaveBeenCalledWith('分类创建成功');
      expect(wrapper.vm.editDialogVisible).toBe(false);
    });

    it('应该能更新分类', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      mockCategoryStore.updateCategory.mockResolvedValue();

      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      wrapper.vm.formData = {
        name: '更新后的分类',
        icon: '🔄',
        color: '#00ff00',
        sort_order: 20,
        description: '更新描述',
      };

      wrapper.vm.editingCategory = { id: 'cat-1' };
      wrapper.vm.parentId = null;

      await wrapper.vm.handleSave();

      expect(mockCategoryStore.updateCategory).toHaveBeenCalledWith(
        'cat-1',
        expect.objectContaining({
          name: '更新后的分类',
          icon: '🔄',
          color: '#00ff00',
          sort_order: 20,
          description: '更新描述',
        })
      );
      expect(message.success).toHaveBeenCalledWith('分类更新成功');
      expect(wrapper.vm.editDialogVisible).toBe(false);
    });

    it('应该处理表单验证失败', async () => {
      wrapper = createWrapper();

      wrapper.vm.formRef = {
        validate: vi.fn().mockRejectedValue({ errorFields: [] }),
      };

      await wrapper.vm.handleSave();

      expect(mockCategoryStore.createCategory).not.toHaveBeenCalled();
      expect(mockCategoryStore.updateCategory).not.toHaveBeenCalled();
    });

    it('应该处理创建失败', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      const { logger } = require('@/utils/logger');

      mockCategoryStore.createCategory.mockRejectedValue(
        new Error('创建失败')
      );

      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      wrapper.vm.formData = {
        name: '新分类',
        icon: '🆕',
        color: '#ff0000',
        sort_order: 10,
        description: '新分类描述',
      };

      wrapper.vm.editingCategory = null;

      await wrapper.vm.handleSave();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith('创建失败');
    });

    it('应该处理更新失败', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      const { logger } = require('@/utils/logger');

      mockCategoryStore.updateCategory.mockRejectedValue(
        new Error('更新失败')
      );

      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      wrapper.vm.formData = {
        name: '更新后的分类',
        icon: '🔄',
        color: '#00ff00',
        sort_order: 20,
        description: '更新描述',
      };

      wrapper.vm.editingCategory = { id: 'cat-1' };

      await wrapper.vm.handleSave();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith('更新失败');
    });

    it('应该在保存时包含parent_id', async () => {
      wrapper = createWrapper();

      mockCategoryStore.createCategory.mockResolvedValue();

      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      wrapper.vm.formData = {
        name: '子分类',
        icon: '👶',
        color: '#ff0000',
        sort_order: 0,
        description: '',
      };

      wrapper.vm.parentId = 'cat-1';
      wrapper.vm.editingCategory = null;

      await wrapper.vm.handleSave();

      expect(mockCategoryStore.createCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_id: 'cat-1',
        })
      );
    });
  });

  // 删除分类测试
  describe('Delete Category', () => {
    it('应该能删除分类', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      mockCategoryStore.deleteCategory.mockResolvedValue();

      await wrapper.vm.handleDelete('cat-1');

      expect(mockCategoryStore.deleteCategory).toHaveBeenCalledWith('cat-1');
      expect(message.success).toHaveBeenCalledWith('分类删除成功');
    });

    it('应该处理删除失败', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      const { logger } = require('@/utils/logger');

      mockCategoryStore.deleteCategory.mockRejectedValue(
        new Error('删除失败')
      );

      await wrapper.vm.handleDelete('cat-1');

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith('删除失败');
    });
  });

  // 取消编辑测试
  describe('Cancel Edit', () => {
    it('应该关闭对话框', () => {
      wrapper = createWrapper();

      wrapper.vm.editDialogVisible = true;

      wrapper.vm.handleEditCancel();

      expect(wrapper.vm.editDialogVisible).toBe(false);
    });

    it('应该重置表单', () => {
      wrapper = createWrapper();

      wrapper.vm.formRef = {
        resetFields: vi.fn(),
      };

      wrapper.vm.handleEditCancel();

      expect(wrapper.vm.formRef.resetFields).toHaveBeenCalled();
    });
  });

  // 初始化默认分类测试
  describe('Initialize Defaults', () => {
    it('应该能初始化默认分类', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      mockCategoryStore.initializeDefaults.mockResolvedValue();

      await wrapper.vm.handleInitDefaults();

      expect(mockCategoryStore.initializeDefaults).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('默认分类初始化成功');
    });

    it('应该处理初始化失败', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      const { logger } = require('@/utils/logger');

      mockCategoryStore.initializeDefaults.mockRejectedValue(
        new Error('初始化失败')
      );

      await wrapper.vm.handleInitDefaults();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith('初始化失败');
    });

    it('应该静默处理IPC未就绪错误', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      const { logger } = require('@/utils/logger');

      mockCategoryStore.initializeDefaults.mockRejectedValue(
        new Error('No handler registered')
      );

      await wrapper.vm.handleInitDefaults();

      expect(logger.error).not.toHaveBeenCalled();
      expect(message.error).not.toHaveBeenCalled();
    });
  });

  // 加载分类列表测试
  describe('Load Categories', () => {
    it('应该处理加载失败', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      const { logger } = require('@/utils/logger');

      mockCategoryStore.fetchCategories.mockRejectedValue(
        new Error('加载失败')
      );

      wrapper.vm.loading = false;

      await wrapper.vm.loadCategories();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith('加载分类列表失败');
    });

    it('应该静默处理IPC未就绪错误', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');
      const { logger } = require('@/utils/logger');

      mockCategoryStore.fetchCategories.mockRejectedValue(
        new Error('No handler registered for ipc')
      );

      wrapper.vm.loading = false;

      await wrapper.vm.loadCategories();

      expect(logger.error).not.toHaveBeenCalled();
      expect(message.error).not.toHaveBeenCalled();
    });

    it('应该在加载时显示加载状态', async () => {
      wrapper = createWrapper();

      mockCategoryStore.fetchCategories.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );

      wrapper.vm.loading = false;

      const promise = wrapper.vm.loadCategories();
      expect(wrapper.vm.loading).toBe(true);

      await promise;
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  // 获取分类标题测试
  describe('Get Category Header', () => {
    it('应该返回分类标题', () => {
      wrapper = createWrapper();

      const category = {
        id: 'cat-1',
        name: '技术开发',
        icon: '💻',
      };

      const header = wrapper.vm.getCategoryHeader(category);

      expect(header).toBe('💻 技术开发');
    });

    it('应该处理没有图标的分类', () => {
      wrapper = createWrapper();

      const category = {
        id: 'cat-1',
        name: '技术开发',
        icon: '',
      };

      const header = wrapper.vm.getCategoryHeader(category);

      expect(header).toBe(' 技术开发');
    });
  });

  // 表单验证测试
  describe('Form Validation', () => {
    it('应该验证分类名称为必填', () => {
      wrapper = createWrapper();

      const rules = wrapper.vm.formRules;

      expect(rules.name).toBeDefined();
      expect(rules.name[0].required).toBe(true);
    });

    it('应该验证分类名称长度', () => {
      wrapper = createWrapper();

      const rules = wrapper.vm.formRules;

      expect(rules.name[1].min).toBe(1);
      expect(rules.name[1].max).toBe(20);
    });

    it('应该验证图标为必填', () => {
      wrapper = createWrapper();

      const rules = wrapper.vm.formRules;

      expect(rules.icon).toBeDefined();
      expect(rules.icon[0].required).toBe(true);
    });

    it('应该验证颜色为必填', () => {
      wrapper = createWrapper();

      const rules = wrapper.vm.formRules;

      expect(rules.color).toBeDefined();
      expect(rules.color[0].required).toBe(true);
    });
  });

  // 子分类表格列测试
  describe('Sub Category Columns', () => {
    it('应该定义正确的表格列', () => {
      wrapper = createWrapper();

      const columns = wrapper.vm.subCategoryColumns;

      expect(columns).toHaveLength(4);
      expect(columns[0].key).toBe('name');
      expect(columns[1].key).toBe('color');
      expect(columns[2].key).toBe('sort_order');
      expect(columns[3].key).toBe('action');
    });
  });

  // 分类数据测试
  describe('Categories Data', () => {
    it('应该从store获取分类数据', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.categories).toEqual(mockCategoryStore.rootCategories);
    });

    it('应该处理空分类列表', () => {
      mockCategoryStore.rootCategories = [];

      wrapper = createWrapper();

      expect(wrapper.vm.categories).toEqual([]);
      expect(wrapper.vm.primaryCount).toBe(0);
      expect(wrapper.vm.secondaryCount).toBe(0);
      expect(wrapper.vm.totalCount).toBe(0);
    });

    it('应该处理null分类列表', () => {
      mockCategoryStore.rootCategories = null;

      wrapper = createWrapper();

      expect(wrapper.vm.categories).toEqual([]);
    });
  });

  // 表单数据测试
  describe('Form Data', () => {
    it('应该初始化默认表单数据', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formData).toEqual({
        name: '',
        icon: '',
        color: '#1890ff',
        sort_order: 0,
        description: '',
      });
    });

    it('应该更新表单数据', async () => {
      wrapper = createWrapper();

      wrapper.vm.formData.name = '新分类';
      wrapper.vm.formData.icon = '🆕';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.name).toBe('新分类');
      expect(wrapper.vm.formData.icon).toBe('🆕');
    });
  });

  // 对话框状态测试
  describe('Dialog State', () => {
    it('应该初始化为关闭状态', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.editDialogVisible).toBe(false);
    });

    it('应该能打开对话框', () => {
      wrapper = createWrapper();

      wrapper.vm.editDialogVisible = true;

      expect(wrapper.vm.editDialogVisible).toBe(true);
    });

    it('应该能关闭对话框', () => {
      wrapper = createWrapper();

      wrapper.vm.editDialogVisible = true;
      wrapper.vm.handleEditCancel();

      expect(wrapper.vm.editDialogVisible).toBe(false);
    });
  });

  // 加载状态测试
  describe('Loading State', () => {
    it('应该初始化为未加载状态', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.loading).toBe(false);
    });

    it('应该在保存时显示加载状态', async () => {
      wrapper = createWrapper();

      mockCategoryStore.createCategory.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );

      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      wrapper.vm.formData = {
        name: '新分类',
        icon: '🆕',
        color: '#ff0000',
        sort_order: 10,
        description: '',
      };

      wrapper.vm.editingCategory = null;

      const promise = wrapper.vm.handleSave();
      expect(wrapper.vm.loading).toBe(true);

      await promise;
      expect(wrapper.vm.loading).toBe(false);
    });

    it('应该在删除时显示加载状态', async () => {
      wrapper = createWrapper();

      mockCategoryStore.deleteCategory.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );

      const promise = wrapper.vm.handleDelete('cat-1');
      expect(wrapper.vm.loading).toBe(true);

      await promise;
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  // 边界情况测试
  describe('Edge Cases', () => {
    it('应该处理没有描述的分类', () => {
      wrapper = createWrapper();

      const category = {
        id: 'cat-1',
        name: '技术开发',
        icon: '💻',
        color: '#1890ff',
      };

      wrapper.vm.showEditDialog(category);

      expect(wrapper.vm.formData.description).toBe('');
    });

    it('应该处理没有颜色的分类', () => {
      wrapper = createWrapper();

      const category = {
        id: 'cat-1',
        name: '技术开发',
        icon: '💻',
      };

      wrapper.vm.showEditDialog(category);

      expect(wrapper.vm.formData.color).toBe('#1890ff');
    });

    it('应该处理没有排序的分类', () => {
      wrapper = createWrapper();

      const category = {
        id: 'cat-1',
        name: '技术开发',
        icon: '💻',
        color: '#1890ff',
      };

      wrapper.vm.showEditDialog(category);

      expect(wrapper.vm.formData.sort_order).toBe(0);
    });

    it('应该处理formRef为null的情况', () => {
      wrapper = createWrapper();

      wrapper.vm.formRef = null;

      expect(() => {
        wrapper.vm.handleEditCancel();
      }).not.toThrow();
    });

    it('应该处理空的错误消息', async () => {
      wrapper = createWrapper();

      const { message } = require('ant-design-vue');

      mockCategoryStore.createCategory.mockRejectedValue(new Error());

      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      wrapper.vm.formData = {
        name: '新分类',
        icon: '🆕',
        color: '#ff0000',
        sort_order: 10,
        description: '',
      };

      wrapper.vm.editingCategory = null;

      await wrapper.vm.handleSave();

      expect(message.error).toHaveBeenCalledWith('保存分类失败');
    });

    it('应该处理多层子分类', () => {
      mockCategoryStore.rootCategories = [
        {
          id: 'cat-1',
          name: '技术开发',
          icon: '💻',
          color: '#1890ff',
          children: [
            {
              id: 'cat-1-1',
              name: '前端开发',
              icon: '🎨',
              color: '#52c41a',
            },
            {
              id: 'cat-1-2',
              name: '后端开发',
              icon: '⚙️',
              color: '#fa8c16',
            },
            {
              id: 'cat-1-3',
              name: '移动开发',
              icon: '📱',
              color: '#722ed1',
            },
          ],
        },
      ];

      wrapper = createWrapper();

      expect(wrapper.vm.secondaryCount).toBe(3);
      expect(wrapper.vm.totalCount).toBe(4);
    });

    it('应该处理activeKeys变化', async () => {
      wrapper = createWrapper();

      wrapper.vm.activeKeys = ['cat-1'];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeKeys).toEqual(['cat-1']);
    });
  });
});
