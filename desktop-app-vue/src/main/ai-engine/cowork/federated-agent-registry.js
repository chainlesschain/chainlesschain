/**
 * Federated Agent Registry — v4.0
 *
 * Provides federated agent discovery across organizations in the
 * ChainlessChain decentralized network.  Inspired by Kademlia DHT
 * routing, it maintains a local agent registry with capability
 * indexing and simulated k-bucket peer management for cross-org
 * agent resolution.
 *
 * Key features:
 * - Register / unregister agents with DID + capabilities + organization
 * - Multi-mode discovery: local, federated (peer query), broadcast
 * - K-bucket-style routing table for simulated DHT peer management
 * - Capability index for fast reverse lookups
 * - Network statistics: agents, organizations, capability coverage
 * - DB persistence + in-memory cache for fast queries
 *
 * @module ai-engine/cowork/federated-agent-registry
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const REGISTRY_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  SYNCING: "syncing",
  DEGRADED: "degraded",
};

const DISCOVERY_MODE = {
  LOCAL: "local",
  FEDERATED: "federated",
  BROADCAST: "broadcast",
};

const AGENT_ENTRY_STATUS = {
  REGISTERED: "registered",
  UNREGISTERED: "unregistered",
  STALE: "stale",
};

const DEFAULT_CONFIG = {
  maxAgents: 10000,
  kBucketSize: 20,
  kBucketCount: 160, // 160 bits for SHA-1 style distance
  staleThresholdMs: 600000, // 10 minutes without heartbeat
  refreshIntervalMs: 120000, // 2 minutes
  maxDiscoveryResults: 50,
  replicationFactor: 3,
  federatedQueryTimeoutMs: 5000,
};

// ============================================================
// FederatedAgentRegistry Class
// ============================================================

class FederatedAgentRegistry extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG };
    this.status = REGISTRY_STATUS.OFFLINE;

    // In-memory registry
    this._agents = new Map(); // agentDID → agent entry
    this._capabilityIndex = new Map(); // capability → Set<agentDID>
    this._organizationIndex = new Map(); // org → Set<agentDID>

    // Simulated DHT routing table (k-buckets)
    this._routingTable = new Map(); // bucketIndex → [{ nodeId, agentDID, lastSeen }]
    this._localNodeId = null;

    // Peer registries for federated queries
    this._peers = new Map(); // peerId → { endpoint, lastSeen, organization }

    // Stats
    this.stats = {
      totalRegistered: 0,
      totalUnregistered: 0,
      totalDiscoveries: 0,
      federatedQueries: 0,
      peerCount: 0,
      lastRefresh: null,
    };
  }

  /**
   * Initialize with database and optional dependencies
   * @param {Object} db - Database manager (better-sqlite3 compatible)
   * @param {Object} deps - Optional dependencies { agentDID, p2pManager }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.agentDIDManager = deps.agentDID || null;
    this.p2pManager = deps.p2pManager || null;

    // Generate local node ID for DHT distance calculations
    this._localNodeId = this._generateNodeId();

    this._ensureTables();
    this._loadFromDB();
    this._startRefreshTimer();

    this.status = REGISTRY_STATUS.ONLINE;
    this.initialized = true;

    logger.info(
      `[FederatedRegistry] Initialized: ${this._agents.size} agents, ` +
        `${this._organizationIndex.size} organizations, nodeId=${this._localNodeId.slice(0, 8)}...`,
    );
  }

  // ============================================================
  // Table Setup
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS federated_agent_registry (
          id TEXT PRIMARY KEY,
          agent_did TEXT UNIQUE NOT NULL,
          display_name TEXT,
          capabilities TEXT DEFAULT '[]',
          organization TEXT,
          endpoint TEXT,
          node_id TEXT,
          status TEXT DEFAULT 'registered',
          metadata TEXT DEFAULT '{}',
          last_heartbeat TEXT DEFAULT (datetime('now')),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fed_reg_did ON federated_agent_registry(agent_did);
        CREATE INDEX IF NOT EXISTS idx_fed_reg_org ON federated_agent_registry(organization);
        CREATE INDEX IF NOT EXISTS idx_fed_reg_status ON federated_agent_registry(status);

        CREATE TABLE IF NOT EXISTS federated_registry_peers (
          id TEXT PRIMARY KEY,
          peer_id TEXT UNIQUE NOT NULL,
          endpoint TEXT,
          organization TEXT,
          last_seen TEXT DEFAULT (datetime('now')),
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fed_peers_peer ON federated_registry_peers(peer_id);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[FederatedRegistry] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Cache Management
  // ============================================================

  _loadFromDB() {
    if (!this.db) {
      return;
    }
    try {
      // Load agents
      const agentRows = this.db
        .prepare(
          "SELECT * FROM federated_agent_registry WHERE status = 'registered'",
        )
        .all();

      for (const row of agentRows) {
        const entry = this._rowToAgentEntry(row);
        this._agents.set(entry.agentDID, entry);
        this._indexCapabilities(entry.agentDID, entry.capabilities);
        this._indexOrganization(entry.agentDID, entry.organization);

        // Add to routing table
        if (entry.nodeId) {
          this._addToRoutingTable(entry.nodeId, entry.agentDID);
        }
      }

      // Load peers
      const peerRows = this.db
        .prepare("SELECT * FROM federated_registry_peers")
        .all();

      for (const row of peerRows) {
        this._peers.set(row.peer_id, {
          endpoint: row.endpoint,
          lastSeen: row.last_seen,
          organization: row.organization,
        });
      }

      this.stats.peerCount = this._peers.size;
    } catch (e) {
      logger.warn("[FederatedRegistry] Load from DB error:", e.message);
    }
  }

  // ============================================================
  // Registration
  // ============================================================

  /**
   * Register an agent in the registry
   * @param {string} agentDID - Agent DID string
   * @param {Array} capabilities - Agent capabilities
   * @param {string} organization - Organization name
   * @param {Object} options - { displayName, endpoint, metadata }
   * @returns {Object} Registered agent entry
   */
  register(agentDID, capabilities = [], organization = null, options = {}) {
    if (!agentDID) {
      throw new Error("agentDID is required");
    }

    // Check max agents
    if (this._agents.size >= this.config.maxAgents) {
      throw new Error(
        `Registry full: maximum ${this.config.maxAgents} agents reached`,
      );
    }

    // Check if already registered
    const existing = this._agents.get(agentDID);
    if (existing && existing.status === AGENT_ENTRY_STATUS.REGISTERED) {
      // Update existing entry
      return this._updateRegistration(
        agentDID,
        capabilities,
        organization,
        options,
      );
    }

    const id = uuidv4();
    const nodeId = this._generateNodeIdFromDID(agentDID);
    const now = new Date().toISOString();

    const entry = {
      id,
      agentDID,
      displayName: options.displayName || `Agent-${agentDID.slice(-8)}`,
      capabilities: Array.isArray(capabilities) ? capabilities : [],
      organization: organization || "default",
      endpoint: options.endpoint || null,
      nodeId,
      status: AGENT_ENTRY_STATUS.REGISTERED,
      metadata: options.metadata || {},
      lastHeartbeat: now,
      createdAt: now,
      updatedAt: now,
    };

    // Persist
    this._persistAgentEntry(entry);

    // Update in-memory state
    this._agents.set(agentDID, entry);
    this._indexCapabilities(agentDID, entry.capabilities);
    this._indexOrganization(agentDID, entry.organization);
    this._addToRoutingTable(nodeId, agentDID);

    this.stats.totalRegistered++;

    this.emit("agent:registered", {
      agentDID,
      organization: entry.organization,
      capabilities: entry.capabilities,
    });
    logger.info(
      `[FederatedRegistry] Registered: ${agentDID} (org: ${entry.organization}, caps: ${entry.capabilities.length})`,
    );

    return { ...entry };
  }

  /**
   * Update an existing registration
   */
  _updateRegistration(agentDID, capabilities, organization, options) {
    const entry = this._agents.get(agentDID);
    const now = new Date().toISOString();

    // Remove old indexes
    this._removeCapabilityIndex(agentDID, entry.capabilities);

    // Update fields
    if (capabilities.length > 0) {
      entry.capabilities = capabilities;
    }
    if (organization) {
      // Re-index org
      const oldOrgSet = this._organizationIndex.get(entry.organization);
      if (oldOrgSet) {
        oldOrgSet.delete(agentDID);
      }
      entry.organization = organization;
    }
    if (options.displayName) {
      entry.displayName = options.displayName;
    }
    if (options.endpoint) {
      entry.endpoint = options.endpoint;
    }
    if (options.metadata) {
      entry.metadata = { ...entry.metadata, ...options.metadata };
    }
    entry.lastHeartbeat = now;
    entry.updatedAt = now;

    // Re-index
    this._indexCapabilities(agentDID, entry.capabilities);
    this._indexOrganization(agentDID, entry.organization);

    // Persist
    this._updateAgentEntryInDB(entry);
    this._agents.set(agentDID, entry);

    this.emit("agent:updated", { agentDID });
    return { ...entry };
  }

  /**
   * Unregister an agent from the registry
   * @param {string} agentDID - Agent DID to unregister
   * @returns {boolean} True if successfully unregistered
   */
  unregister(agentDID) {
    const entry = this._agents.get(agentDID);
    if (!entry) {
      return false;
    }

    entry.status = AGENT_ENTRY_STATUS.UNREGISTERED;
    entry.updatedAt = new Date().toISOString();

    // Remove from indexes
    this._removeCapabilityIndex(agentDID, entry.capabilities);
    const orgSet = this._organizationIndex.get(entry.organization);
    if (orgSet) {
      orgSet.delete(agentDID);
      if (orgSet.size === 0) {
        this._organizationIndex.delete(entry.organization);
      }
    }

    // Remove from routing table
    this._removeFromRoutingTable(entry.nodeId);

    // Update in DB
    this._updateAgentEntryInDB(entry);
    this._agents.delete(agentDID);

    this.stats.totalUnregistered++;

    this.emit("agent:unregistered", { agentDID });
    logger.info(`[FederatedRegistry] Unregistered: ${agentDID}`);

    return true;
  }

  /**
   * Record a heartbeat from an agent
   * @param {string} agentDID - Agent DID
   * @returns {boolean} True if heartbeat recorded
   */
  heartbeat(agentDID) {
    const entry = this._agents.get(agentDID);
    if (!entry || entry.status !== AGENT_ENTRY_STATUS.REGISTERED) {
      return false;
    }

    entry.lastHeartbeat = new Date().toISOString();

    // If it was stale, restore it
    if (entry.status === AGENT_ENTRY_STATUS.STALE) {
      entry.status = AGENT_ENTRY_STATUS.REGISTERED;
      this.emit("agent:restored", { agentDID });
    }

    try {
      this.db.run(
        "UPDATE federated_agent_registry SET last_heartbeat = ?, status = ? WHERE agent_did = ?",
        [entry.lastHeartbeat, entry.status, agentDID],
      );
    } catch (e) {
      logger.warn("[FederatedRegistry] Heartbeat persist error:", e.message);
    }

    return true;
  }

  // ============================================================
  // Discovery
  // ============================================================

  /**
   * Discover agents matching a query
   * @param {Object} query - { capability, organization, displayName, mode, limit }
   * @returns {Array} Matching agent entries
   */
  discover(query = {}) {
    const mode = query.mode || DISCOVERY_MODE.LOCAL;
    const limit = query.limit || this.config.maxDiscoveryResults;

    this.stats.totalDiscoveries++;

    let results = [];

    switch (mode) {
      case DISCOVERY_MODE.LOCAL:
        results = this._localDiscover(query);
        break;
      case DISCOVERY_MODE.FEDERATED:
        results = this._federatedDiscover(query);
        break;
      case DISCOVERY_MODE.BROADCAST:
        results = this._broadcastDiscover(query);
        break;
      default:
        results = this._localDiscover(query);
    }

    return results.slice(0, limit);
  }

  /**
   * Local discovery — search the in-memory registry
   */
  _localDiscover(query) {
    let candidates;

    // Fast path: capability index
    if (query.capability) {
      const didSet = this._capabilityIndex.get(query.capability);
      if (!didSet || didSet.size === 0) {
        return [];
      }
      candidates = Array.from(didSet)
        .map((did) => this._agents.get(did))
        .filter(Boolean);
    } else {
      candidates = Array.from(this._agents.values());
    }

    // Filter by status
    candidates = candidates.filter(
      (a) => a.status === AGENT_ENTRY_STATUS.REGISTERED,
    );

    // Filter by organization
    if (query.organization) {
      candidates = candidates.filter(
        (a) => a.organization === query.organization,
      );
    }

    // Filter by display name (partial match)
    if (query.displayName) {
      const nameLower = query.displayName.toLowerCase();
      candidates = candidates.filter(
        (a) => a.displayName && a.displayName.toLowerCase().includes(nameLower),
      );
    }

    // Filter by multiple capabilities (must have all)
    if (query.capabilities && Array.isArray(query.capabilities)) {
      candidates = candidates.filter((a) =>
        query.capabilities.every((cap) => a.capabilities.includes(cap)),
      );
    }

    return candidates.map((a) => ({ ...a }));
  }

  /**
   * Federated discovery — query peers then merge with local
   */
  _federatedDiscover(query) {
    this.stats.federatedQueries++;

    // Start with local results
    const localResults = this._localDiscover(query);

    // Simulate federated queries to peers
    const peerResults = this._queryPeers(query);

    // Merge and deduplicate
    const seen = new Set(localResults.map((r) => r.agentDID));
    for (const result of peerResults) {
      if (!seen.has(result.agentDID)) {
        seen.add(result.agentDID);
        localResults.push(result);
      }
    }

    return localResults;
  }

  /**
   * Broadcast discovery — query all known peers
   */
  _broadcastDiscover(query) {
    this.stats.federatedQueries++;

    // Same as federated but broadcast to all peers
    const results = this._localDiscover(query);

    // Simulate broadcast (in production, would send to all peers via P2P)
    this.emit("discovery:broadcast", { query, peerCount: this._peers.size });

    return results;
  }

  /**
   * Query skills by skill name across the registry
   * @param {string} skillName - Skill name or capability to search for
   * @returns {Array} Agents that have the matching capability/skill
   */
  querySkills(skillName) {
    if (!skillName) {
      return [];
    }

    const skillLower = skillName.toLowerCase();
    const results = [];

    for (const entry of this._agents.values()) {
      if (entry.status !== AGENT_ENTRY_STATUS.REGISTERED) {
        continue;
      }

      const hasSkill = entry.capabilities.some((cap) =>
        cap.toLowerCase().includes(skillLower),
      );
      if (hasSkill) {
        results.push({ ...entry });
      }
    }

    return results;
  }

  /**
   * Find agents by a specific capability
   * @param {string} capability - Exact capability string
   * @returns {Array} Matching agent entries
   */
  findByCapability(capability) {
    if (!capability) {
      return [];
    }

    const didSet = this._capabilityIndex.get(capability);
    if (!didSet || didSet.size === 0) {
      return [];
    }

    return Array.from(didSet)
      .map((did) => this._agents.get(did))
      .filter((a) => a && a.status === AGENT_ENTRY_STATUS.REGISTERED)
      .map((a) => ({ ...a }));
  }

  /**
   * Get all registered agents with optional filter
   * @param {Object} filter - { status, organization, limit, offset }
   * @returns {Array} Agent entries
   */
  getRegisteredAgents(filter = {}) {
    let results = Array.from(this._agents.values());

    if (filter.status) {
      results = results.filter((a) => a.status === filter.status);
    } else {
      // Default: only registered
      results = results.filter(
        (a) => a.status === AGENT_ENTRY_STATUS.REGISTERED,
      );
    }

    if (filter.organization) {
      results = results.filter((a) => a.organization === filter.organization);
    }

    // Sort by creation date descending
    results.sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || ""),
    );

    const offset = filter.offset || 0;
    const limit = filter.limit || 100;
    return results.slice(offset, offset + limit).map((a) => ({ ...a }));
  }

  // ============================================================
  // Peer Management
  // ============================================================

  /**
   * Add or update a peer registry
   * @param {string} peerId - Peer identifier
   * @param {Object} info - { endpoint, organization }
   */
  addPeer(peerId, info = {}) {
    const now = new Date().toISOString();
    this._peers.set(peerId, {
      endpoint: info.endpoint || null,
      organization: info.organization || null,
      lastSeen: now,
    });
    this.stats.peerCount = this._peers.size;

    // Persist
    try {
      this.db.run(
        `INSERT OR REPLACE INTO federated_registry_peers (id, peer_id, endpoint, organization, last_seen)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), peerId, info.endpoint, info.organization, now],
      );
    } catch (e) {
      logger.warn("[FederatedRegistry] Peer persist error:", e.message);
    }

    this.emit("peer:added", { peerId });
  }

  /**
   * Remove a peer registry
   * @param {string} peerId - Peer to remove
   */
  removePeer(peerId) {
    this._peers.delete(peerId);
    this.stats.peerCount = this._peers.size;

    try {
      this.db.run("DELETE FROM federated_registry_peers WHERE peer_id = ?", [
        peerId,
      ]);
    } catch (e) {
      logger.warn("[FederatedRegistry] Peer remove error:", e.message);
    }

    this.emit("peer:removed", { peerId });
  }

  /**
   * Refresh peer list and mark stale agents
   */
  refreshPeers() {
    const now = Date.now();
    let staleCount = 0;

    for (const [did, entry] of this._agents.entries()) {
      if (entry.status !== AGENT_ENTRY_STATUS.REGISTERED) {
        continue;
      }

      const lastSeen = new Date(entry.lastHeartbeat).getTime();
      if (now - lastSeen > this.config.staleThresholdMs) {
        entry.status = AGENT_ENTRY_STATUS.STALE;
        entry.updatedAt = new Date().toISOString();
        staleCount++;
        this.emit("agent:stale", { agentDID: did });
      }
    }

    this.stats.lastRefresh = new Date().toISOString();

    if (staleCount > 0) {
      logger.info(
        `[FederatedRegistry] Refresh: ${staleCount} agents marked stale`,
      );
    }

    this.emit("registry:refreshed", {
      staleCount,
      totalAgents: this._agents.size,
    });
  }

  // ============================================================
  // DHT Routing Table (Simulated)
  // ============================================================

  _generateNodeId() {
    return crypto.randomBytes(20).toString("hex"); // 160-bit node ID
  }

  _generateNodeIdFromDID(did) {
    return crypto.createHash("sha1").update(did).digest("hex");
  }

  /**
   * Compute XOR distance between two node IDs
   * @param {string} idA - Hex node ID
   * @param {string} idB - Hex node ID
   * @returns {number} Bucket index (0-159)
   */
  _xorDistance(idA, idB) {
    const bufA = Buffer.from(idA, "hex");
    const bufB = Buffer.from(idB, "hex");
    const len = Math.min(bufA.length, bufB.length);

    for (let i = 0; i < len; i++) {
      const xor = bufA[i] ^ bufB[i];
      if (xor !== 0) {
        // Find highest bit position
        const bitPos = (len - 1 - i) * 8 + Math.floor(Math.log2(xor));
        return Math.min(bitPos, this.config.kBucketCount - 1);
      }
    }
    return 0;
  }

  _addToRoutingTable(nodeId, agentDID) {
    const bucketIdx = this._xorDistance(this._localNodeId, nodeId);
    if (!this._routingTable.has(bucketIdx)) {
      this._routingTable.set(bucketIdx, []);
    }

    const bucket = this._routingTable.get(bucketIdx);

    // Check if already in bucket
    const existing = bucket.findIndex((n) => n.nodeId === nodeId);
    if (existing >= 0) {
      // Move to end (most recently seen)
      bucket.splice(existing, 1);
    }

    // Add to bucket (evict oldest if full)
    if (bucket.length >= this.config.kBucketSize) {
      bucket.shift(); // Remove least recently seen
    }
    bucket.push({ nodeId, agentDID, lastSeen: Date.now() });
  }

  _removeFromRoutingTable(nodeId) {
    if (!nodeId) {
      return;
    }
    const bucketIdx = this._xorDistance(this._localNodeId, nodeId);
    const bucket = this._routingTable.get(bucketIdx);
    if (bucket) {
      const idx = bucket.findIndex((n) => n.nodeId === nodeId);
      if (idx >= 0) {
        bucket.splice(idx, 1);
      }
    }
  }

  /**
   * Find the k closest nodes to a target
   * @param {string} targetNodeId - Target node ID
   * @param {number} k - Number of results
   * @returns {Array} Closest nodes
   */
  findClosestNodes(targetNodeId, k = 20) {
    const allNodes = [];
    for (const bucket of this._routingTable.values()) {
      allNodes.push(...bucket);
    }

    // Sort by XOR distance to target
    allNodes.sort((a, b) => {
      const distA = this._xorDistance(a.nodeId, targetNodeId);
      const distB = this._xorDistance(b.nodeId, targetNodeId);
      return distA - distB;
    });

    return allNodes.slice(0, k);
  }

  // ============================================================
  // Simulated Peer Queries
  // ============================================================

  _queryPeers(query) {
    // In production, this would send P2P messages to peer registries.
    // For now, simulate by returning empty results with event emission.
    const peerIds = Array.from(this._peers.keys());
    if (peerIds.length === 0) {
      return [];
    }

    this.emit("federated:query-sent", {
      query,
      peers: peerIds.length,
    });

    // Simulated: no real network results
    return [];
  }

  // ============================================================
  // Capability & Organization Indexing
  // ============================================================

  _indexCapabilities(agentDID, capabilities) {
    for (const cap of capabilities) {
      if (!this._capabilityIndex.has(cap)) {
        this._capabilityIndex.set(cap, new Set());
      }
      this._capabilityIndex.get(cap).add(agentDID);
    }
  }

  _removeCapabilityIndex(agentDID, capabilities) {
    for (const cap of capabilities) {
      const s = this._capabilityIndex.get(cap);
      if (s) {
        s.delete(agentDID);
        if (s.size === 0) {
          this._capabilityIndex.delete(cap);
        }
      }
    }
  }

  _indexOrganization(agentDID, organization) {
    if (!organization) {
      return;
    }
    if (!this._organizationIndex.has(organization)) {
      this._organizationIndex.set(organization, new Set());
    }
    this._organizationIndex.get(organization).add(agentDID);
  }

  // ============================================================
  // Network Statistics
  // ============================================================

  /**
   * Get comprehensive network statistics
   * @returns {Object} Network stats
   */
  getNetworkStats() {
    const capabilityCoverage = {};
    for (const [cap, didSet] of this._capabilityIndex.entries()) {
      capabilityCoverage[cap] = didSet.size;
    }

    const orgStats = {};
    for (const [org, didSet] of this._organizationIndex.entries()) {
      orgStats[org] = didSet.size;
    }

    let routingTableSize = 0;
    let nonEmptyBuckets = 0;
    for (const bucket of this._routingTable.values()) {
      routingTableSize += bucket.length;
      if (bucket.length > 0) {
        nonEmptyBuckets++;
      }
    }

    return {
      totalAgents: this._agents.size,
      registeredAgents: Array.from(this._agents.values()).filter(
        (a) => a.status === AGENT_ENTRY_STATUS.REGISTERED,
      ).length,
      staleAgents: Array.from(this._agents.values()).filter(
        (a) => a.status === AGENT_ENTRY_STATUS.STALE,
      ).length,
      organizations: this._organizationIndex.size,
      organizationBreakdown: orgStats,
      totalCapabilities: this._capabilityIndex.size,
      capabilityCoverage,
      routingTable: {
        totalNodes: routingTableSize,
        nonEmptyBuckets,
        totalBuckets: this._routingTable.size,
      },
      peers: this._peers.size,
      status: this.status,
    };
  }

  /**
   * Get module statistics
   * @returns {Object} Stats
   */
  getStats() {
    return {
      ...this.stats,
      registeredAgents: this._agents.size,
      organizations: this._organizationIndex.size,
      capabilities: this._capabilityIndex.size,
      peers: this._peers.size,
      status: this.status,
    };
  }

  /**
   * Get current configuration
   * @returns {Object} Config copy
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Config overrides
   * @returns {Object} Updated config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // DB Persistence Helpers
  // ============================================================

  _persistAgentEntry(entry) {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(
        `INSERT OR REPLACE INTO federated_agent_registry
         (id, agent_did, display_name, capabilities, organization, endpoint,
          node_id, status, metadata, last_heartbeat, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.agentDID,
          entry.displayName,
          JSON.stringify(entry.capabilities),
          entry.organization,
          entry.endpoint,
          entry.nodeId,
          entry.status,
          JSON.stringify(entry.metadata),
          entry.lastHeartbeat,
          entry.createdAt,
          entry.updatedAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[FederatedRegistry] Persist error:", e.message);
    }
  }

  _updateAgentEntryInDB(entry) {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(
        `UPDATE federated_agent_registry SET
          display_name = ?, capabilities = ?, organization = ?,
          endpoint = ?, status = ?, metadata = ?,
          last_heartbeat = ?, updated_at = ?
         WHERE agent_did = ?`,
        [
          entry.displayName,
          JSON.stringify(entry.capabilities),
          entry.organization,
          entry.endpoint,
          entry.status,
          JSON.stringify(entry.metadata),
          entry.lastHeartbeat,
          entry.updatedAt,
          entry.agentDID,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[FederatedRegistry] Update error:", e.message);
    }
  }

  // ============================================================
  // Record Transforms
  // ============================================================

  _rowToAgentEntry(row) {
    return {
      id: row.id,
      agentDID: row.agent_did,
      displayName: row.display_name,
      capabilities: safeParseJSON(row.capabilities, []),
      organization: row.organization,
      endpoint: row.endpoint,
      nodeId: row.node_id,
      status: row.status,
      metadata: safeParseJSON(row.metadata, {}),
      lastHeartbeat: row.last_heartbeat,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ============================================================
  // Timer Management
  // ============================================================

  _startRefreshTimer() {
    this._refreshInterval = setInterval(() => {
      this.refreshPeers();
    }, this.config.refreshIntervalMs);

    if (this._refreshInterval.unref) {
      this._refreshInterval.unref();
    }
  }

  /**
   * Destroy the instance and release resources
   */
  destroy() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
    this._agents.clear();
    this._capabilityIndex.clear();
    this._organizationIndex.clear();
    this._routingTable.clear();
    this._peers.clear();
    this.status = REGISTRY_STATUS.OFFLINE;
    this.initialized = false;
    logger.info("[FederatedRegistry] Destroyed");
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str, fallback = []) {
  if (!str) {
    return fallback;
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getFederatedAgentRegistry() {
  if (!instance) {
    instance = new FederatedAgentRegistry();
  }
  return instance;
}

module.exports = {
  FederatedAgentRegistry,
  getFederatedAgentRegistry,
  REGISTRY_STATUS,
  DISCOVERY_MODE,
};
