import fsDefault from "node:fs";
import pathDefault from "node:path";
import { randomUUID as randomUUIDDefault } from "node:crypto";
import { getStatePath as getStatePathDefault } from "./paths.js";
import { withFileLock as withFileLockDefault } from "./with-file-lock.js";

export const PLAN_SESSION_SNAPSHOT_SCHEMA =
  "chainlesschain.plan-session-snapshot";
export const PLAN_SESSION_LEGACY_SNAPSHOT_VERSION = 0;
export const PLAN_SESSION_SNAPSHOT_VERSION = 1;
export const PLAN_SESSION_EVENT_SCHEMA = "chainlesschain.plan-session-event";
export const PLAN_SESSION_EVENT_VERSION = 1;

export const PLAN_PERSISTENCE_ERROR_CODES = Object.freeze({
  INVALID_SESSION: "PLAN_SESSION_ID_INVALID",
  CORRUPT: "PLAN_SNAPSHOT_CORRUPT",
  RECOVERY_REQUIRED: "PLAN_SNAPSHOT_RECOVERY_REQUIRED",
  REVISION_CONFLICT: "PLAN_REVISION_CONFLICT",
  WRITE_FAILED: "PLAN_SNAPSHOT_WRITE_FAILED",
  LOCK_FAILED: "PLAN_SNAPSHOT_LOCK_FAILED",
  RECOVERY_FAILED: "PLAN_SNAPSHOT_RECOVERY_FAILED",
});

export class PlanPersistenceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "PlanPersistenceError";
    this.code = code;
    for (const [key, value] of Object.entries(options.details || {})) {
      this[key] = value;
    }
  }
}

function persistenceError(code, message, cause, details) {
  return new PlanPersistenceError(code, message, { cause, details });
}

