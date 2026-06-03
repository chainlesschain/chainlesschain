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

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { ethers } = require("ethers");
const { getNetworkConfig, getRpcUrl } = require("./blockchain-config");
const {
  getChainlessTokenArtifact,
  getChainlessNFTArtifact,
  getEscrowContractArtifact,
  getSubscriptionContractArtifact,
  getBountyContractArtifact,
  getERC20ABI,
  getERC721ABI,
} = require("./contract-artifacts");

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
    logger.info("[BlockchainAdapter] 初始化区块链适配器...");

    try {
      // 初始化各链的提供者
      const supportedChains = [
        1,
        11155111, // Ethereum Mainnet, Sepolia
        137,
        80001, // Polygon Mainnet, Mumbai
        56,
        97, // BSC Mainnet, Testnet
        42161,
        421614, // Arbitrum One, Sepolia
        10,
        11155420, // Optimism Mainnet, Sepolia
        43114,
        43113, // Avalanche C-Chain, Fuji
        8453,
        84532, // Base Mainnet, Sepolia
        31337, // Hardhat Local
      ];

      for (const chainId of supportedChains) {
        try {
          const config = getNetworkConfig(chainId);
          let provider = null;

          // 尝试所有RPC URL直到找到一个可用的
          for (const rpcUrl of config.rpcUrls) {
            // 跳过包含占位符API key的URL
            if (rpcUrl.includes("your-api-key")) {
              continue;
            }

            try {
              provider = new ethers.JsonRpcProvider(rpcUrl);

              // 验证连接（添加超时）
              await Promise.race([
                provider.getNetwork(),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("连接超时")), 5000),
                ),
              ]);

              // 连接成功
              this.providers.set(chainId, provider);
              logger.info(
                `[BlockchainAdapter] 链 ${chainId} (${config.name}) 提供者初始化成功 (${rpcUrl})`,
              );
              break;
            } catch (rpcError) {
              logger.warn(
                `[BlockchainAdapter] RPC URL ${rpcUrl} 失败:`,
                rpcError.message,
              );
              // 尝试下一个RPC URL
              continue;
            }
          }

          if (!this.providers.has(chainId)) {
            logger.warn(
              `[BlockchainAdapter] 链 ${chainId} (${config.name}) 所有RPC URL均不可用`,
            );
          }
        } catch (error) {
          logger.warn(
            `[BlockchainAdapter] 链 ${chainId} 初始化失败:`,
            error.message,
          );
          // 继续初始化其他链
        }
      }

      if (this.providers.size === 0) {
        logger.warn(
          "[BlockchainAdapter] 没有可用的网络提供者，将使用公共RPC端点",
        );
        // 至少初始化一个测试网络作为备用
        try {
          const sepoliaConfig = getNetworkConfig(11155111);
          const sepoliaProvider = new ethers.JsonRpcProvider(
            sepoliaConfig.rpcUrls[1],
          ); // 使用公共端点
          this.providers.set(11155111, sepoliaProvider);
          logger.info("[BlockchainAdapter] 已初始化Sepolia测试网作为备用");
        } catch (fallbackError) {
          logger.error(
            "[BlockchainAdapter] 初始化备用网络失败:",
            fallbackError,
          );
        }
      }

      // 设置默认链（优先使用已初始化的链）
      if (this.providers.has(this.currentChainId)) {
        logger.info(`[BlockchainAdapter] 使用默认链: ${this.currentChainId}`);
      } else {
        // 使用第一个可用的链
        this.currentChainId = Array.from(this.providers.keys())[0];
        logger.info(`[BlockchainAdapter] 切换到可用链: ${this.currentChainId}`);
      }

      this.initialized = true;
      logger.info(
        `[BlockchainAdapter] 区块链适配器初始化成功，共 ${this.providers.size} 个网络可用，当前链: ${this.currentChainId}`,
      );
    } catch (error) {
      logger.error("[BlockchainAdapter] 初始化失败:", error);
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

    logger.info(`[BlockchainAdapter] 切换网络: ${oldChainId} -> ${chainId}`);
    this.emit("chain:switched", { from: oldChainId, to: chainId });
  }

  /**
   * 获取当前提供者
   * @returns {ethers.JsonRpcProvider} 当前链的提供者
   */
  getProvider() {
    const provider = this.providers.get(this.currentChainId);
    if (!provider) {
      throw new Error(
        `Provider not initialized for chain ${this.currentChainId}`,
      );
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
    logger.info("[BlockchainAdapter] 部署 ERC-20 代币:", options);

    const { name, symbol, decimals, initialSupply } = options;

    // 验证参数
    if (!name || !symbol || !decimals || !initialSupply) {
      throw new Error("缺少必要参数: name, symbol, decimals, initialSupply");
    }

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(
      walletId,
      options.password,
    );
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
    logger.info("[BlockchainAdapter] 开始部署合约...");
    const contract = await factory.deploy(name, symbol, decimals, supply);

    // 等待部署完成
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    const txHash = contract.deploymentTransaction().hash;

    logger.info(`[BlockchainAdapter] ERC-20 代币部署成功: ${address}`);

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
    logger.info("[BlockchainAdapter] 部署 ERC-721 NFT:", options);

    const { name, symbol } = options;

    // 验证参数
    if (!name || !symbol) {
      throw new Error("缺少必要参数: name, symbol");
    }

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(
      walletId,
      options.password,
    );
    const provider = this.getProvider();
    // 如果钱包已经连接到 provider，直接使用；否则连接
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载合约 artifact
    const { abi, bytecode } = getChainlessNFTArtifact();

    // 创建合约工厂
    const factory = new ethers.ContractFactory(abi, bytecode, signer);

    // 部署合约
    logger.info("[BlockchainAdapter] 开始部署 NFT 合约...");
    const contract = await factory.deploy(name, symbol);

    // 等待部署完成
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    const txHash = contract.deploymentTransaction().hash;

    logger.info(`[BlockchainAdapter] ERC-721 NFT 部署成功: ${address}`);

    return {
      address,
      txHash,
    };
  }

  /**
   * 部署托管合约 (EscrowContract)
   * @param {string} walletId - 钱包ID
   * @param {string} password - 钱包密码
   * @returns {Promise<{address: string, txHash: string, abi: Array}>}
   */
  async deployEscrowContract(walletId, password) {
    logger.info("[BlockchainAdapter] 部署托管合约 (EscrowContract)");

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载合约 artifact
    const { abi, bytecode } = getEscrowContractArtifact();

    // 创建合约工厂
    const factory = new ethers.ContractFactory(abi, bytecode, signer);

    // 部署合约
    logger.info("[BlockchainAdapter] 开始部署托管合约...");
    const contract = await factory.deploy();

    // 等待部署完成
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    const txHash = contract.deploymentTransaction().hash;

    logger.info(`[BlockchainAdapter] 托管合约部署成功: ${address}`);

    return {
      address,
      txHash,
      abi,
    };
  }

  /**
   * 部署订阅合约 (SubscriptionContract)
   * @param {string} walletId - 钱包ID
   * @param {string} password - 钱包密码
   * @returns {Promise<{address: string, txHash: string, abi: Array}>}
   */
  async deploySubscriptionContract(walletId, password) {
    logger.info("[BlockchainAdapter] 部署订阅合约 (SubscriptionContract)");

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载合约 artifact
    const { abi, bytecode } = getSubscriptionContractArtifact();

    // 创建合约工厂
    const factory = new ethers.ContractFactory(abi, bytecode, signer);

    // 部署合约
    logger.info("[BlockchainAdapter] 开始部署订阅合约...");
    const contract = await factory.deploy();

    // 等待部署完成
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    const txHash = contract.deploymentTransaction().hash;

    logger.info(`[BlockchainAdapter] 订阅合约部署成功: ${address}`);

    return {
      address,
      txHash,
      abi,
    };
  }

  /**
   * 部署悬赏合约 (BountyContract)
   * @param {string} walletId - 钱包ID
   * @param {string} password - 钱包密码
   * @returns {Promise<{address: string, txHash: string, abi: Array}>}
   */
  async deployBountyContract(walletId, password) {
    logger.info("[BlockchainAdapter] 部署悬赏合约 (BountyContract)");

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载合约 artifact
    const { abi, bytecode } = getBountyContractArtifact();

    // 创建合约工厂
    const factory = new ethers.ContractFactory(abi, bytecode, signer);

    // 部署合约
    logger.info("[BlockchainAdapter] 开始部署悬赏合约...");
    const contract = await factory.deploy();

    // 等待部署完成
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    const txHash = contract.deploymentTransaction().hash;

    logger.info(`[BlockchainAdapter] 悬赏合约部署成功: ${address}`);

    return {
      address,
      txHash,
      abi,
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
    logger.info(`[BlockchainAdapter] 铸造 NFT: ${contractAddress} -> ${to}`);

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 加载 NFT 合约
    const { abi } = getChainlessNFTArtifact();
    const contract = new ethers.Contract(contractAddress, abi, signer);

    // 调用 mint 方法
    logger.info("[BlockchainAdapter] 调用 mint 方法...");
    const tx = await contract.mint(to, metadataURI);

    // 等待交易确认
    const receipt = await tx.wait();

    // 从日志中提取 tokenId
    // Transfer 事件: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
    const transferEvent = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed && parsed.name === "Transfer";
      } catch {
        return false;
      }
    });

    let tokenId = null;
    if (transferEvent) {
      const parsed = contract.interface.parseLog(transferEvent);
      tokenId = Number(parsed.args.tokenId);
    }

    logger.info(`[BlockchainAdapter] NFT 铸造成功，Token ID: ${tokenId}`);

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
    logger.info(`[BlockchainAdapter] 转账代币: ${amount} -> ${to}`);

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
    logger.info("[BlockchainAdapter] 执行代币转账...");
    const tx = await contract.transfer(to, transferAmount);

    // 等待交易确认
    const receipt = await tx.wait();

    logger.info(`[BlockchainAdapter] 代币转账成功: ${receipt.hash}`);

    return receipt.hash;
  }

  /**
   * 转账 NFT (ERC-721)
   * @param {string} walletId - 钱包ID
   * @param {string} nftAddress - NFT合约地址
   * @param {string} from - 发送者地址
   * @param {string} to - 接收地址
   * @param {string} tokenId - NFT Token ID
   * @param {string} password - 钱包密码
   * @returns {Promise<string>} 交易哈希
   */
  async transferNFT(walletId, nftAddress, from, to, tokenId, password) {
    logger.info(
      `[BlockchainAdapter] 转账 NFT: Token ID ${tokenId} from ${from} -> ${to}`,
    );

    // 获取钱包
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 验证发送者地址与钱包地址匹配
    const walletAddress = await signer.getAddress();
    if (walletAddress.toLowerCase() !== from.toLowerCase()) {
      throw new Error(`钱包地址 ${walletAddress} 与发送者地址 ${from} 不匹配`);
    }

    // 加载 ERC-721 合约
    const abi = getERC721ABI();
    const contract = new ethers.Contract(nftAddress, abi, signer);

    // 验证所有权
    try {
      const owner = await contract.ownerOf(tokenId);
      if (owner.toLowerCase() !== from.toLowerCase()) {
        throw new Error(
          `Token ID ${tokenId} 不属于地址 ${from}，当前所有者: ${owner}`,
        );
      }
    } catch (error) {
      if (error.message.includes("不属于地址")) {
        throw error;
      }
      throw new Error(`无法验证 NFT 所有权: ${error.message}`);
    }

    // 执行转账 (使用 safeTransferFrom)
    logger.info("[BlockchainAdapter] 执行 NFT 转账...");
    const tx = await contract["safeTransferFrom(address,address,uint256)"](
      from,
      to,
      tokenId,
    );

    // 等待交易确认
    const receipt = await tx.wait();

    logger.info(`[BlockchainAdapter] NFT 转账成功: ${receipt.hash}`);

    // 验证转账结果
    try {
      const newOwner = await contract.ownerOf(tokenId);
      if (newOwner.toLowerCase() !== to.toLowerCase()) {
        logger.warn(
          `[BlockchainAdapter] 警告: NFT 转账后所有者验证失败，预期: ${to}, 实际: ${newOwner}`,
        );
      } else {
        logger.info(`[BlockchainAdapter] NFT 所有权已成功转移至: ${newOwner}`);
      }
    } catch (error) {
      logger.warn(
        `[BlockchainAdapter] 无法验证转账后的所有权: ${error.message}`,
      );
    }

    return receipt.hash;
  }

  /**
   * 批量转账 NFT (ERC-721)
   * @param {string} walletId - 钱包ID
   * @param {string} nftAddress - NFT合约地址
   * @param {string} from - 发送者地址
   * @param {Array<{to: string, tokenId: string}>} transfers - 转账列表
   * @param {string} password - 钱包密码
   * @returns {Promise<Array<{success: boolean, txHash?: string, tokenId: string, to: string, error?: string}>>}
   */
  async batchTransferNFT(walletId, nftAddress, from, transfers, password) {
    logger.info(
      `[BlockchainAdapter] 批量转账 NFT: ${transfers.length} 个 Token`,
    );

    const results = [];
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    // 验证发送者地址
    const walletAddress = await signer.getAddress();
    if (walletAddress.toLowerCase() !== from.toLowerCase()) {
      throw new Error(`钱包地址 ${walletAddress} 与发送者地址 ${from} 不匹配`);
    }

    const abi = getERC721ABI();
    const contract = new ethers.Contract(nftAddress, abi, signer);

    for (const transfer of transfers) {
      try {
        // 验证所有权
        const owner = await contract.ownerOf(transfer.tokenId);
        if (owner.toLowerCase() !== from.toLowerCase()) {
          throw new Error(`Token ID ${transfer.tokenId} 不属于地址 ${from}`);
        }

        // 执行转账
        const tx = await contract["safeTransferFrom(address,address,uint256)"](
          from,
          transfer.to,
          transfer.tokenId,
        );
        const receipt = await tx.wait();

        results.push({
          success: true,
          txHash: receipt.hash,
          tokenId: transfer.tokenId,
          to: transfer.to,
        });

        logger.info(
          `[BlockchainAdapter] NFT 转账成功: Token ID ${transfer.tokenId} -> ${transfer.to}`,
        );
      } catch (error) {
        logger.error(
          `[BlockchainAdapter] NFT 转账失败: Token ID ${transfer.tokenId}`,
          error,
        );
        results.push({
          success: false,
          error: error.message,
          tokenId: transfer.tokenId,
          to: transfer.to,
        });
      }
    }

    return results;
  }

  /**
   * 获取 NFT 所有者
   * @param {string} nftAddress - NFT合约地址
   * @param {string} tokenId - Token ID
   * @returns {Promise<string>} 所有者地址
   */
  async getNFTOwner(nftAddress, tokenId) {
    logger.info(
      `[BlockchainAdapter] 查询 NFT 所有者: ${nftAddress} - Token ID ${tokenId}`,
    );

    const provider = this.getProvider();
    const abi = getERC721ABI();
    const contract = new ethers.Contract(nftAddress, abi, provider);

    try {
      const owner = await contract.ownerOf(tokenId);
      logger.info(`[BlockchainAdapter] NFT 所有者: ${owner}`);
      return owner;
    } catch (error) {
      logger.error(`[BlockchainAdapter] 查询 NFT 所有者失败:`, error);
      throw new Error(`无法查询 NFT 所有者: ${error.message}`);
    }
  }

  /**
   * 获取地址拥有的 NFT 数量
   * @param {string} nftAddress - NFT合约地址
   * @param {string} ownerAddress - 所有者地址
   * @returns {Promise<number>} NFT 数量
   */
  async getNFTBalance(nftAddress, ownerAddress) {
    logger.info(
      `[BlockchainAdapter] 查询 NFT 余额: ${nftAddress} - ${ownerAddress}`,
    );

    const provider = this.getProvider();
    const abi = getERC721ABI();
    const contract = new ethers.Contract(nftAddress, abi, provider);

    try {
      const balance = await contract.balanceOf(ownerAddress);
      const balanceNumber = Number(balance);
      logger.info(`[BlockchainAdapter] NFT 余额: ${balanceNumber}`);
      return balanceNumber;
    } catch (error) {
      logger.error(`[BlockchainAdapter] 查询 NFT 余额失败:`, error);
      throw new Error(`无法查询 NFT 余额: ${error.message}`);
    }
  }

  /**
   * 获取 NFT 元数据 URI
   * @param {string} nftAddress - NFT合约地址
   * @param {string} tokenId - Token ID
   * @returns {Promise<string>} 元数据 URI
   */
  async getNFTTokenURI(nftAddress, tokenId) {
    logger.info(
      `[BlockchainAdapter] 查询 NFT 元数据 URI: ${nftAddress} - Token ID ${tokenId}`,
    );

    const provider = this.getProvider();
    const abi = getERC721ABI();
    const contract = new ethers.Contract(nftAddress, abi, provider);

    try {
      const tokenURI = await contract.tokenURI(tokenId);
      logger.info(`[BlockchainAdapter] NFT 元数据 URI: ${tokenURI}`);
      return tokenURI;
    } catch (error) {
      logger.error(`[BlockchainAdapter] 查询 NFT 元数据 URI 失败:`, error);
      throw new Error(`无法查询 NFT 元数据 URI: ${error.message}`);
    }
  }

  /**
   * 获取代币余额
   * @param {string} tokenAddress - 代币合约地址
   * @param {string} ownerAddress - 拥有者地址
   * @returns {Promise<string>} 余额（字符串）
   */
  async getTokenBalance(tokenAddress, ownerAddress) {
    logger.info(
      `[BlockchainAdapter] 查询代币余额: ${tokenAddress} - ${ownerAddress}`,
    );

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

    logger.info(`[BlockchainAdapter] 余额: ${formattedBalance}`);

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
    logger.info(
      `[BlockchainAdapter] 开始监听事件: ${contractAddress} - ${eventName}`,
    );

    const provider = this.getProvider();
    const contract = new ethers.Contract(contractAddress, abi, provider);

    // 监听事件
    contract.on(eventName, (...args) => {
      // 最后一个参数是事件对象
      const event = args[args.length - 1];
      const eventArgs = args.slice(0, -1);

      logger.info(`[BlockchainAdapter] 收到事件 ${eventName}:`, {
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

    logger.info(`[BlockchainAdapter] 事件监听已设置: ${eventName}`);
  }

  /**
   * 停止监听事件
   * @param {string} contractAddress - 合约地址
   * @param {Array} abi - 合约 ABI
   * @param {string} eventName - 事件名称
   */
  async stopListening(contractAddress, abi, eventName) {
    logger.info(
      `[BlockchainAdapter] 停止监听事件: ${contractAddress} - ${eventName}`,
    );

    const provider = this.getProvider();
    const contract = new ethers.Contract(contractAddress, abi, provider);

    // 移除所有该事件的监听器
    contract.removeAllListeners(eventName);

    logger.info(`[BlockchainAdapter] 事件监听已移除: ${eventName}`);
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
    logger.info("[BlockchainAdapter] 清理资源...");

    // 停止所有提供者
    for (const [chainId, provider] of this.providers.entries()) {
      try {
        await provider.destroy();
      } catch (error) {
        logger.error(`[BlockchainAdapter] 清理链 ${chainId} 失败:`, error);
      }
    }

    this.providers.clear();
    this.initialized = false;
  }

  // ==================== Phase 5: 高级功能 ====================

  /**
   * 批量转账代币
   * @param {string} walletId - 钱包ID
   * @param {string} tokenAddress - 代币合约地址
   * @param {Array<{to: string, amount: string}>} transfers - 转账列表
   * @param {string} password - 钱包密码
   * @returns {Promise<Array<string>>} 交易哈希列表
   */
  async batchTransferToken(walletId, tokenAddress, transfers, password) {
    logger.info(`[BlockchainAdapter] 批量转账代币: ${transfers.length} 笔交易`);

    const results = [];
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const provider = this.getProvider();
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    const abi = getERC20ABI();
    const contract = new ethers.Contract(tokenAddress, abi, signer);
    const decimals = await contract.decimals();

    for (const transfer of transfers) {
      try {
        const transferAmount = ethers.parseUnits(
          transfer.amount.toString(),
          decimals,
        );
        const tx = await contract.transfer(transfer.to, transferAmount);
        const receipt = await tx.wait();
        results.push({ success: true, txHash: receipt.hash, to: transfer.to });
        logger.info(
          `[BlockchainAdapter] 转账成功: ${transfer.to} - ${receipt.hash}`,
        );
      } catch (error) {
        logger.error(`[BlockchainAdapter] 转账失败: ${transfer.to}`, error);
        results.push({ success: false, error: error.message, to: transfer.to });
      }
    }

    return results;
  }

  /**
   * 估算交易费用（包含 L2 特殊处理）
   * @param {object} transaction - 交易对象
   * @returns {Promise<object>} 费用估算
   */
  async estimateTransactionFee(transaction) {
    const provider = this.getProvider();
    const config = getNetworkConfig(this.currentChainId);

    try {
      const gasEstimate = await provider.estimateGas(transaction);
      const feeData = await provider.getFeeData();

      let totalFee;
      const feeBreakdown = {
        gasLimit: gasEstimate,
        gasPrice: feeData.gasPrice,
      };

      // L2 链（Arbitrum, Optimism, Base）需要额外计算 L1 数据费用
      if (
        [42161, 421614, 10, 11155420, 8453, 84532].includes(this.currentChainId)
      ) {
        // L2 链的费用 = L2 执行费用 + L1 数据费用
        const l2ExecutionFee = gasEstimate * feeData.gasPrice;

        // L1 数据费用估算（简化版本）
        const txDataSize = ethers.toUtf8Bytes(
          JSON.stringify(transaction),
        ).length;
        const l1DataFee = BigInt(txDataSize) * BigInt(16) * feeData.gasPrice;

        totalFee = l2ExecutionFee + l1DataFee;
        feeBreakdown.l2ExecutionFee = l2ExecutionFee;
        feeBreakdown.l1DataFee = l1DataFee;
      } else {
        totalFee = gasEstimate * feeData.gasPrice;
      }

      return {
        totalFee: totalFee.toString(),
        totalFeeEth: ethers.formatEther(totalFee),
        ...feeBreakdown,
        nativeCurrency: config.nativeCurrency.symbol,
      };
    } catch (error) {
      logger.error("[BlockchainAdapter] 费用估算失败:", error);
      throw error;
    }
  }

  /**
   * 交易重试（带指数退避）
   * @param {Function} txFunction - 交易函数
   * @param {number} maxRetries - 最大重试次数
   * @param {number} baseDelay - 基础延迟（毫秒）
   * @returns {Promise<any>} 交易结果
   */
  async retryTransaction(txFunction, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        logger.info(
          `[BlockchainAdapter] 交易尝试 ${attempt + 1}/${maxRetries}`,
        );
        const result = await txFunction();
        logger.info("[BlockchainAdapter] 交易成功");
        return result;
      } catch (error) {
        lastError = error;
        logger.warn(
          `[BlockchainAdapter] 交易失败 (尝试 ${attempt + 1}):`,
          error.message,
        );

        // 如果不是最后一次尝试，等待后重试
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt); // 指数退避
          logger.info(`[BlockchainAdapter] 等待 ${delay}ms 后重试...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error("[BlockchainAdapter] 交易失败，已达最大重试次数");
    throw lastError;
  }

  /**
   * Gas 价格优化（根据网络拥堵情况调整）
   * @param {string} speed - 速度等级 ('slow', 'standard', 'fast')
   * @returns {Promise<object>} 优化后的 Gas 价格
   */
  async getOptimizedGasPrice(speed = "standard") {
    const provider = this.getProvider();
    const feeData = await provider.getFeeData();
    const config = getNetworkConfig(this.currentChainId);

    // 获取配置的 Gas 价格
    const { GasConfigs } = require("./blockchain-config");
    const gasConfig = GasConfigs[this.currentChainId] || {
      slow: 1,
      standard: 2,
      fast: 3,
    };

    let multiplier = 1;
    switch (speed) {
      case "slow":
        multiplier = gasConfig.slow / gasConfig.standard;
        break;
      case "fast":
        multiplier = gasConfig.fast / gasConfig.standard;
        break;
      default:
        multiplier = 1;
    }

    // EIP-1559 支持的链
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      return {
        maxFeePerGas:
          (feeData.maxFeePerGas * BigInt(Math.floor(multiplier * 100))) /
          BigInt(100),
        maxPriorityFeePerGas:
          (feeData.maxPriorityFeePerGas *
            BigInt(Math.floor(multiplier * 100))) /
          BigInt(100),
        type: "eip1559",
      };
    } else {
      // Legacy 交易
      return {
        gasPrice:
          (feeData.gasPrice * BigInt(Math.floor(multiplier * 100))) /
          BigInt(100),
        type: "legacy",
      };
    }
  }

  /**
   * 获取所有支持的链列表
   * @returns {Array<object>} 链列表
   */
  getSupportedChains() {
    const { NetworkConfigs } = require("./blockchain-config");
    return Object.values(NetworkConfigs).map((config) => ({
      chainId: config.chainId,
      name: config.name,
      symbol: config.symbol,
      nativeCurrency: config.nativeCurrency,
      blockExplorerUrls: config.blockExplorerUrls,
      isConnected: this.providers.has(config.chainId),
    }));
  }

  /**
   * 获取当前链信息
   * @returns {object} 当前链信息
   */
  getCurrentChainInfo() {
    const config = getNetworkConfig(this.currentChainId);
    return {
      chainId: this.currentChainId,
      name: config.name,
      symbol: config.symbol,
      nativeCurrency: config.nativeCurrency,
      blockExplorerUrls: config.blockExplorerUrls,
      isConnected: this.providers.has(this.currentChainId),
    };
  }

  /**
   * 监控交易状态
   * @param {string} txHash - 交易哈希
   * @param {number} confirmations - 需要的确认数
   * @param {Function} onUpdate - 状态更新回调
   * @returns {Promise<object>} 交易收据
   */
  async monitorTransaction(txHash, confirmations = 1, onUpdate = null) {
    logger.info(
      `[BlockchainAdapter] 监控交易: ${txHash}, 需要 ${confirmations} 个确认`,
    );

    const provider = this.getProvider();

    try {
      // 等待交易被挖掘
      if (onUpdate) {
        onUpdate({ status: "pending", confirmations: 0 });
      }

      const receipt = await provider.waitForTransaction(txHash, confirmations);

      if (onUpdate) {
        onUpdate({
          status: receipt.status === 1 ? "success" : "failed",
          confirmations: confirmations,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
        });
      }

      logger.info(`[BlockchainAdapter] 交易已确认: ${txHash}`);
      return receipt;
    } catch (error) {
      logger.error(`[BlockchainAdapter] 交易监控失败: ${txHash}`, error);
      if (onUpdate) {
        onUpdate({ status: "error", error: error.message });
      }
      throw error;
    }
  }

  /**
   * 取消或加速交易（通过替换交易）
   * @param {string} walletId - 钱包ID
   * @param {string} txHash - 原交易哈希
   * @param {string} action - 'cancel' 或 'speedup'
   * @param {string} password - 钱包密码
   * @returns {Promise<string>} 新交易哈希
   */
  async replaceTransaction(walletId, txHash, action = "speedup", password) {
    logger.info(
      `[BlockchainAdapter] ${action === "cancel" ? "取消" : "加速"}交易: ${txHash}`,
    );

    const provider = this.getProvider();
    const wallet = await this.walletManager.unlockWallet(walletId, password);
    const signer = wallet.provider ? wallet : wallet.connect(provider);

    try {
      // 获取原交易
      const originalTx = await provider.getTransaction(txHash);
      if (!originalTx) {
        throw new Error("交易不存在");
      }

      // 检查交易是否已确认
      if (originalTx.blockNumber) {
        throw new Error("交易已确认，无法替换");
      }

      // 获取当前 Gas 价格
      const feeData = await provider.getFeeData();

      let newTx;
      if (action === "cancel") {
        // 取消交易：发送 0 ETH 给自己，使用相同 nonce 但更高 Gas 价格
        newTx = {
          to: await signer.getAddress(),
          value: 0,
          nonce: originalTx.nonce,
          gasLimit: 21000,
        };
      } else {
        // 加速交易：使用相同参数但更高 Gas 价格
        newTx = {
          to: originalTx.to,
          value: originalTx.value,
          data: originalTx.data,
          nonce: originalTx.nonce,
          gasLimit: originalTx.gasLimit,
        };
      }

      // 设置更高的 Gas 价格（至少提高 10%）
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        newTx.maxFeePerGas = (feeData.maxFeePerGas * BigInt(110)) / BigInt(100);
        newTx.maxPriorityFeePerGas =
          (feeData.maxPriorityFeePerGas * BigInt(110)) / BigInt(100);
      } else {
        newTx.gasPrice = (feeData.gasPrice * BigInt(110)) / BigInt(100);
      }

      // 发送新交易
      const tx = await signer.sendTransaction(newTx);
      logger.info(`[BlockchainAdapter] 替换交易已发送: ${tx.hash}`);

      return tx.hash;
    } catch (error) {
      logger.error("[BlockchainAdapter] 替换交易失败:", error);
      throw error;
    }
  }
}

module.exports = BlockchainAdapter;
