/**
 * Computer Use Bridge — v2.0.0
 *
 * Bridge between the Cowork skills system and the Computer Use Agent.
 * Exposes 12 AI tools (browser_click, visual_click, desktop_screenshot, etc.)
 * as Cowork-compatible skills. Supports recording/replay sharing across agents
 * and unifies FileSandbox + SafeMode permission models.
 *
 * @module ai-engine/cowork/computer-use-bridge
 */

const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Computer Use AI tool → Cowork skill mapping
 */
const CU_SKILL_MAP = {
  browser_click: {
    name: "cu-browser-click",
    category: "automation",
    description: "Click element in browser by CSS selector or coordinates",
    weight: "light",
  },
  visual_click: {
    name: "cu-visual-click",
    category: "automation",
    description: "Click element using Vision AI visual recognition",
    weight: "medium",
  },
  browser_type: {
    name: "cu-browser-type",
    category: "automation",
    description: "Type text into browser input field",
    weight: "light",
  },
  browser_key: {
    name: "cu-browser-key",
    category: "automation",
    description: "Press keyboard keys in browser",
    weight: "light",
  },
  browser_scroll: {
    name: "cu-browser-scroll",
    category: "automation",
    description: "Scroll browser page by direction or coordinates",
    weight: "light",
  },
  browser_screenshot: {
    name: "cu-browser-screenshot",
    category: "automation",
    description: "Take screenshot of browser tab or element",
    weight: "light",
  },
  analyze_page: {
    name: "cu-analyze-page",
    category: "automation",
    description: "Analyze page structure and extract element info",
    weight: "medium",
  },
  browser_navigate: {
    name: "cu-browser-navigate",
    category: "automation",
    description: "Navigate browser to URL",
    weight: "light",
  },
  browser_wait: {
    name: "cu-browser-wait",
    category: "automation",
    description: "Wait for element or condition in browser",
    weight: "light",
  },
  desktop_screenshot: {
    name: "cu-desktop-screenshot",
    category: "automation",
    description: "Take screenshot of desktop or window",
    weight: "medium",
  },
  desktop_click: {
    name: "cu-desktop-click",
    category: "automation",
    description: "Click at desktop screen coordinates",
    weight: "light",
  },
  desktop_type: {
    name: "cu-desktop-type",
    category: "automation",
    description: "Type text on desktop using keyboard simulation",
    weight: "light",
  },
};

/**
 * Default configuration
 */
const DEFAULTS = {
  enableRecordingSharing: true,
  maxSharedRecordings: 100,
  recordingRetentionDays: 7,
  requireSafeModeForRemote: true,
};

/**
 * ComputerUseBridge — Cowork ↔ Computer Use integration
 */
