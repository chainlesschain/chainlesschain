/**
 * Classification Policy
 *
 * Data classification levels and auto-tag engine:
 * - Public, Internal, Confidential, Top Secret
 * - Automatic tagging based on content analysis
 * - Policy enforcement rules
 *
 * @module audit/classification-policy
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";

// ============================================================
// Constants
// ============================================================

const CLASSIFICATION_LEVELS = {
  PUBLIC: "public",
  INTERNAL: "internal",
  CONFIDENTIAL: "confidential",
  TOP_SECRET: "top_secret",
};

const LEVEL_PRIORITIES = {
  [CLASSIFICATION_LEVELS.PUBLIC]: 0,
  [CLASSIFICATION_LEVELS.INTERNAL]: 1,
  [CLASSIFICATION_LEVELS.CONFIDENTIAL]: 2,
  [CLASSIFICATION_LEVELS.TOP_SECRET]: 3,
};

const DEFAULT_POLICIES = [
  {
    id: "policy-pci",
    name: "PCI Data Protection",
    level: CLASSIFICATION_LEVELS.TOP_SECRET,
    triggers: ["pci"],
    description: "Credit card and payment data must be classified as Top Secret",
  },
  {
    id: "policy-phi",
    name: "PHI Data Protection",
    level: CLASSIFICATION_LEVELS.CONFIDENTIAL,
    triggers: ["phi"],
    description: "Health information must be classified as Confidential",
  },
  {
    id: "policy-pii",
    name: "PII Data Protection",
    level: CLASSIFICATION_LEVELS.CONFIDENTIAL,
    triggers: ["pii"],
    description: "Personal identifiable information is Confidential",
  },
  {
    id: "policy-internal",
    name: "Internal Documents",
    level: CLASSIFICATION_LEVELS.INTERNAL,
    triggers: ["general"],
    description: "Default classification for business documents",
  },
];

// ============================================================
// ClassificationPolicy
// ============================================================

class ClassificationPolicy extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.policies = [...DEFAULT_POLICIES];
    this.initialized = false;
  }

  async initialize() {
    logger.info("[ClassificationPolicy] Initializing classification policy engine...");
    this.initialized = true;
    logger.info("[ClassificationPolicy] Classification policy engine initialized");
  }

  /**
   * Determine classification level based on data category.
   * @param {string} dataCategory - Data category from DataClassifier
   * @param {Object} [context] - Additional context
   * @returns {Object} Classification decision
   */
  determineLevel(dataCategory, context = {}) {
    let level = CLASSIFICATION_LEVELS.PUBLIC;
    const matchedPolicies = [];

    for (const policy of this.policies) {
      if (policy.triggers.includes(dataCategory)) {
        matchedPolicies.push(policy);
        if (LEVEL_PRIORITIES[policy.level] > LEVEL_PRIORITIES[level]) {
          level = policy.level;
        }
      }
    }

    // Override with explicit context
    if (context.containsCreditCard) {level = CLASSIFICATION_LEVELS.TOP_SECRET;}
    if (context.containsMedical && LEVEL_PRIORITIES[level] < LEVEL_PRIORITIES[CLASSIFICATION_LEVELS.CONFIDENTIAL]) {
      level = CLASSIFICATION_LEVELS.CONFIDENTIAL;
    }

    return {
      level,
      matchedPolicies: matchedPolicies.map((p) => p.name),
      autoTagged: true,
    };
  }

  /**
   * Auto-tag content with classification level.
   * @param {string} contentId - Content identifier
   * @param {Object} classificationResult - Result from DataClassifier
   * @returns {Object} Tag result
   */
  async autoTag(contentId, classificationResult) {
    try {
      const decision = this.determineLevel(classificationResult.category, {
        containsCreditCard: classificationResult.detections?.some(
          (d) => d.type === "CREDIT_CARD",
        ),
        containsMedical: classificationResult.detections?.some(
          (d) => d.category === "phi",
        ),
      });

      const tag = {
        contentId,
        level: decision.level,
        category: classificationResult.category,
        severity: classificationResult.severity,
        matchedPolicies: decision.matchedPolicies,
        taggedAt: Date.now(),
      };

      this.emit("content:tagged", tag);
      return tag;
    } catch (error) {
      logger.error("[ClassificationPolicy] Auto-tag failed:", error);
      throw error;
    }
  }

  /**
   * Get all active policies.
   * @returns {Array} Active policies
   */
  getPolicies() {
    return [...this.policies];
  }

  /**
   * Add a custom policy.
   * @param {Object} policy - Policy definition
   * @returns {Object} Added policy
   */
  addPolicy(policy) {
    if (!policy.id || !policy.name || !policy.level) {
      throw new Error("Policy requires id, name, and level");
    }

    this.policies.push(policy);
    this.emit("policy:added", policy);
    return policy;
  }

  /**
   * Remove a policy.
   * @param {string} policyId - Policy ID
   */
  removePolicy(policyId) {
    this.policies = this.policies.filter((p) => p.id !== policyId);
    this.emit("policy:removed", { policyId });
  }

  /**
   * Check if access is allowed for a classification level.
   * @param {string} requiredLevel - Required classification level
   * @param {string} userClearance - User's clearance level
   * @returns {boolean} Whether access is allowed
   */
  checkAccess(requiredLevel, userClearance) {
    const required = LEVEL_PRIORITIES[requiredLevel] || 0;
    const clearance = LEVEL_PRIORITIES[userClearance] || 0;
    return clearance >= required;
  }

  async close() {
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[ClassificationPolicy] Closed");
  }
}

let _instance;
function getClassificationPolicy() {
  if (!_instance) {_instance = new ClassificationPolicy();}
  return _instance;
}

export {
  ClassificationPolicy,
  getClassificationPolicy,
  CLASSIFICATION_LEVELS,
  LEVEL_PRIORITIES,
};
