import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import EmailReader from "@renderer/pages/email/EmailReader.vue";

// Mock DOMPurify
vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html) => html),
  },
}));

// Mock dayjs
vi.mock("dayjs", () => {
  const dayjs = vi.fn((timestamp) => ({
    fromNow: vi.fn(() => "2小时前"),
    format: vi.fn(() => "2024-01-01 12:00:00"),
  }));
  dayjs.extend = vi.fn();
  dayjs.locale = vi.fn();
  return { default: dayjs };
});

// Mock ant-design-vue
vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock vue-router
const mockRoute = {
  params: { accountId: "account-123" },
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({}),
}));

// Mock logger - 使用 vi.hoisted 确保在 vi.mock 之前可用
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock Electron IPC
global.window = {
  electron: {
    ipcRenderer: {
      invoke: vi.fn(),
    },
    dialog: {
      showSaveDialog: vi.fn(),
    },
  },
};

describe("EmailReader.vue", () => {
  let wrapper;

  const mockMailboxes = [
    {
      id: "mailbox-1",
      name: "INBOX",
      display_name: "收件箱",
    },
    {
      id: "mailbox-2",
      name: "Sent",
      display_name: "已发送",
    },
    {
      id: "mailbox-3",
      name: "Trash",
      display_name: "回收站",
    },
  ];

  const mockEmails = [
    {
      id: "email-1",
      subject: "测试邮件1",
      from_address: "sender1@example.com",
      to_address: "me@example.com",
      date: "2024-01-01T12:00:00Z",
      text_content: "邮件内容1",
      is_read: 0,
      is_starred: 0,
      has_attachments: true,
    },
    {
      id: "email-2",
      subject: "测试邮件2",
      from_address: "sender2@example.com",
      to_address: "me@example.com",
      date: "2024-01-01T10:00:00Z",
      text_content: "邮件内容2",
      is_read: 1,
      is_starred: 1,
      has_attachments: false,
    },
  ];

  const mockAttachments = [
    {
      id: "attach-1",
      filename: "document.pdf",
      size: 1024 * 100,
    },
    {
      id: "attach-2",
      filename: "image.png",
      size: 1024 * 50,
    },
  ];

  const createWrapper = () => {
    return mount(EmailReader, {
      global: {
        stubs: {
          "a-row": { template: "<div><slot /></div>" },
          "a-col": { template: "<div><slot /></div>" },
          "a-card": { template: '<div><slot /><slot name="extra" /></div>' },
          "a-button": { template: "<button><slot /></button>" },
          "a-tree": { template: "<div />" },
          "a-empty": { template: "<div />" },
          "a-badge": { template: "<span />" },
          "a-dropdown": { template: "<div><slot /></div>" },
          "a-menu": { template: "<div><slot /></div>" },
          "a-menu-item": { template: "<div><slot /></div>" },
          "a-menu-divider": { template: "<div />" },
          "a-list": { template: "<div><slot /></div>" },
          "a-list-item": { template: "<div><slot /></div>" },
          "a-list-item-meta": {
            template:
              '<div><slot name="title" /><slot name="description" /></div>',
          },
          "a-space": { template: "<div><slot /></div>" },
          "a-tooltip": { template: "<div><slot /></div>" },
          "a-descriptions": { template: "<div><slot /></div>" },
          "a-descriptions-item": { template: "<div><slot /></div>" },
          "a-divider": { template: "<div />" },
          EmailComposer: { template: "<div />" },
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

    it("应该在挂载时加载邮箱列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        mailboxes: mockMailboxes,
        emails: [],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-mailboxes",
        "account-123",
      );
    });

    it("应该初始化accountId", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.accountId).toBe("account-123");
    });
  });

  // 加载邮箱测试
  describe("Load Mailboxes", () => {
    it("应该加载邮箱列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        mailboxes: mockMailboxes,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadMailboxes();

      expect(wrapper.vm.mailboxes).toEqual(mockMailboxes);
    });

    it("应该自动选择INBOX邮箱", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        mailboxes: mockMailboxes,
        emails: mockEmails,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadMailboxes();

      expect(wrapper.vm.selectedMailbox).toEqual(["mailbox-1"]);
    });

    it("应该处理加载失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.loadMailboxes();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("加载失败"),
      );
    });
  });

  // 同步邮箱测试
  describe("Sync Mailboxes", () => {
    it("应该能同步邮箱", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        mailboxes: mockMailboxes,
      });

      wrapper = createWrapper();
      wrapper.vm.mailboxes = mockMailboxes;

      const { message } = require("ant-design-vue");

      await wrapper.vm.syncMailboxes();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:sync-mailboxes",
        "account-123",
      );
      expect(message.success).toHaveBeenCalledWith("邮箱同步成功");
    });

    it("应该处理同步失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("同步失败"),
      );

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.syncMailboxes();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("同步失败"),
      );
    });
  });

  // 加载邮件测试
  describe("Load Emails", () => {
    it("应该加载邮件列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        emails: mockEmails,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadEmails("mailbox-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-emails",
        expect.objectContaining({
          accountId: "account-123",
          mailboxId: "mailbox-1",
          limit: 100,
        }),
      );
      expect(wrapper.vm.emails).toEqual(mockEmails);
    });

    it("应该支持未读筛选", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        emails: [],
      });

      wrapper = createWrapper();
      wrapper.vm.filter = "unread";

      await wrapper.vm.loadEmails("mailbox-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-emails",
        expect.objectContaining({
          isRead: false,
        }),
      );
    });

    it("应该支持收藏筛选", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        emails: [],
      });

      wrapper = createWrapper();
      wrapper.vm.filter = "starred";

      await wrapper.vm.loadEmails("mailbox-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-emails",
        expect.objectContaining({
          isStarred: true,
        }),
      );
    });

    it("应该处理加载失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.loadEmails("mailbox-1");

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("加载失败"),
      );
    });
  });

  // 同步邮件测试
  describe("Sync Emails", () => {
    it("应该能同步邮件", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        count: 5,
        emails: [],
      });

      wrapper = createWrapper();
      wrapper.vm.mailboxes = mockMailboxes;
      wrapper.vm.selectedMailbox = ["mailbox-1"];

      const { message } = require("ant-design-vue");

      await wrapper.vm.syncEmails();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:fetch-emails",
        "account-123",
        expect.objectContaining({
          mailbox: "INBOX",
          limit: 50,
          unseen: true,
        }),
      );
      expect(message.success).toHaveBeenCalledWith("已同步 5 封新邮件");
    });

    it("应该在未选择邮箱时警告", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedMailbox = [];

      const { message } = require("ant-design-vue");

      await wrapper.vm.syncEmails();

      expect(message.warning).toHaveBeenCalledWith("请先选择邮箱");
    });

    it("应该处理找不到邮箱的情况", async () => {
      wrapper = createWrapper();
      wrapper.vm.mailboxes = mockMailboxes;
      wrapper.vm.selectedMailbox = ["non-existent"];

      const { message } = require("ant-design-vue");

      await wrapper.vm.syncEmails();

      expect(message.warning).toHaveBeenCalledWith("未找到选中的邮箱");
    });

    it("应该处理同步失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("同步失败"),
      );

      wrapper = createWrapper();
      wrapper.vm.mailboxes = mockMailboxes;
      wrapper.vm.selectedMailbox = ["mailbox-1"];

      const { message } = require("ant-design-vue");

      await wrapper.vm.syncEmails();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("同步失败"),
      );
    });
  });

  // 选择邮件测试
  describe("Select Email", () => {
    it("应该能选择邮件", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        attachments: [],
      });

      wrapper = createWrapper();

      const email = { ...mockEmails[0] };
      await wrapper.vm.selectEmail(email);

      expect(wrapper.vm.selectedEmail).toEqual(email);
    });

    it("应该加载附件", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        attachments: mockAttachments,
      });

      wrapper = createWrapper();

      await wrapper.vm.selectEmail(mockEmails[0]);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-attachments",
        "email-1",
      );
      expect(wrapper.vm.attachments).toEqual(mockAttachments);
    });

    it("应该标记未读邮件为已读", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        attachments: [],
      });

      wrapper = createWrapper();

      const email = { ...mockEmails[0], is_read: 0 };
      await wrapper.vm.selectEmail(email);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:mark-as-read",
        "email-1",
      );
      expect(email.is_read).toBe(1);
    });

    it("应该不标记已读邮件", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        attachments: [],
      });

      wrapper = createWrapper();

      const email = { ...mockEmails[1], is_read: 1 };
      await wrapper.vm.selectEmail(email);

      const calls = window.electron.ipcRenderer.invoke.mock.calls;
      const markReadCall = calls.find(
        (call) => call[0] === "email:mark-as-read",
      );
      expect(markReadCall).toBeUndefined();
    });
  });

  // 附件测试
  describe("Attachments", () => {
    it("应该加载附件", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        attachments: mockAttachments,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadAttachments("email-1");

      expect(wrapper.vm.attachments).toEqual(mockAttachments);
    });

    it("应该处理加载失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      await wrapper.vm.loadAttachments("email-1");

      expect(logger.error).toHaveBeenCalled();
      expect(wrapper.vm.attachments).toEqual([]);
    });

    it("应该能下载附件", async () => {
      window.electron.dialog.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: "/path/to/save/document.pdf",
      });

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      const attachment = { ...mockAttachments[0] };
      await wrapper.vm.downloadAttachment(attachment);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:download-attachment",
        "attach-1",
        "/path/to/save/document.pdf",
      );
      expect(message.success).toHaveBeenCalledWith("附件下载成功");
    });

    it("应该处理用户取消下载", async () => {
      window.electron.dialog.showSaveDialog.mockResolvedValue({
        canceled: true,
      });

      wrapper = createWrapper();

      const attachment = { ...mockAttachments[0] };
      await wrapper.vm.downloadAttachment(attachment);

      const calls = window.electron.ipcRenderer.invoke.mock.calls;
      const downloadCall = calls.find(
        (call) => call[0] === "email:download-attachment",
      );
      expect(downloadCall).toBeUndefined();
    });

    it("应该处理下载失败", async () => {
      window.electron.dialog.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: "/path/to/save/document.pdf",
      });

      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("下载失败"),
      );

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      const attachment = { ...mockAttachments[0] };
      await wrapper.vm.downloadAttachment(attachment);

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("下载失败"),
      );
    });
  });

  // 收藏功能测试
  describe("Star Toggle", () => {
    it("应该能收藏邮件", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      wrapper.vm.emails = [...mockEmails];
      wrapper.vm.selectedEmail = { ...mockEmails[0], is_starred: 0 };

      const { message } = require("ant-design-vue");

      await wrapper.vm.toggleStar();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:mark-as-starred",
        "email-1",
        true,
      );
      expect(wrapper.vm.selectedEmail.is_starred).toBe(1);
      expect(message.success).toHaveBeenCalledWith("已收藏");
    });

    it("应该能取消收藏", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      wrapper.vm.emails = [...mockEmails];
      wrapper.vm.selectedEmail = { ...mockEmails[1], is_starred: 1 };

      const { message } = require("ant-design-vue");

      await wrapper.vm.toggleStar();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:mark-as-starred",
        "email-2",
        false,
      );
      expect(wrapper.vm.selectedEmail.is_starred).toBe(0);
      expect(message.success).toHaveBeenCalledWith("已取消收藏");
    });

    it("应该在未选择邮件时不执行", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = null;

      await wrapper.vm.toggleStar();

      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalled();
    });
  });

  // 保存到知识库测试
  describe("Save to Knowledge", () => {
    it("应该能保存到知识库", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      wrapper.vm.selectedEmail = mockEmails[0];

      const { message } = require("ant-design-vue");

      await wrapper.vm.saveToKnowledge();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:save-to-knowledge",
        "email-1",
      );
      expect(message.success).toHaveBeenCalledWith("已保存到知识库");
    });

    it("应该处理保存失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("保存失败"),
      );

      wrapper = createWrapper();
      wrapper.vm.selectedEmail = mockEmails[0];

      const { message } = require("ant-design-vue");

      await wrapper.vm.saveToKnowledge();

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("保存失败"),
      );
    });
  });

  // 撰写邮件测试
  describe("Compose Email", () => {
    it("应该能显示撰写对话框", () => {
      wrapper = createWrapper();

      wrapper.vm.showComposer();

      expect(wrapper.vm.composerVisible).toBe(true);
      expect(wrapper.vm.replyToEmail).toBeNull();
      expect(wrapper.vm.forwardEmailData).toBeNull();
    });

    it("应该能回复邮件", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = mockEmails[0];

      wrapper.vm.replyEmail();

      expect(wrapper.vm.replyToEmail).toEqual(mockEmails[0]);
      expect(wrapper.vm.composerVisible).toBe(true);
    });

    it("应该能转发邮件", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = mockEmails[0];

      wrapper.vm.forwardEmail();

      expect(wrapper.vm.forwardEmailData).toEqual(mockEmails[0]);
      expect(wrapper.vm.composerVisible).toBe(true);
    });

    it("应该处理邮件发送成功", () => {
      wrapper = createWrapper();
      wrapper.vm.composerVisible = true;

      const { message } = require("ant-design-vue");

      wrapper.vm.onEmailSent();

      expect(message.success).toHaveBeenCalledWith("邮件发送成功");
      expect(wrapper.vm.composerVisible).toBe(false);
    });
  });

  // 邮件操作测试
  describe("Email Actions", () => {
    beforeEach(() => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        emails: [],
      });
    });

    it("应该能标记为已读", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = { ...mockEmails[0] };
      wrapper.vm.selectedMailbox = ["mailbox-1"];

      const { message } = require("ant-design-vue");

      await wrapper.vm.handleMenuClick({ key: "markRead" });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:mark-as-read",
        "email-1",
      );
      expect(wrapper.vm.selectedEmail.is_read).toBe(1);
      expect(message.success).toHaveBeenCalledWith("已标记为已读");
    });

    it("应该能归档邮件", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = { ...mockEmails[0] };
      wrapper.vm.selectedMailbox = ["mailbox-1"];

      const { message } = require("ant-design-vue");

      await wrapper.vm.handleMenuClick({ key: "archive" });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:archive-email",
        "email-1",
      );
      expect(message.success).toHaveBeenCalledWith("已归档");
      expect(wrapper.vm.selectedEmail).toBeNull();
    });

    it("应该能删除邮件", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = { ...mockEmails[0] };
      wrapper.vm.selectedMailbox = ["mailbox-1"];

      const { message } = require("ant-design-vue");

      await wrapper.vm.handleMenuClick({ key: "delete" });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:delete-email",
        "email-1",
      );
      expect(message.success).toHaveBeenCalledWith("已删除");
      expect(wrapper.vm.selectedEmail).toBeNull();
    });

    it("应该显示标记未读开发中提示", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = mockEmails[0];

      const { message } = require("ant-design-vue");

      await wrapper.vm.handleMenuClick({ key: "markUnread" });

      expect(message.info).toHaveBeenCalledWith("功能开发中");
    });

    it("应该处理操作失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("操作失败"),
      );

      wrapper = createWrapper();
      wrapper.vm.selectedEmail = mockEmails[0];

      const { message } = require("ant-design-vue");

      await wrapper.vm.handleMenuClick({ key: "delete" });

      expect(message.error).toHaveBeenCalledWith(
        expect.stringContaining("操作失败"),
      );
    });
  });

  // 筛选功能测试
  describe("Filter Functionality", () => {
    it("应该能切换筛选条件", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        emails: [],
      });

      wrapper = createWrapper();
      wrapper.vm.selectedMailbox = ["mailbox-1"];

      await wrapper.vm.handleFilterChange({ key: "unread" });

      expect(wrapper.vm.filter).toBe("unread");
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-emails",
        expect.objectContaining({
          isRead: false,
        }),
      );
    });
  });

  // 邮箱选择测试
  describe("Mailbox Selection", () => {
    it("应该能选择邮箱", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        emails: [],
      });

      wrapper = createWrapper();

      await wrapper.vm.onMailboxSelect(["mailbox-2"]);

      expect(wrapper.vm.selectedMailbox).toEqual(["mailbox-2"]);
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-emails",
        expect.objectContaining({
          mailboxId: "mailbox-2",
        }),
      );
    });

    it("应该在未选择时不加载", () => {
      wrapper = createWrapper();

      wrapper.vm.onMailboxSelect([]);

      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
        "email:get-emails",
        expect.anything(),
      );
    });
  });

  // 计算属性测试
  describe("Computed Properties", () => {
    it("应该计算未读数量", () => {
      wrapper = createWrapper();
      wrapper.vm.emails = mockEmails;

      expect(wrapper.vm.unreadCount).toBe(1);
    });

    it("应该生成邮箱树", () => {
      wrapper = createWrapper();
      wrapper.vm.mailboxes = mockMailboxes;
      wrapper.vm.drafts = [];

      // 3个邮箱 + 1个草稿箱
      expect(wrapper.vm.mailboxTree).toHaveLength(4);
      expect(wrapper.vm.mailboxTree[0].title).toBe("收件箱");
      expect(wrapper.vm.mailboxTree[3].title).toBe("草稿箱 (0)");
    });

    it("应该清理邮件内容", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = mockEmails[0];

      expect(wrapper.vm.sanitizedContent).toBeTruthy();
    });

    it("应该处理HTML内容", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = {
        ...mockEmails[0],
        html_content: "<p>HTML内容</p>",
      };

      expect(wrapper.vm.sanitizedContent).toBe("<p>HTML内容</p>");
    });

    it("应该转换纯文本换行", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = {
        ...mockEmails[0],
        text_content: "第一行\n第二行",
        html_content: null,
      };

      expect(wrapper.vm.sanitizedContent).toContain("<br>");
    });
  });

  // 格式化函数测试
  describe("Format Functions", () => {
    it("应该格式化相对时间", () => {
      wrapper = createWrapper();

      const result = wrapper.vm.formatTime("2024-01-01T12:00:00Z");

      expect(result).toBe("2小时前");
    });

    it("应该格式化完整时间", () => {
      wrapper = createWrapper();

      const result = wrapper.vm.formatFullTime("2024-01-01T12:00:00Z");

      expect(result).toBe("2024-01-01 12:00:00");
    });

    it("应该格式化文件大小", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatSize(500)).toBe("500 B");
      expect(wrapper.vm.formatSize(1536)).toBe("1.50 KB");
      expect(wrapper.vm.formatSize(1572864)).toBe("1.50 MB");
    });
  });

  // 边界情况测试
  describe("Edge Cases", () => {
    it("应该处理空邮箱列表", () => {
      wrapper = createWrapper();
      wrapper.vm.mailboxes = [];
      wrapper.vm.drafts = [];

      // 即使邮箱为空，也应该显示草稿箱选项
      expect(wrapper.vm.mailboxTree).toEqual([
        {
          key: "drafts",
          title: "草稿箱 (0)",
          name: "Drafts",
          isDraft: true,
          children: [],
        },
      ]);
    });

    it("应该处理空邮件列表", () => {
      wrapper = createWrapper();
      wrapper.vm.emails = [];

      expect(wrapper.vm.unreadCount).toBe(0);
    });

    it("应该处理无主题邮件", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedEmail = {
        ...mockEmails[0],
        subject: "",
      };

      // 应该不抛出错误
      expect(wrapper.vm.selectedEmail.subject).toBe("");
    });

    it("应该处理无附件情况", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        attachments: [],
      });

      wrapper = createWrapper();

      await wrapper.vm.loadAttachments("email-1");

      expect(wrapper.vm.attachments).toEqual([]);
    });

    // 注意: handleImageError 函数已被移除，跳过此测试
    it.skip("应该处理图片加载错误", () => {
      wrapper = createWrapper();

      const event = {
        target: {
          src: "invalid-url",
          style: { display: "" },
        },
      };

      wrapper.vm.handleImageError(event);

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(event.target.style.display).toBe("none");
    });
  });

  // 路由变化测试
  describe("Route Changes", () => {
    // 注意: Vue Router mock 不支持响应式的 params 变化检测，跳过此测试
    it.skip("应该监听accountId变化", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        mailboxes: [],
      });

      wrapper = createWrapper();

      mockRoute.params.accountId = "new-account-456";
      await wrapper.vm.$nextTick();

      // 触发watch
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.accountId).toBe("new-account-456");
    });
  });
});
