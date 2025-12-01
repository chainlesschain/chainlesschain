"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// 定义暴露给渲染进程的API
const api = {
    // U盾相关操作
    ukey: {
        detect: () => electron_1.ipcRenderer.invoke('ukey:detect'),
        verifyPIN: (pin) => electron_1.ipcRenderer.invoke('ukey:verify-pin', pin),
        sign: (data) => electron_1.ipcRenderer.invoke('ukey:sign', data),
        verifySignature: (data, signature) => electron_1.ipcRenderer.invoke('ukey:verify-signature', data, signature),
    },
    // 数据库/知识库操作
    knowledge: {
        getItems: (limit, offset) => electron_1.ipcRenderer.invoke('db:get-knowledge-items', limit, offset),
        addItem: (item) => electron_1.ipcRenderer.invoke('db:add-knowledge-item', item),
        updateItem: (id, updates) => electron_1.ipcRenderer.invoke('db:update-knowledge-item', id, updates),
        deleteItem: (id) => electron_1.ipcRenderer.invoke('db:delete-knowledge-item', id),
        searchItems: (query) => electron_1.ipcRenderer.invoke('db:search-knowledge-items', query),
        getItemById: (id) => electron_1.ipcRenderer.invoke('db:get-knowledge-item-by-id', id),
    },
    // Git同步操作
    git: {
        sync: () => electron_1.ipcRenderer.invoke('git:sync'),
        commit: (message) => electron_1.ipcRenderer.invoke('git:commit', message),
        getStatus: () => electron_1.ipcRenderer.invoke('git:status'),
    },
    // LLM服务操作
    llm: {
        query: (prompt, context) => electron_1.ipcRenderer.invoke('llm:query', prompt, context),
        queryStream: (prompt, context, onChunk) => {
            const channel = `llm:query-stream-${Date.now()}`;
            if (onChunk) {
                electron_1.ipcRenderer.on(channel, (_event, chunk) => {
                    onChunk(chunk);
                });
            }
            return electron_1.ipcRenderer.invoke('llm:query-stream', prompt, context, channel);
        },
        checkStatus: () => electron_1.ipcRenderer.invoke('llm:check-status'),
    },
    // 系统操作
    system: {
        getVersion: () => electron_1.ipcRenderer.invoke('system:get-version'),
        minimize: () => electron_1.ipcRenderer.invoke('system:minimize'),
        maximize: () => electron_1.ipcRenderer.invoke('system:maximize'),
        close: () => electron_1.ipcRenderer.invoke('system:close'),
    },
};
// 通过contextBridge暴露API到渲染进程
electron_1.contextBridge.exposeInMainWorld('electronAPI', api);
//# sourceMappingURL=index.js.map