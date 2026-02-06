/**
 * Blockchain Store - 区块链模块状态管理
 *
 * 管理区块链相关功能:
 * 1. 钱包管理 (内置 + 外部)
 * 2. 网络切换 (以太坊、Polygon 等)
 * 3. 交易监控
 * 4. 合约部署记录
 * 5. 余额查询
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 钱包类型
 */
export type WalletType = 'internal' | 'external';

/**
 * 外部钱包提供者
 */
export type ExternalWalletProvider = 'metamask' | 'walletconnect' | null;

/**
 * 钱包
 */
export interface Wallet {
  id: string;
  address: string;
  wallet_type: WalletType;
  name?: string;
  is_default: 0 | 1;
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * 网络配置
 */
export interface Network {
  chainId: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  blockExplorer: string | null;
  testnet: boolean;
}

/**
 * 交易状态
 */
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

/**
 * 交易
 */
export interface Transaction {
  id: string;
  tx_hash: string;
  from_address: string;
  to_address: string;
  value: string;
  gas_used?: string;
  gas_price?: string;
  status: TransactionStatus;
  chain_id: number;
  block_number?: number;
  created_at: number;
  confirmed_at?: number;
  [key: string]: any;
}

/**
 * 已部署合约
 */
export interface DeployedContract {
  id: string;
  local_contract_id?: string;
  address: string;
  name: string;
  chain_id: number;
  tx_hash: string;
  abi?: string;
  bytecode?: string;
  created_at: number;
  [key: string]: any;
}

/**
 * 已部署资产
 */
export interface DeployedAsset {
  id: string;
  local_asset_id?: string;
  contract_address: string;
  token_id?: string;
  name: string;
  chain_id: number;
  tx_hash: string;
  created_at: number;
  [key: string]: any;
}

/**
 * 余额缓存映射类型
 */
export interface BalanceCache {
  [key: string]: string;
}

/**
 * UI 状态
 */
export interface BlockchainUIState {
  showWalletModal: boolean;
  showNetworkModal: boolean;
  showTransactionModal: boolean;
  currentTransaction: Transaction | null;
}

/**
 * 连接钱包结果
 */
export interface ConnectWalletResult {
  address: string;
  chainId: number;
}

/**
 * 获取余额参数
 */
export interface GetBalanceParams {
  address: string;
  chainId: number;
  tokenAddress?: string | null;
}

/**
 * 交易过滤器
 */
export interface TransactionFilters {
  chainId?: number;
  status?: TransactionStatus;
  fromDate?: number;
  toDate?: number;
  limit?: number;
  offset?: number;
  [key: string]: any;
}

/**
 * Gas 估算交易参数
 */
export interface GasEstimateTransaction {
  from: string;
  to: string;
  value?: string;
  data?: string;
  [key: string]: any;
}

/**
 * Blockchain Store 状态
 */
export interface BlockchainState {
  // 钱包管理
  wallets: Wallet[];
  currentWallet: Wallet | null;
  externalWalletConnected: boolean;
  externalWalletAddress: string | null;
  externalWalletProvider: ExternalWalletProvider;
  balances: BalanceCache;
  walletLoading: boolean;
  creatingWallet: boolean;

  // 网络管理
  currentChainId: number;
  networks: Network[];
  switchingChain: boolean;

  // 交易管理
  transactions: Transaction[];
  pendingTransactions: Transaction[];
  transactionsLoading: boolean;

  // 合约部署
  deployedContracts: DeployedContract[];
  deployedAssets: DeployedAsset[];
  contractsLoading: boolean;

  // Gas 管理
  gasPrice: string | null;
  gasPriceLoading: boolean;

