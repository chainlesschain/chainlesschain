const { contextBridge, ipcRenderer } = require('electron');

/**
 * 清理对象中的 undefined 值
 * Electron IPC 不支持传递 undefined 值，需要转换为 null 或移除
 */
function removeUndefined(obj, seen = new WeakSet()) {
  if (obj === undefined || obj === null) {
    return null;
  }

  // Filter out non-serializable types
  const type = typeof obj;
  if (type === 'function' || type === 'symbol') {
    console.warn('[Preload] Non-serializable type detected, skipping:', type);
    return null;
  }

  // Handle primitive types
  if (type !== 'object') {
    return obj;
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Detect circular references
  if (seen.has(obj)) {
    console.warn('[Preload] Circular reference detected, skipping');
    return '[Circular]';
  }

  // Mark this object as seen
  seen.add(obj);

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj
      .map(item => removeUndefined(item, seen))
      .filter(item => item !== null && item !== undefined);
  }

  // Handle plain objects
  const cleaned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      const valueType = typeof value;

      // Skip functions, symbols, and undefined values
      if (valueType === 'function' || valueType === 'symbol' || value === undefined) {
        continue;
      }

      const cleanedValue = removeUndefined(value, seen);
      if (cleanedValue !== null && cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }
  }
  return cleaned;
}

