/**
 * 外部钱包连接器
 *
 * 负责连接和管理外部钱包（MetaMask、WalletConnect）
 * 功能：
 * - 连接 MetaMask
 * - 连接 WalletConnect
 * - 切换网络
 * - 监听账户变化
 * - 监听网络变化
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * 外部钱包类型
 */
const ExternalWalletType = {
  METAMASK: 'metamask',
  WALLETCONNECT: 'walletconnect',
};

class ExternalWalletConnector extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;

    // 当前连接的钱包
    this.connectedWallet = null;
    this.currentProvider = null;
    this.currentAccount = null;
    this.currentChainId = null;

    // MetaMask 提供者
    this.metamaskProvider = null;

    // WalletConnect 提供者
    this.walletConnectProvider = null;

    this.initialized = false;
  }

  /**
   * 初始化连接器
   */
  async initialize() {
    console.log('[ExternalWalletConnector] 初始化外部钱包连接器...');

    try {
      this.initialized = true;
      console.log('[ExternalWalletConnector] 外部钱包连接器初始化成功');
    } catch (error) {
      console.error('[ExternalWalletConnector] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 连接 MetaMask
   * @returns {Promise<object>} 连接信息 {address, chainId}
   */
  async connectMetaMask() {
    try {
      // 检测 MetaMask
      const detectProvider = require('@metamask/detect-provider');
      const provider = await detectProvider();

      if (!provider) {
        throw new Error('未检测到 MetaMask，请安装 MetaMask 浏览器扩展');
      }

      if (provider !== window.ethereum) {
        console.warn('[ExternalWalletConnector] 检测到多个钱包，使用 MetaMask');
      }

      this.metamaskProvider = provider;

      // 请求连接账户
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) {
        throw new Error('用户拒绝连接 MetaMask');
      }

      const address = accounts[0];

      // 获取链ID
      const chainId = await provider.request({ method: 'eth_chainId' });
      const chainIdNumber = parseInt(chainId, 16);

      // 保存到数据库
      await this._saveExternalWallet({
        address,
        provider: ExternalWalletType.METAMASK,
        chainId: chainIdNumber,
      });

      // 设置当前连接
      this.currentProvider = provider;
      this.currentAccount = address;
      this.currentChainId = chainIdNumber;
      this.connectedWallet = ExternalWalletType.METAMASK;

      // 监听事件
      this._setupMetaMaskListeners();

      console.log(`[ExternalWalletConnector] MetaMask 连接成功: ${address}`);

      this.emit('wallet:connected', {
        type: ExternalWalletType.METAMASK,
        address,
        chainId: chainIdNumber,
      });

      return { address, chainId: chainIdNumber };
    } catch (error) {
      console.error('[ExternalWalletConnector] MetaMask 连接失败:', error);
      throw error;
    }
  }

  /**
   * 连接 WalletConnect
   * @returns {Promise<object>} 连接信息 {address, chainId}
   */
  async connectWalletConnect() {
    try {
      const WalletConnectProvider = require('@walletconnect/web3-provider').default;

      // 创建 WalletConnect 提供者
      const provider = new WalletConnectProvider({
        rpc: {
          1: 'https://eth-mainnet.g.alchemy.com/v2/your-api-key', // 以太坊主网
          137: 'https://polygon-mainnet.g.alchemy.com/v2/your-api-key', // Polygon
          11155111: 'https://eth-sepolia.g.alchemy.com/v2/your-api-key', // Sepolia
        },
      });

      // 启用会话（打开二维码扫描）
      await provider.enable();

      const accounts = provider.accounts;
      if (!accounts || accounts.length === 0) {
        throw new Error('WalletConnect 连接失败');
      }

      const address = accounts[0];
      const chainId = provider.chainId;

      // 保存到数据库
      await this._saveExternalWallet({
        address,
        provider: ExternalWalletType.WALLETCONNECT,
        chainId,
      });

      // 设置当前连接
      this.walletConnectProvider = provider;
      this.currentProvider = provider;
      this.currentAccount = address;
      this.currentChainId = chainId;
      this.connectedWallet = ExternalWalletType.WALLETCONNECT;

      // 监听事件
      this._setupWalletConnectListeners();

      console.log(`[ExternalWalletConnector] WalletConnect 连接成功: ${address}`);

      this.emit('wallet:connected', {
        type: ExternalWalletType.WALLETCONNECT,
        address,
        chainId,
      });

      return { address, chainId };
    } catch (error) {
      console.error('[ExternalWalletConnector] WalletConnect 连接失败:', error);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect() {
    try {
      if (this.connectedWallet === ExternalWalletType.WALLETCONNECT && this.walletConnectProvider) {
        await this.walletConnectProvider.disconnect();
      }

      // 清空状态
      this.currentProvider = null;
      this.currentAccount = null;
      this.currentChainId = null;
      this.connectedWallet = null;

      this.emit('wallet:disconnected');

      console.log('[ExternalWalletConnector] 断开连接');
    } catch (error) {
      console.error('[ExternalWalletConnector] 断开连接失败:', error);
      throw error;
    }
  }

  /**
   * 切换网络
   * @param {number} chainId - 目标链ID
   */
  async switchChain(chainId) {
    if (!this.currentProvider) {
      throw new Error('未连接外部钱包');
    }

    try {
      const chainIdHex = '0x' + chainId.toString(16);

      if (this.connectedWallet === ExternalWalletType.METAMASK) {
        await this.currentProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });
      } else if (this.connectedWallet === ExternalWalletType.WALLETCONNECT) {
        // WalletConnect 切换链
        await this.walletConnectProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });
      }

      this.currentChainId = chainId;

      this.emit('chain:switched', { chainId });

      console.log(`[ExternalWalletConnector] 切换到链: ${chainId}`);
    } catch (error) {
      // 如果链未添加，尝试添加
      if (error.code === 4902) {
        console.log('[ExternalWalletConnector] 链未添加，尝试添加...');
        await this.addChain(chainId);
        // 添加成功后再次尝试切换
        await this.switchChain(chainId);
      } else {
        console.error('[ExternalWalletConnector] 切换网络失败:', error);
        throw error;
      }
    }
  }

  /**
   * 添加网络
   * @param {number} chainId - 链ID
   */
  async addChain(chainId) {
    const { getNetworkConfig } = require('./blockchain-config');

    try {
      const config = getNetworkConfig(chainId);

      const params = {
        chainId: '0x' + chainId.toString(16),
        chainName: config.name,
        nativeCurrency: config.nativeCurrency,
        rpcUrls: config.rpcUrls,
        blockExplorerUrls: config.blockExplorerUrls,
      };

      await this.currentProvider.request({
        method: 'wallet_addEthereumChain',
        params: [params],
      });

      console.log(`[ExternalWalletConnector] 添加链成功: ${config.name}`);
    } catch (error) {
      console.error('[ExternalWalletConnector] 添加网络失败:', error);
      throw error;
    }
  }

  /**
   * 请求签名
   * @param {string} message - 消息
   * @returns {Promise<string>} 签名
   */
  async signMessage(message) {
    if (!this.currentProvider || !this.currentAccount) {
      throw new Error('未连接外部钱包');
    }

    try {
      const signature = await this.currentProvider.request({
        method: 'personal_sign',
        params: [message, this.currentAccount],
      });

      return signature;
    } catch (error) {
      console.error('[ExternalWalletConnector] 签名失败:', error);
      throw error;
    }
  }

  /**
   * 发送交易
   * @param {object} transaction - 交易参数
   * @returns {Promise<string>} 交易哈希
   */
  async sendTransaction(transaction) {
    if (!this.currentProvider || !this.currentAccount) {
      throw new Error('未连接外部钱包');
    }

    try {
      const txHash = await this.currentProvider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: this.currentAccount,
            ...transaction,
          },
        ],
      });

      return txHash;
    } catch (error) {
      console.error('[ExternalWalletConnector] 发送交易失败:', error);
      throw error;
    }
  }

  /**
   * 设置 MetaMask 监听器
   * @private
   */
  _setupMetaMaskListeners() {
    if (!this.metamaskProvider) {return;}

    // 监听账户变化
    this.metamaskProvider.on('accountsChanged', (accounts) => {
      console.log('[ExternalWalletConnector] MetaMask 账户变化:', accounts);

      if (accounts.length === 0) {
        // 用户断开连接
        this.disconnect();
      } else {
        this.currentAccount = accounts[0];
        this.emit('accounts:changed', { accounts });
      }
    });

    // 监听链变化
    this.metamaskProvider.on('chainChanged', (chainId) => {
      console.log('[ExternalWalletConnector] MetaMask 链变化:', chainId);

      this.currentChainId = parseInt(chainId, 16);
      this.emit('chain:changed', { chainId: this.currentChainId });

      // 刷新页面（MetaMask 推荐）
      // window.location.reload();
    });

    // 监听连接
    this.metamaskProvider.on('connect', (connectInfo) => {
      console.log('[ExternalWalletConnector] MetaMask 已连接:', connectInfo);
      this.emit('provider:connected', connectInfo);
    });

    // 监听断开
    this.metamaskProvider.on('disconnect', (error) => {
      console.log('[ExternalWalletConnector] MetaMask 断开连接:', error);
      this.disconnect();
    });
  }

  /**
   * 设置 WalletConnect 监听器
   * @private
   */
  _setupWalletConnectListeners() {
    if (!this.walletConnectProvider) {return;}

    // 监听账户变化
    this.walletConnectProvider.on('accountsChanged', (accounts) => {
      console.log('[ExternalWalletConnector] WalletConnect 账户变化:', accounts);

      if (accounts.length === 0) {
        this.disconnect();
      } else {
        this.currentAccount = accounts[0];
        this.emit('accounts:changed', { accounts });
      }
    });

    // 监听链变化
    this.walletConnectProvider.on('chainChanged', (chainId) => {
      console.log('[ExternalWalletConnector] WalletConnect 链变化:', chainId);

      this.currentChainId = chainId;
      this.emit('chain:changed', { chainId });
    });

    // 监听断开
    this.walletConnectProvider.on('disconnect', (code, reason) => {
      console.log('[ExternalWalletConnector] WalletConnect 断开:', code, reason);
      this.disconnect();
    });
  }

  /**
   * 保存外部钱包到数据库
   * @private
   */
  async _saveExternalWallet({ address, provider, chainId }) {
    const db = this.database.db;

    // 检查是否已存在
    const existing = db.prepare('SELECT * FROM blockchain_wallets WHERE LOWER(address) = LOWER(?)').get(address);

    if (existing) {
      // 更新
      db.prepare(`
        UPDATE blockchain_wallets
        SET provider = ?, chain_id = ?
        WHERE LOWER(address) = LOWER(?)
      `).run(provider, chainId, address);
    } else {
      // 插入
      const walletId = uuidv4();
      const createdAt = Date.now();

      db.prepare(`
        INSERT INTO blockchain_wallets (
          id, address, wallet_type, provider, chain_id, is_default, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        walletId,
        address,
        'external',
        provider,
        chainId,
        0, // 外部钱包不设为默认
        createdAt
      );
    }
  }

  /**
   * 获取当前连接状态
   */
  getConnectionStatus() {
    return {
      connected: !!this.connectedWallet,
      type: this.connectedWallet,
      account: this.currentAccount,
      chainId: this.currentChainId,
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    console.log('[ExternalWalletConnector] 清理资源...');

    await this.disconnect();

    this.initialized = false;
  }
}

module.exports = {
  ExternalWalletConnector,
  ExternalWalletType,
};
