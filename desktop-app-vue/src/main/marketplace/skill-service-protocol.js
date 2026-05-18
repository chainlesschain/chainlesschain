/**
 * Skill-as-a-Service Protocol
 *
 * Standardized skill service protocol:
 * - Skill description format (input/output/deps/SLA)
 * - EvoMap Gene format integration
 * - Skill discovery registry
 * - Version management
 * - Pipeline DAG composition
 *
 * @module marketplace/skill-service-protocol
 * @version 3.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const SKILL_STATUS = {
  DRAFT: "draft",
  PUBLISHED: "published",
  DEPRECATED: "deprecated",
  ARCHIVED: "archived",
};

class SkillServiceProtocol extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._skills = new Map();
    this._invocations = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_service_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        version TEXT DEFAULT '1.0.0',
        status TEXT DEFAULT 'draft',
        input_schema TEXT,
        output_schema TEXT,
        dependencies TEXT,
        sla TEXT,
        owner_did TEXT,
        gene_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_skill_registry_status ON skill_service_registry(status);
      CREATE INDEX IF NOT EXISTS idx_skill_registry_owner ON skill_service_registry(owner_did);

      CREATE TABLE IF NOT EXISTS skill_invocations (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        caller_did TEXT,
        input_data TEXT,
        output_data TEXT,
        status TEXT DEFAULT 'pending',
        latency_ms INTEGER,
        error TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_skill_invocations_skill ON skill_invocations(skill_id);
      CREATE INDEX IF NOT EXISTS idx_skill_invocations_status ON skill_invocations(status);
    `);
  }

  async initialize() {
    logger.info("[SkillServiceProtocol] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const skills = this.database.db
          .prepare(
            "SELECT * FROM skill_service_registry WHERE status IN ('draft','published') ORDER BY created_at DESC",
          )
          .all();
        for (const s of skills) {
          this._skills.set(s.id, {
            ...s,
            input_schema: s.input_schema ? JSON.parse(s.input_schema) : {},
            output_schema: s.output_schema ? JSON.parse(s.output_schema) : {},
            dependencies: s.dependencies ? JSON.parse(s.dependencies) : [],
            sla: s.sla ? JSON.parse(s.sla) : {},
          });
        }
        logger.info(`[SkillServiceProtocol] Loaded ${skills.length} skills`);
      } catch (err) {
        logger.error("[SkillServiceProtocol] Failed to load skills:", err);
      }
    }
    this.initialized = true;
    logger.info("[SkillServiceProtocol] Initialized");
  }

  async listSkills(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM skill_service_registry WHERE 1=1";
        const params = [];
        if (filter.status) {
          sql += " AND status = ?";
          params.push(filter.status);
        }
        if (filter.ownerDid) {
          sql += " AND owner_did = ?";
          params.push(filter.ownerDid);
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);
        const rows = this.database.db.prepare(sql).all(...params);
        return rows.map((r) => ({
          ...r,
          input_schema: r.input_schema ? JSON.parse(r.input_schema) : {},
          output_schema: r.output_schema ? JSON.parse(r.output_schema) : {},
          dependencies: r.dependencies ? JSON.parse(r.dependencies) : [],
          sla: r.sla ? JSON.parse(r.sla) : {},
        }));
      } catch (err) {
        logger.error("[SkillServiceProtocol] Failed to list skills:", err);
      }
    }
    let skills = Array.from(this._skills.values());
    if (filter.status) {
      skills = skills.filter((s) => s.status === filter.status);
    }
    return skills.slice(0, filter.limit || 50);
  }

  async publishSkill({
    name,
    description,
    version,
    inputSchema,
    outputSchema,
    dependencies,
    sla,
    ownerDid,
    geneId,
  } = {}) {
    if (!name) {
      throw new Error("Skill name is required");
    }
    const id = uuidv4();
    const now = Date.now();
    const skill = {
      id,
      name,
      description: description || "",
      version: version || "1.0.0",
      status: SKILL_STATUS.PUBLISHED,
      input_schema: inputSchema || {},
      output_schema: outputSchema || {},
      dependencies: dependencies || [],
      sla: sla || { maxLatencyMs: 5000, minAvailability: 0.99 },
      owner_did: ownerDid || "self",
      gene_id: geneId || null,
      created_at: now,
      updated_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO skill_service_registry (id,name,description,version,status,input_schema,output_schema,dependencies,sla,owner_did,gene_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          name,
          skill.description,
          skill.version,
          skill.status,
          JSON.stringify(skill.input_schema),
          JSON.stringify(skill.output_schema),
          JSON.stringify(skill.dependencies),
          JSON.stringify(skill.sla),
          skill.owner_did,
          skill.gene_id,
          now,
          now,
        );
    }
    this._skills.set(id, skill);
    this.emit("skill-published", skill);
    logger.info(`[SkillServiceProtocol] Skill published: ${name} (${id})`);
    return skill;
  }

  async invokeRemote({ skillId, input, callerDid } = {}) {
    if (!skillId) {
      throw new Error("Skill ID is required");
    }
    const skill = this._skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    const invocationId = uuidv4();
    const startTime = Date.now();
    // Simulate remote invocation
    const output = { result: `Executed ${skill.name}`, input };
    const latencyMs = Date.now() - startTime;
    const invocation = {
      id: invocationId,
      skill_id: skillId,
      caller_did: callerDid || "self",
      input_data: input,
      output_data: output,
      status: "completed",
      latency_ms: latencyMs,
      error: null,
      created_at: Date.now(),
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO skill_invocations (id,skill_id,caller_did,input_data,output_data,status,latency_ms,error,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          invocationId,
          skillId,
          invocation.caller_did,
          JSON.stringify(input),
          JSON.stringify(output),
          invocation.status,
          latencyMs,
          null,
          invocation.created_at,
        );
    }
    this._invocations.set(invocationId, invocation);
    this.emit("skill-invoked", invocation);
    return invocation;
  }

  async getVersions(skillName) {
    if (!skillName) {
      throw new Error("Skill name is required");
    }
    if (this.database && this.database.db) {
      try {
        return this.database.db
          .prepare(
            "SELECT * FROM skill_service_registry WHERE name = ? ORDER BY created_at DESC",
          )
          .all(skillName);
      } catch (err) {
        logger.error("[SkillServiceProtocol] Failed to get versions:", err);
      }
    }
    return Array.from(this._skills.values()).filter(
      (s) => s.name === skillName,
    );
  }

  async composePipeline({ name, steps } = {}) {
    if (!name) {
      throw new Error("Pipeline name is required");
    }
    if (!steps || steps.length === 0) {
      throw new Error("Pipeline steps are required");
    }
    // Validate all skills exist
    for (const step of steps) {
      if (!this._skills.has(step.skillId)) {
        throw new Error(`Skill not found in pipeline: ${step.skillId}`);
      }
    }
    const pipeline = {
      id: uuidv4(),
      name,
      steps,
      status: "created",
      created_at: Date.now(),
    };
    this.emit("pipeline-composed", pipeline);
    logger.info(
      `[SkillServiceProtocol] Pipeline composed: ${name} (${steps.length} steps)`,
    );
    return pipeline;
  }

  buildSkillProtocolContext() {
    const skills = Array.from(this._skills.values()).filter(
      (s) => s.status === "published",
    );
    if (skills.length === 0) {
      return null;
    }
    const top5 = skills.slice(0, 5);
    return `[Skill-as-a-Service] ${skills.length} published skills available. Top: ${top5.map((s) => s.name).join(", ")}`;
  }

  async close() {
    this.removeAllListeners();
    this._skills.clear();
    this._invocations.clear();
    this.initialized = false;
    logger.info("[SkillServiceProtocol] Closed");
  }
}

let _instance = null;
function getSkillServiceProtocol(database) {
  if (!_instance) {
    _instance = new SkillServiceProtocol(database);
  }
  return _instance;
}

export { SkillServiceProtocol, getSkillServiceProtocol, SKILL_STATUS };
export default SkillServiceProtocol;
