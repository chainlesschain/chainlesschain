const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * 跨链桥管理器
 *
 * 功能：
 * - 资产跨链转移（锁定-铸造模式）
 * - 桥接记录管理
 * - 交易监控和状态同步
 *
 * 注意：
 * 这是一个简化版本的跨链桥实现。
 * 生产环境建议使用成熟的跨链方案：
 * - Chainlink CCIP
 * - LayerZero
 * - Axelar Network
 */
class BridgeManager extends EventEmitter {
  /**
   * 构造函数
   * @param {Object} blockchainAdapter - 区块链适配器
   * @param {Object} database - 数据库实例
   */
  constructor(blockchainAdapter, database) {
    super();
    this.adapter = blockchainAdapter;
    this.database = database;
    this.initialized = false;

    // 桥接合约地址（需要在每条链上部署）
    this.bridgeContracts = new Map();
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) {
      console.log('[BridgeManager] 已经初始化');
      return;
    }

    try {
      // 创建桥接记录表（如果不存在）
      await this.initializeTables();

      // 加载已部署的桥接合约地址
      await this.loadBridgeContracts();

      this.initialized = true;
      console.log('[BridgeManager] 初始化成功');
    } catch (error) {
      console.error('[BridgeManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    return new Promise((resolve, reject) => {
      this.database.run(`
        CREATE TABLE IF NOT EXISTS bridge_transfers (
          id TEXT PRIMARY KEY,
          from_chain_id INTEGER NOT NULL,
          to_chain_id INTEGER NOT NULL,
          from_tx_hash TEXT,
          to_tx_hash TEXT,
          asset_id TEXT,
          asset_address TEXT,
          amount TEXT NOT NULL,
          sender_address TEXT NOT NULL,
          recipient_address TEXT NOT NULL,
          status TEXT NOT NULL,
          lock_timestamp INTEGER,
          mint_timestamp INTEGER,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          error_message TEXT
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('[BridgeManager] bridge_transfers 表初始化完成');
          resolve();
        }
      });
    });
  }

  /**
   * 加载桥接合约地址
   */
  async loadBridgeContracts() {
    // 从数据库或配置加载已部署的桥接合约地址
    // 简化版本：使用硬编码的测试合约地址

    // TODO: 从 deployed_contracts 表加载
    // 这里先留空，实际部署后再填充
    console.log('[BridgeManager] 桥接合约地址加载完成');
  }

  /**
   * 注册桥接合约
   * @param {number} chainId - 链 ID
   * @param {string} contractAddress - 合约地址
   */
  registerBridgeContract(chainId, contractAddress) {
    this.bridgeContracts.set(chainId, contractAddress);
    console.log(`[BridgeManager] 注册桥接合约: Chain ${chainId} -> ${contractAddress}`);
  }

  /**
   * 桥接资产（跨链转移）
   * @param {Object} options - 桥接选项
   * @param {string} options.assetId - 本地资产 ID
   * @param {number} options.fromChainId - 源链 ID
   * @param {number} options.toChainId - 目标链 ID
   * @param {string} options.amount - 转移数量
   * @param {string} options.walletId - 钱包 ID
   * @param {string} options.password - 钱包密码
   * @param {string} options.recipientAddress - 接收地址（可选，默认使用同一地址）
   * @returns {Promise<Object>} 桥接记录
   */
  async bridgeAsset(options) {
    const {
      assetId,
      fromChainId,
      toChainId,
      amount,
      walletId,
      password,
      recipientAddress = null,
    } = options;

    console.log('[BridgeManager] 开始桥接资产:', {
      assetId,
      fromChainId,
      toChainId,
      amount,
    });

    // 验证参数
    if (!assetId || !fromChainId || !toChainId || !amount || !walletId || !password) {
      throw new Error('缺少必要参数');
    }

    if (fromChainId === toChainId) {
      throw new Error('源链和目标链不能相同');
    }

    // 验证桥接合约是否存在
    if (!this.bridgeContracts.has(fromChainId)) {
      throw new Error(`源链 ${fromChainId} 上未部署桥接合约`);
    }

    if (!this.bridgeContracts.has(toChainId)) {
      throw new Error(`目标链 ${toChainId} 上未部署桥接合约`);
    }

    try {
      // 获取钱包地址
      const wallet = await this.adapter.walletManager.unlockWallet(walletId, password);
      const senderAddress = wallet.address;
      const receiverAddress = recipientAddress || senderAddress;

      // 获取资产的链上信息
      const assetInfo = await this._getAssetInfo(assetId);
      if (!assetInfo) {
        throw new Error('资产未部署到区块链');
      }

      // 创建桥接记录
      const bridgeId = uuidv4();
      const bridgeRecord = {
        id: bridgeId,
        from_chain_id: fromChainId,
        to_chain_id: toChainId,
        asset_id: assetId,
        asset_address: assetInfo.contract_address,
        amount,
        sender_address: senderAddress,
        recipient_address: receiverAddress,
        status: 'pending',
        created_at: Date.now(),
      };

      await this._saveBridgeRecord(bridgeRecord);

      // 步骤 1: 在源链锁定资产
      console.log('[BridgeManager] 步骤 1: 锁定资产在源链...');
      const lockTxHash = await this._lockOnSourceChain({
        chainId: fromChainId,
        assetAddress: assetInfo.contract_address,
        amount,
        walletId,
        password,
        bridgeContractAddress: this.bridgeContracts.get(fromChainId),
      });

      // 更新记录
      await this._updateBridgeRecord(bridgeId, {
        from_tx_hash: lockTxHash,
        lock_timestamp: Date.now(),
        status: 'locked',
      });

      this.emit('asset:locked', { bridgeId, txHash: lockTxHash });

      // 步骤 2: 等待锁定确认
      console.log('[BridgeManager] 步骤 2: 等待锁定确认...');
      await this._waitForLockConfirmation(fromChainId, lockTxHash);

      // 步骤 3: 在目标链铸造资产
      console.log('[BridgeManager] 步骤 3: 在目标链铸造资产...');
      const mintTxHash = await this._mintOnTargetChain({
        chainId: toChainId,
        assetAddress: assetInfo.contract_address,
        amount,
        recipientAddress: receiverAddress,
        walletId,
        password,
        bridgeContractAddress: this.bridgeContracts.get(toChainId),
      });

      // 更新记录
      await this._updateBridgeRecord(bridgeId, {
        to_tx_hash: mintTxHash,
        mint_timestamp: Date.now(),
        status: 'completed',
        completed_at: Date.now(),
      });

      this.emit('asset:bridged', { bridgeId, fromTxHash: lockTxHash, toTxHash: mintTxHash });

      console.log('[BridgeManager] 桥接成功完成!', {
        bridgeId,
        lockTxHash,
        mintTxHash,
      });

      return await this.getBridgeRecord(bridgeId);
    } catch (error) {
      console.error('[BridgeManager] 桥接失败:', error);

      // 更新记录为失败状态
      if (options.bridgeId) {
        await this._updateBridgeRecord(options.bridgeId, {
          status: 'failed',
          error_message: error.message,
        });
      }

      this.emit('asset:bridge-failed', { error: error.message });
      throw error;
    }
  }

  /**
   * 在源链锁定资产
   * @private
   */
  async _lockOnSourceChain(options) {
    const { chainId, assetAddress, amount, walletId, password, bridgeContractAddress } = options;

    // 切换到源链
    await this.adapter.switchChain(chainId);

    // 解锁钱包
    const wallet = await this.adapter.walletManager.unlockWallet(walletId, password);

    // 调用桥接合约的 lock 方法
    // 注意：这里需要先 approve 代币给桥接合约
    console.log('[BridgeManager] 调用桥接合约锁定资产:', {
      bridgeContractAddress,
      assetAddress,
      amount,
    });

    // TODO: 实际调用合约
    // 简化版本：返回模拟的交易哈希
    const mockTxHash = `0x${Buffer.from(`lock_${Date.now()}_${Math.random()}`).toString('hex').slice(0, 64)}`;

    console.log('[BridgeManager] 锁定交易已提交:', mockTxHash);
    return mockTxHash;
  }

  /**
   * 等待锁定确认
   * @private
   */
  async _waitForLockConfirmation(chainId, txHash) {
    console.log('[BridgeManager] 等待交易确认:', txHash);

    // TODO: 实际等待交易确认
    // 简化版本：模拟等待
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('[BridgeManager] 锁定已确认');
    return true;
  }

  /**
   * 在目标链铸造资产
   * @private
   */
  async _mintOnTargetChain(options) {
    const { chainId, assetAddress, amount, recipientAddress, walletId, password, bridgeContractAddress } = options;

    // 切换到目标链
    await this.adapter.switchChain(chainId);

    // 解锁钱包
    const wallet = await this.adapter.walletManager.unlockWallet(walletId, password);

    // 调用桥接合约的 mint 方法
    console.log('[BridgeManager] 调用桥接合约铸造资产:', {
      bridgeContractAddress,
      assetAddress,
      amount,
      recipientAddress,
    });

    // TODO: 实际调用合约
    // 简化版本：返回模拟的交易哈希
    const mockTxHash = `0x${Buffer.from(`mint_${Date.now()}_${Math.random()}`).toString('hex').slice(0, 64)}`;

    console.log('[BridgeManager] 铸造交易已提交:', mockTxHash);
    return mockTxHash;
  }

  /**
   * 获取资产信息
   * @private
   */
  async _getAssetInfo(assetId) {
    return new Promise((resolve, reject) => {
      this.database.get(
        'SELECT * FROM blockchain_assets WHERE local_asset_id = ?',
        [assetId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });
  }

  /**
   * 保存桥接记录
   * @private
   */
  async _saveBridgeRecord(record) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO bridge_transfers (
          id, from_chain_id, to_chain_id, from_tx_hash, to_tx_hash,
          asset_id, asset_address, amount, sender_address, recipient_address,
          status, lock_timestamp, mint_timestamp, created_at, completed_at, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.database.run(sql, [
        record.id,
        record.from_chain_id,
        record.to_chain_id,
        record.from_tx_hash || null,
        record.to_tx_hash || null,
        record.asset_id,
        record.asset_address,
        record.amount,
        record.sender_address,
        record.recipient_address,
        record.status,
        record.lock_timestamp || null,
        record.mint_timestamp || null,
        record.created_at,
        record.completed_at || null,
        record.error_message || null,
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 更新桥接记录
   * @private
   */
  async _updateBridgeRecord(bridgeId, updates) {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);

    return new Promise((resolve, reject) => {
      this.database.run(
        `UPDATE bridge_transfers SET ${fields} WHERE id = ?`,
        [...values, bridgeId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 获取桥接记录
   * @param {string} bridgeId - 桥接 ID
   * @returns {Promise<Object>} 桥接记录
   */
  async getBridgeRecord(bridgeId) {
    return new Promise((resolve, reject) => {
      this.database.get(
        'SELECT * FROM bridge_transfers WHERE id = ?',
        [bridgeId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });
  }

  /**
   * 获取桥接历史
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 桥接记录列表
   */
  async getBridgeHistory(filters = {}) {
    let sql = 'SELECT * FROM bridge_transfers WHERE 1=1';
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.from_chain_id) {
      sql += ' AND from_chain_id = ?';
      params.push(filters.from_chain_id);
    }

    if (filters.to_chain_id) {
      sql += ' AND to_chain_id = ?';
      params.push(filters.to_chain_id);
    }

    if (filters.sender_address) {
      sql += ' AND sender_address = ?';
      params.push(filters.sender_address);
    }

    sql += ' ORDER BY created_at DESC LIMIT 100';

    return new Promise((resolve, reject) => {
      this.database.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.removeAllListeners();
    this.bridgeContracts.clear();
    this.initialized = false;
    console.log('[BridgeManager] 资源已清理');
  }
}

module.exports = BridgeManager;
