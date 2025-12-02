const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // U盾相关
  ukey: {
    detect: () => ipcRenderer.invoke('ukey:detect'),
    verifyPIN: (pin) => ipcRenderer.invoke('ukey:verify-pin', pin),
  },

  // 数据库操作
  db: {
    getKnowledgeItems: (limit, offset) => ipcRenderer.invoke('db:get-knowledge-items', limit, offset),
    getKnowledgeItemById: (id) => ipcRenderer.invoke('db:get-knowledge-item-by-id', id),
    addKnowledgeItem: (item) => ipcRenderer.invoke('db:add-knowledge-item', item),
    updateKnowledgeItem: (id, updates) => ipcRenderer.invoke('db:update-knowledge-item', id, updates),
    deleteKnowledgeItem: (id) => ipcRenderer.invoke('db:delete-knowledge-item', id),
    searchKnowledgeItems: (query) => ipcRenderer.invoke('db:search-knowledge-items', query),
    getAllTags: () => ipcRenderer.invoke('db:get-all-tags'),
    createTag: (name, color) => ipcRenderer.invoke('db:create-tag', name, color),
    getKnowledgeTags: (knowledgeId) => ipcRenderer.invoke('db:get-knowledge-tags', knowledgeId),
    getStatistics: () => ipcRenderer.invoke('db:get-statistics'),
    getPath: () => ipcRenderer.invoke('db:get-path'),
    backup: (backupPath) => ipcRenderer.invoke('db:backup', backupPath),
  },

  // LLM服务
  llm: {
    checkStatus: () => ipcRenderer.invoke('llm:check-status'),
    query: (prompt, options) => ipcRenderer.invoke('llm:query', prompt, options),
    queryStream: (prompt, options) => ipcRenderer.invoke('llm:query-stream', prompt, options),
    getConfig: () => ipcRenderer.invoke('llm:get-config'),
    setConfig: (config) => ipcRenderer.invoke('llm:set-config', config),
    listModels: () => ipcRenderer.invoke('llm:list-models'),
    clearContext: (conversationId) => ipcRenderer.invoke('llm:clear-context', conversationId),
    embeddings: (text) => ipcRenderer.invoke('llm:embeddings', text),
    // 事件监听
    on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // Git同步
  git: {
    status: () => ipcRenderer.invoke('git:status'),
    sync: () => ipcRenderer.invoke('git:sync'),
    push: () => ipcRenderer.invoke('git:push'),
    pull: () => ipcRenderer.invoke('git:pull'),
    getLog: (depth) => ipcRenderer.invoke('git:get-log', depth),
    getConfig: () => ipcRenderer.invoke('git:get-config'),
    setConfig: (config) => ipcRenderer.invoke('git:set-config', config),
    setRemote: (url) => ipcRenderer.invoke('git:set-remote', url),
    setAuth: (auth) => ipcRenderer.invoke('git:set-auth', auth),
    exportMarkdown: () => ipcRenderer.invoke('git:export-markdown'),
    // 事件监听
    on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // RAG - 知识库检索增强
  rag: {
    retrieve: (query, options) => ipcRenderer.invoke('rag:retrieve', query, options),
    enhanceQuery: (query, options) => ipcRenderer.invoke('rag:enhance-query', query, options),
    rebuildIndex: () => ipcRenderer.invoke('rag:rebuild-index'),
    getStats: () => ipcRenderer.invoke('rag:get-stats'),
    updateConfig: (config) => ipcRenderer.invoke('rag:update-config', config),
  },

  // 系统操作
  system: {
    getVersion: () => ipcRenderer.invoke('system:get-version'),
    minimize: () => ipcRenderer.invoke('system:minimize'),
    maximize: () => ipcRenderer.invoke('system:maximize'),
    close: () => ipcRenderer.invoke('system:close'),
  },
});
