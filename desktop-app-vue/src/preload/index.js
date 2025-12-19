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
    // 冲突解决
    getConflicts: () => ipcRenderer.invoke('git:get-conflicts'),
    getConflictContent: (filepath) => ipcRenderer.invoke('git:get-conflict-content', filepath),
    resolveConflict: (filepath, resolution, content) => ipcRenderer.invoke('git:resolve-conflict', filepath, resolution, content),
    abortMerge: () => ipcRenderer.invoke('git:abort-merge'),
    completeMerge: (message) => ipcRenderer.invoke('git:complete-merge', message),
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
    // 重排序功能
    getRerankConfig: () => ipcRenderer.invoke('rag:get-rerank-config'),
    setRerankingEnabled: (enabled) => ipcRenderer.invoke('rag:set-reranking-enabled', enabled),
  },

  // DID身份管理
  did: {
    createIdentity: (profile, options) => ipcRenderer.invoke('did:create-identity', profile, options),
    getAllIdentities: () => ipcRenderer.invoke('did:get-all-identities'),
    getIdentity: (did) => ipcRenderer.invoke('did:get-identity', did),
    getCurrentIdentity: () => ipcRenderer.invoke('did:get-current-identity'),
    setDefaultIdentity: (did) => ipcRenderer.invoke('did:set-default-identity', did),
    updateIdentity: (did, updates) => ipcRenderer.invoke('did:update-identity', did, updates),
    deleteIdentity: (did) => ipcRenderer.invoke('did:delete-identity', did),
    exportDocument: (did) => ipcRenderer.invoke('did:export-document', did),
    generateQRCode: (did) => ipcRenderer.invoke('did:generate-qrcode', did),
    verifyDocument: (document) => ipcRenderer.invoke('did:verify-document', document),
    // DHT操作
    publishToDHT: (did) => ipcRenderer.invoke('did:publish-to-dht', did),
    resolveFromDHT: (did) => ipcRenderer.invoke('did:resolve-from-dht', did),
    unpublishFromDHT: (did) => ipcRenderer.invoke('did:unpublish-from-dht', did),
    isPublishedToDHT: (did) => ipcRenderer.invoke('did:is-published-to-dht', did),
    // 自动重新发布
    startAutoRepublish: (interval) => ipcRenderer.invoke('did:start-auto-republish', interval),
    stopAutoRepublish: () => ipcRenderer.invoke('did:stop-auto-republish'),
    getAutoRepublishStatus: () => ipcRenderer.invoke('did:get-auto-republish-status'),
    setAutoRepublishInterval: (interval) => ipcRenderer.invoke('did:set-auto-republish-interval', interval),
    republishAll: () => ipcRenderer.invoke('did:republish-all'),
    // 助记词管理
    generateMnemonic: (strength) => ipcRenderer.invoke('did:generate-mnemonic', strength),
    validateMnemonic: (mnemonic) => ipcRenderer.invoke('did:validate-mnemonic', mnemonic),
    createFromMnemonic: (profile, mnemonic, options) => ipcRenderer.invoke('did:create-from-mnemonic', profile, mnemonic, options),
    exportMnemonic: (did) => ipcRenderer.invoke('did:export-mnemonic', did),
    hasMnemonic: (did) => ipcRenderer.invoke('did:has-mnemonic', did),
  },

  // 联系人管理
  contact: {
    add: (contact) => ipcRenderer.invoke('contact:add', contact),
    addFromQR: (qrData) => ipcRenderer.invoke('contact:add-from-qr', qrData),
    getAll: () => ipcRenderer.invoke('contact:get-all'),
    get: (did) => ipcRenderer.invoke('contact:get', did),
    update: (did, updates) => ipcRenderer.invoke('contact:update', did, updates),
    delete: (did) => ipcRenderer.invoke('contact:delete', did),
    search: (query) => ipcRenderer.invoke('contact:search', query),
    getFriends: () => ipcRenderer.invoke('contact:get-friends'),
    getStatistics: () => ipcRenderer.invoke('contact:get-statistics'),
  },

  // 好友管理
  friend: {
    sendRequest: (targetDid, message) => ipcRenderer.invoke('friend:send-request', targetDid, message),
    acceptRequest: (requestId) => ipcRenderer.invoke('friend:accept-request', requestId),
    rejectRequest: (requestId) => ipcRenderer.invoke('friend:reject-request', requestId),
    getPendingRequests: () => ipcRenderer.invoke('friend:get-pending-requests'),
    getFriends: (groupName) => ipcRenderer.invoke('friend:get-friends', groupName),
    remove: (friendDid) => ipcRenderer.invoke('friend:remove', friendDid),
    updateNickname: (friendDid, nickname) => ipcRenderer.invoke('friend:update-nickname', friendDid, nickname),
    updateGroup: (friendDid, groupName) => ipcRenderer.invoke('friend:update-group', friendDid, groupName),
    getStatistics: () => ipcRenderer.invoke('friend:get-statistics'),
  },

  // 动态管理
  post: {
    create: (options) => ipcRenderer.invoke('post:create', options),
    getFeed: (options) => ipcRenderer.invoke('post:get-feed', options),
    get: (postId) => ipcRenderer.invoke('post:get', postId),
    delete: (postId) => ipcRenderer.invoke('post:delete', postId),
    like: (postId) => ipcRenderer.invoke('post:like', postId),
    unlike: (postId) => ipcRenderer.invoke('post:unlike', postId),
    getLikes: (postId) => ipcRenderer.invoke('post:get-likes', postId),
    addComment: (postId, content, parentId) => ipcRenderer.invoke('post:add-comment', postId, content, parentId),
    getComments: (postId) => ipcRenderer.invoke('post:get-comments', postId),
    deleteComment: (commentId) => ipcRenderer.invoke('post:delete-comment', commentId),
  },

  // 资产管理
  asset: {
    create: (options) => ipcRenderer.invoke('asset:create', options),
    mint: (assetId, toDid, amount) => ipcRenderer.invoke('asset:mint', assetId, toDid, amount),
    transfer: (assetId, toDid, amount, memo) => ipcRenderer.invoke('asset:transfer', assetId, toDid, amount, memo),
    burn: (assetId, amount) => ipcRenderer.invoke('asset:burn', assetId, amount),
    get: (assetId) => ipcRenderer.invoke('asset:get', assetId),
    getByOwner: (ownerDid) => ipcRenderer.invoke('asset:get-by-owner', ownerDid),
    getAll: (filters) => ipcRenderer.invoke('asset:get-all', filters),
    getHistory: (assetId, limit) => ipcRenderer.invoke('asset:get-history', assetId, limit),
    getBalance: (ownerDid, assetId) => ipcRenderer.invoke('asset:get-balance', ownerDid, assetId),
  },

  // P2P网络
  p2p: {
    getNodeInfo: () => ipcRenderer.invoke('p2p:get-node-info'),
    connect: (multiaddr) => ipcRenderer.invoke('p2p:connect', multiaddr),
    disconnect: (peerId) => ipcRenderer.invoke('p2p:disconnect', peerId),
    getPeers: () => ipcRenderer.invoke('p2p:get-peers'),
    // 加密消息
    sendEncryptedMessage: (peerId, message, deviceId, options) => ipcRenderer.invoke('p2p:send-encrypted-message', peerId, message, deviceId, options),
    hasEncryptedSession: (peerId) => ipcRenderer.invoke('p2p:has-encrypted-session', peerId),
    initiateKeyExchange: (peerId, deviceId) => ipcRenderer.invoke('p2p:initiate-key-exchange', peerId, deviceId),
    // 多设备支持
    getUserDevices: (userId) => ipcRenderer.invoke('p2p:get-user-devices', userId),
    getCurrentDevice: () => ipcRenderer.invoke('p2p:get-current-device'),
    getDeviceStatistics: () => ipcRenderer.invoke('p2p:get-device-statistics'),
    // 设备同步
    getSyncStatistics: () => ipcRenderer.invoke('p2p:get-sync-statistics'),
    getMessageStatus: (messageId) => ipcRenderer.invoke('p2p:get-message-status', messageId),
    startDeviceSync: (deviceId) => ipcRenderer.invoke('p2p:start-device-sync', deviceId),
    stopDeviceSync: (deviceId) => ipcRenderer.invoke('p2p:stop-device-sync', deviceId),
    // 事件监听
    on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // 可验证凭证 (VC)
  vc: {
    create: (params) => ipcRenderer.invoke('vc:create', params),
    getAll: (filters) => ipcRenderer.invoke('vc:get-all', filters),
    get: (id) => ipcRenderer.invoke('vc:get', id),
    verify: (vcDocument) => ipcRenderer.invoke('vc:verify', vcDocument),
    revoke: (id, issuerDID) => ipcRenderer.invoke('vc:revoke', id, issuerDID),
    delete: (id) => ipcRenderer.invoke('vc:delete', id),
    export: (id) => ipcRenderer.invoke('vc:export', id),
    getStatistics: (did) => ipcRenderer.invoke('vc:get-statistics', did),
    generateShareData: (id) => ipcRenderer.invoke('vc:generate-share-data', id),
    importFromShare: (shareData) => ipcRenderer.invoke('vc:import-from-share', shareData),
  },

  // 可验证凭证模板 (VC Templates)
  vcTemplate: {
    getAll: (filters) => ipcRenderer.invoke('vc-template:get-all', filters),
    get: (id) => ipcRenderer.invoke('vc-template:get', id),
    create: (templateData) => ipcRenderer.invoke('vc-template:create', templateData),
    update: (id, updates) => ipcRenderer.invoke('vc-template:update', id, updates),
    delete: (id) => ipcRenderer.invoke('vc-template:delete', id),
    fillValues: (templateId, values) => ipcRenderer.invoke('vc-template:fill-values', templateId, values),
    incrementUsage: (id) => ipcRenderer.invoke('vc-template:increment-usage', id),
    getStatistics: () => ipcRenderer.invoke('vc-template:get-statistics'),
    export: (id) => ipcRenderer.invoke('vc-template:export', id),
    exportMultiple: (ids) => ipcRenderer.invoke('vc-template:export-multiple', ids),
    import: (importData, createdBy, options) => ipcRenderer.invoke('vc-template:import', importData, createdBy, options),
  },

  // 文件导入
  import: {
    selectFiles: () => ipcRenderer.invoke('import:select-files'),
    importFile: (filePath, options) => ipcRenderer.invoke('import:import-file', filePath, options),
    importFiles: (filePaths, options) => ipcRenderer.invoke('import:import-files', filePaths, options),
    getSupportedFormats: () => ipcRenderer.invoke('import:get-supported-formats'),
    checkFile: (filePath) => ipcRenderer.invoke('import:check-file', filePath),
    // 事件监听
    on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // 图片上传和 OCR
  image: {
    selectImages: () => ipcRenderer.invoke('image:select-images'),
    upload: (imagePath, options) => ipcRenderer.invoke('image:upload', imagePath, options),
    uploadBatch: (imagePaths, options) => ipcRenderer.invoke('image:upload-batch', imagePaths, options),
    performOCR: (imagePath) => ipcRenderer.invoke('image:ocr', imagePath),
    getImage: (imageId) => ipcRenderer.invoke('image:get', imageId),
    listImages: (options) => ipcRenderer.invoke('image:list', options),
    searchImages: (query) => ipcRenderer.invoke('image:search', query),
    deleteImage: (imageId) => ipcRenderer.invoke('image:delete', imageId),
    getStats: () => ipcRenderer.invoke('image:get-stats'),
    getSupportedFormats: () => ipcRenderer.invoke('image:get-supported-formats'),
    getSupportedLanguages: () => ipcRenderer.invoke('image:get-supported-languages'),
    // 事件监听
    on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // 提示词模板管理
  promptTemplate: {
    getAll: (filters) => ipcRenderer.invoke('prompt-template:get-all', filters),
    get: (id) => ipcRenderer.invoke('prompt-template:get', id),
    create: (templateData) => ipcRenderer.invoke('prompt-template:create', templateData),
    update: (id, updates) => ipcRenderer.invoke('prompt-template:update', id, updates),
    delete: (id) => ipcRenderer.invoke('prompt-template:delete', id),
    fill: (id, values) => ipcRenderer.invoke('prompt-template:fill', id, values),
    getCategories: () => ipcRenderer.invoke('prompt-template:get-categories'),
    search: (query) => ipcRenderer.invoke('prompt-template:search', query),
    getStatistics: () => ipcRenderer.invoke('prompt-template:get-statistics'),
    export: (id) => ipcRenderer.invoke('prompt-template:export', id),
    import: (importData) => ipcRenderer.invoke('prompt-template:import', importData),
  },

  // 系统操作
  system: {
    getVersion: () => ipcRenderer.invoke('system:get-version'),
    minimize: () => ipcRenderer.invoke('system:minimize'),
    maximize: () => ipcRenderer.invoke('system:maximize'),
    close: () => ipcRenderer.invoke('system:close'),
  },
});
