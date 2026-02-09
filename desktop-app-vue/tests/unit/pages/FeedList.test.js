/**
 * FeedList 组件测试
 * 测试RSS订阅管理页面的所有功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import FeedList from "@renderer/pages/rss/FeedList.vue";
import { nextTick } from "vue";

// Mock Ant Design Vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("ant-design-vue", () => ({
  message: mockMessage,
}));

// Mock Vue Router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock Ant Design Icons
vi.mock("@ant-design/icons-vue", () => ({
  PlusOutlined: { name: "PlusOutlined", template: "<span>Plus</span>" },
  SearchOutlined: { name: "SearchOutlined", template: "<span>Search</span>" },
  ReloadOutlined: { name: "ReloadOutlined", template: "<span>Reload</span>" },
  EditOutlined: { name: "EditOutlined", template: "<span>Edit</span>" },
  DeleteOutlined: { name: "DeleteOutlined", template: "<span>Delete</span>" },
  AppstoreOutlined: {
    name: "AppstoreOutlined",
    template: "<span>Appstore</span>",
  },
  BellOutlined: { name: "BellOutlined", template: "<span>Bell</span>" },
  StarOutlined: { name: "StarOutlined", template: "<span>Star</span>" },
  FolderOutlined: { name: "FolderOutlined", template: "<span>Folder</span>" },
  ReadOutlined: { name: "ReadOutlined", template: "<span>Read</span>" },
}));

// Mock dayjs
vi.mock("dayjs", () => {
  const mockDayjs = (timestamp) => ({
    fromNow: () => "2小时前",
  });
  mockDayjs.extend = vi.fn();
  mockDayjs.locale = vi.fn();
  return { default: mockDayjs };
});

describe("FeedList", () => {
  let wrapper;
  let mockFeeds;
  let mockCategories;

  beforeEach(() => {
    // Mock Electron API
    global.window = {
      electron: {
        ipcRenderer: {
          invoke: vi.fn(),
        },
      },
    };

    // Mock feeds data
    mockFeeds = [
      {
        id: "feed-1",
        title: "Tech News",
        description: "Latest technology news",
        url: "https://example.com/feed1.xml",
        image_url: "https://example.com/icon1.png",
        category: "cat-1",
        status: "active",
        last_fetched_at: Date.now(),
        update_frequency: 3600,
        error_message: null,
      },
      {
        id: "feed-2",
        title: "Science Blog",
        description: "Science articles",
        url: "https://example.com/feed2.xml",
        image_url: null,
        category: "cat-2",
        status: "error",
        last_fetched_at: Date.now() - 86400000,
        update_frequency: 7200,
        error_message: "获取失败",
      },
      {
        id: "feed-3",
        title: "Paused Feed",
        description: "Currently paused",
        url: "https://example.com/feed3.xml",
        image_url: null,
        category: "cat-1",
        status: "paused",
        last_fetched_at: Date.now() - 172800000,
        update_frequency: 3600,
        error_message: null,
      },
    ];

    // Mock categories data
    mockCategories = [
      { id: "cat-1", name: "技术", color: "#1890ff" },
      { id: "cat-2", name: "科学", color: "#52c41a" },
    ];

    window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === "rss:get-feeds") {
        return Promise.resolve({ success: true, feeds: mockFeeds });
      } else if (channel === "rss:get-categories") {
        return Promise.resolve({ success: true, categories: mockCategories });
      }
      return Promise.resolve({ success: false });
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("组件挂载和初始化", () => {
    it("应该正确挂载", () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-space": true,
            "a-menu": true,
            "a-menu-item": true,
            "a-menu-divider": true,
            "a-list": true,
            "a-list-item": true,
            "a-list-item-meta": true,
            "a-avatar": true,
            "a-tag": true,
            "a-tooltip": true,
            "a-popconfirm": true,
            "a-modal": true,
            "a-form": true,
            "a-form-item": true,
            "a-input": true,
            "a-input-number": true,
            "a-select": true,
            "a-select-option": true,
            "a-checkbox": true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("应该能加载订阅源", async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:get-feeds",
      );
      expect(wrapper.vm.feeds).toHaveLength(3);
    });

    it("应该能加载分类", async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:get-categories",
      );
      expect(wrapper.vm.categories).toHaveLength(2);
    });

    it("处理加载订阅源失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("加载失败"),
      );
    });
  });

  describe("订阅源列表显示", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该显示订阅源总数", () => {
      expect(wrapper.vm.totalFeeds).toBe(3);
    });

    it("默认显示全部订阅源", () => {
      expect(wrapper.vm.filteredFeeds).toHaveLength(3);
    });

    it("应该显示订阅源状态", () => {
      const feed1 = wrapper.vm.feeds.find((f) => f.id === "feed-1");
      const feed2 = wrapper.vm.feeds.find((f) => f.id === "feed-2");
      const feed3 = wrapper.vm.feeds.find((f) => f.id === "feed-3");

      expect(feed1.status).toBe("active");
      expect(feed2.status).toBe("error");
      expect(feed3.status).toBe("paused");
    });

    it("应该显示错误消息", () => {
      const errorFeed = wrapper.vm.feeds.find((f) => f.status === "error");

      expect(errorFeed.error_message).toBe("获取失败");
    });
  });

  describe("分类筛选", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能按分类筛选", async () => {
      wrapper.vm.onCategorySelect({ key: "cat-1" });
      await nextTick();

      const filtered = wrapper.vm.filteredFeeds;
      expect(filtered.every((f) => f.category === "cat-1")).toBe(true);
    });

    it("应该能显示全部订阅", async () => {
      wrapper.vm.onCategorySelect({ key: "all" });
      await nextTick();

      expect(wrapper.vm.filteredFeeds).toHaveLength(3);
    });

    it("应该能显示未读文章", async () => {
      wrapper.vm.onCategorySelect({ key: "unread" });
      await nextTick();

      expect(wrapper.vm.selectedCategories).toEqual(["unread"]);
    });

    it("应该能显示收藏文章", async () => {
      wrapper.vm.onCategorySelect({ key: "starred" });
      await nextTick();

      expect(wrapper.vm.selectedCategories).toEqual(["starred"]);
    });
  });

  describe("添加订阅源", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
            "a-form": true,
            "a-form-item": true,
            "a-input": true,
            "a-input-number": true,
            "a-select": true,
            "a-checkbox": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能打开添加订阅对话框", () => {
      wrapper.vm.showAddFeedModal();

      expect(wrapper.vm.addFeedModalVisible).toBe(true);
      expect(wrapper.vm.feedForm.url).toBe("");
      expect(wrapper.vm.feedValidation.valid).toBe(false);
    });

    it("应该能验证订阅源", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        validation: {
          valid: true,
          title: "Test Feed",
          itemCount: 10,
        },
      });

      wrapper.vm.feedForm.url = "https://example.com/feed.xml";
      await wrapper.vm.validateFeed();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:validate-feed",
        "https://example.com/feed.xml",
      );
      expect(wrapper.vm.feedValidation.valid).toBe(true);
      expect(wrapper.vm.feedValidation.title).toBe("Test Feed");
      expect(wrapper.vm.feedValidation.itemCount).toBe(10);
    });

    it("应该处理无效的订阅源", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        validation: {
          valid: false,
          error: "无效的Feed格式",
        },
      });

      wrapper.vm.feedForm.url = "https://invalid.com/feed.xml";
      await wrapper.vm.validateFeed();

      expect(wrapper.vm.feedValidation.valid).toBe(false);
      expect(wrapper.vm.feedValidation.error).toBe("无效的Feed格式");
    });

    it("空URL不应该验证", async () => {
      wrapper.vm.feedForm.url = "";
      await wrapper.vm.validateFeed();

      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
        "rss:validate-feed",
        expect.anything(),
      );
    });

    it("应该能添加新订阅源", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

      wrapper.vm.feedForm.url = "https://example.com/feed.xml";
      wrapper.vm.feedForm.category = "cat-1";
      wrapper.vm.feedForm.updateFrequency = 3600;
      wrapper.vm.feedForm.autoSync = true;

      await wrapper.vm.handleAddFeed();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:add-feed",
        "https://example.com/feed.xml",
        expect.objectContaining({
          category: "cat-1",
          updateFrequency: 3600,
          autoSync: true,
        }),
      );
      expect(message.success).toHaveBeenCalledWith("订阅添加成功");
      expect(wrapper.vm.addFeedModalVisible).toBe(false);
    });

    it("空URL不能添加订阅", async () => {
      const message = mockMessage;
      wrapper.vm.feedForm.url = "";

      await wrapper.vm.handleAddFeed();

      expect(message.error).toHaveBeenCalledWith("请输入 Feed URL");
    });

    it("处理添加订阅失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("添加失败"),
      );

      wrapper.vm.feedForm.url = "https://example.com/feed.xml";
      await wrapper.vm.handleAddFeed();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("添加失败"),
      );
    });
  });

  describe("编辑订阅源", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
            "a-form": true,
            "a-input": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能打开编辑对话框", () => {
      const feed = wrapper.vm.feeds[0];

      wrapper.vm.editFeed(feed);

      expect(wrapper.vm.addFeedModalVisible).toBe(true);
      expect(wrapper.vm.editingFeedId).toBe(feed.id);
      expect(wrapper.vm.feedForm.url).toBe(feed.url);
      expect(wrapper.vm.feedForm.category).toBe(feed.category);
    });

    it("应该能更新订阅源", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

      const feed = wrapper.vm.feeds[0];
      wrapper.vm.editFeed(feed);
      wrapper.vm.feedForm.url = "https://new-url.com/feed.xml";

      await wrapper.vm.handleAddFeed();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:update-feed",
        feed.id,
        expect.objectContaining({
          url: "https://new-url.com/feed.xml",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("订阅更新成功");
    });

    it("处理更新失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("更新失败"),
      );

      wrapper.vm.editingFeedId = "feed-1";
      wrapper.vm.feedForm.url = "https://example.com/feed.xml";

      await wrapper.vm.handleAddFeed();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("更新失败"),
      );
    });
  });

  describe("刷新订阅源", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能刷新单个订阅源", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        itemCount: 5,
      });

      await wrapper.vm.refreshFeed("feed-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:fetch-feed",
        "feed-1",
      );
      expect(message.success).toHaveBeenCalledWith("已获取 5 篇新文章");
    });

    it("刷新时应该设置loading状态", async () => {
      window.electron.ipcRenderer.invoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            const feed = wrapper.vm.feeds.find((f) => f.id === "feed-1");
            expect(feed.refreshing).toBe(true);
            resolve({ success: true, itemCount: 5 });
          }),
      );

      await wrapper.vm.refreshFeed("feed-1");
    });

    it("处理刷新失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("刷新失败"),
      );

      await wrapper.vm.refreshFeed("feed-1");

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("刷新失败"),
      );
    });

    it("应该能刷新全部订阅源", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        results: {
          success: 3,
          failed: 0,
        },
      });

      await wrapper.vm.refreshAllFeeds();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:fetch-all-feeds",
      );
      expect(message.success).toHaveBeenCalledWith("刷新完成: 成功 3, 失败 0");
    });

    it("处理批量刷新失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("批量刷新失败"),
      );

      await wrapper.vm.refreshAllFeeds();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("批量刷新失败"),
      );
    });
  });

  describe("删除订阅源", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能删除订阅源", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.deleteFeed("feed-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:remove-feed",
        "feed-1",
      );
      expect(message.success).toHaveBeenCalledWith("订阅已删除");
    });

    it("处理删除失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("删除失败"),
      );

      await wrapper.vm.deleteFeed("feed-1");

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("删除失败"),
      );
    });
  });

  describe("查看文章", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能导航到文章列表", () => {
      const feed = wrapper.vm.feeds[0];

      wrapper.vm.viewFeedArticles(feed);

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "RSSArticle",
        params: { feedId: feed.id },
      });
    });
  });

  describe("发现订阅源", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
            "a-form": true,
            "a-input": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能打开发现对话框", () => {
      wrapper.vm.discoverFeeds();

      expect(wrapper.vm.discoverModalVisible).toBe(true);
      expect(wrapper.vm.discoverUrl).toBe("");
      expect(wrapper.vm.discoveredFeeds).toEqual([]);
    });

    it("应该能发现订阅源", async () => {
      const message = mockMessage;
      const discovered = [
        { title: "Feed 1", url: "https://example.com/feed1.xml" },
        { title: "Feed 2", url: "https://example.com/feed2.xml" },
      ];

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        feeds: discovered,
      });

      wrapper.vm.discoverUrl = "https://example.com";
      await wrapper.vm.handleDiscoverFeeds();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:discover-feeds",
        "https://example.com",
      );
      expect(wrapper.vm.discoveredFeeds).toEqual(discovered);
      expect(message.success).toHaveBeenCalledWith("发现 2 个订阅源");
    });

    it("未发现订阅源时应该显示警告", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        feeds: [],
      });

      wrapper.vm.discoverUrl = "https://example.com";
      await wrapper.vm.handleDiscoverFeeds();

      expect(message.warning).toHaveBeenCalledWith("未发现 RSS 订阅源");
    });

    it("空URL不能发现订阅", async () => {
      const message = mockMessage;
      wrapper.vm.discoverUrl = "";

      await wrapper.vm.handleDiscoverFeeds();

      expect(message.error).toHaveBeenCalledWith("请输入网站 URL");
    });

    it("应该能添加发现的订阅源", () => {
      wrapper.vm.discoverModalVisible = true;

      wrapper.vm.addDiscoveredFeed("https://example.com/feed.xml");

      expect(wrapper.vm.feedForm.url).toBe("https://example.com/feed.xml");
      expect(wrapper.vm.discoverModalVisible).toBe(false);
      expect(wrapper.vm.addFeedModalVisible).toBe(true);
    });

    it("处理发现订阅失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("发现失败"),
      );

      wrapper.vm.discoverUrl = "https://example.com";
      await wrapper.vm.handleDiscoverFeeds();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("发现失败"),
      );
    });
  });

  describe("分类管理", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
            "a-form": true,
            "a-input": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能打开添加分类对话框", () => {
      wrapper.vm.showAddCategoryModal();

      expect(wrapper.vm.addCategoryModalVisible).toBe(true);
      expect(wrapper.vm.categoryForm.name).toBe("");
      expect(wrapper.vm.categoryForm.color).toBe("#1890ff");
    });

    it("应该能添加新分类", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

      wrapper.vm.categoryForm.name = "新闻";
      wrapper.vm.categoryForm.color = "#fa8c16";

      await wrapper.vm.handleAddCategory();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:add-category",
        "新闻",
        { color: "#fa8c16" },
      );
      expect(message.success).toHaveBeenCalledWith("分类添加成功");
      expect(wrapper.vm.addCategoryModalVisible).toBe(false);
    });

    it("空名称不能添加分类", async () => {
      const message = mockMessage;
      wrapper.vm.categoryForm.name = "";

      await wrapper.vm.handleAddCategory();

      expect(message.error).toHaveBeenCalledWith("请输入分类名称");
    });

    it("处理添加分类失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("添加失败"),
      );

      wrapper.vm.categoryForm.name = "新闻";
      await wrapper.vm.handleAddCategory();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("添加失败"),
      );
    });
  });

  describe("时间格式化", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
    });

    it("应该能格式化时间", () => {
      const result = wrapper.vm.formatTime(Date.now());

      expect(result).toBe("2小时前");
    });
  });

  describe("计算属性", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("totalFeeds应该返回订阅源总数", () => {
      expect(wrapper.vm.totalFeeds).toBe(3);
    });

    it("filteredFeeds默认返回全部订阅源", () => {
      wrapper.vm.selectedCategories = ["all"];

      expect(wrapper.vm.filteredFeeds).toHaveLength(3);
    });

    it("filteredFeeds应该按分类筛选", () => {
      wrapper.vm.selectedCategories = ["cat-1"];

      const filtered = wrapper.vm.filteredFeeds;
      expect(filtered.every((f) => f.category === "cat-1")).toBe(true);
    });
  });

  describe("响应式状态", () => {
    beforeEach(async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
    });

    it("应该正确初始化状态", () => {
      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.refreshing).toBe(false);
      expect(wrapper.vm.feeds).toBeInstanceOf(Array);
      expect(wrapper.vm.categories).toBeInstanceOf(Array);
      expect(wrapper.vm.selectedCategories).toEqual(["all"]);
      expect(wrapper.vm.unreadCount).toBe(0);
    });

    it("addFeedModalVisible应该是响应式的", async () => {
      expect(wrapper.vm.addFeedModalVisible).toBe(false);

      wrapper.vm.showAddFeedModal();
      await nextTick();

      expect(wrapper.vm.addFeedModalVisible).toBe(true);
    });

    it("selectedCategories应该是响应式的", async () => {
      wrapper.vm.onCategorySelect({ key: "cat-1" });
      await nextTick();

      expect(wrapper.vm.selectedCategories).toEqual(["cat-1"]);
    });
  });

  describe("边界情况", () => {
    it("空订阅源列表应该正常工作", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        feeds: [],
      });

      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.feeds).toEqual([]);
      expect(wrapper.vm.totalFeeds).toBe(0);
    });

    it("空分类列表应该正常工作", async () => {
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "rss:get-feeds") {
          return Promise.resolve({ success: true, feeds: [] });
        } else if (channel === "rss:get-categories") {
          return Promise.resolve({ success: true, categories: [] });
        }
      });

      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.categories).toEqual([]);
    });

    it("应该处理不存在的订阅源刷新", async () => {
      wrapper = mount(FeedList, {
        global: {
          stubs: {
            "a-card": true,
            "a-row": true,
            "a-col": true,
            "a-button": true,
            "a-list": true,
            "a-menu": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      await wrapper.vm.refreshFeed("non-existent");

      // 不存在的订阅源不会崩溃
      expect(wrapper.vm).toBeDefined();
    });
  });
});
