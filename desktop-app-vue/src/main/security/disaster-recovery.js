/**
 * Disaster Recovery
 * Offline key recovery and identity verification
 * @module security/disaster-recovery
 * @version 3.2.0
 */
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

class DisasterRecovery {
  constructor(database) {
    this.database = database;
    this._recoveryPlans = [];
  }

  async createRecoveryPlan({ deviceId, recoveryMethod } = {}) {
    if (!deviceId) {
      throw new Error("Device ID is required");
    }
    const plan = {
      id: uuidv4(),
      deviceId,
      recoveryMethod: recoveryMethod || "seed-phrase",
      status: "active",
      createdAt: Date.now(),
    };
    this._recoveryPlans.push(plan);
    logger.info(
      `[DisasterRecovery] Recovery plan created for device: ${deviceId}`,
    );
    return plan;
  }

  async executeRecovery(planId) {
    if (!planId) {
      throw new Error("Plan ID is required");
    }
    const plan = this._recoveryPlans.find((p) => p.id === planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }
    plan.status = "executed";
    logger.info(`[DisasterRecovery] Recovery executed: ${planId}`);
    return { ...plan, executedAt: Date.now() };
  }

  async close() {
    this._recoveryPlans = [];
    logger.info("[DisasterRecovery] Closed");
  }
}

let _instance = null;
function getDisasterRecovery(database) {
  if (!_instance) {
    _instance = new DisasterRecovery(database);
  }
  return _instance;
}

export { DisasterRecovery, getDisasterRecovery };
export default DisasterRecovery;
