import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ProjectManagementPage from "@renderer/pages/projects/ProjectManagementPage.vue";

// Mock stores
const mockProjectStore = {
  projects: [
    {
      id: "proj-1",
      name: "测试项目1",
      description: "项目描述1",
      project_type: "web",
      status: "active",
      file_count: 10,
      total_size: 1024 * 1024,
      created_at: "2024-01-01T12:00:00Z",
      updated_at: "2024-01-02T12:00:00Z",
      tags: '["标签1","标签2"]',
    },
    {
      id: "proj-2",
      name: "测试项目2",
      description: "项目描述2",
      project_type: "document",
      status: "completed",
      file_count: 5,
      total_size: 512 * 1024,
      created_at: "2024-01-03T12:00:00Z",
      updated_at: "2024-01-04T12:00:00Z",
      tags: "[]",
    },
  ],
  projectStats: {
    total: 10,
    byStatus: {
      active: 5,
      completed: 3,
      archived: 2,
    },
  },
  paginatedProjects: [],
  filteredProjects: [],
  pagination: {
    current: 1,
    pageSize: 10,
  },
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  setFilter: vi.fn(),
  setPagination: vi.fn(),
  resetFilters: vi.fn(),
  setSort: vi.fn(),
};

const mockAuthStore = {
  currentUser: {
    id: "user-123",
    name: "Test User",
  },
};

vi.mock("@/stores/project", () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => mockAuthStore,
}));

// Mock ant-design-vue
vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
  Modal: {
    confirm: vi.fn(),
  },
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock xlsx
vi.mock("xlsx", () => ({
  default: {
    utils: {
      json_to_sheet: vi.fn(() => ({})),
      book_new: vi.fn(() => ({})),
      book_append_sheet: vi.fn(),
    },
    writeFile: vi.fn(),
  },
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}));

