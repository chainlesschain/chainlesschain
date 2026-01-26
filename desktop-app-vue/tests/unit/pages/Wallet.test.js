import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Wallet from '../../../src/renderer/pages/Wallet.vue';
import { useBlockchainStore } from '../../../src/renderer/stores/blockchain';
import { message, Modal } from 'ant-design-vue';

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
}));

// Mock Vue Router
const mockRouter = {
  push: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
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

describe('Wallet.vue', () => {
  let wrapper;
  let blockchainStore;

  const mockInternalWallets = [
    {
      id: 1,
      name: 'Main Wallet',
      address: '0x1234567890123456789012345678901234567890',
      chain: 'ethereum',
      balance: '1.5',
      isDefault: true,
      type: 'internal',
      created_at: '2024-01-01T10:00:00Z',
    },
    {
      id: 2,
      name: 'Trading Wallet',
      address: '0x0987654321098765432109876543210987654321',
      chain: 'bsc',
      balance: '100.25',
      isDefault: false,
      type: 'internal',
      created_at: '2024-01-05T10:00:00Z',
    },
  ];

  const mockExternalWallets = [
    {
      id: 'ext-1',
      name: 'MetaMask',
      address: '0xabcdef1234567890abcdef1234567890abcdef12',
      chain: 'ethereum',
      balance: '0.5',
      type: 'metamask',
      connected: true,
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
    {
      id: 'tx-2',
      hash: '0xdef456',
      from: '0x0987654321098765432109876543210987654321',
      to: '0x1234567890123456789012345678901234567890',
      value: '1.0',
      type: 'receive',
      status: 'confirmed',
      timestamp: '2024-01-11T10:00:00Z',
      chain: 'ethereum',
    },
    {
      id: 'tx-3',
      hash: '0xghi789',
      from: '0x1234567890123456789012345678901234567890',
      to: '0xabcdef1234567890abcdef1234567890abcdef12',
      value: '0.1',
      type: 'send',
      status: 'pending',
      timestamp: '2024-01-12T10:00:00Z',
      chain: 'ethereum',
    },
  ];

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    blockchainStore = useBlockchainStore();

    // Mock store methods
    blockchainStore.createWallet = vi.fn();
    blockchainStore.importWallet = vi.fn();
    blockchainStore.deleteWallet = vi.fn();
    blockchainStore.setDefaultWallet = vi.fn();
    blockchainStore.connectExternalWallet = vi.fn();
    blockchainStore.disconnectExternalWallet = vi.fn();
    blockchainStore.fetchWallets = vi.fn();
    blockchainStore.fetchTransactions = vi.fn();
    blockchainStore.updateBalance = vi.fn();

    vi.clearAllMocks();

    wrapper = mount(Wallet, {
      global: {
        plugins: [pinia],
        stubs: {
          'a-card': { template: '<div><slot /></div>' },
          'a-tabs': { template: '<div><slot /></div>' },
          'a-tab-pane': { template: '<div><slot /></div>' },
          'a-button': { template: '<button><slot /></button>' },
          'a-list': { template: '<div><slot /></div>' },
          'a-list-item': { template: '<div><slot /></div>' },
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
          'WalletOutlined': { template: '<span />' },
          'PlusOutlined': { template: '<span />' },
          'MoreOutlined': { template: '<span />' },
        },
      },
    });

    // Set mock data
    blockchainStore.internalWallets = [...mockInternalWallets];
    blockchainStore.externalWallets = [...mockExternalWallets];
    blockchainStore.transactions = [...mockTransactions];
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
      expect(wrapper.vm.selectedWallet).toBeNull();
      expect(wrapper.vm.createModalVisible).toBe(false);
      expect(wrapper.vm.importModalVisible).toBe(false);
      expect(wrapper.vm.loading).toBe(false);
    });

    it('挂载时应该加载钱包列表', async () => {
      await wrapper.vm.$nextTick();
      expect(blockchainStore.fetchWallets).toHaveBeenCalled();
    });

    it('挂载时应该加载交易历史', async () => {
      await wrapper.vm.$nextTick();
      expect(blockchainStore.fetchTransactions).toHaveBeenCalled();
    });
  });

  // ==================== 内部钱包管理 ====================
  describe('内部钱包管理', () => {
    it('应该显示内部钱包列表', () => {
      const wallets = blockchainStore.internalWallets;
      expect(wallets.length).toBe(2);
    });

    it('应该能创建新钱包', async () => {
      wrapper.vm.createForm = {
        name: 'New Wallet',
        password: 'password123',
        chain: 'ethereum',
      };

      blockchainStore.createWallet.mockResolvedValueOnce({
        success: true,
        wallet: {
          id: 3,
          name: 'New Wallet',
          address: '0xnewaddress',
        },
      });

      await wrapper.vm.handleCreateWallet();

      expect(blockchainStore.createWallet).toHaveBeenCalledWith({
        name: 'New Wallet',
        password: 'password123',
        chain: 'ethereum',
      });
      expect(message.success).toHaveBeenCalledWith('钱包创建成功');
      expect(wrapper.vm.createModalVisible).toBe(false);
    });

    it('创建钱包应该验证表单', async () => {
      wrapper.vm.createForm = {
        name: '',
        password: '',
        chain: '',
      };

      await wrapper.vm.handleCreateWallet();

      expect(blockchainStore.createWallet).not.toHaveBeenCalled();
    });

    it('创建钱包失败应该显示错误', async () => {
      wrapper.vm.createForm = {
        name: 'New Wallet',
        password: 'password123',
        chain: 'ethereum',
      };

      blockchainStore.createWallet.mockRejectedValueOnce(new Error('Create failed'));

      await wrapper.vm.handleCreateWallet();

      expect(message.error).toHaveBeenCalledWith('创建钱包失败: Create failed');
    });

    it('应该能导入钱包', async () => {
      wrapper.vm.importForm = {
        name: 'Imported Wallet',
        privateKey: '0xprivatekey',
        password: 'password123',
        chain: 'ethereum',
      };

      blockchainStore.importWallet.mockResolvedValueOnce({
        success: true,
        wallet: {
          id: 4,
          name: 'Imported Wallet',
          address: '0ximportedaddress',
        },
      });

      await wrapper.vm.handleImportWallet();

      expect(blockchainStore.importWallet).toHaveBeenCalledWith({
        name: 'Imported Wallet',
        privateKey: '0xprivatekey',
        password: 'password123',
        chain: 'ethereum',
      });
      expect(message.success).toHaveBeenCalledWith('钱包导入成功');
      expect(wrapper.vm.importModalVisible).toBe(false);
    });

    it('导入钱包应该验证私钥格式', async () => {
      wrapper.vm.importForm = {
        name: 'Imported Wallet',
        privateKey: 'invalid',
        password: 'password123',
        chain: 'ethereum',
      };

      await wrapper.vm.handleImportWallet();

      expect(message.error).toHaveBeenCalledWith(expect.stringContaining('私钥'));
    });

    it('导入钱包失败应该显示错误', async () => {
      wrapper.vm.importForm = {
        name: 'Imported Wallet',
        privateKey: '0xprivatekey',
        password: 'password123',
        chain: 'ethereum',
      };

      blockchainStore.importWallet.mockRejectedValueOnce(new Error('Import failed'));

      await wrapper.vm.handleImportWallet();

      expect(message.error).toHaveBeenCalledWith('导入钱包失败: Import failed');
    });

    it('应该能设置默认钱包', async () => {
      const wallet = mockInternalWallets[1];
      blockchainStore.setDefaultWallet.mockResolvedValueOnce({ success: true });

      await wrapper.vm.handleSetDefault(wallet.id);

      expect(blockchainStore.setDefaultWallet).toHaveBeenCalledWith(wallet.id);
      expect(message.success).toHaveBeenCalledWith('已设置为默认钱包');
    });

    it('设置默认钱包失败应该显示错误', async () => {
      blockchainStore.setDefaultWallet.mockRejectedValueOnce(new Error('Set default failed'));

      await wrapper.vm.handleSetDefault(1);

      expect(message.error).toHaveBeenCalledWith('设置失败: Set default failed');
    });

    it('应该能删除钱包', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      const wallet = mockInternalWallets[1];
      blockchainStore.deleteWallet.mockResolvedValueOnce({ success: true });

      await wrapper.vm.handleDeleteWallet(wallet.id);

      expect(Modal.confirm).toHaveBeenCalled();
      expect(blockchainStore.deleteWallet).toHaveBeenCalledWith(wallet.id);
      expect(message.success).toHaveBeenCalledWith('钱包已删除');
    });

    it('删除钱包应该显示警告确认', async () => {
      Modal.confirm.mockImplementation(() => Promise.resolve());

      await wrapper.vm.handleDeleteWallet(1);

      expect(Modal.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '确认删除',
          content: expect.stringContaining('请确保已备份'),
        })
      );
    });

    it('不能删除默认钱包', async () => {
      const defaultWallet = mockInternalWallets[0];

      await wrapper.vm.handleDeleteWallet(defaultWallet.id);

      expect(message.warning).toHaveBeenCalledWith('不能删除默认钱包');
      expect(Modal.confirm).not.toHaveBeenCalled();
    });

    it('删除钱包失败应该显示错误', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      blockchainStore.deleteWallet.mockRejectedValueOnce(new Error('Delete failed'));

      await wrapper.vm.handleDeleteWallet(2);

      expect(message.error).toHaveBeenCalledWith('删除失败: Delete failed');
    });
  });

  // ==================== 外部钱包连接 ====================
  describe('外部钱包连接', () => {
    it('应该显示外部钱包列表', () => {
      const wallets = blockchainStore.externalWallets;
      expect(wallets.length).toBe(1);
    });

    it('应该能连接MetaMask', async () => {
      window.ethereum = {
        request: vi.fn().mockResolvedValue(['0xmetamaskaddress']),
      };

      blockchainStore.connectExternalWallet.mockResolvedValueOnce({
        success: true,
        wallet: {
          type: 'metamask',
          address: '0xmetamaskaddress',
        },
      });

      await wrapper.vm.handleConnectMetaMask();

      expect(blockchainStore.connectExternalWallet).toHaveBeenCalledWith('metamask');
      expect(message.success).toHaveBeenCalledWith('MetaMask连接成功');
    });

    it('未安装MetaMask应该提示', async () => {
      window.ethereum = undefined;

      await wrapper.vm.handleConnectMetaMask();

      expect(message.warning).toHaveBeenCalledWith('请先安装MetaMask');
    });

    it('连接MetaMask失败应该显示错误', async () => {
      window.ethereum = {
        request: vi.fn().mockRejectedValue(new Error('User rejected')),
      };

      await wrapper.vm.handleConnectMetaMask();

      expect(message.error).toHaveBeenCalledWith(expect.stringContaining('连接失败'));
    });

    it('应该能连接WalletConnect', async () => {
      blockchainStore.connectExternalWallet.mockResolvedValueOnce({
        success: true,
        wallet: {
          type: 'walletconnect',
          address: '0xwalletconnectaddress',
        },
      });

      await wrapper.vm.handleConnectWalletConnect();

      expect(blockchainStore.connectExternalWallet).toHaveBeenCalledWith('walletconnect');
      expect(message.success).toHaveBeenCalledWith('WalletConnect连接成功');
    });

    it('连接WalletConnect失败应该显示错误', async () => {
      blockchainStore.connectExternalWallet.mockRejectedValueOnce(
        new Error('Connection failed')
      );

      await wrapper.vm.handleConnectWalletConnect();

      expect(message.error).toHaveBeenCalledWith(expect.stringContaining('连接失败'));
    });

    it('应该能断开外部钱包', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      const wallet = mockExternalWallets[0];
      blockchainStore.disconnectExternalWallet.mockResolvedValueOnce({ success: true });

      await wrapper.vm.handleDisconnectWallet(wallet.id);

      expect(Modal.confirm).toHaveBeenCalled();
      expect(blockchainStore.disconnectExternalWallet).toHaveBeenCalledWith(wallet.id);
      expect(message.success).toHaveBeenCalledWith('钱包已断开连接');
    });

    it('断开连接失败应该显示错误', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      blockchainStore.disconnectExternalWallet.mockRejectedValueOnce(
        new Error('Disconnect failed')
      );

      await wrapper.vm.handleDisconnectWallet('ext-1');

      expect(message.error).toHaveBeenCalledWith('断开连接失败: Disconnect failed');
    });
  });

  // ==================== 钱包地址操作 ====================
  describe('钱包地址操作', () => {
    it('应该能复制地址', async () => {
      const wallet = mockInternalWallets[0];

      await wrapper.vm.handleCopyAddress(wallet.address);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(wallet.address);
      expect(message.success).toHaveBeenCalledWith('地址已复制');
    });

    it('复制地址失败应该显示错误', async () => {
      navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Copy failed'));

      await wrapper.vm.handleCopyAddress('0xaddress');

      expect(message.error).toHaveBeenCalledWith('复制失败: Copy failed');
    });

    it('应该显示缩短的地址', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const shortened = wrapper.vm.formatAddress(address);

      expect(shortened).toBe('0x1234...7890');
    });

    it('应该处理null地址', () => {
      const shortened = wrapper.vm.formatAddress(null);
      expect(shortened).toBe('-');
    });

    it('应该处理undefined地址', () => {
      const shortened = wrapper.vm.formatAddress(undefined);
      expect(shortened).toBe('-');
    });
  });

  // ==================== 余额显示 ====================
  describe('余额显示', () => {
    it('应该显示余额', () => {
      const wallet = mockInternalWallets[0];
      expect(wallet.balance).toBe('1.5');
    });

    it('应该格式化余额', () => {
      const formatted = wrapper.vm.formatBalance('1.5', 'ETH');
      expect(formatted).toBe('1.5 ETH');
    });

    it('应该处理大额余额', () => {
      const formatted = wrapper.vm.formatBalance('1234567.89', 'ETH');
      expect(formatted).toBe('1234567.89 ETH');
    });

    it('应该处理小额余额', () => {
      const formatted = wrapper.vm.formatBalance('0.000001', 'ETH');
      expect(formatted).toBe('0.000001 ETH');
    });

    it('应该处理零余额', () => {
      const formatted = wrapper.vm.formatBalance('0', 'ETH');
      expect(formatted).toBe('0 ETH');
    });

    it('应该处理null余额', () => {
      const formatted = wrapper.vm.formatBalance(null, 'ETH');
      expect(formatted).toBe('0 ETH');
    });

    it('应该能刷新余额', async () => {
      const wallet = mockInternalWallets[0];
      blockchainStore.updateBalance.mockResolvedValueOnce({
        success: true,
        balance: '2.0',
      });

      await wrapper.vm.handleRefreshBalance(wallet.id);

      expect(blockchainStore.updateBalance).toHaveBeenCalledWith(wallet.id);
      expect(message.success).toHaveBeenCalledWith('余额已更新');
    });

    it('刷新余额失败应该显示错误', async () => {
      blockchainStore.updateBalance.mockRejectedValueOnce(new Error('Update failed'));

      await wrapper.vm.handleRefreshBalance(1);

      expect(message.error).toHaveBeenCalledWith('更新失败: Update failed');
    });
  });

  // ==================== 交易历史 ====================
  describe('交易历史', () => {
    it('应该显示交易历史', () => {
      const transactions = blockchainStore.transactions;
      expect(transactions.length).toBe(3);
    });

    it('应该按时间倒序排列', () => {
      const transactions = wrapper.vm.sortedTransactions;

      for (let i = 0; i < transactions.length - 1; i++) {
        const current = new Date(transactions[i].timestamp);
        const next = new Date(transactions[i + 1].timestamp);
        expect(current >= next).toBe(true);
      }
    });

    it('应该能查看交易详情', async () => {
      const tx = mockTransactions[0];

      await wrapper.vm.handleViewTransaction(tx.hash);

      expect(wrapper.vm.selectedTransaction).toEqual(tx);
      expect(wrapper.vm.transactionModalVisible).toBe(true);
    });

    it('应该能在浏览器中查看交易', async () => {
      const tx = mockTransactions[0];
      window.electron.invoke.mockResolvedValueOnce({ success: true });

      await wrapper.vm.handleViewInExplorer(tx);

      expect(window.electron.invoke).toHaveBeenCalledWith(
        'shell:open-external',
        expect.stringContaining(tx.hash)
      );
    });

    it('应该显示交易类型', () => {
      expect(wrapper.vm.getTransactionTypeText('send')).toBe('发送');
      expect(wrapper.vm.getTransactionTypeText('receive')).toBe('接收');
      expect(wrapper.vm.getTransactionTypeText('contract')).toBe('合约调用');
    });

    it('应该显示交易状态', () => {
      expect(wrapper.vm.getTransactionStatusText('confirmed')).toBe('已确认');
      expect(wrapper.vm.getTransactionStatusText('pending')).toBe('待确认');
      expect(wrapper.vm.getTransactionStatusText('failed')).toBe('失败');
    });

    it('应该显示交易状态颜色', () => {
      expect(wrapper.vm.getTransactionStatusColor('confirmed')).toBe('success');
      expect(wrapper.vm.getTransactionStatusColor('pending')).toBe('processing');
      expect(wrapper.vm.getTransactionStatusColor('failed')).toBe('error');
    });

    it('应该能过滤交易类型', async () => {
      wrapper.vm.transactionFilter = 'send';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredTransactions;
      expect(filtered.every(tx => tx.type === 'send')).toBe(true);
    });

    it('应该能过滤交易状态', async () => {
      wrapper.vm.transactionFilter = 'pending';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredTransactions;
      expect(filtered.every(tx => tx.status === 'pending')).toBe(true);
    });
  });

  // ==================== 链/网络切换 ====================
  describe('链/网络切换', () => {
    it('应该显示支持的链', () => {
      const chains = wrapper.vm.supportedChains;
      expect(chains).toContain('ethereum');
      expect(chains).toContain('bsc');
      expect(chains).toContain('polygon');
    });

    it('应该能切换链', async () => {
      wrapper.vm.selectedChain = 'ethereum';
      await wrapper.vm.$nextTick();

      wrapper.vm.selectedChain = 'bsc';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedChain).toBe('bsc');
    });

    it('应该显示链名称', () => {
      expect(wrapper.vm.getChainName('ethereum')).toBe('Ethereum');
      expect(wrapper.vm.getChainName('bsc')).toBe('BSC');
      expect(wrapper.vm.getChainName('polygon')).toBe('Polygon');
    });

    it('应该过滤当前链的钱包', async () => {
      wrapper.vm.selectedChain = 'ethereum';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredWallets;
      expect(filtered.every(w => w.chain === 'ethereum')).toBe(true);
    });

    it('选择所有链应该显示全部钱包', async () => {
      wrapper.vm.selectedChain = 'all';
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredWallets;
      expect(filtered.length).toBe(mockInternalWallets.length);
    });
  });

  // ==================== 钱包详情 ====================
  describe('钱包详情', () => {
    it('应该能查看钱包详情', async () => {
      const wallet = mockInternalWallets[0];

      await wrapper.vm.handleViewWalletDetails(wallet);

      expect(wrapper.vm.selectedWallet).toEqual(wallet);
      expect(wrapper.vm.detailsModalVisible).toBe(true);
    });

    it('应该能导出私钥', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      const wallet = mockInternalWallets[0];
      window.electron.invoke.mockResolvedValueOnce({
        success: true,
        privateKey: '0xprivatekey',
      });

      await wrapper.vm.handleExportPrivateKey(wallet.id, 'password123');

      expect(window.electron.invoke).toHaveBeenCalledWith('blockchain:export-private-key', {
        walletId: wallet.id,
        password: 'password123',
      });
      expect(message.success).toHaveBeenCalledWith('私钥已复制到剪贴板');
    });

    it('导出私钥应该验证密码', async () => {
      await wrapper.vm.handleExportPrivateKey(1, '');

      expect(message.error).toHaveBeenCalledWith('请输入密码');
    });

    it('导出私钥失败应该显示错误', async () => {
      Modal.confirm.mockImplementation(({ onOk }) => {
        onOk();
        return Promise.resolve();
      });

      window.electron.invoke.mockRejectedValueOnce(new Error('Wrong password'));

      await wrapper.vm.handleExportPrivateKey(1, 'wrongpassword');

      expect(message.error).toHaveBeenCalledWith(expect.stringContaining('导出失败'));
    });
  });

  // ==================== 发送交易 ====================
  describe('发送交易', () => {
    it('应该能发起转账', async () => {
      wrapper.vm.sendForm = {
        from: mockInternalWallets[0].id,
        to: '0xrecipient',
        amount: '0.5',
        password: 'password123',
      };

      window.electron.invoke.mockResolvedValueOnce({
        success: true,
        txHash: '0xtxhash',
      });

      await wrapper.vm.handleSendTransaction();

      expect(window.electron.invoke).toHaveBeenCalledWith('blockchain:send-transaction', {
        from: mockInternalWallets[0].id,
        to: '0xrecipient',
        amount: '0.5',
        password: 'password123',
      });
      expect(message.success).toHaveBeenCalledWith('交易已发送');
    });

    it('发送交易应该验证表单', async () => {
      wrapper.vm.sendForm = {
        from: null,
        to: '',
        amount: '',
        password: '',
      };

      await wrapper.vm.handleSendTransaction();

      expect(window.electron.invoke).not.toHaveBeenCalled();
    });

    it('发送交易应该验证地址格式', async () => {
      wrapper.vm.sendForm = {
        from: mockInternalWallets[0].id,
        to: 'invalid',
        amount: '0.5',
        password: 'password123',
      };

      await wrapper.vm.handleSendTransaction();

      expect(message.error).toHaveBeenCalledWith(expect.stringContaining('地址'));
    });

    it('发送交易应该验证余额', async () => {
      wrapper.vm.sendForm = {
        from: mockInternalWallets[0].id,
        to: '0xrecipient',
        amount: '100', // More than balance
        password: 'password123',
      };

      await wrapper.vm.handleSendTransaction();

      expect(message.error).toHaveBeenCalledWith('余额不足');
    });

    it('发送交易失败应该显示错误', async () => {
      wrapper.vm.sendForm = {
        from: mockInternalWallets[0].id,
        to: '0xrecipient',
        amount: '0.5',
        password: 'password123',
      };

      window.electron.invoke.mockRejectedValueOnce(new Error('Insufficient gas'));

      await wrapper.vm.handleSendTransaction();

      expect(message.error).toHaveBeenCalledWith(expect.stringContaining('发送失败'));
    });
  });

  // ==================== 错误处理 ====================
  describe('错误处理', () => {
    it('加载钱包失败应该显示错误', async () => {
      blockchainStore.fetchWallets.mockRejectedValueOnce(new Error('Load failed'));

      await wrapper.vm.loadWallets();

      expect(message.error).toHaveBeenCalledWith('加载钱包失败: Load failed');
    });

    it('加载交易失败应该显示错误', async () => {
      blockchainStore.fetchTransactions.mockRejectedValueOnce(new Error('Load failed'));

      await wrapper.vm.loadTransactions();

      expect(message.error).toHaveBeenCalledWith('加载交易历史失败: Load failed');
    });

    it('应该处理网络错误', async () => {
      blockchainStore.createWallet.mockRejectedValueOnce(new Error('Network error'));

      wrapper.vm.createForm = {
        name: 'Test',
        password: 'pass',
        chain: 'ethereum',
      };

      await wrapper.vm.handleCreateWallet();

      expect(message.error).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });
  });

  // ==================== 边界情况 ====================
  describe('边界情况', () => {
    it('应该处理空钱包列表', () => {
      blockchainStore.internalWallets = [];
      expect(wrapper.vm.wallets.length).toBe(0);
    });

    it('应该处理空交易历史', () => {
      blockchainStore.transactions = [];
      expect(wrapper.vm.sortedTransactions.length).toBe(0);
    });

    it('应该处理无效的钱包ID', async () => {
      await wrapper.vm.handleDeleteWallet(999);

      // Should not throw error
      expect(true).toBe(true);
    });

    it('应该处理缺少balance的钱包', () => {
      const wallet = {
        id: 5,
        name: 'Test',
        address: '0xtest',
        balance: null,
      };

      const formatted = wrapper.vm.formatBalance(wallet.balance, 'ETH');
      expect(formatted).toBe('0 ETH');
    });

    it('应该处理超长地址', () => {
      const longAddress = '0x' + 'a'.repeat(100);
      const shortened = wrapper.vm.formatAddress(longAddress);

      expect(shortened.length).toBeLessThan(longAddress.length);
    });

    it('应该处理非常大的余额', () => {
      const largeBalance = '999999999999.123456789';
      const formatted = wrapper.vm.formatBalance(largeBalance, 'ETH');

      expect(formatted).toContain('ETH');
    });

    it('应该处理非常小的余额', () => {
      const tinyBalance = '0.000000000001';
      const formatted = wrapper.vm.formatBalance(tinyBalance, 'ETH');

      expect(formatted).toContain('ETH');
    });
  });

  // ==================== UI状态 ====================
  describe('UI状态', () => {
    it('应该显示加载状态', async () => {
      wrapper.vm.loading = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.loading).toBe(true);
    });

    it('应该显示空状态', () => {
      blockchainStore.internalWallets = [];
      blockchainStore.externalWallets = [];

      expect(wrapper.vm.wallets.length).toBe(0);
    });

    it('应该能切换标签页', async () => {
      wrapper.vm.activeTab = 'internal';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.activeTab).toBe('internal');

      wrapper.vm.activeTab = 'external';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.activeTab).toBe('external');

      wrapper.vm.activeTab = 'transactions';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.activeTab).toBe('transactions');
    });

    it('应该能打开/关闭创建钱包对话框', async () => {
      wrapper.vm.createModalVisible = false;

      await wrapper.vm.handleOpenCreateModal();
      expect(wrapper.vm.createModalVisible).toBe(true);

      await wrapper.vm.handleCloseCreateModal();
      expect(wrapper.vm.createModalVisible).toBe(false);
    });

    it('应该能打开/关闭导入钱包对话框', async () => {
      wrapper.vm.importModalVisible = false;

      await wrapper.vm.handleOpenImportModal();
      expect(wrapper.vm.importModalVisible).toBe(true);

      await wrapper.vm.handleCloseImportModal();
      expect(wrapper.vm.importModalVisible).toBe(false);
    });
  });

  // ==================== 统计信息 ====================
  describe('统计信息', () => {
    it('应该显示总钱包数', () => {
      const total =
        blockchainStore.internalWallets.length + blockchainStore.externalWallets.length;
      expect(total).toBe(3);
    });

    it('应该计算总余额', () => {
      const totalBalance = blockchainStore.internalWallets.reduce(
        (sum, w) => sum + parseFloat(w.balance || 0),
        0
      );

      expect(totalBalance).toBe(101.75); // 1.5 + 100.25
    });

    it('应该统计各链的钱包数', () => {
      const byChain = blockchainStore.internalWallets.reduce((acc, w) => {
        acc[w.chain] = (acc[w.chain] || 0) + 1;
        return acc;
      }, {});

      expect(byChain.ethereum).toBe(1);
      expect(byChain.bsc).toBe(1);
    });
  });

  // ==================== 时间格式化 ====================
  describe('时间格式化', () => {
    it('应该正确格式化交易时间', () => {
      const tx = mockTransactions[0];
      const formatted = wrapper.vm.formatDate(tx.timestamp);

      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
    });

    it('应该处理null时间', () => {
      const formatted = wrapper.vm.formatDate(null);
      expect(formatted).toBe('-');
    });

    it('应该显示相对时间', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const formatted = wrapper.vm.formatRelativeTime(oneHourAgo.toISOString());
      expect(formatted).toContain('小时前');
    });
  });
});
