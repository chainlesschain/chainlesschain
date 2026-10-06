"use strict";

const { randomUUID } = require("node:crypto");

const ENTITY_TABLES = Object.freeze({
  event: "events",
  person: "persons",
  place: "places",
  item: "items",
  topic: "topics",
});
const TARGETS = Object.freeze(["rag", "kg"]);
const DEFAULT_TRANSFORM_VERSIONS = Object.freeze({
  rag: "pdh-rag-v1",
  kg: "pdh-kg-v1",
});
const REFERENCES = Object.freeze({
  event: [
    ["person", "actor"],
    ["person", "participants", true],
    ["place", "place"],
    ["item", "items", true],
    ["topic", "topics", true],
  ],
  person: [],
  place: [],
  item: [["person", "merchant"]],
  topic: [
    ["topic", "parent_topic"],
    ["event", "derived_from_events", true],
  ],
});

function identifier(value, label) {
  if (typeof value !== "string" || !value.length || value.length > 1024) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function validateEntityType(type) {
  if (!Object.hasOwn(ENTITY_TABLES, type)) {
    throw new TypeError("Unknown derivation entity type");
  }
  return type;
}

function selectedTargets(targets = TARGETS) {
  if (
    !Array.isArray(targets) ||
    targets.some((target) => !TARGETS.includes(target))
  ) {
    throw new TypeError("Derivation targets must be rag or kg");
  }
  return [...new Set(targets)];
}

function boundedLimit(value = 100) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new RangeError("Derivation limit must be between 1 and 1000");
  }
  return value;
}

