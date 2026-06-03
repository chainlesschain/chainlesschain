/**
 * Skill Invoker
 *
 * Remote skill invocation:
 * - REST/gRPC remote invocation
 * - Cross-org delegation
 * - Version-aware routing
 *
 * @module marketplace/skill-invoker
 * @version 3.1.0
 */

import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

class SkillInvoker {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    this._invokeHistory = [];
  }

  async invoke({ endpoint, skillId, version, input, callerDid } = {}) {
    if (!endpoint) {
      throw new Error("Endpoint is required");
    }
    if (!skillId) {
      throw new Error("Skill ID is required");
    }
    const invocationId = uuidv4();
    const startTime = Date.now();
    logger.info(
      `[SkillInvoker] Invoking ${skillId}@${version || "latest"} at ${endpoint}`,
    );
    // Simulate remote invocation
    const result = {
      id: invocationId,
      skillId,
      version: version || "latest",
      endpoint,
      callerDid: callerDid || "self",
      output: { result: `Remote execution of ${skillId}`, input },
      latencyMs: Date.now() - startTime,
      status: "completed",
      timestamp: Date.now(),
    };
    this._invokeHistory.push(result);
    return result;
  }

  async delegateToOrg({ orgId, skillId, input } = {}) {
    if (!orgId) {
      throw new Error("Organization ID is required");
    }
    logger.info(`[SkillInvoker] Delegating ${skillId} to org ${orgId}`);
    return this.invoke({
      endpoint: `https://${orgId}.chainlesschain.local/skills`,
      skillId,
      input,
      callerDid: "self",
    });
  }

  getHistory(limit = 20) {
    return this._invokeHistory.slice(-limit);
  }

  async close() {
    this._invokeHistory = [];
    logger.info("[SkillInvoker] Closed");
  }
}

let _instance = null;
function getSkillInvoker(options) {
  if (!_instance) {
    _instance = new SkillInvoker(options);
  }
  return _instance;
}

export { SkillInvoker, getSkillInvoker };
export default SkillInvoker;
