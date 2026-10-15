import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { FormalBudgetLineageRegistry } from "./formal-budget-lineage-registry.js";
import {
  budgetError,
  requireBudget,
  canonical,
  evidenceDigest,
  label,
  validateActivation,
  validateRequest,
  validateResponse,
  quoteNative,
  convertToUsd,
} from "./formal-budget-contract.js";

function database(filename) {
  let db;
  try {
    const Database = createRequire(import.meta.url)("better-sqlite3");
    db = new Database(filename, { fileMustExist: true, timeout: 5000 });
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.pragma("foreign_keys = ON");
    return db;
  } catch (cause) {
    try {
      db?.close();
    } catch {
      /* Preserve original storage failure. */
    }
    throw Object.assign(
      budgetError(
        "CC_BUDGET_STORAGE_UNAVAILABLE",
        "Durable budget authority requires the CLI's declared better-sqlite3 dependency and writable SQLite storage",
      ),
      { cause },
    );
  }
}
function checkFile(filename) {
  requireBudget(
    path.isAbsolute(filename),
    "Authority database path must be absolute",
  );
  const stat = fs.lstatSync(filename);
  requireBudget(
    stat.isFile() && !stat.isSymbolicLink(),
    "Authority must be an existing regular database file",
  );
}

function stateDigest(db) {
  return evidenceDigest({
    schema: db
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all(),
    authority: db.prepare("SELECT * FROM authority ORDER BY id").all(),
    tasks: db.prepare("SELECT * FROM task ORDER BY id").all(),
    runs: db.prepare("SELECT * FROM run ORDER BY id").all(),
    calls: db.prepare("SELECT * FROM call ORDER BY id").all(),
    events: db.prepare("SELECT * FROM event ORDER BY sequence").all(),
    guard: db.prepare("SELECT * FROM lineage_guard ORDER BY id").all(),
  });
}