  // UI 状态
  ui: BlockchainUIState;
}

// ==================== Store ====================

export const useBlockchainStore = defineStore('blockchain', {
  state: (): BlockchainState => ({
    // ==================== 钱包管理 ====================
    wallets: [], // 所有钱包列表
    currentWallet: null, // 当前选中的钱包
    externalWalletConnected: false, // 外部钱包连接状态
    externalWalletAddress: null, // 外部钱包地址
    externalWalletProvider: null, // 外部钱包提供者 ('metamask' | 'walletconnect')
    balances: {}, // 余额缓存 { address_chainId_tokenAddress: balance }
    walletLoading: false, // 钱包加载状态
    creatingWallet: false, // 创建钱包中

    // ==================== 网络管理 ====================
    currentChainId: 31337, // 当前链 ID (默认 Hardhat 本地网络)
    networks: [
      {
        chainId: 1,
        name: '以太坊主网',
        symbol: 'ETH',
        rpcUrl: 'https://mainnet.infura.io/v3/YOUR_API_KEY',
        blockExplorer: 'https://etherscan.io',
        testnet: false,
      },
      {
        chainId: 11155111,
        name: 'Sepolia 测试网',
        symbol: 'ETH',
        rpcUrl: 'https://sepolia.infura.io/v3/YOUR_API_KEY',
        blockExplorer: 'https://sepolia.etherscan.io',
        testnet: true,
      },
      {
        chainId: 137,
        name: 'Polygon 主网',
        symbol: 'MATIC',
        rpcUrl: 'https://polygon-rpc.com',
        blockExplorer: 'https://polygonscan.com',
        testnet: false,
      },
      {
        chainId: 80001,
        name: 'Mumbai 测试网',
        symbol: 'MATIC',
        rpcUrl: 'https://rpc-mumbai.maticvigil.com',
        blockExplorer: 'https://mumbai.polygonscan.com',
        testnet: true,
      },
      {
        chainId: 31337,
        name: 'Hardhat 本地网络',
        symbol: 'ETH',
        rpcUrl: 'http://127.0.0.1:8545',
        blockExplorer: null,
        testnet: true,
      },
    ],
    switchingChain: false, // 切换网络中

    // ==================== 交易管理 ====================
    transactions: [], // 交易历史
    pendingTransactions: [], // 待确认交易
    transactionsLoading: false,

    // ==================== 合约部署 ====================
    deployedContracts: [], // 已部署的合约
    deployedAssets: [], // 已部署的资产
    contractsLoading: false,

    // ==================== Gas 管理 ====================
    gasPrice: null, // 当前 Gas 价格
    gasPriceLoading: false,

    // ==================== UI 状态 ====================
    ui: {
      showWalletModal: false, // 显示钱包选择模态框
      showNetworkModal: false, // 显示网络切换模态框
      showTransactionModal: false, // 显示交易详情模态框
      currentTransaction: null, // 当前查看的交易
    },
  }),

  getters: {
    // ===== 钱包 Getters =====

    /**
     * 内置钱包列表（非外部钱包）
     */
    internalWallets(): Wallet[] {
      return this.wallets.filter((w) => w.wallet_type === 'internal');
    },

    /**
     * 当前钱包地址
     */
    currentAddress(): string | null {
      if (this.externalWalletConnected && this.externalWalletAddress) {
        return this.externalWalletAddress;
      }
      return this.currentWallet?.address || null;
    },

    /**
     * 当前钱包类型
     */
    currentWalletType(): WalletType | 'external' | null {
      if (this.externalWalletConnected) {
        return 'external';
      }
      return this.currentWallet?.wallet_type || null;
    },

    /**
     * 是否有可用钱包
     */
    hasWallet(): boolean {
      return this.wallets.length > 0 || this.externalWalletConnected;
    },

    // ===== 网络 Getters =====

    /**
     * 当前网络信息
     */
    currentNetwork(): Network | null {
      return this.networks.find((n) => n.chainId === this.currentChainId) || null;
    },

    /**
     * 主网列表
     */
    mainnetNetworks(): Network[] {
      return this.networks.filter((n) => !n.testnet);
    },

    /**
     * 测试网列表
     */
    testnetNetworks(): Network[] {
      return this.networks.filter((n) => n.testnet);
    },

    /**
     * 当前网络是否为测试网
     */
    isTestnet(): boolean {
      const network = this.networks.find((n) => n.chainId === this.currentChainId);
      return network?.testnet || false;
    },

    // ===== 交易 Getters =====

    /**
     * 待确认交易数量
     */
    pendingTransactionCount(): number {
      return this.pendingTransactions.length;
    },

    /**
     * 最近交易（前10条）
     */
    recentTransactions(): Transaction[] {
      return this.transactions.slice(0, 10);
    },

    /**
     * 根据哈希获取交易
     */
    getTransactionByHash(): (txHash: string) => Transaction | undefined {
      return (txHash: string) => {
        return this.transactions.find((tx) => tx.tx_hash === txHash);
      };
    },

    // ===== 合约/资产 Getters =====

    /**
     * 当前链上已部署的合约
     */
    contractsOnCurrentChain(): DeployedContract[] {
      return this.deployedContracts.filter((c) => c.chain_id === this.currentChainId);
    },

    /**
     * 当前链上已部署的资产
     */
    assetsOnCurrentChain(): DeployedAsset[] {
      return this.deployedAssets.filter((a) => a.chain_id === this.currentChainId);
    },

    /**
     * 根据本地资产 ID 获取链上资产信息
     */
    getBlockchainAssetByLocalId(): (localAssetId: string) => DeployedAsset | undefined {
      return (localAssetId: string) => {
        return this.deployedAssets.find((a) => a.local_asset_id === localAssetId);
      };
    },

    /**
     * 根据本地合约 ID 获取链上合约信息
     */
    getBlockchainContractByLocalId(): (localContractId: string) => DeployedContract | undefined {
      return (localContractId: string) => {
        return this.deployedContracts.find((c) => c.local_contract_id === localContractId);
      };
    },

    // ===== 余额 Getters =====

    /**
     * 获取指定地址、链、代币的余额
     */
    getBalance(): (address: string, chainId: number, tokenAddress?: string | null) => string {
      return (address: string, chainId: number, tokenAddress: string | null = null) => {
        const key = `${address}_${chainId}_${tokenAddress || 'native'}`;
        return this.balances[key] || '0';
      };
    },
  },

  actions: {
    // ==================== 钱包管理 Actions ====================

    /**
     * 加载所有钱包
     */
    async loadWallets(): Promise<void> {
      this.walletLoading = true;
      try {
        const wallets = await (window as any).electronAPI.wallet.getAll();
        this.wallets = wallets || [];

        // 如果没有当前钱包且有可用钱包，自动选择第一个
        if (!this.currentWallet && this.wallets.length > 0) {
          this.currentWallet = this.wallets.find((w) => w.is_default) || this.wallets[0];
        }
      } catch (error) {
        logger.error('[BlockchainStore] 加载钱包失败:', error as any);
        throw error;
      } finally {
        this.walletLoading = false;
      }
    },

    /**
     * 创建新钱包
     */
    async createWallet(password: string): Promise<Wallet> {
      this.creatingWallet = true;
      try {
        const wallet = await (window as any).electronAPI.wallet.create(password);
        this.wallets.push(wallet);

        // 如果是第一个钱包，自动设置为当前钱包
        if (this.wallets.length === 1) {
          this.currentWallet = wallet;
        }

        return wallet;
      } catch (error) {
        logger.error('[BlockchainStore] 创建钱包失败:', error as any);
        throw error;
      } finally {
        this.creatingWallet = false;
      }
    },

    /**
     * 从助记词导入钱包
     */
    async importFromMnemonic(mnemonic: string, password: string): Promise<Wallet> {
      this.creatingWallet = true;
      try {
        const wallet = await (window as any).electronAPI.wallet.importMnemonic({
          mnemonic,
          password,
        });
        this.wallets.push(wallet);
        return wallet;
      } catch (error) {
        logger.error('[BlockchainStore] 导入钱包失败:', error as any);
        throw error;
      } finally {
        this.creatingWallet = false;
      }
    },

    /**
     * 从私钥导入钱包
     */
    async importFromPrivateKey(privateKey: string, password: string): Promise<Wallet> {
      this.creatingWallet = true;
      try {
        const wallet = await (window as any).electronAPI.wallet.importPrivateKey({
          privateKey,
          password,
        });
        this.wallets.push(wallet);
        return wallet;
      } catch (error) {
        logger.error('[BlockchainStore] 导入私钥失败:', error as any);
        throw error;
      } finally {
        this.creatingWallet = false;
      }
    },

    /**
     * 连接 MetaMask
     */
    async connectMetaMask(): Promise<ConnectWalletResult> {
      try {
        const result = await (window as any).electronAPI.wallet.connectMetaMask();
        this.externalWalletConnected = true;
        this.externalWalletAddress = result.address;
        this.externalWalletProvider = 'metamask';
        this.currentChainId = result.chainId;
        return result;
      } catch (error) {
        logger.error('[BlockchainStore] 连接 MetaMask 失败:', error as any);
        throw error;
      }
    },

    /**
     * 连接 WalletConnect
     */
    async connectWalletConnect(): Promise<ConnectWalletResult> {
      try {
        const result = await (window as any).electronAPI.wallet.connectWalletConnect();
        this.externalWalletConnected = true;
        this.externalWalletAddress = result.address;
        this.externalWalletProvider = 'walletconnect';
        this.currentChainId = result.chainId;
        return result;
      } catch (error) {
        logger.error('[BlockchainStore] 连接 WalletConnect 失败:', error as any);
        throw error;
      }
    },

    /**
     * 断开外部钱包
     */
    disconnectExternalWallet(): void {
      this.externalWalletConnected = false;
      this.externalWalletAddress = null;
      this.externalWalletProvider = null;
    },

    /**
     * 选择钱包
     */
    selectWallet(wallet: Wallet): void {
      this.currentWallet = wallet;
      this.externalWalletConnected = false;
      this.externalWalletAddress = null;
      this.externalWalletProvider = null;
    },

    /**
     * 删除钱包
     */
    async deleteWallet(walletId: string): Promise<void> {
      try {
        await (window as any).electronAPI.wallet.delete(walletId);

        // 从列表中移除
        const index = this.wallets.findIndex((w) => w.id === walletId);
        if (index !== -1) {
          this.wallets.splice(index, 1);
        }

        // 如果删除的是当前钱包，清空选择
        if (this.currentWallet?.id === walletId) {
          this.currentWallet = this.wallets.length > 0 ? this.wallets[0] : null;
        }
      } catch (error) {
        logger.error('[BlockchainStore] 删除钱包失败:', error as any);
        throw error;
      }
    },

    /**
     * 设置默认钱包
     */
    async setDefaultWallet(walletId: string): Promise<void> {
      try {
        await (window as any).electronAPI.wallet.setDefault(walletId);

        // 更新本地状态
        this.wallets.forEach((w) => {
          w.is_default = w.id === walletId ? 1 : 0;
        });
      } catch (error) {
        logger.error('[BlockchainStore] 设置默认钱包失败:', error as any);
        throw error;
      }
    },

    // ==================== 网络管理 Actions ====================

    /**
     * 切换网络
     */
    async switchChain(chainId: number): Promise<void> {
      this.switchingChain = true;
      try {
        await (window as any).electronAPI.blockchain.switchChain(chainId);
        this.currentChainId = chainId;

        // 切换网络后清空余额缓存
        this.balances = {};
      } catch (error) {
        logger.error('[BlockchainStore] 切换网络失败:', error as any);
        throw error;
      } finally {
        this.switchingChain = false;
      }
    },

    /**
     * 获取余额
     */
    async fetchBalance(
      address: string,
      chainId: number | null = null,
      tokenAddress: string | null = null
    ): Promise<string> {
      const targetChainId = chainId || this.currentChainId;
      const cacheKey = `${address}_${targetChainId}_${tokenAddress || 'native'}`;

      try {
        const balance = await (window as any).electronAPI.wallet.getBalance({
          address,
          chainId: targetChainId,
          tokenAddress,
        } as GetBalanceParams);

        // 缓存余额
        this.balances[cacheKey] = balance;

        return balance;
      } catch (error) {
        logger.error('[BlockchainStore] 获取余额失败:', error as any);
        throw error;
      }
    },

    /**
     * 刷新当前钱包的余额
     */
    async refreshCurrentBalance(): Promise<void> {
      if (!this.currentAddress) {
        return;
      }

      try {
        await this.fetchBalance(this.currentAddress, this.currentChainId);
      } catch (error) {
        logger.warn('[BlockchainStore] 刷新余额失败:', error as any);
      }
    },

    // ==================== 交易管理 Actions ====================

    /**
     * 加载交易历史
     */
    async loadTransactions(filters: TransactionFilters = {}): Promise<void> {
      this.transactionsLoading = true;
      try {
        const transactions = await (window as any).electronAPI.blockchain.getTransactionHistory(
          filters
        );
        this.transactions = transactions || [];

        // 分离待确认交易
        this.pendingTransactions = this.transactions.filter((tx) => tx.status === 'pending');
      } catch (error) {
        logger.error('[BlockchainStore] 加载交易历史失败:', error as any);
        throw error;
      } finally {
        this.transactionsLoading = false;
      }
    },

    /**
     * 获取交易详情
     */
    async getTransaction(txHash: string): Promise<Transaction> {
      try {
        const tx = await (window as any).electronAPI.blockchain.getTransaction(txHash);
        return tx;
      } catch (error) {
        logger.error('[BlockchainStore] 获取交易详情失败:', error as any);
        throw error;
      }
    },

    /**
     * 监控交易状态（用于实时更新）
     */
    async monitorTransaction(txHash: string): Promise<void> {
      try {
        // 添加到待确认列表
        const existingIndex = this.pendingTransactions.findIndex((tx) => tx.tx_hash === txHash);
        if (existingIndex === -1) {
          const tx = await this.getTransaction(txHash);
          if (tx && tx.status === 'pending') {
            this.pendingTransactions.push(tx);
          }
        }

        // 等待确认（这里简化处理，实际应该通过事件监听）
        // 真实实现需要在 main process 中监听事件并通过 IPC 推送到 renderer
      } catch (error) {
        logger.error('[BlockchainStore] 监控交易失败:', error as any);
      }
    },

    /**
     * 移除已确认的交易
     */
    removeConfirmedTransaction(txHash: string): void {
      const index = this.pendingTransactions.findIndex((tx) => tx.tx_hash === txHash);
      if (index !== -1) {
        this.pendingTransactions.splice(index, 1);
      }

      // 刷新交易列表
      this.loadTransactions();
    },

    // ==================== 合约/资产部署 Actions ====================

    /**
     * 加载已部署的合约
     */
    async loadDeployedContracts(chainId: number | null = null): Promise<void> {
      this.contractsLoading = true;
      try {
        const contracts = await (window as any).electronAPI.blockchain.getDeployedContracts(
          chainId
        );
        this.deployedContracts = contracts || [];
      } catch (error) {
        logger.error('[BlockchainStore] 加载已部署合约失败:', error as any);
        throw error;
      } finally {
        this.contractsLoading = false;
      }
    },

    /**
     * 加载已部署的资产
     */
    async loadDeployedAssets(chainId: number | null = null): Promise<void> {
      this.contractsLoading = true;
      try {
        const assets = await (window as any).electronAPI.blockchain.getDeployedAssets(chainId);
        this.deployedAssets = assets || [];
      } catch (error) {
        logger.error('[BlockchainStore] 加载已部署资产失败:', error as any);
        throw error;
      } finally {
        this.contractsLoading = false;
      }
    },

    /**
     * 获取资产的链上信息
     */
    async getAssetBlockchainInfo(assetId: string): Promise<any> {
      try {
        const info = await (window as any).electronAPI.asset.getBlockchainInfo(assetId);
        return info;
      } catch (error) {
        logger.error('[BlockchainStore] 获取资产链上信息失败:', error as any);
        return null;
      }
    },

    /**
     * 获取合约的链上信息
     */
    async getContractBlockchainInfo(contractId: string): Promise<any> {
      try {
        const info = await (window as any).electronAPI.contract.getBlockchainInfo(contractId);
        return info;
      } catch (error) {
        logger.error('[BlockchainStore] 获取合约链上信息失败:', error as any);
        return null;
      }
    },

    // ==================== Gas 管理 Actions ====================

    /**
     * 获取 Gas 价格
     */
    async fetchGasPrice(): Promise<string> {
      this.gasPriceLoading = true;
      try {
        const gasPrice = await (window as any).electronAPI.blockchain.getGasPrice();
        this.gasPrice = gasPrice;
        return gasPrice;
      } catch (error) {
        logger.error('[BlockchainStore] 获取 Gas 价格失败:', error as any);
        throw error;
      } finally {
        this.gasPriceLoading = false;
      }
    },

    /**
     * 估算 Gas
     */
    async estimateGas(transaction: GasEstimateTransaction): Promise<string> {
      try {
        const gasEstimate = await (window as any).electronAPI.blockchain.estimateGas(transaction);
        return gasEstimate;
      } catch (error) {
        logger.error('[BlockchainStore] 估算 Gas 失败:', error as any);
        throw error;
      }
    },

    // ==================== UI 状态 ====================

    /**
     * 显示钱包模态框
     */
    showWalletModal(): void {
      this.ui.showWalletModal = true;
    },

    /**
     * 隐藏钱包模态框
     */
    hideWalletModal(): void {
      this.ui.showWalletModal = false;
    },

    /**
     * 显示网络切换模态框
     */
    showNetworkModal(): void {
      this.ui.showNetworkModal = true;
    },

    /**
     * 隐藏网络切换模态框
     */
    hideNetworkModal(): void {
      this.ui.showNetworkModal = false;
    },

    /**
     * 显示交易详情模态框
     */
    showTransactionModal(transaction: Transaction): void {
      this.ui.currentTransaction = transaction;
      this.ui.showTransactionModal = true;
    },

    /**
     * 隐藏交易详情模态框
     */
    hideTransactionModal(): void {
      this.ui.showTransactionModal = false;
      this.ui.currentTransaction = null;
    },

    /**
     * 初始化
     */
    async initialize(): Promise<void> {
      try {
        // 加载钱包
        await this.loadWallets();

        // 加载交易历史
        await this.loadTransactions();

        // 加载已部署的合约和资产
        await this.loadDeployedContracts();
        await this.loadDeployedAssets();

        // 如果有当前钱包，刷新余额
        if (this.currentAddress) {
          await this.refreshCurrentBalance();
        }

        logger.info('[BlockchainStore] 初始化完成');
      } catch (error) {
        logger.error('[BlockchainStore] 初始化失败:', error as any);
      }
    },
  },
});
