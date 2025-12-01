import type { ElectronAPI } from '../../preload';
import type {
  KnowledgeItem,
  UKeyStatus,
  GitStatus,
  LLMResponse,
  LLMServiceStatus,
  CreateKnowledgeItemInput,
  UpdateKnowledgeItemInput,
} from '@shared/types';

// 声明全局window对象上的electronAPI
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// 获取Electron API
const api = window.electronAPI;

// U盾相关API
export const ukeyAPI = {
  detect: async (): Promise<UKeyStatus> => {
    try {
      const result = await api.ukey.detect();
      return result;
    } catch (error) {
      console.error('U盾检测失败:', error);
      return { detected: false, unlocked: false };
    }
  },

  verifyPIN: async (pin: string): Promise<boolean> => {
    try {
      const result = await api.ukey.verifyPIN(pin);
      return result;
    } catch (error) {
      console.error('PIN验证失败:', error);
      return false;
    }
  },

  sign: async (data: string): Promise<string | null> => {
    try {
      const signature = await api.ukey.sign(data);
      return signature;
    } catch (error) {
      console.error('签名失败:', error);
      return null;
    }
  },

  verifySignature: async (data: string, signature: string): Promise<boolean> => {
    try {
      const result = await api.ukey.verifySignature(data, signature);
      return result;
    } catch (error) {
      console.error('签名验证失败:', error);
      return false;
    }
  },
};

// 知识库相关API
export const knowledgeAPI = {
  getItems: async (limit = 100, offset = 0): Promise<KnowledgeItem[]> => {
    try {
      const items = await api.knowledge.getItems(limit, offset);
      return items || [];
    } catch (error) {
      console.error('获取知识库项失败:', error);
      return [];
    }
  },

  getItemById: async (id: string): Promise<KnowledgeItem | null> => {
    try {
      const item = await api.knowledge.getItemById(id);
      return item;
    } catch (error) {
      console.error('获取知识库项失败:', error);
      return null;
    }
  },

  addItem: async (input: CreateKnowledgeItemInput): Promise<KnowledgeItem | null> => {
    try {
      const item = await api.knowledge.addItem(input);
      return item;
    } catch (error) {
      console.error('添加知识库项失败:', error);
      return null;
    }
  },

  updateItem: async (id: string, updates: UpdateKnowledgeItemInput): Promise<boolean> => {
    try {
      await api.knowledge.updateItem(id, updates);
      return true;
    } catch (error) {
      console.error('更新知识库项失败:', error);
      return false;
    }
  },

  deleteItem: async (id: string): Promise<boolean> => {
    try {
      await api.knowledge.deleteItem(id);
      return true;
    } catch (error) {
      console.error('删除知识库项失败:', error);
      return false;
    }
  },

  searchItems: async (query: string): Promise<KnowledgeItem[]> => {
    try {
      const items = await api.knowledge.searchItems(query);
      return items || [];
    } catch (error) {
      console.error('搜索知识库项失败:', error);
      return [];
    }
  },
};

// Git同步相关API
export const gitAPI = {
  sync: async (): Promise<boolean> => {
    try {
      await api.git.sync();
      return true;
    } catch (error) {
      console.error('Git同步失败:', error);
      return false;
    }
  },

  commit: async (message: string): Promise<string | null> => {
    try {
      const hash = await api.git.commit(message);
      return hash;
    } catch (error) {
      console.error('Git提交失败:', error);
      return null;
    }
  },

  getStatus: async (): Promise<GitStatus | null> => {
    try {
      const status = await api.git.getStatus();
      return status;
    } catch (error) {
      console.error('获取Git状态失败:', error);
      return null;
    }
  },
};

// LLM服务相关API
export const llmAPI = {
  query: async (prompt: string, context?: string[]): Promise<LLMResponse | null> => {
    try {
      const response = await api.llm.query(prompt, context);
      return response;
    } catch (error) {
      console.error('LLM查询失败:', error);
      return null;
    }
  },

  queryStream: async (
    prompt: string,
    context?: string[],
    onChunk?: (chunk: string) => void
  ): Promise<LLMResponse | null> => {
    try {
      const response = await api.llm.queryStream(prompt, context, onChunk);
      return response;
    } catch (error) {
      console.error('LLM流式查询失败:', error);
      return null;
    }
  },

  checkStatus: async (): Promise<LLMServiceStatus> => {
    try {
      const status = await api.llm.checkStatus();
      return status;
    } catch (error) {
      console.error('检查LLM状态失败:', error);
      return { available: false, models: [], error: String(error) };
    }
  },
};

// 系统相关API
export const systemAPI = {
  getVersion: async (): Promise<string> => {
    try {
      const version = await api.system.getVersion();
      return version;
    } catch (error) {
      console.error('获取版本失败:', error);
      return 'unknown';
    }
  },

  minimize: () => api.system.minimize(),
  maximize: () => api.system.maximize(),
  close: () => api.system.close(),
};