class ComputerUseBridge extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.computerUseAgent - ComputerUseAgent instance
   * @param {Object} options.skillRegistry - SkillRegistry instance
   * @param {Object} options.fileSandbox - FileSandbox instance
   * @param {Object} options.config - Override defaults
   */
  constructor(options = {}) {
    super();
    this.computerUseAgent = options.computerUseAgent || null;
    this.skillRegistry = options.skillRegistry || null;
    this.fileSandbox = options.fileSandbox || null;

    this.config = { ...DEFAULTS, ...options.config };
    this.initialized = false;

    // Shared recording library: recordingId → { recording, sharedBy, sharedAt }
    this.sharedRecordings = new Map();

    // Registered CU skills
    this.registeredSkills = new Map();

    // Permission bridge state
    this._permissionCache = new Map();
  }

  /**
   * Initialize the bridge
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // Register Computer Use tools as Cowork skills
    this._registerCUSkills();

    this.initialized = true;
    logger.info(
      `[ComputerUseBridge] Initialized — ${this.registeredSkills.size} CU skills registered`,
    );
    this.emit("initialized");
  }

  // ============================================================
  // Skill Execution
  // ============================================================

  /**
   * Execute a Computer Use action through the skill interface
   * @param {string} toolName - Original CU tool name (e.g. "browser_click")
   * @param {Object} params - Tool parameters
   * @param {Object} context - Execution context { agentId, teamId, sandbox }
   * @returns {Promise<Object>} Execution result
   */
  async executeAction(toolName, params, context = {}) {
    const skillDef = CU_SKILL_MAP[toolName];
    if (!skillDef) {
      throw new Error(`Unknown Computer Use tool: ${toolName}`);
    }

    // Permission check: verify agent has CU access
    if (context.teamId) {
      const allowed = await this._checkPermission(context, toolName);
      if (!allowed) {
        throw new Error(
          `Agent ${context.agentId} lacks permission for ${toolName} in team ${context.teamId}`,
        );
      }
    }

    // Safe mode check for remote agents
    if (
      this.config.requireSafeModeForRemote &&
      context.isRemote &&
      this.computerUseAgent
    ) {
      const safeCheck = this._safeModePreflight(toolName, params);
      if (!safeCheck.allowed) {
        throw new Error(`SafeMode blocked ${toolName}: ${safeCheck.reason}`);
      }
    }

    if (!this.computerUseAgent) {
      return {
        success: true,
        output: `[Simulated] ${toolName} executed with params: ${JSON.stringify(params).slice(0, 200)}`,
        simulated: true,
      };
    }

    // Map tool name to CU action type
    const action = this._mapToAction(toolName, params);
    const result = await this.computerUseAgent.execute(action);

    this.emit("action-executed", {
      toolName,
      params,
      context,
      result,
    });

    return result;
  }

  // ============================================================
  // Recording Sharing
  // ============================================================

  /**
   * Share a recording for other agents to replay
   * @param {string} recordingId - Recording identifier
   * @param {Object} recording - Recording data { steps[], metadata }
   * @param {Object} sharedBy - { agentId, deviceId }
   * @returns {string} Shared recording ID
   */
  shareRecording(recordingId, recording, sharedBy = {}) {
    if (this.sharedRecordings.size >= this.config.maxSharedRecordings) {
      // Evict oldest recording
      const oldest = Array.from(this.sharedRecordings.entries()).sort(
        (a, b) => a[1].sharedAt - b[1].sharedAt,
      )[0];
      if (oldest) {
        this.sharedRecordings.delete(oldest[0]);
      }
    }

    const shareId = recordingId || `rec-${uuidv4().slice(0, 8)}`;
    this.sharedRecordings.set(shareId, {
      recording,
      sharedBy,
      sharedAt: Date.now(),
      replayCount: 0,
    });

    this.emit("recording-shared", { shareId, sharedBy });
    logger.info(
      `[ComputerUseBridge] Recording shared: ${shareId} (${(recording.steps || []).length} steps)`,
    );

    return shareId;
  }

  /**
   * Get a shared recording for replay
   * @param {string} shareId
   * @returns {Object|null}
   */
  getSharedRecording(shareId) {
    const entry = this.sharedRecordings.get(shareId);
    if (!entry) {
      return null;
    }
    entry.replayCount++;
    return entry.recording;
  }

  /**
   * List all shared recordings
   * @returns {Object[]}
   */
  listSharedRecordings() {
    return Array.from(this.sharedRecordings.entries()).map(
      ([shareId, entry]) => ({
        shareId,
        sharedBy: entry.sharedBy,
        sharedAt: new Date(entry.sharedAt).toISOString(),
        replayCount: entry.replayCount,
        stepCount: (entry.recording?.steps || []).length,
      }),
    );
  }

  /**
   * Replay a shared recording
   * @param {string} shareId - Shared recording ID
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Replay result
   */
  async replaySharedRecording(shareId, context = {}) {
    const recording = this.getSharedRecording(shareId);
    if (!recording) {
      throw new Error(`Shared recording not found: ${shareId}`);
    }

    const steps = recording.steps || [];
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        const result = await this.executeAction(
          step.tool || step.action,
          step.params || step.data,
          { ...context, replayStep: i },
        );
        results.push({ step: i, success: true, result });
      } catch (error) {
        results.push({ step: i, success: false, error: error.message });
        if (recording.metadata?.stopOnError !== false) {
          break;
        }
      }
    }

    const success = results.every((r) => r.success);
    this.emit("recording-replayed", {
      shareId,
      success,
      stepsExecuted: results.length,
    });

    return {
      success,
      totalSteps: steps.length,
      executedSteps: results.length,
      results,
    };
  }

  // ============================================================
  // Permission Bridge
  // ============================================================

  /**
   * Get unified permission status for an agent
   * @param {string} agentId
   * @param {string} teamId
   * @returns {Object} Permission summary
   */
  getAgentPermissions(agentId, teamId) {
    return {
      agentId,
      teamId,
      computerUse: {
        browserActions: true,
        desktopActions: this.config.requireSafeModeForRemote
          ? "safe-mode"
          : true,
        recording: this.config.enableRecordingSharing,
      },
      fileSandbox: this.fileSandbox
        ? { active: true, strictMode: true }
        : { active: false },
    };
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get bridge statistics
   * @returns {Object}
   */
  getStats() {
    return {
      registeredSkills: this.registeredSkills.size,
      sharedRecordings: this.sharedRecordings.size,
      totalReplays: Array.from(this.sharedRecordings.values()).reduce(
        (sum, r) => sum + r.replayCount,
        0,
      ),
      computerUseAvailable: !!this.computerUseAgent,
      fileSandboxAvailable: !!this.fileSandbox,
    };
  }

  /**
   * Shutdown bridge
   */
  async shutdown() {
    this.sharedRecordings.clear();
    this.registeredSkills.clear();
    this._permissionCache.clear();
    this.initialized = false;
    this.emit("shutdown");
    logger.info("[ComputerUseBridge] Shutdown complete");
  }

  // ============================================================
  // Internal
  // ============================================================

  _registerCUSkills() {
    for (const [toolName, skillDef] of Object.entries(CU_SKILL_MAP)) {
      const skill = {
        id: skillDef.name,
        name: skillDef.name,
        displayName: toolName.replace(/_/g, " "),
        description: skillDef.description,
        category: skillDef.category,
        tags: ["computer-use", "automation"],
        source: "computer-use-bridge",
        weight: skillDef.weight,
        handler: (params, context) =>
          this.executeAction(toolName, params, context),
      };

      this.registeredSkills.set(toolName, skill);

      // Register to SkillRegistry if available
      if (this.skillRegistry) {
        try {
          this.skillRegistry.register(skill);
        } catch {
          // Skill may already exist
        }
      }
    }
  }

  _mapToAction(toolName, params) {
    const actionTypeMap = {
      browser_click: "CLICK",
      visual_click: "VISION_CLICK",
      browser_type: "TYPE",
      browser_key: "KEY",
      browser_scroll: "SCROLL",
      browser_screenshot: "SCREENSHOT",
      analyze_page: "VISION_ANALYZE",
      browser_navigate: "NAVIGATE",
      browser_wait: "WAIT",
      desktop_screenshot: "DESKTOP_SCREENSHOT",
      desktop_click: "DESKTOP_CLICK",
      desktop_type: "DESKTOP_TYPE",
    };

    return {
      type: actionTypeMap[toolName] || toolName.toUpperCase(),
      ...params,
    };
  }

  async _checkPermission(context, toolName) {
    // Integrate with FileSandbox for file-related actions
    // For now, check against simple permission cache
    const key = `${context.agentId}:${context.teamId}:${toolName}`;
    if (this._permissionCache.has(key)) {
      return this._permissionCache.get(key);
    }

    // Default: allow browser actions, restrict desktop actions
    const isDesktopAction = toolName.startsWith("desktop_");
    if (isDesktopAction && context.isRemote) {
      this._permissionCache.set(key, false);
      return false;
    }

    this._permissionCache.set(key, true);
    return true;
  }

  _safeModePreflight(toolName, params) {
    // Block potentially dangerous operations in safe mode
    const blockedPatterns = [
      { tool: "desktop_click", check: () => true }, // Require explicit approval
      {
        tool: "desktop_type",
        check: (p) => /sudo|rm\s+-rf|del\s+/i.test(p.text || ""),
      },
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.tool === toolName) {
        if (typeof pattern.check === "function" && pattern.check(params)) {
          return {
            allowed: false,
            reason: `SafeMode blocks ${toolName} for remote agents`,
          };
        }
      }
    }

    return { allowed: true };
  }
}

// Singleton
let _instance = null;

function getComputerUseBridge() {
  if (!_instance) {
    _instance = new ComputerUseBridge();
  }
  return _instance;
}

module.exports = {
  ComputerUseBridge,
  getComputerUseBridge,
  CU_SKILL_MAP,
};
