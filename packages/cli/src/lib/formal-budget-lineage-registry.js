import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { types } from "node:util";
import {
  budgetError,
  isFormalBudgetError,
  label,
  requireBudget,
} from "./formal-budget-errors.js";

const DIGEST = /^[a-f0-9]{64}$/u;
const FILE_IDENTITY = /^\d+:\d+$/u;
export const FORMAL_BUDGET_LINEAGE_CHECKPOINT_SCHEMA =
  "chainlesschain.formal-budget-lineage-checkpoint/v1";
const IMMUTABLE_HEAD_FIELDS = [
  "lineage_id",
  "binding_id",
  "plan_digest",
  "activation_digest",
  "filename",
  "file_identity",
];
function synchronous(operation, code = "CC_BUDGET_LINEAGE_ASYNC") {
  requireBudget(
    typeof operation === "function" &&
      !types.isAsyncFunction(operation) &&
      !types.isGeneratorFunction(operation),
    "Lineage callbacks must be synchronous functions",
    code,
  );
}
/** Receipt binding only; authentication and durable monotonic storage belong to the host. */
export function lineageCheckpointDigest(checkpoint) {
  const registry = checkpoint.registry;
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema: checkpoint.schema,
        registry: {
          registryId: registry?.registryId,
          filename: registry?.filename,
          fileIdentity: registry?.fileIdentity,
        },
        head: checkedHead(checkpoint.head),
      }),
    )
    .digest("hex");
}
function checkedHead(row) {
  label(row?.lineage_id, "checkpoint lineage ID");
  label(row.binding_id, "checkpoint binding ID");
  requireBudget(
    DIGEST.test(row.plan_digest) &&
      DIGEST.test(row.activation_digest) &&
      DIGEST.test(row.state_digest) &&
      Number.isSafeInteger(row.revision) &&
      row.revision >= 0 &&
      typeof row.filename === "string" &&
      path.isAbsolute(row.filename) &&
      FILE_IDENTITY.test(row.file_identity),
    "Invalid independent lineage head",
    "CC_BUDGET_LINEAGE_CHECKPOINT",
  );
  return Object.fromEntries(
    [...IMMUTABLE_HEAD_FIELDS, "state_digest", "revision"].map((key) => [
      key,
      row[key],
    ]),
  );
}
const canonicalPath = (filename) =>
  process.platform === "win32" ? filename.toLowerCase() : filename;
const unavailable = (cause) =>
  isFormalBudgetError(cause)
    ? cause
    : Object.assign(
        budgetError(
          "CC_BUDGET_LINEAGE_STORAGE",
          "Independent lineage registry is unavailable; budget access denied",
        ),
        { cause },
      );

function identity(filename) {
  requireBudget(
    path.isAbsolute(filename),
    "Absolute registry/authority path required",
  );
  const stat = fs.lstatSync(filename, { bigint: true });
  requireBudget(
    stat.isFile() && !stat.isSymbolicLink() && stat.ino > 0n,
    "Lineage storage requires a regular file with a stable identity",
    "CC_BUDGET_LINEAGE_IDENTITY",
  );
  return {
    filename: canonicalPath(fs.realpathSync(filename)),
    fileIdentity: `${stat.dev}:${stat.ino}`,
  };
}

function openDatabase(filename) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(filename, { fileMustExist: true, timeout: 5000 });
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Trusted-host storage, independently protected from authority backups/tasks.
 * Live observations and independently pinned checkpoints detect older heads;
 * they do not authenticate themselves or replace OS/hardware monotonic storage.
 *
 * initialize({ filename, checkpointHostId }) permanently opts a new registry
 * into a synchronous host port: { id, load(bindingIdentity), publish(head, digest) }.
 * load returns ALL authenticated latest checkpoints for this registry, including
 * after restart; only a genuinely empty registry may have an empty result.
 * publish must keep monotonic, idempotent records independently durable before
 * returning { durable: true, checkpointDigest: digest }. Its acknowledgement is
 * read back before local authority COMMIT. A crash between any stores stops
 * access for external reconciliation; neither missing nor stale heads are seeded.
 * No production host, authentication or storage protection is supplied here.
 */
