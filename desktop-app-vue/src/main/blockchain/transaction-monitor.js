/**
 * 交易监控器
 *
 * 负责监控区块链交易状态，自动更新本地数据库
 * 功能：
 * - 提交交易并监控
 * - 等待交易确认
 * - 更新数据库状态
 * - 交易重试机制
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * 交易状态
 */
const TransactionStatus = {
  PENDING: 'pending', // 待确认
  CONFIRMED: 'confirmed', // 已确认
  FAILED: 'failed', // 失败
};

class TransactionMonitor extends EventEmitter {
  constructor(blockchainAdapter, database) {
    super();

    this.adapter = blockchainAdapter;
    this.database = database;

    // 待处理交易 (txHash => {retries, callback, ...})
    this.pendingTxs = new Map();

    // 监控间隔（毫秒）
    this.monitorInterval = 5000;

    // 定时器
    this.monitorTimer = null;

    this.initialized = false;
  }

  /**
   * 初始化监控器
   */
  async initialize() {
    logger.info('[TransactionMonitor] 初始化交易监控器...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      // 恢复未完成的交易监控
      await this.recoverPendingTransactions();

      // 启动监控定时器
      this.startMonitoring();

      this.initialized = true;
      logger.info('[TransactionMonitor] 交易监控器初始化成功');
    } catch (error) {
      logger.error('[TransactionMonitor] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS blockchain_transactions (
        id TEXT PRIMARY KEY,
        tx_hash TEXT UNIQUE NOT NULL,
        chain_id INTEGER NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT,
        value TEXT,
        gas_used TEXT,
        gas_price TEXT,
        status TEXT,
        block_number INTEGER,
        tx_type TEXT,
        local_ref_id TEXT,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER
      )
    `);
  }

  /**
   * 提交交易并监控状态
   * @param {object} txResponse - ethers.js 交易响应
   * @param {object} options - 选项 {onConfirmed, onFailed, txType, localRefId}
   * @returns {Promise<string>} 交易哈希
   */
  async submitAndMonitor(txResponse, options = {}) {
    const txHash = txResponse.hash;
    const { onConfirmed, onFailed, txType, localRefId } = options;

    // 保存到数据库（状态: pending）
    await this.saveTx({
      txHash,
      fromAddress: txResponse.from,
      toAddress: txResponse.to,
      value: txResponse.value ? txResponse.value.toString() : null,
      status: TransactionStatus.PENDING,
      txType,
      localRefId,
    });

    // 添加到监控列表
    this.pendingTxs.set(txHash, {
      txResponse,
      onConfirmed,
      onFailed,
      retries: 0,
      addedAt: Date.now(),
    });

    logger.info(`[TransactionMonitor] 开始监控交易: ${txHash}`);

    return txHash;
  }

  /**
   * 监控交易确认
   * @param {string} txHash - 交易哈希
   * @param {function} onConfirmed - 确认回调
   * @param {function} onFailed - 失败回调
   */
  async monitorTx(txHash, onConfirmed, onFailed) {
    const provider = this.adapter.getProvider();

    try {
      // 等待1个确认
      const receipt = await provider.waitForTransaction(txHash, 1);

      if (receipt.status === 1) {
        // 交易成功
        await this.updateTxStatus(txHash, TransactionStatus.CONFIRMED, receipt);
        onConfirmed?.(receipt);
        this.emit('tx:confirmed', { txHash, receipt });
        logger.info(`[TransactionMonitor] 交易确认成功: ${txHash}`);
      } else {
        // 交易失败
        await this.updateTxStatus(txHash, TransactionStatus.FAILED, receipt);
        onFailed?.(receipt);
        this.emit('tx:failed', { txHash, receipt });
        logger.error(`[TransactionMonitor] 交易失败: ${txHash}`);
      }
    } catch (error) {
      // 监控出错
      await this.updateTxStatus(txHash, TransactionStatus.FAILED);
      onFailed?.(error);
      this.emit('tx:failed', { txHash, error });
      logger.error(`[TransactionMonitor] 交易监控出错: ${txHash}`, error);
    }
  }

  /**
   * 保存交易到数据库
   * @param {object} txData - 交易数据
   */
  async saveTx(txData) {
    const db = this.database.db;

    const {
      txHash,
      fromAddress,
      toAddress,
      value,
      status,
      txType,
      localRefId,
    } = txData;

    const id = uuidv4();
    const chainId = this.adapter.currentChainId;
    const createdAt = Date.now();

    const stmt = db.prepare(`
      INSERT INTO blockchain_transactions (
        id, tx_hash, chain_id, from_address, to_address, value,
        status, tx_type, local_ref_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      txHash,
      chainId,
      fromAddress,
      toAddress,
      value,
      status,
      txType,
      localRefId,
      createdAt
    );
  }

  /**
   * 更新交易状态
   * @param {string} txHash - 交易哈希
   * @param {string} status - 新状态
   * @param {object|null} receipt - 交易收据
   */
  async updateTxStatus(txHash, status, receipt = null) {
    const db = this.database.db;

    const updates = {
      status,
      confirmed_at: status === TransactionStatus.CONFIRMED ? Date.now() : null,
      gas_used: receipt?.gasUsed ? receipt.gasUsed.toString() : null,
      gas_price: receipt?.gasPrice ? receipt.gasPrice.toString() : null,
      block_number: receipt?.blockNumber || null,
    };

    const stmt = db.prepare(`
      UPDATE blockchain_transactions
      SET status = ?, confirmed_at = ?, gas_used = ?, gas_price = ?, block_number = ?
      WHERE tx_hash = ?
    `);

    stmt.run(
      updates.status,
      updates.confirmed_at,
      updates.gas_used,
      updates.gas_price,
      updates.block_number,
      txHash
    );

    // 从监控列表移除
    this.pendingTxs.delete(txHash);
  }

  /**
   * 启动监控定时器
   */
  startMonitoring() {
    if (this.monitorTimer) {
      return;
    }

    this.monitorTimer = setInterval(async () => {
      await this.checkPendingTransactions();
    }, this.monitorInterval);

    logger.info('[TransactionMonitor] 启动交易监控定时器');
  }

  /**
   * 停止监控定时器
   */
  stopMonitoring() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
      logger.info('[TransactionMonitor] 停止交易监控定时器');
    }
  }

  /**
   * 检查待处理交易
   */
  async checkPendingTransactions() {
    for (const [txHash, txData] of this.pendingTxs.entries()) {
      try {
        await this.monitorTx(txHash, txData.onConfirmed, txData.onFailed);
      } catch (error) {
        logger.error(`[TransactionMonitor] 检查交易 ${txHash} 失败:`, error);
      }
    }
  }

  /**
   * 恢复未完成的交易监控
   */
  async recoverPendingTransactions() {
    const db = this.database.db;

    const stmt = db.prepare(`
      SELECT * FROM blockchain_transactions
      WHERE status = ?
    `);

    const pendingTxs = stmt.all(TransactionStatus.PENDING);

    for (const tx of pendingTxs) {
      // 重新添加到监控列表
      this.pendingTxs.set(tx.tx_hash, {
        retries: 0,
        addedAt: tx.created_at,
      });
    }

    logger.info(`[TransactionMonitor] 恢复 ${pendingTxs.length} 个待处理交易`);
  }

  /**
   * 获取交易历史
   * @param {object} filters - 过滤条件 {address, chainId, limit, offset}
   * @returns {Promise<array>} 交易列表
   */
  async getTxHistory(filters = {}) {
    const db = this.database.db;
    const { address, chainId, limit = 100, offset = 0 } = filters;

    let query = 'SELECT * FROM blockchain_transactions WHERE 1=1';
    const params = [];

    if (address) {
      query += ' AND (from_address = ? OR to_address = ?)';
      params.push(address, address);
    }

    if (chainId) {
      query += ' AND chain_id = ?';
      params.push(chainId);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * 获取交易详情
   * @param {string} txHash - 交易哈希
   * @returns {Promise<object>} 交易详情
   */
  async getTxDetail(txHash) {
    const db = this.database.db;
    const stmt = db.prepare('SELECT * FROM blockchain_transactions WHERE tx_hash = ?');
    return stmt.get(txHash);
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info('[TransactionMonitor] 清理资源...');

    this.stopMonitoring();
    this.pendingTxs.clear();

    this.initialized = false;
  }
}

module.exports = {
  TransactionMonitor,
  TransactionStatus,
};
