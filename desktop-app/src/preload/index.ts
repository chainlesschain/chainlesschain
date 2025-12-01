import { contextBridge, ipcRenderer } from 'electron';

// 定义暴露给渲染进程的API
const api = {
  // U盾相关操作
  ukey: {
    detect: () => ipcRenderer.invoke('ukey:detect'),
    verifyPIN: (pin: string) => ipcRenderer.invoke('ukey:verify-pin', pin),
    sign: (data: string) => ipcRenderer.invoke('ukey:sign', data),
    verifySignature: (data: string, signature: string) =>
      ipcRenderer.invoke('ukey:verify-signature', data, signature),
  },

  // 数据库/知识库操作
  knowledge: {
    getItems: (limit?: number, offset?: number) =>
      ipcRenderer.invoke('db:get-knowledge-items', limit, offset),
    addItem: (item: any) =>
      ipcRenderer.invoke('db:add-knowledge-item', item),
    updateItem: (id: string, updates: any) =>
      ipcRenderer.invoke('db:update-knowledge-item', id, updates),
    deleteItem: (id: string) =>
      ipcRenderer.invoke('db:delete-knowledge-item', id),
    searchItems: (query: string) =>
      ipcRenderer.invoke('db:search-knowledge-items', query),
    getItemById: (id: string) =>
      ipcRenderer.invoke('db:get-knowledge-item-by-id', id),
  },

  // Git同步操作
  git: {
    sync: () => ipcRenderer.invoke('git:sync'),
    commit: (message: string) => ipcRenderer.invoke('git:commit', message),
    getStatus: () => ipcRenderer.invoke('git:status'),
  },

  // LLM服务操作
  llm: {
    query: (prompt: string, context?: string[]) =>
      ipcRenderer.invoke('llm:query', prompt, context),
    queryStream: (prompt: string, context?: string[], onChunk?: (chunk: string) => void) => {
      const channel = `llm:query-stream-${Date.now()}`;

      if (onChunk) {
        ipcRenderer.on(channel, (_event, chunk: string) => {
          onChunk(chunk);
        });
      }

      return ipcRenderer.invoke('llm:query-stream', prompt, context, channel);
    },
    checkStatus: () => ipcRenderer.invoke('llm:check-status'),
  },

  // 系统操作
  system: {
    getVersion: () => ipcRenderer.invoke('system:get-version'),
    minimize: () => ipcRenderer.invoke('system:minimize'),
    maximize: () => ipcRenderer.invoke('system:maximize'),
    close: () => ipcRenderer.invoke('system:close'),
  },
};

// 通过contextBridge暴露API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', api);

// 类型定义导出(供renderer使用)
export type ElectronAPI = typeof api;
