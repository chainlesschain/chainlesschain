/**
 * Phase 8.5 — Async resolve_queue worker.
 *
 * Long-running idle loop that polls the resolve_queue, calls
 * `EntityResolver.drain(batch)`, sleeps when empty, exits cleanly on
 * stop(). Designed to run alongside the hub process (desktop main /
 * cc serve / Workflow runner).
 *
 * Lifecycle:
 *   const w = new EntityResolverWorker({ resolver, intervalMs: 30_000 });
 *   w.start();   // returns immediately; loop runs async
 *   ...
 *   await w.stop(); // waits for current batch to finish, then exits
 *
 * The worker is dumb to where it runs — caller decides cadence (idle
 * scheduler in Electron main, cron in cc serve, etc.).
 */

"use strict";

class EntityResolverWorker {
  constructor(opts = {}) {
    if (!opts || typeof opts !== "object") {
      throw new Error("EntityResolverWorker: opts required");
    }
    if (!opts.resolver) {
      throw new Error("EntityResolverWorker: opts.resolver required");
    }
    this._resolver = opts.resolver;
    this._batchSize = Number.isFinite(opts.batchSize) ? opts.batchSize : 20;
    // Sleep when the queue is empty (poll cadence). 30s default is
    // enough to keep latency low on user-initiated sync while not
    // pegging CPU in steady state.
    this._idleIntervalMs = Number.isFinite(opts.idleIntervalMs) ? opts.idleIntervalMs : 30_000;
    // Between non-empty batches: small breather so cooperative scheduling
    // works with other adapter syncs.
    this._batchSpacingMs = Number.isFinite(opts.batchSpacingMs) ? opts.batchSpacingMs : 50;
    // Optional progress callback for UI + audit
    this._onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    this._logger = opts.logger || null;

    this._running = false;
    this._loopPromise = null;
    this._stopRequested = false;
    this._stats = {
      startedAt: 0,
      batchesProcessed: 0,
      itemsProcessed: 0,
      same: 0,
      different: 0,
      review: 0,
      error: 0,
      lastBatchAt: 0,
    };
  }

  isRunning() {
    return this._running;
  }

  stats() {
    return { ...this._stats };
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._stopRequested = false;
    this._stats.startedAt = Date.now();
    this._loopPromise = this._loop().finally(() => {
      this._running = false;
    });
  }

  async stop() {
    this._stopRequested = true;
    if (this._loopPromise) {
      try { await this._loopPromise; } catch (_e) {}
    }
    this._running = false;
  }

  /**
   * Run one batch synchronously (caller drives, no loop). Returns the
   * drain output. Useful for tests + on-demand "process N now" buttons.
   */
  async tick() {
    return await this._processBatch();
  }

  async _loop() {
    while (!this._stopRequested) {
      let batchResult;
      try {
        batchResult = await this._processBatch();
      } catch (err) {
        this._log("worker batch threw — sleeping then retrying", err && err.message);
        batchResult = null;
      }
      if (this._stopRequested) break;
      const empty = !batchResult || batchResult.processed === 0;
      const delay = empty ? this._idleIntervalMs : this._batchSpacingMs;
      await this._sleep(delay);
    }
  }

  async _processBatch() {
    const result = await this._resolver.drain({ limit: this._batchSize });
    this._stats.batchesProcessed += 1;
    this._stats.itemsProcessed += result.processed;
    this._stats.same += result.same;
    this._stats.different += result.different;
    this._stats.review += result.review;
    this._stats.error += result.error;
    this._stats.lastBatchAt = Date.now();
    this._emitProgress({ batch: result, totals: { ...this._stats } });
    return result;
  }

  _emitProgress(payload) {
    if (!this._onProgress) return;
    try {
      this._onProgress(payload);
    } catch (_e) {
      // listener errors don't break the loop
    }
  }

  async _sleep(ms) {
    if (ms <= 0) return;
    // Interruptable sleep — checks _stopRequested every 100ms so stop()
    // can land within a sane bound.
    const step = 100;
    let remaining = ms;
    while (remaining > 0 && !this._stopRequested) {
      const next = Math.min(step, remaining);
      await new Promise((resolve) => setTimeout(resolve, next));
      remaining -= next;
    }
  }

  _log(...args) {
    if (this._logger && typeof this._logger.info === "function") {
      this._logger.info("[EntityResolverWorker]", ...args);
    }
  }
}

module.exports = { EntityResolverWorker };
