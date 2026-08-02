/**
 * SessionResourceBudget is the single resource authority shared by a root
 * agent, nested agents, tools and background work.
 *
 * Admission limits (concurrency, total spawns, depth and turns) are checked
 * synchronously, so multiple Promise continuations cannot oversubscribe them.
 * Continuous limits (tokens, USD, wall time and aggregate tool time) actively
 * abort the session as soon as they are exhausted; callers do not have to wait
 * until the next spawn or model turn to notice.
 *
 * Snapshots retain settled totals and identify work that was in flight. A
 * restored dirty snapshot is fail-closed until the host proves that every
 * listed resource was stopped/adjudicated. Process downtime is not charged to
 * wall time, matching the existing resumable TeamBudget contract.
 */

import { CostBudget } from "./cost-budget.js";

export const SESSION_RESOURCE_BUDGET_VERSION = 1;

const INTEGER_LIMITS = new Set([
  "maxConcurrent",
  "maxSpawns",
  "maxDepth",
  "maxTurns",
  "maxTokens",
]);

const LIMIT_FIELDS = Object.freeze([
  "maxConcurrent",
  "maxSpawns",
  "maxDepth",
  "maxTurns",
  "maxTokens",
  "maxUsd",
  "maxWallMs",
  "maxToolMs",
]);

const CONTINUOUS_REASONS = new Set([
  "max-tokens",
  "unpriced-usage",
  "max-usd",
  "max-wall-ms",
  "max-tool-ms",
]);

const USAGE_TOKEN_FIELDS = Object.freeze([
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
]);

const MAX_TIMER_DELAY = 2_147_483_647;

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeLimit(field, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  const allowsZero = field === "maxDepth";
  if (
    !Number.isFinite(value) ||
    (allowsZero ? value < 0 : value <= 0) ||
    (INTEGER_LIMITS.has(field) && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(`invalid session budget limit: ${field}`);
  }
  return value;
}

function normalizeNonNegativeInteger(field, raw) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`invalid session budget total: ${field}`);
  }
  return value;
}

function normalizeNonNegativeNumber(field, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`invalid session budget total: ${field}`);
  }
  return value;
}

function normalizeUsageTokens(usage) {
  const fields = Object.fromEntries(
    USAGE_TOKEN_FIELDS.map((field) => [field, 0]),
  );
  if (usage == null) return { fields, total: 0 };
  if (!isRecord(usage)) {
    throw new TypeError("invalid session budget usage");
  }
  let total = 0;
  for (const field of USAGE_TOKEN_FIELDS) {
    const raw = usage[field];
    if (raw === undefined || raw === null) continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`invalid session budget usage: ${field}`);
    }
    fields[field] = value;
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new TypeError("session budget token total exceeds safe integer");
    }
  }
  return { fields, total };
}

function safeReason(reason, fallback = "session-aborted") {
  if (reason instanceof Error) return reason;
  const text = String(reason || fallback).slice(0, 512);
  const error = new Error(text || fallback);
  error.code = "ERR_SESSION_ABORTED";
  return error;
}

function snapshotResource(entry, now) {
  return {
    id: entry.id,
    kind: entry.kind,
    ...(entry.depth !== null ? { depth: entry.depth } : {}),
    ...(entry.startedAt !== null
      ? { elapsedMs: Math.max(0, now - entry.startedAt) }
      : {}),
  };
}

function validateResourceList(value, field) {
  if (!Array.isArray(value)) {
    throw new TypeError(`invalid session budget in-flight list: ${field}`);
  }
  const seen = new Set();
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      entry.id.length > 512 ||
      typeof entry.kind !== "string" ||
      entry.kind.length === 0 ||
      entry.kind.length > 128 ||
      seen.has(entry.id)
    ) {
      throw new TypeError(`invalid session budget in-flight entry: ${field}`);
    }
    seen.add(entry.id);
    const normalized = { id: entry.id, kind: entry.kind };
    if (entry.depth !== undefined) {
      normalized.depth = normalizeNonNegativeInteger("depth", entry.depth);
    }
    if (entry.elapsedMs !== undefined) {
      normalized.elapsedMs = normalizeNonNegativeNumber(
        "elapsedMs",
        entry.elapsedMs,
      );
    }
    return normalized;
  });
}

