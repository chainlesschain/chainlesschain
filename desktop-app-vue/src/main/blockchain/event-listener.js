/**
 * 区块链事件监听器
 *
 * 负责监听链上事件并同步到本地数据库
 * 支持：
 * - 资产转账事件
 * - 托管合约事件
 * - 订阅合约事件
 * - 悬赏合约事件
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const { ethers } = require('ethers');

class BlockchainEventListener extends EventEmitter {
  constructor(database, blockchainAdapter, assetManager, contractEngine) {
    super();

    this.database = database;
    this.blockchainAdapter = blockchainAdapter;
    this.assetManager = assetManager;
    this.contractEngine = contractEngine;

    // 活跃的监听器映射 (contractAddress => listeners)
    this.activeListeners = new Map();

    // 最后处理的区块号 (chainId => blockNumber)
    this.lastProcessedBlock = new Map();

    this.initialized = false;
  }

  /**
   * 初始化事件监听器
   */
  async initialize() {
    logger.info('[EventListener] 初始化事件监听器...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      // 恢复之前的监听器
      await this.restoreListeners();

      this.initialized = true;
      logger.info('[EventListener] 事件监听器初始化成功');
    } catch (error) {
      logger.error('[EventListener] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 事件监听配置表
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_listeners (
        id TEXT PRIMARY KEY,
        contract_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        event_name TEXT NOT NULL,
        contract_type TEXT NOT NULL,
        abi_json TEXT NOT NULL,
        active BOOLEAN DEFAULT 1,
        last_block INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(contract_address, chain_id, event_name)
      )
    `);

    // 事件处理记录表
    db.exec(`
      CREATE TABLE IF NOT EXISTS processed_events (
        id TEXT PRIMARY KEY,
        contract_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        event_name TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        event_data TEXT NOT NULL,
        processed_at INTEGER NOT NULL,
        UNIQUE(transaction_hash, event_name)
      )
    `);

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_event_listeners_contract ON event_listeners(contract_address, chain_id);
      CREATE INDEX IF NOT EXISTS idx_processed_events_contract ON processed_events(contract_address, chain_id);
      CREATE INDEX IF NOT EXISTS idx_processed_events_tx ON processed_events(transaction_hash);
    `);

    logger.info('[EventListener] 数据库表初始化完成');
  }

  /**
   * 添加事件监听器
   * @param {Object} options - 监听器配置
   */
  async addListener(options) {
    const {
      contractAddress,
      chainId,
      eventName,
      contractType,
      abi,
      handler
    } = options;

    try {
      const db = this.database.db;
      const now = Date.now();
      const listenerId = `${contractAddress}-${chainId}-${eventName}`;

      // 保存监听器配置到数据库
      db.prepare(`
        INSERT OR REPLACE INTO event_listeners
        (id, contract_address, chain_id, event_name, contract_type, abi_json, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        listenerId,
        contractAddress,
        chainId,
        eventName,
        contractType,
        JSON.stringify(abi),
        now
      );

      // 切换到目标链
      await this.blockchainAdapter.switchChain(chainId);

      // 设置事件监听
      await this.blockchainAdapter.listenToEvents(
        contractAddress,
        abi,
        eventName,
        async (eventData) => {
          await this.handleEvent({
            contractAddress,
            chainId,
            eventName,
            contractType,
            eventData,
            handler
          });
        }
      );

      // 记录活跃监听器
      if (!this.activeListeners.has(contractAddress)) {
        this.activeListeners.set(contractAddress, []);
      }
      this.activeListeners.get(contractAddress).push({
        eventName,
        chainId,
        handler
      });

      logger.info(`[EventListener] 已添加监听器: ${listenerId}`);

      return listenerId;
    } catch (error) {
      logger.error('[EventListener] 添加监听器失败:', error);
      throw error;
    }
  }

  /**
   * 处理事件
   * @param {Object} options - 事件信息
   */
  async handleEvent(options) {
    const {
      contractAddress,
      chainId,
      eventName,
      contractType,
      eventData,
      handler
    } = options;

    try {
      const db = this.database.db;
      const now = Date.now();
      const eventId = `${eventData.transactionHash}-${eventName}`;

      // 检查是否已处理
      const existing = db.prepare(
        'SELECT id FROM processed_events WHERE id = ?'
      ).get(eventId);

      if (existing) {
        logger.info(`[EventListener] 事件已处理，跳过: ${eventId}`);
        return;
      }

      logger.info(`[EventListener] 处理事件: ${eventName} @ ${contractAddress}`);

      // 调用自定义处理器
      if (handler) {
        await handler(eventData);
      }

      // 根据合约类型和事件名称执行默认处理
      await this.processEventByType(contractType, eventName, eventData);

      // 记录已处理的事件
      db.prepare(`
        INSERT INTO processed_events
        (id, contract_address, chain_id, event_name, block_number, transaction_hash, event_data, processed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        contractAddress,
        chainId,
        eventName,
        eventData.blockNumber,
        eventData.transactionHash,
        JSON.stringify(eventData.args),
        now
      );

      // 更新最后处理的区块号
      db.prepare(`
        UPDATE event_listeners
        SET last_block = ?
        WHERE contract_address = ? AND chain_id = ? AND event_name = ?
      `).run(eventData.blockNumber, contractAddress, chainId, eventName);

      this.emit('event:processed', {
        contractAddress,
        chainId,
        eventName,
        eventData
      });

      logger.info(`[EventListener] 事件处理完成: ${eventId}`);
    } catch (error) {
      logger.error('[EventListener] 处理事件失败:', error);
      this.emit('event:error', { error, eventData });
    }
  }

  /**
   * 根据合约类型处理事件
   * @param {string} contractType - 合约类型
   * @param {string} eventName - 事件名称
   * @param {Object} eventData - 事件数据
   */
  async processEventByType(contractType, eventName, eventData) {
    switch (contractType) {
      case 'ERC20':
        await this.processERC20Event(eventName, eventData);
        break;

      case 'ERC721':
        await this.processERC721Event(eventName, eventData);
        break;

      case 'Escrow':
        await this.processEscrowEvent(eventName, eventData);
        break;

      case 'Subscription':
        await this.processSubscriptionEvent(eventName, eventData);
        break;

      case 'Bounty':
        await this.processBountyEvent(eventName, eventData);
        break;

      default:
        logger.info(`[EventListener] 未知合约类型: ${contractType}`);
    }
  }

  /**
   * 处理 ERC-20 事件
   */
  async processERC20Event(eventName, eventData) {
    if (eventName === 'Transfer') {
      const [from, to, value] = eventData.args;
      const contractAddress = eventData.log?.address || eventData.address;
      logger.info(`[EventListener] ERC-20 转账: ${from} -> ${to}, 数量: ${value.toString()}`);

      // 同步到本地资产管理器
      if (this.assetManager) {
        try {
          // 查找本地资产映射
          const db = this.database.db;
          const mapping = db.prepare(`
            SELECT local_asset_id FROM blockchain_asset_mapping
            WHERE contract_address = ? AND asset_type = 'token'
          `).get(contractAddress?.toLowerCase());

          if (mapping) {
            const localAssetId = mapping.local_asset_id;

            // 更新发送者余额（如果不是零地址）
            if (from !== ethers.ZeroAddress) {
              const fromBalance = await this.blockchainAdapter.getTokenBalance(
                contractAddress,
                from
              );
              await this.assetManager.updateBalance?.(localAssetId, from, fromBalance);
              logger.info(`[EventListener] 更新发送者余额: ${from} = ${fromBalance}`);
            }

            // 更新接收者余额（如果不是零地址）
            if (to !== ethers.ZeroAddress) {
              const toBalance = await this.blockchainAdapter.getTokenBalance(
                contractAddress,
                to
              );
              await this.assetManager.updateBalance?.(localAssetId, to, toBalance);
              logger.info(`[EventListener] 更新接收者余额: ${to} = ${toBalance}`);
            }

            // 触发事件
            this.emit('token:transfer', {
              contractAddress,
              from,
              to,
              value: value.toString(),
              localAssetId,
              blockNumber: eventData.log?.blockNumber,
              transactionHash: eventData.log?.transactionHash,
            });
          }
        } catch (error) {
          logger.error('[EventListener] ERC-20 余额同步失败:', error);
        }
      }
    }
  }

  /**
   * 处理 ERC-721 事件
   */
  async processERC721Event(eventName, eventData) {
    if (eventName === 'Transfer') {
      const [from, to, tokenId] = eventData.args;
      const contractAddress = eventData.log?.address || eventData.address;
      logger.info(`[EventListener] NFT 转账: ${from} -> ${to}, Token ID: ${tokenId.toString()}`);

      // 同步到本地资产管理器
      if (this.assetManager) {
        try {
          // 查找本地资产映射
          const db = this.database.db;
          const mapping = db.prepare(`
            SELECT local_asset_id FROM blockchain_asset_mapping
            WHERE contract_address = ? AND asset_type = 'nft'
          `).get(contractAddress?.toLowerCase());

          if (mapping) {
            const localAssetId = mapping.local_asset_id;

            // 判断是铸造、转账还是销毁
            const isMint = from === ethers.ZeroAddress;
            const isBurn = to === ethers.ZeroAddress;

            if (isMint) {
              // NFT 铸造：记录新的 NFT
              logger.info(`[EventListener] NFT 铸造: Token ID ${tokenId} -> ${to}`);
              await this.assetManager.recordNFTMint?.({
                assetId: localAssetId,
                tokenId: tokenId.toString(),
                owner: to,
                contractAddress,
                blockNumber: eventData.log?.blockNumber,
                transactionHash: eventData.log?.transactionHash,
              });
            } else if (isBurn) {
              // NFT 销毁：标记 NFT 为已销毁
              logger.info(`[EventListener] NFT 销毁: Token ID ${tokenId} from ${from}`);
              await this.assetManager.recordNFTBurn?.({
                assetId: localAssetId,
                tokenId: tokenId.toString(),
                previousOwner: from,
              });
            } else {
              // NFT 转账：更新所有权
              logger.info(`[EventListener] NFT 所有权变更: Token ID ${tokenId}, ${from} -> ${to}`);
              await this.assetManager.updateNFTOwnership?.({
                assetId: localAssetId,
                tokenId: tokenId.toString(),
                previousOwner: from,
                newOwner: to,
                contractAddress,
                blockNumber: eventData.log?.blockNumber,
                transactionHash: eventData.log?.transactionHash,
              });
            }

            // 触发事件
            this.emit('nft:transfer', {
              contractAddress,
              from,
              to,
              tokenId: tokenId.toString(),
              localAssetId,
              isMint,
              isBurn,
              blockNumber: eventData.log?.blockNumber,
              transactionHash: eventData.log?.transactionHash,
            });
          }
        } catch (error) {
          logger.error('[EventListener] NFT 所有权同步失败:', error);
        }
      }
    }
  }

  /**
   * 处理托管合约事件
   */
  async processEscrowEvent(eventName, eventData) {
    logger.info(`[EventListener] 托管事件: ${eventName}`, eventData.args);

    switch (eventName) {
      case 'EscrowCreated': {
        // 托管创建事件
        const [escrowId, buyer, seller, amount] = eventData.args;
        logger.info(`[EventListener] 托管已创建: ${escrowId}, 买家: ${buyer}, 卖家: ${seller}, 金额: ${amount.toString()}`);
        break;
      }

      case 'EscrowCompleted':
        // 托管完成事件
        logger.info(`[EventListener] 托管已完成`);
        break;

      case 'EscrowRefunded':
        // 托管退款事件
        logger.info(`[EventListener] 托管已退款`);
        break;

      case 'EscrowDisputed':
        // 托管争议事件
        logger.info(`[EventListener] 托管发生争议`);
        break;
    }
  }

  /**
   * 处理订阅合约事件
   */
  async processSubscriptionEvent(eventName, eventData) {
    logger.info(`[EventListener] 订阅事件: ${eventName}`, eventData.args);

    switch (eventName) {
      case 'Subscribed': {
        // 订阅事件
        const [planId, subscriber, endTime] = eventData.args;
        logger.info(`[EventListener] 新订阅: 计划 ${planId}, 订阅者: ${subscriber}, 结束时间: ${endTime.toString()}`);
        break;
      }

      case 'SubscriptionRenewed':
        // 续订事件
        logger.info(`[EventListener] 订阅已续订`);
        break;

      case 'SubscriptionCancelled':
        // 取消订阅事件
        logger.info(`[EventListener] 订阅已取消`);
        break;

      case 'PaymentReceived':
        // 支付事件
        logger.info(`[EventListener] 收到订阅支付`);
        break;
    }
  }

  /**
   * 处理悬赏合约事件
   */
  async processBountyEvent(eventName, eventData) {
    logger.info(`[EventListener] 悬赏事件: ${eventName}`, eventData.args);

    const contractAddress = eventData.log?.address || eventData.address;
    const blockNumber = eventData.log?.blockNumber;
    const transactionHash = eventData.log?.transactionHash;

    switch (eventName) {
      case 'BountyCreated': {
        const [bountyId, creator, amount, deadline] = eventData.args;
        logger.info(`[EventListener] 悬赏创建: ID=${bountyId}, 创建者=${creator}, 金额=${amount.toString()}, 截止=${deadline.toString()}`);

        // 同步到本地数据库
        const db = this.database.db;
        db.prepare(`
          INSERT OR REPLACE INTO blockchain_bounties
          (id, bounty_id, contract_address, creator, amount, deadline, status, created_at, block_number, tx_hash)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `).run(
          `${contractAddress}-${bountyId}`,
          bountyId.toString(),
          contractAddress,
          creator,
          amount.toString(),
          Number(deadline) * 1000, // 转换为毫秒
          Date.now(),
          blockNumber,
          transactionHash
        );

        this.emit('bounty:created', {
          bountyId: bountyId.toString(),
          creator,
          amount: amount.toString(),
          deadline: Number(deadline) * 1000,
          contractAddress,
          transactionHash,
        });
        break;
      }

      case 'SubmissionMade': {
        const [bountyId, submitter, submissionId] = eventData.args;
        logger.info(`[EventListener] 悬赏提交: bountyId=${bountyId}, 提交者=${submitter}, submissionId=${submissionId}`);

        const db = this.database.db;
        db.prepare(`
          INSERT INTO blockchain_bounty_submissions
          (id, bounty_id, submitter, submission_id, status, submitted_at, tx_hash)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)
        `).run(
          `${contractAddress}-${bountyId}-${submissionId}`,
          bountyId.toString(),
          submitter,
          submissionId.toString(),
          Date.now(),
          transactionHash
        );

        this.emit('bounty:submission', {
          bountyId: bountyId.toString(),
          submitter,
          submissionId: submissionId.toString(),
          contractAddress,
          transactionHash,
        });
        break;
      }

      case 'BountyAwarded': {
        const [bountyId, winner, amount] = eventData.args;
        logger.info(`[EventListener] 悬赏发放: bountyId=${bountyId}, 获奖者=${winner}, 金额=${amount.toString()}`);

        const db = this.database.db;
        db.prepare(`
          UPDATE blockchain_bounties
          SET status = 'completed', winner = ?, awarded_amount = ?, completed_at = ?
          WHERE bounty_id = ? AND contract_address = ?
        `).run(winner, amount.toString(), Date.now(), bountyId.toString(), contractAddress);

        this.emit('bounty:awarded', {
          bountyId: bountyId.toString(),
          winner,
          amount: amount.toString(),
          contractAddress,
          transactionHash,
        });
        break;
      }

      case 'BountyCancelled': {
        const [bountyId, creator] = eventData.args;
        logger.info(`[EventListener] 悬赏取消: bountyId=${bountyId}, 创建者=${creator}`);

        const db = this.database.db;
        db.prepare(`
          UPDATE blockchain_bounties
          SET status = 'cancelled', cancelled_at = ?
          WHERE bounty_id = ? AND contract_address = ?
        `).run(Date.now(), bountyId.toString(), contractAddress);

        this.emit('bounty:cancelled', {
          bountyId: bountyId.toString(),
          creator,
          contractAddress,
          transactionHash,
        });
        break;
      }

      case 'BountyExpired': {
        const [bountyId] = eventData.args;
        logger.info(`[EventListener] 悬赏过期: bountyId=${bountyId}`);

        const db = this.database.db;
        db.prepare(`
          UPDATE blockchain_bounties
          SET status = 'expired', expired_at = ?
          WHERE bounty_id = ? AND contract_address = ?
        `).run(Date.now(), bountyId.toString(), contractAddress);

        this.emit('bounty:expired', {
          bountyId: bountyId.toString(),
          contractAddress,
          transactionHash,
        });
        break;
      }

      default:
        logger.info(`[EventListener] 未处理的悬赏事件: ${eventName}`);
    }
  }

  /**
   * 移除事件监听器
   * @param {string} contractAddress - 合约地址
   * @param {number} chainId - 链 ID
   * @param {string} eventName - 事件名称
   */
  async removeListener(contractAddress, chainId, eventName) {
    try {
      const db = this.database.db;
      const listenerId = `${contractAddress}-${chainId}-${eventName}`;

      // 从数据库中标记为不活跃
      db.prepare(`
        UPDATE event_listeners
        SET active = 0
        WHERE id = ?
      `).run(listenerId);

      // 停止区块链监听
      const listener = db.prepare(
        'SELECT abi_json FROM event_listeners WHERE id = ?'
      ).get(listenerId);

      if (listener) {
        const abi = JSON.parse(listener.abi_json);
        await this.blockchainAdapter.switchChain(chainId);
        await this.blockchainAdapter.stopListening(contractAddress, abi, eventName);
      }

      // 从活跃监听器中移除
      if (this.activeListeners.has(contractAddress)) {
        const listeners = this.activeListeners.get(contractAddress);
        const index = listeners.findIndex(l => l.eventName === eventName && l.chainId === chainId);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }

      logger.info(`[EventListener] 已移除监听器: ${listenerId}`);
    } catch (error) {
      logger.error('[EventListener] 移除监听器失败:', error);
      throw error;
    }
  }

  /**
   * 恢复之前的监听器
   */
  async restoreListeners() {
    try {
      const db = this.database.db;

      const listeners = db.prepare(
        'SELECT * FROM event_listeners WHERE active = 1'
      ).all();

      logger.info(`[EventListener] 恢复 ${listeners.length} 个监听器...`);

      for (const listener of listeners) {
        try {
          const abi = JSON.parse(listener.abi_json);

          await this.addListener({
            contractAddress: listener.contract_address,
            chainId: listener.chain_id,
            eventName: listener.event_name,
            contractType: listener.contract_type,
            abi
          });

          logger.info(`[EventListener] 已恢复监听器: ${listener.id}`);
        } catch (error) {
          logger.error(`[EventListener] 恢复监听器失败: ${listener.id}`, error);
        }
      }
    } catch (error) {
      logger.error('[EventListener] 恢复监听器失败:', error);
    }
  }

  /**
   * 获取已处理的事件
   * @param {Object} filters - 筛选条件
   */
  async getProcessedEvents(filters = {}) {
    try {
      const db = this.database.db;

      let query = 'SELECT * FROM processed_events WHERE 1=1';
      const params = [];

      if (filters.contractAddress) {
        query += ' AND contract_address = ?';
        params.push(filters.contractAddress);
      }

      if (filters.chainId) {
        query += ' AND chain_id = ?';
        params.push(filters.chainId);
      }

      if (filters.eventName) {
        query += ' AND event_name = ?';
        params.push(filters.eventName);
      }

      query += ' ORDER BY processed_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      const events = db.prepare(query).all(...params);

      return events.map(e => ({
        ...e,
        event_data: JSON.parse(e.event_data)
      }));
    } catch (error) {
      logger.error('[EventListener] 获取已处理事件失败:', error);
      throw error;
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info('[EventListener] 清理资源...');

    // 停止所有监听器
    for (const [contractAddress, listeners] of this.activeListeners.entries()) {
      for (const listener of listeners) {
        try {
          await this.removeListener(contractAddress, listener.chainId, listener.eventName);
        } catch (error) {
          logger.error('[EventListener] 停止监听器失败:', error);
        }
      }
    }

    this.activeListeners.clear();
    this.lastProcessedBlock.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = BlockchainEventListener;