// Consumer lifecycle is separate from source intent. Retired generation markers
// deliberately survive receipt pruning so their IDs can never schedule a replay.
function installConsumerRetentionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS derivation_consumers (
      consumer_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('ephemeral', 'persistent')),
      state TEXT NOT NULL CHECK (state IN ('active', 'retired')),
      retirement_token TEXT,
      registered_at INTEGER NOT NULL,
      retired_at INTEGER,
      CHECK (kind = 'ephemeral' OR state = 'active'),
      CHECK ((state = 'active' AND retired_at IS NULL)
        OR (state = 'retired' AND retired_at IS NOT NULL))
    );
  `);
}

// This ledger lives in the same encrypted database as the source entities.
// Triggers guarantee that no source commit can outrun its projection intent,
// including direct putEntity calls and source-identity conflict updates.
// Payloads remain in the canonical tables; tombstones retain identity only.
function installDerivationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS derivation_sources (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
      adapter TEXT NOT NULL,
      scope TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );
    CREATE TABLE IF NOT EXISTS derivation_deliveries (
      consumer_id TEXT NOT NULL,
      target TEXT NOT NULL CHECK (target IN ('rag', 'kg')),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      transform_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','unsupported')),
      attempts INTEGER NOT NULL,
      claim_token TEXT,
      error_code TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (consumer_id, target, entity_type, entity_id),
      FOREIGN KEY (entity_type, entity_id) REFERENCES derivation_sources(entity_type, entity_id)
    );
    CREATE TABLE IF NOT EXISTS derivation_dependencies (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      referenced_type TEXT NOT NULL,
      referenced_id TEXT NOT NULL,
      PRIMARY KEY(entity_type,entity_id,referenced_type,referenced_id)
    );
    CREATE INDEX IF NOT EXISTS idx_derivation_dependencies_reference
      ON derivation_dependencies(referenced_type, referenced_id);
    CREATE INDEX IF NOT EXISTS idx_derivation_sources_scope ON derivation_sources(adapter, scope);
    CREATE INDEX IF NOT EXISTS idx_derivation_delivery_status ON derivation_deliveries(consumer_id, status);
  `);
  for (const [type, table] of Object.entries(ENTITY_TABLES)) {
    db.exec(`INSERT OR IGNORE INTO derivation_sources
      (entity_type, entity_id, revision, operation, adapter, scope, updated_at)
      SELECT '${type}', id, 1, 'upsert', source_adapter, source_scope, ingested_at FROM ${table}`);
    for (const [referencedType, column, array] of REFERENCES[type]) {
      db.exec(`INSERT INTO derivation_dependencies
        (entity_type,entity_id,referenced_type,referenced_id)
        SELECT '${type}',e.id,'${referencedType}',${array ? "j.value" : `e.${column}`}
        FROM ${table} e ${array ? `JOIN json_each(CASE WHEN json_valid(e.${column}) THEN e.${column} ELSE '[]' END) j` : ""}
        WHERE ${array ? "j.type='text' AND length(j.value)>0" : `e.${column} IS NOT NULL AND length(e.${column})>0`}
        ON CONFLICT DO NOTHING`);
    }
    for (const action of ["INSERT", "UPDATE", "DELETE"]) {
      const row = action === "DELETE" ? "OLD" : "NEW";
      const operation = action === "DELETE" ? "delete" : "upsert";
      const refreshReferences =
        action === "DELETE"
          ? ""
          : REFERENCES[type]
              .map(
                ([referencedType, column, array]) =>
                  `INSERT INTO derivation_dependencies (entity_type,entity_id,referenced_type,referenced_id)
        SELECT '${type}',NEW.id,'${referencedType}',${array ? "value" : `NEW.${column}`}
        ${array ? `FROM json_each(CASE WHEN json_valid(NEW.${column}) THEN NEW.${column} ELSE '[]' END) WHERE type='text' AND length(value)>0` : `WHERE NEW.${column} IS NOT NULL AND length(NEW.${column})>0`}
        ON CONFLICT DO NOTHING;`,
              )
              .join("\n");
      db.exec(`CREATE TRIGGER IF NOT EXISTS pdh_derive_${table}_${action.toLowerCase()}
        AFTER ${action} ON ${table} BEGIN
          DELETE FROM derivation_dependencies WHERE entity_type='${type}' AND entity_id=${row}.id;
          ${refreshReferences}
          INSERT INTO derivation_sources
            (entity_type, entity_id, revision, operation, adapter, scope, updated_at)
          VALUES ('${type}', ${row}.id, 1, '${operation}', ${row}.source_adapter,
            ${row}.source_scope, CAST(strftime('%s','now') AS INTEGER) * 1000)
          ON CONFLICT(entity_type, entity_id) DO UPDATE SET
            revision = derivation_sources.revision + 1,
            operation = excluded.operation, adapter = excluded.adapter,
            scope = excluded.scope, updated_at = excluded.updated_at;
          UPDATE derivation_sources SET revision=revision+1,
            updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
          WHERE operation='upsert' AND EXISTS (
            SELECT 1 FROM derivation_dependencies dependency
            WHERE dependency.referenced_type='${type}' AND dependency.referenced_id=${row}.id
              AND dependency.entity_type=derivation_sources.entity_type
              AND dependency.entity_id=derivation_sources.entity_id
          );
        END`);
    }
  }
}

const EFFECTIVE_STATUS = `CASE
  WHEN d.status = 'running' THEN 'running'
  WHEN d.revision = s.revision AND d.transform_version = t.transform_version THEN d.status
  ELSE 'pending' END`;

class DerivationStore {
  constructor(db) {
    this.db = db;
  }

  getConsumer(consumerId) {
    identifier(consumerId, "consumerId");
    return (
      this.db
        .prepare(
          `SELECT consumer_id AS consumerId,kind,state,
          registered_at AS registeredAt,retired_at AS retiredAt
          FROM derivation_consumers WHERE consumer_id=?`,
        )
        .get(consumerId) || null
    );
  }

