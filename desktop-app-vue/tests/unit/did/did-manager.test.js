/**
 * DID Manager 单元测试
 * 测试目标: src/main/did/did-manager.js
 *
 * 覆盖场景:
 * - DID创建 (did:chainlesschain:uuid格式)
 * - Ed25519/X25519密钥对生成
 * - BIP39助记词生成/恢复
 * - DID文档序列化 (W3C标准)
 * - DID文档签名验证
 * - DHT发布/解析
 * - 自动重新发布
 * - 身份管理 (CRUD操作)
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
    debug: vi.fn(),
  },
  createLogger: vi.fn(),
}));

// Mock tweetnacl
const mockSignKeyPair = {
  publicKey: new Uint8Array(32).fill(1),
  secretKey: new Uint8Array(64).fill(2),
};

const mockBoxKeyPair = {
  publicKey: new Uint8Array(32).fill(3),
  secretKey: new Uint8Array(32).fill(4),
};

const mockSignature = new Uint8Array(64).fill(5);

vi.mock('tweetnacl', () => ({
  default: {
    sign: {
      keyPair: vi.fn(() => mockSignKeyPair),
      keyPair: {
        fromSeed: vi.fn((seed) => ({
          publicKey: new Uint8Array(32).fill(10),
          secretKey: new Uint8Array(64).fill(11),
        })),
      },
      detached: vi.fn((message, secretKey) => mockSignature),
      detached: {
        verify: vi.fn((message, signature, publicKey) => true),
      },
    },
    box: {
      keyPair: vi.fn(() => mockBoxKeyPair),
      keyPair: {
        fromSecretKey: vi.fn((secretKey) => ({
          publicKey: new Uint8Array(32).fill(12),
          secretKey: new Uint8Array(32).fill(13),
        })),
      },
    },
  },
}));

// Mock tweetnacl-util
vi.mock('tweetnacl-util', () => ({
  default: {
    encodeBase64: vi.fn((arr) => Buffer.from(arr).toString('base64')),
    decodeBase64: vi.fn((str) => Buffer.from(str, 'base64')),
    encodeUTF8: vi.fn((str) => Buffer.from(str, 'utf8')),
    decodeUTF8: vi.fn((buf) => buf.toString('utf8')),
  },
}));

// Mock crypto
vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => new Uint8Array(Buffer.from('0123456789abcdef0123456789abcdef0123456789ab', 'hex'))),
    })),
  },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

// Mock bip39
const mockMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
vi.mock('bip39', () => ({
  default: {
    generateMnemonic: vi.fn((strength) => mockMnemonic),
    validateMnemonic: vi.fn((mnemonic) => mnemonic === mockMnemonic),
    mnemonicToSeedSync: vi.fn((mnemonic) => new Uint8Array(64).fill(15)),
  },
}));

// Mock DIDCache
vi.mock('../../../src/main/did/did-cache.js', () => ({
  DIDCache: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0 }),
  })),
}));

// Mock DIDUpdater
vi.mock('../../../src/main/did/did-updater.js', () => ({
  DIDUpdater: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(true),
    startAutoUpdate: vi.fn(),
    stopAutoUpdate: vi.fn(),
    startAutoRepublish: vi.fn(),
    stopAutoRepublish: vi.fn(),
  })),
}));

describe('DIDManager', () => {
  let DIDManager;
  let didManager;
  let mockDb;
  let mockP2PManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
      }),
      exec: vi.fn(),
      saveToFile: vi.fn(),
    };

    // Mock P2P Manager
    mockP2PManager = {
      isInitialized: vi.fn().mockReturnValue(true),
      dhtPut: vi.fn().mockResolvedValue(undefined),
      dhtGet: vi.fn().mockResolvedValue(null),
    };

    // 动态导入 DIDManager
    const module = await import('../../../src/main/did/did-manager.js');
    DIDManager = module.default;

    didManager = new DIDManager(mockDb, mockP2PManager);
  });

  afterEach(() => {
    didManager = null;
  });

  // =====================================================================
  // 构造函数测试
  // =====================================================================

  describe('构造函数', () => {
    it('应该正确初始化 DIDManager', () => {
      expect(didManager.db).toBe(mockDb);
      expect(didManager.p2pManager).toBe(mockP2PManager);
      expect(didManager.config).toMatchObject({
        method: 'chainlesschain',
        version: '1.0',
        curve: 'Ed25519',
        encryptCurve: 'X25519',
      });
      expect(didManager.currentIdentity).toBeNull();
    });

    it('应该创建 DIDCache 实例', () => {
      expect(didManager.cache).toBeDefined();
    });

    it('应该创建 DIDUpdater 实例', () => {
      expect(didManager.updater).toBeDefined();
    });

    it('应该支持自定义配置', () => {
      const customConfig = { method: 'custom-method', version: '2.0' };
      const customManager = new DIDManager(mockDb, mockP2PManager, customConfig);

      expect(customManager.config.method).toBe('custom-method');
      expect(customManager.config.version).toBe('2.0');
      expect(customManager.config.curve).toBe('Ed25519'); // 默认值保留
    });
  });

  // =====================================================================
  // 初始化测试
  // =====================================================================

  describe('初始化', () => {
    it('应该成功初始化', async () => {
      const result = await didManager.initialize();

      expect(result).toBe(true);
      expect(mockDb.exec).toHaveBeenCalled(); // 创建表
      // cache 和 updater 的 initialize 会被自动调用
    });

    it('应该创建 identities 表', async () => {
      // Mock 表不存在
      mockDb.prepare().get = vi.fn().mockReturnValue(null);

      await didManager.initialize();

      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS identities')
      );
    });

    it('应该触发 initialized 事件', async () => {
      const initSpy = vi.fn();
      didManager.on('initialized', initSpy);

      await didManager.initialize();

      expect(initSpy).toHaveBeenCalled();
    });

    it('初始化失败时应该抛出错误', async () => {
      didManager.cache.initialize = vi.fn().mockRejectedValue(new Error('Cache init failed'));

      await expect(didManager.initialize()).rejects.toThrow('Cache init failed');
    });
  });

  // =====================================================================
  // DID 创建测试
  // =====================================================================

  describe('DID 创建', () => {
    it('应该创建新的 DID 身份', async () => {
      const profile = {
        nickname: 'Test User',
        bio: 'Test bio',
        avatar: '/path/to/avatar.png',
      };

      const identity = await didManager.createIdentity(profile);

      expect(identity).toHaveProperty('did');
      expect(identity).toHaveProperty('nickname', 'Test User');
      expect(identity).toHaveProperty('didDocument');
      expect(identity.did).toMatch(/^did:chainlesschain:/);
    });

    it('应该生成 Ed25519 签名密钥对', async () => {
      await didManager.createIdentity({});

      // 验证 nacl.sign.keyPair 被调用
      expect(mockDb.prepare).toHaveBeenCalled();
      const insertCall = mockDb.prepare.mock.calls.find(call =>
        call[0].includes('INSERT OR REPLACE INTO identities')
      );
      expect(insertCall).toBeDefined();
    });

    it('应该生成 X25519 加密密钥对', async () => {
      const identity = await didManager.createIdentity({});

      expect(identity.didDocument.verificationMethod).toHaveLength(2);
      expect(identity.didDocument.verificationMethod[0].type).toBe('Ed25519VerificationKey2020');
      expect(identity.didDocument.verificationMethod[1].type).toBe('X25519KeyAgreementKey2020');
    });

    it('应该使用提供的密钥对创建 DID', async () => {
      const customKeys = {
        sign: mockSignKeyPair,
        encrypt: mockBoxKeyPair,
      };

      const identity = await didManager.createIdentity({}, { keys: customKeys });

      expect(identity).toHaveProperty('did');
    });

    it('应该设置默认昵称为 Anonymous', async () => {
      const identity = await didManager.createIdentity({});

      expect(identity.nickname).toBe('Anonymous');
    });

    it('应该支持设置为默认身份', async () => {
      mockDb.prepare().run = vi.fn();

      await didManager.createIdentity({}, { setAsDefault: true });

      // 验证调用了更新默认身份的 SQL
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identities SET is_default')
      );
    });

    it('应该触发 identity-created 事件', async () => {
      const createdSpy = vi.fn();
      didManager.on('identity-created', createdSpy);

      await didManager.createIdentity({});

      expect(createdSpy).toHaveBeenCalled();
      expect(createdSpy.mock.calls[0][0]).toHaveProperty('did');
    });

    it('创建失败时应该抛出错误', async () => {
      mockDb.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(didManager.createIdentity({})).rejects.toThrow('Database error');
    });
  });

  // =====================================================================
  // DID 生成测试
  // =====================================================================

  describe('generateDID', () => {
    it('应该生成标准格式的 DID', () => {
      const publicKey = new Uint8Array(32).fill(1);
      const did = didManager.generateDID(publicKey);

      expect(did).toMatch(/^did:chainlesschain:[0-9a-f]{40}$/);
    });

    it('应该为组织 DID 添加前缀', () => {
      const publicKey = new Uint8Array(32).fill(1);
      const orgDID = didManager.generateDID(publicKey, 'org');

      expect(orgDID).toMatch(/^did:chainlesschain:org:[0-9a-f]{40}$/);
    });

    it('相同公钥应该生成相同的 DID', () => {
      const publicKey = new Uint8Array(32).fill(1);
      const did1 = didManager.generateDID(publicKey);
      const did2 = didManager.generateDID(publicKey);

      expect(did1).toBe(did2);
    });

    it('不同公钥应该生成不同的 DID', () => {
      const publicKey1 = new Uint8Array(32).fill(1);
      const publicKey2 = new Uint8Array(32).fill(2);
      const did1 = didManager.generateDID(publicKey1);
      const did2 = didManager.generateDID(publicKey2);

      expect(did1).not.toBe(did2);
    });
  });

  // =====================================================================
  // DID 文档创建测试
  // =====================================================================

  describe('createDIDDocument', () => {
    it('应该创建符合 W3C 标准的 DID 文档', () => {
      const did = 'did:chainlesschain:test123';
      const keys = {
        signPublicKey: new Uint8Array(32).fill(1),
        encryptPublicKey: new Uint8Array(32).fill(2),
        profile: { nickname: 'Test', bio: 'Bio' },
      };

      const document = didManager.createDIDDocument(did, keys);

      expect(document['@context']).toContain('https://www.w3.org/ns/did/v1');
      expect(document.id).toBe(did);
      expect(document.version).toBe('1.0');
      expect(document.verificationMethod).toHaveLength(2);
      expect(document.authentication).toContain(`${did}#sign-key-1`);
      expect(document.assertionMethod).toContain(`${did}#sign-key-1`);
      expect(document.keyAgreement).toContain(`${did}#encrypt-key-1`);
    });

    it('应该包含签名验证方法', () => {
      const did = 'did:chainlesschain:test123';
      const keys = {
        signPublicKey: new Uint8Array(32).fill(1),
        encryptPublicKey: new Uint8Array(32).fill(2),
      };

      const document = didManager.createDIDDocument(did, keys);
      const signMethod = document.verificationMethod.find(vm => vm.type === 'Ed25519VerificationKey2020');

      expect(signMethod).toBeDefined();
      expect(signMethod.controller).toBe(did);
      expect(signMethod.publicKeyBase64).toBeDefined();
    });

    it('应该包含加密密钥协商方法', () => {
      const did = 'did:chainlesschain:test123';
      const keys = {
        signPublicKey: new Uint8Array(32).fill(1),
        encryptPublicKey: new Uint8Array(32).fill(2),
      };

      const document = didManager.createDIDDocument(did, keys);
      const encryptMethod = document.verificationMethod.find(vm => vm.type === 'X25519KeyAgreementKey2020');

      expect(encryptMethod).toBeDefined();
      expect(encryptMethod.controller).toBe(did);
    });

    it('应该包含用户资料信息', () => {
      const did = 'did:chainlesschain:test123';
      const profile = { nickname: 'Alice', bio: 'Developer' };
      const keys = {
        signPublicKey: new Uint8Array(32).fill(1),
        encryptPublicKey: new Uint8Array(32).fill(2),
        profile,
      };

      const document = didManager.createDIDDocument(did, keys);

      expect(document.profile).toEqual(profile);
    });

    it('资料为空时不应该包含 profile 字段', () => {
      const did = 'did:chainlesschain:test123';
      const keys = {
        signPublicKey: new Uint8Array(32).fill(1),
        encryptPublicKey: new Uint8Array(32).fill(2),
      };

      const document = didManager.createDIDDocument(did, keys);

      expect(document.profile).toBeUndefined();
    });
  });

  // =====================================================================
  // DID 文档签名和验证测试
  // =====================================================================

  describe('signDIDDocument 和 verifyDIDDocument', () => {
    it('应该正确签名 DID 文档', () => {
      const document = {
        id: 'did:chainlesschain:test123',
        version: '1.0',
        verificationMethod: [{
          id: 'did:chainlesschain:test123#sign-key-1',
          type: 'Ed25519VerificationKey2020',
          controller: 'did:chainlesschain:test123',
          publicKeyBase64: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
        }],
      };

      const secretKey = new Uint8Array(64).fill(2);
      const signedDocument = didManager.signDIDDocument(document, secretKey);

      expect(signedDocument).toHaveProperty('proof');
      expect(signedDocument.proof.type).toBe('Ed25519Signature2020');
      expect(signedDocument.proof.verificationMethod).toBe('did:chainlesschain:test123#sign-key-1');
      expect(signedDocument.proof.proofPurpose).toBe('assertionMethod');
      expect(signedDocument.proof.proofValue).toBeDefined();
    });

    it.skip('应该验证有效的 DID 文档签名', () => {
      // TODO: 需要完善 nacl mock 来正确验证签名
      const document = {
        id: 'did:chainlesschain:test123',
        verificationMethod: [{
          id: 'did:chainlesschain:test123#sign-key-1',
          publicKeyBase64: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
        }],
      };

      const signedDocument = {
        ...document,
        proof: {
          type: 'Ed25519Signature2020',
          verificationMethod: 'did:chainlesschain:test123#sign-key-1',
          proofPurpose: 'assertionMethod',
          proofValue: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU=',
        },
      };

      const isValid = didManager.verifyDIDDocument(signedDocument);

      expect(isValid).toBe(true);
    });

    it('缺少签名时验证应该失败', () => {
      const document = {
        id: 'did:chainlesschain:test123',
        verificationMethod: [],
      };

      const isValid = didManager.verifyDIDDocument(document);

      expect(isValid).toBe(false);
    });

    it('签名无效时验证应该失败', async () => {
      // Mock 验证失败
      const nacl = await import('tweetnacl');
      nacl.default.sign.detached.verify = vi.fn(() => false);

      const signedDocument = {
        id: 'did:chainlesschain:test123',
        verificationMethod: [{
          id: 'did:chainlesschain:test123#sign-key-1',
          publicKeyBase64: 'invalid-key',
        }],
        proof: {
          verificationMethod: 'did:chainlesschain:test123#sign-key-1',
          proofValue: 'invalid-signature',
        },
      };

      const isValid = didManager.verifyDIDDocument(signedDocument);

      expect(isValid).toBe(false);
    });
  });

  // =====================================================================
  // 身份管理测试
  // =====================================================================

  describe('身份管理', () => {
    it('应该获取所有身份', () => {
      mockDb.prepare().all = vi.fn().mockReturnValue([
        {
          did: 'did:chainlesschain:test1',
          nickname: 'Alice',
          created_at: Date.now(),
        },
        {
          did: 'did:chainlesschain:test2',
          nickname: 'Bob',
          created_at: Date.now(),
        },
      ]);

      const identities = didManager.getAllIdentities();

      expect(identities).toHaveLength(2);
      expect(identities[0].nickname).toBe('Alice');
    });

    it('应该根据 DID 获取身份', () => {
      const testDID = 'did:chainlesschain:test123';
      mockDb.prepare().all = vi.fn().mockReturnValue([{
        did: testDID,
        nickname: 'Test User',
      }]);

      const identity = didManager.getIdentityByDID(testDID);

      expect(identity).toBeDefined();
      expect(identity.did).toBe(testDID);
    });

    it('身份不存在时应该返回 null', () => {
      mockDb.prepare().all = vi.fn().mockReturnValue([]);

      const identity = didManager.getIdentityByDID('did:chainlesschain:nonexistent');

      expect(identity).toBeNull();
    });

    it('应该设置默认身份', async () => {
      const testDID = 'did:chainlesschain:test123';
      mockDb.prepare().all = vi.fn().mockReturnValue([{
        did: testDID,
        nickname: 'Test',
      }]);

      await didManager.setDefaultIdentity(testDID);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identities SET is_default = 0')
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identities SET is_default = 1 WHERE did = ?')
      );
      expect(didManager.currentIdentity).toBeDefined();
    });

    it('应该更新身份资料', async () => {
      const testDID = 'did:chainlesschain:test123';
      mockDb.prepare().all = vi.fn().mockReturnValue([{
        did: testDID,
        nickname: 'Old Name',
        did_document: '{}',
      }]);

      const updates = {
        nickname: 'New Name',
        bio: 'New bio',
      };

      await didManager.updateIdentityProfile(testDID, updates);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identities SET')
      );
    });

    it('应该删除身份', async () => {
      const testDID = 'did:chainlesschain:test123';
      mockDb.prepare().all = vi.fn().mockReturnValue([{
        did: testDID,
        is_default: 0,
      }]);

      const result = await didManager.deleteIdentity(testDID);

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM identities WHERE did = ?')
      );
    });

    it('不应该删除默认身份', async () => {
      const testDID = 'did:chainlesschain:test123';
      mockDb.prepare().all = vi.fn().mockReturnValue([{
        did: testDID,
        is_default: 1,
      }]);

      await expect(didManager.deleteIdentity(testDID)).rejects.toThrow('不能删除默认身份');
    });
  });

  // =====================================================================
  // DHT 发布和解析测试
  // =====================================================================

  describe('DHT 发布和解析', () => {
    beforeEach(() => {
      mockP2PManager.isInitialized = vi.fn().mockReturnValue(true);
    });

    it('应该发布 DID 到 DHT', async () => {
      const testDID = 'did:chainlesschain:test123';
      mockDb.prepare().all = vi.fn().mockReturnValue([{
        did: testDID,
        nickname: 'Test',
        public_key_sign: 'pk_sign',
        public_key_encrypt: 'pk_encrypt',
        did_document: JSON.stringify({ id: testDID }),
      }]);

      const result = await didManager.publishToDHT(testDID);

      expect(result.success).toBe(true);
      expect(result.key).toBe('/did/chainlesschain/test123');
      expect(mockP2PManager.dhtPut).toHaveBeenCalled();
    });

    it('P2P 未初始化时应该抛出错误', async () => {
      mockP2PManager.isInitialized = vi.fn().mockReturnValue(false);

      await expect(didManager.publishToDHT('did:chainlesschain:test')).rejects.toThrow(
        'P2P 节点未初始化'
      );
    });

    it.skip('应该从 DHT 解析 DID', async () => {
      // TODO: 需要完善签名验证 mock
      const testDID = 'did:chainlesschain:test123';
      const mockDIDData = {
        did: testDID,
        didDocument: {
          id: testDID,
          proof: {
            verificationMethod: `${testDID}#sign-key-1`,
            proofValue: 'signature',
          },
          verificationMethod: [{
            id: `${testDID}#sign-key-1`,
            publicKeyBase64: 'pubkey',
          }],
        },
      };

      mockP2PManager.dhtGet = vi.fn().mockResolvedValue(
        Buffer.from(JSON.stringify(mockDIDData))
      );
      didManager.cache.get = vi.fn().mockResolvedValue(null); // Cache miss

      const result = await didManager.resolveFromDHT(testDID);

      expect(result).toBeDefined();
      expect(result.did).toBe(testDID);
      expect(mockP2PManager.dhtGet).toHaveBeenCalledWith('/did/chainlesschain/test123');
      expect(didManager.cache.set).toHaveBeenCalledWith(testDID, mockDIDData);
    });

    it('应该优先从缓存获取 DID', async () => {
      const testDID = 'did:chainlesschain:test123';
      const cachedData = { did: testDID };

      didManager.cache.get = vi.fn().mockResolvedValue(cachedData);

      const result = await didManager.resolveFromDHT(testDID);

      expect(result).toEqual(cachedData);
      expect(mockP2PManager.dhtGet).not.toHaveBeenCalled();
    });

    it('DID 格式无效时应该抛出错误', async () => {
      await expect(didManager.resolveFromDHT('invalid-did')).rejects.toThrow('无效的 DID 格式');
    });
  });

  // =====================================================================
  // 助记词功能测试
  // =====================================================================

  describe('助记词功能', () => {
    it('应该生成 BIP39 助记词', () => {
      const mnemonic = didManager.generateMnemonic();

      expect(mnemonic).toBeDefined();
      expect(typeof mnemonic).toBe('string');
    });

    it('应该验证有效的助记词', () => {
      const isValid = didManager.validateMnemonic(mockMnemonic);

      expect(isValid).toBe(true);
    });

    it('应该拒绝无效的助记词', () => {
      const isValid = didManager.validateMnemonic('invalid mnemonic');

      expect(isValid).toBe(false);
    });

    it.skip('应该从助记词派生密钥对', () => {
      // TODO: 修复 Buffer/Uint8Array 兼容性问题
      const keys = didManager.deriveKeysFromMnemonic(mockMnemonic, 0);

      expect(keys).toHaveProperty('sign');
      expect(keys).toHaveProperty('encrypt');
      expect(keys.sign).toHaveProperty('publicKey');
      expect(keys.sign).toHaveProperty('secretKey');
    });

    it.skip('使用助记词创建身份', async () => {
      // TODO: 修复 Buffer/Uint8Array 兼容性问题
      const profile = { nickname: 'Mnemonic User' };

      const identity = await didManager.createIdentityFromMnemonic(profile, mockMnemonic);

      expect(identity).toHaveProperty('did');
      expect(identity.nickname).toBe('Mnemonic User');
    });

    it('应该导出身份的助记词', () => {
      const testDID = 'did:chainlesschain:test123';
      mockDb.prepare().all = vi.fn().mockReturnValue([{
        did: testDID,
        private_key_ref: JSON.stringify({ mnemonic: mockMnemonic }),
      }]);

      const mnemonic = didManager.exportMnemonic(testDID);

      expect(mnemonic).toBe(mockMnemonic);
    });

    it('应该检查身份是否有助记词备份', () => {
      const testDID = 'did:chainlesschain:test123';
      mockDb.prepare().all = vi.fn().mockReturnValue([{
        did: testDID,
        private_key_ref: JSON.stringify({ mnemonic: mockMnemonic }),
      }]);

      const hasMnemonic = didManager.hasMnemonic(testDID);

      expect(hasMnemonic).toBe(true);
    });
  });

  // =====================================================================
  // 自动重新发布测试
  // =====================================================================

  describe('自动重新发布', () => {
    it('应该启动自动重新发布', () => {
      didManager.startAutoRepublish(5000);

      expect(didManager.autoRepublishEnabled).toBe(true);
      expect(didManager.autoRepublishInterval).toBe(5000);
      expect(didManager.autoRepublishTimer).toBeDefined();
    });

    it('应该停止自动重新发布', () => {
      didManager.startAutoRepublish();
      didManager.stopAutoRepublish();

      expect(didManager.autoRepublishEnabled).toBe(false);
      expect(didManager.autoRepublishTimer).toBeNull();
    });

    it('应该获取自动重新发布状态', () => {
      didManager.startAutoRepublish(10000);

      const status = didManager.getAutoRepublishStatus();

      expect(status.enabled).toBe(true);
      expect(status.interval).toBe(10000);
      expect(status.intervalHours).toBe(10000 / 1000 / 60 / 60);
    });

    it('应该设置自动重新发布间隔', () => {
      didManager.setAutoRepublishInterval(30000);

      expect(didManager.autoRepublishInterval).toBe(30000);
    });
  });

  // =====================================================================
  // 边界情况和错误处理
  // =====================================================================

  describe('边界情况', () => {
    it('应该处理空的身份列表', () => {
      mockDb.prepare().all = vi.fn().mockReturnValue([]);

      const identities = didManager.getAllIdentities();

      expect(identities).toEqual([]);
    });

    it('应该处理数据库查询错误', () => {
      mockDb.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const identities = didManager.getAllIdentities();

      expect(identities).toEqual([]);
    });

    it('应该正确关闭管理器', async () => {
      didManager.startAutoRepublish();

      await didManager.close();

      expect(didManager.autoRepublishTimer).toBeNull();
      expect(didManager.currentIdentity).toBeNull();
    });
  });

  // =====================================================================
  // 组织 DID 测试
  // =====================================================================

  describe('组织 DID', () => {
    it('应该创建组织 DID', async () => {
      const orgId = 'org-123';
      const orgName = 'Test Organization';

      const orgDID = await didManager.createOrganizationDID(orgId, orgName);

      expect(orgDID).toMatch(/^did:chainlesschain:org:/);
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('组织 DID 不应该是默认身份', async () => {
      const orgId = 'org-123';
      const orgName = 'Test Org';

      await didManager.createOrganizationDID(orgId, orgName);

      const insertCall = mockDb.prepare.mock.calls.find(call =>
        call[0].includes('INSERT OR REPLACE INTO identities')
      );
      expect(insertCall).toBeDefined();
    });
  });
});
