/**
 * Pure, in-memory scope ownership for large Agent Teams.
 *
 * A lock key (normally a task or agent id) owns one or more repository-relative
 * paths. Directory-prefix overlap is intentionally conservative: owning `src`
 * also owns `src/a.js`. An empty scope list means the whole workspace.
 *
 * The implementation does not inspect the filesystem. That keeps planning,
 * scheduling, persistence validation, and tests deterministic across platforms.
 */

export const TEAM_SCOPE_LOCK_ERROR_CODES = Object.freeze({
  INVALID_KEY: "TEAM_SCOPE_LOCK_INVALID_KEY",
  INVALID_SCOPES: "TEAM_SCOPE_LOCK_INVALID_SCOPES",
  INVALID_SCOPE_PATH: "TEAM_SCOPE_LOCK_INVALID_SCOPE_PATH",
  SCOPE_CONFLICT: "TEAM_SCOPE_LOCK_SCOPE_CONFLICT",
  KEY_ALREADY_HELD: "TEAM_SCOPE_LOCK_KEY_ALREADY_HELD",
  NOT_HELD: "TEAM_SCOPE_LOCK_NOT_HELD",
  INVALID_SNAPSHOT: "TEAM_SCOPE_LOCK_INVALID_SNAPSHOT",
});

export const TEAM_SCOPE_LOCK_SNAPSHOT_VERSION = 1;

export class TeamScopeLockError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TeamScopeLockError";
    this.code = code;
    Object.assign(this, details);
  }
}