  listConsumers({ state, kind, afterConsumerId, limit = 100 } = {}) {
    boundedLimit(limit);
    const clauses = [];
    const params = [];
    for (const [column, value, allowed] of [
      ["state", state, ["active", "retired"]],
      ["kind", kind, ["ephemeral", "persistent"]],
    ]) {
      if (value === undefined) continue;
      if (!allowed.includes(value))
        throw new TypeError(`Invalid consumer ${column}`);
      clauses.push(`${column}=?`);
      params.push(value);
    }
    if (afterConsumerId !== undefined) {
      clauses.push("consumer_id>?");
      params.push(identifier(afterConsumerId, "afterConsumerId"));
    }
    return this.db
      .prepare(
        `SELECT consumer_id AS consumerId,kind,state,
      registered_at AS registeredAt,retired_at AS retiredAt
      FROM derivation_consumers ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY consumer_id LIMIT ?`,
      )
      .all(...params, limit);
  }

  // Inventory includes pre-lifecycle receipts. Absence of a live process cannot
  // be inferred from age; these records remain active with unknown liveness.
  auditConsumers({ afterConsumerId, limit = 100 } = {}) {
    boundedLimit(limit);
    if (afterConsumerId !== undefined)
      identifier(afterConsumerId, "afterConsumerId");
    return this.db.transaction(() => {
      const ids = this.db
        .prepare(
          `SELECT consumer_id FROM (
        SELECT consumer_id FROM derivation_consumers
        UNION SELECT consumer_id FROM derivation_deliveries
      ) WHERE consumer_id > ? ORDER BY consumer_id LIMIT ?`,
        )
        .all(afterConsumerId ?? "", limit + 1);
      const hasMore = ids.length > limit;
      const consumers = ids
        .slice(0, limit)
        .map(({ consumer_id: consumerId }) => {
          const consumer = this.getConsumer(consumerId);
          const receipts = this.db
            .prepare(
              `SELECT COUNT(*) AS total,
          COALESCE(SUM(status='running'),0) AS running,
          MIN(updated_at) AS oldestUpdatedAt, MAX(updated_at) AS newestUpdatedAt
          FROM derivation_deliveries WHERE consumer_id=?`,
            )
            .get(consumerId);
          const eligible =
            consumer?.kind === "ephemeral" && consumer.state === "retired";
          return {
            consumerId,
            kind: consumer?.kind ?? "unknown",
            state: consumer?.state ?? "unregistered",
            registeredAt: consumer?.registeredAt ?? null,
            retiredAt: consumer?.retiredAt ?? null,
            liveness: "unknown",
            reviewReason: !consumer
              ? "unregistered-history"
              : consumer.state === "active" && consumer.kind === "ephemeral"
                ? "active-process-unverified"
                : receipts.running
                  ? "unresolved-running"
                  : null,
            retentionReason: !consumer
              ? "unknown-consumer-kind"
              : consumer.kind === "persistent"
                ? "persistent-index"
                : consumer.state === "active"
                  ? "active-generation"
                  : "retired-generation",
            receipts,
            prunableReceipts: eligible ? receipts.total - receipts.running : 0,
          };
        });
      return {
        consumers,
        hasMore,
        nextAfterConsumerId: hasMore ? consumers.at(-1).consumerId : null,
      };
    })();
  }

  registerConsumer({ consumerId, kind } = {}) {
    identifier(consumerId, "consumerId");
    if (!["ephemeral", "persistent"].includes(kind)) {
      throw new TypeError("Consumer kind must be ephemeral or persistent");
    }
    return this.db
      .transaction(() => {
        const existing = this.getConsumer(consumerId);
        if (existing) {
          if (existing.kind === "persistent" && kind === "persistent")
            return existing;
          throw new Error("Derivation consumer ID is already registered");
        }
        // An old, unclassified generation may have been a persistent sink. Only
        // persistent registration may adopt its existing receipts.
        if (
          kind === "ephemeral" &&
          this.db
            .prepare(
              "SELECT 1 FROM derivation_deliveries WHERE consumer_id=? LIMIT 1",
            )
            .get(consumerId)
        ) {
          throw new Error(
            "Existing derivation receipts cannot be classified as ephemeral",
          );
        }
        const retirementToken = kind === "ephemeral" ? randomUUID() : null;
        this.db
          .prepare(
            `INSERT INTO derivation_consumers
        (consumer_id,kind,state,retirement_token,registered_at,retired_at)
        VALUES (?,?,'active',?,?,NULL)`,
          )
          .run(consumerId, kind, retirementToken, Date.now());
        return {
          ...this.getConsumer(consumerId),
          ...(retirementToken ? { retirementToken } : {}),
        };
      })
      .immediate();
  }

