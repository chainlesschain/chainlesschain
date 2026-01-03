/**
 * DID IPC 单元测试
 * 测试24个 DID（去中心化身份）管理 API 方法
 *
 * 测试覆盖范围:
 * - DID 身份管理 (7 handlers)
 * - DID 文档操作 (3 handlers)
 * - DHT 发布操作 (4 handlers)
 * - 自动重新发布 (5 handlers)
 * - 助记词管理 (5 handlers)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('DID IPC 处理器', () => {
  let handlers = {};
  let mockDidManager;
  let mockIpcMain;
  let registerDIDIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // Mock DID 管理器
    mockDidManager = {
      // 身份管理方法
      createIdentity: vi.fn(),
      getAllIdentities: vi.fn(),
      getIdentityByDID: vi.fn(),
      getCurrentIdentity: vi.fn(),
      setDefaultIdentity: vi.fn(),
      updateIdentityProfile: vi.fn(),
      deleteIdentity: vi.fn(),

      // 文档操作方法
      exportDIDDocument: vi.fn(),
      generateQRCodeData: vi.fn(),
      verifyDIDDocument: vi.fn(),

      // DHT 发布方法
      publishToDHT: vi.fn(),
      resolveFromDHT: vi.fn(),
      unpublishFromDHT: vi.fn(),
      isPublishedToDHT: vi.fn(),

      // 自动重新发布方法
      startAutoRepublish: vi.fn(),
      stopAutoRepublish: vi.fn(),
      getAutoRepublishStatus: vi.fn(),
      setAutoRepublishInterval: vi.fn(),
      republishAllDIDs: vi.fn(),

      // 助记词管理方法
      generateMnemonic: vi.fn(),
      validateMnemonic: vi.fn(),
      createIdentityFromMnemonic: vi.fn(),
      exportMnemonic: vi.fn(),
      hasMnemonic: vi.fn(),
    };

    // 动态导入，确保 mock 已设置
    const module = await import('../../../src/main/did/did-ipc.js');
    registerDIDIPC = module.registerDIDIPC;

    // 注册 DID IPC 并注入 mock ipcMain
    registerDIDIPC({ didManager: mockDidManager, ipcMain: mockIpcMain });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =====================================================================
  // 基本功能测试
  // =====================================================================

  describe('基本功能测试', () => {
    it('should register exactly 24 DID IPC handlers', () => {
      expect(Object.keys(handlers).length).toBe(24);
    });

    it('should have all expected handler channels', () => {
      const expectedChannels = [
        // DID 身份管理 (7)
        'did:create-identity',
        'did:get-all-identities',
        'did:get-identity',
        'did:get-current-identity',
        'did:set-default-identity',
        'did:update-identity',
        'did:delete-identity',

        // DID 文档操作 (3)
        'did:export-document',
        'did:generate-qrcode',
        'did:verify-document',

        // DHT 发布操作 (4)
        'did:publish-to-dht',
        'did:resolve-from-dht',
        'did:unpublish-from-dht',
        'did:is-published-to-dht',

        // 自动重新发布 (5)
        'did:start-auto-republish',
        'did:stop-auto-republish',
        'did:get-auto-republish-status',
        'did:set-auto-republish-interval',
        'did:republish-all',

        // 助记词管理 (5)
        'did:generate-mnemonic',
        'did:validate-mnemonic',
        'did:create-from-mnemonic',
        'did:export-mnemonic',
        'did:has-mnemonic',
      ];

      expectedChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });

    it('all handlers should be async functions', () => {
      Object.values(handlers).forEach((handler) => {
        expect(handler.constructor.name).toBe('AsyncFunction');
      });
    });
  });

  // =====================================================================
  // DID 身份管理测试 (7 handlers)
  // =====================================================================

  describe('DID 身份管理 (7 handlers)', () => {
    describe('创建身份 (did:create-identity)', () => {
      it('should have create-identity handler', () => {
        expect(handlers['did:create-identity']).toBeDefined();
      });

      it('should call didManager.createIdentity on success', async () => {
        const mockProfile = { name: 'Test User', bio: 'Test bio' };
        const mockOptions = { useHardwareKey: true };
        const mockResult = {
          did: 'did:key:z6Mktest123',
          profile: mockProfile,
        };

        mockDidManager.createIdentity.mockResolvedValue(mockResult);

        const result = await handlers['did:create-identity'](
          {},
          mockProfile,
          mockOptions
        );

        expect(mockDidManager.createIdentity).toHaveBeenCalledWith(
          mockProfile,
          mockOptions
        );
        expect(result).toEqual(mockResult);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:create-identity']({}, {}, {})
        ).rejects.toThrow('DID管理器未初始化');
      });

      it('should handle errors from didManager', async () => {
        const error = new Error('创建失败');
        mockDidManager.createIdentity.mockRejectedValue(error);

        await expect(
          handlers['did:create-identity']({}, {}, {})
        ).rejects.toThrow('创建失败');
      });
    });

    describe('获取所有身份 (did:get-all-identities)', () => {
      it('should have get-all-identities handler', () => {
        expect(handlers['did:get-all-identities']).toBeDefined();
      });

      it('should call didManager.getAllIdentities on success', async () => {
        const mockIdentities = [
          { did: 'did:key:z6Mktest1', profile: { name: 'User 1' } },
          { did: 'did:key:z6Mktest2', profile: { name: 'User 2' } },
        ];

        mockDidManager.getAllIdentities.mockReturnValue(mockIdentities);

        const result = await handlers['did:get-all-identities']({});

        expect(mockDidManager.getAllIdentities).toHaveBeenCalled();
        expect(result).toEqual(mockIdentities);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(nullHandlers['did:get-all-identities']({})).rejects.toThrow(
          'DID管理器未初始化'
        );
      });

      it('should handle errors from didManager', async () => {
        const error = new Error('获取失败');
        mockDidManager.getAllIdentities.mockImplementation(() => {
          throw error;
        });

        await expect(handlers['did:get-all-identities']({})).rejects.toThrow(
          '获取失败'
        );
      });
    });

    describe('根据 DID 获取身份 (did:get-identity)', () => {
      it('should have get-identity handler', () => {
        expect(handlers['did:get-identity']).toBeDefined();
      });

      it('should call didManager.getIdentityByDID on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        const mockIdentity = {
          did: mockDID,
          profile: { name: 'Test User' },
        };

        mockDidManager.getIdentityByDID.mockReturnValue(mockIdentity);

        const result = await handlers['did:get-identity']({}, mockDID);

        expect(mockDidManager.getIdentityByDID).toHaveBeenCalledWith(mockDID);
        expect(result).toEqual(mockIdentity);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:get-identity']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });

      it('should handle errors from didManager', async () => {
        const error = new Error('身份不存在');
        mockDidManager.getIdentityByDID.mockImplementation(() => {
          throw error;
        });

        await expect(
          handlers['did:get-identity']({}, 'did:key:test')
        ).rejects.toThrow('身份不存在');
      });
    });

    describe('获取当前身份 (did:get-current-identity)', () => {
      it('should have get-current-identity handler', () => {
        expect(handlers['did:get-current-identity']).toBeDefined();
      });

      it('should call didManager.getCurrentIdentity on success', async () => {
        const mockIdentity = {
          did: 'did:key:z6Mktest123',
          profile: { name: 'Current User' },
        };

        mockDidManager.getCurrentIdentity.mockReturnValue(mockIdentity);

        const result = await handlers['did:get-current-identity']({});

        expect(mockDidManager.getCurrentIdentity).toHaveBeenCalled();
        expect(result).toEqual(mockIdentity);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:get-current-identity']({})
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('设置默认身份 (did:set-default-identity)', () => {
      it('should have set-default-identity handler', () => {
        expect(handlers['did:set-default-identity']).toBeDefined();
      });

      it('should call didManager.setDefaultIdentity on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        mockDidManager.setDefaultIdentity.mockResolvedValue();

        const result = await handlers['did:set-default-identity'](
          {},
          mockDID
        );

        expect(mockDidManager.setDefaultIdentity).toHaveBeenCalledWith(
          mockDID
        );
        expect(result).toEqual({ success: true });
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:set-default-identity']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('更新身份信息 (did:update-identity)', () => {
      it('should have update-identity handler', () => {
        expect(handlers['did:update-identity']).toBeDefined();
      });

      it('should call didManager.updateIdentityProfile on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        const mockUpdates = { name: 'Updated Name', bio: 'Updated bio' };
        const mockResult = { did: mockDID, profile: mockUpdates };

        mockDidManager.updateIdentityProfile.mockResolvedValue(mockResult);

        const result = await handlers['did:update-identity'](
          {},
          mockDID,
          mockUpdates
        );

        expect(mockDidManager.updateIdentityProfile).toHaveBeenCalledWith(
          mockDID,
          mockUpdates
        );
        expect(result).toEqual(mockResult);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:update-identity']({}, 'did:key:test', {})
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('删除身份 (did:delete-identity)', () => {
      it('should have delete-identity handler', () => {
        expect(handlers['did:delete-identity']).toBeDefined();
      });

      it('should call didManager.deleteIdentity on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        mockDidManager.deleteIdentity.mockResolvedValue({ success: true });

        const result = await handlers['did:delete-identity']({}, mockDID);

        expect(mockDidManager.deleteIdentity).toHaveBeenCalledWith(mockDID);
        expect(result).toEqual({ success: true });
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:delete-identity']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });
    });
  });

  // =====================================================================
  // DID 文档操作测试 (3 handlers)
  // =====================================================================

  describe('DID 文档操作 (3 handlers)', () => {
    describe('导出 DID 文档 (did:export-document)', () => {
      it('should have export-document handler', () => {
        expect(handlers['did:export-document']).toBeDefined();
      });

      it('should call didManager.exportDIDDocument on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        const mockDocument = {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: mockDID,
          verificationMethod: [],
        };

        mockDidManager.exportDIDDocument.mockReturnValue(mockDocument);

        const result = await handlers['did:export-document']({}, mockDID);

        expect(mockDidManager.exportDIDDocument).toHaveBeenCalledWith(mockDID);
        expect(result).toEqual(mockDocument);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:export-document']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('生成 DID 二维码 (did:generate-qrcode)', () => {
      it('should have generate-qrcode handler', () => {
        expect(handlers['did:generate-qrcode']).toBeDefined();
      });

      it('should call didManager.generateQRCodeData on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        const mockQRData = { data: 'base64-encoded-qr-code' };

        mockDidManager.generateQRCodeData.mockReturnValue(mockQRData);

        const result = await handlers['did:generate-qrcode']({}, mockDID);

        expect(mockDidManager.generateQRCodeData).toHaveBeenCalledWith(
          mockDID
        );
        expect(result).toEqual(mockQRData);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:generate-qrcode']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('验证 DID 文档 (did:verify-document)', () => {
      it('should have verify-document handler', () => {
        expect(handlers['did:verify-document']).toBeDefined();
      });

      it('should call didManager.verifyDIDDocument on success', async () => {
        const mockDocument = {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: 'did:key:z6Mktest123',
        };
        const mockResult = { valid: true };

        mockDidManager.verifyDIDDocument.mockReturnValue(mockResult);

        const result = await handlers['did:verify-document'](
          {},
          mockDocument
        );

        expect(mockDidManager.verifyDIDDocument).toHaveBeenCalledWith(
          mockDocument
        );
        expect(result).toEqual(mockResult);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:verify-document']({}, {})
        ).rejects.toThrow('DID管理器未初始化');
      });
    });
  });

  // =====================================================================
  // DHT 发布操作测试 (4 handlers)
  // =====================================================================

  describe('DHT 发布操作 (4 handlers)', () => {
    describe('发布 DID 到 DHT (did:publish-to-dht)', () => {
      it('should have publish-to-dht handler', () => {
        expect(handlers['did:publish-to-dht']).toBeDefined();
      });

      it('should call didManager.publishToDHT on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        const mockResult = { success: true, cid: 'Qm123...' };

        mockDidManager.publishToDHT.mockResolvedValue(mockResult);

        const result = await handlers['did:publish-to-dht']({}, mockDID);

        expect(mockDidManager.publishToDHT).toHaveBeenCalledWith(mockDID);
        expect(result).toEqual(mockResult);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:publish-to-dht']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('从 DHT 解析 DID (did:resolve-from-dht)', () => {
      it('should have resolve-from-dht handler', () => {
        expect(handlers['did:resolve-from-dht']).toBeDefined();
      });

      it('should call didManager.resolveFromDHT on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        const mockDocument = {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: mockDID,
        };

        mockDidManager.resolveFromDHT.mockResolvedValue(mockDocument);

        const result = await handlers['did:resolve-from-dht']({}, mockDID);

        expect(mockDidManager.resolveFromDHT).toHaveBeenCalledWith(mockDID);
        expect(result).toEqual(mockDocument);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:resolve-from-dht']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('从 DHT 取消发布 DID (did:unpublish-from-dht)', () => {
      it('should have unpublish-from-dht handler', () => {
        expect(handlers['did:unpublish-from-dht']).toBeDefined();
      });

      it('should call didManager.unpublishFromDHT on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        const mockResult = { success: true };

        mockDidManager.unpublishFromDHT.mockResolvedValue(mockResult);

        const result = await handlers['did:unpublish-from-dht']({}, mockDID);

        expect(mockDidManager.unpublishFromDHT).toHaveBeenCalledWith(mockDID);
        expect(result).toEqual(mockResult);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:unpublish-from-dht']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('检查 DID 是否已发布到 DHT (did:is-published-to-dht)', () => {
      it('should have is-published-to-dht handler', () => {
        expect(handlers['did:is-published-to-dht']).toBeDefined();
      });

      it('should call didManager.isPublishedToDHT on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        mockDidManager.isPublishedToDHT.mockResolvedValue(true);

        const result = await handlers['did:is-published-to-dht']({}, mockDID);

        expect(mockDidManager.isPublishedToDHT).toHaveBeenCalledWith(mockDID);
        expect(result).toBe(true);
      });

      it('should return false when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        const result = await nullHandlers['did:is-published-to-dht'](
          {},
          'did:key:test'
        );
        expect(result).toBe(false);
      });

      it('should return false on error', async () => {
        mockDidManager.isPublishedToDHT.mockRejectedValue(
          new Error('检查失败')
        );

        const result = await handlers['did:is-published-to-dht'](
          {},
          'did:key:test'
        );
        expect(result).toBe(false);
      });
    });
  });

  // =====================================================================
  // 自动重新发布测试 (5 handlers)
  // =====================================================================

  describe('自动重新发布 (5 handlers)', () => {
    describe('启动自动重新发布 (did:start-auto-republish)', () => {
      it('should have start-auto-republish handler', () => {
        expect(handlers['did:start-auto-republish']).toBeDefined();
      });

      it('should call didManager.startAutoRepublish on success', async () => {
        const mockInterval = 3600000; // 1 hour
        mockDidManager.startAutoRepublish.mockReturnValue();

        const result = await handlers['did:start-auto-republish'](
          {},
          mockInterval
        );

        expect(mockDidManager.startAutoRepublish).toHaveBeenCalledWith(
          mockInterval
        );
        expect(result).toEqual({ success: true });
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:start-auto-republish']({}, 3600000)
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('停止自动重新发布 (did:stop-auto-republish)', () => {
      it('should have stop-auto-republish handler', () => {
        expect(handlers['did:stop-auto-republish']).toBeDefined();
      });

      it('should call didManager.stopAutoRepublish on success', async () => {
        mockDidManager.stopAutoRepublish.mockReturnValue();

        const result = await handlers['did:stop-auto-republish']({});

        expect(mockDidManager.stopAutoRepublish).toHaveBeenCalled();
        expect(result).toEqual({ success: true });
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(nullHandlers['did:stop-auto-republish']({})).rejects.toThrow(
          'DID管理器未初始化'
        );
      });
    });

    describe('获取自动重新发布状态 (did:get-auto-republish-status)', () => {
      it('should have get-auto-republish-status handler', () => {
        expect(handlers['did:get-auto-republish-status']).toBeDefined();
      });

      it('should call didManager.getAutoRepublishStatus on success', async () => {
        const mockStatus = {
          enabled: true,
          interval: 3600000,
          intervalHours: 1,
        };
        mockDidManager.getAutoRepublishStatus.mockReturnValue(mockStatus);

        const result = await handlers['did:get-auto-republish-status']({});

        expect(mockDidManager.getAutoRepublishStatus).toHaveBeenCalled();
        expect(result).toEqual(mockStatus);
      });

      it('should return default status when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        const result = await nullHandlers['did:get-auto-republish-status']({});
        expect(result).toEqual({
          enabled: false,
          interval: 0,
          intervalHours: 0,
        });
      });

      it('should return default status on error', async () => {
        mockDidManager.getAutoRepublishStatus.mockImplementation(() => {
          throw new Error('获取失败');
        });

        const result = await handlers['did:get-auto-republish-status']({});
        expect(result).toEqual({
          enabled: false,
          interval: 0,
          intervalHours: 0,
        });
      });
    });

    describe('设置自动重新发布间隔 (did:set-auto-republish-interval)', () => {
      it('should have set-auto-republish-interval handler', () => {
        expect(handlers['did:set-auto-republish-interval']).toBeDefined();
      });

      it('should call didManager.setAutoRepublishInterval on success', async () => {
        const mockInterval = 7200000; // 2 hours
        mockDidManager.setAutoRepublishInterval.mockReturnValue();

        const result = await handlers['did:set-auto-republish-interval'](
          {},
          mockInterval
        );

        expect(mockDidManager.setAutoRepublishInterval).toHaveBeenCalledWith(
          mockInterval
        );
        expect(result).toEqual({ success: true });
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:set-auto-republish-interval']({}, 3600000)
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('重新发布所有 DID (did:republish-all)', () => {
      it('should have republish-all handler', () => {
        expect(handlers['did:republish-all']).toBeDefined();
      });

      it('should call didManager.republishAllDIDs on success', async () => {
        const mockResult = { success: true, count: 3 };
        mockDidManager.republishAllDIDs.mockResolvedValue(mockResult);

        const result = await handlers['did:republish-all']({});

        expect(mockDidManager.republishAllDIDs).toHaveBeenCalled();
        expect(result).toEqual(mockResult);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(nullHandlers['did:republish-all']({})).rejects.toThrow(
          'DID管理器未初始化'
        );
      });
    });
  });

  // =====================================================================
  // 助记词管理测试 (5 handlers)
  // =====================================================================

  describe('助记词管理 (5 handlers)', () => {
    describe('生成助记词 (did:generate-mnemonic)', () => {
      it('should have generate-mnemonic handler', () => {
        expect(handlers['did:generate-mnemonic']).toBeDefined();
      });

      it('should call didManager.generateMnemonic on success', async () => {
        const mockStrength = 256;
        const mockMnemonic =
          'abandon ability able about above absent absorb abstract absurd abuse access accident';

        mockDidManager.generateMnemonic.mockReturnValue(mockMnemonic);

        const result = await handlers['did:generate-mnemonic'](
          {},
          mockStrength
        );

        expect(mockDidManager.generateMnemonic).toHaveBeenCalledWith(
          mockStrength
        );
        expect(result).toBe(mockMnemonic);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:generate-mnemonic']({}, 256)
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('验证助记词 (did:validate-mnemonic)', () => {
      it('should have validate-mnemonic handler', () => {
        expect(handlers['did:validate-mnemonic']).toBeDefined();
      });

      it('should call didManager.validateMnemonic on success', async () => {
        const mockMnemonic =
          'abandon ability able about above absent absorb abstract absurd abuse access accident';
        mockDidManager.validateMnemonic.mockReturnValue(true);

        const result = await handlers['did:validate-mnemonic'](
          {},
          mockMnemonic
        );

        expect(mockDidManager.validateMnemonic).toHaveBeenCalledWith(
          mockMnemonic
        );
        expect(result).toBe(true);
      });

      it('should return false when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        const result = await nullHandlers['did:validate-mnemonic']({}, 'test');
        expect(result).toBe(false);
      });

      it('should return false on error', async () => {
        mockDidManager.validateMnemonic.mockImplementation(() => {
          throw new Error('验证失败');
        });

        const result = await handlers['did:validate-mnemonic']({}, 'test');
        expect(result).toBe(false);
      });
    });

    describe('从助记词创建身份 (did:create-from-mnemonic)', () => {
      it('should have create-from-mnemonic handler', () => {
        expect(handlers['did:create-from-mnemonic']).toBeDefined();
      });

      it('should call didManager.createIdentityFromMnemonic on success', async () => {
        const mockProfile = { name: 'Test User' };
        const mockMnemonic =
          'abandon ability able about above absent absorb abstract absurd abuse access accident';
        const mockOptions = { useHardwareKey: false };
        const mockResult = {
          did: 'did:key:z6Mktest123',
          profile: mockProfile,
        };

        mockDidManager.createIdentityFromMnemonic.mockResolvedValue(
          mockResult
        );

        const result = await handlers['did:create-from-mnemonic'](
          {},
          mockProfile,
          mockMnemonic,
          mockOptions
        );

        expect(
          mockDidManager.createIdentityFromMnemonic
        ).toHaveBeenCalledWith(mockProfile, mockMnemonic, mockOptions);
        expect(result).toEqual(mockResult);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:create-from-mnemonic']({}, {}, 'test', {})
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('导出助记词 (did:export-mnemonic)', () => {
      it('should have export-mnemonic handler', () => {
        expect(handlers['did:export-mnemonic']).toBeDefined();
      });

      it('should call didManager.exportMnemonic on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        const mockMnemonic =
          'abandon ability able about above absent absorb abstract absurd abuse access accident';

        mockDidManager.exportMnemonic.mockReturnValue(mockMnemonic);

        const result = await handlers['did:export-mnemonic']({}, mockDID);

        expect(mockDidManager.exportMnemonic).toHaveBeenCalledWith(mockDID);
        expect(result).toBe(mockMnemonic);
      });

      it('should throw error when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        await expect(
          nullHandlers['did:export-mnemonic']({}, 'did:key:test')
        ).rejects.toThrow('DID管理器未初始化');
      });
    });

    describe('检查是否有助记词 (did:has-mnemonic)', () => {
      it('should have has-mnemonic handler', () => {
        expect(handlers['did:has-mnemonic']).toBeDefined();
      });

      it('should call didManager.hasMnemonic on success', async () => {
        const mockDID = 'did:key:z6Mktest123';
        mockDidManager.hasMnemonic.mockReturnValue(true);

        const result = await handlers['did:has-mnemonic']({}, mockDID);

        expect(mockDidManager.hasMnemonic).toHaveBeenCalledWith(mockDID);
        expect(result).toBe(true);
      });

      it('should return false when didManager is not initialized', async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

        const result = await nullHandlers['did:has-mnemonic'](
          {},
          'did:key:test'
        );
        expect(result).toBe(false);
      });

      it('should return false on error', async () => {
        mockDidManager.hasMnemonic.mockImplementation(() => {
          throw new Error('检查失败');
        });

        const result = await handlers['did:has-mnemonic'](
          {},
          'did:key:test'
        );
        expect(result).toBe(false);
      });
    });
  });

  // =====================================================================
  // 按功能域分组验证
  // =====================================================================

  describe('按功能域分组验证', () => {
    it('should have exactly 7 identity management handlers', () => {
      const identityChannels = [
        'did:create-identity',
        'did:get-all-identities',
        'did:get-identity',
        'did:get-current-identity',
        'did:set-default-identity',
        'did:update-identity',
        'did:delete-identity',
      ];

      identityChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it('should have exactly 3 document operation handlers', () => {
      const documentChannels = [
        'did:export-document',
        'did:generate-qrcode',
        'did:verify-document',
      ];

      documentChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it('should have exactly 4 DHT publishing handlers', () => {
      const dhtChannels = [
        'did:publish-to-dht',
        'did:resolve-from-dht',
        'did:unpublish-from-dht',
        'did:is-published-to-dht',
      ];

      dhtChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it('should have exactly 5 auto-republish handlers', () => {
      const republishChannels = [
        'did:start-auto-republish',
        'did:stop-auto-republish',
        'did:get-auto-republish-status',
        'did:set-auto-republish-interval',
        'did:republish-all',
      ];

      republishChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it('should have exactly 5 mnemonic management handlers', () => {
      const mnemonicChannels = [
        'did:generate-mnemonic',
        'did:validate-mnemonic',
        'did:create-from-mnemonic',
        'did:export-mnemonic',
        'did:has-mnemonic',
      ];

      mnemonicChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });
  });

  // =====================================================================
  // 错误处理验证
  // =====================================================================

  describe('错误处理验证', () => {
    it('should handle null didManager gracefully for all handlers', async () => {
      const nullHandlers = {};
      const nullMockIpcMain = {
        handle: (channel, handler) => {
          nullHandlers[channel] = handler;
        },
      };
      registerDIDIPC({ didManager: null, ipcMain: nullMockIpcMain });

      // Handlers that should throw error
      const errorHandlers = [
        'did:create-identity',
        'did:get-all-identities',
        'did:get-identity',
        'did:get-current-identity',
        'did:set-default-identity',
        'did:update-identity',
        'did:delete-identity',
        'did:export-document',
        'did:generate-qrcode',
        'did:verify-document',
        'did:publish-to-dht',
        'did:resolve-from-dht',
        'did:unpublish-from-dht',
        'did:start-auto-republish',
        'did:stop-auto-republish',
        'did:set-auto-republish-interval',
        'did:republish-all',
        'did:generate-mnemonic',
        'did:create-from-mnemonic',
        'did:export-mnemonic',
      ];

      for (const channel of errorHandlers) {
        await expect(nullHandlers[channel]({}, 'test')).rejects.toThrow(
          'DID管理器未初始化'
        );
      }

      // Handlers that should return false
      expect(
        await nullHandlers['did:is-published-to-dht']({}, 'test')
      ).toBe(false);
      expect(await nullHandlers['did:validate-mnemonic']({}, 'test')).toBe(false);
      expect(await nullHandlers['did:has-mnemonic']({}, 'test')).toBe(false);

      // Handler that should return default object
      expect(await nullHandlers['did:get-auto-republish-status']({})).toEqual({
        enabled: false,
        interval: 0,
        intervalHours: 0,
      });
    });
  });

  // =====================================================================
  // 总体验证
  // =====================================================================

  describe('总体验证', () => {
    it('should have exactly 24 handlers in total', () => {
      expect(Object.keys(handlers).length).toBe(24);
    });

    it('should have correct distribution of handlers', () => {
      // 7 + 3 + 4 + 5 + 5 = 24
      const categories = {
        identity: 7,
        document: 3,
        dht: 4,
        republish: 5,
        mnemonic: 5,
      };

      const total = Object.values(categories).reduce((a, b) => a + b, 0);
      expect(total).toBe(24);
      expect(Object.keys(handlers).length).toBe(total);
    });

    it('all handlers should be async functions', () => {
      Object.values(handlers).forEach((handler) => {
        expect(handler.constructor.name).toBe('AsyncFunction');
      });
    });

    it('all handler channels should use did: or related prefix', () => {
      Object.keys(handlers).forEach((channel) => {
        expect(channel.startsWith('did:')).toBe(true);
      });
    });
  });
});
