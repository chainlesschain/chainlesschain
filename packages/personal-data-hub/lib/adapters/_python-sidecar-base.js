/**
 * PythonSidecarAdapter — shared infrastructure for adapters whose extraction
 * + parsing happens in the forensics-bridge Python sidecar.
 *
 * Design rationale (see Personal_Data_Hub_Python_Sidecar.md §6.2):
 *
 *  - Subclasses define WHICH sidecar methods to invoke and HOW to orchestrate
 *    them (per-data-source pull + parse). The shared base only handles
 *    raw-event yielding + raw archival shape + supervisor wiring.
 *  - `sync(opts)` is an async generator that yields {entityType, originalId,
 *    capturedAt, payload} envelopes. `payload` is the already-normalized
 *    UnifiedSchema entity emitted by the sidecar — `normalize()` then routes
 *    it into the right NormalizedBatch bucket (events / persons / places / etc).
 *  - `sync(opts)` derives a per-run AbortSignal. External aborts and consumer
 *    `return()` both stop queue growth immediately; subclasses should pass
 *    `opts.signal` to SidecarSupervisor.invoke for cooperative sidecar cancel.
 *    Partial progress already yielded to the registry remains preserved.
 *
 * Subclass contract:
 *
 *    class MyAdapter extends PythonSidecarAdapter {
 *      name = "my-adapter";
 *      version = "0.1.0";
 *      capabilities = ["sync:sidecar"];
 *      dataDisclosure = { ... };
 *      async *_runSidecar(opts, emit) { ... use this._invoke(...) ... }
 *    }
 *
 * The base exposes _invoke() which wraps SidecarSupervisor.invoke with
 * onChunk routed into the adapter's yielded stream. Subclasses build up
 * one or more invoke() calls inside `_runSidecar`.
 */

"use strict";

function createAbortError(reason, message = "sidecar stream consumer closed") {
  const detail =
    reason instanceof Error
      ? reason.message
      : reason === undefined
        ? message
        : String(reason);
  const error = new Error(detail);
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  if (reason !== undefined) error.cause = reason;
  return error;
}

