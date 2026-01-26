import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Wallet from '../../../src/renderer/pages/Wallet.vue';
import { message, Modal } from 'ant-design-vue';

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock Ant Design Vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  Modal: {
    confirm: vi.fn(),
  },
  Empty: {
    PRESENTED_IMAGE_SIMPLE: 'simple',
  },
}));

// Mock Vue Router
const mockRouter = {
  push: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
}));

// Mock blockchain子组件
vi.mock('@/components/blockchain/ChainSelector.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/blockchain/CreateWalletModal.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/blockchain/ImportWalletModal.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/blockchain/TransactionList.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/blockchain/TransactionDetailModal.vue', () => ({
  default: { template: '<div />' },
}));

// Mock Electron API
global.window = {
  electron: {
    invoke: vi.fn(),
  },
};

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
  },
});

// Mock blockchain store
const mockBlockchainStore = {
  internalWallets: [],
  walletLoading: false,
  currentWallet: null,
  currentAddress: null,
  currentChainId: 1,
  currentNetwork: { symbol: 'ETH' },
  externalWalletConnected: false,
  externalWalletAddress: null,
  externalWalletProvider: null,
  pendingTransactionCount: 0,
  initialize: vi.fn().mockResolvedValue(),
  getBalance: vi.fn().mockReturnValue('0'),
  selectWallet: vi.fn(),
  fetchBalance: vi.fn(),
  setDefaultWallet: vi.fn().mockResolvedValue(),
  deleteWallet: vi.fn().mockResolvedValue(),
  connectMetaMask: vi.fn().mockResolvedValue(),
  connectWalletConnect: vi.fn().mockResolvedValue(),
  disconnectExternalWallet: vi.fn(),
  refreshCurrentBalance: vi.fn(),
  refreshTransactions: vi.fn().mockResolvedValue(),
};

vi.mock('@/stores/blockchain', () => ({
  useBlockchainStore: () => mockBlockchainStore,
}));

