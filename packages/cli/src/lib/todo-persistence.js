import fsDefault from "node:fs";
import pathDefault from "node:path";
import { randomUUID as randomUUIDDefault } from "node:crypto";
import { getStatePath as getStatePathDefault } from "./paths.js";
import { withFileLock as withFileLockDefault } from "./with-file-lock.js";

export const TODO_SNAPSHOT_SCHEMA = "chainlesschain.session-todos";
export const TODO_SNAPSHOT_VERSION = 1;

export const TODO_PERSISTENCE_ERROR_CODES = Object.freeze({
  INVALID_SESSION: "TODO_SESSION_ID_INVALID",
  CORRUPT: "TODO_SNAPSHOT_CORRUPT",
  RECOVERY_REQUIRED: "TODO_SNAPSHOT_RECOVERY_REQUIRED",
  REVISION_CONFLICT: "TODO_REVISION_CONFLICT",
  WRITE_FAILED: "TODO_SNAPSHOT_WRITE_FAILED",
  LOCK_FAILED: "TODO_SNAPSHOT_LOCK_FAILED",
  RECOVERY_FAILED: "TODO_SNAPSHOT_RECOVERY_FAILED",
});

export class TodoPersistenceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "TodoPersistenceError";
    this.code = code;
    for (const [key, value] of Object.entries(options.details || {})) {
      this[key] = value;
    }
  }
}

function persistenceError(code, message, cause, details) {
  return new TodoPersistenceError(code, message, { cause, details });
}

function isKnownPersistenceError(error) {
  return error instanceof TodoPersistenceError;
}

export function isUnsafeTodoSessionId(sessionId) {
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
  if (isUnsafeTodoSessionId(sessionId)) {
    throw persistenceError(
      TODO_PERSISTENCE_ERROR_CODES.INVALID_SESSION,
      "TODO persistence requires a safe non-empty session id",
      null,
      {
        sessionId:
          typeof sessionId === "string" ? sessionId.slice(0, 80) : null,
      },
    );
  }
  return sessionId;
}

/** Resolve the state directory through an injectable seam for hosts and tests. */
export function resolveTodoStateDir(options = {}) {
  const path = options.path || pathDefault;
  if (typeof options.stateDir === "string" && options.stateDir.trim()) {
    return path.resolve(options.stateDir);
  }
  const env = options.env || process.env;
  const dataDir = env.CHAINLESSCHAIN_DATA_DIR;
  if (typeof dataDir === "string" && dataDir.trim()) {
    return path.join(path.resolve(dataDir), "todos");
  }
  const getStatePath = options.getStatePath || getStatePathDefault;
  return path.join(path.resolve(getStatePath()), "todos");
}

export function todoSnapshotPath(sessionId, options = {}) {
  const path = options.path || pathDefault;
  return path.join(
    resolveTodoStateDir({ ...options, path }),
    `${assertSafeSessionId(sessionId)}.json`,
  );
}

function cloneTodos(todos) {
  return todos.map((todo) => ({
    id: todo.id,
    content: todo.content,
    status: todo.status,
  }));
}

function emptySnapshot(sessionId) {
  return {
    schema: TODO_SNAPSHOT_SCHEMA,
    version: TODO_SNAPSHOT_VERSION,
    sessionId,
    revision: 0,
    updatedAt: 0,
    todos: [],
  };
}

/**
 * Versioned, revision-CAS snapshot store for one session's canonical TODO list.
 * It never logs snapshot contents. Corrupt canonical files and orphaned atomic
 * write files remain visible and block writes until explicitly recovered.
 */
