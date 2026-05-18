/**
 * SessionHandle — 统一会话抽象
 *
 * 对标 Claude Managed Agents 的 session 一等公民设计。
 * 所有 agent runtime 路径(agent-repl / sub-runtime / hmemory)围绕它运作。
 *
 * 状态机:
 *   running  ←→ idle  →  parked  →  closed
 *
 * 计费语义:
 *   runtimeMs — 累计"活跃"毫秒(LLM / tool 执行期间)
 *   idleMs    — 累计空闲(不计费)
 */

const crypto = require("crypto");

const STATUS = Object.freeze({
  RUNNING: "running",
  IDLE: "idle",
  PARKED: "parked",
  CLOSED: "closed",
});

const APPROVAL_POLICIES = Object.freeze(["strict", "trusted", "autopilot"]);

const VALID_TRANSITIONS = Object.freeze({
  running: ["idle", "closed"],
  idle: ["running", "parked", "closed"],
  parked: ["running", "closed"],
  closed: [],
});

function generateSessionId() {
  return `sess_${crypto.randomBytes(8).toString("hex")}`;
}

class SessionHandle {
  constructor({
    sessionId,
    agentId,
    approvalPolicy = "strict",
    now = Date.now(),
    metadata = {},
  } = {}) {
    if (!agentId || typeof agentId !== "string") {
      throw new Error("SessionHandle: agentId is required");
    }
    if (!APPROVAL_POLICIES.includes(approvalPolicy)) {
      throw new Error(
        `SessionHandle: invalid approvalPolicy "${approvalPolicy}", must be one of ${APPROVAL_POLICIES.join(", ")}`
      );
    }

    this.sessionId = sessionId || generateSessionId();
    this.agentId = agentId;
    this.status = STATUS.RUNNING;
    this.createdAt = now;
    this.lastActiveAt = now;
    this.runtimeMs = 0;
    this.idleMs = 0;
    this.approvalPolicy = approvalPolicy;
    this.metadata = { ...metadata };

    // 内部计时器:记录当前状态进入时间,用于计算 runtimeMs / idleMs
    this._statusEnteredAt = now;
  }

  /**
   * 状态迁移,返回 true 表示成功,false 表示非法迁移
   */
  transition(nextStatus, now = Date.now()) {
    if (this.status === nextStatus) return true;

    const allowed = VALID_TRANSITIONS[this.status] || [];
    if (!allowed.includes(nextStatus)) {
      return false;
    }

    // 结算当前状态的累计时间
    const delta = Math.max(0, now - this._statusEnteredAt);
    if (this.status === STATUS.RUNNING) {
      this.runtimeMs += delta;
    } else if (this.status === STATUS.IDLE) {
      this.idleMs += delta;
    }
    // parked / closed 不计入任何时长桶

    this.status = nextStatus;
    this._statusEnteredAt = now;
    this.lastActiveAt = now;
    return true;
  }

  /**
   * 标记活跃(LLM/tool 调用发生),保持 running 状态并刷新 lastActiveAt
   * 如果当前是 idle/parked,自动转回 running 并结算空闲时长
   */
  touch(now = Date.now()) {
    if (this.status === STATUS.CLOSED) return false;
    if (this.status !== STATUS.RUNNING) {
      this.transition(STATUS.RUNNING, now);
    } else {
      this.lastActiveAt = now;
    }
    return true;
  }

  /**
   * 进入空闲(等待用户输入)
   */
  idle(now = Date.now()) {
    return this.transition(STATUS.IDLE, now);
  }

  /**
   * Park(释放子进程资源但保留状态,可 resume)
   */
  park(now = Date.now()) {
    return this.transition(STATUS.PARKED, now);
  }

  /**
   * 从 parked 恢复
   */
  resume(now = Date.now()) {
    if (this.status !== STATUS.PARKED) return false;
    return this.transition(STATUS.RUNNING, now);
  }

  /**
   * 关闭会话(终态)
   */
  close(now = Date.now()) {
    return this.transition(STATUS.CLOSED, now);
  }

  /**
   * 返回当前累计 runtimeMs(包含当前 running 段)
   */
  getRuntimeMs(now = Date.now()) {
    if (this.status === STATUS.RUNNING) {
      return this.runtimeMs + Math.max(0, now - this._statusEnteredAt);
    }
    return this.runtimeMs;
  }

  /**
   * 返回当前累计 idleMs(包含当前 idle 段)
   */
  getIdleMs(now = Date.now()) {
    if (this.status === STATUS.IDLE) {
      return this.idleMs + Math.max(0, now - this._statusEnteredAt);
    }
    return this.idleMs;
  }

  /**
   * 会话是否超过空闲阈值,应该自动 park
   */
  shouldPark(idleThresholdMs, now = Date.now()) {
    if (this.status !== STATUS.IDLE) return false;
    return (now - this._statusEnteredAt) >= idleThresholdMs;
  }

  /**
   * 序列化(用于 park 时持久化到 SQLite)
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      agentId: this.agentId,
      status: this.status,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      runtimeMs: this.runtimeMs,
      idleMs: this.idleMs,
      approvalPolicy: this.approvalPolicy,
      metadata: this.metadata,
      _statusEnteredAt: this._statusEnteredAt,
    };
  }

  static fromJSON(data) {
    const handle = new SessionHandle({
      sessionId: data.sessionId,
      agentId: data.agentId,
      approvalPolicy: data.approvalPolicy,
      now: data.createdAt,
      metadata: data.metadata,
    });
    handle.status = data.status;
    handle.lastActiveAt = data.lastActiveAt;
    handle.runtimeMs = data.runtimeMs || 0;
    handle.idleMs = data.idleMs || 0;
    handle._statusEnteredAt = data._statusEnteredAt || data.lastActiveAt;
    return handle;
  }
}

module.exports = {
  SessionHandle,
  STATUS,
  APPROVAL_POLICIES,
  VALID_TRANSITIONS,
  generateSessionId,
};