class PythonSidecarAdapter {
  /**
   * @param {object} opts
   * @param {import("../sidecar").SidecarSupervisor} opts.supervisor
   * @param {string} [opts.name]    Override the class-level name if needed.
   * @param {object} [opts.logger]  Optional logger; falls back to noop.
   */
  constructor(opts) {
    if (!opts || !opts.supervisor) {
      throw new Error("PythonSidecarAdapter: opts.supervisor required");
    }
    this.supervisor = opts.supervisor;
    if (opts.name) this.name = opts.name;
    this._logger = opts.logger || {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  // -------------------------------------------------------------------------
  // PersonalDataAdapter contract — required surface
  // -------------------------------------------------------------------------

  /**
   * Override in subclasses.
   * Default: no-op success (sidecar-backed adapters typically check device
   * availability via subclass-specific sidecar methods).
   */
  async authenticate(_ctx) {
    return { ok: true };
  }

  async healthCheck() {
    try {
      const pong = await this.supervisor.invoke(
        "sidecar.ping",
        {},
        { timeoutMs: 3000 },
      );
      return { ok: true, version: pong.version };
    } catch (err) {
      return {
        ok: false,
        reason: `sidecar.ping failed: ${err.code || err.message}`,
      };
    }
  }

  /**
   * AdapterRegistry calls `normalize(raw)` once per raw event. Since the
   * sidecar already returns UnifiedSchema entities, we just bucket the
   * `raw.payload` (an entity dict) into the right NormalizedBatch slot
   * based on its declared `entityType`.
   *
   * Yields a normalized batch with exactly one entity in one bucket.
   */
  normalize(raw) {
    const empty = {
      events: [],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
    if (!raw || typeof raw !== "object" || !raw.payload) return empty;
    const t = raw.entityType;
    const p = raw.payload;
    if (t === "person") return { ...empty, persons: [p] };
    if (t === "event") return { ...empty, events: [p] };
    if (t === "place") return { ...empty, places: [p] };
    if (t === "item") return { ...empty, items: [p] };
    if (t === "topic") return { ...empty, topics: [p] };
    // Defensive: unknown bucket → drop entity, registry counts as invalid.
    return empty;
  }

  /**
   * Subclasses MUST override `_runSidecar(opts, emit)`. `emit(raw)` is the
   * generator-yielder; the base wires it up. Subclass returns the final
   * orchestration result (used for adapter-progress audit, not for ingest).
   */
  async *sync(opts = {}) {
    // Buffer between subclass producer and async-generator consumer.
    // Using a small array + Promise resolution lets _runSidecar use callbacks
    // while still yielding to the consumer one raw at a time.
    const queue = [];
    let done = false;
    let runErr = null;
    let resumeWaiter = null;
    let consumerClosed = false;
    const runController = new AbortController();
    const externalSignal = opts.signal;

    const wakeConsumer = () => {
      if (!resumeWaiter) return;
      const resolve = resumeWaiter;
      resumeWaiter = null;
      resolve();
    };

    const onExternalAbort = () => {
      if (!runController.signal.aborted) {
        runController.abort(externalSignal.reason);
      }
      queue.length = 0;
      wakeConsumer();
    };
    if (externalSignal?.aborted) {
      onExternalAbort();
    } else {
      externalSignal?.addEventListener("abort", onExternalAbort, {
        once: true,
      });
    }

    const emit = (raw) => {
      if (consumerClosed || runController.signal.aborted) return false;
      queue.push(raw);
      wakeConsumer();
      return true;
    };

    const runPromise = (async () => {
      try {
        if (runController.signal.aborted) {
          throw createAbortError(runController.signal.reason);
        }
        await this._runSidecar({ ...opts, signal: runController.signal }, emit);
      } catch (err) {
        runErr = err;
      } finally {
        done = true;
        wakeConsumer();
      }
    })();

    try {
      while (true) {
        if (runController.signal.aborted) {
          throw createAbortError(runController.signal.reason);
        }
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        if (done) break;
        await new Promise((res) => {
          resumeWaiter = res;
        });
      }
      // Drain any items added after `done` flipped but before we noticed.
      while (queue.length > 0) yield queue.shift();
      if (runErr) throw runErr;
    } finally {
      consumerClosed = true;
      queue.length = 0;
      externalSignal?.removeEventListener("abort", onExternalAbort);
      if (!done && !runController.signal.aborted) {
        runController.abort(createAbortError());
      }
      wakeConsumer();
      // runPromise catches producer failures internally. Do not await it here:
      // a callback-based sidecar producer may still be unwinding (or may not
      // support cooperative cancellation), and iterator.return() must remain
      // prompt. `emit()` drops all late chunks once the consumer is closed.
      void runPromise;
    }
  }

  // -------------------------------------------------------------------------
  // Subclass surface
  // -------------------------------------------------------------------------

  /**
   * Override me. `emit(rawEvent)` queues a raw event for the consumer of
   * the async generator returned by `sync()`. Subclasses typically:
   *   1. Optionally call `this.supervisor.invoke("xxx.pull_file", ...)`.
   *   2. Call `this.supervisor.invoke("xxx.parse_yyy", ..., { onChunk })`.
   *   3. Inside onChunk, walk each entity → `emit({entityType, originalId,
   *      capturedAt, payload})`.
   *
   * @param {object} _opts  options from registry.syncAdapter
   * @param {(raw: object) => void} _emit  push a raw event to the stream
   * @returns {Promise<object>} subclass-defined run summary
   */
  async _runSidecar(_opts, _emit) {
    throw new Error(
      `PythonSidecarAdapter[${this.name}]: subclass must implement _runSidecar(opts, emit)`,
    );
  }

  /**
   * Helper: walk a NormalizedBatch chunk and emit one raw per entity. Used
   * by subclasses that want to forward all 5 buckets generically.
   */
  _emitChunkAsRaws(batch, emit) {
    if (!batch || typeof batch !== "object") return;
    const flush = (arr, entityType) => {
      if (!Array.isArray(arr)) return;
      for (const entity of arr) {
        if (!entity || typeof entity !== "object") continue;
        emit({
          entityType,
          originalId:
            (entity.source && entity.source.originalId) || entity.id || null,
          capturedAt: (entity.source && entity.source.capturedAt) || Date.now(),
          payload: entity,
        });
      }
    };
    flush(batch.persons, "person");
    flush(batch.events, "event");
    flush(batch.places, "place");
    flush(batch.items, "item");
    flush(batch.topics, "topic");
  }
}

module.exports = { PythonSidecarAdapter };
