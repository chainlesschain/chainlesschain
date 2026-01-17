/**
 * E2E 测试数据 Fixtures
 * 提供测试所需的模拟数据
 */

// 测试用户数据
export const testUser = {
  pin: '123456',
  username: 'testuser',
  nickname: '测试用户',
};

// 测试知识条目
export const testKnowledge = {
  title: 'E2E 测试知识条目',
  content: `# 测试标题

这是一个用于 E2E 测试的知识条目。

## 功能测试

- 创建知识
- 编辑知识
- 删除知识
- 搜索知识

## 代码示例

\`\`\`javascript
console.log('Hello, E2E Test!');
\`\`\`
`,
  tags: ['测试', 'E2E', '自动化'],
  folder: '测试文件夹',
};

// 测试项目数据
export const testProject = {
  name: 'E2E 测试项目',
  description: '这是一个用于 E2E 测试的项目',
  type: 'personal',
  status: 'active',
};

// 测试聊天消息
export const testChatMessages = [
  {
    role: 'user',
    content: '你好，请介绍一下自己',
  },
  {
    role: 'assistant',
    content: '你好！我是 ChainlessChain 的 AI 助手，可以帮助你管理知识库、回答问题等。',
  },
];

// 测试好友数据
export const testFriend = {
  did: 'did:example:test123',
  nickname: '测试好友',
  avatar: '',
};

// 测试设置数据
export const testSettings = {
  theme: 'light',
  language: 'zh-CN',
  fontSize: 'medium',
  autoBackup: true,
  backupInterval: 'daily',
};

// 模拟 API 响应
export const mockApiResponses = {
  // 知识库列表
  knowledgeList: {
    success: true,
    data: [
      {
        id: 1,
        title: '测试知识 1',
        content: '内容 1',
        tags: ['标签1'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 2,
        title: '测试知识 2',
        content: '内容 2',
        tags: ['标签2'],
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      },
    ],
  },

  // 项目列表
  projectList: {
    success: true,
    data: [
      {
        id: 1,
        name: '项目 1',
        description: '描述 1',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 2,
        name: '项目 2',
        description: '描述 2',
        status: 'completed',
        createdAt: '2024-01-02T00:00:00Z',
      },
    ],
  },

  // AI 聊天响应
  aiChatResponse: {
    success: true,
    data: {
      message: '这是 AI 的回复内容',
      conversationId: 'conv-123',
    },
  },
};

// 页面路径常量
export const routes = {
  home: '/pages/index/index',
  login: '/pages/login/login',
  knowledgeList: '/pages/knowledge/list/list',
  knowledgeDetail: '/pages/knowledge/detail/detail',
  knowledgeEdit: '/pages/knowledge/edit/edit',
  chat: '/pages/chat/chat',
  projectList: '/pages/projects/list',
  projectDetail: '/pages/projects/detail',
  projectCreate: '/pages/projects/create',
  settings: '/pages/settings/settings',
  mine: '/pages/mine/mine',
  friends: '/pages/social/friends/friends',
  posts: '/pages/social/posts/posts',
  messages: '/pages/messages/index',
  setupPin: '/pages/auth/setup-pin',
  verifyPin: '/pages/auth/verify-pin',
  devicePairing: '/pages/device-pairing/index',
  backup: '/pages/backup/backup',
  identity: '/pages/identity/list',
};

// 选择器常量
export const selectors = {
  // 通用
  loading: '.uni-loading',
  toast: '.uni-toast',
  modal: '.uni-modal',
  tabBar: '.uni-tabbar',
  tabBarItem: '.uni-tabbar__item',
  navBar: '.uni-navbar',
  backButton: '.uni-navbar__left',

  // 列表
  listItem: '.list-item, .knowledge-item, .project-item',
  emptyState: '.empty-state, .no-data',
  pullRefresh: '.uni-scroll-view-refresh',

  // 表单
  input: 'input, .uni-input',
  textarea: 'textarea, .uni-textarea',
  button: 'button, .uni-button',
  checkbox: '.uni-checkbox',
  switch: '.uni-switch',

  // 知识库
  knowledgeCard: '.knowledge-card, .note-card',
  knowledgeTitle: '.knowledge-title, .note-title',
  knowledgeContent: '.knowledge-content, .note-content',
  tagList: '.tag-list, .tags',
  tag: '.tag, .tag-item',

  // 聊天
  chatInput: '.chat-input, .message-input',
  chatSendButton: '.send-button, .send-btn',
  chatMessage: '.chat-message, .message-item',
  chatBubble: '.message-bubble, .chat-bubble',

  // 项目
  projectCard: '.project-card',
  projectName: '.project-name',
  projectStatus: '.project-status',

  // 设置
  settingItem: '.setting-item, .settings-item',
  settingSwitch: '.setting-switch',
};
