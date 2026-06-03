/**
 * Device Discovery Service — v2.0.0
 *
 * Auto-discovers network devices and their capabilities.
 * Broadcasts capability advertisements via P2P, maintains a device registry
 * with health monitoring, and routes skill queries to capable devices.
 *
 * @module ai-engine/cowork/device-discovery
 */

const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Device platforms
 */
const PLATFORMS = {
  DESKTOP_WIN: "win32",
  DESKTOP_MAC: "darwin",
  DESKTOP_LINUX: "linux",
  ANDROID: "android",
  IOS: "ios",
  CLOUD: "cloud",
};

/**
 * Capability tiers for routing decisions
 */
const CAPABILITY_TIERS = {
  FULL: "full", // Desktop — all 92+ skills, GPU, full compute
  STANDARD: "standard", // Mobile with handlers — 12+ native handlers
  LIGHT: "light", // Mobile REMOTE-only — delegates to desktop
  CLOUD: "cloud", // Cloud worker — LLM inference, heavy compute
};

/**
 * Default configuration
 */
const DEFAULTS = {
  discoveryInterval: 60000, // 60s periodic re-broadcast
  staleTimeout: 180000, // 3 min — mark stale
  purgeTimeout: 600000, // 10 min — remove from registry
  maxDevices: 100,
  enableAutoDiscovery: true,
};

/**
 * DeviceDiscovery — Network device capability discovery
 */