/** Trusted-host service. Task processes must never receive this object or DB access. */
export class FormalBudgetAuthority {
  #db;
  #config;
  #now;
  #registry;
  #binding;
  constructor({
    filename,
    lineageId,
    planDigest,
    activationDigest,
    verifyEvidence,
    now = Date.now,
    lineageRegistry,
    lineageRegistryId,
    lineageRegistryFilename,
    lineageRegistryFileIdentity,
  }) {
    checkFile(filename);
    this.#db = database(filename);
    this.#now = now;
    try {
      const row = this.#db
        .prepare("SELECT config, digest FROM authority WHERE id=1")
        .get();
      requireBudget(
        row && row.digest === activationDigest,
        "Activation receipt differs from pinned authority",
      );
      const config = JSON.parse(row.config);
      requireBudget(
        evidenceDigest(config) === row.digest,
        "Stored activation corrupted",
      );
      requireBudget(
        config.plan.lineageId === lineageId &&
          config.plan.digest === planDigest,
        "Authority lineage/plan mismatch",
      );
      this.#config = validateActivation(config, verifyEvidence, now());
      requireBudget(
        this.#db.pragma("quick_check", { simple: true }) === "ok",
        "Corrupt budget database",
      );
      const hasGuard = this.#db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='lineage_guard'",
        )
        .get();
      const guard = hasGuard
        ? this.#db.prepare("SELECT * FROM lineage_guard WHERE id=1").get()
        : null;
      requireBudget(
        (!lineageRegistryId || guard?.registry_id === lineageRegistryId) &&
          (!lineageRegistryFilename ||
            guard?.registry_filename === lineageRegistryFilename) &&
          (!lineageRegistryFileIdentity ||
            guard?.registry_file_identity === lineageRegistryFileIdentity),
        "Pinned lineage guard is missing or changed",
        "CC_BUDGET_LINEAGE_IDENTITY",
      );
      if (hasGuard || lineageRegistry) {
        requireBudget(
          guard && lineageRegistry instanceof FormalBudgetLineageRegistry,
          "Guarded authority requires its independent host-owned registry",
          "CC_BUDGET_LINEAGE_REQUIRED",
        );
        requireBudget(
          guard.registry_id === lineageRegistry.registryId &&
            guard.registry_filename ===
              lineageRegistry.bindingIdentity.filename &&
            guard.registry_file_identity ===
              lineageRegistry.bindingIdentity.fileIdentity &&
            (guard.checkpoint_host_id ?? null) ===
              lineageRegistry.checkpointHostId,
          "Independent registry physical identity differs from the authority binding; no automatic migration",
          "CC_BUDGET_LINEAGE_IDENTITY",
        );
        this.#registry = lineageRegistry;
        this.#binding = {
          filename,
          lineageId,
          planDigest,
          activationDigest,
          bindingId: guard.binding_id,
        };
        this.#transaction(() => {});
      }
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  static initialize({
    filename,
    config,
    verifyEvidence,
    now = Date.now,
    lineageRegistry,
  }) {
    const checked = validateActivation(config, verifyEvidence, now());
    requireBudget(
      path.isAbsolute(filename),
      "Authority database path must be absolute",
    );
    requireBudget(
      !lineageRegistry ||
        lineageRegistry instanceof FormalBudgetLineageRegistry,
      "Trusted lineage registry required",
      "CC_BUDGET_LINEAGE_REQUIRED",
    );
    const initialize = (guard) => {
      // Explicit creation only. Opening a missing database never starts a fresh lineage.
      const fd = fs.openSync(filename, "wx", 0o600);
      fs.closeSync(fd);
      const db = database(filename);
      try {
        db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE authority(id INTEGER PRIMARY KEY CHECK(id=1),config TEXT NOT NULL,digest TEXT NOT NULL,halted TEXT);
        CREATE TABLE task(id TEXT PRIMARY KEY,cap INTEGER NOT NULL,historical_spent INTEGER NOT NULL,historical_reserved INTEGER NOT NULL,slots INTEGER NOT NULL);
        CREATE TABLE run(id TEXT PRIMARY KEY,task TEXT NOT NULL REFERENCES task(id),phase TEXT NOT NULL,status TEXT NOT NULL);
        CREATE TABLE call(id TEXT PRIMARY KEY,run TEXT NOT NULL REFERENCES run(id),contract TEXT NOT NULL,request_digest TEXT NOT NULL,state TEXT NOT NULL,reserved_usd INTEGER NOT NULL,reserved_native INTEGER NOT NULL,currency TEXT NOT NULL,cost_usd INTEGER,cost_native INTEGER,receipt_digest TEXT,receipt TEXT);
        CREATE TABLE event(sequence INTEGER PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL);`);
        if (guard) {
          db.exec(
            "CREATE TABLE lineage_guard(id INTEGER PRIMARY KEY CHECK(id=1),registry_id TEXT NOT NULL,binding_id TEXT NOT NULL,registry_filename TEXT NOT NULL,registry_file_identity TEXT NOT NULL,checkpoint_host_id TEXT)",
          );
          db.prepare("INSERT INTO lineage_guard VALUES (1,?,?,?,?,?)").run(
            guard.registryId,
            guard.bindingId,
            guard.registryFilename,
            guard.registryFileIdentity,
            guard.checkpointHostId,
          );
        }
        const halted = checked.history.tasks.some((t) => t.unknown)
          ? "unreconciled historical liability"
          : null;
        db.prepare("INSERT INTO authority VALUES (1,?,?,?)").run(
          canonical(checked),
          evidenceDigest(checked),
          halted,
        );
        for (const task of checked.plan.tasks) {
          const history = checked.history.tasks.find((t) => t.id === task.id);
          db.prepare("INSERT INTO task VALUES (?,?,?,?,?)").run(
            task.id,
            task.capUsdMicros,
            history.spentUsdMicros,
            history.reservedUsdMicros,
            history.runsUsed,
          );
        }
        db.prepare("INSERT INTO event(kind,body) VALUES (?,?)").run(
          "initialized",
          canonical({ activationDigest: evidenceDigest(checked), at: now() }),
        );
        db.exec("COMMIT");
        return guard ? stateDigest(db) : null;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* retain incomplete DB; never silently reset */
        }
        throw error;
      } finally {
        db.close();
      }
    };
    if (lineageRegistry) {
      lineageRegistry.register(
        {
          filename,
          lineageId: checked.plan.lineageId,
          planDigest: checked.plan.digest,
          activationDigest: evidenceDigest(checked),
        },
        initialize,
      );
    } else initialize(null);
    return {
      filename,
      lineageId: checked.plan.lineageId,
      planDigest: checked.plan.digest,
      activationDigest: evidenceDigest(checked),
      ...(lineageRegistry
        ? {
            lineageRegistryId: lineageRegistry.registryId,
            lineageRegistryFilename: lineageRegistry.bindingIdentity.filename,
            lineageRegistryFileIdentity:
              lineageRegistry.bindingIdentity.fileIdentity,
          }
        : {}),
    };
  }

  #transaction(action) {
    const transact = (lease) => {
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        lease?.assertState(stateDigest(this.#db));
        const result = action();
        lease?.advance(stateDigest(this.#db));
        this.#db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.#db.exec("ROLLBACK");
        } catch {
          /* original error */
        }
        throw error;
      }
    };
    return this.#registry
      ? this.#registry.coordinate(this.#binding, transact)
      : transact(null);
  }
  #event(kind, body) {
    this.#db
      .prepare("INSERT INTO event(kind,body) VALUES (?,?)")
      .run(kind, canonical({ ...body, at: this.#now() }));
  }
  #read(action) {
    return this.#registry ? this.#transaction(action) : action();
  }
  #admissible() {
    const { halted } = this.#db
      .prepare("SELECT halted FROM authority WHERE id=1")
      .get();
    requireBudget(!halted, `Authority halted: ${halted}`, "CC_BUDGET_HALTED");
    requireBudget(
      !this.#db
        .prepare("SELECT id FROM call WHERE state!='settled' LIMIT 1")
        .get(),
      "Pending/unknown liability must be reconciled before another dispatch",
      "CC_BUDGET_PENDING",
    );
  }
  #contract(id) {
    const contract = this.#config.contracts.find((c) => c.id === id);
    requireBudget(contract, "Unknown contract");
    const fx = this.#config.fx.find(
      (rate) => rate.currency === contract.currency,
    );
    const now = this.#now();
    requireBudget(
      contract.validFrom <= now &&
        now < contract.validUntil &&
        fx.validFrom <= now &&
        now < fx.validUntil,
      "Contract or FX expired",
      "CC_BUDGET_EXPIRED",
    );
    return { contract, fx };
  }
  #exposure(taskId = null) {
    const historical = taskId
      ? this.#db
          .prepare(
            "SELECT historical_spent+historical_reserved AS value FROM task WHERE id=?",
          )
          .get(taskId).value
      : this.#db
          .prepare(
            "SELECT sum(historical_spent+historical_reserved) AS value FROM task",
          )
          .get().value;
    const calls = taskId
      ? this.#db
          .prepare(
            "SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) AS value FROM call JOIN run ON run.id=call.run WHERE run.task=?",
          )
          .get(taskId).value
      : this.#db
          .prepare(
            "SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) AS value FROM call",
          )
          .get().value;
    return historical + calls;
  }
  beginRun({ taskId, runId, phase }) {
    label(taskId, "task ID");
    label(runId, "run ID");
    requireBudget(
      ["initial", "remediation"].includes(phase),
      "Unknown run phase",
    );
    return this.#transaction(() => {
      const existing = this.#db
        .prepare("SELECT * FROM run WHERE id=?")
        .get(runId);
      if (existing) {
        requireBudget(
          existing.task === taskId &&
            existing.phase === phase &&
            existing.status === "active",
          "Run identity conflict or already closed",
        );
        return { runId, resumed: true };
      }
      this.#admissible();
      const task = this.#db
        .prepare("SELECT * FROM task WHERE id=?")
        .get(taskId);
      requireBudget(task, "Unknown task");
      requireBudget(
        task.slots === (phase === "initial" ? 0 : 1),
        "Only initial plus one remediation permitted",
        "CC_BUDGET_RUN_LIMIT",
      );
      requireBudget(
        !this.#db
          .prepare("SELECT id FROM run WHERE task=? AND status='active'")
          .get(taskId),
        "Prior run must close before remediation",
      );
      this.#db
        .prepare("INSERT INTO run VALUES (?,?,?,'active')")
        .run(runId, taskId, phase);
      this.#db.prepare("UPDATE task SET slots=slots+1 WHERE id=?").run(taskId);
      this.#event("run-start", { taskId, runId, phase });
      return { runId, resumed: false };
    });
  }
  finishRun(runId) {
    return this.#transaction(() => {
      this.#admissible();
      requireBudget(
        this.#db
          .prepare(
            "UPDATE run SET status='closed' WHERE id=? AND status='active'",
          )
          .run(runId).changes === 1,
        "Unknown/closed run",
      );
      this.#event("run-close", { runId });
    });
  }
  reserve({ runId, callId, body, endpoint }) {
    label(runId, "run ID");
    label(callId, "physical call ID");
    const request = JSON.parse(canonical(body));
    return this.#transaction(() => {
      this.#admissible();
      requireBudget(
        !this.#db.prepare("SELECT id FROM call WHERE id=?").get(callId),
        "Physical call ID cannot be replayed",
        "CC_BUDGET_CALL_REPLAY",
      );
      const run = this.#db
        .prepare("SELECT * FROM run WHERE id=? AND status='active'")
        .get(runId);
      requireBudget(run, "Active run required");
      const task = this.#config.plan.tasks.find((t) => t.id === run.task);
      const { contract, fx } = this.#contract(task.contractId);
      requireBudget(
        endpoint === undefined || endpoint === contract.endpoint,
        "Requested endpoint differs from the reserved account contract",
        "CC_BUDGET_ENDPOINT_MISMATCH",
      );
      const requestDigest = validateRequest(contract, request);
      const nativeMicros = quoteNative(contract),
        usdMicros = convertToUsd(nativeMicros, fx);
      requireBudget(
        this.#exposure(run.task) + usdMicros <= task.capUsdMicros,
        "Task budget cannot reserve this call",
        "CC_BUDGET_TASK_LIMIT",
      );
      requireBudget(
        this.#exposure() + usdMicros <= this.#config.plan.limitUsdMicros,
        "Lineage budget cannot reserve this call",
        "CC_BUDGET_LINEAGE_LIMIT",
      );
      this.#db
        .prepare(
          "INSERT INTO call(id,run,contract,request_digest,state,reserved_usd,reserved_native,currency) VALUES (?,?,?,?,'held',?,?,?)",
        )
        .run(
          callId,
          runId,
          contract.id,
          requestDigest,
          usdMicros,
          nativeMicros,
          contract.currency,
        );
      this.#event("reserved", {
        callId,
        runId,
        usdMicros,
        nativeMicros,
        currency: contract.currency,
        requestDigest,
      });
      return {
        callId,
        requestDigest,
        reservedUsdMicros: usdMicros,
        reservedNativeMicros: nativeMicros,
        currency: contract.currency,
      };
    });
  }
  reservedContract(callId) {
    return this.#read(() => {
      const call = this.#db
        .prepare("SELECT * FROM call WHERE id=?")
        .get(callId);
      requireBudget(
        call?.state === "held",
        "Physical call is not reserved",
        "CC_BUDGET_CALL_REPLAY",
      );
      const { contract } = this.#contract(call.contract);
      return JSON.parse(canonical(contract));
    });
  }
  markDispatched(callId, body) {
    return this.#transaction(() => {
      requireBudget(
        !this.#db.prepare("SELECT halted FROM authority WHERE id=1").get()
          .halted,
        "Authority halted",
        "CC_BUDGET_HALTED",
      );
      const call = this.#db
        .prepare("SELECT * FROM call WHERE id=?")
        .get(callId);
      requireBudget(
        call?.state === "held",
        "Physical call dispatch already consumed",
        "CC_BUDGET_CALL_REPLAY",
      );
      const { contract } = this.#contract(call.contract);
      requireBudget(
        validateRequest(contract, body) === call.request_digest,
        "Reserved request changed",
      );
      this.#db
        .prepare("UPDATE call SET state='dispatched' WHERE id=?")
        .run(callId);
      this.#event("dispatch", { callId });
      return JSON.parse(canonical(contract));
    });
  }
  markUnknown(callId, reason = "provider outcome unknown") {
    this.#transaction(() => {
      const call = this.#db
        .prepare("SELECT state FROM call WHERE id=?")
        .get(callId);
      requireBudget(
        call && call.state !== "settled",
        "Unknown or settled call",
      );
      this.#db
        .prepare("UPDATE call SET state='unknown' WHERE id=?")
        .run(callId);
      this.#db
        .prepare("UPDATE authority SET halted=? WHERE id=1")
        .run(String(reason).slice(0, 200));
      this.#event("unknown", { callId });
    });
  }
  settle(callId, response) {
    const result = this.#transaction(() => {
      const call = this.#db
        .prepare("SELECT * FROM call WHERE id=?")
        .get(callId);
      requireBudget(call, "Unknown physical call");
      // Never persist response content, prompts, credentials, or hidden reasoning.
      const receipt = {
        id: response?.id ?? null,
        model: response?.model ?? null,
        service_tier: response?.service_tier ?? null,
        usage: response?.usage ?? null,
      };
      if (response && Object.hasOwn(response, "error")) receipt.error = true;
      if (call.state === "settled") {
        let identical = false;
        try {
          identical = evidenceDigest(receipt) === call.receipt_digest;
        } catch {
          /* Non-canonical repeated usage is also a conflict. */
        }
        if (!identical) {
          this.#db
            .prepare(
              "UPDATE call SET state='unknown',cost_usd=NULL,cost_native=NULL WHERE id=?",
            )
            .run(callId);
          this.#db
            .prepare(
              "UPDATE authority SET halted='conflicting provider settlement' WHERE id=1",
            )
            .run();
          this.#event("settlement-conflict", { callId });
          return { conflict: true };
        }
        return {
          costUsdMicros: call.cost_usd,
          costNativeMicros: call.cost_native,
          currency: call.currency,
          duplicate: true,
        };
      }
      requireBudget(
        call.state === "dispatched",
        "Only dispatched known calls can settle; unknown requires external reconciliation",
        "CC_BUDGET_PENDING",
      );
      try {
        // Settlement uses pinned prices even if their dispatch validity just expired.
        const contract = this.#config.contracts.find(
          (c) => c.id === call.contract,
        );
        const fx = this.#config.fx.find(
          (rate) => rate.currency === contract.currency,
        );
        const usage = validateResponse(contract, receipt);
        const native = quoteNative(contract, usage),
          usd = convertToUsd(native, fx);
        requireBudget(
          native <= call.reserved_native && usd <= call.reserved_usd,
          "Actual liability exceeds reservation",
        );
        this.#db
          .prepare(
            "UPDATE call SET state='settled',cost_usd=?,cost_native=?,receipt_digest=?,receipt=? WHERE id=?",
          )
          .run(
            usd,
            native,
            evidenceDigest(receipt),
            canonical(receipt),
            callId,
          );
        this.#event("settled", {
          callId,
          costUsdMicros: usd,
          costNativeMicros: native,
          currency: contract.currency,
        });
        return {
          costUsdMicros: usd,
          costNativeMicros: native,
          currency: contract.currency,
          duplicate: false,
        };
      } catch {
        this.#db
          .prepare("UPDATE call SET state='unknown' WHERE id=?")
          .run(callId);
        this.#db
          .prepare(
            "UPDATE authority SET halted='invalid or unpriced provider usage' WHERE id=1",
          )
          .run();
        this.#event("unknown", { callId });
        return { invalid: true };
      }
    });
    requireBudget(
      !result.conflict,
      "Conflicting settlement restored full reservation and halted authority",
      "CC_BUDGET_SETTLEMENT_CONFLICT",
    );
    requireBudget(
      !result.invalid,
      "Unknown usage retained full reservation; authority halted",
      "CC_BUDGET_UNKNOWN_USAGE",
    );
    return result;
  }
  status() {
    return this.#read(() => ({
      lineageId: this.#config.plan.lineageId,
      planDigest: this.#config.plan.digest,
      capUsdMicros: this.#config.plan.limitUsdMicros,
      exposureUsdMicros: this.#exposure(),
      halted: this.#db.prepare("SELECT halted FROM authority WHERE id=1").get()
        .halted,
      pending: this.#db
        .prepare(
          "SELECT id,state,reserved_usd,reserved_native,currency FROM call WHERE state!='settled'",
        )
        .all(),
    }));
  }
  close() {
    this.#db.close();
  }
}
