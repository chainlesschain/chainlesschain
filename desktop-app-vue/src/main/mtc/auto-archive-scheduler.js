/**
 * auto-archive-scheduler — periodic ChannelEnvelopeArchiver.push runner.
 *
 * Lets users configure "every N hours, archive these communities to this
 * provider" without keeping the renderer alive or running a manual
 * push from the Archive Tab. Uses the same archiveProviderFactory chain
 * as manual archive, so by-ref WebDAV credentials (B4-cred-persist v1)
 * just work.
 *
 * Config shape (persisted under app-config.json `mtc.autoArchive`):
 *   {
 *     enabled: boolean,         // gate
 *     intervalMs: number,       // wall-clock interval; min 5 minutes
 *     providerSpec: object,     // {kind, ...} — passed to factory
 *     communityIds: string[],   // empty array = archive all joined
 *     lastRunAt: number|null,   // epoch ms
 *     lastRunStatus: 'ok'|'partial'|'failed'|null,
 *     lastRunError: string|null,
 *     lastRunSummary: { perCommunity: {...}, totalBytes, totalArchives },
 *   }
 *
 * Module is intentionally pure-Node (no Electron API) so it's
 * unit-testable; the bootstrap layer wires it to AppConfigManager.
 *
 * @module mtc/auto-archive-scheduler
 */

const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

class AutoArchiveScheduler {
  /**
   * @param {object} deps
   * @param {object} deps.archiver - ChannelEnvelopeArchiver instance
   * @param {Function} deps.archiveProviderFactory - (spec) → provider
   * @param {object} deps.communityManager - getCommunities() → list with
   *   id field; used when communityIds is empty (archive all joined)
   * @param {object} deps.appConfig - AppConfigManager-shape with .config,
   *   .saveAsync(); we read/write `mtc.autoArchive` namespace
   * @param {object} [deps.logger] - optional; defaults to console
   * @param {object} [deps.timers] - { setInterval, clearInterval } for
   *   tests; defaults to globalThis
   */
  constructor(deps) {
    if (!deps || !deps.archiver) {
      throw new Error("AutoArchiveScheduler: archiver required");
    }
    if (!deps.archiveProviderFactory) {
      throw new Error("AutoArchiveScheduler: archiveProviderFactory required");
    }
    if (!deps.appConfig) {
      throw new Error("AutoArchiveScheduler: appConfig required");
    }
    this.archiver = deps.archiver;
    this.archiveProviderFactory = deps.archiveProviderFactory;
    this.communityManager = deps.communityManager || null;
    this.appConfig = deps.appConfig;
    this.logger = deps.logger || console;
    this.timers = deps.timers || {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    };
    this._timer = null;
    this._running = false;
  }

  /**
   * Read current config; merges defaults so callers always see a full
   * shape even on a fresh install.
   */
  getConfig() {
    const raw =
      (this.appConfig.config &&
        this.appConfig.config.mtc &&
        this.appConfig.config.mtc.autoArchive) ||
      {};
    return {
      enabled: !!raw.enabled,
      intervalMs:
        Number.isFinite(raw.intervalMs) && raw.intervalMs >= MIN_INTERVAL_MS
          ? raw.intervalMs
          : DEFAULT_INTERVAL_MS,
      providerSpec: raw.providerSpec || null,
      communityIds: Array.isArray(raw.communityIds) ? raw.communityIds : [],
      lastRunAt: raw.lastRunAt ?? null,
      lastRunStatus: raw.lastRunStatus ?? null,
      lastRunError: raw.lastRunError ?? null,
      lastRunSummary: raw.lastRunSummary ?? null,
    };
  }

  /**
   * Persist a partial patch into the config namespace. Validates the
   * critical invariants (interval ≥ MIN, providerSpec required when
   * enabled). Returns the merged config or throws on invalid input.
   */
  async setConfig(patch = {}) {
    const next = { ...this.getConfig(), ...patch };
    if (next.enabled) {
      if (!next.providerSpec || typeof next.providerSpec !== "object") {
        throw new Error("auto-archive: providerSpec required when enabled");
      }
      if (
        !Number.isFinite(next.intervalMs) ||
        next.intervalMs < MIN_INTERVAL_MS
      ) {
        throw new Error(
          `auto-archive: intervalMs must be ≥ ${MIN_INTERVAL_MS} ms`,
        );
      }
    }
    if (!Array.isArray(next.communityIds)) {
      throw new Error("auto-archive: communityIds must be array");
    }
    if (!this.appConfig.config.mtc) {
      this.appConfig.config.mtc = {};
    }
    this.appConfig.config.mtc.autoArchive = next;
    if (typeof this.appConfig.saveAsync === "function") {
      await this.appConfig.saveAsync();
    }
    // Restart loop to pick up new interval/spec.
    if (this._timer) {
      this.stop();
      if (next.enabled) {
        this.start();
      }
    } else if (next.enabled) {
      this.start();
    }
    return next;
  }

