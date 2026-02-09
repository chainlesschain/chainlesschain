/**
 * ArticleReader 组件测试
 * 测试RSS文章阅读器页面的所有功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ArticleReader from "@renderer/pages/rss/ArticleReader.vue";
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
const mockRoute = {
  params: { feedId: "feed-1" },
};

const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
}));

// Mock DOMPurify - use hoisted pattern
const mockDOMPurify = vi.hoisted(() => ({
  sanitize: vi.fn((content) => content),
}));

vi.mock("dompurify", () => ({
  default: mockDOMPurify,
}));

// Mock logger
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  logger: mockLogger,
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

// Mock Ant Design Icons
vi.mock("@ant-design/icons-vue", () => ({
  ArrowLeftOutlined: {
    name: "ArrowLeftOutlined",
    template: "<span>ArrowLeft</span>",
  },
  FilterOutlined: { name: "FilterOutlined", template: "<span>Filter</span>" },
  ReloadOutlined: { name: "ReloadOutlined", template: "<span>Reload</span>" },
  StarFilled: { name: "StarFilled", template: "<span>StarFilled</span>" },
  StarOutlined: { name: "StarOutlined", template: "<span>StarOutlined</span>" },
  SaveOutlined: { name: "SaveOutlined", template: "<span>Save</span>" },
  LinkOutlined: { name: "LinkOutlined", template: "<span>Link</span>" },
  MoreOutlined: { name: "MoreOutlined", template: "<span>More</span>" },
  CheckOutlined: { name: "CheckOutlined", template: "<span>Check</span>" },
  EyeInvisibleOutlined: {
    name: "EyeInvisibleOutlined",
    template: "<span>EyeInvisible</span>",
  },
  InboxOutlined: { name: "InboxOutlined", template: "<span>Inbox</span>" },
  UserOutlined: { name: "UserOutlined", template: "<span>User</span>" },
  ClockCircleOutlined: {
    name: "ClockCircleOutlined",
    template: "<span>ClockCircle</span>",
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

describe("ArticleReader", () => {
  let wrapper;
  let mockFeed;
  let mockArticles;

  beforeEach(() => {
    // Mock Electron API
    global.window = {
      electron: {
        ipcRenderer: {
          invoke: vi.fn(),
        },
      },
      open: vi.fn(),
    };

    // Mock feed data
    mockFeed = {
      id: "feed-1",
      title: "Tech News",
    };

    // Mock articles data
    mockArticles = [
      {
        id: "article-1",
        title: "Article 1",
        description: "Description 1",
        content: "<p>Full content 1</p>",
        author: "Author 1",
        pub_date: Date.now(),
        link: "https://example.com/article1",
        categories: ["tech", "news"],
        is_read: 0,
        is_starred: 0,
      },
      {
        id: "article-2",
        title: "Article 2",
        description: "Description 2",
        content: "<p>Full content 2</p>",
        author: "Author 2",
        pub_date: Date.now() - 86400000,
        link: "https://example.com/article2",
        categories: ["tech"],
        is_read: 1,
        is_starred: 1,
      },
    ];

    window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === "rss:get-feed") {
        return Promise.resolve({ success: true, feed: mockFeed });
      } else if (channel === "rss:get-items") {
        return Promise.resolve({ success: true, items: mockArticles });
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
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-button": true,
            "a-space": true,
            "a-dropdown": true,
            "a-menu": true,
            "a-menu-item": true,
            "a-menu-divider": true,
            "a-list": true,
            "a-list-item": true,
            "a-list-item-meta": true,
            "a-tag": true,
            "a-tooltip": true,
            "a-divider": true,
            "a-empty": true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("应该从路由参数获取feedId", () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      expect(wrapper.vm.feedId).toBe("feed-1");
    });

    it("应该能加载订阅源信息", async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:get-feed",
        "feed-1",
      );
      expect(wrapper.vm.feedTitle).toBe("Tech News");
    });

    it("应该能加载文章列表", async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:get-items",
        expect.objectContaining({ feedId: "feed-1" }),
      );
      expect(wrapper.vm.articles).toHaveLength(2);
    });

    it("处理加载订阅源失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(message.error).toHaveBeenCalled();
    });
  });

  describe("文章列表显示", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-list-item": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该显示所有文章", () => {
      expect(wrapper.vm.articles).toHaveLength(2);
    });

    it("应该显示文章标题", () => {
      const article = wrapper.vm.articles[0];
      expect(article.title).toBe("Article 1");
    });

    it("应该显示文章作者", () => {
      const article = wrapper.vm.articles[0];
      expect(article.author).toBe("Author 1");
    });

    it("应该显示文章发布时间", () => {
      const article = wrapper.vm.articles[0];
      expect(article.pub_date).toBeDefined();
    });

    it("应该显示已读状态", () => {
      const unread = wrapper.vm.articles[0];
      const read = wrapper.vm.articles[1];

      expect(unread.is_read).toBe(0);
      expect(read.is_read).toBe(1);
    });

    it("应该显示收藏状态", () => {
      const unstarred = wrapper.vm.articles[0];
      const starred = wrapper.vm.articles[1];

      expect(unstarred.is_starred).toBe(0);
      expect(starred.is_starred).toBe(1);
    });
  });

  describe("筛选功能", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-dropdown": true,
            "a-menu": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能筛选全部文章", async () => {
      await wrapper.vm.handleFilterChange({ key: "all" });

      expect(wrapper.vm.filter).toBe("all");
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:get-items",
        expect.objectContaining({ feedId: "feed-1" }),
      );
    });

    it("应该能筛选未读文章", async () => {
      await wrapper.vm.handleFilterChange({ key: "unread" });

      expect(wrapper.vm.filter).toBe("unread");
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:get-items",
        expect.objectContaining({ feedId: "feed-1", isRead: false }),
      );
    });

    it("应该能筛选收藏文章", async () => {
      await wrapper.vm.handleFilterChange({ key: "starred" });

      expect(wrapper.vm.filter).toBe("starred");
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:get-items",
        expect.objectContaining({ feedId: "feed-1", isStarred: true }),
      );
    });
  });

  describe("选择文章", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能选择文章", async () => {
      const article = wrapper.vm.articles[0];

      await wrapper.vm.selectArticle(article);

      expect(wrapper.vm.selectedArticle).toEqual(article);
    });

    it("选择未读文章应该标记为已读", async () => {
      const article = { ...wrapper.vm.articles[0] };
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.selectArticle(article);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:mark-as-read",
        article.id,
      );
      expect(article.is_read).toBe(1);
    });

    it("选择已读文章不应该再次标记", async () => {
      const article = { ...wrapper.vm.articles[1] };
      const invokeCount = window.electron.ipcRenderer.invoke.mock.calls.length;

      await wrapper.vm.selectArticle(article);

      const newInvokeCount =
        window.electron.ipcRenderer.invoke.mock.calls.length;
      expect(newInvokeCount).toBe(invokeCount);
    });

    it("处理标记已读失败", async () => {
      const article = { ...wrapper.vm.articles[0], is_read: 0 };
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("标记失败"),
      );

      // Should handle error gracefully without throwing
      await expect(wrapper.vm.selectArticle(article)).resolves.not.toThrow();

      // Article should still be selected even if mark-as-read failed
      expect(wrapper.vm.selectedArticle).toEqual(article);
    });
  });

  describe("内容渲染", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该渲染sanitized内容", async () => {
      wrapper.vm.selectedArticle = wrapper.vm.articles[0];

      const content = wrapper.vm.sanitizedContent;

      expect(mockDOMPurify.sanitize).toHaveBeenCalled();
      expect(content).toBeTruthy();
    });

    it("没有选中文章时应该返回空内容", () => {
      wrapper.vm.selectedArticle = null;

      expect(wrapper.vm.sanitizedContent).toBe("");
    });

    it("应该优先使用content字段", async () => {
      wrapper.vm.selectedArticle = {
        content: "<p>Full content</p>",
        description: "<p>Description</p>",
      };

      expect(wrapper.vm.sanitizedContent).toContain("Full content");
    });

    it("没有content时应该使用description", async () => {
      wrapper.vm.selectedArticle = {
        content: null,
        description: "<p>Description</p>",
      };

      expect(wrapper.vm.sanitizedContent).toContain("Description");
    });
  });

  describe("收藏功能", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能收藏文章", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[0] };
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.toggleStar();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:mark-as-starred",
        "article-1",
        true,
      );
      expect(wrapper.vm.selectedArticle.is_starred).toBe(1);
      expect(message.success).toHaveBeenCalledWith("已收藏");
    });

    it("应该能取消收藏", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[1] };
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.toggleStar();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:mark-as-starred",
        "article-2",
        false,
      );
      expect(wrapper.vm.selectedArticle.is_starred).toBe(0);
      expect(message.success).toHaveBeenCalledWith("已取消收藏");
    });

    it("没有选中文章时不应该操作", async () => {
      wrapper.vm.selectedArticle = null;
      const invokeCount = window.electron.ipcRenderer.invoke.mock.calls.length;

      await wrapper.vm.toggleStar();

      const newInvokeCount =
        window.electron.ipcRenderer.invoke.mock.calls.length;
      expect(newInvokeCount).toBe(invokeCount);
    });

    it("应该同步更新列表中的状态", async () => {
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[0] };
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.toggleStar();

      const articleInList = wrapper.vm.articles.find(
        (a) => a.id === "article-1",
      );
      expect(articleInList.is_starred).toBe(1);
    });

    it("处理收藏失败", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[0] };
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("操作失败"),
      );

      await wrapper.vm.toggleStar();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("操作失败"),
      );
    });
  });

  describe("保存到知识库", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能保存到知识库", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = wrapper.vm.articles[0];
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.saveToKnowledge();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:save-to-knowledge",
        "article-1",
      );
      expect(message.success).toHaveBeenCalledWith("已保存到知识库");
    });

    it("没有选中文章时不应该操作", async () => {
      wrapper.vm.selectedArticle = null;
      const invokeCount = window.electron.ipcRenderer.invoke.mock.calls.length;

      await wrapper.vm.saveToKnowledge();

      const newInvokeCount =
        window.electron.ipcRenderer.invoke.mock.calls.length;
      expect(newInvokeCount).toBe(invokeCount);
    });

    it("处理保存失败", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = wrapper.vm.articles[0];
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("保存失败"),
      );

      await wrapper.vm.saveToKnowledge();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("保存失败"),
      );
    });
  });

  describe("在浏览器中打开", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能在浏览器中打开文章", () => {
      wrapper.vm.selectedArticle = wrapper.vm.articles[0];

      wrapper.vm.openInBrowser();

      expect(window.open).toHaveBeenCalledWith(
        "https://example.com/article1",
        "_blank",
      );
    });

    it("没有链接时不应该打开", () => {
      wrapper.vm.selectedArticle = { link: null };

      wrapper.vm.openInBrowser();

      expect(window.open).not.toHaveBeenCalled();
    });

    it("没有选中文章时不应该打开", () => {
      wrapper.vm.selectedArticle = null;

      wrapper.vm.openInBrowser();

      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe("菜单操作", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能标记为已读", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[0] };
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleMenuClick({ key: "markRead" });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:mark-as-read",
        "article-1",
      );
      expect(wrapper.vm.selectedArticle.is_read).toBe(1);
      expect(message.success).toHaveBeenCalledWith("已标记为已读");
    });

    it("应该能标记为未读", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[1] };
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleMenuClick({ key: "markUnread" });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:mark-as-unread",
        "article-2",
      );
      expect(wrapper.vm.selectedArticle.is_read).toBe(0);
      expect(message.success).toHaveBeenCalledWith("已标记为未读");
    });

    it("标记未读应该更新列表中的状态", async () => {
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[1] };
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleMenuClick({ key: "markUnread" });

      const articleInList = wrapper.vm.articles.find(
        (a) => a.id === "article-2",
      );
      expect(articleInList.is_read).toBe(0);
    });

    it("应该能归档文章", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[0] };
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleMenuClick({ key: "archive" });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:archive-item",
        "article-1",
      );
      expect(message.success).toHaveBeenCalledWith("已归档");
      expect(wrapper.vm.selectedArticle).toBeNull();
    });

    it("没有选中文章时不应该操作", async () => {
      wrapper.vm.selectedArticle = null;
      const invokeCount = window.electron.ipcRenderer.invoke.mock.calls.length;

      await wrapper.vm.handleMenuClick({ key: "markRead" });

      const newInvokeCount =
        window.electron.ipcRenderer.invoke.mock.calls.length;
      expect(newInvokeCount).toBe(invokeCount);
    });

    it("处理菜单操作失败", async () => {
      const message = mockMessage;
      wrapper.vm.selectedArticle = { ...wrapper.vm.articles[0] };
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("操作失败"),
      );

      await wrapper.vm.handleMenuClick({ key: "markRead" });

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("操作失败"),
      );
    });
  });

  describe("刷新功能", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能刷新文章列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        items: mockArticles,
      });

      await wrapper.vm.loadArticles();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "rss:get-items",
        expect.any(Object),
      );
    });

    it("处理加载文章失败", async () => {
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      await wrapper.vm.loadArticles();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("加载失败"),
      );
    });
  });

  describe("返回导航", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
    });

    it("应该能返回上一页", () => {
      wrapper.vm.goBack();

      expect(mockRouter.back).toHaveBeenCalled();
    });
  });

  describe("时间格式化", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
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

  describe("响应式状态", () => {
    beforeEach(async () => {
      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
    });

    it("应该正确初始化状态", () => {
      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.feedId).toBe("feed-1");
      expect(wrapper.vm.feedTitle).toBeDefined();
      expect(wrapper.vm.articles).toBeInstanceOf(Array);
      expect(wrapper.vm.selectedArticle).toBeNull();
      expect(wrapper.vm.filter).toBe("all");
    });

    it("selectedArticle应该是响应式的", async () => {
      expect(wrapper.vm.selectedArticle).toBeNull();

      await wrapper.vm.selectArticle(wrapper.vm.articles[0]);
      await nextTick();

      expect(wrapper.vm.selectedArticle).toBeDefined();
    });

    it("filter应该是响应式的", async () => {
      expect(wrapper.vm.filter).toBe("all");

      await wrapper.vm.handleFilterChange({ key: "unread" });
      await nextTick();

      expect(wrapper.vm.filter).toBe("unread");
    });
  });

  describe("边界情况", () => {
    it("空文章列表应该正常工作", async () => {
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "rss:get-feed") {
          return Promise.resolve({ success: true, feed: mockFeed });
        } else if (channel === "rss:get-items") {
          return Promise.resolve({ success: true, items: [] });
        }
      });

      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.articles).toEqual([]);
    });

    it("没有作者的文章应该正常显示", async () => {
      const articleNoAuthor = {
        ...mockArticles[0],
        author: null,
      };

      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "rss:get-feed") {
          return Promise.resolve({ success: true, feed: mockFeed });
        } else if (channel === "rss:get-items") {
          return Promise.resolve({ success: true, items: [articleNoAuthor] });
        }
      });

      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.articles[0].author).toBeNull();
    });

    it("没有分类的文章应该正常显示", async () => {
      const articleNoCategories = {
        ...mockArticles[0],
        categories: [],
      };

      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "rss:get-feed") {
          return Promise.resolve({ success: true, feed: mockFeed });
        } else if (channel === "rss:get-items") {
          return Promise.resolve({
            success: true,
            items: [articleNoCategories],
          });
        }
      });

      wrapper = mount(ArticleReader, {
        global: {
          stubs: {
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-list": true,
            "a-empty": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.articles[0].categories).toEqual([]);
    });
  });
});
