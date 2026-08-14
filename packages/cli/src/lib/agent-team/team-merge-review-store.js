/**
 * Physical append-only, hash-chained persistence for canonical Team merge
 * reviews. Each line is one complete, strict event containing the resulting
 * content-minimized review snapshot. A torn, reordered, truncated or edited
 * line fails closed during replay.
 */

import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { withFileLock } from "../with-file-lock.js";
import { ensurePrivateFile } from "../secure-fs.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  SecureFileIdentityError,
  withTrustedFileParentSync,
} from "../secure-file-identity.js";
import {
  applyMergeReviewDecision,
  assertMergeReviewSuccessor,
  canonicalMergeReviewJson,
  digestMergeReview,
  TEAM_MERGE_REVIEW_SCHEMA,
  TEAM_MERGE_REVIEW_SCHEMA_VERSION,
  validateMergeReview,
  transitionMergeReview,
} from "./team-merge-review.js";

export const TEAM_MERGE_REVIEW_STORE_EVENT_VERSION = 1;
export const TEAM_MERGE_REVIEW_STORE_MAX_BYTES = 64 * 1024 * 1024;
export const TEAM_MERGE_REVIEW_STORE_MAX_EVENTS = 10_000;
export const TEAM_MERGE_REVIEW_STORE_MAX_EVENT_BYTES = 8 * 1024 * 1024;

export const TEAM_MERGE_REVIEW_STORE_ERROR = Object.freeze({
  INVALID: "TEAM_MERGE_REVIEW_STORE_INVALID",
  UNSAFE_PATH: "TEAM_MERGE_REVIEW_STORE_UNSAFE_PATH",
  LOCK_UNAVAILABLE: "TEAM_MERGE_REVIEW_STORE_LOCK_UNAVAILABLE",
  READ_FAILED: "TEAM_MERGE_REVIEW_STORE_READ_FAILED",
  WRITE_FAILED: "TEAM_MERGE_REVIEW_STORE_WRITE_FAILED",
  CORRUPT: "TEAM_MERGE_REVIEW_STORE_CORRUPT",
  NOT_FOUND: "TEAM_MERGE_REVIEW_STORE_NOT_FOUND",
  CONFLICT: "TEAM_MERGE_REVIEW_STORE_CONFLICT",
  STALE: "TEAM_MERGE_REVIEW_STORE_STALE",
  LIMIT: "TEAM_MERGE_REVIEW_STORE_LIMIT",
});

const EVENT_TYPES = new Set([
  "review.created",
  "review.decided",
  "review.transitioned",
]);
const EVENT_KEYS = new Set([
  "schema",
  "schemaVersion",
  "eventVersion",
  "sequence",
  "type",
  "at",
  "reviewId",
  "previousDigest",
  "review",
  "digest",
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export class TeamMergeReviewStoreError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "TeamMergeReviewStoreError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined && value !== null) this[key] = value;
    }
  }
}

function storeError(code, message, details = {}, cause = null) {
  return new TeamMergeReviewStoreError(code, message, details, cause);
}

function isStoreError(error) {
  return Object.values(TEAM_MERGE_REVIEW_STORE_ERROR).includes(error?.code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
      `${label} must be an object`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
      `${label} must be a plain object`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (descriptor) =>
        descriptor.get || descriptor.set || descriptor.enumerable !== true,
    )
  ) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
      `${label} must not contain symbols or accessors`,
    );
  }
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
      `${label} has unexpected or missing fields`,
    );
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function eventMaterial(event) {
  const material = { ...event };
  delete material.digest;
  return material;
}

export function computeTeamMergeReviewStoreEventDigest(event) {
  return digestMergeReview(
    "cc-team-merge-review-store-event-v1",
    eventMaterial(event),
  );
}

function cursor(runtime) {
  return {
    sequence: runtime.events.length,
    digest: runtime.events.at(-1)?.digest || null,
  };
}

function emptyRuntime() {
  return {
    reviews: new Map(),
    events: [],
    physicalBytes: 0,
  };
}

function validateCursor(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  assertPlainObject(value, label);
  const sequence = value.sequence;
  const digest = value.digest;
  if (
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    (sequence === 0 ? digest !== null : !DIGEST.test(String(digest || "")))
  ) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.INVALID,
      `${label} is invalid`,
    );
  }
  return { sequence, digest };
}