export class TodoSnapshotPersistence {
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
    this._validateTodos = options.validateTodos || null;
    this.stateDir = resolveTodoStateDir({
      stateDir: options.stateDir,
      env: this._env,
      path: this._path,
      getStatePath: this._getStatePath,
    });
    this.identity = this.stateDir;
  }

  snapshotPath(sessionId) {
    return todoSnapshotPath(sessionId, {
      stateDir: this.stateDir,
      path: this._path,
    });
  }

  _ensureDirectory() {
    this._fs.mkdirSync(this.stateDir, {
      recursive: true,
      mode: 0o700,
    });
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

  _validateSnapshot(sessionId, value) {
    const todoValidation =
      value && Array.isArray(value.todos) && this._validateTodos
        ? this._validateTodos(value.todos)
        : { valid: Array.isArray(value?.todos) };
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.schema !== TODO_SNAPSHOT_SCHEMA ||
      value.version !== TODO_SNAPSHOT_VERSION ||
      value.sessionId !== sessionId ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Number.isFinite(value.updatedAt) ||
      !todoValidation.valid
    ) {
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.CORRUPT,
        "TODO snapshot failed schema validation",
      );
    }
    return {
      schema: TODO_SNAPSHOT_SCHEMA,
      version: TODO_SNAPSHOT_VERSION,
      sessionId,
      revision: value.revision,
      updatedAt: value.updatedAt,
      todos: cloneTodos(value.todos),
    };
  }

  _readUnlocked(sessionId, filePath) {
    const temporaryPaths = this._temporaryPaths(filePath);
    if (temporaryPaths.length > 0) {
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.RECOVERY_REQUIRED,
        "TODO snapshot has an incomplete atomic write; explicit recovery is required",
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
      if (error?.code === "ENOENT") return emptySnapshot(sessionId);
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Could not read TODO snapshot",
        error,
        { filePath, recoveryStrategy: "quarantine-corrupt" },
      );
    }

    try {
      return this._validateSnapshot(sessionId, JSON.parse(serialized));
    } catch (error) {
      if (isKnownPersistenceError(error)) {
        error.filePath = filePath;
        error.recoveryStrategy = "quarantine-corrupt";
        throw error;
      }
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Could not parse TODO snapshot",
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
      if (isKnownPersistenceError(error)) throw error;
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.LOCK_FAILED,
        "Could not acquire or release the TODO snapshot lock",
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
      // Same-directory rename is the atomic commit point on POSIX and Windows.
      this._fs.renameSync(temporaryPath, filePath);
      renamed = true;

      // Directory fsync is unsupported on Windows. Elsewhere it is best-effort
      // after the commit point; a failure must not invite an unsafe retry.
      if (this._platform !== "win32") {
        let directoryDescriptor = null;
        try {
          directoryDescriptor = this._fs.openSync(this.stateDir, "r");
          this._fs.fsyncSync(directoryDescriptor);
        } catch {
          // Snapshot content is already atomically committed.
        } finally {
          if (directoryDescriptor != null) {
            try {
              this._fs.closeSync(directoryDescriptor);
            } catch {
              // Best-effort descriptor cleanup after a committed rename.
            }
          }
        }
      }
    } catch (error) {
      if (descriptor != null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // Preserve the original persistence failure.
        }
      }
      if (!renamed) {
        try {
          this._fs.unlinkSync(temporaryPath);
        } catch {
          // A cleanup failure leaves a visible recovery-required temp file.
        }
      }
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.WRITE_FAILED,
        "Could not atomically persist TODO snapshot",
        error,
        { filePath, temporaryPath },
      );
    }
  }

  compareAndSwap(sessionId, expectedRevision, todos) {
    assertSafeSessionId(sessionId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.REVISION_CONFLICT,
        "TODO write requires a non-negative expected revision",
        null,
        { expectedRevision },
      );
    }
    const validation = this._validateTodos
      ? this._validateTodos(todos)
      : { valid: Array.isArray(todos) };
    if (!validation.valid) {
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.CORRUPT,
        "Refused to persist an invalid TODO list",
      );
    }
    const nextTodos = cloneTodos(todos);
    return this._locked(sessionId, (filePath) => {
      const current = this._readUnlocked(sessionId, filePath);
      if (current.revision !== expectedRevision) {
        throw persistenceError(
          TODO_PERSISTENCE_ERROR_CODES.REVISION_CONFLICT,
          "TODO snapshot revision conflict",
          null,
          {
            filePath,
            expectedRevision,
            actualRevision: current.revision,
          },
        );
      }
      const next = {
        schema: TODO_SNAPSHOT_SCHEMA,
        version: TODO_SNAPSHOT_VERSION,
        sessionId,
        revision: current.revision + 1,
        updatedAt: this._now(),
        todos: nextTodos,
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
          if (error?.code !== TODO_PERSISTENCE_ERROR_CODES.CORRUPT) throw error;
          const quarantinePath = `${filePath}.corrupt.${this._now()}.${this._randomUUID()}`;
          try {
            this._fs.renameSync(filePath, quarantinePath);
          } catch (cause) {
            throw persistenceError(
              TODO_PERSISTENCE_ERROR_CODES.RECOVERY_FAILED,
              "Could not quarantine corrupt TODO snapshot",
              cause,
              { filePath, quarantinePath },
            );
          }
          return { strategy, recovered: 1, filePath, quarantinePath };
        }
        return { strategy, recovered: 0, filePath };
      }
      throw persistenceError(
        TODO_PERSISTENCE_ERROR_CODES.RECOVERY_FAILED,
        "Unknown TODO snapshot recovery strategy",
      );
    });
  }
}