  retireConsumer({ consumerId, retirementToken } = {}) {
    identifier(consumerId, "consumerId");
    identifier(retirementToken, "retirementToken");
    return this.db
      .transaction(() => {
        const consumer = this.db
          .prepare(
            "SELECT kind,state,retirement_token FROM derivation_consumers WHERE consumer_id=?",
          )
          .get(consumerId);
        if (
          consumer?.kind !== "ephemeral" ||
          consumer.retirement_token !== retirementToken
        ) {
          throw new Error(
            "Retirement requires the registered ephemeral consumer handle",
          );
        }
        if (consumer.state === "active") {
          this.db
            .prepare(
              `UPDATE derivation_consumers SET state='retired',retired_at=?
          WHERE consumer_id=?`,
            )
            .run(Date.now(), consumerId);
        }
        return this.getConsumer(consumerId);
      })
      .immediate();
  }

  pruneRetiredConsumers({
    consumerIds,
    activeConsumerId,
    limit = 100,
    dryRun = false,
  } = {}) {
    if (!dryRun || activeConsumerId !== undefined)
      identifier(activeConsumerId, "activeConsumerId");
    boundedLimit(limit);
    if (typeof dryRun !== "boolean")
      throw new TypeError("dryRun must be boolean");
    if (
      !Array.isArray(consumerIds) ||
      consumerIds.length < 1 ||
      consumerIds.length > 100
    ) {
      throw new RangeError("Select between 1 and 100 retired consumer IDs");
    }
    const selected = [
      ...new Set(consumerIds.map((id) => identifier(id, "consumerId"))),
    ];
    return this.db
      .transaction(() => {
        if (!dryRun && this.getConsumer(activeConsumerId)?.state !== "active") {
          throw new Error("Pruning requires a registered active consumer");
        }
        for (const id of selected) {
          const consumer = this.getConsumer(id);
          if (
            id === activeConsumerId ||
            consumer?.kind !== "ephemeral" ||
            consumer.state !== "retired"
          ) {
            throw new Error(
              "Only explicitly retired ephemeral consumers can be pruned",
            );
          }
        }
        const placeholders = selected.map(() => "?").join(",");
        if (dryRun) {
          const counts = this.db
            .prepare(
              `SELECT COUNT(*) AS total,
            COALESCE(SUM(status='running'),0) AS running
            FROM derivation_deliveries WHERE consumer_id IN (${placeholders})`,
            )
            .get(...selected);
          return {
            dryRun: true,
            selectedConsumers: selected.length,
            receiptBudget: limit,
            wouldDeleteReceipts: Math.min(limit, counts.total - counts.running),
            retainedRunning: counts.running,
            remainingReceipts: counts.total,
            deletedReceipts: 0,
          };
        }
        const deleted = this.db
          .prepare(
            `DELETE FROM derivation_deliveries WHERE rowid IN (
        SELECT rowid FROM derivation_deliveries
        WHERE consumer_id IN (${placeholders}) AND status <> 'running'
        ORDER BY updated_at,consumer_id,target,entity_type,entity_id LIMIT ?
      )`,
          )
          .run(...selected, limit);
        const remaining = this.db
          .prepare(
            `SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status='running' THEN 1 ELSE 0 END),0) AS running
        FROM derivation_deliveries WHERE consumer_id IN (${placeholders})`,
          )
          .get(...selected);
        return {
          selectedConsumers: selected.length,
          deletedReceipts: deleted.changes,
          remainingReceipts: remaining.total,
          retainedRunning: remaining.running,
        };
      })
      .immediate();
  }

