/**
 * Inference Node Registry
 *
 * GPU/CPU node registration and management:
 * - Node registration with benchmarks
 * - SLA tracking per node
 * - Heartbeat monitoring
 * - Capability discovery
 *
 * @module ai-engine/inference/inference-node-registry
 * @version 3.1.0
 */

import { logger } from "../../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const NODE_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  BUSY: "busy",
  MAINTENANCE: "maintenance",
};

class InferenceNodeRegistry extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._nodes = new Map();
    this._heartbeatInterval = 30000;
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS inference_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        endpoint TEXT,
        status TEXT DEFAULT 'offline',
        gpu_model TEXT,
        gpu_memory_gb REAL,
        cpu_cores INTEGER,
        ram_gb REAL,
        supported_models TEXT,
        benchmark_score REAL,
        max_batch_size INTEGER DEFAULT 1,
        current_load REAL DEFAULT 0.0,
        last_heartbeat INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_inference_nodes_status ON inference_nodes(status);

      CREATE TABLE IF NOT EXISTS inference_tasks (
        id TEXT PRIMARY KEY,
        node_id TEXT,
        model TEXT NOT NULL,
        input_data TEXT,
        output_data TEXT,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        latency_ms INTEGER,
        tokens_used INTEGER,
        privacy_mode TEXT DEFAULT 'standard',
        error TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_inference_tasks_status ON inference_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_inference_tasks_node ON inference_tasks(node_id);
    `);
  }

  async initialize() {
    logger.info("[InferenceNodeRegistry] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const nodes = this.database.db
          .prepare("SELECT * FROM inference_nodes ORDER BY created_at DESC")
          .all();
        for (const n of nodes) {
          this._nodes.set(n.id, {
            ...n,
            supported_models: n.supported_models
              ? JSON.parse(n.supported_models)
              : [],
          });
        }
        logger.info(`[InferenceNodeRegistry] Loaded ${nodes.length} nodes`);
      } catch (err) {
        logger.error("[InferenceNodeRegistry] Failed to load nodes:", err);
      }
    }
    this.initialized = true;
    logger.info("[InferenceNodeRegistry] Initialized");
  }

  async registerNode({
    name,
    endpoint,
    gpuModel,
    gpuMemoryGb,
    cpuCores,
    ramGb,
    supportedModels,
    benchmarkScore,
    maxBatchSize,
  } = {}) {
    if (!name) {
      throw new Error("Node name is required");
    }
    const id = uuidv4();
    const now = Date.now();
    const node = {
      id,
      name,
      endpoint: endpoint || "",
      status: NODE_STATUS.ONLINE,
      gpu_model: gpuModel || null,
      gpu_memory_gb: gpuMemoryGb || 0,
      cpu_cores: cpuCores || 1,
      ram_gb: ramGb || 0,
      supported_models: supportedModels || [],
      benchmark_score: benchmarkScore || 0,
      max_batch_size: maxBatchSize || 1,
      current_load: 0.0,
      last_heartbeat: now,
      created_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO inference_nodes (id,name,endpoint,status,gpu_model,gpu_memory_gb,cpu_cores,ram_gb,supported_models,benchmark_score,max_batch_size,current_load,last_heartbeat,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          name,
          node.endpoint,
          node.status,
          node.gpu_model,
          node.gpu_memory_gb,
          node.cpu_cores,
          node.ram_gb,
          JSON.stringify(node.supported_models),
          node.benchmark_score,
          node.max_batch_size,
          0.0,
          now,
          now,
        );
    }
    this._nodes.set(id, node);
    this.emit("node-registered", node);
    logger.info(`[InferenceNodeRegistry] Node registered: ${name} (${id})`);
    return node;
  }

  async listNodes(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM inference_nodes WHERE 1=1";
        const params = [];
        if (filter.status) {
          sql += " AND status = ?";
          params.push(filter.status);
        }
        sql += " ORDER BY benchmark_score DESC LIMIT ?";
        params.push(filter.limit || 50);
        const rows = this.database.db.prepare(sql).all(...params);
        return rows.map((r) => ({
          ...r,
          supported_models: r.supported_models
            ? JSON.parse(r.supported_models)
            : [],
        }));
      } catch (err) {
        logger.error("[InferenceNodeRegistry] Failed to list nodes:", err);
      }
    }
    let nodes = Array.from(this._nodes.values());
    if (filter.status) {
      nodes = nodes.filter((n) => n.status === filter.status);
    }
    return nodes.slice(0, filter.limit || 50);
  }

  async getNetworkStats() {
    const nodes = Array.from(this._nodes.values());
    return {
      totalNodes: nodes.length,
      onlineNodes: nodes.filter((n) => n.status === NODE_STATUS.ONLINE).length,
      totalGpuMemoryGb: nodes.reduce(
        (sum, n) => sum + (n.gpu_memory_gb || 0),
        0,
      ),
      avgBenchmarkScore:
        nodes.length > 0
          ? nodes.reduce((sum, n) => sum + (n.benchmark_score || 0), 0) /
            nodes.length
          : 0,
      avgLoad:
        nodes.length > 0
          ? nodes.reduce((sum, n) => sum + (n.current_load || 0), 0) /
            nodes.length
          : 0,
    };
  }

  async close() {
    this.removeAllListeners();
    this._nodes.clear();
    this.initialized = false;
    logger.info("[InferenceNodeRegistry] Closed");
  }
}

let _instance = null;
function getInferenceNodeRegistry(database) {
  if (!_instance) {
    _instance = new InferenceNodeRegistry(database);
  }
  return _instance;
}

export { InferenceNodeRegistry, getInferenceNodeRegistry, NODE_STATUS };
export default InferenceNodeRegistry;
