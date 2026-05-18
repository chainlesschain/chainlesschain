/**
 * BetaFlags — 实验性特性灰度开关
 *
 * Phase E2 of Managed Agents parity plan.
 *
 * 对标 Managed Agents 的 `anthropic-beta: managed-agents-2026-04-01` header:
 * 实验特性显式命名、显式启用,未启用时 requireFeature 抛 feature_not_enabled。
 *
 * Flag 命名约定: `<feature>-<YYYY-MM-DD>` (如 "idle-park-2026-05-01")
 *   - date suffix 让 flag 自带"何时引入"的信息,便于清理
 *   - 单个 feature 可并存多个版本(grace period)
 */

const EventEmitter = require("events");

const FLAG_PATTERN = /^[a-z][a-z0-9-]*-\d{4}-\d{2}-\d{2}$/;

class FeatureNotEnabledError extends Error {
  constructor(flag) {
    super(`feature_not_enabled: ${flag}`);
    this.name = "FeatureNotEnabledError";
    this.code = "feature_not_enabled";
    this.flag = flag;
  }
}

class BetaFlags extends EventEmitter {
  constructor({ initial = [], store = null, strict = true } = {}) {
    super();
    this._enabled = new Set();
    this._known = new Set();
    this._store = store; // { save(flags), load() } — optional
    this._strict = strict; // true = reject flags not matching FLAG_PATTERN
    for (const f of initial) this.enable(f);
  }

  static validFlag(flag) {
    return typeof flag === "string" && FLAG_PATTERN.test(flag);
  }

  register(flag, { description = "" } = {}) {
    if (this._strict && !BetaFlags.validFlag(flag)) {
      throw new Error(
        `BetaFlags.register: invalid flag "${flag}", expected <feature>-<YYYY-MM-DD>`
      );
    }
    this._known.add(flag);
    this.emit("registered", { flag, description });
  }

  enable(flag) {
    if (this._strict && !BetaFlags.validFlag(flag)) {
      throw new Error(
        `BetaFlags.enable: invalid flag "${flag}", expected <feature>-<YYYY-MM-DD>`
      );
    }
    const changed = !this._enabled.has(flag);
    this._enabled.add(flag);
    this._known.add(flag);
    if (changed) {
      this.emit("enabled", flag);
      this._persist();
    }
    return changed;
  }

  disable(flag) {
    const changed = this._enabled.delete(flag);
    if (changed) {
      this.emit("disabled", flag);
      this._persist();
    }
    return changed;
  }

  isEnabled(flag) {
    return this._enabled.has(flag);
  }

  requireFeature(flag) {
    if (!this._enabled.has(flag)) {
      throw new FeatureNotEnabledError(flag);
    }
    return true;
  }

  list() {
    return {
      enabled: Array.from(this._enabled).sort(),
      known: Array.from(this._known).sort(),
    };
  }

  async load() {
    if (!this._store?.load) return;
    const flags = await this._store.load();
    if (Array.isArray(flags)) {
      this._enabled = new Set(flags);
      for (const f of flags) this._known.add(f);
    }
  }

  _persist() {
    if (!this._store?.save) return;
    Promise.resolve()
      .then(() => this._store.save(Array.from(this._enabled)))
      .catch((err) => this.emit("store-error", { op: "save", error: err }));
  }
}

module.exports = {
  BetaFlags,
  FeatureNotEnabledError,
  FLAG_PATTERN,
};