  _query({
    consumerId,
    targets,
    adapter,
    scope,
    transformVersions = DEFAULT_TRANSFORM_VERSIONS,
  } = {}) {
    identifier(consumerId, "consumerId");
    const selected = selectedTargets(targets);
    const clauses = [
      "NOT EXISTS (SELECT 1 FROM derivation_consumers c WHERE c.consumer_id=? AND c.state='retired')",
    ];
    const params = [consumerId, consumerId];
    if (adapter !== undefined) {
      identifier(adapter, "adapter");
      clauses.push("s.adapter = ?");
      params.push(adapter);
    }
    if (scope !== undefined) {
      if (typeof scope !== "string" || scope.length > 4096)
        throw new TypeError("Invalid scope");
      clauses.push("s.scope = ?");
      params.push(scope);
    }
    const targetSql = selected.length
      ? selected
          .map((target) => {
            const version = transformVersions[target];
            if (
              typeof version !== "string" ||
              !/^[a-zA-Z0-9._:-]{1,80}$/.test(version)
            )
              throw new TypeError("Invalid transform version");
            return `SELECT '${target}' AS target, '${version}' AS transform_version`;
          })
          .join(" UNION ALL ")
      : "SELECT 'rag' AS target, 'unused' AS transform_version WHERE 0";
    return {
      from: `FROM derivation_sources s CROSS JOIN (${targetSql}) t
        LEFT JOIN derivation_deliveries d ON d.entity_type=s.entity_type AND d.entity_id=s.entity_id
        AND d.target=t.target AND d.consumer_id=?`,
      where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
      params,
    };
  }

  listPending(options = {}) {
    const query = this._query(options);
    const limit = boundedLimit(options.limit);
    const where = query.where ? `${query.where} AND` : " WHERE";
    return this.db
      .prepare(
        `SELECT s.entity_type AS entityType, s.entity_id AS entityId,
      s.revision, s.operation, s.adapter, s.scope, t.target, ${EFFECTIVE_STATUS} AS status
      ${query.from}${where} ${EFFECTIVE_STATUS} NOT IN ('succeeded', 'running')
      ORDER BY COALESCE(d.updated_at, 0), s.updated_at, s.entity_type, s.entity_id, t.target LIMIT ?`,
      )
      .all(...query.params, limit);
  }

  claim(
    job,
    {
      consumerId,
      target = job.target,
      transformVersion = DEFAULT_TRANSFORM_VERSIONS[target],
    } = {},
  ) {
    identifier(consumerId, "consumerId");
    identifier(transformVersion, "transformVersion");
    validateEntityType(job.entityType);
    identifier(job.entityId, "entityId");
    selectedTargets([target]);
    return this.db
      .transaction(() => {
        if (this.getConsumer(consumerId)?.state === "retired") return null;
        const source = this.db
          .prepare(
            "SELECT * FROM derivation_sources WHERE entity_type=? AND entity_id=?",
          )
          .get(job.entityType, job.entityId);
        if (!source || source.revision !== job.revision) return null;
        const previous = this.db
          .prepare(
            `SELECT * FROM derivation_deliveries
        WHERE consumer_id=? AND target=? AND entity_type=? AND entity_id=?`,
          )
          .get(consumerId, target, job.entityType, job.entityId);
        // Unknown in-flight effects are not reclaimed on a timer. A fresh
        // in-memory index gets a fresh consumer ID and rebuilds independently.
        if (
          previous?.status === "running" ||
          (previous?.revision === source.revision &&
            previous.status === "succeeded" &&
            previous.transform_version === transformVersion)
        )
          return null;
        const token = randomUUID();
        this.db
          .prepare(
            `INSERT INTO derivation_deliveries
        (consumer_id,target,entity_type,entity_id,revision,transform_version,status,attempts,claim_token,error_code,updated_at)
        VALUES (?,?,?,?,?,?,'running',1,?,NULL,?)
        ON CONFLICT(consumer_id,target,entity_type,entity_id) DO UPDATE SET
          revision=excluded.revision,transform_version=excluded.transform_version,status='running',
          attempts=derivation_deliveries.attempts+1,claim_token=excluded.claim_token,error_code=NULL,updated_at=excluded.updated_at`,
          )
          .run(
            consumerId,
            target,
            job.entityType,
            job.entityId,
            source.revision,
            transformVersion,
            token,
            Date.now(),
          );
        return {
          ...job,
          operation: source.operation,
          consumerId,
          target,
          token,
          transformVersion,
        };
      })
      .immediate();
  }

