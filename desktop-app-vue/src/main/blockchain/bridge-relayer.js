/**
 * Bridge Relayer System
 *
 * Automated relayer for cross-chain bridge operations:
 * - Monitors lock events on source chains
 * - Automatically submits mint transactions on destination chains
 * - Verifies transaction proofs
 * - Handles retries and error recovery
 * - Provides relayer incentives tracking
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { ethers } = require("ethers");

/**
 * Relayer configuration
 */
const RELAYER_CONFIG = {
  // Monitoring
  POLL_INTERVAL: 12000, // 12 seconds
  CONFIRMATION_BLOCKS: 12, // Wait for 12 confirmations
  MAX_BLOCKS_TO_SCAN: 1000,

  // Retry logic
  MAX_RETRIES: 3,
  RETRY_DELAY: 5000, // 5 seconds
  EXPONENTIAL_BACKOFF: true,

  // Gas optimization
  GAS_PRICE_MULTIPLIER: 1.1, // 10% above current gas price
  MAX_GAS_PRICE: ethers.parseUnits("500", "gwei"),

  // Relayer rewards
  BASE_FEE_PERCENTAGE: 0.1, // 0.1% of transfer amount
  MIN_FEE: ethers.parseEther("0.001"),
};

/**
 * Bridge Relayer
 */
class BridgeRelayer extends EventEmitter {
  constructor(blockchainAdapter, bridgeManager, database) {
    super();

    this.adapter = blockchainAdapter;
    this.bridgeManager = bridgeManager;
    this.database = database;

    this.initialized = false;
    this.isRunning = false;

    // Monitoring state
    this.lastProcessedBlocks = new Map(); // chainId -> blockNumber
    this.pendingRelays = new Map(); // requestId -> relayData
    this.processingQueue = [];

    // Statistics
    this.stats = {
      totalRelayed: 0,
      successfulRelays: 0,
      failedRelays: 0,
      totalFeesEarned: BigInt(0),
      averageRelayTime: 0,
    };
  }

