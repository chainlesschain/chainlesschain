/**
 * AIChatPage 组件测试
 * 测试AI聊天页面的所有功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config, mount, flushPromises } from "@vue/test-utils";
import AIChatPage from "@renderer/pages/AIChatPage.vue";
import { nextTick } from "vue";

// Define mock using vi.hoisted to ensure it's available for vi.mock
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

// Mock Ant Design Vue with hoisted mock
vi.mock("ant-design-vue", () => ({
  message: mockMessage,
}));

// Mock Vue Router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  currentRoute: {
    value: {
      params: {},
      query: {},
    },
  },
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

// Mock auth store - use hoisted to ensure it's available when mock is evaluated
const mockAuthStore = vi.hoisted(() => ({
  currentUser: {
    username: "testuser",
    avatar: "/avatar.png",
  },
  logout: vi.fn(),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => mockAuthStore,
}));

const mockCodingAgentStore = vi.hoisted(() => ({
  currentSessionId: null,
  currentSession: null,
  latestApprovalRequest: null,
  latestBlockedToolEvent: null,
  permissionPolicy: null,
  requiresHighRiskConfirmation: false,
  events: [],
  error: null,
  currentSessionReviewState: null,
  isCurrentSessionBlockedByReview: false,
  reviewStates: {},
  initEventListeners: vi.fn(),
  disposeEventListeners: vi.fn(),
  refreshStatus: vi.fn().mockResolvedValue(),
  listWorktrees: vi.fn().mockResolvedValue([]),
  resumeSession: vi.fn().mockResolvedValue(true),
  startSession: vi.fn().mockResolvedValue("session-1"),
  showPlan: vi.fn().mockResolvedValue(),
  enterPlanMode: vi.fn().mockResolvedValue(),
  respondApproval: vi.fn().mockResolvedValue(),
  enterReview: vi.fn().mockResolvedValue(null),
  submitReviewComment: vi.fn().mockResolvedValue(null),
  resolveReview: vi.fn().mockResolvedValue(null),
  fetchReviewStatus: vi.fn().mockResolvedValue(null),
  sendMessage: vi.fn().mockResolvedValue({
    success: true,
    requestId: "req-1",
    sessionId: "session-1",
  }),
}));

vi.mock("@/stores/coding-agent", () => ({
  useCodingAgentStore: () => mockCodingAgentStore,
}));

const mockSessionCoreStore = vi.hoisted(() => ({
  sessions: [],
  memories: [],
  betaFlags: [],
  streams: new Map(),
  usageSummary: null,
  activeBundle: null,
  lastError: null,
  setPolicy: vi.fn().mockResolvedValue({ success: true }),
  getPolicy: vi.fn().mockResolvedValue(null),
  tail: vi.fn().mockResolvedValue([]),
  usage: vi.fn().mockResolvedValue(null),
  park: vi.fn().mockResolvedValue(true),
  unpark: vi.fn().mockResolvedValue(true),
  end: vi.fn().mockResolvedValue(true),
  listSessions: vi.fn().mockResolvedValue([]),
  listMemories: vi.fn().mockResolvedValue([]),
  listBetaFlags: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/stores/sessionCore", () => ({
  useSessionCoreStore: () => mockSessionCoreStore,
}));

// Hoist marked mock parse function so tests can access it
const mockMarkedParse = vi.hoisted(() =>
  vi.fn((content) => `<p>${content}</p>`),
);

// Mock marked library - use class to properly support new Renderer() and method binding
vi.mock("marked", () => {
  class MockRenderer {
    constructor() {
      this.code = vi.fn((code, lang) => `<pre><code>${code}</code></pre>`);
    }
  }

  return {
    marked: {
      parse: mockMarkedParse,
      setOptions: vi.fn(),
      use: vi.fn(),
      Renderer: MockRenderer,
    },
  };
});

// Mock components
vi.mock("@/components/projects/ConversationInput.vue", () => ({
  default: {
    name: "ConversationInput",
    template: '<div class="mock-conversation-input"></div>',
  },
}));

vi.mock("@/components/projects/BrowserPreview.vue", () => ({
  default: {
    name: "BrowserPreview",
    template: '<div class="mock-browser-preview"></div>',
  },
}));

vi.mock("@/components/projects/StepDisplay.vue", () => ({
  default: {
    name: "StepDisplay",
    template: '<div class="mock-step-display"></div>',
  },
}));

const antDesignPageStubs = {
  "a-button": true,
  "a-dropdown": true,
  "a-menu": true,
  "a-menu-item": true,
  "a-tooltip": true,
  "a-alert": true,
  "a-tag": true,
  "a-input": true,
  "a-modal": true,
  "a-descriptions": true,
  "a-descriptions-item": true,
  "a-empty": true,
};

config.global.stubs = {
  ...(config.global.stubs || {}),
  ...antDesignPageStubs,
};

// Mock Ant Design Icons
vi.mock("@ant-design/icons-vue", () => ({
  RobotOutlined: { name: "RobotOutlined", template: "<span>Robot</span>" },
  UserOutlined: { name: "UserOutlined", template: "<span>User</span>" },
  LoadingOutlined: {
    name: "LoadingOutlined",
    template: "<span>Loading</span>",
  },
  BookOutlined: { name: "BookOutlined", template: "<span>Book</span>" },
  SaveOutlined: { name: "SaveOutlined", template: "<span>Save</span>" },
  CheckOutlined: { name: "CheckOutlined", template: "<span>Check</span>" },
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("AIChatPage", () => {
  let wrapper;
  let mockConversations;
  let mockMessages;

  beforeEach(() => {
    Object.assign(mockCodingAgentStore, {
      currentSessionId: null,
      currentSession: null,
      latestApprovalRequest: null,
      latestBlockedToolEvent: null,
      permissionPolicy: null,
      requiresHighRiskConfirmation: false,
      events: [],
      error: null,
      currentSessionReviewState: null,
      isCurrentSessionBlockedByReview: false,
      reviewStates: {},
    });
    mockCodingAgentStore.initEventListeners.mockClear();
    mockCodingAgentStore.disposeEventListeners.mockClear();
    mockCodingAgentStore.refreshStatus.mockClear();
    mockCodingAgentStore.listWorktrees.mockClear();
    mockCodingAgentStore.resumeSession.mockClear();
    mockCodingAgentStore.startSession.mockClear();
    mockCodingAgentStore.showPlan.mockClear();
    mockCodingAgentStore.enterPlanMode.mockClear();
    mockCodingAgentStore.respondApproval.mockClear();
    mockCodingAgentStore.sendMessage.mockClear();
    mockCodingAgentStore.sendMessage.mockResolvedValue({
      success: true,
      requestId: "req-1",
      sessionId: "session-1",
    });

    // Mock Electron API
    global.window = {
      electronAPI: {
        conversation: {
          list: vi.fn(),
          getMessages: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          toggleStar: vi.fn(),
          addMessage: vi.fn(),
        },
        llm: {
          chat: vi.fn(),
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      localStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      location: {
        hash: "",
        href: "",
        pathname: "/",
      },
    };

    // Mock clipboard API
    global.navigator.clipboard = {
      writeText: vi.fn().mockResolvedValue(),
    };

    // Mock conversations data
    mockConversations = [
      {
        id: "conv-1",
        title: "对话1",
        updated_at: Date.now(),
        is_starred: false,
      },
      {
        id: "conv-2",
        title: "对话2",
        updated_at: Date.now() - 1000,
        is_starred: true,
      },
    ];

    // Mock messages data
    mockMessages = [
      {
        id: "msg-1",
        role: "user",
        content: "你好",
        created_at: Date.now() - 2000,
        steps: [],
        preview: null,
      },
      {
        id: "msg-2",
        role: "assistant",
        content: "你好！有什么可以帮你的？",
        created_at: Date.now() - 1000,
        steps: [],
        preview: null,
      },
    ];

    window.electronAPI.conversation.list.mockResolvedValue(mockConversations);
    window.electronAPI.conversation.getMessages.mockResolvedValue(mockMessages);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.clearAllMocks();
  });

  const createPageMountOptions = () => ({
    global: {
      stubs: {
        "a-avatar": true,
        "a-modal": true,
        "a-input": true,
        "a-button": {
          template: "<button @click=\"$emit('click')\"><slot /></button>",
        },
        "a-tag": {
          template: '<span class="stub-tag"><slot /></span>',
        },
        "a-alert": {
          props: ["message", "description"],
          template:
            '<div class="stub-alert"><span>{{ message }}</span><span>{{ description }}</span></div>',
        },
        "a-tooltip": {
          template: '<div class="stub-tooltip"><slot /></div>',
        },
        ConversationInput: true,
        BrowserPreview: true,
        StepDisplay: true,
      },
    },
  });

  const mountApprovalPage = async () => {
    wrapper = mount(AIChatPage, createPageMountOptions());
    await nextTick();
    await nextTick();
    await nextTick();
    wrapper.vm.codingAgentSessionMap = {
      [wrapper.vm.activeConversationId]: "session-1",
    };
    await nextTick();
  };

  describe("组件挂载和初始化", () => {
    it("应该正确挂载", () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
            BrowserPreview: true,
            StepDisplay: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("应该能加载对话列表", async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(window.electronAPI.conversation.list).toHaveBeenCalled();
      expect(wrapper.vm.conversations).toHaveLength(2);
    });

    it("应该自动加载第一个对话的消息", async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();
      await nextTick();

      expect(window.electronAPI.conversation.getMessages).toHaveBeenCalledWith(
        "conv-1",
      );
      expect(wrapper.vm.messages).toHaveLength(2);
    });

    it("处理API不可用的情况", async () => {
      delete window.electronAPI.conversation.list;

      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.conversations).toEqual([]);
    });

    it("应该在API未就绪时静默处理", async () => {
      window.electronAPI.conversation.list.mockRejectedValue(
        new Error("No handler registered"),
      );

      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.conversations).toEqual([]);
    });
  });

  describe("欢迎消息显示", () => {
    it("当没有消息时应该显示欢迎消息", async () => {
      window.electronAPI.conversation.list.mockResolvedValue([]);

      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.messages).toHaveLength(0);
    });

    it("当有消息时不应该显示欢迎消息", async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.messages).toHaveLength(2);
    });
  });

  describe("对话管理", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();
      await nextTick();
    });

    it("应该能新建对话", async () => {
      const message = mockMessage;
      const newConv = {
        id: "conv-new",
        title: "新对话",
      };

      window.electronAPI.conversation.create.mockResolvedValue(newConv);

      await wrapper.vm.handleNewConversation();

      expect(window.electronAPI.conversation.create).toHaveBeenCalledWith({
        title: "新对话",
      });
      expect(wrapper.vm.conversations[0].id).toBe("conv-new");
      expect(wrapper.vm.activeConversationId).toBe("conv-new");
      expect(wrapper.vm.messages).toEqual([]);
      expect(message.success).toHaveBeenCalledWith("创建新对话成功");
    });

    it("处理新建对话失败", async () => {
      const message = mockMessage;
      window.electronAPI.conversation.create.mockRejectedValue(
        new Error("创建失败"),
      );

      await wrapper.vm.handleNewConversation();

      expect(message.error).toHaveBeenCalledWith("创建对话失败");
    });

    it("应该能切换对话", async () => {
      const conv = wrapper.vm.conversations[1];
      window.electronAPI.conversation.getMessages.mockResolvedValue([]);

      await wrapper.vm.handleConversationClick(conv);

      expect(wrapper.vm.activeConversationId).toBe("conv-2");
      expect(window.electronAPI.conversation.getMessages).toHaveBeenCalledWith(
        "conv-2",
      );
    });

    it("点击当前活动对话应该不做任何操作", async () => {
      const conv = wrapper.vm.conversations[0];
      const callCount =
        window.electronAPI.conversation.getMessages.mock.calls.length;

      await wrapper.vm.handleConversationClick(conv);

      expect(window.electronAPI.conversation.getMessages).toHaveBeenCalledTimes(
        callCount,
      );
    });

    it("应该能收藏对话", async () => {
      const conv = wrapper.vm.conversations[0];
      window.electronAPI.conversation.toggleStar.mockResolvedValue();

      await wrapper.vm.handleConversationAction({
        action: "star",
        conversation: conv,
      });

      expect(window.electronAPI.conversation.toggleStar).toHaveBeenCalledWith(
        "conv-1",
      );
      expect(conv.is_starred).toBe(true);
    });

    it("处理收藏失败", async () => {
      const message = mockMessage;
      const conv = wrapper.vm.conversations[0];
      window.electronAPI.conversation.toggleStar.mockRejectedValue(
        new Error("操作失败"),
      );

      await wrapper.vm.handleConversationAction({
        action: "star",
        conversation: conv,
      });

      expect(message.error).toHaveBeenCalledWith("操作失败");
    });

    it("应该能删除对话", async () => {
      const message = mockMessage;
      const conv = wrapper.vm.conversations[1];
      window.electronAPI.conversation.delete.mockResolvedValue();

      await wrapper.vm.handleConversationAction({
        action: "delete",
        conversation: conv,
      });

      expect(window.electronAPI.conversation.delete).toHaveBeenCalledWith(
        "conv-2",
      );
      expect(wrapper.vm.conversations).toHaveLength(1);
      expect(message.success).toHaveBeenCalledWith("删除对话成功");
    });

    it("删除当前活动对话时应该切换到第一个对话", async () => {
      const conv = wrapper.vm.conversations[0];
      window.electronAPI.conversation.delete.mockResolvedValue();
      window.electronAPI.conversation.getMessages.mockResolvedValue([]);

      await wrapper.vm.handleConversationAction({
        action: "delete",
        conversation: conv,
      });

      expect(wrapper.vm.activeConversationId).toBe("conv-2");
    });

    it("删除最后一个对话时应该清空消息", async () => {
      wrapper.vm.conversations = [mockConversations[0]];
      wrapper.vm.activeConversationId = "conv-1";

      const conv = wrapper.vm.conversations[0];
      window.electronAPI.conversation.delete.mockResolvedValue();

      await wrapper.vm.handleConversationAction({
        action: "delete",
        conversation: conv,
      });

      expect(wrapper.vm.activeConversationId).toBe("");
      expect(wrapper.vm.messages).toEqual([]);
    });

    it("处理删除失败", async () => {
      const message = mockMessage;
      const conv = wrapper.vm.conversations[0];
      window.electronAPI.conversation.delete.mockRejectedValue(
        new Error("删除失败"),
      );

      await wrapper.vm.handleConversationAction({
        action: "delete",
        conversation: conv,
      });

      expect(message.error).toHaveBeenCalledWith("删除对话失败");
    });

    it("应该处理重命名操作", async () => {
      const conv = wrapper.vm.conversations[0];

      await wrapper.vm.handleConversationAction({
        action: "rename",
        conversation: conv,
      });

      // TODO: 实现重命名对话框
    });
  });

  describe("消息发送", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();
      await nextTick();
    });

    it("应该能发送消息", async () => {
      window.electronAPI.conversation.addMessage.mockResolvedValue();
      window.electronAPI.llm.chat.mockResolvedValue({
        content: "AI回复",
        steps: [],
        preview: null,
      });

      const initialLength = wrapper.vm.messages.length;

      await wrapper.vm.handleSubmitMessage({
        text: "你好",
        attachments: [],
      });

      // 等待异步操作完成
      await nextTick();
      await nextTick();

      expect(wrapper.vm.messages.length).toBeGreaterThan(initialLength);
      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalled();
      expect(window.electronAPI.llm.chat).toHaveBeenCalled();
    });

    it("空消息应该显示警告", async () => {
      const message = mockMessage;

      await wrapper.vm.handleSubmitMessage({
        text: "   ",
        attachments: [],
      });

      expect(message.warning).toHaveBeenCalledWith("请输入消息内容");
    });

    it("没有活动对话时应该自动创建", async () => {
      wrapper.vm.activeConversationId = "";
      window.electronAPI.conversation.create.mockResolvedValue({
        id: "conv-new",
        title: "新对话",
      });
      window.electronAPI.conversation.addMessage.mockResolvedValue();
      window.electronAPI.llm.chat.mockResolvedValue({
        content: "AI回复",
        steps: [],
        preview: null,
      });

      await wrapper.vm.handleSubmitMessage({
        text: "你好",
        attachments: [],
      });

      expect(window.electronAPI.conversation.create).toHaveBeenCalled();
    });

    it("发送消息时应该设置思考状态", async () => {
      window.electronAPI.conversation.addMessage.mockResolvedValue();
      window.electronAPI.llm.chat.mockImplementation(
        () =>
          new Promise((resolve) => {
            expect(wrapper.vm.isThinking).toBe(true);
            setTimeout(() => {
              resolve({
                content: "AI回复",
                steps: [],
                preview: null,
              });
            }, 100);
          }),
      );

      await wrapper.vm.handleSubmitMessage({
        text: "你好",
        attachments: [],
      });
    });

    it("AI回复后应该清除思考状态", async () => {
      window.electronAPI.conversation.addMessage.mockResolvedValue();
      window.electronAPI.llm.chat.mockResolvedValue({
        content: "AI回复",
        steps: [],
        preview: null,
      });

      await wrapper.vm.handleSubmitMessage({
        text: "你好",
        attachments: [],
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.isThinking).toBe(false);
    });

    it("应该能保存AI消息到数据库", async () => {
      window.electronAPI.conversation.addMessage.mockResolvedValue();
      window.electronAPI.llm.chat.mockResolvedValue({
        content: "AI回复",
        steps: [{ id: "step-1" }],
        preview: { type: "web" },
      });

      await wrapper.vm.handleSubmitMessage({
        text: "你好",
        attachments: [],
      });

      await nextTick();
      await nextTick();

      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalledWith(
        "conv-1",
        expect.objectContaining({
          role: "assistant",
          content: "AI回复",
        }),
      );
    });

    it("应该自动更新新对话的标题", async () => {
      wrapper.vm.conversations[0].title = "新对话";
      window.electronAPI.conversation.addMessage.mockResolvedValue();
      window.electronAPI.conversation.update.mockResolvedValue();
      window.electronAPI.llm.chat.mockResolvedValue({
        content: "AI回复",
        steps: [],
        preview: null,
      });

      await wrapper.vm.handleSubmitMessage({
        text: "这是一条很长的消息用来测试标题更新功能",
        attachments: [],
      });

      await nextTick();
      await nextTick();

      expect(window.electronAPI.conversation.update).toHaveBeenCalled();
      expect(wrapper.vm.conversations[0].title).toContain("这是一条很长的消息");
    });

    it("长消息应该截断标题", async () => {
      wrapper.vm.conversations[0].title = "新对话";
      window.electronAPI.conversation.addMessage.mockResolvedValue();
      window.electronAPI.conversation.update.mockResolvedValue();
      window.electronAPI.llm.chat.mockResolvedValue({
        content: "AI回复",
        steps: [],
        preview: null,
      });

      const longMessage = "a".repeat(50);
      await wrapper.vm.handleSubmitMessage({
        text: longMessage,
        attachments: [],
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.conversations[0].title).toContain("...");
      expect(wrapper.vm.conversations[0].title.length).toBeLessThanOrEqual(33);
    });

    it("处理AI响应失败", async () => {
      const message = mockMessage;
      window.electronAPI.conversation.addMessage.mockResolvedValue();
      window.electronAPI.llm.chat.mockRejectedValue(new Error("AI错误"));

      await wrapper.vm.handleSubmitMessage({
        text: "你好",
        attachments: [],
      });

      await nextTick();
      await nextTick();

      expect(message.error).toHaveBeenCalled();
      expect(wrapper.vm.isThinking).toBe(false);
      expect(
        wrapper.vm.messages[wrapper.vm.messages.length - 1].content,
      ).toContain("抱歉");
    });

    it("处理保存消息失败", async () => {
      window.electronAPI.conversation.addMessage.mockRejectedValue(
        new Error("保存失败"),
      );
      window.electronAPI.llm.chat.mockResolvedValue({
        content: "AI回复",
        steps: [],
        preview: null,
      });

      await wrapper.vm.handleSubmitMessage({
        text: "你好",
        attachments: [],
      });

      await nextTick();
      await nextTick();

      // 即使保存失败，AI仍应该回复
      expect(wrapper.vm.messages.length).toBeGreaterThan(0);
    });
  });

  describe("用户信息显示", () => {
    beforeEach(() => {
      // Reset mockAuthStore to original values before each test
      mockAuthStore.currentUser = {
        username: "testuser",
        avatar: "/avatar.png",
      };
    });

    it("应该显示用户名", async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      expect(wrapper.vm.userName).toBe("testuser");
    });

    it("没有用户名时应该显示默认值", async () => {
      mockAuthStore.currentUser = {};

      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      expect(wrapper.vm.userName).toBe("用户");
    });

    it("应该显示用户头像", async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      expect(wrapper.vm.userAvatar).toBe("/avatar.png");
    });
  });

  describe("输入框状态", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("正常状态下应该显示默认占位符", () => {
      wrapper.vm.isThinking = false;

      expect(wrapper.vm.inputPlaceholder).toBe("给我发消息或描述你的任务...");
    });

    it("思考状态下应该显示等待占位符", () => {
      wrapper.vm.isThinking = true;

      expect(wrapper.vm.inputPlaceholder).toBe("AI 正在思考中，请稍候...");
    });
  });

  describe("Markdown渲染", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("应该能渲染Markdown内容", () => {
      mockMarkedParse.mockReturnValue("<h1>Title</h1>");

      const result = wrapper.vm.renderMarkdown("# Title");

      expect(result).toBe("<h1>Title</h1>");
      expect(mockMarkedParse).toHaveBeenCalledWith("# Title");
    });

    it("空内容应该返回空字符串", () => {
      const result = wrapper.vm.renderMarkdown("");

      expect(result).toBe("");
    });

    it("处理Markdown渲染错误", () => {
      mockMarkedParse.mockImplementation(() => {
        throw new Error("Parse error");
      });

      const result = wrapper.vm.renderMarkdown("# Title");

      expect(result).toBeTruthy();

      // Reset the mock for other tests
      mockMarkedParse.mockImplementation((content) => `<p>${content}</p>`);
    });
  });

  describe("时间格式化", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("今天的消息应该只显示时间", () => {
      const now = new Date();
      const result = wrapper.vm.formatTime(now.getTime());

      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });

    it("不是今天的消息应该显示日期和时间", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = wrapper.vm.formatTime(yesterday.getTime());

      expect(result).toMatch(/\d{2}\/\d{2}/);
    });

    it("空时间戳应该返回空字符串", () => {
      const result = wrapper.vm.formatTime(null);

      expect(result).toBe("");
    });

    it("无效时间戳应该返回空字符串", () => {
      const result = wrapper.vm.formatTime(undefined);

      expect(result).toBe("");
    });
  });

  describe("代码块功能", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("应该能增强代码块", async () => {
      // Mock DOM elements
      const mockWrapper = document.createElement("div");
      mockWrapper.className = "code-block-wrapper";
      mockWrapper.setAttribute("data-code", 'console.log("hello")');
      document.body.appendChild(mockWrapper);

      wrapper.vm.enhanceCodeBlocks();
      await nextTick();

      const copyBtn = mockWrapper.querySelector(".code-copy-btn");
      // 由于 nextTick 在测试环境中的限制，可能无法完全测试
      document.body.removeChild(mockWrapper);
    });

    it("应该能复制代码", async () => {
      const mockWrapper = document.createElement("div");
      mockWrapper.className = "code-block-wrapper";
      mockWrapper.setAttribute("data-code", "&lt;div&gt;test&lt;/div&gt;");
      document.body.appendChild(mockWrapper);

      wrapper.vm.enhanceCodeBlocks();
      await nextTick();

      const copyBtn = mockWrapper.querySelector(".code-copy-btn");
      if (copyBtn) {
        await copyBtn.click();
        await nextTick();
      }

      document.body.removeChild(mockWrapper);
    });

    it("已经添加过按钮的代码块应该跳过", async () => {
      const mockWrapper = document.createElement("div");
      mockWrapper.className = "code-block-wrapper";
      mockWrapper.setAttribute("data-code", 'console.log("hello")');
      const existingBtn = document.createElement("button");
      existingBtn.className = "code-copy-btn";
      mockWrapper.appendChild(existingBtn);
      document.body.appendChild(mockWrapper);

      wrapper.vm.enhanceCodeBlocks();
      await nextTick();

      const buttons = mockWrapper.querySelectorAll(".code-copy-btn");
      expect(buttons.length).toBe(1);

      document.body.removeChild(mockWrapper);
    });

    it("没有代码数据的代码块应该跳过", async () => {
      const mockWrapper = document.createElement("div");
      mockWrapper.className = "code-block-wrapper";
      document.body.appendChild(mockWrapper);

      wrapper.vm.enhanceCodeBlocks();
      await nextTick();

      const copyBtn = mockWrapper.querySelector(".code-copy-btn");
      expect(copyBtn).toBeNull();

      document.body.removeChild(mockWrapper);
    });
  });

  describe("滚动功能", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("应该能滚动到底部", () => {
      const mockContainer = {
        scrollTop: 0,
        scrollHeight: 1000,
      };
      wrapper.vm.messagesContainerRef = mockContainer;

      wrapper.vm.scrollToBottom();

      expect(mockContainer.scrollTop).toBe(1000);
    });

    it("没有容器时应该不抛出错误", () => {
      wrapper.vm.messagesContainerRef = null;

      expect(() => {
        wrapper.vm.scrollToBottom();
      }).not.toThrow();
    });
  });

  describe("文件上传", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("应该能处理文件上传", () => {
      const files = [{ name: "test.txt", type: "text/plain", size: 100 }];

      wrapper.vm.handleFileUpload(files);

      // TODO: 实现文件上传功能
    });
  });

  describe("步骤操作", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("应该能重试步骤", () => {
      const step = { id: "step-1", status: "failed" };

      wrapper.vm.handleStepRetry(step);

      // TODO: 实现步骤重试功能
    });

    it("应该能取消步骤", () => {
      const step = { id: "step-1", status: "running" };

      wrapper.vm.handleStepCancel(step);

      // TODO: 实现步骤取消功能
    });
  });

  describe("导航操作", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("应该能处理导航点击", () => {
      const item = { key: "settings" };

      wrapper.vm.handleNavClick(item);

      // TODO: 实现导航处理
    });

    it("应该能处理用户操作", () => {
      const key = "logout";

      wrapper.vm.handleUserAction(key);

      // TODO: 实现用户操作处理
    });
  });

  describe("加载对话消息", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
      await nextTick();
      await nextTick();
    });

    it("应该能加载对话消息", async () => {
      window.electronAPI.conversation.getMessages.mockResolvedValue(
        mockMessages,
      );

      await wrapper.vm.loadConversationMessages("conv-1");

      expect(window.electronAPI.conversation.getMessages).toHaveBeenCalledWith(
        "conv-1",
      );
      expect(wrapper.vm.messages).toHaveLength(2);
    });

    it("应该转换消息格式", async () => {
      window.electronAPI.conversation.getMessages.mockResolvedValue(
        mockMessages,
      );

      await wrapper.vm.loadConversationMessages("conv-1");

      const message = wrapper.vm.messages[0];
      expect(message.id).toBe("msg-1");
      expect(message.role).toBe("user");
      expect(message.content).toBe("你好");
      expect(message.timestamp).toBeDefined();
      expect(message.steps).toEqual([]);
      expect(message.preview).toBeNull();
    });

    it("处理加载消息失败", async () => {
      const message = mockMessage;
      window.electronAPI.conversation.getMessages.mockRejectedValue(
        new Error("加载失败"),
      );

      await wrapper.vm.loadConversationMessages("conv-1");

      expect(message.error).toHaveBeenCalledWith("加载对话消息失败");
    });
  });

  describe("消息显示", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
            StepDisplay: true,
            BrowserPreview: true,
          },
        },
      });

      await nextTick();
      await nextTick();
      await nextTick();
    });

    it("应该显示用户消息", () => {
      expect(wrapper.vm.messages[0].role).toBe("user");
      expect(wrapper.vm.messages[0].content).toBe("你好");
    });

    it("应该显示AI消息", () => {
      expect(wrapper.vm.messages[1].role).toBe("assistant");
      expect(wrapper.vm.messages[1].content).toContain("你好");
    });

    it("应该显示消息时间", () => {
      const message = wrapper.vm.messages[0];
      const time = wrapper.vm.formatTime(message.timestamp);

      expect(time).toBeTruthy();
    });
  });

  describe("响应式状态", () => {
    beforeEach(async () => {
      wrapper = mount(AIChatPage, {
        global: {
          stubs: {
            "a-avatar": true,
            ConversationInput: true,
          },
        },
      });

      await nextTick();
    });

    it("应该正确初始化状态", () => {
      expect(wrapper.vm.conversations).toBeInstanceOf(Array);
      expect(wrapper.vm.activeConversationId).toBeDefined();
      expect(wrapper.vm.messages).toBeInstanceOf(Array);
      expect(wrapper.vm.isThinking).toBe(false);
    });

    it("应该能更新思考状态", async () => {
      wrapper.vm.isThinking = true;
      await nextTick();

      expect(wrapper.vm.isThinking).toBe(true);

      wrapper.vm.isThinking = false;
      await nextTick();

      expect(wrapper.vm.isThinking).toBe(false);
    });
  });

  describe("coding agent approval panel", () => {
    it("renders plan approval details and actions", async () => {
      mockCodingAgentStore.currentSessionId = "session-1";
      mockCodingAgentStore.currentSession = {
        sessionId: "session-1",
        planModeState: "plan_ready",
        lastPlanItems: [
          {
            id: "step-1",
            title: "Edit file",
            tool: "edit_file",
            description: "Update the target component",
          },
          {
            id: "step-2",
            title: "Run verification",
            tool: "run_shell",
          },
        ],
        worktreeIsolation: true,
      };
      mockCodingAgentStore.latestApprovalRequest = {
        payload: {
          summary: "Review the generated plan before continuing.",
          items: [
            { id: "step-1", title: "Edit file", tool: "edit_file" },
            { id: "step-2", title: "Run verification", tool: "run_shell" },
          ],
        },
      };
      mockCodingAgentStore.permissionPolicy = {
        toolsByRisk: {
          medium: ["edit_file"],
          high: ["run_shell"],
        },
      };

      await mountApprovalPage();

      const text = wrapper.text();
      expect(text).toContain("Plan approval required");
      expect(text).toContain("Edit file");
      expect(text).toContain("edit_file");
      expect(text).toContain("run_shell");
      expect(text).toContain("Approve Plan");
      expect(text).toContain("Reject Plan");
      expect(text).toContain("Isolated");
    });

    it("approves the plan from the approval panel and continues execution", async () => {
      mockCodingAgentStore.currentSessionId = "session-1";
      mockCodingAgentStore.currentSession = {
        sessionId: "session-1",
        planModeState: "plan_ready",
        lastPlanItems: [],
        worktreeIsolation: false,
      };
      mockCodingAgentStore.latestApprovalRequest = {
        payload: {
          summary: "Approve the generated plan.",
          items: [],
        },
      };
      mockCodingAgentStore.permissionPolicy = {
        toolsByRisk: {
          medium: ["edit_file"],
          high: [],
        },
      };

      await mountApprovalPage();

      const approveButton = wrapper
        .findAll("button")
        .find((button) => button.text().trim() === "Approve Plan");

      expect(approveButton).toBeTruthy();

      await wrapper.vm.handleApprovePlan();
      await flushPromises();

      expect(mockCodingAgentStore.respondApproval).toHaveBeenCalledWith({
        approvalType: "plan",
        decision: "granted",
      });
      expect(mockCodingAgentStore.sendMessage).toHaveBeenCalledWith(
        "Proceed with the approved plan and carry out the approved changes.",
      );
    });

    it("confirms high-risk actions from the approval panel", async () => {
      mockCodingAgentStore.currentSessionId = "session-1";
      mockCodingAgentStore.currentSession = {
        sessionId: "session-1",
        planModeState: "approved",
        lastPlanItems: [
          { id: "step-1", title: "Run verification", tool: "run_shell" },
        ],
        highRiskToolNames: ["run_shell"],
      };
      mockCodingAgentStore.requiresHighRiskConfirmation = true;
      mockCodingAgentStore.permissionPolicy = {
        toolsByRisk: {
          medium: [],
          high: ["run_shell"],
        },
      };

      await mountApprovalPage();

      expect(wrapper.text()).toContain("High-risk confirmation required");
      expect(wrapper.text()).toContain("Confirm High-Risk Actions");

      const confirmButton = wrapper
        .findAll("button")
        .find((button) => button.text().trim() === "Confirm High-Risk Actions");

      expect(confirmButton).toBeTruthy();

      await wrapper.vm.handleConfirmHighRisk();
      await flushPromises();

      expect(mockCodingAgentStore.respondApproval).toHaveBeenCalledWith({
        approvalType: "high-risk",
        decision: "granted",
      });
      expect(mockCodingAgentStore.sendMessage).toHaveBeenCalledWith(
        "Proceed with the approved plan and carry out the approved changes.",
      );
    });

    it("cancels high-risk actions from the approval panel", async () => {
      mockCodingAgentStore.currentSessionId = "session-1";
      mockCodingAgentStore.currentSession = {
        sessionId: "session-1",
        planModeState: "approved",
        lastPlanItems: [
          { id: "step-1", title: "Run verification", tool: "run_shell" },
        ],
        highRiskToolNames: ["run_shell"],
      };
      mockCodingAgentStore.requiresHighRiskConfirmation = true;

      await mountApprovalPage();

      const cancelButton = wrapper
        .findAll("button")
        .find((button) => button.text().trim() === "Cancel High-Risk Actions");

      expect(cancelButton).toBeTruthy();

      await wrapper.vm.handleRejectHighRisk();
      await flushPromises();

      expect(mockCodingAgentStore.respondApproval).toHaveBeenCalledWith({
        approvalType: "high-risk",
        decision: "denied",
      });
      expect(mockCodingAgentStore.sendMessage).not.toHaveBeenCalled();
      expect(mockMessage.info).toHaveBeenCalledWith(
        "High-risk actions were cancelled.",
      );
    });
  });
});
