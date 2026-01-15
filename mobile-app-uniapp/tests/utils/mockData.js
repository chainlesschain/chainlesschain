/**
 * 测试用的模拟数据
 */

export const mockKnowledgeItem = {
  id: 1,
  title: '测试知识条目',
  content: '这是一个测试知识条目的内容',
  type: 'note',
  folder_id: null,
  is_favorite: 0,
  created_at: Date.now(),
  updated_at: Date.now()
}

export const mockKnowledgeItems = [
  {
    id: 1,
    title: 'JavaScript基础',
    content: 'JavaScript是一种编程语言',
    type: 'note',
    folder_id: null,
    is_favorite: 1,
    created_at: Date.now() - 86400000,
    updated_at: Date.now() - 86400000
  },
  {
    id: 2,
    title: 'Vue3教程',
    content: 'Vue3是一个渐进式框架',
    type: 'document',
    folder_id: 1,
    is_favorite: 0,
    created_at: Date.now() - 172800000,
    updated_at: Date.now() - 172800000
  },
  {
    id: 3,
    title: 'AI对话记录',
    content: '与AI的对话内容',
    type: 'conversation',
    folder_id: null,
    is_favorite: 0,
    created_at: Date.now() - 259200000,
    updated_at: Date.now() - 259200000
  }
]

export const mockTag = {
  id: 1,
  name: '编程',
  color: '#1890ff',
  created_at: Date.now()
}

export const mockTags = [
  { id: 1, name: '编程', color: '#1890ff', created_at: Date.now() },
  { id: 2, name: '学习', color: '#52c41a', created_at: Date.now() },
  { id: 3, name: '工作', color: '#faad14', created_at: Date.now() }
]

export const mockConversation = {
  id: 1,
  title: 'AI助手对话',
  knowledge_id: null,
  created_at: Date.now(),
  updated_at: Date.now()
}

export const mockMessage = {
  id: 1,
  conversation_id: 1,
  role: 'user',
  content: '你好，请介绍一下JavaScript',
  tokens: 0,
  timestamp: Date.now()
}

export const mockMessages = [
  {
    id: 1,
    conversation_id: 1,
    role: 'user',
    content: '你好',
    tokens: 0,
    timestamp: Date.now() - 60000
  },
  {
    id: 2,
    conversation_id: 1,
    role: 'assistant',
    content: '你好！有什么我可以帮助你的吗？',
    tokens: 15,
    timestamp: Date.now() - 50000
  }
]

export const mockProject = {
  id: 1,
  name: '测试项目',
  description: '这是一个测试项目',
  type: 'code',
  status: 'active',
  created_at: Date.now(),
  updated_at: Date.now()
}

export const mockProjects = [
  {
    id: 1,
    name: 'Web应用开发',
    description: '开发一个Web应用',
    type: 'code',
    status: 'active',
    created_at: Date.now() - 86400000,
    updated_at: Date.now() - 86400000
  },
  {
    id: 2,
    name: '研究报告',
    description: '撰写研究报告',
    type: 'research',
    status: 'active',
    created_at: Date.now() - 172800000,
    updated_at: Date.now() - 172800000
  }
]

export const mockFolder = {
  id: 1,
  name: '前端开发',
  icon: '📁',
  parent_id: null,
  created_at: Date.now()
}

export const mockFolders = [
  { id: 1, name: '前端开发', icon: '📁', parent_id: null, created_at: Date.now() },
  { id: 2, name: 'JavaScript', icon: '📄', parent_id: 1, created_at: Date.now() },
  { id: 3, name: '后端开发', icon: '📁', parent_id: null, created_at: Date.now() }
]

export const mockDIDIdentity = {
  id: 1,
  did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  nickname: '测试用户',
  avatar: null,
  public_key: 'mock_public_key',
  private_key_encrypted: 'mock_encrypted_private_key',
  is_current: 1,
  created_at: Date.now()
}

export const mockFriend = {
  id: 1,
  friend_did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  nickname: '好友1',
  avatar: null,
  status: 'accepted',
  created_at: Date.now()
}

export const mockPost = {
  id: 1,
  author_did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  content: '这是一条测试动态',
  images: [],
  likes_count: 5,
  comments_count: 2,
  created_at: Date.now()
}

export const mockLLMConfig = {
  provider: 'openai',
  apiKey: 'sk-test-key',
  model: 'gpt-3.5-turbo',
  baseURL: 'https://api.openai.com/v1',
  temperature: 0.7,
  maxTokens: 2000
}

export const mockLLMResponse = {
  content: '这是AI的回复内容',
  tokens: 50,
  model: 'gpt-3.5-turbo'
}
