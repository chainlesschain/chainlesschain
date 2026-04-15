/**
 * IdleParker — 定时扫描 idle session 并自动 park
 *
 * Phase B of Managed Agents parity plan.
 *
 * 行为:
 *   每 intervalMs 扫描一次 SessionManager.list({ status: "idle" })
 *   对于 idle 时长 ≥ idleThresholdMs 的会话调用 manager.park(sessionId)
 *
 * 设计要点:
 * - 完全被动,不改 SessionHandle/SessionManager 语义
 * - start/stop 幂等,多次 start 只有一个 timer
 * - 单轮 scan 异常被捕获并 emit,不会杀掉 timer
 * - 可注入 now 和 setInterval/clearInterval 便于测试
 */

const EventEmitter = require("events");

const DEFAULT_IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min
const DEFAULT_INTERVAL_MS = 60 * 1000; // 1 min

class IdleParker extends EventEmitter {
  constructor({
    manager,
    idleThresholdMs = DEFAULT_IDLE_THRESHOLD_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    now = Date.now,
    setInterval: _setInterval = setInterval,
    clearInterval: _clearInterval = clearInterval,
  } = {}) {
    super();
    if (!manager) {
      throw new Error("IdleParker: manager required");
    }
    this.manager = manager;
    this.idleThresholdMs = idleThresholdMs;
    this.intervalMs = intervalMs;
    this._now = now;
    this._setInterval = _setInterval;
    this._clearInterval = _clearInterval;
    this._timer = null;
    this._running = false;
    this._stats = { scans: 0, parked: 0, errors: 0 };
  }

  start() {
    if (this._timer) return false; // idempotent
    this._running = true;
    this._timer = this._setInterval(() => {
      this.scan().catch((err) => {
        this._stats.errors++;
        this.emit("error", err);
      });
    }, this.intervalMs);
    // unref so it does not keep the process alive
    if (this._timer && typeof this._timer.unref === "function") {
      this._timer.unref();
    }
    this.emit("started");
    return true;
  }

  stop() {
    if (!this._timer) return false;
    this._clearInterval(this._timer);
    this._timer = null;
    this._running = false;
    this.emit("stopped");
    return true;
  }

  isRunning() {
    return this._running;
  }

  /**
   * 手动触发一轮扫描(测试友好)
   */
  async scan() {
    this._stats.scans++;
    const nowTs = this._now();
    const candidates = this.manager.list({ status: "idle" });
    const parked = [];
    for (const h of candidates) {
      if (!h.shouldPark(this.idleThresholdMs, nowTs)) continue;
      try {
        const ok = await this.manager.park(h.sessionId);
        if (ok) {
          this._stats.parked++;
          parked.push(h.sessionId);
          this.emit("parked", h);
        }
      } catch (err) {
        this._stats.errors++;
        this.emit("park-error", { sessionId: h.sessionId, error: err });
      }
    }
    this.emit("scan-complete", { candidates: candidates.length, parked: parked.length });
    return parked;
  }

  stats() {
    return { ...this._stats, running: this._running };
  }

  resetStats() {
    this._stats = { scans: 0, parked: 0, errors: 0 };
  }
}

module.exports = {
  IdleParker,
  DEFAULT_IDLE_THRESHOLD_MS,
  DEFAULT_INTERVAL_MS,
};
