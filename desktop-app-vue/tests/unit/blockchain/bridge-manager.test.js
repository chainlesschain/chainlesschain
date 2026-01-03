/**
 * Bridge Manager 单元测试
 * 测试从数据库加载桥接合约功能
 */

const BridgeManager = require('../../../src/main/blockchain/bridge-manager');

// Mock 区块链适配器
const createMockBlockchainAdapter = () => ({
  switchChain: vitest.fn(),
  getProvider: vitest.fn(),
  walletManager: {
    unlockWallet: vitest.fn(),
  },
});

// Mock 数据库
const createMockDatabase = () => ({
  run: vitest.fn(),
  get: vitest.fn(),
  all: vitest.fn(),
});

describe('BridgeManager - loadBridgeContracts', () => {
  let bridgeManager;
  let mockAdapter;
  let mockDatabase;

  beforeEach(() => {
    mockAdapter = createMockBlockchainAdapter();
    mockDatabase = createMockDatabase();
    bridgeManager = new BridgeManager(mockAdapter, mockDatabase);

    vitest.clearAllMocks();
  });

  describe('从数据库加载桥接合约', () => {
    it('应该加载所有类型为bridge的合约', async () => {
      const mockContracts = [
        {
          contract_address: '0x1234567890abcdef1234567890abcdef12345678',
          chain_id: 1,
          contract_name: 'Ethereum Bridge',
          abi_json: null,
        },
        {
          contract_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          chain_id: 137,
          contract_name: 'Polygon Bridge',
          abi_json: null,
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      await bridgeManager.loadBridgeContracts();

      // 验证查询语句
      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining("WHERE contract_type = 'bridge'")
      );

      // 验证合约已注册
      expect(bridgeManager.bridgeContracts.size).toBe(2);
      expect(bridgeManager.bridgeContracts.get(1)).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(bridgeManager.bridgeContracts.get(137)).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    });

    it('应该加载名称包含bridge的合约', async () => {
      const mockContracts = [
        {
          contract_address: '0x1111111111111111111111111111111111111111',
          chain_id: 56,
          contract_name: 'BSC Asset Bridge',
          abi_json: null,
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      await bridgeManager.loadBridgeContracts();

      expect(bridgeManager.bridgeContracts.get(56)).toBe('0x1111111111111111111111111111111111111111');
    });

    it('应该按部署时间降序加载（最新的优先）', async () => {
      const mockContracts = [
        {
          contract_address: '0xNEWEST',
          chain_id: 1,
          contract_name: 'Latest Bridge',
          abi_json: null,
        },
        {
          contract_address: '0xOLDER',
          chain_id: 1,
          contract_name: 'Old Bridge',
          abi_json: null,
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      await bridgeManager.loadBridgeContracts();

      // 最新的合约应该覆盖旧的（同一链上）
      expect(bridgeManager.bridgeContracts.get(1)).toBe('0xNEWEST');
    });
  });

  describe('加载合约ABI', () => {
    it('应该从数据库加载ABI并解析', async () => {
      const mockABI = [
        {
          name: 'lockAsset',
          type: 'function',
          inputs: [],
          outputs: [],
        },
      ];

      const mockContracts = [
        {
          contract_address: '0x1234567890abcdef1234567890abcdef12345678',
          chain_id: 1,
          contract_name: 'Test Bridge',
          abi_json: JSON.stringify(mockABI),
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      // 初始时ABI为null或默认值
      bridgeManager.bridgeABI = null;

      await bridgeManager.loadBridgeContracts();

      // 验证ABI已加载
      expect(bridgeManager.bridgeABI).toEqual(mockABI);
    });

    it('ABI已存在时不应该被覆盖', async () => {
      const existingABI = [{ name: 'existing', type: 'function' }];
      const newABI = [{ name: 'new', type: 'function' }];

      bridgeManager.bridgeABI = existingABI;

      const mockContracts = [
        {
          contract_address: '0x1234567890abcdef1234567890abcdef12345678',
          chain_id: 1,
          contract_name: 'Test Bridge',
          abi_json: JSON.stringify(newABI),
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      await bridgeManager.loadBridgeContracts();

      // 已存在的ABI不应该被覆盖
      expect(bridgeManager.bridgeABI).toEqual(existingABI);
    });

    it('无效的ABI JSON应该被忽略', async () => {
      const mockContracts = [
        {
          contract_address: '0x1234567890abcdef1234567890abcdef12345678',
          chain_id: 1,
          contract_name: 'Test Bridge',
          abi_json: 'invalid json {{{',
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      // 不应该抛出错误
      await expect(bridgeManager.loadBridgeContracts()).resolves.not.toThrow();
    });

    it('abi_json为null时应该跳过', async () => {
      const mockContracts = [
        {
          contract_address: '0x1234567890abcdef1234567890abcdef12345678',
          chain_id: 1,
          contract_name: 'Test Bridge',
          abi_json: null,
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      await bridgeManager.loadBridgeContracts();

      // 合约应该被注册，但ABI保持不变
      expect(bridgeManager.bridgeContracts.get(1)).toBe('0x1234567890abcdef1234567890abcdef12345678');
    });
  });

  describe('多链支持', () => {
    it('应该支持同时加载多条链的桥接合约', async () => {
      const mockContracts = [
        {
          contract_address: '0xETH_BRIDGE',
          chain_id: 1, // Ethereum
          contract_name: 'Ethereum Bridge',
          abi_json: null,
        },
        {
          contract_address: '0xBSC_BRIDGE',
          chain_id: 56, // BSC
          contract_name: 'BSC Bridge',
          abi_json: null,
        },
        {
          contract_address: '0xPOLYGON_BRIDGE',
          chain_id: 137, // Polygon
          contract_name: 'Polygon Bridge',
          abi_json: null,
        },
        {
          contract_address: '0xARBITRUM_BRIDGE',
          chain_id: 42161, // Arbitrum
          contract_name: 'Arbitrum Bridge',
          abi_json: null,
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      await bridgeManager.loadBridgeContracts();

      expect(bridgeManager.bridgeContracts.size).toBe(4);
      expect(bridgeManager.bridgeContracts.get(1)).toBe('0xETH_BRIDGE');
      expect(bridgeManager.bridgeContracts.get(56)).toBe('0xBSC_BRIDGE');
      expect(bridgeManager.bridgeContracts.get(137)).toBe('0xPOLYGON_BRIDGE');
      expect(bridgeManager.bridgeContracts.get(42161)).toBe('0xARBITRUM_BRIDGE');
    });
  });

  describe('错误处理', () => {
    it('数据库查询失败时不应该抛出错误', async () => {
      mockDatabase.all.mockImplementation(() => {
        throw new Error('Database error');
      });

      // 不应该抛出错误
      await expect(bridgeManager.loadBridgeContracts()).resolves.not.toThrow();
    });

    it('数据库返回null时应该正常处理', async () => {
      mockDatabase.all.mockReturnValue(null);

      await expect(bridgeManager.loadBridgeContracts()).resolves.not.toThrow();
    });

    it('数据库返回空数组时应该正常处理', async () => {
      mockDatabase.all.mockReturnValue([]);

      await bridgeManager.loadBridgeContracts();

      expect(bridgeManager.bridgeContracts.size).toBe(0);
    });

    it('数据不完整的合约应该被跳过', async () => {
      const mockContracts = [
        {
          contract_address: '0xVALID_BRIDGE',
          chain_id: 1,
          contract_name: 'Valid Bridge',
          abi_json: null,
        },
        {
          contract_address: null, // 缺少地址
          chain_id: 56,
          contract_name: 'Invalid Bridge',
          abi_json: null,
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);

      await bridgeManager.loadBridgeContracts();

      // 只有有效的合约被加载
      expect(bridgeManager.bridgeContracts.size).toBe(1);
      expect(bridgeManager.bridgeContracts.get(1)).toBe('0xVALID_BRIDGE');
    });
  });

  describe('registerBridgeContract', () => {
    it('应该正确注册单个桥接合约', () => {
      const chainId = 1;
      const contractAddress = '0x1234567890abcdef1234567890abcdef12345678';

      bridgeManager.registerBridgeContract(chainId, contractAddress);

      expect(bridgeManager.bridgeContracts.get(chainId)).toBe(contractAddress);
    });

    it('应该允许覆盖已存在的合约地址', () => {
      const chainId = 1;
      const oldAddress = '0xOLD_ADDRESS';
      const newAddress = '0xNEW_ADDRESS';

      bridgeManager.registerBridgeContract(chainId, oldAddress);
      expect(bridgeManager.bridgeContracts.get(chainId)).toBe(oldAddress);

      bridgeManager.registerBridgeContract(chainId, newAddress);
      expect(bridgeManager.bridgeContracts.get(chainId)).toBe(newAddress);
    });
  });

  describe('集成场景', () => {
    it('初始化时应该自动加载桥接合约', async () => {
      const mockContracts = [
        {
          contract_address: '0x1234567890abcdef1234567890abcdef12345678',
          chain_id: 1,
          contract_name: 'Auto-loaded Bridge',
          abi_json: null,
        },
      ];

      mockDatabase.all.mockReturnValue(mockContracts);
      mockDatabase.run.mockImplementation(() => {}); // Mock table creation

      await bridgeManager.initialize();

      expect(bridgeManager.initialized).toBe(true);
      expect(bridgeManager.bridgeContracts.size).toBeGreaterThan(0);
    });

    it('重复初始化不应该重复加载', async () => {
      mockDatabase.all.mockReturnValue([]);
      mockDatabase.run.mockImplementation(() => {});

      await bridgeManager.initialize();
      const firstCallCount = mockDatabase.all.mock.calls.length;

      await bridgeManager.initialize();
      const secondCallCount = mockDatabase.all.mock.calls.length;

      // 第二次初始化不应该再次调用数据库
      expect(secondCallCount).toBe(firstCallCount);
    });
  });
});