describe('Wallet.vue', () => {
  let wrapper;

  const mockInternalWallets = [
    {
      id: 1,
      name: 'Main Wallet',
      address: '0x1234567890123456789012345678901234567890',
      chain: 'ethereum',
      balance: '1.5',
      is_default: true,
      type: 'internal',
      created_at: '2024-01-01T10:00:00Z',
    },
    {
      id: 2,
      name: 'Trading Wallet',
      address: '0x0987654321098765432109876543210987654321',
      chain: 'bsc',
      balance: '100.25',
      is_default: false,
      type: 'internal',
      created_at: '2024-01-05T10:00:00Z',
    },
  ];

  const mockTransactions = [
    {
      id: 'tx-1',
      hash: '0xabc123',
      from: '0x1234567890123456789012345678901234567890',
      to: '0x0987654321098765432109876543210987654321',
      value: '0.5',
      type: 'send',
      status: 'confirmed',
      timestamp: '2024-01-10T10:00:00Z',
      chain: 'ethereum',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock store state
    mockBlockchainStore.internalWallets = [...mockInternalWallets];
    mockBlockchainStore.walletLoading = false;
    mockBlockchainStore.currentWallet = null;
    mockBlockchainStore.currentAddress = '0x1234567890123456789012345678901234567890';
    mockBlockchainStore.currentChainId = 1;
    mockBlockchainStore.externalWalletConnected = false;

    wrapper = mount(Wallet, {
      global: {
        config: {
          warnHandler: () => {}, // Suppress Vue warnings
        },
        stubs: {
          'a-card': { template: '<div><slot /></div>' },
          'a-tabs': { template: '<div><slot /></div>' },
          'a-tab-pane': { template: '<div><slot /></div>' },
          'a-button': { template: '<button><slot /></button>' },
          'a-list': { template: '<div><slot /></div>' },
          'a-list-item': { template: '<div><slot /></div>' },
          'a-list-item-meta': { template: '<div><slot /></div>' },
          'a-avatar': { template: '<span />' },
          'a-dropdown': { template: '<div><slot /></div>' },
          'a-menu': { template: '<div><slot /></div>' },
          'a-menu-item': { template: '<div><slot /></div>' },
          'a-modal': { template: '<div><slot /></div>' },
          'a-form': { template: '<div><slot /></div>' },
          'a-form-item': { template: '<div><slot /></div>' },
          'a-input': { template: '<input />' },
          'a-input-password': { template: '<input type="password" />' },
          'a-select': { template: '<div><slot /></div>' },
          'a-select-option': { template: '<div><slot /></div>' },
          'a-tag': { template: '<span><slot /></span>' },
          'a-badge': { template: '<span><slot /></span>' },
          'a-empty': { template: '<div>Empty</div>' },
          'a-space': { template: '<div><slot /></div>' },
          'a-tooltip': { template: '<div><slot /></div>' },
          'a-spin': { template: '<div><slot /></div>' },
          'a-result': { template: '<div><slot /></div>' },
          'a-row': { template: '<div><slot /></div>' },
          'a-col': { template: '<div><slot /></div>' },
          'a-statistic': { template: '<div><slot /></div>' },
          'a-divider': { template: '<div />' },
          'WalletOutlined': { template: '<span />' },
          'PlusOutlined': { template: '<span />' },
          'ImportOutlined': { template: '<span />' },
          'MoreOutlined': { template: '<span />' },
          'CopyOutlined': { template: '<span />' },
          'SwapOutlined': { template: '<span />' },
          'SendOutlined': { template: '<span />' },
          'DownloadOutlined': { template: '<span />' },
          'DeleteOutlined': { template: '<span />' },
          'StarOutlined': { template: '<span />' },
          'StarFilled': { template: '<span />' },
          'CheckCircleOutlined': { template: '<span />' },
          'ClockCircleOutlined': { template: '<span />' },
          'CloseCircleOutlined': { template: '<span />' },
          'HistoryOutlined': { template: '<span />' },
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  // ==================== 组件初始化 ====================
  describe('组件初始化', () => {
    it('应该正确渲染组件', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('应该初始化默认数据', () => {
      expect(wrapper.vm.activeTab).toBe('internal');
      expect(wrapper.vm.selectedTransaction).toBeNull();
      expect(wrapper.vm.createWalletModalVisible).toBe(false);
      expect(wrapper.vm.importWalletModalVisible).toBe(false);
      expect(wrapper.vm.transactionDetailVisible).toBe(false);
    });

    it('挂载时应该初始化区块链store', async () => {
      await wrapper.vm.$nextTick();
      expect(mockBlockchainStore.initialize).toHaveBeenCalled();
    });
  });

  // ==================== 内部钱包管理 ====================
  describe('内部钱包管理', () => {
    it('应该显示内部钱包列表', () => {
      expect(wrapper.vm.internalWallets.length).toBe(2);
      expect(wrapper.vm.internalWallets[0].address).toBe('0x1234567890123456789012345678901234567890');
    });

    it('应该能显示创建钱包对话框', () => {
      wrapper.vm.showCreateWalletModal();
      expect(wrapper.vm.createWalletModalVisible).toBe(true);
    });

    it('钱包创建成功后应该刷新余额', () => {
      const newWallet = {
        id: 3,
        name: 'New Wallet',
        address: '0xnewaddress123',
      };

      wrapper.vm.handleWalletCreated(newWallet);

      expect(mockBlockchainStore.fetchBalance).toHaveBeenCalledWith(
        '0xnewaddress123',
        mockBlockchainStore.currentChainId
      );
    });

    it('应该能显示导入钱包对话框', () => {
      wrapper.vm.showImportWalletModal();
      expect(wrapper.vm.importWalletModalVisible).toBe(true);
    });

    it('钱包导入成功后应该刷新余额', () => {
      const importedWallet = {
        id: 4,
        name: 'Imported Wallet',
        address: '0ximportedaddress456',
      };

      wrapper.vm.handleWalletImported(importedWallet);

      expect(mockBlockchainStore.fetchBalance).toHaveBeenCalledWith(
        '0ximportedaddress456',
        mockBlockchainStore.currentChainId
      );
    });

    it('应该能通过handleWalletAction设置默认钱包', async () => {
      const wallet = mockInternalWallets[1];
      mockBlockchainStore.setDefaultWallet.mockResolvedValueOnce();

      await wrapper.vm.handleWalletAction('setDefault', wallet);

      expect(mockBlockchainStore.setDefaultWallet).toHaveBeenCalledWith(wallet.id);
      expect(message.success).toHaveBeenCalledWith('已设置为默认钱包');
    });

    it('应该能通过handleWalletAction删除钱包', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      const wallet = mockInternalWallets[1];
      mockBlockchainStore.deleteWallet.mockResolvedValueOnce();

      await wrapper.vm.handleWalletAction('delete', wallet);

      expect(Modal.confirm).toHaveBeenCalled();
      expect(mockBlockchainStore.deleteWallet).toHaveBeenCalledWith(wallet.id);
      expect(message.success).toHaveBeenCalledWith('钱包已删除');
    });

    it('删除钱包时应该显示确认对话框', async () => {
      Modal.confirm.mockImplementation(() => Promise.resolve());

      const wallet = mockInternalWallets[0];
      await wrapper.vm.handleWalletAction('delete', wallet);

      expect(Modal.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '确认删除',
          okType: 'danger',
        })
      );
    });

    it('应该能选择钱包', () => {
      const wallet = mockInternalWallets[0];

      wrapper.vm.handleSelectWallet(wallet);

      expect(mockBlockchainStore.selectWallet).toHaveBeenCalledWith(wallet);
      expect(message.success).toHaveBeenCalledWith('已切换钱包');
    });
  });

  // ==================== 外部钱包连接 ====================
  describe('外部钱包连接', () => {
    it('应该能连接MetaMask', async () => {
      mockBlockchainStore.connectMetaMask.mockResolvedValueOnce();

      await wrapper.vm.handleConnectMetaMask();

      expect(mockBlockchainStore.connectMetaMask).toHaveBeenCalled();
      expect(wrapper.vm.activeTab).toBe('external');
    });

    it('应该能连接WalletConnect', async () => {
      mockBlockchainStore.connectWalletConnect.mockResolvedValueOnce();

      await wrapper.vm.handleConnectWalletConnect();

      expect(mockBlockchainStore.connectWalletConnect).toHaveBeenCalled();
      expect(wrapper.vm.activeTab).toBe('external');
    });

    it('应该能断开外部钱包', () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      wrapper.vm.handleDisconnectExternal();

      expect(Modal.confirm).toHaveBeenCalled();
      expect(mockBlockchainStore.disconnectExternalWallet).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('已断开连接');
    });
  });

  // ==================== 钱包地址操作 ====================
  describe('钱包地址操作', () => {
    it('应该能通过handleWalletAction复制地址', async () => {
      const wallet = mockInternalWallets[0];
      navigator.clipboard.writeText.mockResolvedValueOnce();

      await wrapper.vm.handleWalletAction('copyAddress', wallet);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(wallet.address);
      expect(message.success).toHaveBeenCalledWith('地址已复制到剪贴板');
    });

    it('复制地址失败应该显示错误', async () => {
      navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Copy failed'));

      await wrapper.vm.handleCopyAddress('0xaddress');

      expect(message.error).toHaveBeenCalledWith('复制失败');
    });

    it('应该显示缩短的地址', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const shortened = wrapper.vm.formatAddress(address);

      expect(shortened).toBe('0x12345678...34567890');
    });

    it('应该处理null地址', () => {
      const shortened = wrapper.vm.formatAddress(null);
      expect(shortened).toBe('');
    });

    it('应该处理undefined地址', () => {
      const shortened = wrapper.vm.formatAddress(undefined);
      expect(shortened).toBe('');
    });

    it('应该处理短地址', () => {
      const address = '0x1234567890';
      const shortened = wrapper.vm.formatAddress(address);
      expect(shortened).toBe('0x1234567890');
    });
  });

  // ==================== 余额显示 ====================
  describe('余额显示', () => {
    it('应该获取钱包余额', () => {
      const wallet = mockInternalWallets[0];
      mockBlockchainStore.getBalance.mockReturnValueOnce('1500000000000000000'); // 1.5 ETH in wei

      const balance = wrapper.vm.getWalletBalance(wallet);

      expect(mockBlockchainStore.getBalance).toHaveBeenCalledWith(
        wallet.address,
        mockBlockchainStore.currentChainId
      );
      expect(balance).toContain('ETH');
    });

    it('应该处理零余额', () => {
      const wallet = mockInternalWallets[0];
      mockBlockchainStore.getBalance.mockReturnValueOnce('0');

      const balance = wrapper.vm.getWalletBalance(wallet);
      expect(balance).toBe('0.00 ETH');
    });

    it('应该处理null余额', () => {
      const wallet = mockInternalWallets[0];
      mockBlockchainStore.getBalance.mockReturnValueOnce(null);

      const balance = wrapper.vm.getWalletBalance(wallet);
      expect(balance).toBe('0.00 ETH');
    });

    it('应该处理无地址的钱包', () => {
      const wallet = { ...mockInternalWallets[0], address: null };

      const balance = wrapper.vm.getWalletBalance(wallet);
      expect(balance).toBe('0.00 ETH');
    });
  });

  // ==================== 交易历史 ====================
  describe('交易历史', () => {
    it('应该能查看交易详情', () => {
      const transaction = mockTransactions[0];

      wrapper.vm.handleViewTransactionDetails(transaction);

      expect(wrapper.vm.selectedTransaction).toEqual(transaction);
      expect(wrapper.vm.transactionDetailVisible).toBe(true);
    });

    it('应该能刷新交易', async () => {
      const transaction = mockTransactions[0];

      await wrapper.vm.handleRefreshTransaction(transaction);

      expect(mockBlockchainStore.refreshTransactions).toHaveBeenCalledWith(
        '0x1234567890123456789012345678901234567890',
        1
      );
    });
  });

  // ==================== 网络切换 ====================
  describe('网络切换', () => {
    it('应该能处理网络切换', () => {
      wrapper.vm.handleChainSwitched({ chainId: 56, network: { name: 'BSC' } });

      expect(mockBlockchainStore.refreshCurrentBalance).toHaveBeenCalled();
    });
  });

  // ==================== 日期格式化 ====================
  describe('日期格式化', () => {
    it('应该格式化日期', () => {
      const timestamp = '2024-01-01T10:00:00Z';
      const formatted = wrapper.vm.formatDate(timestamp);

      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
    });

    it('应该处理null日期', () => {
      const formatted = wrapper.vm.formatDate(null);
      expect(formatted).toBe('');
    });

    it('应该处理undefined日期', () => {
      const formatted = wrapper.vm.formatDate(undefined);
      expect(formatted).toBe('');
    });
  });

  // ==================== 头像颜色 ====================
  describe('头像颜色', () => {
    it('应该生成头像颜色', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const color = wrapper.vm.getAvatarColor(address);

      expect(color).toBeDefined();
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('应该处理null地址', () => {
      const color = wrapper.vm.getAvatarColor(null);
      expect(color).toBe('#1890ff');
    });
  });
});