function requireCurrentCursor(runtime, expectedCursor) {
  if (expectedCursor == null) return;
  const expected = validateCursor(expectedCursor, "expectedCursor");
  const current = cursor(runtime);
  if (
    expected.sequence !== current.sequence ||
    expected.digest !== current.digest
  ) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.STALE,
      "merge-review store cursor is stale",
      { expectedCursor: expected, cursor: current },
    );
  }
}

function requireAnchor(runtime, anchor) {
  if (anchor == null) return;
  const expected = validateCursor(anchor, "anchor");
  if (expected.sequence > runtime.events.length) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.STALE,
      "merge-review store anchor is ahead of the current log",
    );
  }
  const digest =
    expected.sequence === 0
      ? null
      : runtime.events[expected.sequence - 1]?.digest || null;
  if (digest !== expected.digest) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.STALE,
      "merge-review store anchor is not a prefix of the current log",
    );
  }
}

function validateEvent(value, previousDigest, sequence) {
  assertExactKeys(value, EVENT_KEYS, `event ${sequence}`);
  if (
    value.schema !== TEAM_MERGE_REVIEW_SCHEMA ||
    value.schemaVersion !== TEAM_MERGE_REVIEW_SCHEMA_VERSION ||
    value.eventVersion !== TEAM_MERGE_REVIEW_STORE_EVENT_VERSION ||
    value.sequence !== sequence ||
    !EVENT_TYPES.has(value.type) ||
    value.previousDigest !== previousDigest ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at)) ||
    typeof value.reviewId !== "string" ||
    !DIGEST.test(String(value.digest || ""))
  ) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
      `event ${sequence} has an invalid envelope`,
    );
  }
  if (computeTeamMergeReviewStoreEventDigest(value) !== value.digest) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
      `event ${sequence} digest mismatch`,
    );
  }
  let review;
  try {
    review = validateMergeReview(value.review);
  } catch (cause) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
      `event ${sequence} contains invalid review evidence`,
      { sequence },
      cause,
    );
  }
  if (review.reviewId !== value.reviewId || review.updatedAt !== value.at) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
      `event ${sequence} review binding mismatch`,
    );
  }
  return { ...value, review };
}

function replayEvents(events) {
  const runtime = emptyRuntime();
  let previousDigest = null;
  events.forEach((raw, index) => {
    const sequence = index + 1;
    const event = validateEvent(raw, previousDigest, sequence);
    const previous = runtime.reviews.get(event.reviewId) || null;
    if (event.type === "review.created") {
      if (
        previous ||
        event.review.revision !== 0 ||
        event.review.state !== "planned" ||
        event.review.decision !== null ||
        event.review.createdAt !== event.review.updatedAt
      ) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
          `event ${sequence} is not a unique planned review creation`,
        );
      }
    } else {
      if (!previous) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
          `event ${sequence} updates an unknown review`,
        );
      }
      try {
        assertMergeReviewSuccessor(previous, event.review, event.type);
      } catch (cause) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
          `event ${sequence} is not a legal review successor`,
          { sequence, reviewId: event.reviewId },
          cause,
        );
      }
    }
    runtime.reviews.set(event.reviewId, event.review);
    runtime.events.push(event);
    previousDigest = event.digest;
  });
  return runtime;
}

function buildEvent(runtime, type, review) {
  const event = {
    schema: TEAM_MERGE_REVIEW_SCHEMA,
    schemaVersion: TEAM_MERGE_REVIEW_SCHEMA_VERSION,
    eventVersion: TEAM_MERGE_REVIEW_STORE_EVENT_VERSION,
    sequence: runtime.events.length + 1,
    type,
    at: review.updatedAt,
    reviewId: review.reviewId,
    previousDigest: runtime.events.at(-1)?.digest || null,
    review,
    digest: null,
  };
  event.digest = computeTeamMergeReviewStoreEventDigest(event);
  return event;
}

function safeFileEntry(runtimeFs, filePath, { allowMissing = false } = {}) {
  let entry;
  try {
    entry = runtimeFs.lstatSync(filePath, { bigint: true });
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return null;
    throw cause;
  }
  if (entry.isSymbolicLink() || !entry.isFile() || Number(entry.nlink) !== 1) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.UNSAFE_PATH,
      "merge-review store must be a regular, single-link file",
      { filePath },
    );
  }
  if (process.platform !== "win32" && (Number(entry.mode) & 0o7777) !== 0o600) {
    throw storeError(
      TEAM_MERGE_REVIEW_STORE_ERROR.UNSAFE_PATH,
      "merge-review store must be owner-only (0600)",
      { filePath },
    );
  }
  return entry;
}

