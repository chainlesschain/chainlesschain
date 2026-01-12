/**
 * Bridge Security Manager
 *
 * Production-grade security features for cross-chain bridge:
 * - Multi-signature verification
 * - Rate limiting
 * - Transaction monitoring
 * - Fraud detection
 * - Emergency pause mechanism
 */

const EventEmitter = require('events');
const { ethers } = require('ethers');

/**
 * Security configuration
 */
const SECURITY_CONFIG = {
  // Rate limiting
  MAX_TRANSFERS_PER_HOUR: 10,
  MAX_AMOUNT_PER_TRANSFER: ethers.parseEther('1000'), // 1000 tokens
  MAX_DAILY_VOLUME: ethers.parseEther('10000'), // 10000 tokens per day

  // Multi-sig requirements
  MIN_SIGNATURES_REQUIRED: 2,
  SIGNATURE_TIMEOUT: 300000, // 5 minutes

  // Monitoring
  SUSPICIOUS_AMOUNT_THRESHOLD: ethers.parseEther('100'),
  RAPID_TRANSFER_WINDOW: 60000, // 1 minute
  MAX_RAPID_TRANSFERS: 3,

  // Emergency
  PAUSE_DURATION: 3600000, // 1 hour
};

/**
 * Bridge Security Manager
 */
