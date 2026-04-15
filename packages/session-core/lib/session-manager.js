/**
 * SessionManager — 集中管理 SessionHandle 生命周期
 *
 * Phase B of Managed Agents parity plan.
 *
 * 职责:
 * 1. create / get / close session
 * 2. 按 agentId 索引,支持"一个 agent 可挂数百会话"
 * 3. session-hour 汇总(按 session / agent / global)
 * 4. 可选 store 持久化 park 状态
 * 5. emit 生命周期事件供 IdleParker / TraceStore 订阅
 */

const EventEmitter = require("events");
const { SessionHandle, STATUS } = require("./session-handle.js");

const MS_PER_HOUR = 3_600_000;

class SessionManager extends EventEmitter {
  constructor({ store = null, now = Date.now } = {}) {
    super();
    this._sessions = new Map(); // sessionId → SessionHandle
    this._byAgent = new Map(); // agentId → Set<sessionId>
    this._store = store; // optional persistence { save(handle), load(id), remove(id) }
    this._now = now;
  }

  /**
   * 创建会话
   */
  create({ agentId, approvalPolicy, metadata, sessionId } = {}) {
    const handle = new SessionHandle({
      sessionId,
      agentId,
      approvalPolicy,
      metadata,
      now: this._now(),
    });
    this._register(handle);
    this.emit("created", handle);
    return handle;
  }

  /**
   * 注册已有 handle(用于从持久化恢复)
   */
  adopt(handle) {
    if (
      !handle ||
      typeof handle !== "object" ||
      typeof handle.sessionId !== "string" ||
      typeof handle.agentId !== "string" ||
      typeof handle.touch !== "function"
    ) {
      throw new Error("adopt: SessionHandle instance required");
    }
    this._register(handle);
    this.emit("adopted", handle);
    return handle;
  }

  _register(handle) {
    if (this._sessions.has(handle.sessionId)) {
      throw new Error(`SessionManager: duplicate sessionId ${handle.sessionId}`);
    }
    this._sessions.set(handle.sessionId, handle);
    if (!this._byAgent.has(handle.agentId)) {
      this._byAgent.set(handle.agentId, new Set());
    }
    this._byAgent.get(handle.agentId).add(handle.sessionId);
  }

  get(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  has(sessionId) {
    return this._sessions.has(sessionId);
  }

  /**
   * 列出所有 session(可按 agentId / status 过滤)
   */
  list({ agentId, status } = {}) {
    let ids;
    if (agentId) {
      ids = Array.from(this._byAgent.get(agentId) || []);
    } else {
      ids = Array.from(this._sessions.keys());
    }
    const handles = ids.map((id) => this._sessions.get(id)).filter(Boolean);
    if (status) return handles.filter((h) => h.status === status);
    return handles;
  }

  /**
   * 活跃会话(非 parked / closed)
   */
  listActive() {
    return this.list().filter(
      (h) => h.status !== STATUS.PARKED && h.status !== STATUS.CLOSED
    );
  }

  /**
   * touch 某 session(外部 LLM/tool 调用时刻)
   */
  touch(sessionId) {
    const h = this._sessions.get(sessionId);
    if (!h) return false;
    const ok = h.touch(this._now());
    if (ok) this.emit("touched", h);
    return ok;
  }

  /**
   * 标记 idle(等待用户输入)
   */
  markIdle(sessionId) {
    const h = this._sessions.get(sessionId);
    if (!h) return false;
    const ok = h.idle(this._now());
    if (ok) this.emit("idle", h);
    return ok;
  }

  /**
   * Park(释放进程资源)— 持久化到 store 如果配置了
   */
  async park(sessionId) {
    const h = this._sessions.get(sessionId);
    if (!h) return false;
    const ok = h.park(this._now());
    if (!ok) return false;
    if (this._store && typeof this._store.save === "function") {
      try {
        await this._store.save(h.toJSON());
      } catch (err) {
        this.emit("store-error", { op: "park", sessionId, error: err });
      }
    }
    this.emit("parked", h);
    return true;
  }

  /**
   * Resume parked session
   */
  async resume(sessionId) {
    let h = this._sessions.get(sessionId);
    if (!h && this._store && typeof this._store.load === "function") {
      try {
        const data = await this._store.load(sessionId);
        if (data) {
          h = SessionHandle.fromJSON(data);
          this._register(h);
        }
      } catch (err) {
        this.emit("store-error", { op: "resume", sessionId, error: err });
        return false;
      }
    }
    if (!h) return false;
    const ok = h.resume(this._now());
    if (ok) this.emit("resumed", h);
    return ok;
  }

  /**
   * 关闭并从活跃集合中移除
   */
  async close(sessionId) {
    const h = this._sessions.get(sessionId);
    if (!h) return false;
    h.close(this._now());
    this._sessions.delete(sessionId);
    const set = this._byAgent.get(h.agentId);
    if (set) {
      set.delete(sessionId);
      if (set.size === 0) this._byAgent.delete(h.agentId);
    }
    if (this._store && typeof this._store.remove === "function") {
      try {
        await this._store.remove(sessionId);
      } catch (err) {
        this.emit("store-error", { op: "close", sessionId, error: err });
      }
    }
    this.emit("closed", h);
    return true;
  }

  /**
   * Session-hour 汇总(默认单 session)
   */
  usage(sessionId) {
    const h = this._sessions.get(sessionId);
    if (!h) return null;
    const runtimeMs = h.getRuntimeMs(this._now());
    return {
      sessionId,
      agentId: h.agentId,
      status: h.status,
      runtimeMs,
      idleMs: h.getIdleMs(this._now()),
      sessionHours: runtimeMs / MS_PER_HOUR,
    };
  }

  /**
   * 全量汇总(按 agentId 分组)
   */
  usageByAgent() {
    const byAgent = new Map();
    for (const h of this._sessions.values()) {
      const runtimeMs = h.getRuntimeMs(this._now());
      if (!byAgent.has(h.agentId)) {
        byAgent.set(h.agentId, {
          agentId: h.agentId,
          sessionCount: 0,
          activeCount: 0,
          runtimeMs: 0,
          idleMs: 0,
          sessionHours: 0,
        });
      }
      const entry = byAgent.get(h.agentId);
      entry.sessionCount++;
      if (h.status === STATUS.RUNNING || h.status === STATUS.IDLE) {
        entry.activeCount++;
      }
      entry.runtimeMs += runtimeMs;
      entry.idleMs += h.getIdleMs(this._now());
      entry.sessionHours = entry.runtimeMs / MS_PER_HOUR;
    }
    return Array.from(byAgent.values());
  }

  /**
   * Global 汇总(所有 session)
   */
  usageTotal() {
    let runtimeMs = 0;
    let idleMs = 0;
    for (const h of this._sessions.values()) {
      runtimeMs += h.getRuntimeMs(this._now());
      idleMs += h.getIdleMs(this._now());
    }
    return {
      sessionCount: this._sessions.size,
      activeCount: this.listActive().length,
      runtimeMs,
      idleMs,
      sessionHours: runtimeMs / MS_PER_HOUR,
    };
  }

  /**
   * 清理所有(测试用)
   */
  clear() {
    this._sessions.clear();
    this._byAgent.clear();
  }

  size() {
    return this._sessions.size;
  }
}

module.exports = { SessionManager, MS_PER_HOUR };