// 暴露安全的API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // U盾相关
  ukey: {
    detect: () => ipcRenderer.invoke('ukey:detect'),
    verifyPIN: (pin) => ipcRenderer.invoke('ukey:verify-pin', pin),
  },

  // 认证相关 - 密码登录
  auth: {
    verifyPassword: (username, password) => ipcRenderer.invoke('auth:verify-password', username, password),
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
    // 数据库配置
    getConfig: () => ipcRenderer.invoke('database:get-config'),
    setPath: (newPath) => ipcRenderer.invoke('database:set-path', newPath),
    migrate: (newPath) => ipcRenderer.invoke('database:migrate', newPath),
    createBackup: () => ipcRenderer.invoke('database:create-backup'),
    listBackups: () => ipcRenderer.invoke('database:list-backups'),
    restoreBackup: (backupPath) => ipcRenderer.invoke('database:restore-backup', backupPath),
  },

  // 应用管理
  app: {
    restart: () => ipcRenderer.invoke('app:restart'),
  },

  // LLM服务
  llm: {
    checkStatus: () => ipcRenderer.invoke('llm:check-status'),
    query: (prompt, options) => ipcRenderer.invoke('llm:query', prompt, options),
    queryStream: (prompt, options) => ipcRenderer.invoke('llm:query-stream', prompt, options),
    chat: (params) => ipcRenderer.invoke('llm:chat', params),
    getConfig: () => ipcRenderer.invoke('llm:get-config'),
    setConfig: (config) => ipcRenderer.invoke('llm:set-config', config),
    listModels: () => ipcRenderer.invoke('llm:list-models'),
    clearContext: (conversationId) => ipcRenderer.invoke('llm:clear-context', conversationId),
    embeddings: (text) => ipcRenderer.invoke('llm:embeddings', text),
    // 智能选择
    getSelectorInfo: () => ipcRenderer.invoke('llm:get-selector-info'),
    selectBest: (options) => ipcRenderer.invoke('llm:select-best', options),
    generateReport: (taskType) => ipcRenderer.invoke('llm:generate-report', taskType),
    switchProvider: (provider) => ipcRenderer.invoke('llm:switch-provider', provider),
    // 事件监听
    on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // 对话管理
  conversation: {
    create: (conversationData) => ipcRenderer.invoke('conversation:create', conversationData),
    get: (conversationId) => ipcRenderer.invoke('conversation:get', conversationId),
    getByProject: (projectId) => ipcRenderer.invoke('conversation:get-by-project', projectId),
    getAll: (options) => ipcRenderer.invoke('conversation:get-all', options),
    update: (conversationId, updates) => ipcRenderer.invoke('conversation:update', conversationId, updates),
    delete: (conversationId) => ipcRenderer.invoke('conversation:delete', conversationId),
    createMessage: (messageData) => ipcRenderer.invoke('conversation:create-message', messageData),
    getMessages: (conversationId, options) => ipcRenderer.invoke('conversation:get-messages', conversationId, options),
    deleteMessage: (messageId) => ipcRenderer.invoke('conversation:delete-message', messageId),
    clearMessages: (conversationId) => ipcRenderer.invoke('conversation:clear-messages', conversationId),
  },

  // 系统配置管理
  config: {
    getAll: () => ipcRenderer.invoke('config:get-all'),
    get: (key) => ipcRenderer.invoke('config:get', key),
    update: (config) => ipcRenderer.invoke('config:update', config),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
    reset: () => ipcRenderer.invoke('config:reset'),
    exportEnv: (filePath) => ipcRenderer.invoke('config:export-env', filePath),
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

  // 交易市场
  marketplace: {
    createOrder: (options) => ipcRenderer.invoke('marketplace:create-order', options),
    cancelOrder: (orderId) => ipcRenderer.invoke('marketplace:cancel-order', orderId),
    getOrders: (filters) => ipcRenderer.invoke('marketplace:get-orders', filters),
    getOrder: (orderId) => ipcRenderer.invoke('marketplace:get-order', orderId),
    matchOrder: (orderId, quantity) => ipcRenderer.invoke('marketplace:match-order', orderId, quantity),
    getTransactions: (filters) => ipcRenderer.invoke('marketplace:get-transactions', filters),
    confirmDelivery: (transactionId) => ipcRenderer.invoke('marketplace:confirm-delivery', transactionId),
    requestRefund: (transactionId, reason) => ipcRenderer.invoke('marketplace:request-refund', transactionId, reason),
    getMyOrders: (userDid) => ipcRenderer.invoke('marketplace:get-my-orders', userDid),
  },

  // 托管管理
  escrow: {
    get: (escrowId) => ipcRenderer.invoke('escrow:get', escrowId),
    getList: (filters) => ipcRenderer.invoke('escrow:get-list', filters),
    getHistory: (escrowId) => ipcRenderer.invoke('escrow:get-history', escrowId),
    dispute: (escrowId, reason) => ipcRenderer.invoke('escrow:dispute', escrowId, reason),
    getStatistics: () => ipcRenderer.invoke('escrow:get-statistics'),
  },

  // 智能合约
  contract: {
    create: (options) => ipcRenderer.invoke('contract:create', options),
    activate: (contractId) => ipcRenderer.invoke('contract:activate', contractId),
    sign: (contractId, signature) => ipcRenderer.invoke('contract:sign', contractId, signature),
    checkConditions: (contractId) => ipcRenderer.invoke('contract:check-conditions', contractId),
    execute: (contractId) => ipcRenderer.invoke('contract:execute', contractId),
    cancel: (contractId, reason) => ipcRenderer.invoke('contract:cancel', contractId, reason),
    get: (contractId) => ipcRenderer.invoke('contract:get', contractId),
    getList: (filters) => ipcRenderer.invoke('contract:get-list', filters),
    getConditions: (contractId) => ipcRenderer.invoke('contract:get-conditions', contractId),
    getEvents: (contractId) => ipcRenderer.invoke('contract:get-events', contractId),
    initiateArbitration: (contractId, reason, evidence) => ipcRenderer.invoke('contract:initiate-arbitration', contractId, reason, evidence),
    resolveArbitration: (arbitrationId, resolution) => ipcRenderer.invoke('contract:resolve-arbitration', arbitrationId, resolution),
    getTemplates: () => ipcRenderer.invoke('contract:get-templates'),
    createFromTemplate: (templateId, params) => ipcRenderer.invoke('contract:create-from-template', templateId, params),
  },

  // 知识付费
  knowledge: {
    createContent: (options) => ipcRenderer.invoke('knowledge:create-content', options),
    updateContent: (contentId, updates) => ipcRenderer.invoke('knowledge:update-content', contentId, updates),
    deleteContent: (contentId) => ipcRenderer.invoke('knowledge:delete-content', contentId),
    getContent: (contentId) => ipcRenderer.invoke('knowledge:get-content', contentId),
    listContents: (filters) => ipcRenderer.invoke('knowledge:list-contents', filters),
    purchaseContent: (contentId, paymentAssetId) => ipcRenderer.invoke('knowledge:purchase-content', contentId, paymentAssetId),
    subscribe: (planId, paymentAssetId) => ipcRenderer.invoke('knowledge:subscribe', planId, paymentAssetId),
    unsubscribe: (planId) => ipcRenderer.invoke('knowledge:unsubscribe', planId),
    getMyPurchases: (userDid) => ipcRenderer.invoke('knowledge:get-my-purchases', userDid),
    getMySubscriptions: (userDid) => ipcRenderer.invoke('knowledge:get-my-subscriptions', userDid),
    accessContent: (contentId) => ipcRenderer.invoke('knowledge:access-content', contentId),
    checkAccess: (contentId, userDid) => ipcRenderer.invoke('knowledge:check-access', contentId, userDid),
    getStatistics: (creatorDid) => ipcRenderer.invoke('knowledge:get-statistics', creatorDid),
  },

  // 知识图谱
  graph: {
    getGraphData: (options) => ipcRenderer.invoke('graph:get-graph-data', options || {}),
    processNote: (noteId, content, tags) => ipcRenderer.invoke('graph:process-note', noteId, content, tags || []),
    processAllNotes: (noteIds) => ipcRenderer.invoke('graph:process-all-notes', noteIds),
    getKnowledgeRelations: (knowledgeId) => ipcRenderer.invoke('graph:get-knowledge-relations', knowledgeId),
    findRelatedNotes: (sourceId, targetId, maxDepth) => ipcRenderer.invoke('graph:find-related-notes', sourceId, targetId, maxDepth || 3),
    findPotentialLinks: (noteId, content) => ipcRenderer.invoke('graph:find-potential-links', noteId, content),
    addRelation: (sourceId, targetId, type, weight, metadata) => ipcRenderer.invoke('graph:add-relation', sourceId, targetId, type, weight || 1.0, metadata || null),
    deleteRelations: (noteId, types) => ipcRenderer.invoke('graph:delete-relations', noteId, types || []),
    buildTagRelations: () => ipcRenderer.invoke('graph:build-tag-relations'),
    buildTemporalRelations: (windowDays) => ipcRenderer.invoke('graph:build-temporal-relations', windowDays || 7),
    extractSemanticRelations: (noteId, content) => ipcRenderer.invoke('graph:extract-semantic-relations', noteId, content),
  },

  // 信用评分
  credit: {
    getUserCredit: (userDid) => ipcRenderer.invoke('credit:get-user-credit', userDid),
    updateScore: (userDid) => ipcRenderer.invoke('credit:update-score', userDid),
    getScoreHistory: (userDid, limit) => ipcRenderer.invoke('credit:get-score-history', userDid, limit),
    getCreditLevel: (score) => ipcRenderer.invoke('credit:get-credit-level', score),
    getLeaderboard: (limit) => ipcRenderer.invoke('credit:get-leaderboard', limit),
    getBenefits: (userDid) => ipcRenderer.invoke('credit:get-benefits', userDid),
    getStatistics: () => ipcRenderer.invoke('credit:get-statistics'),
  },

  // 评价反馈
  review: {
    create: (options) => ipcRenderer.invoke('review:create', options),
    update: (reviewId, updates) => ipcRenderer.invoke('review:update', reviewId, updates),
    delete: (reviewId) => ipcRenderer.invoke('review:delete', reviewId),
    get: (reviewId) => ipcRenderer.invoke('review:get', reviewId),
    getByTarget: (targetId, targetType, filters) => ipcRenderer.invoke('review:get-by-target', targetId, targetType, filters),
    reply: (reviewId, content) => ipcRenderer.invoke('review:reply', reviewId, content),
    markHelpful: (reviewId, helpful) => ipcRenderer.invoke('review:mark-helpful', reviewId, helpful),
    report: (reviewId, reason, description) => ipcRenderer.invoke('review:report', reviewId, reason, description),
    getStatistics: (targetId, targetType) => ipcRenderer.invoke('review:get-statistics', targetId, targetType),
    getMyReviews: (userDid) => ipcRenderer.invoke('review:get-my-reviews', userDid),
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

  // 视频处理引擎
  video: {
    convert: (params) => ipcRenderer.invoke('video:convert', removeUndefined(params)),
    trim: (params) => ipcRenderer.invoke('video:trim', removeUndefined(params)),
    merge: (params) => ipcRenderer.invoke('video:merge', removeUndefined(params)),
    addSubtitles: (params) => ipcRenderer.invoke('video:addSubtitles', removeUndefined(params)),
    generateSubtitles: (params) => ipcRenderer.invoke('video:generateSubtitles', removeUndefined(params)),
    extractAudio: (params) => ipcRenderer.invoke('video:extractAudio', removeUndefined(params)),
    generateThumbnail: (params) => ipcRenderer.invoke('video:generateThumbnail', removeUndefined(params)),
    compress: (params) => ipcRenderer.invoke('video:compress', removeUndefined(params)),
    getInfo: (videoPath) => ipcRenderer.invoke('video:getInfo', videoPath),
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

  // 项目模板管理
  template: {
    getAll: (filters) => ipcRenderer.invoke('template:getAll', filters),
    getById: (templateId) => ipcRenderer.invoke('template:getById', templateId),
    search: (keyword, filters) => ipcRenderer.invoke('template:search', keyword, filters),
    renderPrompt: (templateId, userVariables) => ipcRenderer.invoke('template:renderPrompt', templateId, userVariables),
    recordUsage: (templateId, userId, projectId, variablesUsed) => ipcRenderer.invoke('template:recordUsage', templateId, userId, projectId, variablesUsed),
    rate: (templateId, userId, rating, review) => ipcRenderer.invoke('template:rate', templateId, userId, rating, review),
    getStats: () => ipcRenderer.invoke('template:getStats'),
    getRecent: (userId, limit) => ipcRenderer.invoke('template:getRecent', userId, limit),
    getPopular: (limit) => ipcRenderer.invoke('template:getPopular', limit),
    // CRUD 操作
    create: (templateData) => ipcRenderer.invoke('template:create', removeUndefined(templateData)),
    update: (templateId, updates) => ipcRenderer.invoke('template:update', templateId, removeUndefined(updates)),
    delete: (templateId) => ipcRenderer.invoke('template:delete', templateId),
    duplicate: (templateId, newName) => ipcRenderer.invoke('template:duplicate', templateId, newName),
  },

  // 项目分类管理
  category: {
    initializeDefaults: (userId) => ipcRenderer.invoke('category:initialize-defaults', userId),
    getAll: (userId) => ipcRenderer.invoke('category:get-all', userId),
    get: (categoryId) => ipcRenderer.invoke('category:get', categoryId),
    create: (categoryData) => ipcRenderer.invoke('category:create', removeUndefined(categoryData)),
    update: (categoryId, updates) => ipcRenderer.invoke('category:update', categoryId, removeUndefined(updates)),
    delete: (categoryId) => ipcRenderer.invoke('category:delete', categoryId),
    updateSort: (sortData) => ipcRenderer.invoke('category:update-sort', sortData),
  },

  // 项目管理
  project: {
    // 项目CRUD
    getAll: (userId) => ipcRenderer.invoke('project:get-all', userId),
    get: (projectId) => ipcRenderer.invoke('project:get', projectId),
    create: (createData) => ipcRenderer.invoke('project:create', removeUndefined(createData)),
    createQuick: (createData) => ipcRenderer.invoke('project:create-quick', removeUndefined(createData)),
    update: (projectId, updates) => ipcRenderer.invoke('project:update', projectId, removeUndefined(updates)),
    delete: (projectId) => ipcRenderer.invoke('project:delete', projectId),
    save: (project) => ipcRenderer.invoke('project:save', removeUndefined(project)),
    deleteLocal: (projectId) => ipcRenderer.invoke('project:delete-local', projectId),
    repairRootPath: (projectId) => ipcRenderer.invoke('project:repair-root-path', projectId),
    repairAllRootPaths: () => ipcRenderer.invoke('project:repair-all-root-paths'),
    fixPath: (projectId) => ipcRenderer.invoke('project:fix-path', projectId),

    // 流式创建项目
    createStream: (createData, callbacks) => {
      return new Promise((resolve, reject) => {
        console.log('[Preload] createStream called with callbacks:', {
          hasOnProgress: !!callbacks?.onProgress,
          hasOnContent: !!callbacks?.onContent,
          hasOnComplete: !!callbacks?.onComplete,
          hasOnError: !!callbacks?.onError,
        });

        const handleChunk = (event, chunkData) => {
          console.log('[Preload] ===== 收到IPC事件 =====');
          console.log('[Preload] Event data:', chunkData);

          const { type, data, error } = chunkData;
          console.log('[Preload] Event type:', type);

          switch (type) {
            case 'progress':
              console.log('[Preload] 处理progress事件');
              console.log('[Preload] callbacks.onProgress存在?', !!callbacks?.onProgress);
              if (callbacks?.onProgress) {
                console.log('[Preload] 调用callbacks.onProgress with data:', data);
                callbacks.onProgress(data);
                console.log('[Preload] callbacks.onProgress调用完成');
              } else {
                console.warn('[Preload] callbacks.onProgress不存在!');
              }
              break;
            case 'content':
              console.log('[Preload] 处理content事件');
              callbacks.onContent?.(data);
              break;
            case 'complete':
              console.log('[Preload] ===== 处理complete事件 =====');
              console.log('[Preload] Complete data:', data);
              console.log('[Preload] Complete data keys:', Object.keys(data || {}));
              console.log('[Preload] 调用callbacks.onComplete');
              callbacks.onComplete?.(data);
              console.log('[Preload] 移除事件监听器');
              ipcRenderer.off('project:stream-chunk', handleChunk);
              console.log('[Preload] 调用resolve');
              resolve(data);
              console.log('[Preload] ===== Complete事件处理完毕 =====');
              break;
            case 'error':
              console.log('[Preload] 处理error事件:', error);
              callbacks.onError?.(new Error(error));
              ipcRenderer.off('project:stream-chunk', handleChunk);
              reject(new Error(error));
              break;
          }
        };

        console.log('[Preload] 开始监听project:stream-chunk事件');
        // 监听流式事件
        ipcRenderer.on('project:stream-chunk', handleChunk);

        console.log('[Preload] 发起流式请求');
        // 发起流式请求
        ipcRenderer.invoke('project:create-stream', removeUndefined(createData))
          .catch((err) => {
            console.error('[Preload] 流式请求失败:', err);
            ipcRenderer.off('project:stream-chunk', handleChunk);
            reject(err);
          });
      });
    },

    // 取消流式创建
    cancelStream: () => ipcRenderer.invoke('project:stream-cancel'),

    // 后端获取
    fetchFromBackend: (projectId) => ipcRenderer.invoke('project:fetch-from-backend', projectId),

    // 文件管理
    getFiles: (projectId) => ipcRenderer.invoke('project:get-files', projectId),
    getFile: (fileId) => ipcRenderer.invoke('project:get-file', fileId),
    saveFiles: (projectId, files) => ipcRenderer.invoke('project:save-files', projectId, files),
    updateFile: (fileUpdate) => ipcRenderer.invoke('project:update-file', fileUpdate),
    deleteFile: (projectId, fileId) => ipcRenderer.invoke('project:delete-file', projectId, fileId),

    // AI对话 - 支持文件操作
    aiChat: (chatData) => ipcRenderer.invoke('project:aiChat', removeUndefined(chatData)),

    // 路径解析
    resolvePath: (relativePath) => ipcRenderer.invoke('project:resolve-path', relativePath),

    // 同步
    sync: (userId) => ipcRenderer.invoke('project:sync', userId || 'default-user'),
    syncOne: (projectId) => ipcRenderer.invoke('project:sync-one', projectId),

    // Git 操作
    gitStatus: (repoPath) => ipcRenderer.invoke('project:git-status', repoPath),
    gitPush: (projectId, repoPath) => ipcRenderer.invoke('project:git-push', projectId, repoPath),
    gitPull: (projectId, repoPath) => ipcRenderer.invoke('project:git-pull', projectId, repoPath),

    // AI任务智能拆解系统
    decomposeTask: (userRequest, projectContext) => ipcRenderer.invoke('project:decompose-task', userRequest, removeUndefined(projectContext)),
    executeTaskPlan: (taskPlanId, projectContext) => ipcRenderer.invoke('project:execute-task-plan', taskPlanId, removeUndefined(projectContext)),
    getTaskPlan: (taskPlanId) => ipcRenderer.invoke('project:get-task-plan', taskPlanId),
    getTaskPlanHistory: (projectId, limit) => ipcRenderer.invoke('project:get-task-plan-history', projectId, limit),
    cancelTaskPlan: (taskPlanId) => ipcRenderer.invoke('project:cancel-task-plan', taskPlanId),

    // 任务进度更新监听
    onTaskProgressUpdate: (callback) => ipcRenderer.on('task:progress-update', (_event, progress) => callback(progress)),
    offTaskProgressUpdate: (callback) => ipcRenderer.removeListener('task:progress-update', callback),

    // 项目文件更新监听
    onFilesUpdated: (callback) => ipcRenderer.on('project:files-updated', (_event, data) => callback(data)),
    offFilesUpdated: (callback) => ipcRenderer.removeListener('project:files-updated', callback),

    // 文件同步事件监听（文件系统变化自动刷新）
    watchProject: (projectId, rootPath) => ipcRenderer.invoke('file-sync:watch-project', projectId, rootPath),
    stopWatchProject: (projectId) => ipcRenderer.invoke('file-sync:stop-watch', projectId),
    onFileReloaded: (callback) => ipcRenderer.on('file-sync:reloaded', (_event, data) => callback(data)),
    offFileReloaded: (callback) => ipcRenderer.removeListener('file-sync:reloaded', callback),
    onFileAdded: (callback) => ipcRenderer.on('file-sync:file-added', (_event, data) => callback(data)),
    offFileAdded: (callback) => ipcRenderer.removeListener('file-sync:file-added', callback),
    onFileDeleted: (callback) => ipcRenderer.on('file-sync:file-deleted', (_event, data) => callback(data)),
    offFileDeleted: (callback) => ipcRenderer.removeListener('file-sync:file-deleted', callback),
    onFileSyncConflict: (callback) => ipcRenderer.on('file-sync:conflict', (_event, data) => callback(data)),
    offFileSyncConflict: (callback) => ipcRenderer.removeListener('file-sync:conflict', callback),

    // 项目分享
    share: (projectId, shareMode, options) => ipcRenderer.invoke('project:share', projectId, shareMode, removeUndefined(options || {})),
    unshare: (projectId) => ipcRenderer.invoke('project:unshare', projectId),
    getByShareToken: (shareToken) => ipcRenderer.invoke('project:get-by-share-token', shareToken),

    // 新增功能 - 项目分享和导出
    shareProject: (params) => ipcRenderer.invoke('project:shareProject', removeUndefined(params)),
    getShare: (projectId) => ipcRenderer.invoke('project:getShare', projectId),
    deleteShare: (projectId) => ipcRenderer.invoke('project:deleteShare', projectId),
    accessShare: (token) => ipcRenderer.invoke('project:accessShare', token),
    shareToWechat: (params) => ipcRenderer.invoke('project:shareToWechat', removeUndefined(params)),
    exportDocument: (params) => ipcRenderer.invoke('project:exportDocument', removeUndefined(params)),
    generatePPT: (params) => ipcRenderer.invoke('project:generatePPT', removeUndefined(params)),
    exportPPT: (params) => ipcRenderer.invoke('ppt:export', removeUndefined(params)),
    generatePodcastScript: (params) => ipcRenderer.invoke('project:generatePodcastScript', removeUndefined(params)),
    generateArticleImages: (params) => ipcRenderer.invoke('project:generateArticleImages', removeUndefined(params)),
    polishContent: (params) => ipcRenderer.invoke('project:polishContent', removeUndefined(params)),
    expandContent: (params) => ipcRenderer.invoke('project:expandContent', removeUndefined(params)),
    copyFile: (params) => ipcRenderer.invoke('project:copyFile', removeUndefined(params)),

    // 文件导入导出功能
    exportFile: (params) => ipcRenderer.invoke('project:export-file', removeUndefined(params)),
    exportFiles: (params) => ipcRenderer.invoke('project:export-files', removeUndefined(params)),
    selectExportDirectory: () => ipcRenderer.invoke('project:select-export-directory'),
    selectImportFiles: (options) => ipcRenderer.invoke('project:select-import-files', removeUndefined(options || {})),
    importFile: (params) => ipcRenderer.invoke('project:import-file', removeUndefined(params)),
    importFiles: (params) => ipcRenderer.invoke('project:import-files', removeUndefined(params)),

    // RAG增强功能
    indexFiles: (projectId, options) => ipcRenderer.invoke('project:indexFiles', projectId, removeUndefined(options || {})),
    ragQuery: (projectId, query, options) => ipcRenderer.invoke('project:ragQuery', projectId, query, removeUndefined(options || {})),
    updateFileIndex: (fileId) => ipcRenderer.invoke('project:updateFileIndex', fileId),
    deleteIndex: (projectId) => ipcRenderer.invoke('project:deleteIndex', projectId),
    getIndexStats: (projectId) => ipcRenderer.invoke('project:getIndexStats', projectId),

    // 项目统计收集
    startStats: (projectId, projectPath) => ipcRenderer.invoke('project:stats:start', projectId, projectPath),
    stopStats: (projectId) => ipcRenderer.invoke('project:stats:stop', projectId),

    // 事件监听
    on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // 文件操作
  file: {
    // 通用文件操作
    readContent: (filePath) => ipcRenderer.invoke('file:readContent', filePath),
    writeContent: (filePath, content) => ipcRenderer.invoke('file:writeContent', filePath, content),
    readBinary: (filePath) => ipcRenderer.invoke('file:read-binary', filePath),
    saveAs: (filePath) => ipcRenderer.invoke('file:saveAs', filePath),
    exists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
    stat: (filePath) => ipcRenderer.invoke('file:stat', filePath),

    // 文件/文件夹操作（右键菜单功能）
    revealInExplorer: (filePath) => ipcRenderer.invoke('file:revealInExplorer', filePath),
    copyItem: (params) => ipcRenderer.invoke('file:copyItem', removeUndefined(params)),
    moveItem: (params) => ipcRenderer.invoke('file:moveItem', removeUndefined(params)),
    deleteItem: (params) => ipcRenderer.invoke('file:deleteItem', removeUndefined(params)),
    renameItem: (params) => ipcRenderer.invoke('file:renameItem', removeUndefined(params)),
    createFile: (params) => ipcRenderer.invoke('file:createFile', removeUndefined(params)),
    createFolder: (params) => ipcRenderer.invoke('file:createFolder', removeUndefined(params)),

    // 打开文件操作
    openWithDefault: (filePath) => ipcRenderer.invoke('file:openWithDefault', filePath),
    openWith: (filePath) => ipcRenderer.invoke('file:openWith', filePath),
    openWithProgram: (params) => ipcRenderer.invoke('file:openWithProgram', removeUndefined(params)),

    // Excel操作
    readExcel: (filePath) => ipcRenderer.invoke('file:readExcel', filePath),
    writeExcel: (filePath, data) => ipcRenderer.invoke('file:writeExcel', filePath, data),
    excelToJSON: (filePath, options) => ipcRenderer.invoke('file:excelToJSON', filePath, options || {}),
    jsonToExcel: (jsonData, filePath, options) => ipcRenderer.invoke('file:jsonToExcel', jsonData, filePath, options || {}),

    // Word操作
    readWord: (filePath) => ipcRenderer.invoke('file:readWord', filePath),
    writeWord: (filePath, content) => ipcRenderer.invoke('file:writeWord', filePath, content),
    markdownToWord: (markdown, outputPath, options) => ipcRenderer.invoke('file:markdownToWord', markdown, outputPath, options || {}),
    wordToMarkdown: (filePath) => ipcRenderer.invoke('file:wordToMarkdown', filePath),
    htmlToWord: (html, outputPath, options) => ipcRenderer.invoke('file:htmlToWord', html, outputPath, options || {}),

    // PPT操作
    readPPT: (filePath) => ipcRenderer.invoke('file:readPPT', filePath),
    writePPT: (filePath, data) => ipcRenderer.invoke('file:writePPT', filePath, data),
    markdownToPPT: (markdown, outputPath, options) => ipcRenderer.invoke('file:markdownToPPT', markdown, outputPath, options || {}),
    createPPTTemplate: (templateType, outputPath) => ipcRenderer.invoke('file:createPPTTemplate', templateType, outputPath),

    // Office文件预览
    previewOffice: (filePath, format) => ipcRenderer.invoke('file:previewOffice', filePath, format),
  },

  // 压缩包操作
  archive: {
    list: (archivePath) => ipcRenderer.invoke('archive:list', archivePath),
    getInfo: (archivePath) => ipcRenderer.invoke('archive:getInfo', archivePath),
    extract: (archivePath, filePath) => ipcRenderer.invoke('archive:extract', archivePath, filePath),
    extractTo: (archivePath, filePath, outputPath) => ipcRenderer.invoke('archive:extractTo', archivePath, filePath, outputPath),
  },

  // 大文件操作
  largeFile: {
    getInfo: (filePath) => ipcRenderer.invoke('largeFile:getInfo', filePath),
    readLines: (filePath, startLine, lineCount) => ipcRenderer.invoke('largeFile:readLines', filePath, startLine, lineCount),
    search: (filePath, query, options) => ipcRenderer.invoke('largeFile:search', filePath, query, options || {}),
    getHead: (filePath, lineCount) => ipcRenderer.invoke('largeFile:getHead', filePath, lineCount || 100),
    getTail: (filePath, lineCount) => ipcRenderer.invoke('largeFile:getTail', filePath, lineCount || 100),
  },

  // AI引擎
  ai: {
    processInput: ({ input, context }) => ipcRenderer.invoke('ai:processInput', { input, context }),
    getHistory: (limit) => ipcRenderer.invoke('ai:getHistory', limit),
    clearHistory: () => ipcRenderer.invoke('ai:clearHistory'),
    // 事件监听
    onStepUpdate: (callback) => ipcRenderer.on('ai:stepUpdate', (_event, step) => callback(step)),
    offStepUpdate: (callback) => ipcRenderer.removeListener('ai:stepUpdate', callback),
  },

  // 代码开发引擎
  code: {
    generate: (description, options) => ipcRenderer.invoke('code:generate', description, removeUndefined(options || {})),
    generateTests: (code, language) => ipcRenderer.invoke('code:generateTests', code, language),
    review: (code, language) => ipcRenderer.invoke('code:review', code, language),
    refactor: (code, language, refactoringType) => ipcRenderer.invoke('code:refactor', code, language, refactoringType),
    explain: (code, language) => ipcRenderer.invoke('code:explain', code, language),
    fixBug: (code, language, errorMessage) => ipcRenderer.invoke('code:fixBug', code, language, errorMessage),
    generateScaffold: (projectType, options) => ipcRenderer.invoke('code:generateScaffold', projectType, removeUndefined(options || {})),
    executePython: (code, options) => ipcRenderer.invoke('code:executePython', code, removeUndefined(options || {})),
    executeFile: (filepath, options) => ipcRenderer.invoke('code:executeFile', filepath, removeUndefined(options || {})),
    checkSafety: (code) => ipcRenderer.invoke('code:checkSafety', code),
  },

  // 项目自动化规则
  automation: {
    createRule: (ruleData) => ipcRenderer.invoke('automation:createRule', removeUndefined(ruleData)),
    getRules: (projectId) => ipcRenderer.invoke('automation:getRules', projectId),
    getRule: (ruleId) => ipcRenderer.invoke('automation:getRule', ruleId),
    updateRule: (ruleId, updates) => ipcRenderer.invoke('automation:updateRule', ruleId, removeUndefined(updates)),
    deleteRule: (ruleId) => ipcRenderer.invoke('automation:deleteRule', ruleId),
    manualTrigger: (ruleId) => ipcRenderer.invoke('automation:manualTrigger', ruleId),
    loadProjectRules: (projectId) => ipcRenderer.invoke('automation:loadProjectRules', projectId),
    stopRule: (ruleId) => ipcRenderer.invoke('automation:stopRule', ruleId),
    getStatistics: () => ipcRenderer.invoke('automation:getStatistics'),
  },

  // 协作实时编辑
  collaboration: {
    startServer: (options) => ipcRenderer.invoke('collaboration:startServer', removeUndefined(options || {})),
    stopServer: () => ipcRenderer.invoke('collaboration:stopServer'),
    joinDocument: (userId, userName, documentId) => ipcRenderer.invoke('collaboration:joinDocument', userId, userName, documentId),
    submitOperation: (documentId, userId, operation) => ipcRenderer.invoke('collaboration:submitOperation', documentId, userId, operation),
    getOnlineUsers: (documentId) => ipcRenderer.invoke('collaboration:getOnlineUsers', documentId),
    getOperationHistory: (documentId, limit) => ipcRenderer.invoke('collaboration:getOperationHistory', documentId, limit),
    getSessionHistory: (documentId, limit) => ipcRenderer.invoke('collaboration:getSessionHistory', documentId, limit),
    getStatus: () => ipcRenderer.invoke('collaboration:getStatus'),
  },

  // 系统操作
  system: {
    getVersion: () => ipcRenderer.invoke('system:get-version'),
    minimize: () => ipcRenderer.invoke('system:minimize'),
    maximize: () => ipcRenderer.invoke('system:maximize'),
    close: () => ipcRenderer.invoke('system:close'),
  },

  // Shell操作
  shell: {
    openPath: (path) => ipcRenderer.invoke('shell:open-path', path),
    showItemInFolder: (path) => ipcRenderer.invoke('shell:show-item-in-folder', path),
  },

  // Dialog 对话框
  dialog: {
    selectFolder: (options) => ipcRenderer.invoke('dialog:select-folder', options),
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),
  },

  // 数据同步
  sync: {
    start: (deviceId) => ipcRenderer.invoke('sync:start', deviceId),
    resolveConflict: (conflictId, resolution) => ipcRenderer.invoke('sync:resolve-conflict', conflictId, resolution),
    getStatus: () => ipcRenderer.invoke('sync:get-status'),
    incremental: () => ipcRenderer.invoke('sync:incremental'),
    // 监听同步事件
    onSyncStarted: (callback) => ipcRenderer.on('sync:started', (_event, ...args) => callback(...args)),
    onSyncCompleted: (callback) => ipcRenderer.on('sync:completed', (_event, ...args) => callback(...args)),
    onSyncError: (callback) => ipcRenderer.on('sync:error', (_event, ...args) => callback(...args)),
    onShowConflicts: (callback) => ipcRenderer.on('sync:show-conflicts', (_event, ...args) => callback(...args)),
  },

  // 插件管理
  plugin: {
    // 插件查询
    getPlugins: (filters) => ipcRenderer.invoke('plugin:get-plugins', filters),
    getPlugin: (pluginId) => ipcRenderer.invoke('plugin:get-plugin', pluginId),

    // 插件生命周期
    install: (source, options) => ipcRenderer.invoke('plugin:install', source, options),
    uninstall: (pluginId) => ipcRenderer.invoke('plugin:uninstall', pluginId),
    enable: (pluginId) => ipcRenderer.invoke('plugin:enable', pluginId),
    disable: (pluginId) => ipcRenderer.invoke('plugin:disable', pluginId),

    // 权限管理
    getPermissions: (pluginId) => ipcRenderer.invoke('plugin:get-permissions', pluginId),
    updatePermission: (pluginId, permission, granted) => ipcRenderer.invoke('plugin:update-permission', pluginId, permission, granted),

    // 扩展点
    triggerExtensionPoint: (name, context) => ipcRenderer.invoke('plugin:trigger-extension-point', name, context),

    // 工具
    openPluginsDir: () => ipcRenderer.invoke('plugin:open-plugins-dir'),

    // 事件监听
    on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // Web IDE
  webIDE: {
    // 项目管理
    saveProject: (data) => ipcRenderer.invoke('webide:saveProject', removeUndefined(data)),
    loadProject: (projectId) => ipcRenderer.invoke('webide:loadProject', projectId),
    getProjectList: () => ipcRenderer.invoke('webide:getProjectList'),
    deleteProject: (projectId) => ipcRenderer.invoke('webide:deleteProject', projectId),

    // 预览服务器
    startDevServer: (data) => ipcRenderer.invoke('webide:startDevServer', removeUndefined(data)),
    stopDevServer: (port) => ipcRenderer.invoke('webide:stopDevServer', port),
    getServerStatus: () => ipcRenderer.invoke('webide:getServerStatus'),

    // 导出功能
    exportHTML: (data) => ipcRenderer.invoke('webide:exportHTML', removeUndefined(data)),
    exportZIP: (data) => ipcRenderer.invoke('webide:exportZIP', removeUndefined(data)),
    captureScreenshot: (options) => ipcRenderer.invoke('webide:captureScreenshot', removeUndefined(options)),
  },
});