export class FormalBudgetLineageRegistry {
  #db;
  #identity;
  #id;
  #active = false;
  #observed = new Map();
  #checkpointHost;
  #checkpointHostId = null;

  static initialize({ filename, checkpointHostId = null }) {
    requireBudget(path.isAbsolute(filename), "Absolute registry path required");
    if (checkpointHostId !== null)
      label(checkpointHostId, "checkpoint host ID");
    fs.closeSync(fs.openSync(filename, "wx", 0o600));
    let db;
    try {
      db = openDatabase(filename);
      const registryId = randomUUID();
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE registry_meta(id INTEGER PRIMARY KEY CHECK(id=1),registry_id TEXT NOT NULL);
        CREATE TABLE lineage(lineage_id TEXT PRIMARY KEY,binding_id TEXT NOT NULL UNIQUE,plan_digest TEXT NOT NULL,activation_digest TEXT NOT NULL,filename TEXT NOT NULL UNIQUE,file_identity TEXT NOT NULL,state_digest TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=0));`);
      db.prepare("INSERT INTO registry_meta VALUES (1,?)").run(registryId);
      if (checkpointHostId !== null) {
        db.exec(
          "CREATE TABLE checkpoint_policy(id INTEGER PRIMARY KEY CHECK(id=1),host_id TEXT NOT NULL)",
        );
        db.prepare("INSERT INTO checkpoint_policy VALUES (1,?)").run(
          checkpointHostId,
        );
      }
      db.exec("COMMIT");
      return {
        filename: fs.realpathSync(filename),
        registryId,
        registryFileIdentity: identity(filename).fileIdentity,
        ...(checkpointHostId === null ? {} : { checkpointHostId }),
      };
    } catch (error) {
      throw unavailable(error);
    } finally {
      db?.close();
    }
  }

  constructor({
    filename,
    registryId,
    registryFileIdentity,
    trustedCheckpoints = [],
    checkpointHostId,
    checkpointHost,
  }) {
    label(registryId, "registry ID");
    try {
      this.#identity = identity(filename);
      requireBudget(
        FILE_IDENTITY.test(registryFileIdentity) &&
          registryFileIdentity === this.#identity.fileIdentity,
        "Registry descriptor must pin the original physical file identity",
        "CC_BUDGET_LINEAGE_IDENTITY",
      );
      this.#db = openDatabase(filename);
      requireBudget(
        this.#db
          .prepare("SELECT registry_id FROM registry_meta WHERE id=1")
          .get()?.registry_id === registryId &&
          this.#db.pragma("quick_check", { simple: true }) === "ok",
        "Independent registry identity differs or storage is corrupt",
        "CC_BUDGET_LINEAGE_IDENTITY",
      );
      this.#id = registryId;
      this.#checkpointHostId = this.#storedHostId();
      requireBudget(
        checkpointHostId === undefined ||
          checkpointHostId === this.#checkpointHostId,
        "Pinned checkpoint host policy differs from registry",
        "CC_BUDGET_LINEAGE_HOST_REQUIRED",
      );
      if (this.#checkpointHostId !== null) {
        requireBudget(
          checkpointHost?.id === this.#checkpointHostId,
          "This registry requires its pinned independent checkpoint host on every open",
          "CC_BUDGET_LINEAGE_HOST_REQUIRED",
        );
        const { load, publish } = checkpointHost;
        synchronous(load, "CC_BUDGET_LINEAGE_HOST_ASYNC");
        synchronous(publish, "CC_BUDGET_LINEAGE_HOST_ASYNC");
        this.#checkpointHost = {
          load: load.bind(checkpointHost),
          publish: publish.bind(checkpointHost),
        };
      } else
        requireBudget(
          !checkpointHost,
          "Checkpoint host policy must be fixed at explicit initialization",
          "CC_BUDGET_LINEAGE_HOST_REQUIRED",
        );
      requireBudget(
        Array.isArray(trustedCheckpoints),
        "Trusted checkpoint array required",
        "CC_BUDGET_LINEAGE_CHECKPOINT",
      );
      for (const checkpoint of trustedCheckpoints) {
        requireBudget(
          checkpoint?.schema === FORMAL_BUDGET_LINEAGE_CHECKPOINT_SCHEMA &&
            checkpoint.registry?.registryId === this.#id &&
            checkpoint.registry.filename === this.#identity.filename &&
            checkpoint.registry.fileIdentity === this.#identity.fileIdentity,
          "Checkpoint does not belong to this pinned registry",
          "CC_BUDGET_LINEAGE_CHECKPOINT",
        );
        const head = checkedHead(checkpoint.head);
        requireBudget(
          !this.#observed.has(head.lineage_id),
          "Duplicate trusted lineage checkpoint",
          "CC_BUDGET_LINEAGE_CHECKPOINT",
        );
        this.#observed.set(head.lineage_id, head);
      }
      this.#locked(() => {});
    } catch (error) {
      this.#db?.close();
      throw unavailable(error);
    }
  }

  get registryId() {
    return this.#id;
  }

  get checkpointHostId() {
    return this.#checkpointHostId;
  }

  #storedHostId() {
    const exists = this.#db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkpoint_policy'",
      )
      .get();
    if (!exists) return null;
    const row = this.#db
      .prepare("SELECT host_id FROM checkpoint_policy WHERE id=1")
      .get();
    requireBudget(
      row,
      "Missing checkpoint host policy",
      "CC_BUDGET_LINEAGE_HOST_REQUIRED",
    );
    return label(row.host_id, "checkpoint host ID");
  }

  #callHost(method, ...args) {
    try {
      const result = this.#checkpointHost[method](...args);
      // Drain native rejected Promises, but never run an arbitrary thenable.
      if (types.isPromise(result)) void result.catch(() => {});
      requireBudget(
        !result?.then,
        "Checkpoint host operations must finish synchronously",
        "CC_BUDGET_LINEAGE_HOST_ASYNC",
      );
      return result;
    } catch (cause) {
      if (isFormalBudgetError(cause)) throw cause;
      throw Object.assign(
        budgetError(
          "CC_BUDGET_LINEAGE_HOST_UNAVAILABLE",
          "Independent checkpoint host failed; external reconciliation required",
        ),
        { cause },
      );
    }
  }

  #checkpoint(row) {
    return Object.freeze({
      schema: FORMAL_BUDGET_LINEAGE_CHECKPOINT_SCHEMA,
      registry: this.bindingIdentity,
      head: Object.freeze(checkedHead(row)),
    });
  }

  #verifyHostHeads() {
    if (!this.#checkpointHost) return;
    const checkpoints = this.#callHost("load", this.bindingIdentity);
    requireBudget(
      Array.isArray(checkpoints),
      "Checkpoint host must return all latest lineage heads",
      "CC_BUDGET_LINEAGE_HOST_RECEIPT",
    );
    const heads = new Map();
    for (const checkpoint of checkpoints) {
      const head = checkedHead(checkpoint?.head);
      requireBudget(
        !heads.has(head.lineage_id) &&
          lineageCheckpointDigest(checkpoint) ===
            lineageCheckpointDigest(this.#checkpoint(head)),
        "Duplicate or foreign checkpoint host record",
        "CC_BUDGET_LINEAGE_HOST_RECEIPT",
      );
      heads.set(head.lineage_id, head);
    }
    const rows = this.#db
      .prepare("SELECT * FROM lineage ORDER BY lineage_id")
      .all();
    requireBudget(
      rows.length === heads.size &&
        rows.every((row) => {
          const head = heads.get(row.lineage_id);
          return (
            head &&
            [...IMMUTABLE_HEAD_FIELDS, "state_digest", "revision"].every(
              (key) => row[key] === head[key],
            )
          );
        }),
      "Registry and independent latest checkpoints differ; never seed, downgrade or reset",
      "CC_BUDGET_LINEAGE_HOST_STALE",
    );
  }

  #commitHead(head) {
    // Registry -> independent host acknowledgement/readback -> authority COMMIT.
    // Any failure after the first commit deliberately leaves a closed mismatch.
    this.#db.exec("COMMIT");
    this.#observed.set(head.lineage_id, head);
    if (this.#checkpointHost) {
      const checkpoint = this.#checkpoint(head);
      const digest = lineageCheckpointDigest(checkpoint);
      const receipt = this.#callHost("publish", checkpoint, digest);
      requireBudget(
        receipt?.durable === true && receipt.checkpointDigest === digest,
        "Checkpoint host did not acknowledge this exact durable head",
        "CC_BUDGET_LINEAGE_HOST_RECEIPT",
      );
      // A claimed acknowledgement must also be visible to the next load.
      this.#verifyHostHeads();
    }
  }

  get bindingIdentity() {
    return Object.freeze({ registryId: this.#id, ...this.#identity });
  }

  #observeHeads() {
    const rows = this.#db
      .prepare("SELECT * FROM lineage ORDER BY lineage_id")
      .all()
      .map(checkedHead);
    const current = new Map(rows.map((row) => [row.lineage_id, row]));
    for (const [lineageId, previous] of this.#observed) {
      const row = current.get(lineageId);
      requireBudget(
        row &&
          row.revision >= previous.revision &&
          IMMUTABLE_HEAD_FIELDS.every((key) => row[key] === previous[key]) &&
          (row.revision > previous.revision ||
            row.state_digest === previous.state_digest),
        "Registry lost or changed a previously observed lineage head; external reconciliation required",
        "CC_BUDGET_LINEAGE_ROLLBACK",
      );
    }
    for (const row of rows) this.#observed.set(row.lineage_id, row);
  }

  #locked(operation) {
    requireBudget(
      !this.#active,
      "Nested lineage operation denied",
      "CC_BUDGET_LINEAGE_BUSY",
    );
    this.#active = true;
    try {
      const current = identity(this.#identity.filename);
      requireBudget(
        current.filename === this.#identity.filename &&
          current.fileIdentity === this.#identity.fileIdentity,
        "Registry file was replaced",
        "CC_BUDGET_LINEAGE_IDENTITY",
      );
      this.#db.exec("BEGIN IMMEDIATE");
      requireBudget(
        this.#db
          .prepare("SELECT registry_id FROM registry_meta WHERE id=1")
          .get()?.registry_id === this.#id,
        "Pinned registry UUID changed",
        "CC_BUDGET_LINEAGE_IDENTITY",
      );
      this.#observeHeads();
      requireBudget(
        this.#storedHostId() === this.#checkpointHostId,
        "Checkpoint host policy changed while registry was open",
        "CC_BUDGET_LINEAGE_HOST_REQUIRED",
      );
      this.#verifyHostHeads();
      const result = operation();
      requireBudget(
        !result?.then,
        "Lineage operations must be synchronous",
        "CC_BUDGET_LINEAGE_ASYNC",
      );
      if (this.#db.inTransaction) {
        this.#observeHeads();
        this.#db.exec("COMMIT");
      }
      return result;
    } catch (error) {
      try {
        if (this.#db?.inTransaction) this.#db.exec("ROLLBACK");
      } catch {
        // Preserve a budget failure even when storage cannot roll back.
      }
      throw unavailable(error);
    } finally {
      this.#active = false;
    }
  }

  /** Register once, never adopt another database or reset a prior lineage. */
  register(binding, initializeAuthority) {
    synchronous(initializeAuthority);
    label(binding.lineageId, "lineage ID");
    requireBudget(
      DIGEST.test(binding.planDigest) && DIGEST.test(binding.activationDigest),
      "Pinned plan and activation digests required",
    );
    return this.#locked(() => {
      requireBudget(
        !this.#db
          .prepare("SELECT 1 FROM lineage WHERE lineage_id=?")
          .get(binding.lineageId),
        "Original lineage already has an authority; no new allowance is permitted",
        "CC_BUDGET_LINEAGE_EXISTS",
      );
      const bindingId = randomUUID();
      const stateDigest = initializeAuthority({
        registryId: this.#id,
        bindingId,
        registryFilename: this.#identity.filename,
        registryFileIdentity: this.#identity.fileIdentity,
        checkpointHostId: this.#checkpointHostId,
      });
      const file = identity(binding.filename);
      requireBudget(
        file.filename !== this.#identity.filename && DIGEST.test(stateDigest),
        "Independent authority state digest required",
      );
      this.#db
        .prepare("INSERT INTO lineage VALUES (?,?,?,?,?,?,?,0)")
        .run(
          binding.lineageId,
          bindingId,
          binding.planDigest,
          binding.activationDigest,
          file.filename,
          file.fileIdentity,
          stateDigest,
        );
      this.#commitHead(
        checkedHead(
          this.#db
            .prepare("SELECT * FROM lineage WHERE lineage_id=?")
            .get(binding.lineageId),
        ),
      );
      return { registryId: this.#id, bindingId };
    });
  }

  /**
   * Lock registry before authority. Advance the independent head durably BEFORE
   * committing local state. A crash in between leaves a mismatch, never credit.
   * The caller must roll back its local transaction on any failure.
   */
  coordinate(binding, operation) {
    synchronous(operation);
    return this.#locked(() => {
      const row = this.#db
        .prepare("SELECT * FROM lineage WHERE lineage_id=?")
        .get(binding.lineageId);
      const file = identity(binding.filename);
      requireBudget(
        row &&
          row.binding_id === binding.bindingId &&
          row.plan_digest === binding.planDigest &&
          row.activation_digest === binding.activationDigest &&
          row.filename === file.filename &&
          row.file_identity === file.fileIdentity,
        "Authority is not the uniquely registered lineage database",
        "CC_BUDGET_LINEAGE_IDENTITY",
      );
      let asserted = false,
        advanced = false,
        active = true;
      try {
        const result = operation({
          assertState(stateDigest) {
            requireBudget(
              active,
              "Lineage lease has expired",
              "CC_BUDGET_LINEAGE_LEASE_EXPIRED",
            );
            requireBudget(
              !asserted &&
                !advanced &&
                DIGEST.test(stateDigest) &&
                stateDigest === row.state_digest,
              "Authority state differs from the independent head; reconcile without resetting credit",
              "CC_BUDGET_LINEAGE_STATE",
            );
            asserted = true;
          },
          advance: (stateDigest) => {
            requireBudget(
              active,
              "Lineage lease has expired",
              "CC_BUDGET_LINEAGE_LEASE_EXPIRED",
            );
            requireBudget(
              asserted && !advanced && DIGEST.test(stateDigest),
              "Invalid lineage advance",
            );
            const increment = stateDigest === row.state_digest ? 0 : 1;
            requireBudget(
              Number.isSafeInteger(row.revision + increment),
              "Lineage revision exhausted",
            );
            this.#db
              .prepare(
                "UPDATE lineage SET state_digest=?,revision=revision+? WHERE lineage_id=? AND state_digest=?",
              )
              .run(stateDigest, increment, binding.lineageId, row.state_digest);
            this.#commitHead({
              ...checkedHead(row),
              state_digest: stateDigest,
              revision: row.revision + increment,
            });
            advanced = true;
          },
        });
        requireBudget(
          !result?.then,
          "Lineage callbacks must complete synchronously",
          "CC_BUDGET_LINEAGE_ASYNC",
        );
        requireBudget(
          advanced,
          "Authority did not persist its independent head",
        );
        return result;
      } finally {
        active = false;
      }
    });
  }

  status(lineageId) {
    label(lineageId, "lineage ID");
    return this.#locked(
      () =>
        this.#db
          .prepare("SELECT * FROM lineage WHERE lineage_id=?")
          .get(lineageId) ?? null,
    );
  }

  /** Persist/authenticate this outside both database backup domains at the host. */
  checkpoint(lineageId) {
    const row = this.status(lineageId);
    requireBudget(
      row,
      "Unknown lineage checkpoint",
      "CC_BUDGET_LINEAGE_CHECKPOINT",
    );
    return this.#checkpoint(row);
  }

  close() {
    this.#db.close();
  }
}
