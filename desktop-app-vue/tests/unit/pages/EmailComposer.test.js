import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import EmailComposer from "@renderer/pages/email/EmailComposer.vue";

// Mock ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("ant-design-vue", () => ({
  message: mockMessage,
}));

// Mock Electron IPC
global.window = {
  electron: {
    ipcRenderer: {
      invoke: vi.fn(),
    },
  },
};

describe("EmailComposer.vue", () => {
  let wrapper;

  const defaultProps = {
    visible: true,
    accountId: "account-123",
    replyTo: null,
    forward: null,
  };

  const createWrapper = (props = {}) => {
    return mount(EmailComposer, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        stubs: {
          "a-modal": {
            template: "<div><slot /></div>",
            props: ["open", "title", "width", "confirmLoading"],
          },
          "a-form": { template: "<div><slot /></div>" },
          "a-form-item": { template: "<div><slot /></div>" },
          "a-select": { template: "<div><slot /></div>" },
          "a-input": { template: "<input />" },
          "a-textarea": { template: "<textarea />" },
          "a-tabs": { template: "<div><slot /></div>" },
          "a-tab-pane": { template: "<div><slot /></div>" },
          "a-upload": { template: "<div><slot /></div>" },
          "a-button": { template: "<button><slot /></button>" },
          "a-row": { template: "<div><slot /></div>" },
          "a-col": { template: "<div><slot /></div>" },
          "a-space": { template: "<div><slot /></div>" },
          "a-divider": { template: "<div />" },
          "a-alert": { template: "<div />" },
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

    it("应该初始化空表单", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.emailForm.to).toEqual([]);
      expect(wrapper.vm.emailForm.cc).toEqual([]);
      expect(wrapper.vm.emailForm.bcc).toEqual([]);
      expect(wrapper.vm.emailForm.subject).toBe("");
      expect(wrapper.vm.emailForm.text).toBe("");
      expect(wrapper.vm.emailForm.html).toBe("");
    });

    it("应该初始化为纯文本模式", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.contentType).toBe("text");
    });

    it("应该初始化空附件列表", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.fileList).toEqual([]);
    });
  });

  // 发送邮件测试
  describe("Send Email", () => {
    it("应该验证收件人为必填", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(message.error).toHaveBeenCalledWith("请输入收件人");
      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it("应该验证主题为必填", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(message.error).toHaveBeenCalledWith("请输入邮件主题");
      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it("应该验证邮件内容为必填", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";

      await wrapper.vm.sendEmail();

      expect(message.error).toHaveBeenCalledWith("请输入邮件内容");
      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it("应该成功发送纯文本邮件", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";
      wrapper.vm.contentType = "text";

      await wrapper.vm.sendEmail();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:send-email",
        "account-123",
        expect.objectContaining({
          to: "test@example.com",
          subject: "测试主题",
          text: "测试内容",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("邮件发送成功");
    });

    it("应该成功发送HTML邮件", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.html = "<p>测试内容</p>";
      wrapper.vm.contentType = "html";

      await wrapper.vm.sendEmail();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:send-email",
        "account-123",
        expect.objectContaining({
          to: "test@example.com",
          subject: "测试主题",
          html: "<p>测试内容</p>",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("邮件发送成功");
    });

    it("应该支持抄送和密送", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.cc = ["cc1@example.com", "cc2@example.com"];
      wrapper.vm.emailForm.bcc = ["bcc@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:send-email",
        "account-123",
        expect.objectContaining({
          to: "test@example.com",
          cc: "cc1@example.com, cc2@example.com",
          bcc: "bcc@example.com",
        }),
      );
    });

    it("应该在发送成功后重置表单", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(wrapper.vm.emailForm.to).toEqual([]);
      expect(wrapper.vm.emailForm.subject).toBe("");
      expect(wrapper.vm.emailForm.text).toBe("");
    });

    it("应该在发送成功后触发sent事件", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(wrapper.emitted("sent")).toBeTruthy();
    });

    it("应该在发送成功后关闭对话框", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(wrapper.emitted("update:visible")).toBeTruthy();
      expect(wrapper.emitted("update:visible")[0]).toEqual([false]);
    });

    it("应该处理发送失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("发送失败"),
      );

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(message.error).toHaveBeenCalledWith("发送失败: 发送失败");
    });

    it("应该在发送期间显示加载状态", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ success: true }), 100);
          }),
      );

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      const promise = wrapper.vm.sendEmail();
      expect(wrapper.vm.sending).toBe(true);

      await promise;
      expect(wrapper.vm.sending).toBe(false);
    });
  });

  // 附件测试
  describe("Attachments", () => {
    it("应该能添加附件", () => {
      wrapper = createWrapper();

      const file = {
        name: "test.pdf",
        size: 1024 * 100, // 100KB
      };

      const result = wrapper.vm.beforeUpload(file);

      expect(wrapper.vm.fileList).toContainEqual(file);
      expect(result).toBe(false); // 阻止自动上传
    });

    it("应该警告过大的文件", () => {
      wrapper = createWrapper();
      const message = mockMessage;

      const file = {
        name: "large.pdf",
        size: 30 * 1024 * 1024, // 30MB
      };

      wrapper.vm.beforeUpload(file);

      expect(message.warning).toHaveBeenCalledWith(
        expect.stringContaining("文件过大"),
      );
    });

    it("应该能移除附件", () => {
      wrapper = createWrapper();

      const file1 = { name: "file1.pdf", size: 1024 };
      const file2 = { name: "file2.pdf", size: 2048 };

      wrapper.vm.fileList = [file1, file2];

      wrapper.vm.removeFile(file1);

      expect(wrapper.vm.fileList).toEqual([file2]);
      expect(wrapper.vm.fileList).not.toContain(file1);
    });

    it("应该计算附件总大小", () => {
      wrapper = createWrapper();

      wrapper.vm.fileList = [
        { name: "file1.pdf", size: 1024 },
        { name: "file2.pdf", size: 2048 },
        { name: "file3.pdf", size: 512 },
      ];

      expect(wrapper.vm.totalSize).toBe(3584);
    });

    it("应该格式化字节大小", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatSize(500)).toBe("500 B");
      expect(wrapper.vm.formatSize(1536)).toBe("1.50 KB");
      expect(wrapper.vm.formatSize(1572864)).toBe("1.50 MB");
    });

    it("应该在发送时包含附件", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      const file = {
        name: "test.pdf",
        size: 1024,
        originFileObj: {
          path: "/path/to/test.pdf",
        },
      };

      wrapper.vm.fileList = [file];
      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:send-email",
        "account-123",
        expect.objectContaining({
          attachments: expect.arrayContaining([
            expect.objectContaining({
              filename: "test.pdf",
            }),
          ]),
        }),
      );
    });
  });

  // 富文本格式化测试
  describe("Rich Text Formatting", () => {
    it("应该能插入粗体格式", () => {
      wrapper = createWrapper();

      // 模拟 DOM textarea
      document.body.innerHTML = '<div class="html-editor"><textarea /></div>';
      const textarea = document.querySelector(".html-editor textarea");
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      wrapper.vm.insertFormat("bold");

      expect(wrapper.vm.emailForm.html).toContain("<strong>粗体文本</strong>");
    });

    it("应该能插入斜体格式", () => {
      wrapper = createWrapper();

      document.body.innerHTML = '<div class="html-editor"><textarea /></div>';
      const textarea = document.querySelector(".html-editor textarea");
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      wrapper.vm.insertFormat("italic");

      expect(wrapper.vm.emailForm.html).toContain("<em>斜体文本</em>");
    });

    it("应该能插入下划线格式", () => {
      wrapper = createWrapper();

      document.body.innerHTML = '<div class="html-editor"><textarea /></div>';
      const textarea = document.querySelector(".html-editor textarea");
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      wrapper.vm.insertFormat("underline");

      expect(wrapper.vm.emailForm.html).toContain("<u>下划线文本</u>");
    });

    it("应该能插入链接", () => {
      wrapper = createWrapper();

      document.body.innerHTML = '<div class="html-editor"><textarea /></div>';
      const textarea = document.querySelector(".html-editor textarea");
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      wrapper.vm.insertFormat("link");

      expect(wrapper.vm.emailForm.html).toContain("<a href=");
      expect(wrapper.vm.emailForm.html).toContain("链接文本</a>");
    });

    it("应该能插入图片", () => {
      wrapper = createWrapper();

      document.body.innerHTML = '<div class="html-editor"><textarea /></div>';
      const textarea = document.querySelector(".html-editor textarea");
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      wrapper.vm.insertFormat("image");

      expect(wrapper.vm.emailForm.html).toContain("<img src=");
    });

    it("应该在选中文本时应用格式", () => {
      wrapper = createWrapper();

      wrapper.vm.emailForm.html = "测试文本";

      document.body.innerHTML = '<div class="html-editor"><textarea /></div>';
      const textarea = document.querySelector(".html-editor textarea");
      textarea.selectionStart = 0;
      textarea.selectionEnd = 4;

      wrapper.vm.insertFormat("bold");

      expect(wrapper.vm.emailForm.html).toContain("<strong>测试文本</strong>");
    });
  });

  // 回复邮件测试
  describe("Reply Email", () => {
    it("应该在回复时填充收件人", async () => {
      const replyTo = {
        from_address: "sender@example.com",
        subject: "原始主题",
        date: "2024-01-01 12:00:00",
        text_content: "原始邮件内容",
        message_id: "msg-123",
      };

      wrapper = createWrapper({ visible: false });
      await wrapper.setProps({ visible: true, replyTo });

      expect(wrapper.vm.emailForm.to).toEqual(["sender@example.com"]);
    });

    it("应该在回复时添加Re:前缀", async () => {
      const replyTo = {
        from_address: "sender@example.com",
        subject: "原始主题",
        date: "2024-01-01 12:00:00",
        text_content: "原始邮件内容",
        message_id: "msg-123",
      };

      wrapper = createWrapper({ visible: false });
      await wrapper.setProps({ visible: true, replyTo });

      expect(wrapper.vm.emailForm.subject).toBe("Re: 原始主题");
    });

    it("应该不重复添加Re:前缀", async () => {
      const replyTo = {
        from_address: "sender@example.com",
        subject: "Re: 原始主题",
        date: "2024-01-01 12:00:00",
        text_content: "原始邮件内容",
        message_id: "msg-123",
      };

      wrapper = createWrapper({ visible: false });
      await wrapper.setProps({ visible: true, replyTo });

      expect(wrapper.vm.emailForm.subject).toBe("Re: 原始主题");
    });

    it("应该在回复时引用原始邮件", async () => {
      const replyTo = {
        from_address: "sender@example.com",
        subject: "原始主题",
        date: "2024-01-01 12:00:00",
        text_content: "原始邮件内容",
        message_id: "msg-123",
      };

      wrapper = createWrapper({ visible: false });
      await wrapper.setProps({ visible: true, replyTo });

      expect(wrapper.vm.emailForm.text).toContain("--- 原始邮件 ---");
      expect(wrapper.vm.emailForm.text).toContain("sender@example.com");
      expect(wrapper.vm.emailForm.text).toContain("原始主题");
      expect(wrapper.vm.emailForm.text).toContain("原始邮件内容");
    });

    it("应该在发送回复时包含message_id", async () => {
      const replyTo = {
        from_address: "sender@example.com",
        subject: "原始主题",
        date: "2024-01-01 12:00:00",
        text_content: "原始邮件内容",
        message_id: "msg-123",
      };

      wrapper = createWrapper({ replyTo });

      // Set up required fields for validation
      wrapper.vm.emailForm.to = ["recipient@example.com"];
      wrapper.vm.emailForm.subject = "Re: 原始主题";
      wrapper.vm.emailForm.text = "Reply content";

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      await wrapper.vm.sendEmail();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:send-email",
        "account-123",
        expect.objectContaining({
          inReplyTo: "msg-123",
          references: "msg-123",
        }),
      );
    });

    it("应该能清除回复状态", () => {
      wrapper = createWrapper();

      wrapper.vm.clearReply();

      expect(wrapper.emitted("update:replyTo")).toBeTruthy();
      expect(wrapper.emitted("update:replyTo")[0]).toEqual([null]);
    });
  });

  // 转发邮件测试
  describe("Forward Email", () => {
    it("应该在转发时添加Fwd:前缀", async () => {
      const forward = {
        from_address: "sender@example.com",
        subject: "原始主题",
        date: "2024-01-01 12:00:00",
        text_content: "原始邮件内容",
      };

      wrapper = createWrapper({ visible: false });
      await wrapper.setProps({ visible: true, forward });

      expect(wrapper.vm.emailForm.subject).toBe("Fwd: 原始主题");
    });

    it("应该不重复添加Fwd:前缀", async () => {
      const forward = {
        from_address: "sender@example.com",
        subject: "Fwd: 原始主题",
        date: "2024-01-01 12:00:00",
        text_content: "原始邮件内容",
      };

      wrapper = createWrapper({ visible: false });
      await wrapper.setProps({ visible: true, forward });

      expect(wrapper.vm.emailForm.subject).toBe("Fwd: 原始主题");
    });

    it("应该在转发时引用原始邮件", async () => {
      const forward = {
        from_address: "sender@example.com",
        subject: "原始主题",
        date: "2024-01-01 12:00:00",
        text_content: "原始邮件内容",
      };

      wrapper = createWrapper({ visible: false });
      await wrapper.setProps({ visible: true, forward });

      expect(wrapper.vm.emailForm.text).toContain("--- 转发邮件 ---");
      expect(wrapper.vm.emailForm.text).toContain("sender@example.com");
      expect(wrapper.vm.emailForm.text).toContain("原始主题");
      expect(wrapper.vm.emailForm.text).toContain("原始邮件内容");
    });

    it("应该能清除转发状态", () => {
      wrapper = createWrapper();

      wrapper.vm.clearForward();

      expect(wrapper.emitted("update:forward")).toBeTruthy();
      expect(wrapper.emitted("update:forward")[0]).toEqual([null]);
    });
  });

  // 草稿功能测试
  describe("Draft Functionality", () => {
    it("应该保存草稿", async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, draftId: 'draft-1' });

      await wrapper.vm.saveDraft();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:save-draft",
        "account-123",
        expect.any(Object)
      );
      expect(mockMessage.success).toHaveBeenCalledWith("草稿已保存");
    });
  });

  // 取消操作测试
  describe("Cancel Operation", () => {
    it("应该能取消编辑", () => {
      wrapper = createWrapper();

      wrapper.vm.handleCancel();

      expect(wrapper.emitted("update:visible")).toBeTruthy();
      expect(wrapper.emitted("update:visible")[0]).toEqual([false]);
    });
  });

  // 表单重置测试
  describe("Form Reset", () => {
    it("应该能重置表单", () => {
      wrapper = createWrapper();

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.cc = ["cc@example.com"];
      wrapper.vm.emailForm.bcc = ["bcc@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";
      wrapper.vm.emailForm.html = "<p>HTML内容</p>";
      wrapper.vm.fileList = [{ name: "test.pdf" }];
      wrapper.vm.contentType = "html";

      wrapper.vm.resetForm();

      expect(wrapper.vm.emailForm.to).toEqual([]);
      expect(wrapper.vm.emailForm.cc).toEqual([]);
      expect(wrapper.vm.emailForm.bcc).toEqual([]);
      expect(wrapper.vm.emailForm.subject).toBe("");
      expect(wrapper.vm.emailForm.text).toBe("");
      expect(wrapper.vm.emailForm.html).toBe("");
      expect(wrapper.vm.fileList).toEqual([]);
      expect(wrapper.vm.contentType).toBe("text");
    });

    it("应该在关闭对话框时重置表单", async () => {
      wrapper = createWrapper({ visible: true });

      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.setProps({ visible: false });

      expect(wrapper.vm.emailForm.subject).toBe("");
      expect(wrapper.vm.emailForm.text).toBe("");
    });
  });

  // Props测试
  describe("Props", () => {
    it("应该接收accountId属性", () => {
      wrapper = createWrapper({ accountId: "custom-account" });

      expect(wrapper.props("accountId")).toBe("custom-account");
    });

    it("应该接收visible属性", () => {
      wrapper = createWrapper({ visible: false });

      expect(wrapper.props("visible")).toBe(false);
    });

    it("应该接收replyTo属性", () => {
      const replyTo = { from_address: "test@example.com" };
      wrapper = createWrapper({ replyTo });

      expect(wrapper.props("replyTo")).toEqual(replyTo);
    });

    it("应该接收forward属性", () => {
      const forward = { from_address: "test@example.com" };
      wrapper = createWrapper({ forward });

      expect(wrapper.props("forward")).toEqual(forward);
    });
  });

  // 事件测试
  describe("Events", () => {
    it("应该触发update:visible事件", () => {
      wrapper = createWrapper();

      wrapper.vm.handleCancel();

      expect(wrapper.emitted("update:visible")).toBeTruthy();
    });

    it("应该触发sent事件", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(wrapper.emitted("sent")).toBeTruthy();
    });
  });

  // 边界情况测试
  describe("Edge Cases", () => {
    it("应该处理多个收件人", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = [
        "user1@example.com",
        "user2@example.com",
        "user3@example.com",
      ];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:send-email",
        "account-123",
        expect.objectContaining({
          to: "user1@example.com, user2@example.com, user3@example.com",
        }),
      );
    });

    it("应该处理空抄送和密送", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.cc = [];
      wrapper.vm.emailForm.bcc = [];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";

      await wrapper.vm.sendEmail();

      const callArgs = window.electron.ipcRenderer.invoke.mock.calls[0][2];
      expect(callArgs.cc).toBeUndefined();
      expect(callArgs.bcc).toBeUndefined();
    });

    it("应该处理没有附件的邮件", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper.vm.emailForm.to = ["test@example.com"];
      wrapper.vm.emailForm.subject = "测试主题";
      wrapper.vm.emailForm.text = "测试内容";
      wrapper.vm.fileList = [];

      await wrapper.vm.sendEmail();

      const callArgs = window.electron.ipcRenderer.invoke.mock.calls[0][2];
      expect(callArgs.attachments).toBeUndefined();
    });

    it("应该处理空附件大小", () => {
      wrapper = createWrapper();

      wrapper.vm.fileList = [
        { name: "file1.pdf" }, // 没有 size 属性
        { name: "file2.pdf", size: 1024 },
      ];

      expect(wrapper.vm.totalSize).toBe(1024);
    });

    it("应该处理格式化为0字节", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatSize(0)).toBe("0 B");
    });

    it("应该处理不存在的textarea元素", () => {
      wrapper = createWrapper();

      document.body.innerHTML = "";

      expect(() => {
        wrapper.vm.insertFormat("bold");
      }).not.toThrow();
    });

    it("应该处理附件移除不存在的文件", () => {
      wrapper = createWrapper();

      const file1 = { name: "file1.pdf" };
      const file2 = { name: "file2.pdf" };

      wrapper.vm.fileList = [file1];

      wrapper.vm.removeFile(file2);

      expect(wrapper.vm.fileList).toEqual([file1]);
    });
  });
});
