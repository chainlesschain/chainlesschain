"use strict";

// Git developer activity from local repositories. Repository roots and full
// paths are used only during discovery and `git log`; raw archival receives a
// basename plus SHA-256 identities. Incremental progress is a versioned,
// path-free cursor keyed by repository and commit hashes. No remote fetch is
// performed.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { createAccountScope } = require("../../account-scope");
const {
  defaultCodeRoots,
  findGitRepos,
  getHeadCommit,
  getShallowBoundaryFingerprint,
  listReachableCommitIds,
  listCommits,
} = require("./git-reader");

const NAME = "git-activity";
const VERSION = "0.4.0";
const CURSOR_PREFIX = "git-v1:";
const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 4 * 1024 * 1024;
const DEFAULT_REPO_CONCURRENCY = 4;
const MAX_REPO_CONCURRENCY = 8;
const DEFAULT_PAGE_SIZE = 2_500;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;
const MAX_SCAN_RECORDS = 500_000;
const DEFAULT_GRAPH_SEARCH_RECORDS = 10_000;
const DEFAULT_MAX_REPOS = 10_000;
const DEFAULT_MAX_PER_REPO = 50_000;
const MAX_MAX_PER_REPO = 100_000;
const MAX_SUBJECT_CHARS = 16_384;

function sha256Hex(value, length = 64) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, length);
}

function canonicalPath(value, fsMod = fs) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const resolved = path.resolve(value.trim());
  try {
    const realpath =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(resolved)
        : fsMod.realpathSync(resolved);
    return path.resolve(realpath);
  } catch {
    return resolved;
  }
}