class BridgeSecurityManager extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.initialized = false;

    // Rate limiting tracking
    this.transferHistory = new Map(); // address -> transfers[]
    this.dailyVolume = new Map(); // address -> {date, volume}

    // Multi-sig pending transactions
    this.pendingMultiSig = new Map(); // txId -> {signatures, data, timestamp}

    // Emergency pause state
    this.isPaused = false;
    this.pausedUntil = null;

    // Blacklist
    this.blacklistedAddresses = new Set();
  }

  /**
   * Initialize security manager
   */
  async initialize() {
    if (this.initialized) {
      console.log('[BridgeSecurity] Already initialized');
      return;
    }

    try {
      await this.initializeTables();
      await this.loadBlacklist();

      // Start cleanup interval
      this.startCleanupInterval();

      this.initialized = true;
      console.log('[BridgeSecurity] Initialized successfully');
    } catch (error) {
      console.error('[BridgeSecurity] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    // Security events table
    db.exec(`
      CREATE TABLE IF NOT EXISTS bridge_security_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        address TEXT,
        amount TEXT,
        chain_id INTEGER,
        details TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Blacklist table
    db.exec(`
      CREATE TABLE IF NOT EXISTS bridge_blacklist (
        address TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        added_by TEXT
      )
    `);

    // Multi-sig transactions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS bridge_multisig_txs (
        tx_id TEXT PRIMARY KEY,
        tx_data TEXT NOT NULL,
        required_signatures INTEGER NOT NULL,
        signatures TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    console.log('[BridgeSecurity] Database tables initialized');
  }

  /**
   * Load blacklist from database
   */
  async loadBlacklist() {
    try {
      const db = this.database.db;
      const blacklisted = db.prepare('SELECT address FROM bridge_blacklist').all();

      this.blacklistedAddresses.clear();
      blacklisted.forEach(row => {
        this.blacklistedAddresses.add(row.address.toLowerCase());
      });

      console.log(`[BridgeSecurity] Loaded ${this.blacklistedAddresses.size} blacklisted addresses`);
    } catch (error) {
      console.error('[BridgeSecurity] Failed to load blacklist:', error);
    }
  }

  /**
   * Validate bridge transfer
   * @param {Object} transfer - Transfer details
   * @returns {Object} Validation result
   */
  async validateTransfer(transfer) {
    const { fromAddress, toAddress, amount, chainId } = transfer;

    console.log('[BridgeSecurity] Validating transfer:', {
      from: fromAddress,
      to: toAddress,
      amount: amount.toString(),
      chainId
    });

    // Check if paused
    if (this.isPaused) {
      const remaining = this.pausedUntil - Date.now();
      return {
        valid: false,
        reason: 'BRIDGE_PAUSED',
        message: `Bridge is paused for ${Math.ceil(remaining / 60000)} more minutes`,
        severity: 'critical'
      };
    }

    // Check blacklist
    if (this.isBlacklisted(fromAddress) || this.isBlacklisted(toAddress)) {
      await this.logSecurityEvent({
        type: 'BLACKLIST_ATTEMPT',
        severity: 'critical',
        address: fromAddress,
        amount: amount.toString(),
        chainId,
        details: 'Attempted transfer from/to blacklisted address'
      });

      return {
        valid: false,
        reason: 'BLACKLISTED',
        message: 'Address is blacklisted',
        severity: 'critical'
      };
    }

    // Check rate limiting
    const rateLimitCheck = this.checkRateLimit(fromAddress, amount);
    if (!rateLimitCheck.valid) {
      await this.logSecurityEvent({
        type: 'RATE_LIMIT_EXCEEDED',
        severity: 'high',
        address: fromAddress,
        amount: amount.toString(),
        chainId,
        details: rateLimitCheck.message
      });

      return rateLimitCheck;
    }

    // Check daily volume
    const volumeCheck = this.checkDailyVolume(fromAddress, amount);
    if (!volumeCheck.valid) {
      await this.logSecurityEvent({
        type: 'VOLUME_LIMIT_EXCEEDED',
        severity: 'high',
        address: fromAddress,
        amount: amount.toString(),
        chainId,
        details: volumeCheck.message
      });

      return volumeCheck;
    }

    // Check for suspicious patterns
    const suspiciousCheck = this.checkSuspiciousActivity(fromAddress, amount);
    if (suspiciousCheck.suspicious) {
      await this.logSecurityEvent({
        type: 'SUSPICIOUS_ACTIVITY',
        severity: 'medium',
        address: fromAddress,
        amount: amount.toString(),
        chainId,
        details: suspiciousCheck.reason
      });

      // Don't block, but flag for review
      this.emit('suspicious-activity', {
        address: fromAddress,
        amount: amount.toString(),
        reason: suspiciousCheck.reason
      });
    }

    // Record transfer
    this.recordTransfer(fromAddress, amount);

    return {
      valid: true,
      requiresMultiSig: amount >= SECURITY_CONFIG.SUSPICIOUS_AMOUNT_THRESHOLD,
      message: 'Transfer validated successfully'
    };
  }

  /**
   * Check rate limiting
   */
  checkRateLimit(address, amount) {
    const now = Date.now();
    const history = this.transferHistory.get(address.toLowerCase()) || [];

    // Remove old transfers (older than 1 hour)
    const recentTransfers = history.filter(t => now - t.timestamp < 3600000);

    if (recentTransfers.length >= SECURITY_CONFIG.MAX_TRANSFERS_PER_HOUR) {
      return {
        valid: false,
        reason: 'RATE_LIMIT',
        message: `Maximum ${SECURITY_CONFIG.MAX_TRANSFERS_PER_HOUR} transfers per hour exceeded`,
        severity: 'high'
      };
    }

    // Check single transfer amount
    if (amount > SECURITY_CONFIG.MAX_AMOUNT_PER_TRANSFER) {
      return {
        valid: false,
        reason: 'AMOUNT_LIMIT',
        message: `Transfer amount exceeds maximum of ${ethers.formatEther(SECURITY_CONFIG.MAX_AMOUNT_PER_TRANSFER)} tokens`,
        severity: 'high'
      };
    }

    return { valid: true };
  }

  /**
   * Check daily volume limit
   */
  checkDailyVolume(address, amount) {
    const today = new Date().toDateString();
    const volumeData = this.dailyVolume.get(address.toLowerCase());

    let currentVolume = BigInt(0);
    if (volumeData && volumeData.date === today) {
      currentVolume = BigInt(volumeData.volume);
    }

    const newVolume = currentVolume + BigInt(amount.toString());

    if (newVolume > SECURITY_CONFIG.MAX_DAILY_VOLUME) {
      return {
        valid: false,
        reason: 'DAILY_VOLUME_LIMIT',
        message: `Daily volume limit of ${ethers.formatEther(SECURITY_CONFIG.MAX_DAILY_VOLUME)} tokens exceeded`,
        severity: 'high'
      };
    }

    return { valid: true };
  }

  /**
   * Check for suspicious activity patterns
   */
  checkSuspiciousActivity(address, amount) {
    const now = Date.now();
    const history = this.transferHistory.get(address.toLowerCase()) || [];

    // Check for rapid transfers
    const rapidTransfers = history.filter(
      t => now - t.timestamp < SECURITY_CONFIG.RAPID_TRANSFER_WINDOW
    );

    if (rapidTransfers.length >= SECURITY_CONFIG.MAX_RAPID_TRANSFERS) {
      return {
        suspicious: true,
        reason: 'Rapid successive transfers detected'
      };
    }

    // Check for large amount
    if (amount >= SECURITY_CONFIG.SUSPICIOUS_AMOUNT_THRESHOLD) {
      return {
        suspicious: true,
        reason: 'Large transfer amount'
      };
    }

    return { suspicious: false };
  }

  /**
   * Record transfer for rate limiting
   */
  recordTransfer(address, amount) {
    const now = Date.now();
    const today = new Date().toDateString();
    const addr = address.toLowerCase();

    // Update transfer history
    const history = this.transferHistory.get(addr) || [];
    history.push({ timestamp: now, amount: amount.toString() });
    this.transferHistory.set(addr, history);

    // Update daily volume
    const volumeData = this.dailyVolume.get(addr);
    if (volumeData && volumeData.date === today) {
      volumeData.volume = (BigInt(volumeData.volume) + BigInt(amount.toString())).toString();
    } else {
      this.dailyVolume.set(addr, {
        date: today,
        volume: amount.toString()
      });
    }
  }

  /**
   * Create multi-signature transaction
   */
  async createMultiSigTransaction(txData) {
    const txId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256', 'uint256'],
        [txData.from, txData.to, txData.amount, Date.now()]
      )
    );

    const multiSigTx = {
      txId,
      txData: JSON.stringify(txData),
      requiredSignatures: SECURITY_CONFIG.MIN_SIGNATURES_REQUIRED,
      signatures: [],
      status: 'pending',
      createdAt: Date.now()
    };

    // Save to database
    const db = this.database.db;
    db.prepare(`
      INSERT INTO bridge_multisig_txs
      (tx_id, tx_data, required_signatures, signatures, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      multiSigTx.txId,
      multiSigTx.txData,
      multiSigTx.requiredSignatures,
      JSON.stringify(multiSigTx.signatures),
      multiSigTx.status,
      multiSigTx.createdAt
    );

    // Store in memory
    this.pendingMultiSig.set(txId, multiSigTx);

    console.log('[BridgeSecurity] Multi-sig transaction created:', txId);

    return { txId, requiredSignatures: multiSigTx.requiredSignatures };
  }

  /**
   * Add signature to multi-sig transaction
   */
  async addSignature(txId, signature, signer) {
    const multiSigTx = this.pendingMultiSig.get(txId);

    if (!multiSigTx) {
      throw new Error('Multi-sig transaction not found');
    }

    if (multiSigTx.status !== 'pending') {
      throw new Error('Transaction is not pending');
    }

    // Check timeout
    if (Date.now() - multiSigTx.createdAt > SECURITY_CONFIG.SIGNATURE_TIMEOUT) {
      multiSigTx.status = 'expired';
      throw new Error('Signature timeout expired');
    }

    // Verify signature
    const txData = JSON.parse(multiSigTx.txData);
    const message = ethers.solidityPackedKeccak256(
      ['address', 'address', 'uint256'],
      [txData.from, txData.to, txData.amount]
    );

    const recoveredAddress = ethers.verifyMessage(
      ethers.getBytes(message),
      signature
    );

    if (recoveredAddress.toLowerCase() !== signer.toLowerCase()) {
      throw new Error('Invalid signature');
    }

    // Add signature
    multiSigTx.signatures.push({ signer, signature, timestamp: Date.now() });

    // Update database
    const db = this.database.db;
    db.prepare(`
      UPDATE bridge_multisig_txs
      SET signatures = ?, status = ?
      WHERE tx_id = ?
    `).run(
      JSON.stringify(multiSigTx.signatures),
      multiSigTx.signatures.length >= multiSigTx.requiredSignatures ? 'approved' : 'pending',
      txId
    );

    console.log(`[BridgeSecurity] Signature added (${multiSigTx.signatures.length}/${multiSigTx.requiredSignatures})`);

    // Check if approved
    if (multiSigTx.signatures.length >= multiSigTx.requiredSignatures) {
      multiSigTx.status = 'approved';
      this.emit('multisig-approved', { txId, txData });
      return { approved: true, txData };
    }

    return { approved: false, signaturesCount: multiSigTx.signatures.length };
  }

  /**
   * Emergency pause bridge
   */
  async pauseBridge(duration = SECURITY_CONFIG.PAUSE_DURATION, reason = '') {
    this.isPaused = true;
    this.pausedUntil = Date.now() + duration;

    await this.logSecurityEvent({
      type: 'BRIDGE_PAUSED',
      severity: 'critical',
      details: `Bridge paused for ${duration / 60000} minutes. Reason: ${reason}`
    });

    this.emit('bridge-paused', { duration, reason, until: this.pausedUntil });

    console.log(`[BridgeSecurity] Bridge paused until ${new Date(this.pausedUntil).toISOString()}`);

    // Auto-resume after duration
    setTimeout(() => {
      this.resumeBridge();
    }, duration);
  }

  /**
   * Resume bridge operations
   */
  async resumeBridge() {
    this.isPaused = false;
    this.pausedUntil = null;

    await this.logSecurityEvent({
      type: 'BRIDGE_RESUMED',
      severity: 'info',
      details: 'Bridge operations resumed'
    });

    this.emit('bridge-resumed');

    console.log('[BridgeSecurity] Bridge resumed');
  }

  /**
   * Add address to blacklist
   */
  async addToBlacklist(address, reason, addedBy = 'system') {
    const addr = address.toLowerCase();

    if (this.blacklistedAddresses.has(addr)) {
      console.log('[BridgeSecurity] Address already blacklisted:', addr);
      return;
    }

    this.blacklistedAddresses.add(addr);

    // Save to database
    const db = this.database.db;
    db.prepare(`
      INSERT INTO bridge_blacklist (address, reason, added_at, added_by)
      VALUES (?, ?, ?, ?)
    `).run(addr, reason, Date.now(), addedBy);

    await this.logSecurityEvent({
      type: 'ADDRESS_BLACKLISTED',
      severity: 'high',
      address: addr,
      details: `Reason: ${reason}`
    });

    console.log('[BridgeSecurity] Address blacklisted:', addr);
  }

  /**
   * Remove address from blacklist
   */
  async removeFromBlacklist(address) {
    const addr = address.toLowerCase();

    this.blacklistedAddresses.delete(addr);

    // Remove from database
    const db = this.database.db;
    db.prepare('DELETE FROM bridge_blacklist WHERE address = ?').run(addr);

    await this.logSecurityEvent({
      type: 'ADDRESS_UNBLACKLISTED',
      severity: 'info',
      address: addr,
      details: 'Address removed from blacklist'
    });

    console.log('[BridgeSecurity] Address removed from blacklist:', addr);
  }

  /**
   * Check if address is blacklisted
   */
  isBlacklisted(address) {
    return this.blacklistedAddresses.has(address.toLowerCase());
  }

  /**
   * Log security event
   */
  async logSecurityEvent(event) {
    const eventId = ethers.hexlify(ethers.randomBytes(16));

    const db = this.database.db;
    db.prepare(`
      INSERT INTO bridge_security_events
      (id, event_type, severity, address, amount, chain_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      event.type,
      event.severity,
      event.address || null,
      event.amount || null,
      event.chainId || null,
      event.details || null,
      Date.now()
    );

    this.emit('security-event', event);

    console.log(`[BridgeSecurity] Security event logged: ${event.type} (${event.severity})`);
  }

  /**
   * Get security events
   */
  async getSecurityEvents(filters = {}) {
    const db = this.database.db;

    let query = 'SELECT * FROM bridge_security_events WHERE 1=1';
    const params = [];

    if (filters.severity) {
      query += ' AND severity = ?';
      params.push(filters.severity);
    }

    if (filters.type) {
      query += ' AND event_type = ?';
      params.push(filters.type);
    }

    if (filters.address) {
      query += ' AND address = ?';
      params.push(filters.address.toLowerCase());
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(filters.limit || 100);

    return db.prepare(query).all(...params);
  }

  /**
   * Start cleanup interval
   */
  startCleanupInterval() {
    // Clean up old data every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 3600000);
  }

  /**
   * Cleanup old data
   */
  cleanup() {
    const now = Date.now();
    const oneDayAgo = now - 86400000;

    // Clean transfer history
    for (const [address, history] of this.transferHistory.entries()) {
      const recent = history.filter(t => now - t.timestamp < 3600000);
      if (recent.length === 0) {
        this.transferHistory.delete(address);
      } else {
        this.transferHistory.set(address, recent);
      }
    }

    // Clean daily volume
    const today = new Date().toDateString();
    for (const [address, data] of this.dailyVolume.entries()) {
      if (data.date !== today) {
        this.dailyVolume.delete(address);
      }
    }

    // Clean expired multi-sig transactions
    for (const [txId, tx] of this.pendingMultiSig.entries()) {
      if (now - tx.createdAt > SECURITY_CONFIG.SIGNATURE_TIMEOUT) {
        this.pendingMultiSig.delete(txId);
      }
    }

    console.log('[BridgeSecurity] Cleanup completed');
  }

  /**
   * Close security manager
   */
  async close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.removeAllListeners();
    this.initialized = false;

    console.log('[BridgeSecurity] Closed');
  }
}

module.exports = BridgeSecurityManager;