  /**
   * Begin the periodic loop. Idempotent — calling start() twice in a
   * row leaves a single timer.
   */
  start() {
    if (this._timer) {
      return;
    }
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      this.logger.info("[AutoArchive] disabled — not starting");
      return;
    }
    this.logger.info(
      `[AutoArchive] starting; interval=${cfg.intervalMs}ms providerKind=${cfg.providerSpec && cfg.providerSpec.kind}`,
    );
    this._timer = this.timers.setInterval(() => {
      // Fire-and-log; callers can also runOnce() manually.
      this.runOnce().catch((err) => {
        this.logger.error("[AutoArchive] runOnce error:", err && err.message);
      });
    }, cfg.intervalMs);
  }

  stop() {
    if (this._timer) {
      this.timers.clearInterval(this._timer);
      this._timer = null;
      this.logger.info("[AutoArchive] stopped");
    }
  }

  /**
   * Resolve the target community list. If config.communityIds is non-
   * empty, use it verbatim. Otherwise enumerate from communityManager.
   */
  async _resolveTargetCommunities() {
    const cfg = this.getConfig();
    if (cfg.communityIds.length > 0) {
      return cfg.communityIds;
    }
    if (!this.communityManager) {
      return [];
    }
    try {
      const all = await this.communityManager.getCommunities({});
      return Array.isArray(all) ? all.map((c) => c.id).filter(Boolean) : [];
    } catch (err) {
      this.logger.warn(
        "[AutoArchive] communityManager.getCommunities failed:",
        err.message,
      );
      return [];
    }
  }

  /**
   * Perform one full archival sweep across all target communities.
   * Per-community failures are logged and recorded, but do not abort
   * the rest of the sweep — partial success is captured in
   * lastRunStatus='partial' with details in lastRunSummary.
   */
  async runOnce() {
    if (this._running) {
      this.logger.warn(
        "[AutoArchive] runOnce called while already running — skip",
      );
      return { skipped: true };
    }
    this._running = true;
    const startedAt = Date.now();
    const cfg = this.getConfig();
    const summary = {
      startedAt,
      perCommunity: {},
      totalArchives: 0,
      totalBytes: 0,
    };
    let status = "ok";
    let topError = null;

    try {
      if (!cfg.providerSpec) {
        throw new Error("providerSpec missing — configure before runOnce");
      }
      const provider = this.archiveProviderFactory(cfg.providerSpec);
      const targets = await this._resolveTargetCommunities();
      if (targets.length === 0) {
        this.logger.info(
          "[AutoArchive] runOnce: no target communities — nothing to do",
        );
        summary.note = "no-target-communities";
      }
      for (const communityId of targets) {
        try {
          const result = await this.archiver.push(provider, communityId, {});
          summary.perCommunity[communityId] = {
            ok: true,
            name: result?.name,
            bytes: result?.bytes,
          };
          summary.totalArchives += 1;
          summary.totalBytes += result?.bytes || 0;
        } catch (err) {
          status = "partial";
          summary.perCommunity[communityId] = {
            ok: false,
            error: err.message,
          };
          this.logger.warn(
            `[AutoArchive] community=${communityId} failed:`,
            err.message,
          );
        }
      }
    } catch (err) {
      status = "failed";
      topError = err.message;
      this.logger.error("[AutoArchive] runOnce fatal:", err.message);
    } finally {
      this._running = false;
    }

    const finishedAt = Date.now();
    summary.finishedAt = finishedAt;
    summary.durationMs = finishedAt - startedAt;

    // Persist run record into config — visible from Settings UI.
    try {
      await this.setConfig({
        lastRunAt: finishedAt,
        lastRunStatus: status,
        lastRunError: topError,
        lastRunSummary: summary,
      });
    } catch (err) {
      this.logger.warn(
        "[AutoArchive] failed to persist run record:",
        err.message,
      );
    }
    return { status, error: topError, summary };
  }
}

module.exports = {
  AutoArchiveScheduler,
  MIN_INTERVAL_MS,
  DEFAULT_INTERVAL_MS,
};