function validateSnapshot(snapshot) {
  if (
    !isRecord(snapshot) ||
    snapshot.version !== SESSION_RESOURCE_BUDGET_VERSION ||
    !isRecord(snapshot.limits) ||
    !isRecord(snapshot.totals) ||
    !isRecord(snapshot.inFlight) ||
    !isRecord(snapshot.state)
  ) {
    throw new TypeError("invalid session resource budget snapshot");
  }
  const limits = {};
  for (const field of LIMIT_FIELDS) {
    if (!Object.hasOwn(snapshot.limits, field)) {
      throw new TypeError(`missing session budget limit: ${field}`);
    }
    limits[field] = normalizeLimit(field, snapshot.limits[field]);
  }
  const totals = {
    spawns: normalizeNonNegativeInteger("spawns", snapshot.totals.spawns),
    turns: normalizeNonNegativeInteger("turns", snapshot.totals.turns),
    tokens: normalizeNonNegativeInteger("tokens", snapshot.totals.tokens),
    spentUsd: normalizeNonNegativeNumber("spentUsd", snapshot.totals.spentUsd),
    elapsedMs: normalizeNonNegativeNumber(
      "elapsedMs",
      snapshot.totals.elapsedMs,
    ),
    toolMs: normalizeNonNegativeNumber("toolMs", snapshot.totals.toolMs),
    unpricedUsage: snapshot.totals.unpricedUsage,
  };
  if (typeof totals.unpricedUsage !== "boolean") {
    throw new TypeError("invalid session budget unpriced usage state");
  }
  if (typeof snapshot.state.started !== "boolean") {
    throw new TypeError("invalid session budget started state");
  }
  if (
    snapshot.state.abort !== null &&
    (!isRecord(snapshot.state.abort) ||
      typeof snapshot.state.abort.reason !== "string" ||
      typeof snapshot.state.abort.message !== "string")
  ) {
    throw new TypeError("invalid session budget abort state");
  }
  const work = validateResourceList(snapshot.inFlight.work, "work");
  const tools = validateResourceList(snapshot.inFlight.tools, "tools");
  const workIds = new Set(work.map((entry) => entry.id));
  if (tools.some((entry) => workIds.has(entry.id))) {
    throw new TypeError(
      "duplicate session budget in-flight id across work and tools",
    );
  }
  return {
    limits,
    totals,
    state: {
      started: snapshot.state.started,
      abort: snapshot.state.abort,
    },
    inFlight: {
      work,
      tools,
    },
  };
}

function tightenLimit(field, stored, override) {
  const prior = normalizeLimit(field, stored);
  if (override === undefined || override === null || override === "") {
    return prior;
  }
  const next = normalizeLimit(field, override);
  if (prior === null) return next;
  return Math.min(prior, next);
}

export class SessionBudgetError extends Error {
  constructor(reason, message = null) {
    super(message || `Session resource budget exhausted: ${reason}`);
    this.name = "SessionBudgetError";
    this.code = "ERR_SESSION_RESOURCE_BUDGET";
    this.budgetReason = reason;
    this.retryable = false;
  }
}

export class SessionResourceBudget {
  constructor({
    maxConcurrent = null,
    maxSpawns = null,
    maxDepth = null,
    maxTurns = null,
    maxTokens = null,
    maxUsd = null,
    maxCostUsd = undefined,
    maxWallMs = null,
    maxToolMs = null,
    table = undefined,
    now = () => Date.now(),
    setTimer = (fn, delay) => setTimeout(fn, delay),
    clearTimer = (timer) => clearTimeout(timer),
    signal = null,
    onEvent = null,
  } = {}) {
    this._now = typeof now === "function" ? now : () => Number(now);
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._onEvent = typeof onEvent === "function" ? onEvent : null;
    this._eventSeq = 0;

    this.maxConcurrent = normalizeLimit("maxConcurrent", maxConcurrent);
    this.maxSpawns = normalizeLimit("maxSpawns", maxSpawns);
    this.maxDepth = normalizeLimit("maxDepth", maxDepth);
    this.maxTurns = normalizeLimit("maxTurns", maxTurns);
    this.maxTokens = normalizeLimit("maxTokens", maxTokens);
    this.maxWallMs = normalizeLimit("maxWallMs", maxWallMs);
    this.maxToolMs = normalizeLimit("maxToolMs", maxToolMs);
    const usdLimit = maxCostUsd === undefined ? maxUsd : maxCostUsd;
    this.cost = new CostBudget({
      limitUsd: normalizeLimit("maxUsd", usdLimit),
      table,
    });

    this.spawns = 0;
    this.turns = 0;
    this.tokens = 0;
    this.unpricedUsage = false;
    this._elapsedMs = 0;
    this._startedAt = null;
    this._toolMs = 0;
    this._activeWork = new Map();
    this._activeTools = new Map();
    this._abortables = new Map();
    this._recoveryUnknown = new Map();
    this._deadlineTimer = null;
    this._abortController = new AbortController();
    this._abortState = null;
    this._externalSignal = signal || null;
    this._externalAbortListener = null;

    if (this._externalSignal) {
      this._externalAbortListener = () =>
        this.abort(this._externalSignal.reason || "parent-aborted", {
          reason: "parent-aborted",
        });
      if (this._externalSignal.aborted) this._externalAbortListener();
      else {
        this._externalSignal.addEventListener?.(
          "abort",
          this._externalAbortListener,
          { once: true },
        );
      }
    }
  }

