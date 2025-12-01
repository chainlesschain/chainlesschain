// 知识库项类型
export interface KnowledgeItem {
  id: string;
  title: string;
  type: 'note' | 'document' | 'conversation' | 'web_clip';
  content_path: string | null;
  embedding_path: string | null;
  created_at: number;
  updated_at: number;
  git_commit_hash: string | null;
  device_id: string | null;
  sync_status: 'synced' | 'pending' | 'conflict';
  tags?: Tag[];
  content?: string; // 运行时加载的内容
}

// 标签类型
export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: number;
}

// 知识库项-标签关联
export interface KnowledgeTag {
  knowledge_id: string;
  tag_id: string;
  created_at: number;
}

// 查询模板类型
export interface QueryTemplate {
  id: string;
  name: string;
  template: string;
  category: string;
  created_at: number;
}

// 对话类型
export interface Conversation {
  id: string;
  title: string;
  knowledge_id: string | null;
  messages: Message[];
  created_at: number;
  updated_at: number;
}

// 消息类型
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokens?: number;
}

// 设备类型
export interface Device {
  id: string;
  name: string;
  type: 'desktop' | 'mobile';
  public_key: string;
  last_sync: number;
  created_at: number;
}

// U盾状态
export interface UKeyStatus {
  detected: boolean;
  unlocked: boolean;
  deviceId?: string;
  publicKey?: string;
}

// Git同步状态
export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  untracked: string[];
  lastSync: number | null;
}

// LLM响应
export interface LLMResponse {
  text: string;
  model: string;
  tokens: number;
  timestamp?: number;
}

// LLM服务状态
export interface LLMServiceStatus {
  available: boolean;
  models: string[];
  currentModel?: string;
  error?: string;
}

// 用户状态
export interface UserState {
  isAuthenticated: boolean;
  ukeyStatus: UKeyStatus;
  deviceId: string | null;
}

// 应用配置
export interface AppConfig {
  theme: 'light' | 'dark';
  llmModel: string;
  gitRemote: string | null;
  autoSync: boolean;
  syncInterval: number; // 分钟
}

// 搜索结果
export interface SearchResult {
  item: KnowledgeItem;
  score: number;
  highlights: string[];
}

// IPC响应包装
export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// 创建知识库项的输入
export interface CreateKnowledgeItemInput {
  title: string;
  type: KnowledgeItem['type'];
  content?: string;
  tags?: string[];
}

// 更新知识库项的输入
export interface UpdateKnowledgeItemInput {
  title?: string;
  content?: string;
  tags?: string[];
}