export class TeamMergeReviewStore {
  constructor({
    filePath,
    runtimeFs = fs,
    lock = withFileLock,
    secureFileParent = withTrustedFileParentSync,
    ensureOwnerOnlyFile = ensurePrivateFile,
    maxBytes = TEAM_MERGE_REVIEW_STORE_MAX_BYTES,
    maxEvents = TEAM_MERGE_REVIEW_STORE_MAX_EVENTS,
    maxEventBytes = TEAM_MERGE_REVIEW_STORE_MAX_EVENT_BYTES,
    lockTimeoutMs = 5000,
    lockStaleMs = 30_000,
  } = {}) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.INVALID,
        "merge-review store filePath is required",
      );
    }
    this.filePath = path.resolve(filePath);
    this._fs = runtimeFs;
    this._lock = lock;
    this._secureFileParent = secureFileParent;
    this._ensureOwnerOnlyFile = ensureOwnerOnlyFile;
    this.maxBytes = Math.max(1024, Math.floor(Number(maxBytes) || 0));
    this.maxEvents = Math.max(1, Math.floor(Number(maxEvents) || 0));
    this.maxEventBytes = Math.max(1024, Math.floor(Number(maxEventBytes) || 0));
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockStaleMs = lockStaleMs;
  }

  _secureRead() {
    try {
      return this._secureFileParent(
        this._fs,
        this.filePath,
        ({ canonicalPath, parentDevice }) => {
          const before = safeFileEntry(this._fs, canonicalPath);
          if (Number(before.size) > this.maxBytes) {
            throw storeError(
              TEAM_MERGE_REVIEW_STORE_ERROR.LIMIT,
              `merge-review store cannot exceed ${this.maxBytes} bytes`,
            );
          }
          const flags =
            Number(this._fs.constants?.O_RDONLY ?? fs.constants.O_RDONLY) |
            Number(
              this._fs.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0,
            );
          let descriptor = null;
          try {
            descriptor = this._fs.openSync(canonicalPath, flags);
            const opened = this._fs.fstatSync(descriptor, { bigint: true });
            if (
              !opened.isFile() ||
              Number(opened.nlink) !== 1 ||
              !samePathHandleFileIdentity(before, opened, parentDevice)
            ) {
              throw storeError(
                TEAM_MERGE_REVIEW_STORE_ERROR.UNSAFE_PATH,
                "merge-review store identity changed while opening",
              );
            }
            const bytes = this._fs.readFileSync(descriptor);
            const after = this._fs.fstatSync(descriptor, { bigint: true });
            if (
              !sameFileStatIdentity(opened, after) ||
              Number(after.size) !== bytes.length
            ) {
              throw storeError(
                TEAM_MERGE_REVIEW_STORE_ERROR.UNSAFE_PATH,
                "merge-review store changed while reading",
              );
            }
            return bytes;
          } finally {
            if (descriptor !== null) this._fs.closeSync(descriptor);
          }
        },
      );
    } catch (cause) {
      if (isStoreError(cause)) throw cause;
      if (cause instanceof SecureFileIdentityError) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.UNSAFE_PATH,
          "merge-review store parent identity is unsafe",
          { filePath: this.filePath },
          cause,
        );
      }
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.READ_FAILED,
        "could not securely read merge-review store",
        { filePath: this.filePath },
        cause,
      );
    }
  }

  _decode(bytes) {
    if (bytes.length === 0) return emptyRuntime();
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (cause) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
        "merge-review store is not valid UTF-8",
        {},
        cause,
      );
    }
    if (!text.endsWith("\n")) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
        "merge-review store has a truncated final event",
      );
    }
    const lines = text.slice(0, -1).split("\n");
    if (lines.length > this.maxEvents) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.LIMIT,
        `merge-review store exceeds ${this.maxEvents} events`,
      );
    }
    const events = lines.map((line, index) => {
      if (!line || Buffer.byteLength(line, "utf8") > this.maxEventBytes) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.LIMIT,
          `merge-review event ${index + 1} is empty or oversized`,
        );
      }
      try {
        const event = JSON.parse(line);
        if (line !== canonicalMergeReviewJson(event)) {
          throw storeError(
            TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
            `merge-review event ${index + 1} is not canonically encoded`,
            { sequence: index + 1 },
          );
        }
        return event;
      } catch (cause) {
        if (isStoreError(cause)) throw cause;
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT,
          `merge-review event ${index + 1} is invalid JSON`,
          { sequence: index + 1 },
          cause,
        );
      }
    });
    const runtime = replayEvents(events);
    runtime.physicalBytes = bytes.length;
    return runtime;
  }

  _readRuntime() {
    const entry = safeFileEntry(this._fs, this.filePath, {
      allowMissing: true,
    });
    return entry ? this._decode(this._secureRead()) : emptyRuntime();
  }

  _append(runtime, type, review) {
    if (runtime.events.length >= this.maxEvents) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.LIMIT,
        `merge-review store cannot exceed ${this.maxEvents} events`,
      );
    }
    const event = buildEvent(runtime, type, review);
    const line = `${canonicalMergeReviewJson(event)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > this.maxEventBytes) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.LIMIT,
        `merge-review event cannot exceed ${this.maxEventBytes} bytes`,
      );
    }
    const currentBytes = runtime.physicalBytes;
    if (currentBytes + lineBytes > this.maxBytes) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.LIMIT,
        `merge-review store cannot exceed ${this.maxBytes} bytes`,
      );
    }
    try {
      this._secureFileParent(
        this._fs,
        this.filePath,
        ({ canonicalPath, parentDescriptor, parentDevice }) => {
          const before = safeFileEntry(this._fs, canonicalPath, {
            allowMissing: true,
          });
          if (
            (!before && currentBytes !== 0) ||
            (before && Number(before.size) !== currentBytes)
          ) {
            throw storeError(
              TEAM_MERGE_REVIEW_STORE_ERROR.STALE,
              "merge-review store changed before append",
            );
          }
          const flags =
            Number(this._fs.constants?.O_WRONLY ?? fs.constants.O_WRONLY) |
            Number(this._fs.constants?.O_APPEND ?? fs.constants.O_APPEND) |
            Number(this._fs.constants?.O_CREAT ?? fs.constants.O_CREAT) |
            Number(
              this._fs.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0,
            );
          let descriptor = null;
          try {
            descriptor = this._fs.openSync(canonicalPath, flags, 0o600);
            const opened = this._fs.fstatSync(descriptor, { bigint: true });
            if (
              !opened.isFile() ||
              Number(opened.nlink) !== 1 ||
              (before &&
                !samePathHandleFileIdentity(before, opened, parentDevice))
            ) {
              throw storeError(
                TEAM_MERGE_REVIEW_STORE_ERROR.UNSAFE_PATH,
                "merge-review store identity changed while appending",
              );
            }
            this._fs.fchmodSync(descriptor, 0o600);
            this._ensureOwnerOnlyFile(canonicalPath, {
              applyWindowsAcl: true,
              failIfUnavailable: true,
            });
            this._fs.writeFileSync(descriptor, line, "utf8");
            this._fs.fsyncSync(descriptor);
            const after = this._fs.fstatSync(descriptor, { bigint: true });
            if (
              !after.isFile() ||
              Number(after.nlink) !== 1 ||
              Number(after.size) !== currentBytes + lineBytes
            ) {
              throw storeError(
                TEAM_MERGE_REVIEW_STORE_ERROR.WRITE_FAILED,
                "merge-review append size verification failed",
              );
            }
            if (process.platform !== "win32") {
              this._fs.fsyncSync(parentDescriptor);
            }
          } finally {
            if (descriptor !== null) this._fs.closeSync(descriptor);
          }
        },
      );
    } catch (cause) {
      if (isStoreError(cause)) throw cause;
      if (cause instanceof SecureFileIdentityError) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.UNSAFE_PATH,
          "merge-review store parent identity is unsafe",
          { filePath: this.filePath },
          cause,
        );
      }
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.WRITE_FAILED,
        "could not append merge-review event",
        { filePath: this.filePath },
        cause,
      );
    }
    const persisted = this._readRuntime();
    if (persisted.events.at(-1)?.digest !== event.digest) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.WRITE_FAILED,
        "merge-review append readback verification failed",
      );
    }
    return persisted;
  }

  _withLock(operation, callback) {
    try {
      return this._lock(this.filePath, () => callback(this._readRuntime()), {
        timeoutMs: this.lockTimeoutMs,
        staleMs: this.lockStaleMs,
        failIfUnavailable: true,
      });
    } catch (cause) {
      if (isStoreError(cause) || cause?.name === "TeamMergeReviewError") {
        throw cause;
      }
      if (
        cause?.code === "STATE_LOCK_UNAVAILABLE" ||
        cause?.code === "STATE_LOCK_OWNERSHIP_LOST"
      ) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.LOCK_UNAVAILABLE,
          `could not hold merge-review lock for ${operation}`,
          { filePath: this.filePath },
          cause,
        );
      }
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.WRITE_FAILED,
        `merge-review store ${operation} failed closed`,
        { filePath: this.filePath },
        cause,
      );
    }
  }

  _result(runtime, review, extra = {}) {
    return {
      review: clone(review),
      cursor: cursor(runtime),
      ...extra,
    };
  }

  read({ anchor = null } = {}) {
    return this._withLock("read", (runtime) => {
      requireAnchor(runtime, anchor);
      return {
        reviews: [...runtime.reviews.values()].map(clone),
        cursor: cursor(runtime),
      };
    });
  }

  list(options = {}) {
    return this.read(options).reviews;
  }

  get(reviewId, { anchor = null } = {}) {
    return this._withLock("get", (runtime) => {
      requireAnchor(runtime, anchor);
      const review = runtime.reviews.get(String(reviewId || ""));
      return review ? clone(review) : null;
    });
  }

  create(value, { expectedCursor = null } = {}) {
    const review = validateMergeReview(value);
    if (
      review.revision !== 0 ||
      review.state !== "planned" ||
      review.decision !== null ||
      review.createdAt !== review.updatedAt
    ) {
      throw storeError(
        TEAM_MERGE_REVIEW_STORE_ERROR.INVALID,
        "only a pristine revision-0 planned review can be created",
      );
    }
    return this._withLock("create", (runtime) => {
      requireCurrentCursor(runtime, expectedCursor);
      const existing = runtime.reviews.get(review.reviewId);
      if (existing) {
        if (existing.evidenceDigest !== review.evidenceDigest) {
          throw storeError(
            TEAM_MERGE_REVIEW_STORE_ERROR.CONFLICT,
            "merge-review ID already binds different evidence",
          );
        }
        return this._result(runtime, existing, { duplicate: true });
      }
      const persisted = this._append(runtime, "review.created", review);
      return this._result(persisted, persisted.reviews.get(review.reviewId), {
        duplicate: false,
      });
    });
  }

  decide(reviewId, request = {}, { expectedCursor = null } = {}) {
    return this._withLock("decide", (runtime) => {
      requireCurrentCursor(runtime, expectedCursor);
      const current = runtime.reviews.get(String(reviewId || ""));
      if (!current) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.NOT_FOUND,
          "merge-review was not found",
          { reviewId },
        );
      }
      const next = applyMergeReviewDecision(current, request);
      if (next.revision === current.revision) {
        return this._result(runtime, current, { duplicate: true });
      }
      const persisted = this._append(runtime, "review.decided", next);
      return this._result(persisted, persisted.reviews.get(current.reviewId), {
        duplicate: false,
      });
    });
  }

  transition(reviewId, request = {}, { expectedCursor = null } = {}) {
    return this._withLock("transition", (runtime) => {
      requireCurrentCursor(runtime, expectedCursor);
      const current = runtime.reviews.get(String(reviewId || ""));
      if (!current) {
        throw storeError(
          TEAM_MERGE_REVIEW_STORE_ERROR.NOT_FOUND,
          "merge-review was not found",
          { reviewId },
        );
      }
      const next = transitionMergeReview(current, request);
      const persisted = this._append(runtime, "review.transitioned", next);
      return this._result(persisted, persisted.reviews.get(current.reviewId), {
        duplicate: false,
      });
    });
  }
}

export function mergeReviewStoreSnapshotDigest(value) {
  return digestMergeReview("cc-team-merge-review-store-snapshot-v1", value);
}