  get signal() {
    return this._abortController.signal;
  }

  enabled() {
    return LIMIT_FIELDS.some((field) =>
      field === "maxUsd" ? this.cost.limitUsd !== null : this[field] !== null,
    );
  }

  start(now = this._now()) {
    if (this._startedAt === null) {
      this._startedAt = now;
      this._emit("budget:started", {});
      this._armDeadline(now);
    }
    return this;
  }

  _emit(type, detail) {
    if (!this._onEvent) return;
    try {
      this._onEvent({
        type,
        sequence: ++this._eventSeq,
        at: this._now(),
        ...detail,
      });
    } catch {
      // Observability is never part of the resource authority.
    }
  }

  _elapsedAt(now = this._now()) {
    return (
      this._elapsedMs +
      (this._startedAt === null ? 0 : Math.max(0, now - this._startedAt))
    );
  }

  _toolMsAt(now = this._now()) {
    let live = this._toolMs;
    for (const tool of this._activeTools.values()) {
      live += Math.max(0, now - tool.startedAt);
    }
    return live;
  }

  _continuousReason(now = this._now()) {
    if (this.maxTokens !== null && this.tokens >= this.maxTokens) {
      return "max-tokens";
    }
    if (this.cost.enabled() && this.unpricedUsage) {
      return "unpriced-usage";
    }
    if (this.cost.exceeded()) return "max-usd";
    if (this.maxWallMs !== null && this._elapsedAt(now) >= this.maxWallMs) {
      return "max-wall-ms";
    }
    if (this.maxToolMs !== null && this._toolMsAt(now) >= this.maxToolMs) {
      return "max-tool-ms";
    }
    return null;
  }

  reason(now = this._now()) {
    if (this._abortState) return this._abortState.reason;
    if (this._recoveryUnknown.size > 0) return "recovery-required";
    const continuous = this._continuousReason(now);
    if (continuous) return continuous;
    if (this.maxTurns !== null && this.turns >= this.maxTurns) {
      return "max-turns";
    }
    if (this.maxSpawns !== null && this.spawns >= this.maxSpawns) {
      return "max-spawns";
    }
    return null;
  }

  shouldStop(now = this._now()) {
    return this.reason(now) !== null;
  }

  _admissionFailure(reason, extra = {}) {
    this._emit("budget:admission-denied", { reason, ...extra });
    return { ok: false, reason, retryable: reason === "max-concurrent" };
  }

  consumeTurn({ id = null } = {}) {
    this.start();
    if (this.signal.aborted) {
      return this._admissionFailure(this.reason() || "session-aborted", { id });
    }
    if (this._recoveryUnknown.size > 0) {
      return this._admissionFailure("recovery-required", { id });
    }
    if (this.maxTurns !== null && this.turns >= this.maxTurns) {
      return this._admissionFailure("max-turns", { id });
    }
    this.turns += 1;
    this._emit("budget:turn-consumed", { id, turns: this.turns });
    return { ok: true, turns: this.turns, remaining: this.turnsRemaining() };
  }

  turnsRemaining() {
    return this.maxTurns === null
      ? Infinity
      : Math.max(0, this.maxTurns - this.turns);
  }

