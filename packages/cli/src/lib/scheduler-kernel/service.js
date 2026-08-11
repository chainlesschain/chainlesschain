import {
  SchedulerKernelError,
  normalizeIdentifier,
  normalizeJson,
} from "./contract.js";

export const DEFAULT_SERVICE_INTERVAL_MS = 5_000;
export const MIN_SERVICE_INTERVAL_MS = 250;
export const MAX_SERVICE_INTERVAL_MS = 3_600_000;
export const MAX_SERVICE_SUMMARIES = 100;

function serviceError(code, message, details = undefined, cause = undefined) {
  return new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
}

function normalizeIntervalMs(value = DEFAULT_SERVICE_INTERVAL_MS) {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_SERVICE_INTERVAL_MS ||
    value > MAX_SERVICE_INTERVAL_MS
  ) {
    throw serviceError(
      "SCHEDULER_SERVICE_INVALID_INTERVAL",
      `intervalMs must be an integer between ${MIN_SERVICE_INTERVAL_MS} and ${MAX_SERVICE_INTERVAL_MS}`,
    );
  }
  return value;
}

function normalizeMaxTicks(value) {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw serviceError(
      "SCHEDULER_SERVICE_INVALID_MAX_TICKS",
      "maxTicks must be a positive integer",
    );
  }
  return value;
}

function normalizeDrivers(drivers) {
  if (!drivers || typeof drivers[Symbol.iterator] !== "function") {
    throw serviceError(
      "SCHEDULER_SERVICE_INVALID_DRIVERS",
      "Scheduler service drivers must be iterable",
    );
  }
  const normalized = [];
  const names = new Set();
  for (const driver of drivers) {
    if (!driver || typeof driver !== "object" || Array.isArray(driver)) {
      throw serviceError(
        "SCHEDULER_SERVICE_INVALID_DRIVER",
        "Scheduler service driver must be an object",
      );
    }
    const name = normalizeIdentifier(driver.name, "driver.name", {
      maxLength: 64,
    });
    if (names.has(name)) {
      throw serviceError(
        "SCHEDULER_SERVICE_DUPLICATE_DRIVER",
        `Scheduler service driver is registered more than once: ${name}`,
      );
    }
    if (typeof driver.run !== "function") {
      throw serviceError(
        "SCHEDULER_SERVICE_INVALID_DRIVER",
        `Scheduler service driver must implement run(): ${name}`,
      );
    }
    names.add(name);
    normalized.push({ name, driver });
  }
  if (normalized.length === 0) {
    throw serviceError(
      "SCHEDULER_SERVICE_INVALID_DRIVERS",
      "Scheduler service requires at least one driver",
    );
  }
  return normalized;
}

function safeError(error) {
  let details;
  try {
    if (error?.details !== undefined) {
      details = normalizeJson(error.details, "schedulerService.error.details");
    }
  } catch {
    details = { omitted: "invalid_error_details" };
  }
  return {
    code:
      typeof error?.code === "string" && error.code
        ? error.code.slice(0, 128)
        : "SCHEDULER_SERVICE_DRIVER_FAILED",
    message:
      typeof error?.message === "string" && error.message
        ? error.message.slice(0, 2_000)
        : String(error ?? "Scheduler driver failed").slice(0, 2_000),
    ...(details === undefined ? {} : { details }),
  };
}

function defaultSleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener?.("abort", done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

/**
 * Foreground host for independently durable scheduler domains.
 *
 * A service tick is serialized so a slow driver cannot overlap itself on the
 * next timer wakeup. Driver failures are isolated and emitted as visible
 * incidents; the remaining domains still run. Each domain remains responsible
 * for its own scheduler-kernel owner/fence, authority and settlement protocol.
 */
export class SchedulerService {
  constructor({
    drivers,
    onEvent,
    now = Date.now,
    sleep = defaultSleep,
    dispose,
  } = {}) {
    this.drivers = normalizeDrivers(drivers);
    if (onEvent !== undefined && typeof onEvent !== "function") {
      throw serviceError(
        "SCHEDULER_SERVICE_INVALID_OBSERVER",
        "Scheduler service onEvent must be a function",
      );
    }
    if (typeof now !== "function" || typeof sleep !== "function") {
      throw serviceError(
        "SCHEDULER_SERVICE_INVALID_RUNTIME",
        "Scheduler service requires clock and sleep functions",
      );
    }
    if (dispose !== undefined && typeof dispose !== "function") {
      throw serviceError(
        "SCHEDULER_SERVICE_INVALID_DISPOSER",
        "Scheduler service dispose must be a function",
      );
    }
    this.onEvent = onEvent || null;
    this.now = now;
    this.sleep = sleep;
    this.dispose = dispose || null;
    this.tickNumber = 0;
    this._tickPromise = null;
    this._closed = false;
  }

  _emit(event) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch {
      // Observability must never acquire scheduler execution authority.
    }
  }

  async _runOnce({ signal } = {}) {
    if (this._closed) {
      throw serviceError(
        "SCHEDULER_SERVICE_CLOSED",
        "Scheduler service is already closed",
      );
    }
    if (signal?.aborted) {
      return { status: "aborted", tick: this.tickNumber, results: [] };
    }

    const tick = ++this.tickNumber;
    const startedAt = Number(this.now());
    const results = [];
    this._emit({ type: "scheduler-tick-started", tick, startedAt });
    for (const { name, driver } of this.drivers) {
      if (signal?.aborted) break;
      const driverStartedAt = Number(this.now());
      try {
        const value = await driver.run({ signal, tick });
        const completedAt = Number(this.now());
        const result = {
          driver: name,
          status: "succeeded",
          startedAt: driverStartedAt,
          completedAt,
          value: value ?? null,
        };
        results.push(result);
        this._emit({ type: "scheduler-driver-completed", tick, ...result });
      } catch (error) {
        const completedAt = Number(this.now());
        const result = {
          driver: name,
          status: "failed",
          startedAt: driverStartedAt,
          completedAt,
          error: safeError(error),
        };
        results.push(result);
        this._emit({ type: "scheduler-driver-failed", tick, ...result });
      }
    }
    const completedAt = Number(this.now());
    const failed = results.filter((result) => result.status === "failed");
    const summary = {
      status: signal?.aborted
        ? "aborted"
        : failed.length > 0
          ? "degraded"
          : "succeeded",
      tick,
      startedAt,
      completedAt,
      results,
    };
    this._emit({ type: "scheduler-tick-completed", ...summary });
    return summary;
  }

  runOnce(options = {}) {
    if (this._tickPromise) return this._tickPromise;
    this._tickPromise = this._runOnce(options).finally(() => {
      this._tickPromise = null;
    });
    return this._tickPromise;
  }

  async run({ intervalMs, once = false, maxTicks, signal } = {}) {
    const interval = normalizeIntervalMs(intervalMs);
    const boundedTicks = once ? 1 : normalizeMaxTicks(maxTicks);
    const summaries = [];
    let ticks = 0;
    let omittedSummaries = 0;
    let degraded = false;
    this._emit({
      type: "scheduler-service-started",
      intervalMs: interval,
      drivers: this.drivers.map(({ name }) => name),
    });
    try {
      while (!signal?.aborted) {
        const summary = await this.runOnce({ signal });
        ticks += 1;
        summaries.push(summary);
        if (summaries.length > MAX_SERVICE_SUMMARIES) {
          summaries.shift();
          omittedSummaries += 1;
        }
        if (summary.status === "degraded") degraded = true;
        if (
          once ||
          signal?.aborted ||
          (boundedTicks !== null && ticks >= boundedTicks)
        ) {
          break;
        }
        await this.sleep(interval, signal);
      }
      return {
        status: signal?.aborted
          ? "aborted"
          : degraded
            ? "degraded"
            : "succeeded",
        ticks,
        omittedSummaries,
        summaries,
      };
    } finally {
      this._emit({
        type: "scheduler-service-stopped",
        ticks,
        aborted: signal?.aborted === true,
      });
    }
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    let closeError = null;
    try {
      // A caller may initiate shutdown while a manual tick is still settling.
      // Do not dispose the shared store underneath an active domain driver.
      try {
        await this._tickPromise;
      } catch (error) {
        closeError ||= error;
      }
      for (const { driver } of [...this.drivers].reverse()) {
        try {
          await driver.close?.();
        } catch (error) {
          closeError ||= error;
        }
      }
    } finally {
      try {
        await this.dispose?.();
      } catch (error) {
        closeError ||= error;
      }
    }
    if (closeError) throw closeError;
  }
}

export function createSchedulerService(options) {
  return new SchedulerService(options);
}