function codedError(code, message, details = {}) {
  return new TeamScopeLockError(code, message, details);
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeKey(value) {
  if (typeof value !== "string") {
    throw codedError(
      TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_KEY,
      "scope lock key must be a non-empty string",
    );
  }
  const key = value.trim();
  if (!key || key.includes("\0")) {
    throw codedError(
      TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_KEY,
      "scope lock key must be a non-empty string without NUL bytes",
    );
  }
  return key;
}

/**
 * Canonicalize a relative POSIX or Windows path to slash-separated POSIX form.
 *
 * Absolute paths, drive-qualified paths, parent traversal, NUL bytes, and paths
 * that normalize to empty are rejected. `.` and duplicate separators are
 * removed without resolving against a working directory.
 */
export function normalizeTeamScopePath(value) {
  if (typeof value !== "string") {
    throw codedError(
      TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
      "scope path must be a non-empty string",
      { scope: value },
    );
  }

  const input = value.trim();
  if (!input || input.includes("\0")) {
    throw codedError(
      TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
      "scope path must be non-empty and must not contain NUL bytes",
      { scope: value },
    );
  }
  const withoutLeadingPresentationSpace = value.trimStart();
  if (
    withoutLeadingPresentationSpace.length !== input.length &&
    !input.endsWith("/") &&
    !input.endsWith("\\")
  ) {
    throw codedError(
      TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
      "scope path must not end in ambiguous whitespace",
      { scope: value },
    );
  }

  // Reject POSIX absolute paths, Windows root/UNC paths, and both rooted and
  // drive-relative forms (`C:\x`, `C:/x`, and `C:x`).
  if (
    input.startsWith("/") ||
    input.startsWith("\\") ||
    /^[A-Za-z]:/.test(input)
  ) {
    throw codedError(
      TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
      "scope path must be repository-relative",
      { scope: value },
    );
  }

  const parts = [];
  for (const rawPart of input.replaceAll("\\", "/").split("/")) {
    if (!rawPart || rawPart === ".") continue;
    if (rawPart === "..") {
      throw codedError(
        TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
        "scope path must not contain parent traversal",
        { scope: value },
      );
    }
    // Use one conservative cross-platform identity. Windows treats case,
    // trailing dots/spaces, ADS colons, and device names specially; rejecting
    // the ambiguous spellings and case-folding everywhere may serialize a few
    // safe Linux paths, but cannot miss a Windows collision.
    if (
      rawPart.endsWith(".") ||
      rawPart.endsWith(" ") ||
      rawPart.includes(":") ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(rawPart)
    ) {
      throw codedError(
        TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
        "scope path contains a cross-platform ambiguous segment",
        { scope: value },
      );
    }
    parts.push(rawPart.normalize("NFC").toLowerCase());
  }

  if (parts.length === 0) {
    throw codedError(
      TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
      "scope path must identify a repository-relative location",
      { scope: value },
    );
  }

  return parts.join("/");
}

function containsScope(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

/**
 * Canonicalize, sort, de-duplicate, and compact a scope list.
 *
 * Descendants are redundant when an ancestor is present, so
 * `["src", "src/a.js"]` canonicalizes to `["src"]`. `[]` is preserved and
 * denotes the whole workspace.
 */
export function normalizeTeamScopes(scopes = []) {
  if (!Array.isArray(scopes)) {
    throw codedError(
      TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPES,
      "scopes must be an array of repository-relative paths",
      { scopes },
    );
  }

  const sorted = [
    ...new Set(scopes.map((scope) => normalizeTeamScopePath(scope))),
  ].sort(compareStrings);
  const compact = [];
  for (const scope of sorted) {
    if (compact.some((ancestor) => containsScope(ancestor, scope))) continue;
    compact.push(scope);
  }
  return compact;
}

/**
 * Whether two normalized-or-raw scope lists overlap.
 *
 * Empty scopes mean whole-workspace ownership and therefore overlap every
 * other lock, including another whole-workspace lock.
 */
export function teamScopesOverlap(leftScopes, rightScopes) {
  const left = normalizeTeamScopes(leftScopes);
  const right = normalizeTeamScopes(rightScopes);
  if (left.length === 0 || right.length === 0) return true;

  return left.some((leftScope) =>
    right.some(
      (rightScope) =>
        containsScope(leftScope, rightScope) ||
        containsScope(rightScope, leftScope),
    ),
  );
}

function sameScopes(left, right) {
  return (
    left.length === right.length &&
    left.every((scope, index) => scope === right[index])
  );
}

function cloneLock(key, scopes) {
  return {
    key,
    scopes: [...scopes],
    workspace: scopes.length === 0,
  };
}

function failure(error, fallbackCode) {
  if (error instanceof TeamScopeLockError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
    };
  }
  return {
    ok: false,
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

export class TeamScopeLock {
  constructor() {
    this._locks = new Map();
  }

  /**
   * Validate whether `key` can own `scopes` without mutating lock state.
   *
   * Re-acquiring the same canonical scopes under the same key is idempotent.
   * A key cannot silently replace its current ownership with different scopes;
   * callers must release it first.
   */
  canAcquire(key, scopes = []) {
    let canonicalKey;
    let canonicalScopes;
    try {
      canonicalKey = normalizeKey(key);
      canonicalScopes = normalizeTeamScopes(scopes);
    } catch (error) {
      return failure(error, TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPES);
    }

    const current = this._locks.get(canonicalKey);
    if (current) {
      if (sameScopes(current, canonicalScopes)) {
        return {
          ok: true,
          key: canonicalKey,
          scopes: [...canonicalScopes],
          alreadyHeld: true,
          conflicts: [],
        };
      }
      return {
        ok: false,
        code: TEAM_SCOPE_LOCK_ERROR_CODES.KEY_ALREADY_HELD,
        message: `scope lock key "${canonicalKey}" already owns different scopes`,
        key: canonicalKey,
        scopes: [...canonicalScopes],
        heldScopes: [...current],
        conflicts: [],
      };
    }

    const conflicts = [];
    for (const [heldKey, heldScopes] of this._locks) {
      if (teamScopesOverlap(canonicalScopes, heldScopes)) {
        conflicts.push(cloneLock(heldKey, heldScopes));
      }
    }
    conflicts.sort((left, right) => compareStrings(left.key, right.key));

    if (conflicts.length > 0) {
      return {
        ok: false,
        code: TEAM_SCOPE_LOCK_ERROR_CODES.SCOPE_CONFLICT,
        message: `requested scopes conflict with ${conflicts.length} active lock(s)`,
        key: canonicalKey,
        scopes: [...canonicalScopes],
        conflicts,
      };
    }

    return {
      ok: true,
      key: canonicalKey,
      scopes: [...canonicalScopes],
      alreadyHeld: false,
      conflicts: [],
    };
  }

  acquire(key, scopes = []) {
    const check = this.canAcquire(key, scopes);
    if (!check.ok) return check;
    if (check.alreadyHeld) {
      return {
        ...check,
        acquired: false,
      };
    }

    this._locks.set(check.key, [...check.scopes]);
    return {
      ...check,
      acquired: true,
    };
  }

  release(key) {
    let canonicalKey;
    try {
      canonicalKey = normalizeKey(key);
    } catch (error) {
      return failure(error, TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_KEY);
    }

    const scopes = this._locks.get(canonicalKey);
    if (!scopes) {
      return {
        ok: false,
        code: TEAM_SCOPE_LOCK_ERROR_CODES.NOT_HELD,
        message: `scope lock key "${canonicalKey}" does not own a lock`,
        key: canonicalKey,
      };
    }

    this._locks.delete(canonicalKey);
    return {
      ok: true,
      released: true,
      ...cloneLock(canonicalKey, scopes),
    };
  }

  status() {
    const locks = [...this._locks]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, scopes]) => cloneLock(key, scopes));
    return {
      count: locks.length,
      locks,
    };
  }

  snapshot() {
    return {
      version: TEAM_SCOPE_LOCK_SNAPSHOT_VERSION,
      locks: this.status().locks.map(({ key, scopes }) => ({
        key,
        scopes,
      })),
    };
  }

  /**
   * Restore only snapshots that could have been produced by a valid lock set.
   * Corrupt entries, duplicate keys, and mutually-overlapping owners fail
   * closed with one stable snapshot error code.
   */
  static restore(snapshot) {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot) ||
      snapshot.version !== TEAM_SCOPE_LOCK_SNAPSHOT_VERSION ||
      !Array.isArray(snapshot.locks)
    ) {
      throw codedError(
        TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SNAPSHOT,
        "invalid team scope lock snapshot",
      );
    }

    const restored = new TeamScopeLock();
    for (const entry of snapshot.locks) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw codedError(
          TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SNAPSHOT,
          "team scope lock snapshot contains an invalid lock entry",
        );
      }

      const result = restored.acquire(entry.key, entry.scopes);
      if (!result.ok || result.alreadyHeld) {
        throw codedError(
          TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SNAPSHOT,
          "team scope lock snapshot contains invalid or conflicting ownership",
          {
            causeCode:
              result.code ?? TEAM_SCOPE_LOCK_ERROR_CODES.KEY_ALREADY_HELD,
          },
        );
      }
    }
    return restored;
  }
}