function pathHash(value, fsMod = fs) {
  const canonical = canonicalPath(value, fsMod);
  if (!canonical) return null;
  const normalized =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return sha256Hex(`${NAME}\0${normalized}`);
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${NAME}.sync: ${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseScanBudget(opts = {}) {
  const pageSize =
    opts.pageSize == null
      ? DEFAULT_PAGE_SIZE
      : parsePositiveInteger(opts.pageSize, "pageSize");
  if (pageSize > MAX_PAGE_SIZE) {
    throw new Error(`${NAME}.sync: pageSize must not exceed ${MAX_PAGE_SIZE}`);
  }
  const maxPages =
    opts.maxPages == null
      ? DEFAULT_MAX_PAGES
      : parsePositiveInteger(opts.maxPages, "maxPages");
  const pageBudget =
    maxPages > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
      ? Number.MAX_SAFE_INTEGER
      : pageSize * maxPages;
  const candidates = [Math.min(pageBudget, MAX_SCAN_RECORDS)];
  if (opts.limit != null) {
    candidates.push(parsePositiveInteger(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    candidates.push(parsePositiveInteger(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...candidates);
}

function isSafeHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isSafeShallowFingerprint(value) {
  return (
    typeof value === "string" && /^(?:[0-9a-f]{32}|[0-9a-f]{64})$/u.test(value)
  );
}

function safeObjectHash(repoHash, rawSha) {
  if (
    !isSafeHash(repoHash) ||
    typeof rawSha !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(rawSha)
  ) {
    return null;
  }
  return sha256Hex(`${repoHash}\0${rawSha.toLowerCase()}`);
}

function emptyCursorState() {
  return { repositories: new Map(), migrated: false };
}

function parseCursor(value) {
  if (value == null || value === "") return emptyCursorState();
  if (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && /^[0-9]+(?:\.[0-9]+)?$/u.test(value.trim()))
  ) {
    // v0.3 and earlier used a global timestamp. It cannot safely represent a
    // newly discovered or rewritten repository, so bootstrap a graph cursor
    // with one bounded, resumable replay.
    return { repositories: new Map(), migrated: true };
  }
  if (typeof value !== "string") {
    return { repositories: new Map(), migrated: true };
  }
  if (Buffer.byteLength(value, "utf8") > MAX_CURSOR_BYTES) {
    const error = new Error(`${NAME}.sync: stored cursor exceeds safe limits`);
    error.code = "GIT_CURSOR_INVALID";
    throw error;
  }
  if (!value.startsWith(CURSOR_PREFIX)) {
    return { repositories: new Map(), migrated: true };
  }

  let parsed;
  try {
    parsed = JSON.parse(value.slice(CURSOR_PREFIX.length));
  } catch {
    return { repositories: new Map(), migrated: true };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.v !== CURSOR_VERSION ||
    !parsed.repos ||
    typeof parsed.repos !== "object" ||
    Array.isArray(parsed.repos)
  ) {
    return { repositories: new Map(), migrated: true };
  }

  const entries = Object.entries(parsed.repos);
  if (entries.length > DEFAULT_MAX_REPOS) {
    const error = new Error(`${NAME}.sync: stored cursor exceeds safe limits`);
    error.code = "GIT_CURSOR_INVALID";
    throw error;
  }
  const repositories = new Map();
  for (const [repoHash, entry] of entries) {
    if (
      !isSafeHash(repoHash) ||
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry)
    ) {
      return { repositories: new Map(), migrated: true };
    }
    const head = entry.h == null ? null : entry.h;
    const anchor = entry.a == null ? null : entry.a;
    const nextAnchor = entry.n == null ? null : entry.n;
    const pendingHead = entry.p == null ? (entry.o > 0 ? head : null) : entry.p;
    const hasShallowFingerprint = Object.prototype.hasOwnProperty.call(
      entry,
      "s",
    );
    const shallowFingerprint = hasShallowFingerprint
      ? entry.s == null || entry.s === 0
        ? null
        : entry.s
      : undefined;
    const offset = entry.o == null ? 0 : Number(entry.o);
    if (
      (head !== null && !isSafeHash(head)) ||
      (anchor !== null && !isSafeHash(anchor)) ||
      (nextAnchor !== null && !isSafeHash(nextAnchor)) ||
      (pendingHead !== null && !isSafeHash(pendingHead)) ||
      (shallowFingerprint !== undefined &&
        shallowFingerprint !== null &&
        !isSafeShallowFingerprint(shallowFingerprint)) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > Number.MAX_SAFE_INTEGER
    ) {
      return { repositories: new Map(), migrated: true };
    }
    if (
      (offset === 0 && (nextAnchor !== null || pendingHead !== null)) ||
      (offset > 0 &&
        (head === null || nextAnchor === null || pendingHead === null))
    ) {
      return { repositories: new Map(), migrated: true };
    }
    repositories.set(repoHash, {
      head,
      anchor,
      nextAnchor,
      pendingHead,
      shallowFingerprint,
      offset,
    });
  }
  return { repositories, migrated: false };
}

function serializeCursor(repositories) {
  const repos = {};
  for (const [repoHash, entry] of [...repositories.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const serialized = {
      h: entry.head == null ? null : entry.head,
      a: entry.anchor == null ? null : entry.anchor,
    };
    if (entry.shallowFingerprint !== undefined) {
      serialized.s =
        entry.shallowFingerprint == null ? 0 : entry.shallowFingerprint;
    }
    if (Number.isSafeInteger(entry.offset) && entry.offset > 0) {
      serialized.n = entry.nextAnchor;
      if (entry.pendingHead !== entry.head) {
        serialized.p = entry.pendingHead;
      }
      serialized.o = entry.offset;
    }
    repos[repoHash] = serialized;
  }
  const value = `${CURSOR_PREFIX}${JSON.stringify({
    v: CURSOR_VERSION,
    repos,
  })}`;
  if (Buffer.byteLength(value, "utf8") > MAX_CURSOR_BYTES) {
    const error = new Error(
      `${NAME}.sync: generated cursor exceeds safe limits`,
    );
    error.code = "GIT_CURSOR_INVALID";
    throw error;
  }
  return value;
}

function boundedText(value, maxChars) {
  if (typeof value !== "string") return { value: "", truncated: false };
  const cleaned = Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0);
      return (
        point === 9 ||
        point === 10 ||
        point === 13 ||
        (point > 31 && point !== 127)
      );
    })
    .join("")
    .trim();
  return {
    value: cleaned.slice(0, maxChars),
    truncated: cleaned.length > maxChars,
  };
}

function boundedMetadata(value, maxChars) {
  return boundedText(value, maxChars).value.replace(/[\r\n\t]+/gu, " ");
}

function redactKnownValues(value, sensitiveValues, replacement = "[redacted]") {
  let result = typeof value === "string" ? value : "";
  const candidates = [...new Set(sensitiveValues.filter(Boolean))]
    .flatMap((candidate) => [
      String(candidate),
      String(candidate).replace(/\\/gu, "/"),
      String(candidate).replace(/\//gu, "\\"),
    ])
    .filter((candidate) => candidate.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    result = result.replace(new RegExp(escaped, "giu"), replacement);
  }
  return result;
}

function sanitizeCommitMetadata(value, sensitiveValues) {
  let result = redactKnownValues(value, sensitiveValues);
  result = result
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/giu, "[redacted-url]")
    .replace(/\b[\w.-]+@[\w.-]+:[^\s<>"']+/gu, "[redacted-url]")
    .replace(/"[a-z]:[\\/][^"\r\n]*"/giu, '"[redacted-path]"')
    .replace(/'[a-z]:[\\/][^'\r\n]*'/giu, "'[redacted-path]'")
    .replace(/"\/[^"\r\n]+"/gu, '"[redacted-path]"')
    .replace(/'\/[^'\r\n]+'/gu, "'[redacted-path]'")
    .replace(/\\\\[^\\\s]+\\[^\s<>"']+/gu, "[redacted-path]")
    .replace(/(?<![a-z0-9])[a-z]:[\\/][^\s<>"'|?*]+/giu, "[redacted-path]")
    .replace(/(^|[^a-z0-9/])\/(?!\/)[^\s<>"')\]}`]+/giu, "$1[redacted-path]")
    .replace(/(^|[^a-z0-9])~[\\/][^\s<>"')\]}`]+/giu, "$1[redacted-path]")
    .replace(
      /(?<![0-9a-f])[0-9a-f]{7,64}(?![0-9a-f])/giu,
      "[redacted-git-object]",
    );
  return result;
}

class GitActivityAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:git-log-local", "sync:profile-directory"];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 48 };
    this.watermarkStrategy = "explicit";
    this.watermarkRequiresCompleteScan = true;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.runtimeCredentialOption = "codeRoots";
    this.runtimeScopeIdentityKey = "codeRoots";
    this.dataDisclosure = {
      fields: [
        "commits:commitHash,authoredAtMs,committedAtMs,authorName,authorEmail,subject,subjectTruncated,repoName,repoHash",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { commits: true },
      excludedFields: [
        "absolute repository/root paths",
        "raw Git object SHA",
        "remote URLs and credentials",
        "diffs and file contents",
        "branch names and reflogs",
      ],
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultRoots:
        typeof opts.defaultCodeRoots === "function"
          ? opts.defaultCodeRoots
          : defaultCodeRoots,
      findRepos:
        typeof opts.findGitRepos === "function"
          ? opts.findGitRepos
          : findGitRepos,
      listCommits:
        typeof opts.listCommits === "function" ? opts.listCommits : listCommits,
      getHeadCommit:
        typeof opts.getHeadCommit === "function"
          ? opts.getHeadCommit
          : getHeadCommit,
      getShallowBoundaryFingerprint:
        typeof opts.getShallowBoundaryFingerprint === "function"
          ? opts.getShallowBoundaryFingerprint
          : typeof opts.getHeadCommit === "function"
            ? async () => null
            : getShallowBoundaryFingerprint,
      listReachableCommitIds:
        typeof opts.listReachableCommitIds === "function"
          ? opts.listReachableCommitIds
          : listReachableCommitIds,
    };
    this._rootsOverride = Array.isArray(opts.codeRoots)
      ? [...opts.codeRoots]
      : Array.isArray(opts.roots)
        ? [...opts.roots]
        : typeof opts.profilePath === "string" && opts.profilePath.trim()
          ? [opts.profilePath]
          : null;
    this.defaultScope = this._scopeForRoots(this._resolveRoots());
  }

  _resolveRoots(opts = {}) {
    let candidates;
    if (Array.isArray(opts.codeRoots)) {
      candidates = opts.codeRoots;
    } else if (Array.isArray(opts.roots)) {
      candidates = opts.roots;
    } else if (
      typeof opts.profilePath === "string" &&
      opts.profilePath.trim()
    ) {
      candidates = [opts.profilePath];
    } else if (this._rootsOverride !== null) {
      candidates = this._rootsOverride;
    } else {
      candidates = this._deps.defaultRoots();
    }
    return [
      ...new Set(
        (candidates || [])
          .map((root) => canonicalPath(root, this._deps.fs))
          .filter(Boolean),
      ),
    ].sort();
  }

  _scopeForRoots(roots) {
    if (roots.length === 0) return undefined;
    const rootIdentities = roots.map((root) => pathHash(root, this._deps.fs));
    return createAccountScope(NAME, `codeRoots:${rootIdentities.join(",")}`);
  }

  resolveDefaultScope(opts = {}) {
    const roots = this._resolveRoots(opts);
    return this._scopeForRoots(roots);
  }

  async authenticate(ctx = {}) {
    const roots = this._resolveRoots(ctx);
    if (roots.length === 0) {
      return {
        ok: false,
        reason: "NO_CODE_ROOTS",
        message:
          "No local code roots were found; select one or more directories",
      };
    }
    let repos;
    try {
      repos = this._deps.findRepos(roots);
    } catch {
      return {
        ok: false,
        reason: "REPOSITORY_SCAN_FAILED",
        message: "Local Git repositories could not be scanned",
      };
    }
    if (repos.length === 0) {
      return {
        ok: false,
        reason: "NO_GIT_REPOS",
        message: "No Git repositories were found under the selected roots",
      };
    }
    return {
      ok: true,
      mode: "file-import",
      repoCount: repos.length,
    };
  }

  async healthCheck(opts = {}) {
    const result = await this.authenticate(opts);
    return result.ok
      ? { ok: true, lastChecked: Date.now() }
      : {
          ok: false,
          reason: result.reason,
          error: result.message,
          lastChecked: Date.now(),
        };
  }

  _safeCommit(commit, repoDir, roots = []) {
    const repoHash = pathHash(repoDir, this._deps.fs);
    const rawSha =
      typeof commit?.sha === "string" &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(commit.sha)
        ? commit.sha.toLowerCase()
        : "";
    if (!repoHash || !rawSha) return null;
    const authoredAtMs = Number(commit.authoredAtMs);
    if (!Number.isSafeInteger(authoredAtMs) || authoredAtMs <= 0) return null;
    const committedAtMs = Number(
      commit.committedAtMs == null ? commit.authoredAtMs : commit.committedAtMs,
    );
    if (!Number.isSafeInteger(committedAtMs) || committedAtMs <= 0) return null;
    const sensitiveValues = [repoDir, ...roots, rawSha];
    const subject = boundedText(
      sanitizeCommitMetadata(commit.subject, sensitiveValues),
      MAX_SUBJECT_CHARS,
    );
    const commitHash = safeObjectHash(repoHash, rawSha);
    return {
      recordId: `${repoHash.slice(0, 24)}:${commitHash.slice(0, 40)}`,
      capturedAt: committedAtMs,
      truncated: subject.truncated,
      payload: {
        commitHash,
        shortCommitHash: commitHash.slice(0, 12),
        authoredAtMs,
        committedAtMs,
        authorName: boundedMetadata(
          sanitizeCommitMetadata(commit.authorName, sensitiveValues),
          255,
        ),
        authorEmail: boundedMetadata(
          sanitizeCommitMetadata(commit.authorEmail, sensitiveValues),
          320,
        ),
        subject: subject.value,
        subjectTruncated: subject.truncated,
        repoName: boundedMetadata(
          sanitizeCommitMetadata(path.basename(repoDir), sensitiveValues),
          255,
        ),
        repoHash,
      },
    };
  }

  async *sync(opts = {}) {
    const roots = this._resolveRoots(opts);
    if (roots.length === 0) {
      const error = new Error(`${NAME}.sync: no code roots were selected`);
      error.code = "NO_CODE_ROOTS";
      throw error;
    }

    const cursor = parseCursor(opts.sinceWatermark);
    const canPublishCursor = typeof opts.updateWatermark === "function";
    const cursorEnabled = canPublishCursor || cursor.repositories.size > 0;
    const pageBudget = parseScanBudget(opts);
    const graphSearchRecords =
      opts.graphSearchRecords == null
        ? Math.min(
            MAX_SCAN_RECORDS,
            Math.max(DEFAULT_GRAPH_SEARCH_RECORDS, pageBudget * 2),
          )
        : parsePositiveInteger(opts.graphSearchRecords, "graphSearchRecords");
    if (graphSearchRecords > MAX_SCAN_RECORDS) {
      throw new Error(
        `${NAME}.sync: graphSearchRecords must not exceed ${MAX_SCAN_RECORDS}`,
      );
    }
    const maxRepos =
      opts.maxRepos == null
        ? DEFAULT_MAX_REPOS
        : parsePositiveInteger(opts.maxRepos, "maxRepos");
    if (maxRepos > DEFAULT_MAX_REPOS) {
      throw new Error(
        `${NAME}.sync: maxRepos must not exceed ${DEFAULT_MAX_REPOS}`,
      );
    }
    const configuredPerRepo =
      opts.maxPerRepo == null
        ? DEFAULT_MAX_PER_REPO
        : parsePositiveInteger(opts.maxPerRepo, "maxPerRepo");
    if (configuredPerRepo > MAX_MAX_PER_REPO) {
      throw new Error(
        `${NAME}.sync: maxPerRepo must not exceed ${MAX_MAX_PER_REPO}`,
      );
    }
    const requestedConcurrency =
      opts.repoConcurrency == null
        ? DEFAULT_REPO_CONCURRENCY
        : parsePositiveInteger(opts.repoConcurrency, "repoConcurrency");
    const repoConcurrency = Math.min(
      requestedConcurrency,
      MAX_REPO_CONCURRENCY,
    );
    let repos = this._deps
      .findRepos(roots)
      .map((repo) => canonicalPath(repo, this._deps.fs));
    repos = [...new Set(repos.filter(Boolean))].sort((a, b) =>
      pathHash(a, this._deps.fs).localeCompare(pathHash(b, this._deps.fs)),
    );

    if (repos.length > maxRepos) {
      const error = new Error(
        `${NAME}.sync: repository count exceeds the configured safe limit`,
      );
      error.code = "GIT_REPO_LIMIT_EXCEEDED";
      throw error;
    }
    let checkpointSafe = true;

    const nextRepositories = new Map();
    for (const repoDir of repos) {
      const repoHash = pathHash(repoDir, this._deps.fs);
      const previous = repoHash ? cursor.repositories.get(repoHash) : null;
      if (repoHash && previous) nextRepositories.set(repoHash, previous);
    }

    const records = [];
    let processedRepos = 0;
    let offset = 0;
    while (offset < repos.length && records.length < pageBudget) {
      const remainingBudget = pageBudget - records.length;
      const batchSize = Math.min(
        repoConcurrency,
        repos.length - offset,
        remainingBudget,
      );
      const batch = repos.slice(offset, offset + batchSize);
      const baseAllowance = Math.floor(remainingBudget / batch.length);
      const extraAllowance = remainingBudget % batch.length;
      processedRepos += batch.length;
      const groups = await Promise.all(
        batch.map(async (repoDir, batchIndex) => {
          const allowance = Math.min(
            configuredPerRepo,
            baseAllowance + (batchIndex < extraAllowance ? 1 : 0),
          );
          const repoHash = pathHash(repoDir, this._deps.fs);
          const previous = repoHash
            ? cursor.repositories.get(repoHash) || null
            : null;
          try {
            if (!repoHash) {
              return {
                repoDir,
                repoHash: null,
                records: [],
                entry: null,
                failed: true,
              };
            }

            const failedResult = () => ({
              repoDir,
              repoHash,
              records: [],
              entry: null,
              failed: true,
            });
            const rawRecord = (safe) => ({
              kind: "commit",
              originalId: `${NAME}-commit:${safe.recordId}`,
              capturedAt: safe.capturedAt,
              payload: safe.payload,
            });

            let head = null;
            let rawHead = null;
            let shallowFingerprint;
            if (cursorEnabled) {
              [rawHead, shallowFingerprint] = await Promise.all([
                this._deps.getHeadCommit(repoDir),
                this._deps.getShallowBoundaryFingerprint(repoDir),
              ]);
              head = rawHead == null ? null : safeObjectHash(repoHash, rawHead);
              if (rawHead != null && !head) return failedResult();

              const shallowKnown = previous?.shallowFingerprint !== undefined;
              const shallowUnchanged =
                shallowKnown &&
                previous.shallowFingerprint === shallowFingerprint;
              if (
                previous &&
                previous.offset === 0 &&
                previous.head === head &&
                shallowUnchanged
              ) {
                return {
                  repoDir,
                  repoHash,
                  records: [],
                  entry: previous,
                  failed: false,
                  cursorSafe: true,
                };
              }
              if (head === null) {
                return {
                  repoDir,
                  repoHash,
                  records: [],
                  entry: {
                    head: null,
                    anchor: null,
                    nextAnchor: null,
                    pendingHead: null,
                    shallowFingerprint,
                    offset: 0,
                  },
                  failed: false,
                  cursorSafe: true,
                };
              }
            }

            // A missing shallow fingerprint is a legacy cursor. A changed
            // boundary means deepen/unshallow exposed a different reachable
            // graph even when HEAD itself is unchanged. Replay that graph
            // once instead of stopping immediately at the old newest anchor.
            let scanPrevious = previous;
            if (
              cursorEnabled &&
              previous &&
              (previous.shallowFingerprint === undefined ||
                previous.shallowFingerprint !== shallowFingerprint)
            ) {
              scanPrevious = null;
            }

            let previousAnchor = scanPrevious?.anchor || null;
            let nextAnchor = null;
            let pendingHead = head;
            let rawPinnedHead = rawHead;
            let skip = 0;
            let prefixRecords = [];
            let resumingPending =
              cursorEnabled && scanPrevious && scanPrevious.offset > 0;

            if (resumingPending) {
              skip = scanPrevious.offset;
              nextAnchor = scanPrevious.nextAnchor;
              pendingHead =
                scanPrevious.pendingHead || scanPrevious.head || head;

              const targetHashes = new Set();
              if (scanPrevious.head !== head && scanPrevious.head) {
                targetHashes.add(scanPrevious.head);
              }
              if (pendingHead !== head && pendingHead) {
                targetHashes.add(pendingHead);
              }

              let reachable = new Map();
              let reachableComplete = true;
              if (targetHashes.size > 0) {
                const ids = await this._deps.listReachableCommitIds(repoDir, {
                  revision: rawHead,
                  maxCount: graphSearchRecords + 1,
                });
                if (!Array.isArray(ids)) return failedResult();
                reachableComplete = ids.length <= graphSearchRecords;
                for (const rawSha of ids) {
                  const safeHash = safeObjectHash(repoHash, rawSha);
                  if (!safeHash) return failedResult();
                  if (targetHashes.has(safeHash) && !reachable.has(safeHash)) {
                    reachable.set(safeHash, String(rawSha).toLowerCase());
                  }
                }
              }

              const missingTarget = [...targetHashes].some(
                (target) => !reachable.has(target),
              );
              if (missingTarget && !reachableComplete) {
                // The pinned revision may be deeper than this bounded graph
                // lookup. Keep the durable cursor so registry adaptive paging
                // can retry with a larger budget.
                return {
                  repoDir,
                  repoHash,
                  records: [],
                  entry: previous,
                  failed: false,
                  cursorSafe: false,
                };
              }
              if (missingTarget) {
                // A force rewrite made the prior pinned graph unreachable.
                // Fall back to the last completed anchor; stable IDs make the
                // replay idempotent.
                resumingPending = false;
                previousAnchor = scanPrevious.anchor || null;
                nextAnchor = null;
                pendingHead = head;
                rawPinnedHead = rawHead;
                skip = 0;
              } else {
                rawPinnedHead =
                  pendingHead === head ? rawHead : reachable.get(pendingHead);

                if (scanPrevious.head !== head) {
                  const rawPreviousHead = reachable.get(scanPrevious.head);
                  const prefixCommits = await this._deps.listCommits(repoDir, {
                    since: 0,
                    skip: 0,
                    maxPerRepo: allowance + 1,
                    revision: rawHead,
                    excludeRevision: rawPreviousHead,
                  });
                  if (!Array.isArray(prefixCommits)) return failedResult();
                  const safePrefix = [];
                  for (const commit of prefixCommits) {
                    const safe = this._safeCommit(commit, repoDir, roots);
                    if (!safe) return failedResult();
                    safePrefix.push(safe);
                  }
                  prefixRecords = safePrefix.slice(0, allowance).map(rawRecord);
                  if (prefixCommits.length > allowance) {
                    const finalShallow =
                      await this._deps.getShallowBoundaryFingerprint(repoDir);
                    if (finalShallow !== shallowFingerprint) {
                      return failedResult();
                    }
                    return {
                      repoDir,
                      repoHash,
                      records: prefixRecords,
                      entry: previous,
                      failed: false,
                      cursorSafe: false,
                    };
                  }
                  if (safePrefix.length > 0) {
                    nextAnchor = safePrefix[0].payload.commitHash;
                  }
                }
              }
            }

            const backfillAllowance = allowance - prefixRecords.length;
            const commits = await this._deps.listCommits(repoDir, {
              since: 0,
              skip,
              maxPerRepo: backfillAllowance + 1,
              revision: rawPinnedHead,
            });
            if (!Array.isArray(commits)) return failedResult();

            const backfillRecords = [];
            let reachedAnchor = false;
            for (const commit of commits) {
              const safe = this._safeCommit(commit, repoDir, roots);
              if (!safe) return failedResult();
              if (!nextAnchor) nextAnchor = safe.payload.commitHash;
              if (
                previousAnchor &&
                safe.payload.commitHash === previousAnchor
              ) {
                reachedAnchor = true;
                break;
              }
              if (backfillRecords.length >= backfillAllowance) break;
              backfillRecords.push(rawRecord(safe));
            }

            const finalShallow =
              cursorEnabled &&
              (await this._deps.getShallowBoundaryFingerprint(repoDir));
            if (cursorEnabled && finalShallow !== shallowFingerprint) {
              return failedResult();
            }

            const sourceEnded = commits.length <= backfillAllowance;
            const finished = reachedAnchor || sourceEnded;
            const repoRecords = [...prefixRecords, ...backfillRecords];
            const entry = finished
              ? {
                  head:
                    cursorEnabled && head
                      ? head
                      : nextAnchor || previous?.head || null,
                  anchor: nextAnchor,
                  nextAnchor: null,
                  pendingHead: null,
                  shallowFingerprint: cursorEnabled
                    ? shallowFingerprint
                    : undefined,
                  offset: 0,
                }
              : {
                  head:
                    cursorEnabled && head
                      ? head
                      : nextAnchor || previous?.head || null,
                  anchor: previousAnchor,
                  nextAnchor,
                  pendingHead:
                    resumingPending && pendingHead
                      ? pendingHead
                      : head || pendingHead,
                  shallowFingerprint: cursorEnabled
                    ? shallowFingerprint
                    : undefined,
                  offset: skip + backfillRecords.length,
                };
            return {
              repoDir,
              repoHash,
              records: repoRecords,
              entry,
              failed: false,
              cursorSafe:
                finished ||
                (canPublishCursor &&
                  entry.head !== null &&
                  entry.pendingHead !== null &&
                  entry.nextAnchor !== null &&
                  entry.offset > skip),
            };
          } catch {
            return {
              repoDir,
              repoHash,
              records: [],
              entry: null,
              failed: true,
            };
          }
        }),
      );

      for (const group of groups) {
        if (group.failed || !group.repoHash || !group.entry) {
          checkpointSafe = false;
          continue;
        }
        nextRepositories.set(group.repoHash, group.entry);
        records.push(...group.records);
        if (!group.cursorSafe) checkpointSafe = false;
      }
      offset += batch.length;
    }
    // A page boundary is safe when every emitted row is represented by a
    // resumable per-repository offset. Repositories not yet visited retain
    // their previous cursor entry (or remain new and will bootstrap next run).
    if (
      processedRepos < repos.length &&
      (!canPublishCursor || records.length < pageBudget)
    ) {
      checkpointSafe = false;
    }

    records.sort(
      (a, b) =>
        a.capturedAt - b.capturedAt || a.originalId.localeCompare(b.originalId),
    );
    if (records.length > pageBudget) {
      records.length = pageBudget;
      checkpointSafe = false;
    }
    for (const record of records) yield record;
    if (checkpointSafe && canPublishCursor) {
      opts.updateWatermark(serializeCursor(nextRepositories));
    }
    if (checkpointSafe && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || raw.kind !== "commit") {
      throw new Error(`${NAME}.normalize: unknown raw kind`);
    }
    const payload =
      raw.payload &&
      typeof raw.payload === "object" &&
      !Array.isArray(raw.payload)
        ? raw.payload
        : {};
    const ingestedAt = Date.now();
    const legacyRepoDir =
      typeof payload.repoDir === "string" ? payload.repoDir : "";
    const legacySha =
      typeof payload.sha === "string" &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(payload.sha)
        ? payload.sha.toLowerCase()
        : "";
    const repoHash = isSafeHash(payload.repoHash)
      ? payload.repoHash
      : pathHash(legacyRepoDir, this._deps.fs) ||
        sha256Hex(
          `${NAME}\0legacy-repo\0${raw.originalId || ""}\0${
            payload.repoName || ""
          }`,
        );
    const commitHash = isSafeHash(payload.commitHash)
      ? payload.commitHash
      : safeObjectHash(repoHash, legacySha) ||
        sha256Hex(
          `${NAME}\0legacy-commit\0${raw.originalId || ""}\0${legacySha}`,
        );
    const safeOriginalId =
      `${NAME}-commit:${repoHash.slice(0, 24)}:` + `${commitHash.slice(0, 40)}`;
    const sensitiveValues = [
      legacyRepoDir,
      legacySha,
      typeof raw.originalId === "string" ? raw.originalId : "",
    ];
    const safeSubject = boundedText(
      sanitizeCommitMetadata(payload.subject, sensitiveValues),
      MAX_SUBJECT_CHARS,
    );
    const subject = safeSubject.value || "(no subject)";
    const authorName = boundedMetadata(
      sanitizeCommitMetadata(payload.authorName, sensitiveValues),
      255,
    );
    const authorEmail = boundedMetadata(
      sanitizeCommitMetadata(payload.authorEmail, sensitiveValues),
      320,
    );
    const repoNameCandidate =
      typeof payload.repoName === "string" && payload.repoName
        ? payload.repoName
        : legacyRepoDir
          ? path.basename(legacyRepoDir)
          : "";
    const repoName = boundedMetadata(
      sanitizeCommitMetadata(repoNameCandidate, sensitiveValues),
      255,
    );
    const capturedAt =
      Number.isSafeInteger(raw.capturedAt) && raw.capturedAt > 0
        ? raw.capturedAt
        : Number.isSafeInteger(payload.committedAtMs) &&
            payload.committedAtMs > 0
          ? payload.committedAtMs
          : ingestedAt;
    const authoredAt =
      Number.isSafeInteger(payload.authoredAtMs) && payload.authoredAtMs > 0
        ? payload.authoredAtMs
        : capturedAt;
    const event = {
      id: `event-git-commit-${commitHash}`,
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.OTHER,
      occurredAt: authoredAt,
      ingestedAt,
      source: {
        adapter: NAME,
        adapterVersion: VERSION,
        capturedAt,
        capturedBy: CAPTURED_BY.EXPORT,
        originalId: safeOriginalId,
      },
      actor: authorName || authorEmail || "self",
      content: {
        title: subject.length > 100 ? `${subject.substring(0, 100)}…` : subject,
        text: subject,
      },
      extra: {
        kind: "git-commit",
        commitHash,
        shortCommitHash: commitHash.slice(0, 12),
        repoName: repoName || null,
        repoHash,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
        subjectTruncated:
          payload.subjectTruncated === true || safeSubject.truncated,
      },
    };
    return {
      events: [event],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
  }
}

module.exports = {
  GitActivityAdapter,
  GIT_ACTIVITY_NAME: NAME,
  GIT_ACTIVITY_VERSION: VERSION,
  DEFAULT_REPO_CONCURRENCY,
  MAX_REPO_CONCURRENCY,
};
