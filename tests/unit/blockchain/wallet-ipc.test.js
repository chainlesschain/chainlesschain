/**
 * Wallet IPC 单元测试
 * 测试钱包管理 IPC 处理器的所有功能
 */

const { ipcMain } = require('electron');
const { registerWalletIPC } = require('../../../desktop-app-vue/src/main/blockchain/wallet-ipc');

// Mock ipcMain
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

describe('Wallet IPC Handlers', () => {
  let mockWalletManager;
  let mockExternalWalletConnector;
  let handlers = {};

  beforeEach(() => {
    // 清除所有 mocks
    jest.clearAllMocks();
    handlers = {};

    // 创建 mock 钱包管理器
    mockWalletManager = {
      createWallet: jest.fn(),
      importFromMnemonic: jest.fn(),
      importFromPrivateKey: jest.fn(),
      unlockWallet: jest.fn(),
      lockWallet: jest.fn(),
      signTransaction: jest.fn(),
      signMessage: jest.fn(),
      getBalance: jest.fn(),
      getAllWallets: jest.fn(),
      getWallet: jest.fn(),
      setDefaultWallet: jest.fn(),
      deleteWallet: jest.fn(),
      exportPrivateKey: jest.fn(),
      exportMnemonic: jest.fn(),
    };

    // 创建 mock 外部钱包连接器
    mockExternalWalletConnector = {
      _saveExternalWallet: jest.fn(),
    };

    // 捕获所有注册的 handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 IPC handlers
    registerWalletIPC({
      walletManager: mockWalletManager,
      externalWalletConnector: mockExternalWalletConnector,
    });
  });

  afterEach(() => {
    handlers = {};
  });

  // ============================================================
  // 钱包创建和导入测试
  // ============================================================

  describe('wallet:create', () => {
    it('should create wallet successfully', async () => {
      const mockWallet = {
        id: 'wallet-1',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        chainId: 1,
      };

      mockWalletManager.createWallet.mockResolvedValue(mockWallet);

      const handler = handlers['wallet:create'];
      const result = await handler(null, { password: 'test123', chainId: 1 });

      expect(mockWalletManager.createWallet).toHaveBeenCalledWith('test123', 1);
      expect(result).toEqual(mockWallet);
    });

    it('should use default chainId when not provided', async () => {
      const mockWallet = { id: 'wallet-1', address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' };
      mockWalletManager.createWallet.mockResolvedValue(mockWallet);

      const handler = handlers['wallet:create'];
      await handler(null, { password: 'test123' });

      expect(mockWalletManager.createWallet).toHaveBeenCalledWith('test123', 1);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:create'];

      await expect(handler(null, { password: 'test123' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  describe('wallet:import-mnemonic', () => {
    it('should import wallet from mnemonic successfully', async () => {
      const mnemonic = 'test mnemonic phrase with twelve words here for testing purposes only';
      const mockWallet = { id: 'wallet-2', address: '0x123...' };

      mockWalletManager.importFromMnemonic.mockResolvedValue(mockWallet);

      const handler = handlers['wallet:import-mnemonic'];
      const result = await handler(null, { mnemonic, password: 'test123', chainId: 1 });

      expect(mockWalletManager.importFromMnemonic).toHaveBeenCalledWith(mnemonic, 'test123', 1);
      expect(result).toEqual(mockWallet);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:import-mnemonic'];

      await expect(handler(null, { mnemonic: 'test', password: 'test123' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  describe('wallet:import-private-key', () => {
    it('should import wallet from private key successfully', async () => {
      const privateKey = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const mockWallet = { id: 'wallet-3', address: '0x456...' };

      mockWalletManager.importFromPrivateKey.mockResolvedValue(mockWallet);

      const handler = handlers['wallet:import-private-key'];
      const result = await handler(null, { privateKey, password: 'test123', chainId: 1 });

      expect(mockWalletManager.importFromPrivateKey).toHaveBeenCalledWith(privateKey, 'test123', 1);
      expect(result).toEqual(mockWallet);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:import-private-key'];

      await expect(handler(null, { privateKey: '0xabc', password: 'test123' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  // ============================================================
  // 钱包锁定和解锁测试
  // ============================================================

  describe('wallet:unlock', () => {
    it('should unlock wallet successfully', async () => {
      const mockWallet = {
        id: 'wallet-1',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        isUnlocked: true,
      };

      mockWalletManager.unlockWallet.mockResolvedValue(mockWallet);

      const handler = handlers['wallet:unlock'];
      const result = await handler(null, { walletId: 'wallet-1', password: 'test123' });

      expect(mockWalletManager.unlockWallet).toHaveBeenCalledWith('wallet-1', 'test123');
      expect(result).toEqual({ address: mockWallet.address });
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:unlock'];

      await expect(handler(null, { walletId: 'wallet-1', password: 'test123' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  describe('wallet:lock', () => {
    it('should lock wallet successfully', async () => {
      mockWalletManager.lockWallet.mockReturnValue(undefined);

      const handler = handlers['wallet:lock'];
      const result = await handler(null, { walletId: 'wallet-1' });

      expect(mockWalletManager.lockWallet).toHaveBeenCalledWith('wallet-1');
      expect(result).toEqual({ success: true });
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:lock'];

      await expect(handler(null, { walletId: 'wallet-1' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  // ============================================================
  // 签名功能测试
  // ============================================================

  describe('wallet:sign-transaction', () => {
    it('should sign transaction successfully', async () => {
      const transaction = { to: '0x123...', value: '1000000000000000000' };
      const mockSignedTx = { ...transaction, signature: '0xabc...' };

      mockWalletManager.signTransaction.mockResolvedValue(mockSignedTx);

      const handler = handlers['wallet:sign-transaction'];
      const result = await handler(null, { walletId: 'wallet-1', transaction, useUKey: false });

      expect(mockWalletManager.signTransaction).toHaveBeenCalledWith('wallet-1', transaction, false);
      expect(result).toEqual(mockSignedTx);
    });

    it('should sign transaction with U-Key', async () => {
      const transaction = { to: '0x123...', value: '1000000000000000000' };
      const mockSignedTx = { ...transaction, signature: '0xabc...' };

      mockWalletManager.signTransaction.mockResolvedValue(mockSignedTx);

      const handler = handlers['wallet:sign-transaction'];
      await handler(null, { walletId: 'wallet-1', transaction, useUKey: true });

      expect(mockWalletManager.signTransaction).toHaveBeenCalledWith('wallet-1', transaction, true);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:sign-transaction'];

      await expect(handler(null, { walletId: 'wallet-1', transaction: {} })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  describe('wallet:sign-message', () => {
    it('should sign message successfully', async () => {
      const message = 'Hello, blockchain!';
      const mockSignature = '0xabc123...';

      mockWalletManager.signMessage.mockResolvedValue(mockSignature);

      const handler = handlers['wallet:sign-message'];
      const result = await handler(null, { walletId: 'wallet-1', message, useUKey: false });

      expect(mockWalletManager.signMessage).toHaveBeenCalledWith('wallet-1', message, false);
      expect(result).toBe(mockSignature);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:sign-message'];

      await expect(handler(null, { walletId: 'wallet-1', message: 'test' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  // ============================================================
  // 钱包查询测试
  // ============================================================

  describe('wallet:get-balance', () => {
    it('should get native token balance', async () => {
      const mockBalance = { balance: '1000000000000000000', symbol: 'ETH' };
      mockWalletManager.getBalance.mockResolvedValue(mockBalance);

      const handler = handlers['wallet:get-balance'];
      const result = await handler(null, { address: '0x123...', chainId: 1 });

      expect(mockWalletManager.getBalance).toHaveBeenCalledWith('0x123...', 1, null);
      expect(result).toEqual(mockBalance);
    });

    it('should get ERC20 token balance', async () => {
      const mockBalance = { balance: '5000000000000000000', symbol: 'USDT' };
      mockWalletManager.getBalance.mockResolvedValue(mockBalance);

      const handler = handlers['wallet:get-balance'];
      const result = await handler(null, {
        address: '0x123...',
        chainId: 1,
        tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      });

      expect(mockWalletManager.getBalance).toHaveBeenCalledWith('0x123...', 1, '0xdac17f958d2ee523a2206206994597c13d831ec7');
      expect(result).toEqual(mockBalance);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:get-balance'];

      await expect(handler(null, { address: '0x123...', chainId: 1 })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  describe('wallet:get-all', () => {
    it('should get all wallets successfully', async () => {
      const mockWallets = [
        { id: 'wallet-1', address: '0x123...', isDefault: true },
        { id: 'wallet-2', address: '0x456...', isDefault: false },
      ];

      mockWalletManager.getAllWallets.mockResolvedValue(mockWallets);

      const handler = handlers['wallet:get-all'];
      const result = await handler();

      expect(mockWalletManager.getAllWallets).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockWallets);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:get-all'];

      await expect(handler()).rejects.toThrow('钱包管理器未初始化');
    });
  });

  describe('wallet:get', () => {
    it('should get wallet details successfully', async () => {
      const mockWallet = {
        id: 'wallet-1',
        address: '0x123...',
        chainId: 1,
        isDefault: true,
      };

      mockWalletManager.getWallet.mockResolvedValue(mockWallet);

      const handler = handlers['wallet:get'];
      const result = await handler(null, { walletId: 'wallet-1' });

      expect(mockWalletManager.getWallet).toHaveBeenCalledWith('wallet-1');
      expect(result).toEqual(mockWallet);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:get'];

      await expect(handler(null, { walletId: 'wallet-1' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  // ============================================================
  // 钱包管理操作测试
  // ============================================================

  describe('wallet:set-default', () => {
    it('should set default wallet successfully', async () => {
      mockWalletManager.setDefaultWallet.mockResolvedValue(undefined);

      const handler = handlers['wallet:set-default'];
      const result = await handler(null, { walletId: 'wallet-2' });

      expect(mockWalletManager.setDefaultWallet).toHaveBeenCalledWith('wallet-2');
      expect(result).toEqual({ success: true });
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:set-default'];

      await expect(handler(null, { walletId: 'wallet-1' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  describe('wallet:delete', () => {
    it('should delete wallet successfully', async () => {
      mockWalletManager.deleteWallet.mockResolvedValue(undefined);

      const handler = handlers['wallet:delete'];
      const result = await handler(null, { walletId: 'wallet-1' });

      expect(mockWalletManager.deleteWallet).toHaveBeenCalledWith('wallet-1');
      expect(result).toEqual({ success: true });
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:delete'];

      await expect(handler(null, { walletId: 'wallet-1' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  // ============================================================
  // 导出功能测试
  // ============================================================

  describe('wallet:export-private-key', () => {
    it('should export private key successfully', async () => {
      const mockPrivateKey = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      mockWalletManager.exportPrivateKey.mockResolvedValue(mockPrivateKey);

      const handler = handlers['wallet:export-private-key'];
      const result = await handler(null, { walletId: 'wallet-1', password: 'test123' });

      expect(mockWalletManager.exportPrivateKey).toHaveBeenCalledWith('wallet-1', 'test123');
      expect(result).toBe(mockPrivateKey);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:export-private-key'];

      await expect(handler(null, { walletId: 'wallet-1', password: 'test123' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  describe('wallet:export-mnemonic', () => {
    it('should export mnemonic successfully', async () => {
      const mockMnemonic = 'test mnemonic phrase with twelve words here for testing purposes only';
      mockWalletManager.exportMnemonic.mockResolvedValue(mockMnemonic);

      const handler = handlers['wallet:export-mnemonic'];
      const result = await handler(null, { walletId: 'wallet-1', password: 'test123' });

      expect(mockWalletManager.exportMnemonic).toHaveBeenCalledWith('wallet-1', 'test123');
      expect(result).toBe(mockMnemonic);
    });

    it('should throw error when wallet manager is not initialized', async () => {
      registerWalletIPC({
        walletManager: null,
        externalWalletConnector: mockExternalWalletConnector,
      });
      const handler = handlers['wallet:export-mnemonic'];

      await expect(handler(null, { walletId: 'wallet-1', password: 'test123' })).rejects.toThrow('钱包管理器未初始化');
    });
  });

  // ============================================================
  // 外部钱包测试
  // ============================================================

  describe('wallet:save-external', () => {
    it('should save external wallet successfully', async () => {
      mockExternalWalletConnector._saveExternalWallet.mockResolvedValue(undefined);

      const handler = handlers['wallet:save-external'];
      const result = await handler(null, {
        address: '0x123...',
        provider: 'metamask',
        chainId: 1,
      });

      expect(mockExternalWalletConnector._saveExternalWallet).toHaveBeenCalledWith({
        address: '0x123...',
        provider: 'metamask',
        chainId: 1,
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw error when external wallet connector is not initialized', async () => {
      registerWalletIPC({
        walletManager: mockWalletManager,
        externalWalletConnector: null,
      });
      const handler = handlers['wallet:save-external'];

      await expect(handler(null, { address: '0x123...', provider: 'metamask', chainId: 1 })).rejects.toThrow('外部钱包连接器未初始化');
    });
  });

  // ============================================================
  // 注册测试
  // ============================================================

  describe('registerWalletIPC', () => {
    it('should register all 15 IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledTimes(15);

      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      expect(registeredChannels).toContain('wallet:create');
      expect(registeredChannels).toContain('wallet:import-mnemonic');
      expect(registeredChannels).toContain('wallet:import-private-key');
      expect(registeredChannels).toContain('wallet:unlock');
      expect(registeredChannels).toContain('wallet:lock');
      expect(registeredChannels).toContain('wallet:sign-transaction');
      expect(registeredChannels).toContain('wallet:sign-message');
      expect(registeredChannels).toContain('wallet:get-balance');
      expect(registeredChannels).toContain('wallet:get-all');
      expect(registeredChannels).toContain('wallet:get');
      expect(registeredChannels).toContain('wallet:set-default');
      expect(registeredChannels).toContain('wallet:delete');
      expect(registeredChannels).toContain('wallet:export-private-key');
      expect(registeredChannels).toContain('wallet:export-mnemonic');
      expect(registeredChannels).toContain('wallet:save-external');
    });

    it('should handle registration with null managers', () => {
      jest.clearAllMocks();

      expect(() => {
        registerWalletIPC({
          walletManager: null,
          externalWalletConnector: null,
        });
      }).not.toThrow();

      expect(ipcMain.handle).toHaveBeenCalled();
    });
  });
});
