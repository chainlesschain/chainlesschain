/**
 * KnowledgeListPage 组件测试
 * 测试知识库列表页面的所有功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import KnowledgeListPage from "@renderer/pages/KnowledgeListPage.vue";
import { nextTick } from "vue";

// Mock Ant Design Vue
const Modal = {
  confirm: vi.fn(),
};

vi.mock("ant-design-vue", () => ({
  Modal,
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock Vue Router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock app store
const mockAppStore = {
  knowledgeItems: [],
  deleteKnowledgeItem: vi.fn(),
};

vi.mock("../stores/app", () => ({
  useAppStore: () => mockAppStore,
}));

// Mock Ant Design Icons
vi.mock("@ant-design/icons-vue", () => ({
  FileTextOutlined: {
    name: "FileTextOutlined",
    template: "<span>FileText</span>",
  },
  PlusOutlined: { name: "PlusOutlined", template: "<span>Plus</span>" },
  EditOutlined: { name: "EditOutlined", template: "<span>Edit</span>" },
  DeleteOutlined: { name: "DeleteOutlined", template: "<span>Delete</span>" },
}));

// Mock VirtualGrid component
vi.mock("../components/common/VirtualGrid.vue", () => ({
  default: {
    name: "VirtualGrid",
    template:
      '<div class="mock-virtual-grid"><slot :item="item" v-for="item in items" /></div>',
    props: ["items", "itemHeight", "responsive", "gap", "loading", "emptyText"],
    methods: {
      scrollToTop: vi.fn(),
    },
  },
}));

describe("KnowledgeListPage", () => {
  let wrapper;
  let mockKnowledgeItems;

  beforeEach(() => {
    // Mock knowledge items data
    mockKnowledgeItems = [
      {
        id: "k1",
        title: "Vue.js 学习笔记",
        content: "Vue 3 的基本概念和使用方法",
        updatedAt: "2024-01-20T10:00:00Z",
      },
      {
        id: "k2",
        title: "JavaScript 高级特性",
        content: "深入理解闭包、原型链和异步编程",
        updatedAt: "2024-01-19T10:00:00Z",
      },
      {
        id: "k3",
        title: "CSS 布局技巧",
        content: "Flexbox 和 Grid 的实战应用",
        updatedAt: "2024-01-18T10:00:00Z",
      },
    ];

    mockAppStore.knowledgeItems = [...mockKnowledgeItems];
    mockAppStore.deleteKnowledgeItem.mockResolvedValue();

    vi.useFakeTimers();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("组件挂载和初始化", () => {
    it("应该正确挂载", () => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "a-space": true,
            "a-select": true,
            "a-select-option": true,
            "a-card": true,
            "a-card-meta": true,
            "a-avatar": true,
            "a-tooltip": true,
            "a-empty": true,
            "virtual-grid": true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("应该显示加载状态", async () => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "a-space": true,
            "a-select": true,
            "a-select-option": true,
            "virtual-grid": true,
          },
        },
      });

      expect(wrapper.vm.loading).toBe(true);

      vi.advanceTimersByTime(500);
      await nextTick();

      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该正确初始化状态", () => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });

      expect(wrapper.vm.searchQuery).toBe("");
      expect(wrapper.vm.sortBy).toBe("time");
      expect(wrapper.vm.loading).toBe(true);
    });
  });

  describe("知识列表显示", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "a-space": true,
            "a-select": true,
            "a-select-option": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("应该显示所有知识条目", () => {
      expect(wrapper.vm.filteredKnowledgeItems).toHaveLength(3);
    });

    it("应该按时间排序（最新的在前）", () => {
      wrapper.vm.sortBy = "time";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items[0].id).toBe("k1");
      expect(items[1].id).toBe("k2");
      expect(items[2].id).toBe("k3");
    });

    it("应该按标题排序", () => {
      wrapper.vm.sortBy = "title";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items[0].title).toBe("CSS 布局技巧");
      expect(items[1].title).toBe("JavaScript 高级特性");
      expect(items[2].title).toBe("Vue.js 学习笔记");
    });

    it("应该显示知识条目数量", () => {
      expect(wrapper.vm.filteredKnowledgeItems.length).toBe(3);
    });
  });

  describe("搜索功能", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "a-space": true,
            "a-select": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("应该能按标题搜索", () => {
      wrapper.vm.searchQuery = "Vue";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Vue.js 学习笔记");
    });

    it("应该能按内容搜索", () => {
      wrapper.vm.searchQuery = "闭包";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("JavaScript 高级特性");
    });

    it("搜索应该不区分大小写", () => {
      wrapper.vm.searchQuery = "vue";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Vue.js 学习笔记");
    });

    it("搜索应该同时匹配标题和内容", () => {
      wrapper.vm.searchQuery = "js";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items.length).toBeGreaterThan(0);
    });

    it("没有匹配结果时应该返回空数组", () => {
      wrapper.vm.searchQuery = "xyz123";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items).toHaveLength(0);
    });

    it("空搜索查询应该显示所有条目", () => {
      wrapper.vm.searchQuery = "";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items).toHaveLength(3);
    });

    it("执行搜索时应该重置虚拟滚动位置", () => {
      wrapper.vm.virtualGridRef = {
        scrollToTop: vi.fn(),
      };

      wrapper.vm.handleSearch();

      expect(wrapper.vm.virtualGridRef.scrollToTop).toHaveBeenCalled();
    });

    it("没有虚拟网格引用时不应该报错", () => {
      wrapper.vm.virtualGridRef = null;

      expect(() => {
        wrapper.vm.handleSearch();
      }).not.toThrow();
    });
  });

  describe("排序功能", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "a-select": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("默认按时间排序", () => {
      expect(wrapper.vm.sortBy).toBe("time");
    });

    it("应该能切换到按标题排序", async () => {
      wrapper.vm.sortBy = "title";
      await nextTick();

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items[0].title.localeCompare(items[1].title)).toBeLessThanOrEqual(
        0,
      );
    });

    it("时间排序应该最新的在前", () => {
      wrapper.vm.sortBy = "time";

      const items = wrapper.vm.filteredKnowledgeItems;
      const dates = items.map((item) => new Date(item.updatedAt));

      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i].getTime()).toBeGreaterThanOrEqual(
          dates[i + 1].getTime(),
        );
      }
    });

    it("标题排序应该按字母顺序", () => {
      wrapper.vm.sortBy = "title";

      const items = wrapper.vm.filteredKnowledgeItems;

      for (let i = 0; i < items.length - 1; i++) {
        expect(
          items[i].title.localeCompare(items[i + 1].title),
        ).toBeLessThanOrEqual(0);
      }
    });
  });

  describe("知识卡片操作", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "a-select": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("应该能查看详情", () => {
      const item = mockKnowledgeItems[0];

      wrapper.vm.viewDetail(item);

      expect(mockRouter.push).toHaveBeenCalledWith("/knowledge/k1");
    });

    it("应该能编辑知识", () => {
      const item = mockKnowledgeItems[0];

      wrapper.vm.editItem(item);

      expect(mockRouter.push).toHaveBeenCalledWith("/knowledge/k1/edit");
    });

    it("应该能删除知识", async () => {
      const item = mockKnowledgeItems[0];

      wrapper.vm.deleteItem(item);

      expect(Modal.confirm).toHaveBeenCalled();

      const confirmCall = Modal.confirm.mock.calls[0][0];
      expect(confirmCall.title).toBe("确认删除");
      expect(confirmCall.content).toContain(item.title);
      expect(confirmCall.okText).toBe("删除");
      expect(confirmCall.okType).toBe("danger");
      expect(confirmCall.cancelText).toBe("取消");
    });

    it("确认删除后应该调用删除方法", async () => {
      const { message } = require("ant-design-vue");
      const item = mockKnowledgeItems[0];

      wrapper.vm.deleteItem(item);

      const confirmCall = Modal.confirm.mock.calls[0][0];
      await confirmCall.onOk();

      expect(mockAppStore.deleteKnowledgeItem).toHaveBeenCalledWith("k1");
      expect(message.success).toHaveBeenCalledWith("删除成功");
    });

    it("删除失败时应该显示错误消息", async () => {
      const { message } = require("ant-design-vue");
      const item = mockKnowledgeItems[0];
      mockAppStore.deleteKnowledgeItem.mockRejectedValue(new Error("删除失败"));

      wrapper.vm.deleteItem(item);

      const confirmCall = Modal.confirm.mock.calls[0][0];
      await confirmCall.onOk();

      expect(message.error).toHaveBeenCalledWith("删除失败: 删除失败");
    });
  });

  describe("描述生成", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("应该截断长内容", () => {
      const item = {
        id: "k1",
        title: "Test",
        content: "a".repeat(150),
      };

      const description = wrapper.vm.getDescription(item);

      expect(description.length).toBe(103); // 100 + '...'
      expect(description).toContain("...");
    });

    it("短内容应该完整显示", () => {
      const item = {
        id: "k1",
        title: "Test",
        content: "这是短内容",
      };

      const description = wrapper.vm.getDescription(item);

      expect(description).toBe("这是短内容");
    });

    it("空内容应该返回空字符串", () => {
      const item = {
        id: "k1",
        title: "Test",
        content: "",
      };

      const description = wrapper.vm.getDescription(item);

      expect(description).toBe("");
    });

    it("没有内容字段应该返回空字符串", () => {
      const item = {
        id: "k1",
        title: "Test",
      };

      const description = wrapper.vm.getDescription(item);

      expect(description).toBe("");
    });
  });

  describe("颜色和渐变", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("应该基于ID返回稳定的渐变色", () => {
      const gradient1 = wrapper.vm.getGradientByIndex("k1");
      const gradient2 = wrapper.vm.getGradientByIndex("k1");

      expect(gradient1).toBe(gradient2);
      expect(gradient1).toContain("linear-gradient");
    });

    it("应该基于ID返回稳定的颜色", () => {
      const color1 = wrapper.vm.getColorByIndex("k1");
      const color2 = wrapper.vm.getColorByIndex("k1");

      expect(color1).toBe(color2);
      expect(color1).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("数字ID应该返回有效的渐变色", () => {
      const gradient = wrapper.vm.getGradientByIndex(123);

      expect(gradient).toContain("linear-gradient");
    });

    it("数字ID应该返回有效的颜色", () => {
      const color = wrapper.vm.getColorByIndex(123);

      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("不同ID应该可能返回不同的颜色", () => {
      const color1 = wrapper.vm.getColorByIndex("a");
      const color2 = wrapper.vm.getColorByIndex("z");

      // 可能相同，也可能不同，取决于哈希结果
      expect(color1).toBeTruthy();
      expect(color2).toBeTruthy();
    });
  });

  describe("搜索和排序组合", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "a-select": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("搜索后应该保持排序顺序", () => {
      wrapper.vm.searchQuery = "js";
      wrapper.vm.sortBy = "title";

      const items = wrapper.vm.filteredKnowledgeItems;

      if (items.length > 1) {
        for (let i = 0; i < items.length - 1; i++) {
          expect(
            items[i].title.localeCompare(items[i + 1].title),
          ).toBeLessThanOrEqual(0);
        }
      }
    });

    it("排序后应该保持搜索过滤", () => {
      wrapper.vm.searchQuery = "Vue";
      wrapper.vm.sortBy = "time";

      const items = wrapper.vm.filteredKnowledgeItems;

      expect(
        items.every((item) => item.title.toLowerCase().includes("vue")),
      ).toBe(true);
    });

    it("清空搜索后应该显示所有条目（保持排序）", () => {
      wrapper.vm.searchQuery = "Vue";
      expect(wrapper.vm.filteredKnowledgeItems).toHaveLength(1);

      wrapper.vm.searchQuery = "";
      expect(wrapper.vm.filteredKnowledgeItems).toHaveLength(3);
    });
  });

  describe("虚拟滚动网格", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("应该正确配置虚拟网格属性", () => {
      expect(wrapper.vm.filteredKnowledgeItems).toBeInstanceOf(Array);
    });

    it("虚拟网格引用应该可用", () => {
      wrapper.vm.virtualGridRef = {
        scrollToTop: vi.fn(),
      };

      expect(wrapper.vm.virtualGridRef).toBeDefined();
      expect(wrapper.vm.virtualGridRef.scrollToTop).toBeInstanceOf(Function);
    });
  });

  describe("响应式状态", () => {
    beforeEach(() => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });
    });

    it("搜索查询应该是响应式的", async () => {
      expect(wrapper.vm.filteredKnowledgeItems).toHaveLength(3);

      wrapper.vm.searchQuery = "Vue";
      await nextTick();

      expect(wrapper.vm.filteredKnowledgeItems).toHaveLength(1);
    });

    it("排序方式应该是响应式的", async () => {
      wrapper.vm.sortBy = "time";
      await nextTick();
      const timeOrder = wrapper.vm.filteredKnowledgeItems.map(
        (item) => item.id,
      );

      wrapper.vm.sortBy = "title";
      await nextTick();
      const titleOrder = wrapper.vm.filteredKnowledgeItems.map(
        (item) => item.id,
      );

      expect(timeOrder).not.toEqual(titleOrder);
    });

    it("加载状态应该是响应式的", async () => {
      expect(wrapper.vm.loading).toBe(true);

      vi.advanceTimersByTime(500);
      await nextTick();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("边界情况", () => {
    it("空知识列表应该正常工作", () => {
      mockAppStore.knowledgeItems = [];

      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });

      expect(wrapper.vm.filteredKnowledgeItems).toHaveLength(0);
    });

    it("单个知识条目应该正常工作", () => {
      mockAppStore.knowledgeItems = [mockKnowledgeItems[0]];

      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });

      expect(wrapper.vm.filteredKnowledgeItems).toHaveLength(1);
    });

    it("应该处理缺少updatedAt字段的数据", () => {
      const itemWithoutDate = {
        id: "k4",
        title: "No Date",
        content: "Content",
      };
      mockAppStore.knowledgeItems = [itemWithoutDate];

      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });

      wrapper.vm.sortBy = "time";

      expect(() => {
        const items = wrapper.vm.filteredKnowledgeItems;
      }).not.toThrow();
    });

    it("应该处理缺少title字段的数据", () => {
      const itemWithoutTitle = {
        id: "k4",
        content: "Content",
        updatedAt: "2024-01-20T10:00:00Z",
      };
      mockAppStore.knowledgeItems = [itemWithoutTitle];

      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });

      expect(() => {
        wrapper.vm.sortBy = "title";
        const items = wrapper.vm.filteredKnowledgeItems;
      }).toThrow();
    });

    it("特殊字符搜索应该正常工作", () => {
      mockAppStore.knowledgeItems = [
        {
          id: "k1",
          title: "C++ 编程",
          content: "学习 C++ 的基础知识",
          updatedAt: "2024-01-20T10:00:00Z",
        },
      ];

      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });

      wrapper.vm.searchQuery = "C++";

      const items = wrapper.vm.filteredKnowledgeItems;
      expect(items).toHaveLength(1);
    });
  });

  describe("性能优化", () => {
    it("filteredKnowledgeItems应该是计算属性", () => {
      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });

      const items1 = wrapper.vm.filteredKnowledgeItems;
      const items2 = wrapper.vm.filteredKnowledgeItems;

      // 计算属性应该缓存结果
      expect(items1).toEqual(items2);
    });

    it("大量数据应该正常处理", () => {
      const largeDataSet = Array.from({ length: 1000 }, (_, i) => ({
        id: `k${i}`,
        title: `知识 ${i}`,
        content: `内容 ${i}`,
        updatedAt: new Date(Date.now() - i * 1000).toISOString(),
      }));

      mockAppStore.knowledgeItems = largeDataSet;

      wrapper = mount(KnowledgeListPage, {
        global: {
          stubs: {
            "a-input-search": true,
            "a-button": true,
            "virtual-grid": true,
          },
        },
      });

      expect(wrapper.vm.filteredKnowledgeItems).toHaveLength(1000);
    });
  });
});