  acquireWork({ id, kind = "spawn", depth = 1 } = {}) {
    const key = String(id || "");
    if (!key) throw new TypeError("session budget work id is required");
    if (key.length > 512)
      throw new TypeError("session budget work id is too long");
    const normalizedKind = String(kind || "spawn");
    if (!normalizedKind || normalizedKind.length > 128) {
      throw new TypeError("invalid session budget work kind");
    }
    const normalizedDepth = normalizeNonNegativeInteger("depth", depth);
    this.start();
    if (this._activeWork.has(key)) {
      return this._admissionFailure("duplicate-work-id", { id: key });
    }
    if (this._activeTools.has(key)) {
      return this._admissionFailure("duplicate-resource-id", { id: key });
    }
    if (this.signal.aborted) {
      return this._admissionFailure(this.reason() || "session-aborted", {
        id: key,
      });
    }
    if (this._recoveryUnknown.size > 0) {
      return this._admissionFailure("recovery-required", { id: key });
    }
    if (this.maxDepth !== null && normalizedDepth > this.maxDepth) {
      return this._admissionFailure("max-depth", {
        id: key,
        depth: normalizedDepth,
      });
    }
    if (
      this.maxConcurrent !== null &&
      this._activeWork.size >= this.maxConcurrent
    ) {
      return this._admissionFailure("max-concurrent", { id: key });
    }
    if (this.maxSpawns !== null && this.spawns >= this.maxSpawns) {
      return this._admissionFailure("max-spawns", { id: key });
    }

    const entry = {
      id: key,
      kind: normalizedKind,
      depth: normalizedDepth,
      startedAt: this._now(),
    };
    this._activeWork.set(key, entry);
    this.spawns += 1;
    this._emit("budget:work-acquired", {
      id: key,
      kind: normalizedKind,
      depth: normalizedDepth,
      active: this._activeWork.size,
      spawns: this.spawns,
    });
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      return this.releaseWork(key);
    };
    return {
      ok: true,
      id: key,
      kind: normalizedKind,
      depth: normalizedDepth,
      release,
    };
  }

  releaseWork(id) {
    const key = String(id || "");
    const entry = this._activeWork.get(key);
    if (!entry) return false;
    this._activeWork.delete(key);
    this._emit("budget:work-released", {
      id: key,
      kind: entry.kind,
      active: this._activeWork.size,
    });
    return true;
  }

  beginTool({ id, kind = "tool" } = {}) {
    const key = String(id || "");
    if (!key) throw new TypeError("session budget tool id is required");
    if (key.length > 512)
      throw new TypeError("session budget tool id is too long");
    const normalizedKind = String(kind || "tool");
    if (!normalizedKind || normalizedKind.length > 128) {
      throw new TypeError("invalid session budget tool kind");
    }
    this.start();
    if (this._activeTools.has(key)) {
      return this._admissionFailure("duplicate-tool-id", { id: key });
    }
    if (this._activeWork.has(key)) {
      return this._admissionFailure("duplicate-resource-id", { id: key });
    }
    if (this.signal.aborted) {
      return this._admissionFailure(this.reason() || "session-aborted", {
        id: key,
      });
    }
    if (this._recoveryUnknown.size > 0) {
      return this._admissionFailure("recovery-required", { id: key });
    }
    const now = this._now();
    if (this.maxToolMs !== null && this._toolMsAt(now) >= this.maxToolMs) {
      this._abortFor("max-tool-ms");
      return this._admissionFailure("max-tool-ms", { id: key });
    }
    this._activeTools.set(key, {
      id: key,
      kind: normalizedKind,
      depth: null,
      startedAt: now,
    });
    this._emit("budget:tool-started", {
      id: key,
      kind: normalizedKind,
      active: this._activeTools.size,
    });
    this._armDeadline(now);
    let ended = false;
    const end = () => {
      if (ended) return false;
      ended = true;
      return this.endTool(key);
    };
    return { ok: true, id: key, kind: normalizedKind, end };
  }

  endTool(id, now = this._now()) {
    const key = String(id || "");
    const entry = this._activeTools.get(key);
    if (!entry) return false;
    this._activeTools.delete(key);
    this._toolMs += Math.max(0, now - entry.startedAt);
    this._emit("budget:tool-ended", {
      id: key,
      kind: entry.kind,
      toolMs: this._toolMs,
      active: this._activeTools.size,
    });
    const reason = this._continuousReason(now);
    if (reason) this._abortFor(reason);
    else this._armDeadline(now);
    return true;
  }

  recordUsage({ usage = null, usageRecords = null, provider, model } = {}) {
    this.start();
    let tokenCount;
    let pricedRecords;
    try {
      if (usageRecords != null && !Array.isArray(usageRecords)) {
        throw new TypeError("invalid session budget usage records");
      }
      if (Array.isArray(usageRecords) && usageRecords.length > 0) {
        const detailedFields = Object.fromEntries(
          USAGE_TOKEN_FIELDS.map((field) => [field, 0]),
        );
        let detailedTokenCount = 0;
        pricedRecords = usageRecords.map((record, index) => {
          if (!isRecord(record) || !isRecord(record.usage)) {
            throw new TypeError(
              `invalid session budget usage record at index ${index}`,
            );
          }
          const normalized = normalizeUsageTokens(record.usage);
          for (const field of USAGE_TOKEN_FIELDS) {
            detailedFields[field] += normalized.fields[field];
            if (!Number.isSafeInteger(detailedFields[field])) {
              throw new TypeError(
                `session budget usage record aggregate exceeds safe integer: ${field}`,
              );
            }
          }
          detailedTokenCount += normalized.total;
          if (!Number.isSafeInteger(detailedTokenCount)) {
            throw new TypeError(
              "session budget token total exceeds safe integer",
            );
          }
          return { record, tokens: normalized.total };
        });
        if (usage != null) {
          const aggregate = normalizeUsageTokens(usage);
          for (const field of USAGE_TOKEN_FIELDS) {
            if (aggregate.fields[field] !== detailedFields[field]) {
              throw new TypeError(
                `session budget usage records do not match aggregate usage: ${field}`,
              );
            }
          }
          tokenCount = aggregate.total;
        } else {
          tokenCount = detailedTokenCount;
        }
      } else {
        tokenCount = normalizeUsageTokens(usage).total;
        pricedRecords =
          usage == null
            ? []
            : [{ record: { provider, model, usage }, tokens: tokenCount }];
      }
      if (!Number.isSafeInteger(tokenCount)) {
        throw new TypeError("session budget token total exceeds safe integer");
      }
    } catch (error) {
      this.abort(error, { reason: "invalid-usage" });
      throw error;
    }
    const nextTokens = this.tokens + tokenCount;
    if (!Number.isSafeInteger(nextTokens)) {
      const error = new TypeError(
        "session budget token total exceeds safe integer",
      );
      this.abort(error, { reason: "invalid-usage" });
      throw error;
    }
    this.tokens = nextTokens;

    try {
      for (const { record, tokens: recordTokens } of pricedRecords) {
        const estimate = this.cost.add(record);
        const price = Number(estimate?.totalCost);
        if (
          this.cost.enabled() &&
          recordTokens > 0 &&
          estimate?.free !== true &&
          (estimate?.matched !== true || !Number.isFinite(price) || price < 0)
        ) {
          this.unpricedUsage = true;
        }
      }
    } catch (error) {
      this.abort(error, { reason: "invalid-usage" });
      throw error;
    }
    this._emit("budget:usage-recorded", {
      tokens: this.tokens,
      spentUsd: this.cost.spentUsd,
    });
    const reason = this._continuousReason();
    if (reason) this._abortFor(reason);
    return this.status();
  }

  registerAbortable(id, stop) {
    const key = String(id || "");
    if (!key) throw new TypeError("session budget abortable id is required");
    if (this._abortables.has(key)) {
      throw new Error(`session budget abortable already registered: ${key}`);
    }
    let callback;
    if (typeof stop === "function") callback = stop;
    else if (stop && typeof stop.abort === "function") {
      callback = (reason) => stop.abort(reason);
    } else if (stop && typeof stop.kill === "function") {
      callback = () => stop.kill("SIGTERM");
    } else {
      throw new TypeError("session budget abortable must be callable");
    }

    if (this.signal.aborted) {
      try {
        callback(this.signal.reason);
      } catch {
        // The budget remains aborted even when a descendant cleanup fails.
      }
      return () => false;
    }
    this._abortables.set(key, callback);
    this._emit("budget:abortable-registered", {
      id: key,
      resources: this._abortables.size,
    });
    let registered = true;
    return () => {
      if (!registered) return false;
      registered = false;
      const deleted = this._abortables.delete(key);
      if (deleted) {
        this._emit("budget:abortable-unregistered", {
          id: key,
          resources: this._abortables.size,
        });
      }
      return deleted;
    };
  }

  _abortFor(reason) {
    return this.abort(new SessionBudgetError(reason), { reason });
  }

  abort(reason = "session-aborted", { reason: reasonCode = null } = {}) {
    if (this._abortState) return false;
    const error = safeReason(reason);
    const code = String(
      reasonCode || error.budgetReason || error.code || "session-aborted",
    ).slice(0, 128);
    this._abortState = {
      reason: code,
      message: String(error.message || code).slice(0, 512),
      at: this._now(),
    };
    this._clearDeadline();
    try {
      this._abortController.abort(error);
    } catch {
      this._abortController.abort();
    }
    const callbacks = [...this._abortables.entries()];
    this._abortables.clear();
    const cleanupErrors = [];
    for (const [id, callback] of callbacks) {
      try {
        callback(error);
      } catch (cleanupError) {
        cleanupErrors.push({
          id,
          message: String(cleanupError?.message || cleanupError).slice(0, 256),
        });
      }
    }
    this._emit("budget:aborted", {
      reason: code,
      cleanupErrors,
      activeWork: this._activeWork.size,
      activeTools: this._activeTools.size,
    });
    return true;
  }

  _clearDeadline() {
    if (this._deadlineTimer === null) return;
    this._clearTimer(this._deadlineTimer);
    this._deadlineTimer = null;
  }

  _armDeadline(now = this._now()) {
    this._clearDeadline();
    if (this.signal.aborted || this._recoveryUnknown.size > 0) return;
    const immediate = this._continuousReason(now);
    if (immediate) {
      this._abortFor(immediate);
      return;
    }
    let delay = Infinity;
    if (this.maxWallMs !== null && this._startedAt !== null) {
      delay = Math.min(delay, this.maxWallMs - this._elapsedAt(now));
    }
    if (this.maxToolMs !== null && this._activeTools.size > 0) {
      const remaining = this.maxToolMs - this._toolMsAt(now);
      delay = Math.min(delay, remaining / this._activeTools.size);
    }
    if (!Number.isFinite(delay)) return;
    const wait = Math.max(1, Math.min(MAX_TIMER_DELAY, Math.ceil(delay)));
    this._deadlineTimer = this._setTimer(() => {
      this._deadlineTimer = null;
      const reason = this._continuousReason(this._now());
      if (reason) this._abortFor(reason);
      else this._armDeadline(this._now());
    }, wait);
    this._deadlineTimer?.unref?.();
  }

  pendingRecovery() {
    return [...this._recoveryUnknown.values()].map((entry) => ({ ...entry }));
  }

  adjudicateRecovery({ abandoned = [] } = {}) {
    if (!Array.isArray(abandoned)) {
      throw new TypeError(
        "session budget abandoned recovery ids must be an array",
      );
    }
    const supplied = new Set(abandoned.map((id) => String(id)));
    const expected = new Set(this._recoveryUnknown.keys());
    if (
      supplied.size !== expected.size ||
      [...expected].some((id) => !supplied.has(id))
    ) {
      return {
        ok: false,
        reason: "recovery-adjudication-incomplete",
        pending: this.pendingRecovery(),
      };
    }
    this._recoveryUnknown.clear();
    this._emit("budget:recovery-adjudicated", {
      abandoned: [...supplied].sort(),
    });
    this._armDeadline();
    return { ok: true, abandoned: [...supplied].sort() };
  }

  status(now = this._now()) {
    return {
      spawns: this.spawns,
      maxSpawns: this.maxSpawns,
      active: this._activeWork.size,
      maxConcurrent: this.maxConcurrent,
      maxDepth: this.maxDepth,
      turns: this.turns,
      maxTurns: this.maxTurns,
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      spentUsd: this.cost.spentUsd,
      maxUsd: this.cost.limitUsd,
      elapsedMs: this._elapsedAt(now),
      maxWallMs: this.maxWallMs,
      toolMs: this._toolMsAt(now),
      maxToolMs: this.maxToolMs,
      activeTools: this._activeTools.size,
      resources: this._abortables.size,
      recoveryRequired: this._recoveryUnknown.size > 0,
      pendingRecovery: this._recoveryUnknown.size,
      unpricedUsage: this.unpricedUsage,
      aborted: this.signal.aborted,
      reason: this.reason(now),
    };
  }

  snapshot(now = this._now()) {
    const activeWork = [...this._activeWork.values()].map((entry) =>
      snapshotResource(entry, now),
    );
    const activeTools = [...this._activeTools.values()].map((entry) =>
      snapshotResource(entry, now),
    );
    return {
      version: SESSION_RESOURCE_BUDGET_VERSION,
      limits: {
        maxConcurrent: this.maxConcurrent,
        maxSpawns: this.maxSpawns,
        maxDepth: this.maxDepth,
        maxTurns: this.maxTurns,
        maxTokens: this.maxTokens,
        maxUsd: this.cost.limitUsd,
        maxWallMs: this.maxWallMs,
        maxToolMs: this.maxToolMs,
      },
      totals: {
        spawns: this.spawns,
        turns: this.turns,
        tokens: this.tokens,
        spentUsd: this.cost.spentUsd,
        elapsedMs: this._elapsedAt(now),
        toolMs: this._toolMsAt(now),
        unpricedUsage: this.unpricedUsage,
      },
      inFlight: {
        work: activeWork,
        tools: activeTools,
      },
      state: {
        started: this._startedAt !== null,
        abort: this._abortState ? { ...this._abortState } : null,
      },
    };
  }

  static restore(
    snapshot,
    {
      overrides = {},
      table = undefined,
      now = () => Date.now(),
      setTimer = (fn, delay) => setTimeout(fn, delay),
      clearTimer = (timer) => clearTimeout(timer),
      signal = null,
      onEvent = null,
      recoverUnsettled = "require-adjudication",
    } = {},
  ) {
    const normalized = validateSnapshot(snapshot);
    if (
      recoverUnsettled !== "require-adjudication" &&
      recoverUnsettled !== "abandon"
    ) {
      throw new TypeError("invalid session budget recovery policy");
    }
    const limits = {};
    for (const field of LIMIT_FIELDS) {
      limits[field] = tightenLimit(
        field,
        normalized.limits[field],
        overrides[field],
      );
    }
    const budget = new SessionResourceBudget({
      ...limits,
      table,
      now,
      setTimer,
      clearTimer,
      signal,
      onEvent,
    });
    budget.spawns = normalized.totals.spawns;
    budget.turns = normalized.totals.turns;
    budget.tokens = normalized.totals.tokens;
    budget.cost.spentUsd = normalized.totals.spentUsd;
    if (budget.cost.spentUsd > 0) budget.cost.priced = true;
    budget.unpricedUsage = normalized.totals.unpricedUsage;
    budget._elapsedMs = normalized.totals.elapsedMs;
    budget._toolMs = normalized.totals.toolMs;
    const restoredAt = budget._now();
    budget._startedAt = normalized.state.started ? restoredAt : null;

    if (recoverUnsettled === "require-adjudication") {
      for (const entry of [
        ...normalized.inFlight.work,
        ...normalized.inFlight.tools,
      ]) {
        budget._recoveryUnknown.set(entry.id, { ...entry });
      }
    }

    if (normalized.state.abort) {
      const error = new SessionBudgetError(
        normalized.state.abort.reason,
        normalized.state.abort.message,
      );
      budget.abort(error, { reason: normalized.state.abort.reason });
    } else if (budget._recoveryUnknown.size === 0) {
      const reason = budget._continuousReason(restoredAt);
      if (reason) budget._abortFor(reason);
      else budget._armDeadline(restoredAt);
    }
    budget._emit("budget:restored", {
      recoveryRequired: budget._recoveryUnknown.size > 0,
    });
    return budget;
  }

  dispose() {
    this._clearDeadline();
    if (this._externalSignal && this._externalAbortListener) {
      this._externalSignal.removeEventListener?.(
        "abort",
        this._externalAbortListener,
      );
    }
    this._externalAbortListener = null;
  }
}

export function isContinuousSessionBudgetReason(reason) {
  return CONTINUOUS_REASONS.has(reason);
}