  complete(claim, { success, errorCode = null, unsupported = false } = {}) {
    if (typeof success !== "boolean")
      throw new TypeError("success must be boolean");
    if (errorCode !== null && !/^[A-Z][A-Z0-9_]{0,79}$/.test(errorCode)) {
      throw new TypeError(
        "errorCode must be a bounded code, without source content",
      );
    }
    return this.db
      .transaction(() => {
        const source = this.db
          .prepare(
            "SELECT revision FROM derivation_sources WHERE entity_type=? AND entity_id=?",
          )
          .get(claim.entityType, claim.entityId);
        const current = source?.revision === claim.revision;
        const status = !current
          ? "pending"
          : success
            ? "succeeded"
            : unsupported
              ? "unsupported"
              : "failed";
        const result = this.db
          .prepare(
            `UPDATE derivation_deliveries SET status=?,error_code=?,claim_token=NULL,updated_at=?
        WHERE consumer_id=? AND target=? AND entity_type=? AND entity_id=? AND revision=? AND claim_token=? AND status='running'`,
          )
          .run(
            status,
            errorCode,
            Date.now(),
            claim.consumerId,
            claim.target,
            claim.entityType,
            claim.entityId,
            claim.revision,
            claim.token,
          );
        return result.changes === 1 && current;
      })
      .immediate();
  }

  summary(options = {}) {
    const query = this._query(options);
    const counts = {
      total: 0,
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      unsupported: 0,
    };
    for (const row of this.db
      .prepare(
        `SELECT ${EFFECTIVE_STATUS} AS status,COUNT(*) AS count ${query.from}${query.where} GROUP BY 1`,
      )
      .all(...query.params)) {
      counts[row.status] = row.count;
      counts.total += row.count;
    }
    return counts;
  }

  // An identity/version-only lineage view; callers retain their existing
  // vault authorization boundary. Never return normalized or raw payloads.
  getState(
    entityType,
    entityId,
    { consumerId, transformVersions = DEFAULT_TRANSFORM_VERSIONS } = {},
  ) {
    validateEntityType(entityType);
    identifier(entityId, "entityId");
    identifier(consumerId, "consumerId");
    const source = this.db
      .prepare(
        `SELECT entity_type AS entityType,entity_id AS entityId,revision,operation,adapter,scope,updated_at AS updatedAt
      FROM derivation_sources WHERE entity_type=? AND entity_id=?`,
      )
      .get(entityType, entityId);
    if (!source) return null;
    const consumer = this.getConsumer(consumerId);
    const deliveries = this.db
      .prepare(
        `SELECT target,revision,transform_version AS transformVersion,status,attempts,error_code AS errorCode
      FROM derivation_deliveries WHERE consumer_id=? AND entity_type=? AND entity_id=? ORDER BY target`,
      )
      .all(consumerId, entityType, entityId);
    return {
      ...source,
      consumer,
      deliveries: TARGETS.map((target) => {
        const delivery = deliveries.find((entry) => entry.target === target);
        return {
          target,
          ...(delivery || {}),
          status:
            consumer?.state === "retired"
              ? delivery?.status || "not-retained"
              : delivery?.status === "running"
                ? "running"
                : delivery?.revision === source.revision &&
                    delivery.transformVersion === transformVersions[target]
                  ? delivery.status
                  : "pending",
        };
      }),
    };
  }
}

module.exports = {
  DerivationStore,
  installDerivationSchema,
  installConsumerRetentionSchema,
  validateEntityType,
  ENTITY_TABLES,
};
