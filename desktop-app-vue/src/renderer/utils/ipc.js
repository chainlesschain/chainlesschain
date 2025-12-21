// IPC通信封装
const api = window.electronAPI;

// U盾API
export const ukeyAPI = {
  detect: () => api.ukey.detect(),
  verifyPIN: (pin) => api.ukey.verifyPIN(pin),
};

// 认证API
export const authAPI = {
  verifyPassword: (username, password) => api.auth.verifyPassword(username, password),
};

// 数据库API
export const dbAPI = {
  getKnowledgeItems: () => api.db.getKnowledgeItems(),
  getKnowledgeItemById: (id) => api.db.getKnowledgeItemById(id),
  addKnowledgeItem: (item) => api.db.addKnowledgeItem(item),
  updateKnowledgeItem: (id, updates) => api.db.updateKnowledgeItem(id, updates),
  deleteKnowledgeItem: (id) => api.db.deleteKnowledgeItem(id),
  searchKnowledgeItems: (query) => api.db.searchKnowledgeItems(query),
};

// LLM API
export const llmAPI = {
  checkStatus: () => api.llm.checkStatus(),
  query: (prompt, context) => api.llm.query(prompt, context),
};

// Git API
export const gitAPI = {
  status: () => api.git.status(),
};

// 系统API
export const systemAPI = {
  getVersion: () => api.system.getVersion(),
  minimize: () => api.system.minimize(),
  maximize: () => api.system.maximize(),
  close: () => api.system.close(),
};