function isKnownError(error) {
  return error instanceof PlanPersistenceError;
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isUnsafePlanSessionId(sessionId) {
  return (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.includes("/") ||
    sessionId.includes("\\") ||
    sessionId.includes("..") ||
    sessionId.includes("\0")
  );
}

function assertSafeSessionId(sessionId) {
  if (isUnsafePlanSessionId(sessionId)) {
    throw persistenceError(
      PLAN_PERSISTENCE_ERROR_CODES.INVALID_SESSION,
      "Plan persistence requires a safe non-empty session id",
      null,
      {
        sessionId:
          typeof sessionId === "string" ? sessionId.slice(0, 80) : null,
      },
    );
  }
  return sessionId;
}

export function resolvePlanStateDir(options = {}) {
  const path = options.path || pathDefault;
  if (typeof options.stateDir === "string" && options.stateDir.trim()) {
    return path.resolve(options.stateDir);
  }
  const env = options.env || process.env;
  const dataDir = env.CHAINLESSCHAIN_DATA_DIR;
  if (typeof dataDir === "string" && dataDir.trim()) {
    return path.join(path.resolve(dataDir), "plans");
  }
  const getStatePath = options.getStatePath || getStatePathDefault;
  return path.join(path.resolve(getStatePath()), "plans");
}

export function planSnapshotPath(sessionId, options = {}) {
  const path = options.path || pathDefault;
  return path.join(
    resolvePlanStateDir({ ...options, path }),
    `${assertSafeSessionId(sessionId)}.json`,
  );
}

export function createPlanSessionEvent({
  sessionId,
  revision,
  previousRevision,
  type,
  timestamp = Date.now(),
}) {
  if (
    typeof type !== "string" ||
    !type.trim() ||
    type.length > 128 ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(previousRevision) ||
    previousRevision !== revision - 1 ||
    !Number.isFinite(timestamp)
  ) {
    throw persistenceError(
      PLAN_PERSISTENCE_ERROR_CODES.CORRUPT,
      "Plan session event failed schema validation",
    );
  }
  return Object.freeze({
    schema: PLAN_SESSION_EVENT_SCHEMA,
    version: PLAN_SESSION_EVENT_VERSION,
    sessionId: assertSafeSessionId(sessionId),
    revision,
    previousRevision,
    type: type.trim(),
    timestamp,
  });
}

function emptySnapshot(sessionId, state) {
  return {
    schema: PLAN_SESSION_SNAPSHOT_SCHEMA,
    version: PLAN_SESSION_SNAPSHOT_VERSION,
    sessionId,
    revision: 0,
    updatedAt: 0,
    event: null,
    state,
  };
}

/**
 * Versioned CAS snapshot store for one plan-mode session.
 *
 * The latest versioned event is committed in the same JSON envelope as the
 * state, so readers cannot observe an event/snapshot split. A sibling temp file
 * is fsynced before a same-directory atomic rename. Any orphan temp or corrupt
 * canonical file blocks future writes until explicit recovery.
 */
export class PlanSessionPersistence {
  constructor(options = {}) {
    this._fs = options.fs || fsDefault;
    this._path = options.path || pathDefault;
    this._env = options.env || process.env;
    this._getStatePath = options.getStatePath || getStatePathDefault;
    this._randomUUID = options.randomUUID || randomUUIDDefault;
    this._now = options.now || (() => Date.now());
    this._platform = options.platform || process.platform;
    this._withFileLock = options.withFileLock || withFileLockDefault;
    this._beforeRename = options.beforeRename || null;
    this._normalizeState =
      options.normalizeState || ((state) => cloneJson(state));
    this._emptyState = options.emptyState || (() => ({}));
    this._migrateSnapshot = options.migrateSnapshot || null;
    this.stateDir = resolvePlanStateDir({
      stateDir: options.stateDir,
      env: this._env,
      path: this._path,
      getStatePath: this._getStatePath,
    });
    this.identity = this.stateDir;
  }

  configureStateSchema({ normalizeState, emptyState, migrateSnapshot } = {}) {
    if (typeof normalizeState === "function") {
      this._normalizeState = normalizeState;
    }
    if (typeof emptyState === "function") this._emptyState = emptyState;
    if (typeof migrateSnapshot === "function") {
      this._migrateSnapshot = migrateSnapshot;
    }
    return this;
  }

  snapshotPath(sessionId) {
    return planSnapshotPath(sessionId, {
      stateDir: this.stateDir,
      path: this._path,
    });
  }

  _ensureDirectory() {
    this._fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
  }

  _temporaryPaths(filePath) {
    const prefix = `.${this._path.basename(filePath)}.`;
    let names;
    try {
      names = this._fs.readdirSync(this.stateDir);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    return names
      .filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
      .sort()
      .map((name) => this._path.join(this.stateDir, name));
  }

  _validateEvent(sessionId, revision, event) {
    if (
      !hasExactKeys(event, [
        "schema",
        "version",
        "sessionId",
        "revision",
        "previousRevision",
        "type",
        "timestamp",
      ]) ||
      event.schema !== PLAN_SESSION_EVENT_SCHEMA ||
      event.version !== PLAN_SESSION_EVENT_VERSION ||
      event.sessionId !== sessionId ||
      event.revision !== revision ||
      event.previousRevision !== revision - 1 ||
      typeof event.type !== "string" ||
      !event.type ||
      event.type.length > 128 ||
      !Number.isFinite(event.timestamp)
    ) {
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Plan session event failed schema validation",
      );
    }
    return Object.freeze({ ...event });
  }

  _validateSnapshot(sessionId, value) {
    if (
      !hasExactKeys(value, [
        "schema",
        "version",
        "sessionId",
        "revision",
        "updatedAt",
        "event",
        "state",
      ]) ||
      value.schema !== PLAN_SESSION_SNAPSHOT_SCHEMA ||
      value.version !== PLAN_SESSION_SNAPSHOT_VERSION ||
      value.sessionId !== sessionId ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1 ||
      !Number.isFinite(value.updatedAt)
    ) {
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Plan session snapshot failed schema validation",
      );
    }

    let state;
    try {
      state = this._normalizeState(value.state);
    } catch (error) {
      if (isKnownError(error)) throw error;
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Plan session state failed schema validation",
        error,
      );
    }
    return {
      schema: PLAN_SESSION_SNAPSHOT_SCHEMA,
      version: PLAN_SESSION_SNAPSHOT_VERSION,
      sessionId,
      revision: value.revision,
      updatedAt: value.updatedAt,
      event: this._validateEvent(sessionId, value.revision, value.event),
      state,
    };
  }

  _readUnlocked(sessionId, filePath) {
    const temporaryPaths = this._temporaryPaths(filePath);
    if (temporaryPaths.length > 0) {
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.RECOVERY_REQUIRED,
        "Plan snapshot has an incomplete atomic write; explicit recovery is required",
        null,
        {
          filePath,
          temporaryPaths,
          recoveryStrategy: "discard-temporary",
        },
      );
    }

    let serialized;
    try {
      serialized = this._fs.readFileSync(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return emptySnapshot(
          sessionId,
          this._normalizeState(this._emptyState()),
        );
      }
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Could not read plan session snapshot",
        error,
        { filePath, recoveryStrategy: "quarantine-corrupt" },
      );
    }

    try {
      const parsed = JSON.parse(serialized);
      const candidate =
        parsed?.version !== PLAN_SESSION_SNAPSHOT_VERSION &&
        typeof this._migrateSnapshot === "function"
          ? this._migrateSnapshot(parsed, { sessionId })
          : parsed;
      return this._validateSnapshot(sessionId, candidate);
    } catch (error) {
      if (isKnownError(error)) {
        error.filePath = filePath;
        error.recoveryStrategy = "quarantine-corrupt";
        throw error;
      }
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Could not parse plan session snapshot",
        error,
        { filePath, recoveryStrategy: "quarantine-corrupt" },
      );
    }
  }

  _locked(sessionId, operation) {
    this._ensureDirectory();
    const filePath = this.snapshotPath(sessionId);
    try {
      return this._withFileLock(filePath, () => operation(filePath), {
        _fs: this._fs,
        failIfUnavailable: true,
        timeoutMs: 5_000,
        retryMs: 2,
        maxRetryMs: 32,
        retryJitterMs: 4,
      });
    } catch (error) {
      if (isKnownError(error)) throw error;
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.LOCK_FAILED,
        "Could not acquire or release the plan snapshot lock",
        error,
        { filePath },
      );
    }
  }

  load(sessionId) {
    assertSafeSessionId(sessionId);
    return this._locked(sessionId, (filePath) =>
      this._readUnlocked(sessionId, filePath),
    );
  }

  _writeAtomic(filePath, snapshot) {
    const temporaryPath = this._path.join(
      this.stateDir,
      `.${this._path.basename(filePath)}.${process.pid}.${this._randomUUID()}.tmp`,
    );
    let descriptor = null;
    let renamed = false;
    try {
      descriptor = this._fs.openSync(temporaryPath, "wx", 0o600);
      this._fs.writeFileSync(
        descriptor,
        `${JSON.stringify(snapshot, null, 2)}\n`,
        "utf8",
      );
      this._fs.fsyncSync(descriptor);
      this._fs.closeSync(descriptor);
      descriptor = null;
      if (this._beforeRename) this._beforeRename(temporaryPath, filePath);
      // Same-directory rename is the atomic commit point on Windows and POSIX.
      this._fs.renameSync(temporaryPath, filePath);
      renamed = true;

      // Windows cannot fsync a directory handle. Elsewhere this is best-effort
      // because the snapshot has already crossed its atomic commit point.
      if (this._platform !== "win32") {
        let directoryDescriptor = null;
        try {
          directoryDescriptor = this._fs.openSync(this.stateDir, "r");
          this._fs.fsyncSync(directoryDescriptor);
        } catch {
          // Already committed; do not invite an unsafe retry.
        } finally {
          if (directoryDescriptor != null) {
            try {
              this._fs.closeSync(directoryDescriptor);
            } catch {
              // Best-effort cleanup after commit.
            }
          }
        }
      }
    } catch (error) {
      if (descriptor != null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // Preserve the original failure.
        }
      }
      if (!renamed) {
        try {
          this._fs.unlinkSync(temporaryPath);
        } catch {
          // Cleanup failure intentionally leaves visible recovery evidence.
        }
      }
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.WRITE_FAILED,
        "Could not atomically persist plan session snapshot",
        error,
        { filePath, temporaryPath },
      );
    }
  }

  compareAndSwap(sessionId, expectedRevision, state, eventType) {
    assertSafeSessionId(sessionId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.REVISION_CONFLICT,
        "Plan write requires a non-negative expected revision",
        null,
        { expectedRevision },
      );
    }

    let normalizedState;
    try {
      normalizedState = this._normalizeState(state);
    } catch (error) {
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Refused to persist invalid plan session state",
        error,
      );
    }

    return this._locked(sessionId, (filePath) => {
      const current = this._readUnlocked(sessionId, filePath);
      if (current.revision !== expectedRevision) {
        throw persistenceError(
          PLAN_PERSISTENCE_ERROR_CODES.REVISION_CONFLICT,
          "Plan session snapshot revision conflict",
          null,
          {
            filePath,
            expectedRevision,
            actualRevision: current.revision,
          },
        );
      }
      const revision = current.revision + 1;
      const updatedAt = this._now();
      const event = createPlanSessionEvent({
        sessionId,
        revision,
        previousRevision: current.revision,
        type: eventType,
        timestamp: updatedAt,
      });
      const next = {
        schema: PLAN_SESSION_SNAPSHOT_SCHEMA,
        version: PLAN_SESSION_SNAPSHOT_VERSION,
        sessionId,
        revision,
        updatedAt,
        event,
        state: normalizedState,
      };
      this._writeAtomic(filePath, next);
      return this._validateSnapshot(sessionId, next);
    });
  }

  recover(sessionId, strategy) {
    assertSafeSessionId(sessionId);
    return this._locked(sessionId, (filePath) => {
      if (strategy === "discard-temporary") {
        const temporaryPaths = this._temporaryPaths(filePath);
        for (const temporaryPath of temporaryPaths) {
          this._fs.unlinkSync(temporaryPath);
        }
        return { strategy, recovered: temporaryPaths.length, filePath };
      }
      if (strategy === "quarantine-corrupt") {
        try {
          this._readUnlocked(sessionId, filePath);
        } catch (error) {
          if (error?.code !== PLAN_PERSISTENCE_ERROR_CODES.CORRUPT) throw error;
          const quarantinePath = `${filePath}.corrupt.${this._now()}.${this._randomUUID()}`;
          try {
            this._fs.renameSync(filePath, quarantinePath);
          } catch (cause) {
            throw persistenceError(
              PLAN_PERSISTENCE_ERROR_CODES.RECOVERY_FAILED,
              "Could not quarantine corrupt plan snapshot",
              cause,
              { filePath, quarantinePath },
            );
          }
          return { strategy, recovered: 1, filePath, quarantinePath };
        }
        return { strategy, recovered: 0, filePath };
      }
      throw persistenceError(
        PLAN_PERSISTENCE_ERROR_CODES.RECOVERY_FAILED,
        "Unknown plan snapshot recovery strategy",
      );
    });
  }
}
