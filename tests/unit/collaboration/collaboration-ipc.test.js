/**
 * Collaboration IPC 单元测试
 * 测试企业协作实时编辑 IPC 处理器的所有功能
 */

const { ipcMain } = require('electron');
const { registerCollaborationIPC } = require('../../../desktop-app-vue/src/main/collaboration/collaboration-ipc');

// Mock electron
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

// Mock collaboration-manager
let mockCollaborationManager;
jest.mock('../../../desktop-app-vue/src/main/collaboration/collaboration-manager', () => ({
  getCollaborationManager: jest.fn(() => mockCollaborationManager),
}));

describe('Collaboration IPC Handlers', () => {
  let handlers = {};

  beforeEach(() => {
    // 清除所有 mocks
    jest.clearAllMocks();
    handlers = {};

    // 创建 mock 协作管理器
    mockCollaborationManager = {
      initialize: jest.fn().mockResolvedValue(undefined),
      startServer: jest.fn(),
      stopServer: jest.fn(),
      joinDocument: jest.fn(),
      submitOperation: jest.fn(),
      getOnlineUsers: jest.fn(),
      getOperationHistory: jest.fn(),
      getSessionHistory: jest.fn(),
      getStatus: jest.fn(),
    };

    // 捕获所有注册的 handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 IPC handlers
    registerCollaborationIPC();
  });

  afterEach(() => {
    handlers = {};
    mockCollaborationManager = null;
  });

  // ============================================================
  // 服务器管理测试
  // ============================================================

  describe('collaboration:startServer', () => {
    it('should start collaboration server successfully', async () => {
      const mockResult = {
        success: true,
        port: 8080,
        url: 'http://localhost:8080',
      };

      mockCollaborationManager.startServer.mockResolvedValue(mockResult);

      const handler = handlers['collaboration:startServer'];
      const result = await handler(null, { port: 8080 });

      expect(mockCollaborationManager.initialize).toHaveBeenCalledWith({ port: 8080 });
      expect(mockCollaborationManager.startServer).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResult);
    });

    it('should start server with default options when no options provided', async () => {
      const mockResult = {
        success: true,
        port: 3000,
        url: 'http://localhost:3000',
      };

      mockCollaborationManager.startServer.mockResolvedValue(mockResult);

      const handler = handlers['collaboration:startServer'];
      const result = await handler(null);

      expect(mockCollaborationManager.initialize).toHaveBeenCalledWith({});
      expect(mockCollaborationManager.startServer).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResult);
    });

    it('should throw error when server start fails', async () => {
      const error = new Error('端口已被占用');
      mockCollaborationManager.startServer.mockRejectedValue(error);

      const handler = handlers['collaboration:startServer'];

      await expect(handler(null, { port: 8080 })).rejects.toThrow('端口已被占用');
      expect(mockCollaborationManager.initialize).toHaveBeenCalled();
    });

    it('should throw error when manager initialization fails', async () => {
      const error = new Error('初始化失败');
      mockCollaborationManager.initialize.mockRejectedValue(error);

      const handler = handlers['collaboration:startServer'];

      await expect(handler(null)).rejects.toThrow('初始化失败');
    });
  });

  describe('collaboration:stopServer', () => {
    it('should stop collaboration server successfully', async () => {
      const mockResult = {
        success: true,
        message: '服务器已停止',
      };

      mockCollaborationManager.stopServer.mockResolvedValue(mockResult);

      const handler = handlers['collaboration:stopServer'];
      const result = await handler(null);

      expect(mockCollaborationManager.stopServer).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResult);
    });

    it('should throw error when server stop fails', async () => {
      const error = new Error('服务器未运行');
      mockCollaborationManager.stopServer.mockRejectedValue(error);

      const handler = handlers['collaboration:stopServer'];

      await expect(handler(null)).rejects.toThrow('服务器未运行');
    });

    it('should handle stop server when server is not started', async () => {
      const mockResult = {
        success: false,
        message: '服务器未启动',
      };

      mockCollaborationManager.stopServer.mockResolvedValue(mockResult);

      const handler = handlers['collaboration:stopServer'];
      const result = await handler(null);

      expect(result).toEqual(mockResult);
    });
  });

  // ============================================================
  // 文档协作管理测试
  // ============================================================

  describe('collaboration:joinDocument', () => {
    it('should join document collaboration successfully', async () => {
      const mockResult = {
        success: true,
        documentId: 'doc-123',
        userId: 'user-456',
        sessionId: 'session-789',
        onlineUsers: [
          { userId: 'user-456', userName: 'Alice' },
          { userId: 'user-111', userName: 'Bob' },
        ],
      };

      mockCollaborationManager.joinDocument.mockResolvedValue(mockResult);

      const handler = handlers['collaboration:joinDocument'];
      const result = await handler(null, 'user-456', 'Alice', 'doc-123');

      expect(mockCollaborationManager.initialize).toHaveBeenCalledTimes(1);
      expect(mockCollaborationManager.joinDocument).toHaveBeenCalledWith('user-456', 'Alice', 'doc-123');
      expect(result).toEqual(mockResult);
    });

    it('should throw error when document does not exist', async () => {
      const error = new Error('文档不存在');
      mockCollaborationManager.joinDocument.mockRejectedValue(error);

      const handler = handlers['collaboration:joinDocument'];

      await expect(handler(null, 'user-456', 'Alice', 'doc-999')).rejects.toThrow('文档不存在');
    });

    it('should throw error when user is already in document', async () => {
      const error = new Error('用户已在文档中');
      mockCollaborationManager.joinDocument.mockRejectedValue(error);

      const handler = handlers['collaboration:joinDocument'];

      await expect(handler(null, 'user-456', 'Alice', 'doc-123')).rejects.toThrow('用户已在文档中');
    });

    it('should throw error when initialization fails', async () => {
      const error = new Error('初始化失败');
      mockCollaborationManager.initialize.mockRejectedValue(error);

      const handler = handlers['collaboration:joinDocument'];

      await expect(handler(null, 'user-456', 'Alice', 'doc-123')).rejects.toThrow('初始化失败');
    });
  });

  // ============================================================
  // 操作提交测试
  // ============================================================

  describe('collaboration:submitOperation', () => {
    it('should submit text insertion operation successfully', async () => {
      const operation = {
        type: 'insert',
        position: 10,
        text: 'Hello, World!',
        timestamp: Date.now(),
      };

      const mockResult = {
        success: true,
        operationId: 'op-123',
        version: 42,
      };

      mockCollaborationManager.submitOperation.mockResolvedValue(mockResult);

      const handler = handlers['collaboration:submitOperation'];
      const result = await handler(null, 'doc-123', 'user-456', operation);

      expect(mockCollaborationManager.initialize).toHaveBeenCalledTimes(1);
      expect(mockCollaborationManager.submitOperation).toHaveBeenCalledWith('doc-123', 'user-456', operation);
      expect(result).toEqual(mockResult);
    });

    it('should submit text deletion operation successfully', async () => {
      const operation = {
        type: 'delete',
        position: 5,
        length: 3,
        timestamp: Date.now(),
      };

      const mockResult = {
        success: true,
        operationId: 'op-124',
        version: 43,
      };

      mockCollaborationManager.submitOperation.mockResolvedValue(mockResult);

      const handler = handlers['collaboration:submitOperation'];
      const result = await handler(null, 'doc-123', 'user-456', operation);

      expect(mockCollaborationManager.submitOperation).toHaveBeenCalledWith('doc-123', 'user-456', operation);
      expect(result).toEqual(mockResult);
    });

    it('should throw error when operation is invalid', async () => {
      const operation = {
        type: 'invalid',
      };

      const error = new Error('无效的操作类型');
      mockCollaborationManager.submitOperation.mockRejectedValue(error);

      const handler = handlers['collaboration:submitOperation'];

      await expect(handler(null, 'doc-123', 'user-456', operation)).rejects.toThrow('无效的操作类型');
    });

    it('should throw error when user is not in document', async () => {
      const operation = {
        type: 'insert',
        position: 10,
        text: 'Test',
      };

      const error = new Error('用户未加入文档');
      mockCollaborationManager.submitOperation.mockRejectedValue(error);

      const handler = handlers['collaboration:submitOperation'];

      await expect(handler(null, 'doc-123', 'user-999', operation)).rejects.toThrow('用户未加入文档');
    });

    it('should throw error when initialization fails', async () => {
      const operation = { type: 'insert', position: 0, text: 'Test' };
      const error = new Error('初始化失败');
      mockCollaborationManager.initialize.mockRejectedValue(error);

      const handler = handlers['collaboration:submitOperation'];

      await expect(handler(null, 'doc-123', 'user-456', operation)).rejects.toThrow('初始化失败');
    });
  });

  // ============================================================
  // 在线用户管理测试
  // ============================================================

  describe('collaboration:getOnlineUsers', () => {
    it('should get online users for a document successfully', async () => {
      const mockUsers = [
        {
          userId: 'user-123',
          userName: 'Alice',
          joinedAt: '2024-01-01T10:00:00Z',
          cursor: { line: 5, column: 10 },
        },
        {
          userId: 'user-456',
          userName: 'Bob',
          joinedAt: '2024-01-01T10:05:00Z',
          cursor: { line: 12, column: 3 },
        },
      ];

      mockCollaborationManager.getOnlineUsers.mockReturnValue(mockUsers);

      const handler = handlers['collaboration:getOnlineUsers'];
      const result = await handler(null, 'doc-123');

      expect(mockCollaborationManager.initialize).toHaveBeenCalledTimes(1);
      expect(mockCollaborationManager.getOnlineUsers).toHaveBeenCalledWith('doc-123');
      expect(result).toEqual(mockUsers);
    });

    it('should return empty array when no users online', async () => {
      mockCollaborationManager.getOnlineUsers.mockReturnValue([]);

      const handler = handlers['collaboration:getOnlineUsers'];
      const result = await handler(null, 'doc-123');

      expect(result).toEqual([]);
    });

    it('should throw error when document does not exist', async () => {
      const error = new Error('文档不存在');
      mockCollaborationManager.getOnlineUsers.mockImplementation(() => {
        throw error;
      });

      const handler = handlers['collaboration:getOnlineUsers'];

      await expect(handler(null, 'doc-999')).rejects.toThrow('文档不存在');
    });

    it('should throw error when initialization fails', async () => {
      const error = new Error('初始化失败');
      mockCollaborationManager.initialize.mockRejectedValue(error);

      const handler = handlers['collaboration:getOnlineUsers'];

      await expect(handler(null, 'doc-123')).rejects.toThrow('初始化失败');
    });
  });

  // ============================================================
  // 操作历史记录测试
  // ============================================================

  describe('collaboration:getOperationHistory', () => {
    it('should get operation history with limit', async () => {
      const mockHistory = [
        {
          operationId: 'op-123',
          userId: 'user-456',
          userName: 'Alice',
          type: 'insert',
          position: 10,
          text: 'Hello',
          timestamp: '2024-01-01T10:00:00Z',
          version: 42,
        },
        {
          operationId: 'op-124',
          userId: 'user-789',
          userName: 'Bob',
          type: 'delete',
          position: 5,
          length: 3,
          timestamp: '2024-01-01T10:01:00Z',
          version: 43,
        },
      ];

      mockCollaborationManager.getOperationHistory.mockReturnValue(mockHistory);

      const handler = handlers['collaboration:getOperationHistory'];
      const result = await handler(null, 'doc-123', 50);

      expect(mockCollaborationManager.initialize).toHaveBeenCalledTimes(1);
      expect(mockCollaborationManager.getOperationHistory).toHaveBeenCalledWith('doc-123', 50);
      expect(result).toEqual(mockHistory);
    });

    it('should get operation history without limit', async () => {
      const mockHistory = [
        { operationId: 'op-123', type: 'insert', version: 1 },
        { operationId: 'op-124', type: 'delete', version: 2 },
        { operationId: 'op-125', type: 'insert', version: 3 },
      ];

      mockCollaborationManager.getOperationHistory.mockReturnValue(mockHistory);

      const handler = handlers['collaboration:getOperationHistory'];
      const result = await handler(null, 'doc-123', undefined);

      expect(mockCollaborationManager.getOperationHistory).toHaveBeenCalledWith('doc-123', undefined);
      expect(result).toEqual(mockHistory);
    });

    it('should return empty array when no operations exist', async () => {
      mockCollaborationManager.getOperationHistory.mockReturnValue([]);

      const handler = handlers['collaboration:getOperationHistory'];
      const result = await handler(null, 'doc-123', 10);

      expect(result).toEqual([]);
    });

    it('should throw error when document does not exist', async () => {
      const error = new Error('文档不存在');
      mockCollaborationManager.getOperationHistory.mockImplementation(() => {
        throw error;
      });

      const handler = handlers['collaboration:getOperationHistory'];

      await expect(handler(null, 'doc-999', 10)).rejects.toThrow('文档不存在');
    });

    it('should throw error when initialization fails', async () => {
      const error = new Error('初始化失败');
      mockCollaborationManager.initialize.mockRejectedValue(error);

      const handler = handlers['collaboration:getOperationHistory'];

      await expect(handler(null, 'doc-123', 10)).rejects.toThrow('初始化失败');
    });
  });

  // ============================================================
  // 会话历史记录测试
  // ============================================================

  describe('collaboration:getSessionHistory', () => {
    it('should get session history with limit', async () => {
      const mockHistory = [
        {
          sessionId: 'session-123',
          userId: 'user-456',
          userName: 'Alice',
          action: 'join',
          timestamp: '2024-01-01T10:00:00Z',
        },
        {
          sessionId: 'session-124',
          userId: 'user-789',
          userName: 'Bob',
          action: 'join',
          timestamp: '2024-01-01T10:05:00Z',
        },
        {
          sessionId: 'session-123',
          userId: 'user-456',
          userName: 'Alice',
          action: 'leave',
          timestamp: '2024-01-01T11:00:00Z',
        },
      ];

      mockCollaborationManager.getSessionHistory.mockReturnValue(mockHistory);

      const handler = handlers['collaboration:getSessionHistory'];
      const result = await handler(null, 'doc-123', 100);

      expect(mockCollaborationManager.initialize).toHaveBeenCalledTimes(1);
      expect(mockCollaborationManager.getSessionHistory).toHaveBeenCalledWith('doc-123', 100);
      expect(result).toEqual(mockHistory);
    });

    it('should get session history without limit', async () => {
      const mockHistory = [
        { sessionId: 'session-123', action: 'join' },
        { sessionId: 'session-124', action: 'join' },
      ];

      mockCollaborationManager.getSessionHistory.mockReturnValue(mockHistory);

      const handler = handlers['collaboration:getSessionHistory'];
      const result = await handler(null, 'doc-123', undefined);

      expect(mockCollaborationManager.getSessionHistory).toHaveBeenCalledWith('doc-123', undefined);
      expect(result).toEqual(mockHistory);
    });

    it('should return empty array when no sessions exist', async () => {
      mockCollaborationManager.getSessionHistory.mockReturnValue([]);

      const handler = handlers['collaboration:getSessionHistory'];
      const result = await handler(null, 'doc-123', 10);

      expect(result).toEqual([]);
    });

    it('should throw error when document does not exist', async () => {
      const error = new Error('文档不存在');
      mockCollaborationManager.getSessionHistory.mockImplementation(() => {
        throw error;
      });

      const handler = handlers['collaboration:getSessionHistory'];

      await expect(handler(null, 'doc-999', 10)).rejects.toThrow('文档不存在');
    });

    it('should throw error when initialization fails', async () => {
      const error = new Error('初始化失败');
      mockCollaborationManager.initialize.mockRejectedValue(error);

      const handler = handlers['collaboration:getSessionHistory'];

      await expect(handler(null, 'doc-123', 10)).rejects.toThrow('初始化失败');
    });
  });

  // ============================================================
  // 服务器状态查询测试
  // ============================================================

  describe('collaboration:getStatus', () => {
    it('should get server status when running', async () => {
      const mockStatus = {
        isRunning: true,
        port: 8080,
        url: 'http://localhost:8080',
        activeDocuments: 5,
        totalUsers: 12,
        uptime: 3600000,
        documents: [
          { documentId: 'doc-123', userCount: 3 },
          { documentId: 'doc-456', userCount: 5 },
        ],
      };

      mockCollaborationManager.getStatus.mockReturnValue(mockStatus);

      const handler = handlers['collaboration:getStatus'];
      const result = await handler(null);

      expect(mockCollaborationManager.initialize).toHaveBeenCalledTimes(1);
      expect(mockCollaborationManager.getStatus).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStatus);
    });

    it('should get server status when not running', async () => {
      const mockStatus = {
        isRunning: false,
        port: null,
        url: null,
        activeDocuments: 0,
        totalUsers: 0,
        uptime: 0,
        documents: [],
      };

      mockCollaborationManager.getStatus.mockReturnValue(mockStatus);

      const handler = handlers['collaboration:getStatus'];
      const result = await handler(null);

      expect(result).toEqual(mockStatus);
    });

    it('should throw error when getting status fails', async () => {
      const error = new Error('获取状态失败');
      mockCollaborationManager.getStatus.mockImplementation(() => {
        throw error;
      });

      const handler = handlers['collaboration:getStatus'];

      await expect(handler(null)).rejects.toThrow('获取状态失败');
    });

    it('should throw error when initialization fails', async () => {
      const error = new Error('初始化失败');
      mockCollaborationManager.initialize.mockRejectedValue(error);

      const handler = handlers['collaboration:getStatus'];

      await expect(handler(null)).rejects.toThrow('初始化失败');
    });
  });

  // ============================================================
  // 注册测试
  // ============================================================

  describe('registerCollaborationIPC', () => {
    it('should register all 8 IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledTimes(8);

      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      expect(registeredChannels).toContain('collaboration:startServer');
      expect(registeredChannels).toContain('collaboration:stopServer');
      expect(registeredChannels).toContain('collaboration:joinDocument');
      expect(registeredChannels).toContain('collaboration:submitOperation');
      expect(registeredChannels).toContain('collaboration:getOnlineUsers');
      expect(registeredChannels).toContain('collaboration:getOperationHistory');
      expect(registeredChannels).toContain('collaboration:getSessionHistory');
      expect(registeredChannels).toContain('collaboration:getStatus');
    });

    it('should register handlers in correct order', () => {
      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      expect(registeredChannels[0]).toBe('collaboration:startServer');
      expect(registeredChannels[1]).toBe('collaboration:stopServer');
      expect(registeredChannels[2]).toBe('collaboration:joinDocument');
      expect(registeredChannels[3]).toBe('collaboration:submitOperation');
      expect(registeredChannels[4]).toBe('collaboration:getOnlineUsers');
      expect(registeredChannels[5]).toBe('collaboration:getOperationHistory');
      expect(registeredChannels[6]).toBe('collaboration:getSessionHistory');
      expect(registeredChannels[7]).toBe('collaboration:getStatus');
    });

    it('should handle registration without errors', () => {
      jest.clearAllMocks();

      expect(() => {
        registerCollaborationIPC();
      }).not.toThrow();

      expect(ipcMain.handle).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 边界情况和错误处理测试
  // ============================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle null collaboration manager gracefully', async () => {
      const { getCollaborationManager } = require('../../../desktop-app-vue/src/main/collaboration/collaboration-manager');
      getCollaborationManager.mockReturnValue(null);

      const handler = handlers['collaboration:startServer'];

      await expect(handler(null)).rejects.toThrow();
    });

    it('should handle concurrent operations on same document', async () => {
      const operation1 = { type: 'insert', position: 10, text: 'Hello' };
      const operation2 = { type: 'insert', position: 15, text: 'World' };

      mockCollaborationManager.submitOperation
        .mockResolvedValueOnce({ success: true, operationId: 'op-1', version: 1 })
        .mockResolvedValueOnce({ success: true, operationId: 'op-2', version: 2 });

      const handler = handlers['collaboration:submitOperation'];

      const result1 = await handler(null, 'doc-123', 'user-1', operation1);
      const result2 = await handler(null, 'doc-123', 'user-2', operation2);

      expect(result1.operationId).toBe('op-1');
      expect(result2.operationId).toBe('op-2');
      expect(mockCollaborationManager.submitOperation).toHaveBeenCalledTimes(2);
    });

    it('should handle very large operation history limit', async () => {
      const mockHistory = Array(10000).fill(null).map((_, i) => ({
        operationId: `op-${i}`,
        version: i + 1,
      }));

      mockCollaborationManager.getOperationHistory.mockReturnValue(mockHistory);

      const handler = handlers['collaboration:getOperationHistory'];
      const result = await handler(null, 'doc-123', 10000);

      expect(result.length).toBe(10000);
    });

    it('should handle special characters in document IDs', async () => {
      const specialDocId = 'doc-特殊字符-!@#$%^&*()';
      mockCollaborationManager.joinDocument.mockResolvedValue({
        success: true,
        documentId: specialDocId,
      });

      const handler = handlers['collaboration:joinDocument'];
      const result = await handler(null, 'user-123', 'TestUser', specialDocId);

      expect(mockCollaborationManager.joinDocument).toHaveBeenCalledWith('user-123', 'TestUser', specialDocId);
      expect(result.documentId).toBe(specialDocId);
    });

    it('should handle special characters in usernames', async () => {
      const specialUsername = 'User-用户名-!@#';
      mockCollaborationManager.joinDocument.mockResolvedValue({
        success: true,
        userId: 'user-123',
      });

      const handler = handlers['collaboration:joinDocument'];
      await handler(null, 'user-123', specialUsername, 'doc-123');

      expect(mockCollaborationManager.joinDocument).toHaveBeenCalledWith('user-123', specialUsername, 'doc-123');
    });

    it('should handle server restart scenario', async () => {
      const startResult = { success: true, port: 8080 };
      const stopResult = { success: true };

      mockCollaborationManager.startServer.mockResolvedValue(startResult);
      mockCollaborationManager.stopServer.mockResolvedValue(stopResult);

      const startHandler = handlers['collaboration:startServer'];
      const stopHandler = handlers['collaboration:stopServer'];

      await startHandler(null, { port: 8080 });
      await stopHandler(null);
      await startHandler(null, { port: 8080 });

      expect(mockCollaborationManager.startServer).toHaveBeenCalledTimes(2);
      expect(mockCollaborationManager.stopServer).toHaveBeenCalledTimes(1);
    });
  });
});
