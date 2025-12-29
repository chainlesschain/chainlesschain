/**
 * 区块链适配器
 *
 * 核心适配器，提供统一的API接口支持多链（以太坊 + Polygon）
 * 负责：
 * - 多链管理和切换
 * - 合约部署（ERC-20, ERC-721, ERC-1155）
 * - 代币转账
 * - 事件监听
 */

const EventEmitter = require('events');
const { ethers } = require('ethers');
const { getNetworkConfig, getRpcUrl } = require('./blockchain-config');
const {
  getChainlessTokenArtifact,
  getChainlessNFTArtifact,
  getERC20ABI,
  getERC721ABI,
} = require('./contract-artifacts');

class BlockchainAdapter extends EventEmitter {
  constructor(database, walletManager) {
    super();

    this.database = database;
    this.walletManager = walletManager;

    // 网络提供者映射 (chainId => Provider)
    this.providers = new Map();

    // 当前链ID（默认以太坊主网）
    this.currentChainId = 1;

    this.initialized = false;
  }

  /**
   * 初始化适配器
   */
  async initialize() {
    console.log('[BlockchainAdapter] 初始化区块链适配器...');

    try {
      // 初始化各链的提供者
      const supportedChains = [1, 11155111, 137, 80001, 31337]; // 以太坊主网、Sepolia、Polygon、Mumbai、Hardhat本地

      for (const chainId of supportedChains) {
        try {
          const rpcUrl = getRpcUrl(chainId);
          if (rpcUrl) {
            const provider = new ethers.JsonRpcProvider(rpcUrl);

            // 验证连接
            await provider.getNetwork();

            this.providers.set(chainId, provider);
            console.log(`[BlockchainAdapter] 链 ${chainId} 提供者初始化成功`);
          }
        } catch (error) {
          console.warn(`[BlockchainAdapter] 链 ${chainId} 初始化失败:`, error.message);
          // 继续初始化其他链
        }
      }

      if (this.providers.size === 0) {
        throw new Error('没有可用的网络提供者');
      }

      // 设置默认链为第一个可用的提供者
      const firstChainId = Array.from(this.providers.keys())[0];
      this.currentChainId = firstChainId;

      this.initialized = true;
      console.log(`[BlockchainAdapter] 区块链适配器初始化成功，共 ${this.providers.size} 个网络可用，当前链: ${this.currentChainId}`);
    } catch (error) {
      console.error('[BlockchainAdapter] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 切换网络
   * @param {number} chainId - 目标链ID
   */
  async switchChain(chainId) {
    if (!this.providers.has(chainId)) {
      throw new Error(`不支持的链 ID: ${chainId}`);
    }

    const oldChainId = this.currentChainId;
    this.currentChainId = chainId;

    console.log(`[BlockchainAdapter] 切换网络: ${oldChainId} -> ${chainId}`);
    this.emit('chain:switched', { from: oldChainId, to: chainId });
  }

  /**
   * 获取当前提供者
   * @returns {ethers.JsonRpcProvider} 当前链的提供者
   */
  getProvider() {
    const provider = this.providers.get(this.currentChainId);
    if (!provider) {
      throw new Error(`Provider not initialized for chain ${this.currentChainId}`);
    }
    return provider;
  }

  /**
   * 部署 ERC-20 代币
   * @param {string} walletId - 钱包ID
   * @param {object} options - 代币参数 {name, symbol, decimals, initialSupply}
   * @returns {Promise<{address: string, txHash: string}>}
   */
  async deployERC20Token(walletId, options) {
    console.log('[BlockchainAdapter] 部署 ERC-20 代币:', options);

    const { name, symbol, decimals, initialSupply } = options;

    // 验证参数
    if (!name || !symbol || !decimals || !initialSupply) {
      throw new Error('缺少必要参数: name, symbol, decimals, initialSupply');
    }

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, options.password);
    const provider = this.getProvider();
    // 如果钱包已经连接到 provider，直接使用；否则连接
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载合约 artifact
    const { abi, bytecode } = getChainlessTokenArtifact();

    // 创建合约工厂
    const factory = new ethers.ContractFactory(abi, bytecode, signer);

    // 转换 initialSupply 为 BigInt
    const supply = ethers.parseUnits(initialSupply.toString(), decimals);

    // 部署合约
    console.log('[BlockchainAdapter] 开始部署合约...');
    const contract = await factory.deploy(name, symbol, decimals, supply);

    // 等待部署完成
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    const txHash = contract.deploymentTransaction().hash;

    console.log(`[BlockchainAdapter] ERC-20 代币部署成功: ${address}`);

    return {
      address,
      txHash,
    };
  }

  /**
   * 部署 ERC-721 NFT
   * @param {string} walletId - 钱包ID
   * @param {object} options - NFT参数 {name, symbol, password}
   * @returns {Promise<{address: string, txHash: string}>}
   */
  async deployNFT(walletId, options) {
    console.log('[BlockchainAdapter] 部署 ERC-721 NFT:', options);

    const { name, symbol } = options;

    // 验证参数
    if (!name || !symbol) {
      throw new Error('缺少必要参数: name, symbol');
    }

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, options.password);
    const provider = this.getProvider();
    // 如果钱包已经连接到 provider，直接使用；否则连接
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载合约 artifact
    const { abi, bytecode } = getChainlessNFTArtifact();

    // 创建合约工厂
    const factory = new ethers.ContractFactory(abi, bytecode, signer);

    // 部署合约
    console.log('[BlockchainAdapter] 开始部署 NFT 合约...');
    const contract = await factory.deploy(name, symbol);

    // 等待部署完成
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    const txHash = contract.deploymentTransaction().hash;

    console.log(`[BlockchainAdapter] ERC-721 NFT 部署成功: ${address}`);

    return {
      address,
      txHash,
    };
  }

  /**
   * 铸造 NFT
   * @param {string} walletId - 钱包ID
   * @param {string} contractAddress - NFT合约地址
   * @param {string} to - 接收地址
   * @param {string} metadataURI - 元数据 URI
   * @param {string} password - 钱包密码
   * @returns {Promise<{tokenId: number, txHash: string}>}
   */
  async mintNFT(walletId, contractAddress, to, metadataURI, password) {
    console.log(`[BlockchainAdapter] 铸造 NFT: ${contractAddress} -> ${to}`);

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载 NFT 合约
    const { abi } = getChainlessNFTArtifact();
    const contract = new ethers.Contract(contractAddress, abi, signer);

    // 调用 mint 方法
    console.log('[BlockchainAdapter] 调用 mint 方法...');
    const tx = await contract.mint(to, metadataURI);

    // 等待交易确认
    const receipt = await tx.wait();

    // 从日志中提取 tokenId
    // Transfer 事件: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
    const transferEvent = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed && parsed.name === 'Transfer';
      } catch {
        return false;
      }
    });

    let tokenId = null;
    if (transferEvent) {
      const parsed = contract.interface.parseLog(transferEvent);
      tokenId = Number(parsed.args.tokenId);
    }

    console.log(`[BlockchainAdapter] NFT 铸造成功，Token ID: ${tokenId}`);

    return {
      tokenId,
      txHash: receipt.hash,
    };
  }

  /**
   * 转账代币
   * @param {string} walletId - 钱包ID
   * @param {string} tokenAddress - 代币合约地址
   * @param {string} to - 接收地址
   * @param {string} amount - 数量（字符串，支持大数）
   * @param {string} password - 钱包密码
   * @returns {Promise<string>} 交易哈希
   */
  async transferToken(walletId, tokenAddress, to, amount, password) {
    console.log(`[BlockchainAdapter] 转账代币: ${amount} -> ${to}`);

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载 ERC-20 合约
    const abi = getERC20ABI();
    const contract = new ethers.Contract(tokenAddress, abi, signer);

    // 获取代币小数位
    const decimals = await contract.decimals();

    // 转换金额
    const transferAmount = ethers.parseUnits(amount.toString(), decimals);

    // 执行转账
    console.log('[BlockchainAdapter] 执行代币转账...');
    const tx = await contract.transfer(to, transferAmount);

    // 等待交易确认
    const receipt = await tx.wait();

    console.log(`[BlockchainAdapter] 代币转账成功: ${receipt.hash}`);

    return receipt.hash;
  }

  /**
   * 获取代币余额
   * @param {string} tokenAddress - 代币合约地址
   * @param {string} ownerAddress - 拥有者地址
   * @returns {Promise<string>} 余额（字符串）
   */
  async getTokenBalance(tokenAddress, ownerAddress) {
    console.log(`[BlockchainAdapter] 查询代币余额: ${tokenAddress} - ${ownerAddress}`);

    const provider = this.getProvider();

    // 加载 ERC-20 合约
    const abi = getERC20ABI();
    const contract = new ethers.Contract(tokenAddress, abi, provider);

    // 获取余额和小数位
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(ownerAddress),
      contract.decimals(),
    ]);

    // 格式化余额
    const formattedBalance = ethers.formatUnits(balance, decimals);

    console.log(`[BlockchainAdapter] 余额: ${formattedBalance}`);

    return formattedBalance;
  }

  /**
   * 监听合约事件
   * @param {string} contractAddress - 合约地址
   * @param {Array} abi - 合约 ABI
   * @param {string} eventName - 事件名称
   * @param {function} callback - 回调函数
   */
  async listenToEvents(contractAddress, abi, eventName, callback) {
    console.log(`[BlockchainAdapter] 开始监听事件: ${contractAddress} - ${eventName}`);

    const provider = this.getProvider();
    const contract = new ethers.Contract(contractAddress, abi, provider);

    // 监听事件
    contract.on(eventName, (...args) => {
      // 最后一个参数是事件对象
      const event = args[args.length - 1];
      const eventArgs = args.slice(0, -1);

      console.log(`[BlockchainAdapter] 收到事件 ${eventName}:`, {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        args: eventArgs,
      });

      callback({
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        args: eventArgs,
        event,
      });
    });

    console.log(`[BlockchainAdapter] 事件监听已设置: ${eventName}`);
  }

  /**
   * 停止监听事件
   * @param {string} contractAddress - 合约地址
   * @param {Array} abi - 合约 ABI
   * @param {string} eventName - 事件名称
   */
  async stopListening(contractAddress, abi, eventName) {
    console.log(`[BlockchainAdapter] 停止监听事件: ${contractAddress} - ${eventName}`);

    const provider = this.getProvider();
    const contract = new ethers.Contract(contractAddress, abi, provider);

    // 移除所有该事件的监听器
    contract.removeAllListeners(eventName);

    console.log(`[BlockchainAdapter] 事件监听已移除: ${eventName}`);
  }

  /**
   * 估算 Gas
   * @param {object} transaction - 交易对象
   * @returns {Promise<bigint>} 估算的 Gas
   */
  async estimateGas(transaction) {
    const provider = this.getProvider();
    return await provider.estimateGas(transaction);
  }

  /**
   * 获取 Gas 价格
   * @returns {Promise<object>} Gas 价格信息
   */
  async getGasPrice() {
    const provider = this.getProvider();
    const feeData = await provider.getFeeData();
    return {
      gasPrice: feeData.gasPrice,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    console.log('[BlockchainAdapter] 清理资源...');

    // 停止所有提供者
    for (const [chainId, provider] of this.providers.entries()) {
      try {
        await provider.destroy();
      } catch (error) {
        console.error(`[BlockchainAdapter] 清理链 ${chainId} 失败:`, error);
      }
    }

    this.providers.clear();
    this.initialized = false;
  }
}

module.exports = BlockchainAdapter;
