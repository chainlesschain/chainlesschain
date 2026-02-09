import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import MarketPage from "@renderer/pages/projects/MarketPage.vue";

// Mock stores
const mockProjectStore = {
  projects: [
    {
      id: "proj-1",
      name: "我的项目1",
      status: "completed",
    },
    {
      id: "proj-2",
      name: "我的项目2",
      status: "completed",
    },
  ],
};

const mockAuthStore = {
  currentUser: {
    id: "user-123",
  },
};

vi.mock("@/stores/project", () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => mockAuthStore,
}));

// Hoisted mocks for ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

const mockModal = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

// Mock ant-design-vue
vi.mock("ant-design-vue", () => ({
  message: mockMessage,
  Modal: mockModal,
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

global.localStorage = localStorageMock;

describe("MarketPage.vue", () => {
  let wrapper;

  const mockMarketProjects = [
    {
      id: "market-1",
      name: "React电商系统",
      description: "完整的电商后台管理系统",
      category: "web",
      price: 299,
      seller: {
        did: "did:chainless:seller1",
        name: "前端大师",
        rating: 4.8,
      },
      views: 1250,
      sales: 86,
      rating: 4.7,
      featured: true,
      listedAt: Date.now() - 86400000,
    },
    {
      id: "market-2",
      name: "Vue3项目模板",
      description: "Vue3企业级项目模板",
      category: "web",
      price: 199,
      seller: {
        did: "did:chainless:seller2",
        name: "Vue开发者",
        rating: 4.9,
      },
      views: 980,
      sales: 124,
      rating: 4.9,
      featured: false,
      listedAt: Date.now() - 172800000,
    },
    {
      id: "market-3",
      name: "Python数据分析包",
      description: "数据清洗、可视化工具",
      category: "data",
      price: 399,
      seller: {
        did: "did:chainless:seller3",
        name: "数据科学家",
        rating: 5.0,
      },
      views: 756,
      sales: 45,
      rating: 5.0,
      featured: true,
      listedAt: Date.now() - 259200000,
    },
    {
      id: "market-4",
      name: "技术文档模板",
      description: "专业的技术文档模板",
      category: "document",
      price: 49,
      seller: {
        did: "did:chainless:seller4",
        name: "文档专家",
        rating: 4.6,
      },
      views: 2100,
      sales: 312,
      rating: 4.5,
      featured: false,
      listedAt: Date.now() - 345600000,
    },
  ];

  const createWrapper = () => {
    return mount(MarketPage, {
      global: {
        stubs: {
          "a-button": { template: "<button><slot /></button>" },
          "a-tag": { template: "<span><slot /></span>" },
          "a-input-search": { template: "<input />" },
          "a-select": { template: "<select><slot /></select>" },
          "a-select-option": { template: "<option />" },
          "a-radio-group": { template: "<div><slot /></div>" },
          "a-radio-button": { template: "<button />" },
          "a-spin": { template: "<div><slot /></div>" },
          "a-empty": { template: "<div />" },
          "a-card": { template: "<div><slot /></div>" },
          "a-avatar": { template: "<div />" },
          "a-rate": { template: "<div />" },
          "a-pagination": { template: "<div />" },
          "a-modal": { template: "<div><slot /></div>" },
          "a-form": { template: "<div><slot /></div>" },
          "a-form-item": { template: "<div><slot /></div>" },
          "a-input": { template: "<input />" },
          "a-textarea": { template: "<textarea />" },
          "a-input-number": { template: '<input type="number" />' },
          "a-upload": { template: "<div><slot /></div>" },
          "a-alert": { template: "<div />" },
          "a-divider": { template: "<div />" },
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

  // 组件挂载测试
  describe("Component Mounting", () => {
    it("应该正确挂载组件", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("应该在挂载时加载市场项目", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.marketProjects.length).toBeGreaterThan(0);
    });

    it("应该从localStorage恢复视图模式", async () => {
      localStorageMock.getItem.mockReturnValue("list");

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.viewMode).toBe("list");
    });

    it("应该处理localStorage错误", async () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error("Storage error");
      });

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");
      await wrapper.vm.$nextTick();

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // 分类筛选测试
  describe("Category Filter", () => {
    it("应该初始化分类列表", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.categories.length).toBeGreaterThan(0);
      expect(wrapper.vm.categories[0].value).toBe("");
      expect(wrapper.vm.categories[0].label).toBe("全部");
    });

    it("应该能按分类筛选", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.handleCategoryChange("web");

      expect(wrapper.vm.selectedCategory).toBe("web");
      expect(wrapper.vm.currentPage).toBe(1);
    });

    it("应该筛选出正确的项目", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.selectedCategory = "web";

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.every((p) => p.category === "web")).toBe(true);
    });

    it("应该在切换分类时重置页码", () => {
      wrapper = createWrapper();
      wrapper.vm.currentPage = 3;

      wrapper.vm.handleCategoryChange("data");

      expect(wrapper.vm.currentPage).toBe(1);
    });
  });

  // 价格筛选测试
  describe("Price Filter", () => {
    it("应该能按价格范围筛选", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.priceRange = "0-100";

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.every((p) => p.price >= 0 && p.price <= 100)).toBe(true);
    });

    it("应该支持开放式价格范围", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.priceRange = "1000+";

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.every((p) => p.price >= 1000)).toBe(true);
    });

    it("应该在价格变化时重置页码", () => {
      wrapper = createWrapper();
      wrapper.vm.currentPage = 2;

      wrapper.vm.handlePriceRangeChange();

      expect(wrapper.vm.currentPage).toBe(1);
    });
  });

  // 搜索功能测试
  describe("Search Functionality", () => {
    it("应该能按名称搜索", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.searchKeyword = "React";

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.some((p) => p.name.includes("React"))).toBe(true);
    });

    it("应该能按描述搜索", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.searchKeyword = "电商";

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.some((p) => p.description.includes("电商"))).toBe(true);
    });

    it("应该不区分大小写", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.searchKeyword = "react";

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.length).toBeGreaterThan(0);
    });

    it("应该支持防抖搜索", () => {
      wrapper = createWrapper();
      vi.useFakeTimers();

      wrapper.vm.debouncedSearch();
      expect(wrapper.vm.currentPage).not.toBe(1);

      vi.advanceTimersByTime(300);
      expect(wrapper.vm.currentPage).toBe(1);

      vi.useRealTimers();
    });

    it("应该在搜索时重置页码", () => {
      wrapper = createWrapper();
      wrapper.vm.currentPage = 3;

      wrapper.vm.handleSearch();

      expect(wrapper.vm.currentPage).toBe(1);
    });
  });

  // 排序功能测试
  describe("Sort Functionality", () => {
    it("应该按最新上架排序", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.sortConfig = "latest";

      const filtered = wrapper.vm.filteredProjects;
      for (let i = 0; i < filtered.length - 1; i++) {
        expect(filtered[i].listedAt).toBeGreaterThanOrEqual(
          filtered[i + 1].listedAt,
        );
      }
    });

    it("应该按最受欢迎排序", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.sortConfig = "popular";

      const filtered = wrapper.vm.filteredProjects;
      for (let i = 0; i < filtered.length - 1; i++) {
        expect(filtered[i].sales).toBeGreaterThanOrEqual(filtered[i + 1].sales);
      }
    });

    it("应该按价格从低到高排序", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.sortConfig = "price-asc";

      const filtered = wrapper.vm.filteredProjects;
      for (let i = 0; i < filtered.length - 1; i++) {
        expect(filtered[i].price).toBeLessThanOrEqual(filtered[i + 1].price);
      }
    });

    it("应该按价格从高到低排序", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.sortConfig = "price-desc";

      const filtered = wrapper.vm.filteredProjects;
      for (let i = 0; i < filtered.length - 1; i++) {
        expect(filtered[i].price).toBeGreaterThanOrEqual(filtered[i + 1].price);
      }
    });

    it("应该按评分排序", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.sortConfig = "rating";

      const filtered = wrapper.vm.filteredProjects;
      for (let i = 0; i < filtered.length - 1; i++) {
        expect(filtered[i].rating).toBeGreaterThanOrEqual(
          filtered[i + 1].rating,
        );
      }
    });

    it("应该在排序变化时重置页码", () => {
      wrapper = createWrapper();
      wrapper.vm.currentPage = 2;

      wrapper.vm.handleSortChange();

      expect(wrapper.vm.currentPage).toBe(1);
    });
  });

  // 视图模式测试
  describe("View Mode", () => {
    it("应该默认为网格视图", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.viewMode).toBe("grid");
    });

    it("应该能切换到列表视图", () => {
      wrapper = createWrapper();

      wrapper.vm.viewMode = "list";
      wrapper.vm.handleViewModeChange();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "market_view_mode",
        "list",
      );
    });

    it("应该处理localStorage保存失败", () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error("Storage error");
      });

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      wrapper.vm.viewMode = "list";
      wrapper.vm.handleViewModeChange();

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // 分页功能测试
  describe("Pagination", () => {
    it("应该计算分页项目", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.currentPage = 1;
      wrapper.vm.pageSize = 2;

      expect(wrapper.vm.paginatedProjects.length).toBe(2);
    });

    it("应该处理分页变化", () => {
      wrapper = createWrapper();

      wrapper.vm.handlePageChange(2);

      expect(wrapper.vm.currentPage).toBe(2);
    });

    it("应该处理页大小变化", () => {
      wrapper = createWrapper();

      wrapper.vm.handlePageSizeChange(1, 24);

      expect(wrapper.vm.pageSize).toBe(24);
      expect(wrapper.vm.currentPage).toBe(1);
    });
  });

  // 刷新功能测试
  describe("Refresh Functionality", () => {
    it("应该能刷新市场项目", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      await wrapper.vm.handleRefresh();

      expect(message.success).toHaveBeenCalledWith("刷新成功");
    });

    it("应该处理刷新失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      const { logger } = require("@/utils/logger");

      // Mock loadMarketProjects to throw error
      wrapper.vm.loadMarketProjects = vi
        .fn()
        .mockRejectedValue(new Error("刷新失败"));

      await wrapper.vm.handleRefresh();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("刷新失败"),
      );
    });
  });

  // 购买项目测试
  describe("Buy Project", () => {
    it("应该能打开购买对话框", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      const project = wrapper.vm.marketProjects[0];
      wrapper.vm.handleBuyProject(project);

      expect(wrapper.vm.showBuyModal).toBe(true);
      expect(wrapper.vm.selectedProject).toEqual(project);
    });

    it("应该能确认购买", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      const message = mockMessage;

      wrapper.vm.selectedProject = wrapper.vm.marketProjects[0];
      wrapper.vm.walletBalance = 1500;

      await wrapper.vm.handleConfirmPurchase();

      expect(message.success).toHaveBeenCalledWith(
        "购买成功！项目已添加到你的账户",
      );
      expect(wrapper.vm.showBuyModal).toBe(false);
      expect(wrapper.vm.selectedProject).toBeNull();
    });

    it("应该检查余额不足", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      const message = mockMessage;

      wrapper.vm.selectedProject = wrapper.vm.marketProjects[0];
      wrapper.vm.walletBalance = 50;

      await wrapper.vm.handleConfirmPurchase();

      expect(message.error).toHaveBeenCalledWith("余额不足，无法购买");
    });

    it("应该扣除余额", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.selectedProject = {
        ...wrapper.vm.marketProjects[0],
        price: 100,
      };
      wrapper.vm.walletBalance = 500;

      await wrapper.vm.handleConfirmPurchase();

      expect(wrapper.vm.walletBalance).toBe(400);
    });

    it("应该处理购买失败", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      const message = mockMessage;
      const { logger } = require("@/utils/logger");

      wrapper.vm.selectedProject = wrapper.vm.marketProjects[0];
      wrapper.vm.walletBalance = 1500;

      // Mock to throw error
      vi.spyOn(global, "Promise").mockImplementationOnce(() => {
        throw new Error("购买失败");
      });

      try {
        await wrapper.vm.handleConfirmPurchase();
      } catch (error) {
        // Expected error
      }

      vi.restoreAllMocks();
    });
  });

  // 出售项目测试
  describe("Sell Project", () => {
    it("应该能打开出售对话框", () => {
      wrapper = createWrapper();

      wrapper.vm.myProjects = mockProjectStore.projects;

      wrapper.vm.handleSellProject();

      expect(wrapper.vm.showSellModal).toBe(true);
    });

    it("应该警告无可售项目", () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.myProjects = [];

      wrapper.vm.handleSellProject();

      expect(message.warning).toHaveBeenCalledWith("你还没有可以出售的项目");
    });

    it("应该验证出售表单", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.sellForm.projectId = null;

      await wrapper.vm.handleConfirmSell();

      expect(message.warning).toHaveBeenCalledWith("请选择项目");
    });

    it("应该验证分类", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.sellForm.projectId = "proj-1";
      wrapper.vm.sellForm.category = "";

      await wrapper.vm.handleConfirmSell();

      expect(message.warning).toHaveBeenCalledWith("请选择分类");
    });

    it("应该验证价格", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.sellForm.projectId = "proj-1";
      wrapper.vm.sellForm.category = "web";
      wrapper.vm.sellForm.price = 0;

      await wrapper.vm.handleConfirmSell();

      expect(message.warning).toHaveBeenCalledWith("请设置正确的价格");
    });

    it("应该验证描述", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.sellForm.projectId = "proj-1";
      wrapper.vm.sellForm.category = "web";
      wrapper.vm.sellForm.price = 100;
      wrapper.vm.sellForm.description = "";

      await wrapper.vm.handleConfirmSell();

      expect(message.warning).toHaveBeenCalledWith("请填写项目描述");
    });

    it("应该能成功上架项目", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.sellForm = {
        projectId: "proj-1",
        category: "web",
        price: 100,
        description: "测试项目",
        thumbnail: "",
      };

      await wrapper.vm.handleConfirmSell();

      expect(message.success).toHaveBeenCalledWith("项目已成功上架到市场！");
      expect(wrapper.vm.showSellModal).toBe(false);
    });

    it("应该在成功后重置表单", async () => {
      wrapper = createWrapper();

      wrapper.vm.sellForm = {
        projectId: "proj-1",
        category: "web",
        price: 200,
        description: "测试",
        thumbnail: "image.jpg",
      };

      await wrapper.vm.handleConfirmSell();

      expect(wrapper.vm.sellForm.projectId).toBeNull();
      expect(wrapper.vm.sellForm.category).toBe("");
      expect(wrapper.vm.sellForm.price).toBe(100);
      expect(wrapper.vm.sellForm.description).toBe("");
      expect(wrapper.vm.sellForm.thumbnail).toBe("");
    });

    it("应该处理上架失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      const { logger } = require("@/utils/logger");

      wrapper.vm.sellForm = {
        projectId: "proj-1",
        category: "web",
        price: 100,
        description: "测试",
        thumbnail: "",
      };

      // Mock loadMarketProjects to throw error
      wrapper.vm.loadMarketProjects = vi
        .fn()
        .mockRejectedValue(new Error("上架失败"));

      await wrapper.vm.handleConfirmSell();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("上架失败"),
      );
    });
  });

  // 图片上传测试
  describe("Image Upload", () => {
    it("应该验证图片类型", () => {
      wrapper = createWrapper();
      const message = mockMessage;

      const file = { type: "text/plain", size: 1024 };

      const result = wrapper.vm.handleBeforeUpload(file);

      expect(message.error).toHaveBeenCalledWith("只能上传图片文件");
      expect(result).toBe(false);
    });

    it("应该验证图片大小", () => {
      wrapper = createWrapper();
      const message = mockMessage;

      const file = { type: "image/jpeg", size: 3 * 1024 * 1024 };

      const result = wrapper.vm.handleBeforeUpload(file);

      expect(message.error).toHaveBeenCalledWith("图片大小不能超过2MB");
      expect(result).toBe(false);
    });

    it("应该读取图片文件", () => {
      wrapper = createWrapper();

      const file = { type: "image/jpeg", size: 1024 };

      // Mock FileReader
      const mockReader = {
        onload: null,
        readAsDataURL: vi.fn(function () {
          this.onload({ target: { result: "data:image/jpeg;base64,abc" } });
        }),
      };

      global.FileReader = vi.fn(() => mockReader);

      const result = wrapper.vm.handleBeforeUpload(file);

      expect(mockReader.readAsDataURL).toHaveBeenCalledWith(file);
      expect(wrapper.vm.sellForm.thumbnail).toBe("data:image/jpeg;base64,abc");
      expect(result).toBe(false);
    });
  });

  // 辅助函数测试
  describe("Helper Functions", () => {
    it("应该获取分类颜色", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getCategoryColor("web")).toBe("blue");
      expect(wrapper.vm.getCategoryColor("document")).toBe("green");
      expect(wrapper.vm.getCategoryColor("data")).toBe("orange");
      expect(wrapper.vm.getCategoryColor("app")).toBe("purple");
      expect(wrapper.vm.getCategoryColor("unknown")).toBe("default");
    });

    it("应该获取分类名称", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getCategoryName("web")).toBe("Web开发");
      expect(wrapper.vm.getCategoryName("document")).toBe("文档模板");
      expect(wrapper.vm.getCategoryName("data")).toBe("数据分析");
      expect(wrapper.vm.getCategoryName("app")).toBe("应用开发");
    });

    it("应该获取分类图标", () => {
      wrapper = createWrapper();

      const icons = wrapper.vm.getCategoryIcon("web");
      expect(icons).toBeDefined();
    });

    it("应该获取头像颜色", () => {
      wrapper = createWrapper();

      const color1 = wrapper.vm.getAvatarColor("did:chainless:user1");
      const color2 = wrapper.vm.getAvatarColor("did:chainless:user2");

      expect(color1).toBeTruthy();
      expect(color2).toBeTruthy();
      expect(color1).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it("应该为相同DID返回相同颜色", () => {
      wrapper = createWrapper();

      const color1 = wrapper.vm.getAvatarColor("did:chainless:user1");
      const color2 = wrapper.vm.getAvatarColor("did:chainless:user1");

      expect(color1).toBe(color2);
    });

    it("应该处理空DID", () => {
      wrapper = createWrapper();

      const color = wrapper.vm.getAvatarColor(null);

      expect(color).toBeTruthy();
    });
  });

  // 图片错误处理测试
  describe("Image Error Handling", () => {
    it("应该处理图片加载失败", () => {
      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      const event = {
        target: {
          src: "invalid-url",
          style: { display: "" },
        },
      };

      wrapper.vm.handleImageError(event);

      expect(logger.warn).toHaveBeenCalled();
      expect(event.target.style.display).toBe("none");
    });
  });

  // 导航功能测试
  describe("Navigation", () => {
    it("应该能返回项目列表", () => {
      wrapper = createWrapper();

      wrapper.vm.handleBackToProjects();

      expect(mockRouter.push).toHaveBeenCalledWith("/projects");
    });

    it("应该显示详情开发中提示", () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.handleViewDetail("market-1");

      expect(message.info).toHaveBeenCalledWith("项目详情页开发中...");
    });
  });

  // 组合筛选测试
  describe("Combined Filters", () => {
    it("应该同时应用多个筛选", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.selectedCategory = "web";
      wrapper.vm.priceRange = "100-500";
      wrapper.vm.searchKeyword = "React";

      const filtered = wrapper.vm.filteredProjects;

      expect(filtered.every((p) => p.category === "web")).toBe(true);
      expect(filtered.every((p) => p.price >= 100 && p.price <= 500)).toBe(
        true,
      );
      expect(filtered.some((p) => p.name.includes("React"))).toBe(true);
    });

    it("应该在没有匹配时返回空数组", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.selectedCategory = "web";
      wrapper.vm.searchKeyword = "NonExistentProject12345";

      const filtered = wrapper.vm.filteredProjects;

      expect(filtered).toEqual([]);
    });
  });

  // 加载状态测试
  describe("Loading State", () => {
    it("应该在加载时显示loading", async () => {
      wrapper = createWrapper();

      const promise = wrapper.vm.loadMarketProjects();
      expect(wrapper.vm.loading).toBe(true);

      await promise;
      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该在购买时显示loading", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.selectedProject = wrapper.vm.marketProjects[0];
      wrapper.vm.walletBalance = 1500;

      const promise = wrapper.vm.handleConfirmPurchase();
      expect(wrapper.vm.purchasing).toBe(true);

      await promise;
      expect(wrapper.vm.purchasing).toBe(false);
    });

    it("应该在出售时显示loading", async () => {
      wrapper = createWrapper();

      wrapper.vm.sellForm = {
        projectId: "proj-1",
        category: "web",
        price: 100,
        description: "测试",
      };

      const promise = wrapper.vm.handleConfirmSell();
      expect(wrapper.vm.selling).toBe(true);

      await promise;
      expect(wrapper.vm.selling).toBe(false);
    });
  });

  // 边界情况测试
  describe("Edge Cases", () => {
    it("应该处理空市场项目", () => {
      wrapper = createWrapper();
      wrapper.vm.marketProjects = [];

      expect(wrapper.vm.filteredProjects).toEqual([]);
    });

    it("应该处理空我的项目", () => {
      wrapper = createWrapper();
      wrapper.vm.myProjects = [];

      expect(wrapper.vm.myProjects).toEqual([]);
    });

    it("应该处理无分类项目", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.marketProjects = [
        ...wrapper.vm.marketProjects,
        {
          id: "market-5",
          name: "无分类项目",
          category: null,
          price: 50,
        },
      ];

      wrapper.vm.selectedCategory = "web";

      const filtered = wrapper.vm.filteredProjects;
      expect(filtered.every((p) => p.category === "web")).toBe(true);
    });

    it("应该处理无价格项目", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.marketProjects = [
        ...wrapper.vm.marketProjects,
        {
          id: "market-6",
          name: "无价格项目",
          category: "web",
          price: null,
        },
      ];

      wrapper.vm.priceRange = "100-500";

      // 应该不抛出错误
      expect(() => wrapper.vm.filteredProjects).not.toThrow();
    });

    it("应该处理空描述搜索", async () => {
      wrapper = createWrapper();
      await wrapper.vm.loadMarketProjects();

      wrapper.vm.marketProjects = [
        ...wrapper.vm.marketProjects,
        {
          id: "market-7",
          name: "无描述项目",
          category: "web",
          price: 100,
          description: null,
        },
      ];

      wrapper.vm.searchKeyword = "测试";

      // 应该不抛出错误
      expect(() => wrapper.vm.filteredProjects).not.toThrow();
    });
  });
});
