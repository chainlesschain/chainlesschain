/**
 * Durable Event Runtime inbox/outbox.
 *
 * The in-memory EventEmitter is intentionally kept as the fast path. This
 * store is the crash-safe boundary for producers that need delivery across a
 * process restart: every record has a deterministic event id, a bounded
 * attempt count, and a renewable-style execution lease. State is rewritten
 * atomically under a directory lock so two daemon processes cannot claim the
 * same event.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { withFileLock } from "./with-file-lock.js";

const QUEUES = new Set(["inbox", "outbox"]);

function defaultDir() {
  return path.join(os.homedir(), ".chainlesschain", "event-runtime");
}

function eventId(event, explicitId = null) {
  if (explicitId != null && String(explicitId)) return String(explicitId);
  const supplied = event?.event_id || event?.eventId || event?.id;
  if (supplied != null && String(supplied)) return String(supplied);
  const digest = createHash("sha256")
    .update(JSON.stringify(event || {}))
    .digest("hex")
    .slice(0, 32);
  return `evt_${digest}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class EventRuntimeStore {
  constructor({
    dir = defaultDir(),
    now = () => Date.now(),
    owner = `${process.pid}:${randomUUID()}`,
    maxAttempts = 5,
    leaseMs = 120000,
    lockTimeoutMs = 2000,
    maxQueueLength = 10000,
  } = {}) {
    this.dir = dir;
    this._now = typeof now === "function" ? now : () => Number(now);
    this.owner = String(owner);
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 5);
    this.leaseMs = Math.max(1, Number(leaseMs) || 120000);
    this.lockTimeoutMs = Math.max(0, Number(lockTimeoutMs) || 2000);
    this.maxQueueLength = Math.max(1, Number(maxQueueLength) || 10000);
  }

  _assertQueue(queue) {
    if (!QUEUES.has(queue)) throw new Error(`Unknown event queue: ${queue}`);
  }

  _file(queue) {
    this._assertQueue(queue);
    return path.join(this.dir, `${queue}.json`);
  }

  _ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  _read(queue) {
    const file = this._file(queue);
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  _write(queue, records) {
    this._ensureDir();
    const file = this._file(queue);
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }

  _mutate(queue, fn) {
    this._ensureDir();
    return withFileLock(
      path.join(this.dir, ".event-runtime"),
      () => {
        const records = this._read(queue);
        const result = fn(records);
        this._write(queue, records);
        return result;
      },
      { timeoutMs: this.lockTimeoutMs, failIfUnavailable: true },
    );
  }

  enqueue(queue, event, { id = null, metadata = null } = {}) {
    const key = eventId(event, id);
    return this._mutate(queue, (records) => {
      const existing = records.find((record) => record.id === key);
      if (existing) return { ...clone(existing), duplicate: true };
      const active = records.reduce(
        (count, record) =>
          count +
          (record.status === "done" || record.status === "dead" ? 0 : 1),
        0,
      );
      if (active >= this.maxQueueLength) {
        const error = new Error(
          `Event Runtime ${queue} queue is full (${this.maxQueueLength})`,
        );
        error.code = "CC_EVENT_RUNTIME_BACKPRESSURE";
        throw error;
      }
      const record = {
        id: key,
        event: clone(event || {}),
        metadata: clone(metadata),
        status: "pending",
        attempts: 0,
        createdAt: this._now(),
        nextAttemptAt: this._now(),
        lease: null,
      };
      records.push(record);
      return clone(record);
    });
  }

  enqueueInbox(event, options) {
    return this.enqueue("inbox", event, options);
  }

  enqueueOutbox(event, options) {
    return this.enqueue("outbox", event, options);
  }

  /** Requeue abandoned claims and return claimable records for this owner. */
  claim(queue, { limit = 50, now = this._now(), leaseMs = this.leaseMs } = {}) {
    const t = Number(now);
    const ttl = Math.max(1, Number(leaseMs) || this.leaseMs);
    const max = Math.max(1, Number(limit) || 50);
    return this._mutate(queue, (records) => {
      const claimed = [];
      for (const record of records) {
        if (
          record.status === "processing" &&
          Number(record.lease?.expiresAt) <= t
        ) {
          record.status = "pending";
          record.lease = null;
        }
        if (claimed.length >= max || record.status !== "pending") continue;
        if (Number(record.nextAttemptAt || 0) > t) continue;
        record.status = "processing";
        record.attempts = Number(record.attempts || 0) + 1;
        record.lease = { owner: this.owner, claimedAt: t, expiresAt: t + ttl };
        claimed.push(clone(record));
      }
      return claimed;
    });
  }

  claimInbox(options) {
    return this.claim("inbox", options);
  }

  claimOutbox(options) {
    return this.claim("outbox", options);
  }

  acknowledge(queue, id, result = null, { owner = null } = {}) {
    return this._mutate(queue, (records) => {
      const record = records.find((item) => item.id === String(id));
      if (!record) return null;
      const expectedOwner = owner ? String(owner) : null;
      if (
        expectedOwner &&
        (record.status !== "processing" ||
          record.lease?.owner !== expectedOwner)
      ) {
        return null;
      }
      record.status = "done";
      record.result = clone(result);
      record.completedAt = this._now();
      record.lease = null;
      return clone(record);
    });
  }

  acknowledgeInbox(id, result, options) {
    return this.acknowledge("inbox", id, result, options);
  }

  acknowledgeOutbox(id, result, options) {
    return this.acknowledge("outbox", id, result, options);
  }

  fail(
    queue,
    id,
    error,
    { retryDelayMs = 1000, maxAttempts = this.maxAttempts, owner = null } = {},
  ) {
    return this._mutate(queue, (records) => {
      const record = records.find((item) => item.id === String(id));
      if (!record) return null;
      const expectedOwner = owner ? String(owner) : null;
      if (
        expectedOwner &&
        (record.status !== "processing" ||
          record.lease?.owner !== expectedOwner)
      ) {
        return null;
      }
      record.error = String(error || "event delivery failed").slice(0, 1000);
      record.lease = null;
      if (
        Number(record.attempts || 0) >=
        Math.max(1, Number(maxAttempts) || this.maxAttempts)
      ) {
        record.status = "dead";
        record.deadAt = this._now();
      } else {
        record.status = "pending";
        record.nextAttemptAt =
          this._now() + Math.max(0, Number(retryDelayMs) || 0);
      }
      return clone(record);
    });
  }

  list(queue, { status = null } = {}) {
    return this._read(queue)
      .filter((record) => !status || record.status === status)
      .map(clone);
  }

  listInbox(options) {
    return this.list("inbox", options);
  }

  listOutbox(options) {
    return this.list("outbox", options);
  }

  /**
   * Return a lock-consistent, cross-process health snapshot without claiming
   * work. Queue capacity is measured from active records because completed and
   * dead-letter records do not participate in producer backpressure.
   */
  getHealthSnapshot({ now = this._now(), highWatermarkRatio = 0.8 } = {}) {
    const t = Number(now);
    const highWatermark = Math.min(
      1,
      Math.max(0, Number(highWatermarkRatio) || 0.8),
    );
    this._ensureDir();
    return withFileLock(
      path.join(this.dir, ".event-runtime"),
      () => {
        const queues = {};
        for (const queue of QUEUES) {
          const records = this._read(queue);
          const summary = {
            total: records.length,
            active: 0,
            pending: 0,
            processing: 0,
            done: 0,
            dead: 0,
            unknown: 0,
            claimable: 0,
            delayed: 0,
            expiredLeases: 0,
            oldestActiveAgeMs: null,
            availableCapacity: this.maxQueueLength,
            utilization: 0,
            pressure: "normal",
          };
          let oldestActiveAt = null;
          for (const record of records) {
            const status = String(record.status || "unknown");
            if (["pending", "processing", "done", "dead"].includes(status)) {
              summary[status] += 1;
            } else summary.unknown += 1;
            const active = status !== "done" && status !== "dead";
            if (active) {
              summary.active += 1;
              const createdAt = Number(record.createdAt);
              if (
                Number.isFinite(createdAt) &&
                (oldestActiveAt == null || createdAt < oldestActiveAt)
              ) {
                oldestActiveAt = createdAt;
              }
            }
            if (status === "pending") {
              if (Number(record.nextAttemptAt || 0) <= t)
                summary.claimable += 1;
              else summary.delayed += 1;
            } else if (
              status === "processing" &&
              Number(record.lease?.expiresAt) <= t
            ) {
              summary.expiredLeases += 1;
            }
          }
          summary.availableCapacity = Math.max(
            0,
            this.maxQueueLength - summary.active,
          );
          summary.utilization = Number(
            (summary.active / this.maxQueueLength).toFixed(4),
          );
          summary.pressure =
            summary.active >= this.maxQueueLength
              ? "full"
              : summary.utilization >= highWatermark
                ? "high"
                : "normal";
          summary.oldestActiveAgeMs =
            oldestActiveAt == null ? null : Math.max(0, t - oldestActiveAt);
          queues[queue] = summary;
        }
        const pressure = Object.values(queues).some(
          (queue) => queue.pressure === "full",
        )
          ? "full"
          : Object.values(queues).some((queue) => queue.pressure === "high")
            ? "high"
            : "normal";
        return {
          schema: "chainlesschain.event-runtime-health.v1",
          observedAt: new Date(t).toISOString(),
          queueLimit: this.maxQueueLength,
          highWatermarkRatio: highWatermark,
          pressure,
          queues,
        };
      },
      { timeoutMs: this.lockTimeoutMs, failIfUnavailable: true },
    );
  }
}

export { eventId };