  /**
   * Initialize relayer
   */
  async initialize() {
    if (this.initialized) {
      logger.info("[BridgeRelayer] Already initialized");
      return;
    }

    try {
      await this.initializeTables();
      await this.loadLastProcessedBlocks();
      await this.loadPendingRelays();

      this.initialized = true;
      logger.info("[BridgeRelayer] Initialized successfully");
    } catch (error) {
      logger.error("[BridgeRelayer] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    // Relay tasks table
    db.exec(`
      CREATE TABLE IF NOT EXISTS bridge_relay_tasks (
        request_id TEXT PRIMARY KEY,
        source_chain_id INTEGER NOT NULL,
        dest_chain_id INTEGER NOT NULL,
        source_tx_hash TEXT NOT NULL,
        dest_tx_hash TEXT,
        asset_address TEXT NOT NULL,
        recipient TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        relayer_fee TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        error_message TEXT
      )
    `);

    // Relayer statistics table
    db.exec(`
      CREATE TABLE IF NOT EXISTS bridge_relayer_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        total_relayed INTEGER DEFAULT 0,
        successful INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        fees_earned TEXT DEFAULT '0',
        average_time INTEGER DEFAULT 0
      )
    `);

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_relay_tasks_status ON bridge_relay_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_relay_tasks_chains ON bridge_relay_tasks(source_chain_id, dest_chain_id);
      CREATE INDEX IF NOT EXISTS idx_relayer_stats_date ON bridge_relayer_stats(date);
    `);

    logger.info("[BridgeRelayer] Database tables initialized");
  }

  /**
   * Load last processed blocks
   */
  async loadLastProcessedBlocks() {
    try {
      const db = this.database.db;
      const chains = this.adapter.getSupportedChains();

      for (const chain of chains) {
        if (!chain.isConnected) {
          continue;
        }

        // Get latest processed block from database
        const result = db
          .prepare(
            `
          SELECT MAX(block_number) as last_block
          FROM bridge_relay_tasks
          WHERE source_chain_id = ?
        `,
          )
          .get(chain.chainId);

        if (result && result.last_block) {
          this.lastProcessedBlocks.set(chain.chainId, result.last_block);
        } else {
          // Start from current block
          const provider = this.adapter.getProvider();
          await this.adapter.switchChain(chain.chainId);
          const currentBlock = await provider.getBlockNumber();
          this.lastProcessedBlocks.set(chain.chainId, currentBlock);
        }
      }

      logger.info("[BridgeRelayer] Last processed blocks loaded");
    } catch (error) {
      logger.error(
        "[BridgeRelayer] Failed to load last processed blocks:",
        error,
      );
    }
  }

  /**
   * Load pending relays
   */
  async loadPendingRelays() {
    try {
      const db = this.database.db;
      const pending = db
        .prepare(
          `
        SELECT * FROM bridge_relay_tasks
        WHERE status IN ('pending', 'processing')
        ORDER BY created_at ASC
      `,
        )
        .all();

      for (const task of pending) {
        this.pendingRelays.set(task.request_id, {
          ...task,
          amount: BigInt(task.amount),
          relayerFee: task.relayer_fee ? BigInt(task.relayer_fee) : BigInt(0),
        });
      }

      logger.info(`[BridgeRelayer] Loaded ${pending.length} pending relays`);
    } catch (error) {
      logger.error("[BridgeRelayer] Failed to load pending relays:", error);
    }
  }

  /**
   * Start relayer
   */
  async start() {
    if (this.isRunning) {
      logger.info("[BridgeRelayer] Already running");
      return;
    }

    if (!this.initialized) {
      await this.initialize();
    }

    this.isRunning = true;
    logger.info("[BridgeRelayer] Starting relayer...");

    // Start monitoring loop
    this.monitoringLoop();

    // Start processing loop
    this.processingLoop();

    this.emit("relayer-started");
  }

  /**
   * Stop relayer
   */
  async stop() {
    this.isRunning = false;
    logger.info("[BridgeRelayer] Stopping relayer...");

    this.emit("relayer-stopped");
  }

  /**
   * Monitoring loop - scan for new lock events
   */
  async monitoringLoop() {
    while (this.isRunning) {
      try {
        await this.scanForLockEvents();
      } catch (error) {
        logger.error("[BridgeRelayer] Monitoring error:", error);
      }

      // Wait before next scan
      await new Promise((resolve) =>
        setTimeout(resolve, RELAYER_CONFIG.POLL_INTERVAL),
      );
    }
  }

  /**
   * Processing loop - process pending relays
   */
  async processingLoop() {
    while (this.isRunning) {
      try {
        if (this.processingQueue.length > 0) {
          const requestId = this.processingQueue.shift();
          await this.processRelay(requestId);
        }
      } catch (error) {
        logger.error("[BridgeRelayer] Processing error:", error);
      }

      // Wait before next process
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Scan for lock events on all chains
   */
  async scanForLockEvents() {
    const chains = this.adapter.getSupportedChains();

    for (const chain of chains) {
      if (!chain.isConnected) {
        continue;
      }

      try {
        await this.scanChainForLockEvents(chain.chainId);
      } catch (error) {
        logger.error(
          `[BridgeRelayer] Error scanning chain ${chain.chainId}:`,
          error,
        );
      }
    }
  }

  /**
   * Scan specific chain for lock events
   */
  async scanChainForLockEvents(chainId) {
    const bridgeContract = this.bridgeManager.bridgeContracts.get(chainId);
    if (!bridgeContract) {
      return; // No bridge contract on this chain
    }

    // Switch to chain
    await this.adapter.switchChain(chainId);
    const provider = this.adapter.getProvider();

    // Get current block
    const currentBlock = await provider.getBlockNumber();
    const lastProcessed =
      this.lastProcessedBlocks.get(chainId) || currentBlock - 100;

    // Calculate scan range
    const fromBlock = lastProcessed + 1;
    const toBlock = Math.min(
      fromBlock + RELAYER_CONFIG.MAX_BLOCKS_TO_SCAN,
      currentBlock - RELAYER_CONFIG.CONFIRMATION_BLOCKS,
    );

    if (fromBlock > toBlock) {
      return; // Nothing to scan
    }

    logger.info(
      `[BridgeRelayer] Scanning chain ${chainId} blocks ${fromBlock} to ${toBlock}`,
    );

    // Get bridge contract instance
    const contract = new ethers.Contract(
      bridgeContract,
      this.bridgeManager.bridgeABI,
      provider,
    );

    // Query AssetLocked events
    const filter = contract.filters.AssetLocked();
    const events = await contract.queryFilter(filter, fromBlock, toBlock);

    logger.info(
      `[BridgeRelayer] Found ${events.length} lock events on chain ${chainId}`,
    );

    // Process each event
    for (const event of events) {
      await this.handleLockEvent(event, chainId);
    }

    // Update last processed block
    this.lastProcessedBlocks.set(chainId, toBlock);
  }

  /**
   * Handle lock event
   */
  async handleLockEvent(event, sourceChainId) {
    try {
      const { requestId, sender, asset, amount, targetChainId } = event.args;

      logger.info("[BridgeRelayer] Processing lock event:", {
        requestId,
        sender,
        asset,
        amount: amount.toString(),
        targetChainId: targetChainId.toString(),
      });

      // Check if already processed
      if (this.pendingRelays.has(requestId)) {
        logger.info(
          "[BridgeRelayer] Request already being processed:",
          requestId,
        );
        return;
      }

      // Calculate relayer fee
      const relayerFee = this.calculateRelayerFee(amount);

      // Create relay task
      const relayTask = {
        request_id: requestId,
        source_chain_id: sourceChainId,
        dest_chain_id: Number(targetChainId),
        source_tx_hash: event.transactionHash,
        asset_address: asset,
        recipient: sender,
        amount: amount.toString(),
        status: "pending",
        retry_count: 0,
        relayer_fee: relayerFee.toString(),
        created_at: Date.now(),
      };

      // Save to database
      await this.saveRelayTask(relayTask);

      // Add to pending relays
      this.pendingRelays.set(requestId, {
        ...relayTask,
        amount: BigInt(relayTask.amount),
        relayerFee: BigInt(relayTask.relayer_fee),
      });

      // Add to processing queue
      this.processingQueue.push(requestId);

      this.emit("lock-detected", relayTask);
    } catch (error) {
      logger.error("[BridgeRelayer] Error handling lock event:", error);
    }
  }

  /**
   * Process relay task
   */
  async processRelay(requestId) {
    const relayTask = this.pendingRelays.get(requestId);
    if (!relayTask) {
      logger.warn("[BridgeRelayer] Relay task not found:", requestId);
      return;
    }

    logger.info("[BridgeRelayer] Processing relay:", requestId);

    const startTime = Date.now();

    try {
      // Update status to processing
      await this.updateRelayTask(requestId, { status: "processing" });

      // Verify source transaction
      const verified = await this.verifySourceTransaction(relayTask);
      if (!verified) {
        throw new Error("Source transaction verification failed");
      }

      // Submit mint transaction on destination chain
      const destTxHash = await this.submitMintTransaction(relayTask);

      // Wait for confirmation
      await this.waitForConfirmation(relayTask.dest_chain_id, destTxHash);

      // Update task as completed
      const completedAt = Date.now();
      const relayTime = completedAt - startTime;

      await this.updateRelayTask(requestId, {
        status: "completed",
        dest_tx_hash: destTxHash,
        completed_at: completedAt,
      });

      // Update statistics
      this.stats.totalRelayed++;
      this.stats.successfulRelays++;
      this.stats.totalFeesEarned += relayTask.relayerFee;
      this.stats.averageRelayTime =
        (this.stats.averageRelayTime * (this.stats.successfulRelays - 1) +
          relayTime) /
        this.stats.successfulRelays;

      // Remove from pending
      this.pendingRelays.delete(requestId);

      this.emit("relay-completed", {
        requestId,
        destTxHash,
        relayTime,
        fee: relayTask.relayerFee.toString(),
      });

      logger.info(
        `[BridgeRelayer] Relay completed: ${requestId} in ${relayTime}ms`,
      );
    } catch (error) {
      logger.error("[BridgeRelayer] Relay failed:", error);

      // Handle retry
      const retryCount = relayTask.retry_count + 1;

      if (retryCount < RELAYER_CONFIG.MAX_RETRIES) {
        // Retry
        await this.updateRelayTask(requestId, {
          status: "pending",
          retry_count: retryCount,
          error_message: error.message,
        });

        // Add back to queue with delay
        const delay = RELAYER_CONFIG.EXPONENTIAL_BACKOFF
          ? RELAYER_CONFIG.RETRY_DELAY * Math.pow(2, retryCount)
          : RELAYER_CONFIG.RETRY_DELAY;

        setTimeout(() => {
          this.processingQueue.push(requestId);
        }, delay);

        logger.info(
          `[BridgeRelayer] Retry scheduled (${retryCount}/${RELAYER_CONFIG.MAX_RETRIES})`,
        );
      } else {
        // Max retries reached, mark as failed
        await this.updateRelayTask(requestId, {
          status: "failed",
          error_message: error.message,
        });

        this.stats.totalRelayed++;
        this.stats.failedRelays++;

        this.pendingRelays.delete(requestId);

        this.emit("relay-failed", {
          requestId,
          error: error.message,
        });
      }
    }
  }

  /**
   * Verify source transaction
   */
  async verifySourceTransaction(relayTask) {
    try {
      await this.adapter.switchChain(relayTask.source_chain_id);
      const provider = this.adapter.getProvider();

      // Get transaction receipt
      const receipt = await provider.getTransactionReceipt(
        relayTask.source_tx_hash,
      );

      if (!receipt) {
        logger.error("[BridgeRelayer] Transaction receipt not found");
        return false;
      }

      // Check if transaction succeeded
      if (receipt.status !== 1) {
        logger.error("[BridgeRelayer] Source transaction failed");
        return false;
      }

      // Verify confirmations
      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;

      if (confirmations < RELAYER_CONFIG.CONFIRMATION_BLOCKS) {
        logger.info(
          `[BridgeRelayer] Waiting for confirmations: ${confirmations}/${RELAYER_CONFIG.CONFIRMATION_BLOCKS}`,
        );
        return false;
      }

      logger.info("[BridgeRelayer] Source transaction verified");
      return true;
    } catch (error) {
      logger.error("[BridgeRelayer] Verification error:", error);
      return false;
    }
  }

  /**
   * Submit mint transaction on destination chain
   */
  async submitMintTransaction(relayTask) {
    logger.info("[BridgeRelayer] Submitting mint transaction...");

    // Switch to destination chain
    await this.adapter.switchChain(relayTask.dest_chain_id);

    // Get bridge contract
    const bridgeContract = this.bridgeManager.bridgeContracts.get(
      relayTask.dest_chain_id,
    );
    if (!bridgeContract) {
      throw new Error(
        `Bridge contract not found on chain ${relayTask.dest_chain_id}`,
      );
    }

    // Get relayer wallet (should be configured)
    // For now, use the first available wallet
    const wallets = await this.adapter.walletManager.listWallets();
    if (wallets.length === 0) {
      throw new Error("No wallet available for relaying");
    }

    const relayerWallet = wallets[0];
    const wallet = await this.adapter.walletManager.unlockWallet(
      relayerWallet.id,
      process.env.RELAYER_PASSWORD || "",
    );

    const provider = this.adapter.getProvider();
    const signer = wallet.connect(provider);

    // Create contract instance
    const contract = new ethers.Contract(
      bridgeContract,
      this.bridgeManager.bridgeABI,
      signer,
    );

    // Get optimized gas price
    const gasPrice = await this.getOptimizedGasPrice();

    // Submit mint transaction
    const tx = await contract.mintAsset(
      relayTask.request_id,
      relayTask.recipient,
      relayTask.asset_address,
      relayTask.amount,
      relayTask.source_chain_id,
      {
        gasPrice,
        gasLimit: 300000,
      },
    );

    logger.info("[BridgeRelayer] Mint transaction submitted:", tx.hash);

    return tx.hash;
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(chainId, txHash) {
    await this.adapter.switchChain(chainId);
    const provider = this.adapter.getProvider();

    const receipt = await provider.waitForTransaction(
      txHash,
      RELAYER_CONFIG.CONFIRMATION_BLOCKS,
    );

    if (receipt.status !== 1) {
      throw new Error("Mint transaction failed");
    }

    logger.info("[BridgeRelayer] Transaction confirmed");
  }

  /**
   * Calculate relayer fee
   */
  calculateRelayerFee(amount) {
    const feeAmount =
      (BigInt(amount) *
        BigInt(Math.floor(RELAYER_CONFIG.BASE_FEE_PERCENTAGE * 1000))) /
      BigInt(1000);
    return feeAmount > RELAYER_CONFIG.MIN_FEE
      ? feeAmount
      : RELAYER_CONFIG.MIN_FEE;
  }

  /**
   * Get optimized gas price
   */
  async getOptimizedGasPrice() {
    const provider = this.adapter.getProvider();
    const feeData = await provider.getFeeData();

    let gasPrice = feeData.gasPrice;

    // Apply multiplier
    gasPrice =
      (gasPrice *
        BigInt(Math.floor(RELAYER_CONFIG.GAS_PRICE_MULTIPLIER * 100))) /
      BigInt(100);

    // Cap at max gas price
    if (gasPrice > RELAYER_CONFIG.MAX_GAS_PRICE) {
      gasPrice = RELAYER_CONFIG.MAX_GAS_PRICE;
    }

    return gasPrice;
  }

  /**
   * Save relay task to database
   */
  async saveRelayTask(task) {
    const db = this.database.db;

    db.prepare(
      `
      INSERT INTO bridge_relay_tasks (
        request_id, source_chain_id, dest_chain_id, source_tx_hash,
        asset_address, recipient, amount, status, retry_count,
        relayer_fee, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      task.request_id,
      task.source_chain_id,
      task.dest_chain_id,
      task.source_tx_hash,
      task.asset_address,
      task.recipient,
      task.amount,
      task.status,
      task.retry_count,
      task.relayer_fee,
      task.created_at,
    );
  }

  /**
   * Update relay task
   */
  async updateRelayTask(requestId, updates) {
    const db = this.database.db;

    const fields = Object.keys(updates)
      .map((key) => `${key} = ?`)
      .join(", ");
    const values = Object.values(updates);

    db.prepare(
      `
      UPDATE bridge_relay_tasks
      SET ${fields}
      WHERE request_id = ?
    `,
    ).run(...values, requestId);

    // Update in-memory task
    const task = this.pendingRelays.get(requestId);
    if (task) {
      Object.assign(task, updates);
    }
  }

  /**
   * Get relayer statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      totalFeesEarned: this.stats.totalFeesEarned.toString(),
      pendingRelays: this.pendingRelays.size,
      queueLength: this.processingQueue.length,
    };
  }

  /**
   * Get relay history
   */
  async getRelayHistory(filters = {}) {
    const db = this.database.db;

    let query = "SELECT * FROM bridge_relay_tasks WHERE 1=1";
    const params = [];

    if (filters.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }

    if (filters.sourceChainId) {
      query += " AND source_chain_id = ?";
      params.push(filters.sourceChainId);
    }

    if (filters.destChainId) {
      query += " AND dest_chain_id = ?";
      params.push(filters.destChainId);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(filters.limit || 100);

    return db.prepare(query).all(...params);
  }

  /**
   * Close relayer
   */
  async close() {
    await this.stop();
    this.removeAllListeners();
    this.initialized = false;

    logger.info("[BridgeRelayer] Closed");
  }
}

module.exports = BridgeRelayer;