class DeviceDiscovery extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.p2pNetwork - P2PAgentNetwork instance
   * @param {Object} options.skillRegistry - SkillRegistry instance
   * @param {Object} options.config - Override defaults
   */
  constructor(options = {}) {
    super();
    this.p2pNetwork = options.p2pNetwork || null;
    this.skillRegistry = options.skillRegistry || null;
    this.db = options.database || null;

    this.config = { ...DEFAULTS, ...options.config };
    this.initialized = false;

    // Device registry: deviceId → DeviceProfile
    this.devices = new Map();

    // Skill → Device index for fast routing
    this.skillDeviceIndex = new Map();

    // Discovery timer
    this._discoveryTimer = null;
    this._purgeTimer = null;
  }

  /**
   * Initialize discovery service
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // Register local device
    this._registerLocalDevice();

    // Listen for remote agent events from P2PAgentNetwork
    if (this.p2pNetwork) {
      this.p2pNetwork.on("remote-agent-registered", (agent) => {
        this._onRemoteAgentDiscovered(agent);
      });

      this.p2pNetwork.on("remote-agent-updated", (agent) => {
        this._onRemoteAgentUpdated(agent);
      });

      this.p2pNetwork.on("remote-agent-unregistered", ({ peerId }) => {
        this._onRemoteAgentLeft(peerId);
      });

      this.p2pNetwork.on("remote-agent-unreachable", ({ peerId }) => {
        this._markDeviceStale(peerId);
      });
    }

    // Start periodic discovery broadcast
    if (this.config.enableAutoDiscovery) {
      this._discoveryTimer = setInterval(() => {
        this._periodicDiscovery();
      }, this.config.discoveryInterval);

      // Purge stale devices
      this._purgeTimer = setInterval(() => {
        this._purgeStaleDevices();
      }, this.config.staleTimeout);
    }

    this.initialized = true;
    logger.info(
      `[DeviceDiscovery] Initialized — ${this.devices.size} device(s) registered`,
    );
    this.emit("initialized");
  }

  // ============================================================
  // Device Registry
  // ============================================================

  /**
   * Get all discovered devices
   * @param {Object} filters - { platform, tier, skill, state }
   * @returns {Object[]}
   */
  getDevices(filters = {}) {
    let devices = Array.from(this.devices.values());

    if (filters.platform) {
      devices = devices.filter((d) => d.platform === filters.platform);
    }
    if (filters.tier) {
      devices = devices.filter((d) => d.tier === filters.tier);
    }
    if (filters.skill) {
      const deviceIds = this.skillDeviceIndex.get(filters.skill) || new Set();
      devices = devices.filter((d) => deviceIds.has(d.deviceId));
    }
    if (filters.state) {
      devices = devices.filter((d) => d.state === filters.state);
    }

    return devices;
  }

  /**
   * Get a specific device profile
   * @param {string} deviceId
   * @returns {Object|null}
   */
  getDevice(deviceId) {
    return this.devices.get(deviceId) || null;
  }

  /**
   * Find devices capable of running a specific skill
   * @param {string} skillId
   * @returns {Object[]} Sorted by capability score
   */
  findDevicesForSkill(skillId) {
    const deviceIds = this.skillDeviceIndex.get(skillId) || new Set();
    const candidates = [];

    for (const deviceId of deviceIds) {
      const device = this.devices.get(deviceId);
      if (!device || device.state !== "online") {
        continue;
      }

      candidates.push({
        device,
        score: this._scoreDeviceForSkill(device, skillId),
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /**
   * Get the best device for executing a skill
   * @param {string} skillId
   * @param {Object} requirements - { minCpus, minMemoryMB, preferLocal }
   * @returns {Object|null} Best device or null
   */
  getBestDeviceForSkill(skillId, requirements = {}) {
    const candidates = this.findDevicesForSkill(skillId);

    for (const { device } of candidates) {
      if (
        requirements.minCpus &&
        (device.resources?.cpus || 0) < requirements.minCpus
      ) {
        continue;
      }
      if (
        requirements.minMemoryMB &&
        (device.resources?.heapTotalMB || 0) < requirements.minMemoryMB
      ) {
        continue;
      }
      if (requirements.preferLocal && !device.isLocal) {
        continue;
      }
      return device;
    }

    // Fallback: return first available or null
    return candidates[0]?.device || null;
  }

  /**
   * Get aggregated skill catalog across all devices
   * @returns {Object[]} Unified skill list with device availability
   */
  getNetworkSkillCatalog() {
    const catalog = new Map();

    for (const [deviceId, device] of this.devices) {
      if (device.state !== "online") {
        continue;
      }

      for (const skill of device.skills || []) {
        const skillId = skill.id || skill.name;
        if (!catalog.has(skillId)) {
          catalog.set(skillId, {
            skillId,
            name: skill.name,
            category: skill.category,
            availableOn: [],
          });
        }
        catalog.get(skillId).availableOn.push({
          deviceId,
          platform: device.platform,
          tier: device.tier,
          isLocal: device.isLocal,
        });
      }
    }

    return Array.from(catalog.values());
  }

  /**
   * Get discovery statistics
   * @returns {Object}
   */
  getStats() {
    const devices = Array.from(this.devices.values());
    const byPlatform = {};
    const byTier = {};

    for (const d of devices) {
      byPlatform[d.platform] = (byPlatform[d.platform] || 0) + 1;
      byTier[d.tier] = (byTier[d.tier] || 0) + 1;
    }

    return {
      totalDevices: devices.length,
      onlineDevices: devices.filter((d) => d.state === "online").length,
      staleDevices: devices.filter((d) => d.state === "stale").length,
      byPlatform,
      byTier,
      totalNetworkSkills: this.skillDeviceIndex.size,
      localDevice: this.devices.get("local")?.deviceId || null,
    };
  }

  /**
   * Shutdown discovery service
   */
  async shutdown() {
    if (this._discoveryTimer) {
      clearInterval(this._discoveryTimer);
    }
    if (this._purgeTimer) {
      clearInterval(this._purgeTimer);
    }
    this.devices.clear();
    this.skillDeviceIndex.clear();
    this.initialized = false;
    this.emit("shutdown");
    logger.info("[DeviceDiscovery] Shutdown complete");
  }

  // ============================================================
  // Internal: Device Management
  // ============================================================

  _registerLocalDevice() {
    const localSkills = this._getLocalSkills();
    const localDevice = {
      deviceId: "local",
      peerId: null,
      platform: process.platform,
      tier: CAPABILITY_TIERS.FULL,
      state: "online",
      isLocal: true,
      skills: localSkills,
      resources: this._getLocalResources(),
      discoveredAt: new Date().toISOString(),
      lastSeen: Date.now(),
    };

    this.devices.set("local", localDevice);
    this._updateSkillIndex("local", localSkills);
  }

  _onRemoteAgentDiscovered(agent) {
    if (this.devices.size >= this.config.maxDevices) {
      logger.warn(
        `[DeviceDiscovery] Max devices reached (${this.config.maxDevices})`,
      );
      return;
    }

    const tier = this._detectTier(agent.platform, agent.skills);
    const device = {
      deviceId: agent.deviceId || agent.peerId,
      peerId: agent.peerId,
      platform: agent.platform,
      tier,
      state: "online",
      isLocal: false,
      skills: agent.skills || [],
      resources: agent.resources || {},
      discoveredAt: new Date().toISOString(),
      lastSeen: Date.now(),
    };

    this.devices.set(agent.peerId, device);
    this._updateSkillIndex(agent.peerId, agent.skills || []);

    this.emit("device-discovered", device);
    logger.info(
      `[DeviceDiscovery] Device discovered: ${device.deviceId} (${device.platform}, tier: ${tier}, ${(agent.skills || []).length} skills)`,
    );
  }

  _onRemoteAgentUpdated(agent) {
    const device = this.devices.get(agent.peerId);
    if (!device) {
      return;
    }

    device.skills = agent.skills || device.skills;
    device.resources = agent.resources || device.resources;
    device.state = "online";
    device.lastSeen = Date.now();

    this._updateSkillIndex(agent.peerId, device.skills);
    this.emit("device-updated", device);
  }

  _onRemoteAgentLeft(peerId) {
    const device = this.devices.get(peerId);
    if (!device) {
      return;
    }

    device.state = "offline";
    this._removeFromSkillIndex(peerId);
    this.emit("device-offline", device);
    logger.info(`[DeviceDiscovery] Device offline: ${device.deviceId}`);
  }

  _markDeviceStale(peerId) {
    const device = this.devices.get(peerId);
    if (!device) {
      return;
    }
    device.state = "stale";
    this.emit("device-stale", device);
  }

  _purgeStaleDevices() {
    const now = Date.now();
    for (const [key, device] of this.devices) {
      if (device.isLocal) {
        continue;
      }
      if (now - device.lastSeen > this.config.purgeTimeout) {
        this.devices.delete(key);
        this._removeFromSkillIndex(key);
        this.emit("device-purged", device);
        logger.info(
          `[DeviceDiscovery] Purged stale device: ${device.deviceId}`,
        );
      }
    }
  }

  _periodicDiscovery() {
    if (this.p2pNetwork) {
      this.p2pNetwork.announcePresence().catch((err) => {
        logger.debug(
          `[DeviceDiscovery] Periodic discovery broadcast error: ${err.message}`,
        );
      });
    }
  }

  // ============================================================
  // Internal: Skill Index
  // ============================================================

  _updateSkillIndex(deviceId, skills) {
    // Remove old entries
    this._removeFromSkillIndex(deviceId);

    // Add new entries
    for (const skill of skills) {
      const skillId = skill.id || skill.name;
      if (!this.skillDeviceIndex.has(skillId)) {
        this.skillDeviceIndex.set(skillId, new Set());
      }
      this.skillDeviceIndex.get(skillId).add(deviceId);
    }
  }

  _removeFromSkillIndex(deviceId) {
    for (const [skillId, deviceSet] of this.skillDeviceIndex) {
      deviceSet.delete(deviceId);
      if (deviceSet.size === 0) {
        this.skillDeviceIndex.delete(skillId);
      }
    }
  }

  // ============================================================
  // Internal: Helpers
  // ============================================================

  _detectTier(platform, skills) {
    if (platform === "cloud") {
      return CAPABILITY_TIERS.CLOUD;
    }

    // Desktop platforms
    if (["win32", "darwin", "linux"].includes(platform)) {
      return CAPABILITY_TIERS.FULL;
    }

    // Mobile — check if has native handlers
    const skillCount = (skills || []).length;
    if (skillCount >= 10) {
      return CAPABILITY_TIERS.STANDARD;
    }

    return CAPABILITY_TIERS.LIGHT;
  }

  _scoreDeviceForSkill(device, skillId) {
    let score = 0;

    // Tier-based scoring
    const tierScores = {
      [CAPABILITY_TIERS.FULL]: 40,
      [CAPABILITY_TIERS.CLOUD]: 35,
      [CAPABILITY_TIERS.STANDARD]: 20,
      [CAPABILITY_TIERS.LIGHT]: 5,
    };
    score += tierScores[device.tier] || 0;

    // Local device preference (no network latency)
    if (device.isLocal) {
      score += 30;
    }

    // Resource availability
    if (device.resources?.cpus) {
      score += device.resources.cpus * 2;
    }
    if (device.resources?.heapTotalMB) {
      score += Math.min(device.resources.heapTotalMB / 100, 20);
    }

    // State penalty
    if (device.state === "stale") {
      score -= 50;
    }

    return Math.max(0, score);
  }

  _getLocalSkills() {
    if (!this.skillRegistry) {
      return [];
    }
    try {
      return this.skillRegistry.getSkillList().map((s) => ({
        id: s.skillId || s.name,
        name: s.name,
        category: s.category,
      }));
    } catch {
      return [];
    }
  }

  _getLocalResources() {
    try {
      const mem = process.memoryUsage();
      const os = require("os");
      return {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        cpus: os.cpus().length,
        totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
        freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
        uptime: Math.round(process.uptime()),
      };
    } catch {
      return {};
    }
  }
}

// Singleton
let _instance = null;

function getDeviceDiscovery() {
  if (!_instance) {
    _instance = new DeviceDiscovery();
  }
  return _instance;
}

module.exports = {
  DeviceDiscovery,
  getDeviceDiscovery,
  PLATFORMS,
  CAPABILITY_TIERS,
};
