/**
 * DID Updater 单元测试
 * 测试目标: src/main/did/did-updater.js
 *
 * 覆盖场景:
 * - DID 文档版本管理
 * - 自动更新检测
 * - 自动重新发布
 * - 版本历史记录
 * - 变更检测
 * - 冲突解决
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// Mock logger
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: vi.fn(),
}));

describe('DIDUpdater', () => {
  let DIDUpdater;
  let didUpdater;
  let mockDidManager;
  let mockP2PManager;
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock database
    mockDb = {
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }),
      saveToFile: vi.fn(),
    };

    // Mock DID Manager
    mockDidManager = {
      db: mockDb,
      publishToDHT: vi.fn().mockResolvedValue({ success: true }),
      resolveFromDHT: vi.fn(),
      getIdentityByDID: vi.fn(),
    };

    // Mock P2P Manager
    mockP2PManager = {
      isInitialized: vi.fn().mockReturnValue(true),
    };

    // 动态导入 DIDUpdater
    const module = await import('../../../src/main/did/did-updater.js');
    DIDUpdater = module.DIDUpdater;

    didUpdater = new DIDUpdater(mockDidManager, mockP2PManager);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    didUpdater = null;
  });

  // =====================================================================
  // 构造函数测试
  // =====================================================================

  describe('构造函数', () => {
    it('应该正确初始化 DIDUpdater', () => {
      expect(didUpdater.didManager).toBe(mockDidManager);
      expect(didUpdater.p2pManager).toBe(mockP2PManager);
      expect(didUpdater.updateTimers).toBeInstanceOf(Map);
      expect(didUpdater.republishTimers).toBeInstanceOf(Map);
    });

    it('应该使用默认配置', () => {
      expect(didUpdater.config).toMatchObject({
        updateInterval: 24 * 60 * 60 * 1000,
        autoRepublish: true,
        republishInterval: 24 * 60 * 60 * 1000,
        enableVersioning: true,
        maxVersionHistory: 10,
      });
    });

    it('应该支持自定义配置', () => {
      const customConfig = {
        updateInterval: 12 * 60 * 60 * 1000,
        maxVersionHistory: 5,
      };

      const customUpdater = new DIDUpdater(mockDidManager, mockP2PManager, customConfig);

      expect(customUpdater.config.updateInterval).toBe(12 * 60 * 60 * 1000);
      expect(customUpdater.config.maxVersionHistory).toBe(5);
    });
  });

  // =====================================================================
  // 初始化测试
  // =====================================================================

  describe('初始化', () => {
    it('应该成功初始化', async () => {
      const result = await didUpdater.initialize();

      expect(result).toBe(true);
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS did_version_history')
      );
    });

    it('应该创建版本历史表', async () => {
      await didUpdater.initialize();

      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS did_version_history')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_did_version_history_did')
      );
    });

    it('应该触发 initialized 事件', async () => {
      const initSpy = vi.fn();
      didUpdater.on('initialized', initSpy);

      await didUpdater.initialize();

      expect(initSpy).toHaveBeenCalled();
    });

    it('初始化失败时应该抛出错误', async () => {
      mockDb.exec = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(didUpdater.initialize()).rejects.toThrow('Database error');
    });
  });

  // =====================================================================
  // 自动更新测试
  // =====================================================================

  describe('自动更新', () => {
    it('应该启动自动更新', () => {
      const did = 'did:chainlesschain:test123';

      didUpdater.startAutoUpdate(did);

      expect(didUpdater.updateTimers.has(did)).toBe(true);
    });

    it('应该触发 auto-update-started 事件', () => {
      const startSpy = vi.fn();
      didUpdater.on('auto-update-started', startSpy);

      const did = 'did:chainlesschain:test123';
      didUpdater.startAutoUpdate(did);

      expect(startSpy).toHaveBeenCalledWith({ did });
    });

    it('重复启动应该忽略', () => {
      const did = 'did:chainlesschain:test123';

      didUpdater.startAutoUpdate(did);
      const timer1 = didUpdater.updateTimers.get(did);

      didUpdater.startAutoUpdate(did);
      const timer2 = didUpdater.updateTimers.get(did);

      expect(timer1).toBe(timer2);
    });

    it('应该停止自动更新', () => {
      const did = 'did:chainlesschain:test123';

      didUpdater.startAutoUpdate(did);
      didUpdater.stopAutoUpdate(did);

      expect(didUpdater.updateTimers.has(did)).toBe(false);
    });

    it('应该触发 auto-update-stopped 事件', () => {
      const stopSpy = vi.fn();
      didUpdater.on('auto-update-stopped', stopSpy);

      const did = 'did:chainlesschain:test123';
      didUpdater.startAutoUpdate(did);
      didUpdater.stopAutoUpdate(did);

      expect(stopSpy).toHaveBeenCalledWith({ did });
    });

    it('应该定期检查更新', async () => {
      const did = 'did:chainlesschain:test123';

      // Mock checkAndUpdate
      didUpdater.checkAndUpdate = vi.fn().mockResolvedValue({ updated: false });

      didUpdater.config.updateInterval = 1000;
      didUpdater.startAutoUpdate(did);

      // 快进时间
      await vi.advanceTimersByTimeAsync(1000);

      expect(didUpdater.checkAndUpdate).toHaveBeenCalledWith(did);
    });
  });

  // =====================================================================
  // 自动重新发布测试
  // =====================================================================

  describe('自动重新发布', () => {
    it('应该启动自动重新发布', () => {
      const did = 'did:chainlesschain:test123';

      didUpdater.startAutoRepublish(did);

      expect(didUpdater.republishTimers.has(did)).toBe(true);
    });

    it('autoRepublish 禁用时不应该启动', () => {
      didUpdater.config.autoRepublish = false;
      const did = 'did:chainlesschain:test123';

      didUpdater.startAutoRepublish(did);

      expect(didUpdater.republishTimers.has(did)).toBe(false);
    });

    it('应该停止自动重新发布', () => {
      const did = 'did:chainlesschain:test123';

      didUpdater.startAutoRepublish(did);
      didUpdater.stopAutoRepublish(did);

      expect(didUpdater.republishTimers.has(did)).toBe(false);
    });

    it('应该定期重新发布', async () => {
      const did = 'did:chainlesschain:test123';

      didUpdater.republish = vi.fn().mockResolvedValue({ success: true });
      didUpdater.config.republishInterval = 1000;

      didUpdater.startAutoRepublish(did);

      // 快进时间
      await vi.advanceTimersByTimeAsync(1000);

      expect(didUpdater.republish).toHaveBeenCalledWith(did);
    });
  });

  // =====================================================================
  // 更新检测测试
  // =====================================================================

  describe('checkAndUpdate', () => {
    it('远程 DID 更新时应该更新本地', async () => {
      const did = 'did:chainlesschain:test123';
      const localDoc = {
        id: did,
        version: 1,
        updated: '2024-01-01T00:00:00Z',
      };
      const remoteDoc = {
        id: did,
        version: 2,
        updated: '2024-01-02T00:00:00Z',
      };

      mockDidManager.resolveFromDHT = vi.fn().mockResolvedValue({
        didDocument: remoteDoc,
        publicKeySign: 'pk_sign',
        publicKeyEncrypt: 'pk_encrypt',
      });
      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue({
        did,
        did_document: JSON.stringify(localDoc),
      });

      const result = await didUpdater.checkAndUpdate(did);

      expect(result.updated).toBe(true);
      expect(result.oldVersion).toBe(1);
      expect(result.newVersion).toBe(2);
    });

    it('版本相同时不应该更新', async () => {
      const did = 'did:chainlesschain:test123';
      const sameDoc = {
        id: did,
        version: 1,
        updated: '2024-01-01T00:00:00Z',
      };

      mockDidManager.resolveFromDHT = vi.fn().mockResolvedValue({
        didDocument: sameDoc,
      });
      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue({
        did,
        did_document: JSON.stringify(sameDoc),
      });

      const result = await didUpdater.checkAndUpdate(did);

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('up-to-date');
    });

    it('DHT 中不存在时应该返回未找到', async () => {
      const did = 'did:chainlesschain:test123';

      mockDidManager.resolveFromDHT = vi.fn().mockResolvedValue(null);

      const result = await didUpdater.checkAndUpdate(did);

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('not-found-in-dht');
    });

    it('本地不存在时应该返回未找到', async () => {
      const did = 'did:chainlesschain:test123';

      mockDidManager.resolveFromDHT = vi.fn().mockResolvedValue({
        didDocument: { id: did },
      });
      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue(null);

      const result = await didUpdater.checkAndUpdate(did);

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('not-found-locally');
    });

    it('应该触发 did-updated 事件', async () => {
      const updateSpy = vi.fn();
      didUpdater.on('did-updated', updateSpy);

      const did = 'did:chainlesschain:test123';
      const localDoc = { id: did, version: 1, updated: '2024-01-01T00:00:00Z' };
      const remoteDoc = { id: did, version: 2, updated: '2024-01-02T00:00:00Z' };

      mockDidManager.resolveFromDHT = vi.fn().mockResolvedValue({
        didDocument: remoteDoc,
        publicKeySign: 'pk_sign',
        publicKeyEncrypt: 'pk_encrypt',
      });
      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue({
        did,
        did_document: JSON.stringify(localDoc),
      });

      await didUpdater.checkAndUpdate(did);

      expect(updateSpy).toHaveBeenCalled();
      expect(updateSpy.mock.calls[0][0]).toHaveProperty('did', did);
      expect(updateSpy.mock.calls[0][0]).toHaveProperty('oldVersion', 1);
      expect(updateSpy.mock.calls[0][0]).toHaveProperty('newVersion', 2);
    });
  });

  // =====================================================================
  // 版本判断测试
  // =====================================================================

  describe('needsUpdate', () => {
    it('远程版本更高时应该返回 true', () => {
      const localDoc = { version: 1 };
      const remoteDoc = { version: 2 };

      const result = didUpdater.needsUpdate(localDoc, remoteDoc);

      expect(result).toBe(true);
    });

    it('远程版本相同但更新时间更新时应该返回 true', () => {
      const localDoc = {
        version: 1,
        updated: '2024-01-01T00:00:00Z',
      };
      const remoteDoc = {
        version: 1,
        updated: '2024-01-02T00:00:00Z',
      };

      const result = didUpdater.needsUpdate(localDoc, remoteDoc);

      expect(result).toBe(true);
    });

    it('版本和时间都相同时应该返回 false', () => {
      const localDoc = {
        version: 1,
        updated: '2024-01-01T00:00:00Z',
      };
      const remoteDoc = {
        version: 1,
        updated: '2024-01-01T00:00:00Z',
      };

      const result = didUpdater.needsUpdate(localDoc, remoteDoc);

      expect(result).toBe(false);
    });

    it('本地版本更高时应该返回 false', () => {
      const localDoc = { version: 2 };
      const remoteDoc = { version: 1 };

      const result = didUpdater.needsUpdate(localDoc, remoteDoc);

      expect(result).toBe(false);
    });
  });

  // =====================================================================
  // 变更检测测试
  // =====================================================================

  describe('detectChanges', () => {
    it('应该检测验证方法变更', () => {
      const oldDoc = {
        verificationMethod: [{ id: 'key1', type: 'Ed25519' }],
      };
      const newDoc = {
        verificationMethod: [{ id: 'key2', type: 'Ed25519' }],
      };

      const changes = didUpdater.detectChanges(oldDoc, newDoc);

      expect(changes).toContain('verificationMethod');
    });

    it('应该检测认证方法变更', () => {
      const oldDoc = {
        verificationMethod: [],
        authentication: ['#key1'],
      };
      const newDoc = {
        verificationMethod: [],
        authentication: ['#key2'],
      };

      const changes = didUpdater.detectChanges(oldDoc, newDoc);

      expect(changes).toContain('authentication');
    });

    it('应该检测密钥协商变更', () => {
      const oldDoc = {
        verificationMethod: [],
        authentication: [],
        keyAgreement: ['#key1'],
      };
      const newDoc = {
        verificationMethod: [],
        authentication: [],
        keyAgreement: ['#key2'],
      };

      const changes = didUpdater.detectChanges(oldDoc, newDoc);

      expect(changes).toContain('keyAgreement');
    });

    it('应该检测服务端点变更', () => {
      const oldDoc = {
        verificationMethod: [],
        authentication: [],
        keyAgreement: [],
        service: [{ type: 'P2P', endpoint: 'addr1' }],
      };
      const newDoc = {
        verificationMethod: [],
        authentication: [],
        keyAgreement: [],
        service: [{ type: 'P2P', endpoint: 'addr2' }],
      };

      const changes = didUpdater.detectChanges(oldDoc, newDoc);

      expect(changes).toContain('service');
    });

    it('无变更时应该返回空数组', () => {
      const doc = {
        verificationMethod: [],
        authentication: [],
        keyAgreement: [],
        service: [],
      };

      const changes = didUpdater.detectChanges(doc, doc);

      expect(changes).toEqual([]);
    });
  });

  // =====================================================================
  // 版本历史测试
  // =====================================================================

  describe('版本历史', () => {
    beforeEach(async () => {
      await didUpdater.initialize();
    });

    it('应该保存版本历史', async () => {
      const did = 'did:chainlesschain:test123';
      const document = {
        id: did,
        version: 1,
      };

      await didUpdater.saveVersionHistory(did, document);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO did_version_history')
      );
    });

    it('应该清理旧版本历史', async () => {
      const did = 'did:chainlesschain:test123';

      await didUpdater.cleanupVersionHistory(did);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM did_version_history')
      );
    });

    it('应该获取版本历史', () => {
      const did = 'did:chainlesschain:test123';
      const mockHistory = {
        values: [
          [2, 'Updated profile', Date.now()],
          [1, 'Initial version', Date.now() - 10000],
        ],
      };

      mockDb.prepare().all = vi.fn().mockReturnValue([mockHistory]);

      const history = didUpdater.getVersionHistory(did);

      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(2);
      expect(history[1].version).toBe(1);
    });
  });

  // =====================================================================
  // 重新发布测试
  // =====================================================================

  describe('republish', () => {
    it('应该重新发布 DID 到 DHT', async () => {
      const did = 'did:chainlesschain:test123';

      const result = await didUpdater.republish(did);

      expect(result.success).toBe(true);
      expect(mockDidManager.publishToDHT).toHaveBeenCalledWith(did);
    });

    it('应该触发 did-republished 事件', async () => {
      const republishSpy = vi.fn();
      didUpdater.on('did-republished', republishSpy);

      const did = 'did:chainlesschain:test123';
      await didUpdater.republish(did);

      expect(republishSpy).toHaveBeenCalled();
      expect(republishSpy.mock.calls[0][0]).toHaveProperty('did', did);
    });

    it('发布失败时应该抛出错误', async () => {
      mockDidManager.publishToDHT = vi.fn().mockRejectedValue(new Error('Publish failed'));

      await expect(didUpdater.republish('did:test')).rejects.toThrow('Publish failed');
    });
  });

  // =====================================================================
  // 版本递增测试
  // =====================================================================

  describe('incrementVersion', () => {
    beforeEach(async () => {
      await didUpdater.initialize();
    });

    it('应该递增版本号', async () => {
      const did = 'did:chainlesschain:test123';
      const document = {
        id: did,
        version: 1,
      };

      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue({
        did,
        did_document: JSON.stringify(document),
      });

      const result = await didUpdater.incrementVersion(did, 'Profile updated');

      expect(result.version).toBe(2);
    });

    it('应该添加版本历史记录', async () => {
      const did = 'did:chainlesschain:test123';
      const document = {
        id: did,
        version: 1,
        versionHistory: [],
      };

      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue({
        did,
        did_document: JSON.stringify(document),
      });

      await didUpdater.incrementVersion(did, 'Test change');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identities')
      );
    });

    it('autoRepublish 启用时应该自动重新发布', async () => {
      didUpdater.config.autoRepublish = true;
      didUpdater.republish = vi.fn().mockResolvedValue({ success: true });

      const did = 'did:chainlesschain:test123';
      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue({
        did,
        did_document: JSON.stringify({ version: 1 }),
      });

      await didUpdater.incrementVersion(did);

      expect(didUpdater.republish).toHaveBeenCalledWith(did);
    });

    it('应该触发 version-incremented 事件', async () => {
      const versionSpy = vi.fn();
      didUpdater.on('version-incremented', versionSpy);

      const did = 'did:chainlesschain:test123';
      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue({
        did,
        did_document: JSON.stringify({ version: 1 }),
      });

      await didUpdater.incrementVersion(did, 'Test');

      expect(versionSpy).toHaveBeenCalled();
      expect(versionSpy.mock.calls[0][0]).toHaveProperty('did', did);
      expect(versionSpy.mock.calls[0][0]).toHaveProperty('version', 2);
    });

    it('DID 不存在时应该抛出错误', async () => {
      mockDidManager.getIdentityByDID = vi.fn().mockReturnValue(null);

      await expect(didUpdater.incrementVersion('did:nonexistent')).rejects.toThrow('不存在');
    });
  });

  // =====================================================================
  // 销毁测试
  // =====================================================================

  describe('destroy', () => {
    it('应该停止所有定时器', async () => {
      const did1 = 'did:chainlesschain:test1';
      const did2 = 'did:chainlesschain:test2';

      didUpdater.startAutoUpdate(did1);
      didUpdater.startAutoUpdate(did2);
      didUpdater.startAutoRepublish(did1);

      await didUpdater.destroy();

      expect(didUpdater.updateTimers.size).toBe(0);
      expect(didUpdater.republishTimers.size).toBe(0);
    });

    it('应该移除所有事件监听器', async () => {
      const listener = vi.fn();
      didUpdater.on('test-event', listener);

      await didUpdater.destroy();

      expect(didUpdater.listenerCount('test-event')).toBe(0);
    });
  });

  // =====================================================================
  // 边界情况测试
  // =====================================================================

  describe('边界情况', () => {
    it.skip('应该处理无版本号的文档', () => {
      const localDoc = {};
      const remoteDoc = { version: 1 };

      const result = didUpdater.needsUpdate(localDoc, remoteDoc);

      expect(result).toBe(true);
    });

    it('应该处理无更新时间的文档', () => {
      const localDoc = { version: 1 };
      const remoteDoc = { version: 1 };

      const result = didUpdater.needsUpdate(localDoc, remoteDoc);

      expect(result).toBe(false);
    });

    it('应该处理数据库错误', async () => {
      mockDb.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      // 不应该抛出错误
      await expect(didUpdater.saveVersionHistory('did:test', {})).resolves.not.toThrow();
    });

    it('更新检测失败时应该触发 update-error 事件', async () => {
      const errorSpy = vi.fn();
      didUpdater.on('update-error', errorSpy);

      mockDidManager.resolveFromDHT = vi.fn().mockRejectedValue(new Error('Network error'));

      didUpdater.config.updateInterval = 100;
      didUpdater.startAutoUpdate('did:test');

      await vi.advanceTimersByTimeAsync(100);

      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
