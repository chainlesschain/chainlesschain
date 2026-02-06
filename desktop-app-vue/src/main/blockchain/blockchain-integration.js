/**
 * 区块链集成模块
 *
 * Phase 5: 将区块链适配器集成到现有交易系统
 *
 * 功能：
 * - 将链上资产与本地资产管理器同步
 * - 将链上交易与本地交易记录同步
 * - 将链上托管与本地托管管理器同步
 * - 提供统一的API接口
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');

class BlockchainIntegration extends EventEmitter {
  constructor(database, blockchainAdapter, assetManager, marketplaceManager, escrowManager) {
    super();

    this.database = database;
    this.blockchainAdapter = blockchainAdapter;
    this.assetManager = assetManager;
    this.marketplaceManager = marketplaceManager;
    this.escrowManager = escrowManager;

    this.initialized = false;
    this.syncInterval = null;
  }

  /**
   * 初始化集成模块
   */
  async initialize() {
    logger.info('[BlockchainIntegration] 初始化区块链集成模块...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      // 启动自动同步（每5分钟）
      this.startAutoSync(5 * 60 * 1000);

      this.initialized = true;
      logger.info('[BlockchainIntegration] 区块链集成模块初始化成功');
    } catch (error) {
      logger.error('[BlockchainIntegration] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 链上资产映射表
    db.exec(`
      CREATE TABLE IF NOT EXISTS blockchain_asset_mapping (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_asset_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        contract_address TEXT NOT NULL,
        token_id TEXT,
        asset_type TEXT NOT NULL,
        sync_status TEXT DEFAULT 'synced',
        last_synced_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(local_asset_id, chain_id)
      )
    `);

    // 链上交易映射表
    db.exec(`
      CREATE TABLE IF NOT EXISTS blockchain_transaction_mapping (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_tx_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        block_number INTEGER,
        tx_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        gas_used TEXT,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        UNIQUE(local_tx_id, chain_id)
      )
    `);

    // 链上托管映射表
    db.exec(`
      CREATE TABLE IF NOT EXISTS blockchain_escrow_mapping (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_escrow_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        contract_address TEXT NOT NULL,
        escrow_id TEXT NOT NULL,
        sync_status TEXT DEFAULT 'synced',
        last_synced_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(local_escrow_id, chain_id)
      )
    `);

    // 同步日志表
    db.exec(`
      CREATE TABLE IF NOT EXISTS blockchain_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_type TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        items_synced INTEGER DEFAULT 0,
        error_message TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    logger.info('[BlockchainIntegration] 数据库表初始化完成');
  }

  // ==================== 资产同步 ====================

  /**
   * 创建链上资产（ERC-20 Token）
   * @param {string} localAssetId - 本地资产ID
   * @param {object} options - 部署参数
   * @returns {Promise<object>} 部署结果
   */
  async createOnChainToken(localAssetId, options) {
    logger.info(`[BlockchainIntegration] 创建链上Token: ${localAssetId}`);

    try {
      // 获取本地资产信息
      const asset = await this.assetManager.getAsset(localAssetId);
      if (!asset) {
        throw new Error('本地资产不存在');
      }

      // 部署ERC-20合约
      const { address, txHash } = await this.blockchainAdapter.deployERC20Token(
        options.walletId,
        {
          name: asset.name,
          symbol: asset.symbol || asset.name.substring(0, 4).toUpperCase(),
          decimals: asset.decimals || 18,
          initialSupply: asset.total_supply || 1000000,
          password: options.password,
        }
      );

      // 保存映射关系
      const db = this.database.db;
      const now = Date.now();
      db.run(
        `INSERT INTO blockchain_asset_mapping
         (local_asset_id, chain_id, contract_address, asset_type, last_synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [localAssetId, this.blockchainAdapter.currentChainId, address, 'token', now, now]
      );

      // 记录交易
      db.run(
        `INSERT INTO blockchain_transaction_mapping
         (local_tx_id, chain_id, tx_hash, tx_type, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [`deploy_${localAssetId}`, this.blockchainAdapter.currentChainId, txHash, 'deploy', 'confirmed', now]
      );

      logger.info(`[BlockchainIntegration] Token部署成功: ${address}`);

      this.emit('asset:deployed', {
        localAssetId,
        chainId: this.blockchainAdapter.currentChainId,
        contractAddress: address,
        txHash,
      });

      return { address, txHash };
    } catch (error) {
      logger.error('[BlockchainIntegration] Token部署失败:', error);
      throw error;
    }
  }

  /**
   * 创建链上NFT
   * @param {string} localAssetId - 本地资产ID
   * @param {object} options - 部署参数
   * @returns {Promise<object>} 部署结果
   */
  async createOnChainNFT(localAssetId, options) {
    logger.info(`[BlockchainIntegration] 创建链上NFT: ${localAssetId}`);

    try {
      const asset = await this.assetManager.getAsset(localAssetId);
      if (!asset) {
        throw new Error('本地资产不存在');
      }

      // 部署ERC-721合约
      const { address, txHash } = await this.blockchainAdapter.deployNFT(
        options.walletId,
        {
          name: asset.name,
          symbol: asset.symbol || asset.name.substring(0, 4).toUpperCase(),
          password: options.password,
        }
      );

      // 保存映射关系
      const db = this.database.db;
      const now = Date.now();
      db.run(
        `INSERT INTO blockchain_asset_mapping
         (local_asset_id, chain_id, contract_address, asset_type, last_synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [localAssetId, this.blockchainAdapter.currentChainId, address, 'nft', now, now]
      );

      logger.info(`[BlockchainIntegration] NFT部署成功: ${address}`);

      this.emit('asset:deployed', {
        localAssetId,
        chainId: this.blockchainAdapter.currentChainId,
        contractAddress: address,
        txHash,
      });

      return { address, txHash };
    } catch (error) {
      logger.error('[BlockchainIntegration] NFT部署失败:', error);
      throw error;
    }
  }

  /**
   * 转账链上资产
   * @param {string} localAssetId - 本地资产ID
   * @param {object} options - 转账参数
   * @returns {Promise<string>} 交易哈希
   */
  async transferOnChainAsset(localAssetId, options) {
    logger.info(`[BlockchainIntegration] 转账链上资产: ${localAssetId}`);

    try {
      // 获取链上合约地址
      const mapping = this.getAssetMapping(localAssetId);
      if (!mapping) {
        throw new Error('资产未部署到链上');
      }

      // 执行链上转账
      const txHash = await this.blockchainAdapter.transferToken(
        options.walletId,
        mapping.contract_address,
        options.to,
        options.amount,
        options.password
      );

      // 同时执行本地转账
      await this.assetManager.transferAsset(
        localAssetId,
        options.fromDid,
        options.toDid,
        options.amount
      );

      // 记录交易映射
      const db = this.database.db;
      const now = Date.now();
      db.run(
        `INSERT INTO blockchain_transaction_mapping
         (local_tx_id, chain_id, tx_hash, tx_type, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [`transfer_${Date.now()}`, this.blockchainAdapter.currentChainId, txHash, 'transfer', 'pending', now]
      );

      logger.info(`[BlockchainIntegration] 资产转账成功: ${txHash}`);

      this.emit('asset:transferred', {
        localAssetId,
        txHash,
        from: options.fromDid,
        to: options.toDid,
        amount: options.amount,
      });

      return txHash;
    } catch (error) {
      logger.error('[BlockchainIntegration] 资产转账失败:', error);
      throw error;
    }
  }

  /**
   * 同步链上资产余额到本地
   * @param {string} localAssetId - 本地资产ID
   * @param {string} ownerAddress - 拥有者地址
   * @returns {Promise<string>} 余额
   */
  async syncAssetBalance(localAssetId, ownerAddress) {
    logger.info(`[BlockchainIntegration] 同步资产余额: ${localAssetId}`);

    try {
      const mapping = this.getAssetMapping(localAssetId);
      if (!mapping) {
        throw new Error('资产未部署到链上');
      }

      // 查询链上余额
      const balance = await this.blockchainAdapter.getTokenBalance(
        mapping.contract_address,
        ownerAddress
      );

      // 更新本地余额（如果需要）
      // await this.assetManager.updateBalance(localAssetId, ownerDid, balance);

      // 更新同步时间
      const db = this.database.db;
      db.run(
        `UPDATE blockchain_asset_mapping SET last_synced_at = ? WHERE local_asset_id = ?`,
        [Date.now(), localAssetId]
      );

      logger.info(`[BlockchainIntegration] 余额同步成功: ${balance}`);

      return balance;
    } catch (error) {
      logger.error('[BlockchainIntegration] 余额同步失败:', error);
      throw error;
    }
  }

  // ==================== 托管同步 ====================

  /**
   * 创建链上托管
   * @param {string} localEscrowId - 本地托管ID
   * @param {object} options - 托管参数
   * @returns {Promise<object>} 创建结果
   */
  async createOnChainEscrow(localEscrowId, options) {
    logger.info(`[BlockchainIntegration] 创建链上托管: ${localEscrowId}`);

    try {
      // 获取本地托管信息
      const escrow = await this.escrowManager.getEscrow(localEscrowId);
      if (!escrow) {
        throw new Error('本地托管不存在');
      }

      // 部署托管合约（如果还没有部署）
      let contractAddress = options.contractAddress;
      let contractAbi;
      if (!contractAddress) {
        const deployment = await this.blockchainAdapter.deployEscrowContract(
          options.walletId,
          options.password
        );
        contractAddress = deployment.address;
        contractAbi = deployment.abi;
      } else {
        // 使用现有合约，获取 ABI
        const { getEscrowContractArtifact } = require('./contract-artifacts');
        contractAbi = getEscrowContractArtifact().abi;
      }

      // 调用托管合约的创建方法
      const { ethers } = require('ethers');
      const wallet = await this.blockchainAdapter.walletManager.unlockWallet(
        options.walletId,
        options.password
      );
      const provider = this.blockchainAdapter.getProvider();
      const signer = wallet.provider ? wallet : wallet.connect(provider);

      const escrowContract = new ethers.Contract(contractAddress, contractAbi, signer);

      // 生成托管 ID (bytes32)
      const escrowIdBytes32 = ethers.id(localEscrowId);

      // 根据支付类型创建托管
      let txHash;
      if (escrow.payment_type === 'erc20' && escrow.token_address) {
        // ERC20 代币托管
        const amount = ethers.parseUnits(
          escrow.amount.toString(),
          escrow.token_decimals || 18
        );

        // 先批准代币转移
        const tokenContract = new ethers.Contract(
          escrow.token_address,
          ['function approve(address spender, uint256 amount) returns (bool)'],
          signer
        );
        const approveTx = await tokenContract.approve(contractAddress, amount);
        await approveTx.wait();

        // 创建 ERC20 托管
        const tx = await escrowContract.createERC20Escrow(
          escrowIdBytes32,
          escrow.seller_address,
          escrow.arbitrator_address || ethers.ZeroAddress,
          escrow.token_address,
          amount
        );
        const receipt = await tx.wait();
        txHash = receipt.hash;
      } else {
        // 原生币托管 (ETH/MATIC)
        const amount = ethers.parseEther(escrow.amount.toString());
        const tx = await escrowContract.createNativeEscrow(
          escrowIdBytes32,
          escrow.seller_address,
          escrow.arbitrator_address || ethers.ZeroAddress,
          { value: amount }
        );
        const receipt = await tx.wait();
        txHash = receipt.hash;
      }

      logger.info(`[BlockchainIntegration] 链上托管创建成功, txHash: ${txHash}`);

      // 保存映射关系
      const db = this.database.db;
      const now = Date.now();
      db.run(
        `INSERT INTO blockchain_escrow_mapping
         (local_escrow_id, chain_id, contract_address, escrow_id, last_synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [localEscrowId, this.blockchainAdapter.currentChainId, contractAddress, localEscrowId, now, now]
      );

      logger.info(`[BlockchainIntegration] 链上托管创建成功`);

      this.emit('escrow:created', {
        localEscrowId,
        chainId: this.blockchainAdapter.currentChainId,
        contractAddress,
      });

      return { contractAddress };
    } catch (error) {
      logger.error('[BlockchainIntegration] 链上托管创建失败:', error);
      throw error;
    }
  }

  /**
   * 同步托管状态
   * @param {string} localEscrowId - 本地托管ID
   * @returns {Promise<object>} 托管状态
   */
  async syncEscrowStatus(localEscrowId) {
    logger.info(`[BlockchainIntegration] 同步托管状态: ${localEscrowId}`);

    try {
      const mapping = this.getEscrowMapping(localEscrowId);
      if (!mapping) {
        throw new Error('托管未部署到链上');
      }

      // 查询链上托管状态
      const { ethers } = require('ethers');
      const { getEscrowContractArtifact } = require('./contract-artifacts');

      const provider = this.blockchainAdapter.getProvider();
      const contractAbi = getEscrowContractArtifact().abi;
      const escrowContract = new ethers.Contract(mapping.contract_address, contractAbi, provider);

      // 生成托管 ID (bytes32)
      const escrowIdBytes32 = ethers.id(localEscrowId);

      // 查询链上托管数据
      const onChainEscrow = await escrowContract.getEscrow(escrowIdBytes32);

      // 状态枚举映射
      const stateMap = ['created', 'funded', 'delivered', 'completed', 'refunded', 'disputed'];
      const paymentTypeMap = ['native', 'erc20'];

      // 解析链上数据
      const chainStatus = {
        escrowId: onChainEscrow.id,
        buyer: onChainEscrow.buyer,
        seller: onChainEscrow.seller,
        arbitrator: onChainEscrow.arbitrator,
        amount: onChainEscrow.amount.toString(),
        paymentType: paymentTypeMap[Number(onChainEscrow.paymentType)] || 'unknown',
        tokenAddress: onChainEscrow.tokenAddress,
        state: stateMap[Number(onChainEscrow.state)] || 'unknown',
        createdAt: Number(onChainEscrow.createdAt) * 1000, // 转换为毫秒
        completedAt: Number(onChainEscrow.completedAt) * 1000,
      };

      // 同步状态到本地托管管理器
      if (this.escrowManager && typeof this.escrowManager.updateEscrowStatus === 'function') {
        await this.escrowManager.updateEscrowStatus(localEscrowId, chainStatus.state);
      }

      // 更新同步时间
      const db = this.database.db;
      db.run(
        `UPDATE blockchain_escrow_mapping SET last_synced_at = ? WHERE local_escrow_id = ?`,
        [Date.now(), localEscrowId]
      );

      logger.info(`[BlockchainIntegration] 托管状态同步成功: ${chainStatus.state}`);

      return {
        status: 'synced',
        chainStatus,
        syncedAt: Date.now(),
      };
    } catch (error) {
      logger.error('[BlockchainIntegration] 托管状态同步失败:', error);
      throw error;
    }
  }

  // ==================== 交易监控 ====================

  /**
   * 监控交易状态
   * @param {string} txHash - 交易哈希
   * @param {number} confirmations - 需要的确认数
   * @returns {Promise<object>} 交易收据
   */
  async monitorTransaction(txHash, confirmations = 1) {
    logger.info(`[BlockchainIntegration] 监控交易: ${txHash}`);

    try {
      const receipt = await this.blockchainAdapter.monitorTransaction(
        txHash,
        confirmations,
        (update) => {
          this.emit('transaction:update', { txHash, ...update });
        }
      );

      // 更新本地交易状态
      const db = this.database.db;
      db.run(
        `UPDATE blockchain_transaction_mapping
         SET status = ?, block_number = ?, gas_used = ?, confirmed_at = ?
         WHERE tx_hash = ?`,
        [
          receipt.status === 1 ? 'confirmed' : 'failed',
          receipt.blockNumber,
          receipt.gasUsed.toString(),
          Date.now(),
          txHash,
        ]
      );

      logger.info(`[BlockchainIntegration] 交易监控完成: ${txHash}`);

      return receipt;
    } catch (error) {
      logger.error('[BlockchainIntegration] 交易监控失败:', error);
      throw error;
    }
  }

  // ==================== 查询方法 ====================

  /**
   * 获取资产映射
   * @param {string} localAssetId - 本地资产ID
   * @returns {object|null} 映射信息
   */
  getAssetMapping(localAssetId) {
    const db = this.database.db;
    const stmt = db.prepare(
      `SELECT * FROM blockchain_asset_mapping WHERE local_asset_id = ? AND chain_id = ?`
    );
    return stmt.get(localAssetId, this.blockchainAdapter.currentChainId);
  }

  /**
   * 获取托管映射
   * @param {string} localEscrowId - 本地托管ID
   * @returns {object|null} 映射信息
   */
  getEscrowMapping(localEscrowId) {
    const db = this.database.db;
    const stmt = db.prepare(
      `SELECT * FROM blockchain_escrow_mapping WHERE local_escrow_id = ? AND chain_id = ?`
    );
    return stmt.get(localEscrowId, this.blockchainAdapter.currentChainId);
  }

  /**
   * 获取交易映射
   * @param {string} localTxId - 本地交易ID
   * @returns {object|null} 映射信息
   */
  getTransactionMapping(localTxId) {
    const db = this.database.db;
    const stmt = db.prepare(
      `SELECT * FROM blockchain_transaction_mapping WHERE local_tx_id = ? AND chain_id = ?`
    );
    return stmt.get(localTxId, this.blockchainAdapter.currentChainId);
  }

  /**
   * 获取所有链上资产
   * @returns {Array<object>} 资产列表
   */
  getAllOnChainAssets() {
    const db = this.database.db;
    const stmt = db.prepare(
      `SELECT * FROM blockchain_asset_mapping WHERE chain_id = ? ORDER BY created_at DESC`
    );
    return stmt.all(this.blockchainAdapter.currentChainId);
  }

  /**
   * 获取待确认交易
   * @returns {Array<object>} 交易列表
   */
  getPendingTransactions() {
    const db = this.database.db;
    const stmt = db.prepare(
      `SELECT * FROM blockchain_transaction_mapping
       WHERE chain_id = ? AND status = 'pending'
       ORDER BY created_at DESC`
    );
    return stmt.all(this.blockchainAdapter.currentChainId);
  }

  // ==================== 自动同步 ====================

  /**
   * 启动自动同步
   * @param {number} interval - 同步间隔（毫秒）
   */
  startAutoSync(interval = 5 * 60 * 1000) {
    logger.info(`[BlockchainIntegration] 启动自动同步，间隔: ${interval}ms`);

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      try {
        await this.syncAll();
      } catch (error) {
        logger.error('[BlockchainIntegration] 自动同步失败:', error);
      }
    }, interval);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    logger.info('[BlockchainIntegration] 停止自动同步');

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * 同步所有数据
   */
  async syncAll() {
    logger.info('[BlockchainIntegration] 开始全量同步...');

    const db = this.database.db;
    const now = Date.now();
    const logId = db.run(
      `INSERT INTO blockchain_sync_log (sync_type, chain_id, status, started_at)
       VALUES (?, ?, ?, ?)`,
      ['full', this.blockchainAdapter.currentChainId, 'running', now]
    ).lastInsertRowid;

    try {
      let itemsSynced = 0;

      // 同步待确认交易
      const pendingTxs = this.getPendingTransactions();
      for (const tx of pendingTxs) {
        try {
          await this.monitorTransaction(tx.tx_hash, 1);
          itemsSynced++;
        } catch (error) {
          logger.warn(`[BlockchainIntegration] 交易同步失败: ${tx.tx_hash}`, error);
        }
      }

      // 更新同步日志
      db.run(
        `UPDATE blockchain_sync_log
         SET status = ?, items_synced = ?, completed_at = ?
         WHERE id = ?`,
        ['completed', itemsSynced, Date.now(), logId]
      );

      logger.info(`[BlockchainIntegration] 全量同步完成，同步 ${itemsSynced} 项`);

      this.emit('sync:completed', { itemsSynced });
    } catch (error) {
      logger.error('[BlockchainIntegration] 全量同步失败:', error);

      db.run(
        `UPDATE blockchain_sync_log
         SET status = ?, error_message = ?, completed_at = ?
         WHERE id = ?`,
        ['failed', error.message, Date.now(), logId]
      );

      throw error;
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info('[BlockchainIntegration] 清理资源...');

    this.stopAutoSync();
    this.removeAllListeners();

    logger.info('[BlockchainIntegration] 资源清理完成');
  }
}

module.exports = BlockchainIntegration;
