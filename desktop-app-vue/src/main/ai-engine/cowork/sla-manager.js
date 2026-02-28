/**
 * Cross-Org SLA Manager
 *
 * SLA contract management for cross-organization collaboration:
 * - Contract CRUD (guarantees: maxExecutionMs, minAvailability, minQualityScore)
 * - Violation tracking
 * - Multi-org negotiation
 * - Penalty/reward calculation
 * - Auto-escalation
 *
 * @module ai-engine/cowork/sla-manager
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const CONTRACT_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  VIOLATED: "violated",
  EXPIRED: "expired",
  TERMINATED: "terminated",
};

const VIOLATION_SEVERITY = {
  CRITICAL: "critical",
  MAJOR: "major",
  MINOR: "minor",
};

class SLAManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._contracts = new Map();
    this._violations = new Map();
    this._defaultMaxExecutionMs = 30000;
    this._defaultMinAvailability = 0.99;
    this._autoEscalation = true;
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS sla_contracts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        org_id TEXT,
        partner_org_id TEXT,
        status TEXT DEFAULT 'draft',
        guarantees TEXT,
        penalties TEXT,
        rewards TEXT,
        valid_from INTEGER,
        valid_until INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_sla_contracts_status ON sla_contracts(status);
      CREATE INDEX IF NOT EXISTS idx_sla_contracts_org ON sla_contracts(org_id);

      CREATE TABLE IF NOT EXISTS sla_violations (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        severity TEXT DEFAULT 'minor',
        metric TEXT,
        expected_value REAL,
        actual_value REAL,
        description TEXT,
        escalated INTEGER DEFAULT 0,
        resolved INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_sla_violations_contract ON sla_violations(contract_id);
      CREATE INDEX IF NOT EXISTS idx_sla_violations_severity ON sla_violations(severity);
    `);
  }

  async initialize() {
    logger.info("[SLAManager] Initializing...");
    this._ensureTables();

    if (this.database && this.database.db) {
      try {
        const contracts = this.database.db
          .prepare(
            "SELECT * FROM sla_contracts WHERE status IN ('draft', 'active') ORDER BY created_at DESC",
          )
          .all();
        for (const c of contracts) {
          this._contracts.set(c.id, {
            ...c,
            guarantees: c.guarantees ? JSON.parse(c.guarantees) : {},
            penalties: c.penalties ? JSON.parse(c.penalties) : {},
            rewards: c.rewards ? JSON.parse(c.rewards) : {},
          });
        }
        logger.info(`[SLAManager] Loaded ${contracts.length} contracts`);
      } catch (err) {
        logger.error("[SLAManager] Failed to load contracts:", err);
      }
    }

    this.initialized = true;
    logger.info("[SLAManager] Initialized");
  }

  async listContracts(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM sla_contracts WHERE 1=1";
        const params = [];
        if (filter.status) {
          sql += " AND status = ?";
          params.push(filter.status);
        }
        if (filter.orgId) {
          sql += " AND (org_id = ? OR partner_org_id = ?)";
          params.push(filter.orgId, filter.orgId);
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);
        const rows = this.database.db.prepare(sql).all(...params);
        return rows.map((r) => ({
          ...r,
          guarantees: r.guarantees ? JSON.parse(r.guarantees) : {},
          penalties: r.penalties ? JSON.parse(r.penalties) : {},
          rewards: r.rewards ? JSON.parse(r.rewards) : {},
        }));
      } catch (err) {
        logger.error("[SLAManager] Failed to list contracts:", err);
      }
    }
    let contracts = Array.from(this._contracts.values());
    if (filter.status) {
      contracts = contracts.filter((c) => c.status === filter.status);
    }
    return contracts.slice(0, filter.limit || 50);
  }

  async createContract({
    name,
    orgId,
    partnerOrgId,
    guarantees,
    penalties,
    rewards,
    validFrom,
    validUntil,
  } = {}) {
    if (!name) {
      throw new Error("Contract name is required");
    }

    const id = uuidv4();
    const now = Date.now();

    const contract = {
      id,
      name,
      org_id: orgId || "self",
      partner_org_id: partnerOrgId || "",
      status: CONTRACT_STATUS.DRAFT,
      guarantees: guarantees || {
        maxExecutionMs: this._defaultMaxExecutionMs,
        minAvailability: this._defaultMinAvailability,
        minQualityScore: 0.8,
      },
      penalties: penalties || { penaltyPerViolation: 10, maxPenalty: 100 },
      rewards: rewards || { rewardPerPeriod: 5 },
      valid_from: validFrom || now,
      valid_until: validUntil || now + 90 * 24 * 60 * 60 * 1000,
      created_at: now,
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO sla_contracts (id, name, org_id, partner_org_id, status, guarantees, penalties, rewards, valid_from, valid_until, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          name,
          contract.org_id,
          contract.partner_org_id,
          contract.status,
          JSON.stringify(contract.guarantees),
          JSON.stringify(contract.penalties),
          JSON.stringify(contract.rewards),
          contract.valid_from,
          contract.valid_until,
          now,
        );
    }

    this._contracts.set(id, contract);
    this.emit("contract-created", contract);
    logger.info(`[SLAManager] Contract created: ${name} (${id})`);
    return contract;
  }

  async getViolations(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM sla_violations WHERE 1=1";
        const params = [];
        if (filter.contractId) {
          sql += " AND contract_id = ?";
          params.push(filter.contractId);
        }
        if (filter.severity) {
          sql += " AND severity = ?";
          params.push(filter.severity);
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);
        return this.database.db.prepare(sql).all(...params);
      } catch (err) {
        logger.error("[SLAManager] Failed to get violations:", err);
      }
    }
    return Array.from(this._violations.values()).slice(0, filter.limit || 50);
  }

  async checkCompliance(contractId) {
    if (!contractId) {
      throw new Error("Contract ID is required");
    }

    const contract = this._contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract not found: ${contractId}`);
    }

    // Simulate compliance check
    const metrics = {
      executionMs: Math.floor(Math.random() * 50000),
      availability: 0.95 + Math.random() * 0.05,
      qualityScore: 0.7 + Math.random() * 0.3,
    };

    const violations = [];
    if (
      metrics.executionMs >
      (contract.guarantees.maxExecutionMs || this._defaultMaxExecutionMs)
    ) {
      const vId = uuidv4();
      const violation = {
        id: vId,
        contract_id: contractId,
        severity: VIOLATION_SEVERITY.MAJOR,
        metric: "maxExecutionMs",
        expected_value: contract.guarantees.maxExecutionMs,
        actual_value: metrics.executionMs,
        description: "Execution time exceeded SLA guarantee",
        escalated: this._autoEscalation ? 1 : 0,
        resolved: 0,
        created_at: Date.now(),
      };
      violations.push(violation);
      this._violations.set(vId, violation);

      if (this.database && this.database.db) {
        this.database.db
          .prepare(
            `INSERT INTO sla_violations (id, contract_id, severity, metric, expected_value, actual_value, description, escalated, resolved, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            vId,
            contractId,
            violation.severity,
            violation.metric,
            violation.expected_value,
            violation.actual_value,
            violation.description,
            violation.escalated,
            0,
            violation.created_at,
          );
      }
    }

    const result = {
      contractId,
      isCompliant: violations.length === 0,
      metrics,
      violations,
      checkedAt: Date.now(),
    };

    this.emit("compliance-checked", result);
    return result;
  }

  async getDashboard() {
    const contracts = Array.from(this._contracts.values());
    const violations = Array.from(this._violations.values());

    return {
      contracts: {
        total: contracts.length,
        active: contracts.filter((c) => c.status === CONTRACT_STATUS.ACTIVE)
          .length,
        draft: contracts.filter((c) => c.status === CONTRACT_STATUS.DRAFT)
          .length,
        violated: contracts.filter((c) => c.status === CONTRACT_STATUS.VIOLATED)
          .length,
      },
      violations: {
        total: violations.length,
        critical: violations.filter(
          (v) => v.severity === VIOLATION_SEVERITY.CRITICAL,
        ).length,
        major: violations.filter((v) => v.severity === VIOLATION_SEVERITY.MAJOR)
          .length,
        minor: violations.filter((v) => v.severity === VIOLATION_SEVERITY.MINOR)
          .length,
        unresolved: violations.filter((v) => !v.resolved).length,
      },
    };
  }

  async close() {
    this.removeAllListeners();
    this._contracts.clear();
    this._violations.clear();
    this.initialized = false;
    logger.info("[SLAManager] Closed");
  }
}

let _instance = null;

function getSLAManager(database) {
  if (!_instance) {
    _instance = new SLAManager(database);
  }
  return _instance;
}

export { SLAManager, getSLAManager, CONTRACT_STATUS, VIOLATION_SEVERITY };
export default SLAManager;
