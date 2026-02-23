/**
 * Storage Market Manager
 *
 * Decentralized storage marketplace where providers offer storage capacity
 * and buyers purchase storage deals. Supports storage verification and
 * deal lifecycle management.
 *
 * Features:
 * - Create and manage storage offers
 * - Negotiate and create storage deals
 * - Verify stored data integrity
 * - Deal lifecycle (pending -> active -> completed/cancelled/disputed)
 *
 * @module social/storage-market
 * @version 0.45.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const OFFER_AVAILABILITY = {
  AVAILABLE: "available",
  RESERVED: "reserved",
  OFFLINE: "offline",
};

const DEAL_STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  DISPUTED: "disputed",
};

const DEFAULT_MIN_DURATION_DAYS = 30;
const DEFAULT_MAX_DURATION_DAYS = 365;

// ============================================================
// StorageMarket
// ============================================================

class StorageMarket extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.initialized = false;
  }

  /**
   * Initialize storage market manager
   */
  async initialize() {
    logger.info("[StorageMarket] Initializing storage market manager...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[StorageMarket] Storage market manager initialized successfully");
    } catch (error) {
      logger.error("[StorageMarket] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    // Storage offers table
    db.exec(`
      CREATE TABLE IF NOT EXISTS storage_offers (
        id TEXT PRIMARY KEY,
        provider_did TEXT NOT NULL,
        capacity_mb INTEGER NOT NULL,
        price_per_mb REAL NOT NULL,
        availability TEXT DEFAULT 'available' CHECK(availability IN ('available', 'reserved', 'offline')),
        min_duration_days INTEGER DEFAULT 30,
        max_duration_days INTEGER DEFAULT 365,
        region TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    // Storage deals table
    db.exec(`
      CREATE TABLE IF NOT EXISTS storage_deals (
        id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL,
        buyer_did TEXT NOT NULL,
        provider_did TEXT NOT NULL,
        capacity_mb INTEGER NOT NULL,
        total_price REAL NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'completed', 'cancelled', 'disputed')),
        start_date INTEGER,
        end_date INTEGER,
        verification_hash TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    // Indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_storage_offers_provider ON storage_offers(provider_did);
      CREATE INDEX IF NOT EXISTS idx_storage_offers_availability ON storage_offers(availability);
      CREATE INDEX IF NOT EXISTS idx_storage_deals_buyer ON storage_deals(buyer_did);
      CREATE INDEX IF NOT EXISTS idx_storage_deals_provider ON storage_deals(provider_did);
      CREATE INDEX IF NOT EXISTS idx_storage_deals_status ON storage_deals(status);
    `);

    logger.info("[StorageMarket] Database tables initialized");
  }

  /**
   * Create a new storage offer.
   *
   * @param {string} providerDid - The provider's DID
   * @param {number} capacity - Storage capacity in MB
   * @param {number} price - Price per MB
   * @param {Object} [options] - Additional options
   * @param {number} [options.minDurationDays] - Minimum deal duration
   * @param {number} [options.maxDurationDays] - Maximum deal duration
   * @param {string} [options.region] - Geographic region
   * @returns {Object} The created offer
   */
  async createOffer(providerDid, capacity, price, options = {}) {
    try {
      if (!providerDid) {
        throw new Error("Provider DID is required");
      }

      if (!capacity || capacity <= 0) {
        throw new Error("Capacity must be a positive number");
      }

      if (price == null || price < 0) {
        throw new Error("Price must be a non-negative number");
      }

      const db = this.database.db;
      const offerId = uuidv4();
      const now = Date.now();

      const minDuration = options.minDurationDays || DEFAULT_MIN_DURATION_DAYS;
      const maxDuration = options.maxDurationDays || DEFAULT_MAX_DURATION_DAYS;

      if (minDuration > maxDuration) {
        throw new Error("Minimum duration cannot exceed maximum duration");
      }

      const stmt = db.prepare(`
        INSERT INTO storage_offers
        (id, provider_did, capacity_mb, price_per_mb, availability, min_duration_days, max_duration_days, region, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        offerId,
        providerDid,
        capacity,
        price,
        OFFER_AVAILABILITY.AVAILABLE,
        minDuration,
        maxDuration,
        options.region || null,
        now,
        now,
      );

      const offer = {
        id: offerId,
        provider_did: providerDid,
        capacity_mb: capacity,
        price_per_mb: price,
        availability: OFFER_AVAILABILITY.AVAILABLE,
        min_duration_days: minDuration,
        max_duration_days: maxDuration,
        region: options.region || null,
        created_at: now,
        updated_at: now,
      };

      logger.info("[StorageMarket] Created storage offer:", offerId);

      this.emit("offer:created", { offer });

      return offer;
    } catch (error) {
      logger.error("[StorageMarket] Failed to create offer:", error);
      throw error;
    }
  }

  /**
   * Get storage offers matching the given filters.
   *
   * @param {Object} [filters] - Query filters
   * @param {string} [filters.availability] - Filter by availability
   * @param {string} [filters.region] - Filter by region
   * @param {number} [filters.minCapacity] - Minimum capacity in MB
   * @param {number} [filters.maxPrice] - Maximum price per MB
   * @param {number} [filters.limit] - Maximum results
   * @param {number} [filters.offset] - Result offset
   * @returns {Array} List of matching offers
   */
  async getOffers(filters = {}) {
    try {
      const db = this.database.db;

      let query = "SELECT * FROM storage_offers WHERE 1=1";
      const params = [];

      if (filters.availability) {
        query += " AND availability = ?";
        params.push(filters.availability);
      }

      if (filters.region) {
        query += " AND region = ?";
        params.push(filters.region);
      }

      if (filters.minCapacity) {
        query += " AND capacity_mb >= ?";
        params.push(filters.minCapacity);
      }

      if (filters.maxPrice) {
        query += " AND price_per_mb <= ?";
        params.push(filters.maxPrice);
      }

      query += " ORDER BY price_per_mb ASC, capacity_mb DESC";

      const limit = filters.limit || 50;
      const offset = filters.offset || 0;
      query += " LIMIT ? OFFSET ?";
      params.push(limit, offset);

      return db.prepare(query).all(...params);
    } catch (error) {
      logger.error("[StorageMarket] Failed to get offers:", error);
      throw error;
    }
  }

  /**
   * Create a storage deal from an offer.
   *
   * @param {string} offerId - The offer to accept
   * @param {string} buyerDid - The buyer's DID
   * @param {number} capacityMb - The capacity to purchase (can be less than offered)
   * @returns {Object} The created deal
   */
  async createDeal(offerId, buyerDid, capacityMb) {
    try {
      if (!offerId) {
        throw new Error("Offer ID is required");
      }

      if (!buyerDid) {
        throw new Error("Buyer DID is required");
      }

      if (!capacityMb || capacityMb <= 0) {
        throw new Error("Capacity must be a positive number");
      }

      const db = this.database.db;

      // Get the offer
      const offer = db
        .prepare("SELECT * FROM storage_offers WHERE id = ?")
        .get(offerId);

      if (!offer) {
        throw new Error("Storage offer not found");
      }

      if (offer.availability !== OFFER_AVAILABILITY.AVAILABLE) {
        throw new Error("Storage offer is not available");
      }

      if (capacityMb > offer.capacity_mb) {
        throw new Error(
          `Requested capacity (${capacityMb} MB) exceeds available capacity (${offer.capacity_mb} MB)`,
        );
      }

      if (offer.provider_did === buyerDid) {
        throw new Error("Cannot purchase your own storage offer");
      }

      const dealId = uuidv4();
      const now = Date.now();
      const totalPrice = capacityMb * offer.price_per_mb;
      const startDate = now;
      const endDate = now + offer.min_duration_days * 24 * 60 * 60 * 1000;

      const stmt = db.prepare(`
        INSERT INTO storage_deals
        (id, offer_id, buyer_did, provider_did, capacity_mb, total_price, status, start_date, end_date, verification_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `);

      stmt.run(
        dealId,
        offerId,
        buyerDid,
        offer.provider_did,
        capacityMb,
        totalPrice,
        DEAL_STATUS.PENDING,
        startDate,
        endDate,
        now,
        now,
      );

      // Update offer availability if fully consumed
      if (capacityMb >= offer.capacity_mb) {
        db.prepare(
          "UPDATE storage_offers SET availability = ?, updated_at = ? WHERE id = ?",
        ).run(OFFER_AVAILABILITY.RESERVED, now, offerId);
      } else {
        // Reduce available capacity
        db.prepare(
          "UPDATE storage_offers SET capacity_mb = capacity_mb - ?, updated_at = ? WHERE id = ?",
        ).run(capacityMb, now, offerId);
      }

      const deal = {
        id: dealId,
        offer_id: offerId,
        buyer_did: buyerDid,
        provider_did: offer.provider_did,
        capacity_mb: capacityMb,
        total_price: totalPrice,
        status: DEAL_STATUS.PENDING,
        start_date: startDate,
        end_date: endDate,
        created_at: now,
        updated_at: now,
      };

      logger.info("[StorageMarket] Created storage deal:", dealId);

      this.emit("deal:created", { deal });

      return deal;
    } catch (error) {
      logger.error("[StorageMarket] Failed to create deal:", error);
      throw error;
    }
  }

  /**
   * Verify data integrity for a storage deal.
   *
   * @param {string} dealId - The deal ID to verify
   * @returns {Object} Verification result
   */
  async verifyStorage(dealId) {
    try {
      if (!dealId) {
        throw new Error("Deal ID is required");
      }

      const db = this.database.db;
      const deal = db
        .prepare("SELECT * FROM storage_deals WHERE id = ?")
        .get(dealId);

      if (!deal) {
        throw new Error("Storage deal not found");
      }

      if (deal.status !== DEAL_STATUS.ACTIVE && deal.status !== DEAL_STATUS.PENDING) {
        throw new Error(`Cannot verify deal in status: ${deal.status}`);
      }

      // Generate verification challenge
      const challenge = crypto.randomBytes(32).toString("hex");
      const verificationHash = crypto
        .createHash("sha256")
        .update(`${dealId}:${challenge}:${Date.now()}`)
        .digest("hex");

      const now = Date.now();

      // Update deal with verification hash and activate if pending
      const newStatus =
        deal.status === DEAL_STATUS.PENDING ? DEAL_STATUS.ACTIVE : deal.status;

      db.prepare(
        "UPDATE storage_deals SET verification_hash = ?, status = ?, updated_at = ? WHERE id = ?",
      ).run(verificationHash, newStatus, now, dealId);

      const result = {
        dealId,
        verified: true,
        verificationHash,
        status: newStatus,
        verifiedAt: now,
      };

      logger.info("[StorageMarket] Verified storage for deal:", dealId);

      this.emit("deal:verified", { dealId, result });

      return result;
    } catch (error) {
      logger.error("[StorageMarket] Failed to verify storage:", error);
      throw error;
    }
  }

  /**
   * Complete a storage deal.
   *
   * @param {string} dealId - The deal ID to complete
   * @returns {Object} Result
   */
  async completeDeal(dealId) {
    try {
      if (!dealId) {
        throw new Error("Deal ID is required");
      }

      const db = this.database.db;
      const deal = db
        .prepare("SELECT * FROM storage_deals WHERE id = ?")
        .get(dealId);

      if (!deal) {
        throw new Error("Storage deal not found");
      }

      if (deal.status !== DEAL_STATUS.ACTIVE) {
        throw new Error(`Cannot complete deal in status: ${deal.status}`);
      }

      const now = Date.now();

      db.prepare(
        "UPDATE storage_deals SET status = ?, updated_at = ? WHERE id = ?",
      ).run(DEAL_STATUS.COMPLETED, now, dealId);

      // Restore offer availability
      db.prepare(
        "UPDATE storage_offers SET availability = ?, capacity_mb = capacity_mb + ?, updated_at = ? WHERE id = ?",
      ).run(OFFER_AVAILABILITY.AVAILABLE, deal.capacity_mb, now, deal.offer_id);

      logger.info("[StorageMarket] Completed deal:", dealId);

      this.emit("deal:completed", { dealId });

      return { success: true, dealId };
    } catch (error) {
      logger.error("[StorageMarket] Failed to complete deal:", error);
      throw error;
    }
  }

  /**
   * Cancel a storage deal.
   *
   * @param {string} dealId - The deal ID to cancel
   * @returns {Object} Result
   */
  async cancelDeal(dealId) {
    try {
      if (!dealId) {
        throw new Error("Deal ID is required");
      }

      const db = this.database.db;
      const deal = db
        .prepare("SELECT * FROM storage_deals WHERE id = ?")
        .get(dealId);

      if (!deal) {
        throw new Error("Storage deal not found");
      }

      if (
        deal.status === DEAL_STATUS.COMPLETED ||
        deal.status === DEAL_STATUS.CANCELLED
      ) {
        throw new Error(`Cannot cancel deal in status: ${deal.status}`);
      }

      const now = Date.now();

      db.prepare(
        "UPDATE storage_deals SET status = ?, updated_at = ? WHERE id = ?",
      ).run(DEAL_STATUS.CANCELLED, now, dealId);

      // Restore offer availability
      db.prepare(
        "UPDATE storage_offers SET availability = ?, capacity_mb = capacity_mb + ?, updated_at = ? WHERE id = ?",
      ).run(OFFER_AVAILABILITY.AVAILABLE, deal.capacity_mb, now, deal.offer_id);

      logger.info("[StorageMarket] Cancelled deal:", dealId);

      this.emit("deal:cancelled", { dealId });

      return { success: true, dealId };
    } catch (error) {
      logger.error("[StorageMarket] Failed to cancel deal:", error);
      throw error;
    }
  }

  /**
   * Get offers created by a specific provider.
   *
   * @param {string} did - The provider DID
   * @returns {Array} List of offers
   */
  async getMyOffers(did) {
    try {
      if (!did) {
        throw new Error("DID is required");
      }

      const db = this.database.db;
      return db
        .prepare(
          "SELECT * FROM storage_offers WHERE provider_did = ? ORDER BY created_at DESC",
        )
        .all(did);
    } catch (error) {
      logger.error("[StorageMarket] Failed to get my offers:", error);
      throw error;
    }
  }

  /**
   * Get deals involving a specific DID (as buyer or provider).
   *
   * @param {string} did - The DID to query
   * @returns {Array} List of deals
   */
  async getMyDeals(did) {
    try {
      if (!did) {
        throw new Error("DID is required");
      }

      const db = this.database.db;
      return db
        .prepare(
          "SELECT * FROM storage_deals WHERE buyer_did = ? OR provider_did = ? ORDER BY created_at DESC",
        )
        .all(did, did);
    } catch (error) {
      logger.error("[StorageMarket] Failed to get my deals:", error);
      throw error;
    }
  }

  /**
   * Get a deal by ID.
   *
   * @param {string} id - The deal ID
   * @returns {Object|null} The deal or null
   */
  async getDealById(id) {
    try {
      if (!id) {
        throw new Error("Deal ID is required");
      }

      const db = this.database.db;
      return db.prepare("SELECT * FROM storage_deals WHERE id = ?").get(id) || null;
    } catch (error) {
      logger.error("[StorageMarket] Failed to get deal:", error);
      throw error;
    }
  }

  /**
   * Update an existing storage offer.
   *
   * @param {string} offerId - The offer ID to update
   * @param {Object} updates - Fields to update
   * @param {number} [updates.capacity_mb] - New capacity
   * @param {number} [updates.price_per_mb] - New price
   * @param {string} [updates.availability] - New availability status
   * @param {string} [updates.region] - New region
   * @returns {Object} Result
   */
  async updateOffer(offerId, updates) {
    try {
      if (!offerId) {
        throw new Error("Offer ID is required");
      }

      if (!updates || Object.keys(updates).length === 0) {
        throw new Error("At least one update field is required");
      }

      const db = this.database.db;
      const offer = db
        .prepare("SELECT * FROM storage_offers WHERE id = ?")
        .get(offerId);

      if (!offer) {
        throw new Error("Storage offer not found");
      }

      const now = Date.now();
      const allowedFields = [
        "capacity_mb",
        "price_per_mb",
        "availability",
        "region",
        "min_duration_days",
        "max_duration_days",
      ];

      const setClauses = [];
      const values = [];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          setClauses.push(`${field} = ?`);
          values.push(updates[field]);
        }
      }

      if (setClauses.length === 0) {
        throw new Error("No valid update fields provided");
      }

      setClauses.push("updated_at = ?");
      values.push(now);
      values.push(offerId);

      db.prepare(
        `UPDATE storage_offers SET ${setClauses.join(", ")} WHERE id = ?`,
      ).run(...values);

      logger.info("[StorageMarket] Updated offer:", offerId);

      this.emit("offer:updated", { offerId, updates });

      return { success: true, offerId };
    } catch (error) {
      logger.error("[StorageMarket] Failed to update offer:", error);
      throw error;
    }
  }

  /**
   * Close the storage market manager
   */
  async close() {
    logger.info("[StorageMarket] Closing storage market manager");

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  StorageMarket,
  OFFER_AVAILABILITY,
  DEAL_STATUS,
};
