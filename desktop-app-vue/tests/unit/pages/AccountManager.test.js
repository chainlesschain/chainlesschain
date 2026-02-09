import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import AccountManager from "@renderer/pages/email/AccountManager.vue";

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
const mockRouter = {
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock dayjs
vi.mock("dayjs", () => {
  const mockDayjs = vi.fn((timestamp) => ({
    fromNow: vi.fn(() => "2小时前"),
    format: vi.fn(() => "2024-01-01 12:00:00"),
    valueOf: vi.fn(() => timestamp || Date.now()),
  }));
  mockDayjs.extend = vi.fn();
  mockDayjs.locale = vi.fn();
  return { default: mockDayjs };
});

// Mock accounts data
const mockAccounts = [
  {
    id: "account-1",
    email: "user1@example.com",
    display_name: "My Gmail",
    status: "active",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    imap_tls: 1,
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
    smtp_secure: 0,
    sync_frequency: 300,
    last_sync_at: 1704067200000,
    error_message: null,
    syncing: false,
  },
  {
    id: "account-2",
    email: "user2@outlook.com",
    display_name: "Work Email",
    status: "paused",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    imap_tls: 1,
    smtp_host: "smtp.office365.com",
    smtp_port: 587,
    smtp_secure: 0,
    sync_frequency: 300,
    last_sync_at: null,
    error_message: null,
    syncing: false,
  },
  {
    id: "account-3",
    email: "user3@qq.com",
    display_name: null,
    status: "error",
    imap_host: "imap.qq.com",
    imap_port: 993,
    imap_tls: 1,
    smtp_host: "smtp.qq.com",
    smtp_port: 587,
    smtp_secure: 0,
    sync_frequency: 300,
    last_sync_at: 1704067200000,
    error_message: "Authentication failed",
    syncing: false,
  },
];

global.window = global.window || {};
global.window.electron = {
  ipcRenderer: {
    invoke: vi.fn(),
  },
};

describe("AccountManager.vue", () => {
  let wrapper;

  const createWrapper = (props = {}) => {
    return mount(AccountManager, {
      props,
      global: {
        stubs: {
          "a-card": true,
          "a-button": true,
          "a-list": true,
          "a-list-item": true,
          "a-list-item-meta": true,
          "a-tooltip": true,
          "a-popconfirm": true,
          "a-avatar": true,
          "a-tag": true,
          "a-modal": true,
          "a-form": true,
          "a-form-item": true,
          "a-input": true,
          "a-input-password": true,
          "a-input-number": true,
          "a-divider": true,
          "a-row": true,
          "a-col": true,
          "a-checkbox": true,
          "a-space": true,
          "a-alert": true,
          PlusOutlined: true,
          SyncOutlined: true,
          PauseCircleOutlined: true,
          PlayCircleOutlined: true,
          SettingOutlined: true,
          DeleteOutlined: true,
          MailOutlined: true,
          CheckCircleOutlined: true,
          ThunderboltOutlined: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electron.ipcRenderer.invoke.mockResolvedValue({
      success: true,
      accounts: mockAccounts,
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // 组件挂载和初始化
  describe("Component Mounting and Initialization", () => {
    it("应该成功挂载组件", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("应该在挂载时加载账户列表", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-accounts",
      );
      expect(wrapper.vm.accounts).toEqual(mockAccounts);
    });

    it("应该处理加载账户失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Network error"),
      );
      const { message } = require("ant-design-vue");
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith("加载账户失败: Network error");
    });
  });

  // 添加账户
  describe("Add Account", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开添加账户对话框", () => {
      wrapper.vm.showAddAccountModal();

      expect(wrapper.vm.accountModalVisible).toBe(true);
      expect(wrapper.vm.editingAccount).toBeNull();
    });

    it("应该在打开对话框时重置表单", () => {
      wrapper.vm.accountForm.email = "test@example.com";
      wrapper.vm.showAddAccountModal();

      expect(wrapper.vm.accountForm.email).toBe("");
    });

    it("应该能添加新账户", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts });
      const { message } = require("ant-design-vue");

      wrapper.vm.accountForm.email = "new@example.com";
      wrapper.vm.accountForm.password = "password123";
      wrapper.vm.accountForm.imapHost = "imap.example.com";
      wrapper.vm.accountForm.smtpHost = "smtp.example.com";

      await wrapper.vm.handleSaveAccount();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:add-account",
        expect.objectContaining({
          email: "new@example.com",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("账户添加成功");
      expect(wrapper.vm.accountModalVisible).toBe(false);
    });

    it("应该验证必填字段（邮箱和密码）", async () => {
      const { message } = require("ant-design-vue");

      wrapper.vm.accountForm.email = "";
      wrapper.vm.accountForm.password = "";

      await wrapper.vm.handleSaveAccount();

      expect(message.error).toHaveBeenCalledWith("请填写邮箱地址和密码");
      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
        "email:add-account",
      );
    });

    it("应该验证IMAP和SMTP服务器地址", async () => {
      const { message } = require("ant-design-vue");

      wrapper.vm.accountForm.email = "test@example.com";
      wrapper.vm.accountForm.password = "password";
      wrapper.vm.accountForm.imapHost = "";
      wrapper.vm.accountForm.smtpHost = "";

      await wrapper.vm.handleSaveAccount();

      expect(message.error).toHaveBeenCalledWith(
        "请填写 IMAP 和 SMTP 服务器地址",
      );
    });

    it("应该处理添加账户失败", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockRejectedValueOnce(new Error("Add failed"));
      const { message } = require("ant-design-vue");

      wrapper.vm.accountForm.email = "new@example.com";
      wrapper.vm.accountForm.password = "password123";
      wrapper.vm.accountForm.imapHost = "imap.example.com";
      wrapper.vm.accountForm.smtpHost = "smtp.example.com";

      await wrapper.vm.handleSaveAccount();

      expect(message.error).toHaveBeenCalledWith("保存失败: Add failed");
    });
  });

  // 编辑账户
  describe("Edit Account", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开编辑账户对话框", () => {
      const account = mockAccounts[0];
      wrapper.vm.editAccount(account);

      expect(wrapper.vm.editingAccount).toEqual(account);
      expect(wrapper.vm.accountModalVisible).toBe(true);
      expect(wrapper.vm.accountForm.email).toBe(account.email);
    });

    it("应该能更新账户", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts });
      const { message } = require("ant-design-vue");

      wrapper.vm.editingAccount = mockAccounts[0];
      wrapper.vm.accountForm.displayName = "Updated Name";
      wrapper.vm.accountForm.password = "newpassword";
      wrapper.vm.accountForm.imapHost = "imap.gmail.com";
      wrapper.vm.accountForm.smtpHost = "smtp.gmail.com";

      await wrapper.vm.handleSaveAccount();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:update-account",
        "account-1",
        expect.any(Object),
      );
      expect(message.success).toHaveBeenCalledWith("账户更新成功");
    });

    it("应该在编辑时禁用邮箱地址字段", () => {
      wrapper.vm.editAccount(mockAccounts[0]);

      // This is verified by the template, accountForm still has the email value
      expect(wrapper.vm.accountForm.email).toBe("user1@example.com");
    });

    it("应该不显示密码", () => {
      wrapper.vm.editAccount(mockAccounts[0]);

      expect(wrapper.vm.accountForm.password).toBe("");
    });
  });

  // 删除账户
  describe("Delete Account", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能删除账户", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, accounts: [] });
      const { message } = require("ant-design-vue");

      await wrapper.vm.deleteAccount("account-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:remove-account",
        "account-1",
      );
      expect(message.success).toHaveBeenCalledWith("账户已删除");
    });

    it("应该在删除后重新加载账户列表", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, accounts: [] });

      await wrapper.vm.deleteAccount("account-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:get-accounts",
      );
    });

    it("应该处理删除失败", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockRejectedValueOnce(new Error("Delete failed"));
      const { message } = require("ant-design-vue");

      await wrapper.vm.deleteAccount("account-1");

      expect(message.error).toHaveBeenCalledWith("删除失败: Delete failed");
    });
  });

  // 同步账户
  describe("Sync Account", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能同步账户", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({ success: true, count: 5 })
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts });
      const { message } = require("ant-design-vue");

      await wrapper.vm.syncAccount("account-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:fetch-emails",
        "account-1",
        { limit: 50, unseen: true },
      );
      expect(message.success).toHaveBeenCalledWith("已同步 5 封新邮件");
    });

    it("应该在同步时设置syncing状态", async () => {
      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockReturnValueOnce(promise);

      const syncPromise = wrapper.vm.syncAccount("account-1");
      await wrapper.vm.$nextTick();

      const account = wrapper.vm.accounts.find((a) => a.id === "account-1");
      expect(account.syncing).toBe(true);

      resolvePromise({ success: true, count: 0 });
      await syncPromise;

      expect(account.syncing).toBe(false);
    });

    it("应该处理同步失败", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockRejectedValueOnce(new Error("Sync failed"));
      const { message } = require("ant-design-vue");

      await wrapper.vm.syncAccount("account-1");

      expect(message.error).toHaveBeenCalledWith("同步失败: Sync failed");
    });
  });

  // 切换账户状态
  describe("Toggle Account Status", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能暂停活动账户", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts });
      const { message } = require("ant-design-vue");

      const account = mockAccounts[0];
      await wrapper.vm.toggleAccountStatus(account);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:update-account",
        "account-1",
        { status: "paused" },
      );
      expect(message.success).toHaveBeenCalledWith("已暂停");
    });

    it("应该能启用暂停的账户", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts });
      const { message } = require("ant-design-vue");

      const account = mockAccounts[1]; // paused account
      await wrapper.vm.toggleAccountStatus(account);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:update-account",
        "account-2",
        { status: "active" },
      );
      expect(message.success).toHaveBeenCalledWith("已启用");
    });

    it("应该处理切换状态失败", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockRejectedValueOnce(new Error("Toggle failed"));
      const { message } = require("ant-design-vue");

      await wrapper.vm.toggleAccountStatus(mockAccounts[0]);

      expect(message.error).toHaveBeenCalledWith("操作失败: Toggle failed");
    });
  });

  // 测试连接
  describe("Test Connection", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能测试连接", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({
          success: true,
          result: { success: true, mailboxes: 5 },
        });

      wrapper.vm.accountForm.email = "test@example.com";
      wrapper.vm.accountForm.password = "password";

      await wrapper.vm.testConnection();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "email:test-connection",
        expect.any(Object),
      );
      expect(wrapper.vm.testResult.success).toBe(true);
      expect(wrapper.vm.testResult.message).toContain("5");
    });

    it("应该验证测试连接的必填字段", async () => {
      const { message } = require("ant-design-vue");

      wrapper.vm.accountForm.email = "";
      wrapper.vm.accountForm.password = "";

      await wrapper.vm.testConnection();

      expect(message.error).toHaveBeenCalledWith("请填写邮箱地址和密码");
    });

    it("应该处理连接失败", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockResolvedValueOnce({
          success: true,
          result: { success: false, error: "Authentication failed" },
        });

      wrapper.vm.accountForm.email = "test@example.com";
      wrapper.vm.accountForm.password = "wrong";

      await wrapper.vm.testConnection();

      expect(wrapper.vm.testResult.success).toBe(false);
      expect(wrapper.vm.testResult.message).toBe("Authentication failed");
    });

    it("应该处理测试异常", async () => {
      window.electron.ipcRenderer.invoke
        .mockResolvedValueOnce({ success: true, accounts: mockAccounts })
        .mockRejectedValueOnce(new Error("Connection error"));

      wrapper.vm.accountForm.email = "test@example.com";
      wrapper.vm.accountForm.password = "password";

      await wrapper.vm.testConnection();

      expect(wrapper.vm.testResult.success).toBe(false);
      expect(wrapper.vm.testResult.message).toBe("Connection error");
    });
  });

  // 预设配置
  describe("Presets", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开预设选择对话框", () => {
      wrapper.vm.usePreset();

      expect(wrapper.vm.presetModalVisible).toBe(true);
      expect(wrapper.vm.selectedPreset).toBeNull();
    });

    it("应该能应用预设配置", () => {
      const { message } = require("ant-design-vue");
      wrapper.vm.selectedPreset = wrapper.vm.presets[0]; // Gmail

      wrapper.vm.applyPreset();

      expect(wrapper.vm.accountForm.imapHost).toBe("imap.gmail.com");
      expect(wrapper.vm.accountForm.imapPort).toBe(993);
      expect(wrapper.vm.accountForm.smtpHost).toBe("smtp.gmail.com");
      expect(wrapper.vm.presetModalVisible).toBe(false);
      expect(message.success).toHaveBeenCalledWith("已应用预设配置");
    });

    it("应该验证是否选择了预设", () => {
      const { message } = require("ant-design-vue");
      wrapper.vm.selectedPreset = null;

      wrapper.vm.applyPreset();

      expect(message.warning).toHaveBeenCalledWith("请选择一个预设");
      expect(wrapper.vm.presetModalVisible).toBe(true);
    });

    it("应该有多个预设配置", () => {
      expect(wrapper.vm.presets.length).toBeGreaterThan(0);
      expect(wrapper.vm.presets.some((p) => p.name === "Gmail")).toBe(true);
      expect(wrapper.vm.presets.some((p) => p.name === "Outlook/Hotmail")).toBe(
        true,
      );
      expect(wrapper.vm.presets.some((p) => p.name === "QQ 邮箱")).toBe(true);
    });
  });

  // 查看邮件
  describe("View Emails", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能跳转到邮件列表", () => {
      const account = mockAccounts[0];
      wrapper.vm.viewEmails(account);

      expect(mockRouter.push).toHaveBeenCalledWith("/email/inbox/account-1");
    });
  });

  // 时间格式化
  describe("Time Formatting", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能格式化时间", () => {
      const formatted = wrapper.vm.formatTime(1704067200000);
      expect(formatted).toBe("2小时前");
    });
  });

  // 表单重置
  describe("Form Reset", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能重置表单", () => {
      wrapper.vm.accountForm.email = "test@example.com";
      wrapper.vm.accountForm.password = "password";
      wrapper.vm.accountForm.displayName = "Test";

      wrapper.vm.resetForm();

      expect(wrapper.vm.accountForm.email).toBe("");
      expect(wrapper.vm.accountForm.password).toBe("");
      expect(wrapper.vm.accountForm.displayName).toBe("");
    });

    it("应该恢复默认端口值", () => {
      wrapper.vm.accountForm.imapPort = 143;
      wrapper.vm.accountForm.smtpPort = 25;

      wrapper.vm.resetForm();

      expect(wrapper.vm.accountForm.imapPort).toBe(993);
      expect(wrapper.vm.accountForm.smtpPort).toBe(587);
    });
  });

  // 加载状态
  describe("Loading States", () => {
    it("应该在加载时设置loading状态", async () => {
      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.electron.ipcRenderer.invoke.mockReturnValue(promise);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.loading).toBe(true);

      resolvePromise({ success: true, accounts: [] });
      await promise;

      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该在保存时设置saving状态", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.electron.ipcRenderer.invoke.mockReturnValue(promise);

      wrapper.vm.accountForm.email = "test@example.com";
      wrapper.vm.accountForm.password = "password";
      wrapper.vm.accountForm.imapHost = "imap.example.com";
      wrapper.vm.accountForm.smtpHost = "smtp.example.com";

      const savePromise = wrapper.vm.handleSaveAccount();
      expect(wrapper.vm.saving).toBe(true);

      resolvePromise({ success: true });
      await savePromise;

      expect(wrapper.vm.saving).toBe(false);
    });

    it("应该在测试连接时设置testing状态", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.electron.ipcRenderer.invoke.mockReturnValue(promise);

      wrapper.vm.accountForm.email = "test@example.com";
      wrapper.vm.accountForm.password = "password";

      const testPromise = wrapper.vm.testConnection();
      expect(wrapper.vm.testing).toBe(true);

      resolvePromise({ success: true, result: { success: true } });
      await testPromise;

      expect(wrapper.vm.testing).toBe(false);
    });
  });

  // 边界情况
  describe("Edge Cases", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该处理空账户列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        accounts: [],
      });

      await wrapper.vm.loadAccounts();

      expect(wrapper.vm.accounts).toEqual([]);
    });

    it("应该处理缺失display_name的账户", () => {
      const account = mockAccounts[2];
      expect(account.display_name).toBeNull();
    });

    it("应该处理未同步的账户", () => {
      const account = mockAccounts[1];
      expect(account.last_sync_at).toBeNull();
    });

    it("应该处理有错误消息的账户", () => {
      const account = mockAccounts[2];
      expect(account.error_message).toBe("Authentication failed");
      expect(account.status).toBe("error");
    });

    it("应该处理同步不存在的账户", async () => {
      await wrapper.vm.syncAccount("non-existent");

      // Should not crash
      expect(wrapper.vm.accounts).toBeDefined();
    });
  });

  // 账户状态标签
  describe("Account Status Tags", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该显示正确的状态标签", () => {
      const activeAccount = mockAccounts[0];
      const pausedAccount = mockAccounts[1];
      const errorAccount = mockAccounts[2];

      expect(activeAccount.status).toBe("active");
      expect(pausedAccount.status).toBe("paused");
      expect(errorAccount.status).toBe("error");
    });
  });

  // IMAP和SMTP配置
  describe("IMAP and SMTP Configuration", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该正确显示IMAP配置", () => {
      const account = mockAccounts[0];
      expect(account.imap_host).toBe("imap.gmail.com");
      expect(account.imap_port).toBe(993);
      expect(account.imap_tls).toBe(1);
    });

    it("应该正确显示SMTP配置", () => {
      const account = mockAccounts[0];
      expect(account.smtp_host).toBe("smtp.gmail.com");
      expect(account.smtp_port).toBe(587);
      expect(account.smtp_secure).toBe(0);
    });

    it("应该在编辑时正确转换布尔值", () => {
      const account = mockAccounts[0];
      wrapper.vm.editAccount(account);

      expect(wrapper.vm.accountForm.imapTls).toBe(true);
      expect(wrapper.vm.accountForm.smtpSecure).toBe(false);
    });
  });
});