describe("ProjectManagementPage.vue", () => {
  let wrapper;

  const createWrapper = () => {
    mockProjectStore.paginatedProjects = mockProjectStore.projects;
    mockProjectStore.filteredProjects = mockProjectStore.projects;

    return mount(ProjectManagementPage, {
      global: {
        stubs: {
          "a-page-header": {
            template: '<div><slot /><slot name="extra" /></div>',
          },
          "a-button": { template: "<button><slot /></button>" },
          "a-row": { template: "<div><slot /></div>" },
          "a-col": { template: "<div><slot /></div>" },
          "a-card": {
            template:
              '<div><slot /><slot name="title" /><slot name="extra" /></div>',
          },
          "a-statistic": { template: "<div />" },
          "a-input-search": { template: "<input />" },
          "a-select": { template: "<select><slot /></select>" },
          "a-select-option": { template: "<option />" },
          "a-table": { template: "<table />" },
          "a-space": { template: "<div><slot /></div>" },
          "a-tag": { template: "<span />" },
          "a-popconfirm": { template: "<div><slot /></div>" },
          "a-modal": { template: "<div><slot /></div>" },
          "a-form": { template: "<div><slot /></div>" },
          "a-form-item": { template: "<div><slot /></div>" },
          "a-input": { template: "<input />" },
          "a-textarea": { template: "<textarea />" },
          "a-input-number": { template: '<input type="number" />' },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // 组件挂载测试
  describe("Component Mounting", () => {
    it("应该正确挂载组件", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("应该在挂载时加载项目", async () => {
      mockProjectStore.fetchProjects.mockResolvedValue();

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(mockProjectStore.fetchProjects).toHaveBeenCalledWith("user-123");
    });
  });

  // 统计数据测试
  describe("Statistics", () => {
    it("应该显示项目统计", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.projectStats).toEqual(mockProjectStore.projectStats);
    });

    it("应该计算正确的统计数字", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.projectStats.total).toBe(10);
      expect(wrapper.vm.projectStats.byStatus.active).toBe(5);
      expect(wrapper.vm.projectStats.byStatus.completed).toBe(3);
      expect(wrapper.vm.projectStats.byStatus.archived).toBe(2);
    });
  });

  // 搜索功能测试
  describe("Search Functionality", () => {
    it("应该能搜索项目", () => {
      wrapper = createWrapper();

      wrapper.vm.searchKeyword = "测试";
      wrapper.vm.handleSearch();

      expect(mockProjectStore.setFilter).toHaveBeenCalledWith(
        "searchKeyword",
        "测试",
      );
      expect(mockProjectStore.setPagination).toHaveBeenCalledWith(1);
    });

    it("应该在搜索后重置页码", () => {
      wrapper = createWrapper();

      wrapper.vm.handleSearch();

      expect(mockProjectStore.setPagination).toHaveBeenCalledWith(1);
    });
  });

  // 筛选功能测试
  describe("Filter Functionality", () => {
    it("应该能按类型筛选", () => {
      wrapper = createWrapper();

      wrapper.vm.filterType = "web";
      wrapper.vm.handleFilterChange();

      expect(mockProjectStore.setFilter).toHaveBeenCalledWith(
        "projectType",
        "web",
      );
      expect(mockProjectStore.setPagination).toHaveBeenCalledWith(1);
    });

    it("应该能按状态筛选", () => {
      wrapper = createWrapper();

      wrapper.vm.filterStatus = "active";
      wrapper.vm.handleFilterChange();

      expect(mockProjectStore.setFilter).toHaveBeenCalledWith(
        "status",
        "active",
      );
      expect(mockProjectStore.setPagination).toHaveBeenCalledWith(1);
    });

    it("应该能重置筛选", () => {
      wrapper = createWrapper();

      wrapper.vm.searchKeyword = "测试";
      wrapper.vm.filterType = "web";
      wrapper.vm.filterStatus = "active";

      wrapper.vm.handleResetFilters();

      expect(wrapper.vm.searchKeyword).toBe("");
      expect(wrapper.vm.filterType).toBe("");
      expect(wrapper.vm.filterStatus).toBe("");
      expect(mockProjectStore.resetFilters).toHaveBeenCalled();
    });
  });

  // 表格功能测试
  describe("Table Functionality", () => {
    it("应该处理分页变化", () => {
      wrapper = createWrapper();

      wrapper.vm.handleTableChange({ current: 2, pageSize: 20 }, {}, {});

      expect(mockProjectStore.setPagination).toHaveBeenCalledWith(2, 20);
    });

    it("应该处理排序", () => {
      wrapper = createWrapper();

      wrapper.vm.handleTableChange(
        { current: 1 },
        {},
        { field: "created_at", order: "ascend" },
      );

      expect(mockProjectStore.setSort).toHaveBeenCalledWith(
        "created_at",
        "asc",
      );
    });

    it("应该处理降序排序", () => {
      wrapper = createWrapper();

      wrapper.vm.handleTableChange(
        { current: 1 },
        {},
        { field: "total_size", order: "descend" },
      );

      expect(mockProjectStore.setSort).toHaveBeenCalledWith(
        "total_size",
        "desc",
      );
    });

    it("应该计算选中状态", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedRowKeys = ["proj-1", "proj-2"];

      expect(wrapper.vm.hasSelected).toBe(true);
    });

    it("应该在未选中时返回false", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedRowKeys = [];

      expect(wrapper.vm.hasSelected).toBe(false);
    });
  });

  // 创建项目测试
  describe("Create Project", () => {
    it("应该显示创建对话框", () => {
      wrapper = createWrapper();

      wrapper.vm.showCreateModal();

      expect(wrapper.vm.modalVisible).toBe(true);
      expect(wrapper.vm.isEditing).toBe(false);
      expect(wrapper.vm.formData.name).toBe("");
    });

    it("应该能创建项目", async () => {
      mockProjectStore.createProject.mockResolvedValue();

      wrapper = createWrapper();
      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      const { message } = require("ant-design-vue");

      wrapper.vm.formData.name = "新项目";
      wrapper.vm.formData.project_type = "web";
      wrapper.vm.formData.status = "draft";

      await wrapper.vm.handleModalOk();

      expect(mockProjectStore.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "新项目",
          project_type: "web",
          status: "draft",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("创建成功");
      expect(wrapper.vm.modalVisible).toBe(false);
    });

    it("应该处理表单验证失败", async () => {
      wrapper = createWrapper();
      wrapper.vm.formRef = {
        validate: vi.fn().mockRejectedValue({ errorFields: [] }),
      };

      await wrapper.vm.handleModalOk();

      expect(mockProjectStore.createProject).not.toHaveBeenCalled();
    });

    it("应该处理创建失败", async () => {
      mockProjectStore.createProject.mockRejectedValue(new Error("创建失败"));

      wrapper = createWrapper();
      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      const { message } = require("ant-design-vue");
      const { logger } = require("@/utils/logger");

      wrapper.vm.formData.name = "新项目";
      wrapper.vm.formData.project_type = "web";
      wrapper.vm.formData.status = "draft";

      await wrapper.vm.handleModalOk();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("创建失败"),
      );
    });
  });

  // 编辑项目测试
  describe("Edit Project", () => {
    it("应该显示编辑对话框", () => {
      wrapper = createWrapper();

      const project = mockProjectStore.projects[0];
      wrapper.vm.handleEdit(project);

      expect(wrapper.vm.modalVisible).toBe(true);
      expect(wrapper.vm.isEditing).toBe(true);
      expect(wrapper.vm.currentEditId).toBe("proj-1");
      expect(wrapper.vm.formData.name).toBe("测试项目1");
    });

    it("应该回显项目数据", () => {
      wrapper = createWrapper();

      const project = mockProjectStore.projects[0];
      wrapper.vm.handleEdit(project);

      expect(wrapper.vm.formData.name).toBe(project.name);
      expect(wrapper.vm.formData.description).toBe(project.description);
      expect(wrapper.vm.formData.project_type).toBe(project.project_type);
      expect(wrapper.vm.formData.status).toBe(project.status);
    });

    it("应该解析标签JSON", () => {
      wrapper = createWrapper();

      const project = mockProjectStore.projects[0];
      wrapper.vm.handleEdit(project);

      expect(wrapper.vm.formData.tags).toEqual(["标签1", "标签2"]);
    });

    it("应该处理空标签", () => {
      wrapper = createWrapper();

      const project = mockProjectStore.projects[1];
      wrapper.vm.handleEdit(project);

      expect(wrapper.vm.formData.tags).toEqual([]);
    });

    it("应该能更新项目", async () => {
      mockProjectStore.updateProject.mockResolvedValue();

      wrapper = createWrapper();
      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      const { message } = require("ant-design-vue");

      wrapper.vm.isEditing = true;
      wrapper.vm.currentEditId = "proj-1";
      wrapper.vm.formData.name = "更新的项目";

      await wrapper.vm.handleModalOk();

      expect(mockProjectStore.updateProject).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({
          name: "更新的项目",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("编辑成功");
    });
  });

  // 删除项目测试
  describe("Delete Project", () => {
    it("应该能删除项目", async () => {
      mockProjectStore.deleteProject.mockResolvedValue();

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleDelete("proj-1");

      expect(mockProjectStore.deleteProject).toHaveBeenCalledWith("proj-1");
      expect(message.success).toHaveBeenCalledWith("删除成功");
    });

    it("应该处理删除失败", async () => {
      mockProjectStore.deleteProject.mockRejectedValue(new Error("删除失败"));

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");
      const { logger } = require("@/utils/logger");

      await wrapper.vm.handleDelete("proj-1");

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("删除失败"),
      );
    });

    it("应该在删除后调整分页", async () => {
      mockProjectStore.deleteProject.mockResolvedValue();
      mockProjectStore.pagination.current = 2;

      wrapper = createWrapper();
      mockProjectStore.paginatedProjects = [];

      await wrapper.vm.handleDelete("proj-1");

      expect(mockProjectStore.setPagination).toHaveBeenCalledWith(1);
    });
  });

  // 批量删除测试
  describe("Batch Delete", () => {
    it("应该警告未选择项目", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedRowKeys = [];

      const { message } = require("ant-design-vue");

      wrapper.vm.handleBatchDelete();

      expect(message.warning).toHaveBeenCalledWith("请先选择要删除的项目");
    });

    it("应该显示确认对话框", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedRowKeys = ["proj-1", "proj-2"];

      const { Modal } = require("ant-design-vue");

      wrapper.vm.handleBatchDelete();

      expect(Modal.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "批量删除确认",
          content: expect.stringContaining("2 个项目"),
        }),
      );
    });

    it("应该能批量删除", async () => {
      mockProjectStore.deleteProject.mockResolvedValue();

      wrapper = createWrapper();
      wrapper.vm.selectedRowKeys = ["proj-1", "proj-2"];

      const { Modal, message } = require("ant-design-vue");

      wrapper.vm.handleBatchDelete();

      // 执行确认回调
      const confirmCall = Modal.confirm.mock.calls[0][0];
      await confirmCall.onOk();

      expect(mockProjectStore.deleteProject).toHaveBeenCalledTimes(2);
      expect(message.success).toHaveBeenCalledWith("成功删除 2 个项目");
      expect(wrapper.vm.selectedRowKeys).toEqual([]);
    });

    it("应该处理批量删除失败", async () => {
      mockProjectStore.deleteProject.mockRejectedValue(new Error("删除失败"));

      wrapper = createWrapper();
      wrapper.vm.selectedRowKeys = ["proj-1"];

      const { Modal, message } = require("ant-design-vue");
      const { logger } = require("@/utils/logger");

      wrapper.vm.handleBatchDelete();

      const confirmCall = Modal.confirm.mock.calls[0][0];
      await confirmCall.onOk();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("批量删除失败"),
      );
    });
  });

  // 查看项目测试
  describe("View Project", () => {
    it("应该能跳转到项目详情", () => {
      wrapper = createWrapper();

      const project = mockProjectStore.projects[0];
      wrapper.vm.handleView(project);

      expect(mockRouter.push).toHaveBeenCalledWith("/projects/proj-1");
    });
  });

  // 导出Excel测试
  describe("Export Excel", () => {
    it("应该能导出Excel", () => {
      wrapper = createWrapper();
      const { message } = require("ant-design-vue");
      const XLSX = require("xlsx").default;

      wrapper.vm.handleExport();

      expect(XLSX.utils.json_to_sheet).toHaveBeenCalled();
      expect(XLSX.writeFile).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith("导出成功");
    });

    it("应该处理导出失败", () => {
      wrapper = createWrapper();
      const { message } = require("ant-design-vue");
      const { logger } = require("@/utils/logger");
      const XLSX = require("xlsx").default;

      XLSX.utils.json_to_sheet.mockImplementation(() => {
        throw new Error("导出失败");
      });

      wrapper.vm.handleExport();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("导出失败"),
      );
    });
  });

  // 辅助函数测试
  describe("Helper Functions", () => {
    it("应该获取项目类型标签", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getProjectTypeLabel("web")).toBe("网页");
      expect(wrapper.vm.getProjectTypeLabel("document")).toBe("文档");
      expect(wrapper.vm.getProjectTypeLabel("data")).toBe("数据");
      expect(wrapper.vm.getProjectTypeLabel("app")).toBe("应用");
      expect(wrapper.vm.getProjectTypeLabel("unknown")).toBe("unknown");
    });

    it("应该获取项目类型颜色", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getProjectTypeColor("web")).toBe("blue");
      expect(wrapper.vm.getProjectTypeColor("document")).toBe("green");
      expect(wrapper.vm.getProjectTypeColor("unknown")).toBe("default");
    });

    it("应该获取状态标签", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getStatusLabel("draft")).toBe("草稿");
      expect(wrapper.vm.getStatusLabel("active")).toBe("活跃");
      expect(wrapper.vm.getStatusLabel("completed")).toBe("已完成");
      expect(wrapper.vm.getStatusLabel("archived")).toBe("已归档");
    });

    it("应该获取状态颜色", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getStatusColor("draft")).toBe("default");
      expect(wrapper.vm.getStatusColor("active")).toBe("success");
      expect(wrapper.vm.getStatusColor("completed")).toBe("processing");
      expect(wrapper.vm.getStatusColor("archived")).toBe("warning");
    });

    it("应该格式化文件大小", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatFileSize(0)).toBe("0 B");
      expect(wrapper.vm.formatFileSize(1024)).toBe("1 KB");
      expect(wrapper.vm.formatFileSize(1024 * 1024)).toBe("1 MB");
      expect(wrapper.vm.formatFileSize(1024 * 1024 * 1024)).toBe("1 GB");
    });

    it("应该格式化日期时间", () => {
      wrapper = createWrapper();

      const result = wrapper.vm.formatDateTime("2024-01-01T12:00:00Z");

      expect(result).toBeTruthy();
      expect(result).not.toBe("-");
    });

    it("应该处理空日期", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatDateTime(null)).toBe("-");
      expect(wrapper.vm.formatDateTime(undefined)).toBe("-");
    });
  });

  // 对话框测试
  describe("Modal", () => {
    it("应该能取消对话框", () => {
      wrapper = createWrapper();
      wrapper.vm.modalVisible = true;

      wrapper.vm.handleModalCancel();

      expect(wrapper.vm.modalVisible).toBe(false);
    });

    it("应该在保存时序列化标签", async () => {
      mockProjectStore.createProject.mockResolvedValue();

      wrapper = createWrapper();
      wrapper.vm.formRef = {
        validate: vi.fn().mockResolvedValue(),
      };

      wrapper.vm.formData.name = "新项目";
      wrapper.vm.formData.project_type = "web";
      wrapper.vm.formData.status = "draft";
      wrapper.vm.formData.tags = ["标签1", "标签2"];

      await wrapper.vm.handleModalOk();

      expect(mockProjectStore.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: '["标签1","标签2"]',
        }),
      );
    });
  });

  // 加载状态测试
  describe("Loading State", () => {
    it("应该在加载时显示loading", async () => {
      mockProjectStore.fetchProjects.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          }),
      );

      wrapper = createWrapper();

      const promise = wrapper.vm.loadProjects();
      expect(wrapper.vm.loading).toBe(true);

      await promise;
      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该在删除时显示loading", async () => {
      mockProjectStore.deleteProject.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          }),
      );

      wrapper = createWrapper();

      const promise = wrapper.vm.handleDelete("proj-1");
      expect(wrapper.vm.loading).toBe(true);

      await promise;
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  // 计算属性测试
  describe("Computed Properties", () => {
    it("应该返回分页数据", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.paginatedData).toEqual(
        mockProjectStore.paginatedProjects,
      );
    });

    it("应该返回分页配置", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.pagination.current).toBe(1);
      expect(wrapper.vm.pagination.pageSize).toBe(10);
    });

    it("应该返回行选择配置", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedRowKeys = ["proj-1"];

      const config = wrapper.vm.rowSelection;

      expect(config.selectedRowKeys).toEqual(["proj-1"]);
      expect(config.onChange).toBeDefined();

      // 测试onChange
      config.onChange(["proj-1", "proj-2"]);
      expect(wrapper.vm.selectedRowKeys).toEqual(["proj-1", "proj-2"]);
    });
  });

  // 表单验证测试
  describe("Form Validation", () => {
    it("应该定义表单验证规则", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formRules.name).toBeDefined();
      expect(wrapper.vm.formRules.project_type).toBeDefined();
      expect(wrapper.vm.formRules.status).toBeDefined();
    });

    it("应该验证项目名称为必填", () => {
      wrapper = createWrapper();

      const nameRules = wrapper.vm.formRules.name;
      expect(nameRules[0].required).toBe(true);
    });

    it("应该验证项目名称长度", () => {
      wrapper = createWrapper();

      const nameRules = wrapper.vm.formRules.name;
      expect(nameRules[1].min).toBe(1);
      expect(nameRules[1].max).toBe(100);
    });
  });

  // 边界情况测试
  describe("Edge Cases", () => {
    it("应该处理无用户情况", async () => {
      mockAuthStore.currentUser = null;
      mockProjectStore.fetchProjects.mockResolvedValue();

      wrapper = createWrapper();
      await wrapper.vm.loadProjects();

      expect(mockProjectStore.fetchProjects).toHaveBeenCalledWith(
        "default-user",
      );
    });

    it("应该处理空描述", () => {
      wrapper = createWrapper();

      const project = { ...mockProjectStore.projects[0], description: null };
      wrapper.vm.handleEdit(project);

      expect(wrapper.vm.formData.description).toBe("");
    });

    it("应该处理空标签", () => {
      wrapper = createWrapper();

      const project = { ...mockProjectStore.projects[0], tags: null };
      wrapper.vm.handleEdit(project);

      expect(wrapper.vm.formData.tags).toEqual([]);
    });

    it("应该处理分页数据为空", () => {
      mockProjectStore.paginatedProjects = [];

      wrapper = createWrapper();

      expect(wrapper.vm.paginatedData).toEqual([]);
    });
  });
});
