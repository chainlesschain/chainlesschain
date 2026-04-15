/**
 * ApprovalGate — per-session 审批策略
 *
 * Phase E1 of Managed Agents parity plan.
 *
 * 对标 Managed Agents 的 approvalPolicy:
 *   - strict:     所有 MEDIUM/HIGH 风险工具需确认
 *   - trusted:    仅 HIGH 风险需确认
 *   - autopilot:  全自动,不确认
 *
 * 不绑定具体 UI/IPC — 上层注入 `confirm(ctx) => Promise<boolean>`
 */

const RISK = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

const VALID_RISKS = new Set(Object.values(RISK));

const POLICY = Object.freeze({
  STRICT: "strict",
  TRUSTED: "trusted",
  AUTOPILOT: "autopilot",
});

const VALID_POLICIES = new Set(Object.values(POLICY));

const DECISION = Object.freeze({
  ALLOW: "allow",
  DENY: "deny",
  CONFIRM: "confirm",
});

/**
 * 根据 policy + riskLevel 推断初步 decision(不考虑 user 确认结果)
 */
function baseDecision(policy, riskLevel) {
  if (!VALID_POLICIES.has(policy)) {
    throw new Error(`ApprovalGate: invalid policy "${policy}"`);
  }
  const risk = VALID_RISKS.has(riskLevel) ? riskLevel : RISK.LOW;

  if (risk === RISK.LOW) return DECISION.ALLOW;

  if (policy === POLICY.AUTOPILOT) return DECISION.ALLOW;

  if (policy === POLICY.TRUSTED) {
    return risk === RISK.HIGH ? DECISION.CONFIRM : DECISION.ALLOW;
  }

  // strict
  return DECISION.CONFIRM;
}

class ApprovalGate {
  constructor({
    defaultPolicy = POLICY.STRICT,
    confirm = null,
    onDecision = null,
    store = null,
  } = {}) {
    if (!VALID_POLICIES.has(defaultPolicy)) {
      throw new Error(`ApprovalGate: invalid defaultPolicy "${defaultPolicy}"`);
    }
    this._default = defaultPolicy;
    this._confirm = confirm; // async (ctx) => boolean
    this._onDecision = onDecision; // (ctx, result) => void
    this._store = store; // { load(), save(policies) } — optional
    this._perSession = new Map(); // sessionId → policy override
  }

  async load() {
    if (!this._store?.load) return;
    const entries = await this._store.load();
    if (!entries) return;
    // entries: { [sessionId]: policy } or Array<[sessionId, policy]>
    const iter = Array.isArray(entries) ? entries : Object.entries(entries);
    for (const [sid, policy] of iter) {
      if (sid && VALID_POLICIES.has(policy)) this._perSession.set(sid, policy);
    }
  }

  _persist() {
    if (!this._store?.save) return;
    const snapshot = Object.fromEntries(this._perSession);
    Promise.resolve()
      .then(() => this._store.save(snapshot))
      .catch(() => {
        /* swallow — store-error path kept silent; adapters log themselves */
      });
  }

  setSessionPolicy(sessionId, policy) {
    if (!sessionId) throw new Error("ApprovalGate.setSessionPolicy: sessionId required");
    if (!VALID_POLICIES.has(policy)) {
      throw new Error(`ApprovalGate: invalid policy "${policy}"`);
    }
    const prev = this._perSession.get(sessionId);
    this._perSession.set(sessionId, policy);
    if (prev !== policy) this._persist();
  }

  getSessionPolicy(sessionId) {
    return this._perSession.get(sessionId) || this._default;
  }

  clearSessionPolicy(sessionId) {
    const existed = this._perSession.delete(sessionId);
    if (existed) this._persist();
    return existed;
  }

  /**
   * decide({ sessionId, policy?, riskLevel, tool, args, user? })
   *   - 若 policy 显式传入则覆盖 session policy
   *   - 返回 { decision: "allow"|"deny", via: "policy"|"user-confirm"|"user-deny", base, policy, riskLevel }
   */
  async decide(ctx = {}) {
    const { sessionId, riskLevel = RISK.LOW } = ctx;
    const policy =
      ctx.policy || (sessionId ? this.getSessionPolicy(sessionId) : this._default);
    const base = baseDecision(policy, riskLevel);

    let result;
    if (base === DECISION.ALLOW) {
      result = { decision: DECISION.ALLOW, via: "policy", base, policy, riskLevel };
    } else if (base === DECISION.DENY) {
      result = { decision: DECISION.DENY, via: "policy", base, policy, riskLevel };
    } else {
      // CONFIRM
      if (!this._confirm) {
        result = {
          decision: DECISION.DENY,
          via: "no-confirmer",
          base,
          policy,
          riskLevel,
        };
      } else {
        let ok = false;
        try {
          ok = await this._confirm(ctx);
        } catch (err) {
          result = {
            decision: DECISION.DENY,
            via: "confirm-error",
            base,
            policy,
            riskLevel,
            error: err,
          };
          if (this._onDecision) this._onDecision(ctx, result);
          return result;
        }
        result = {
          decision: ok ? DECISION.ALLOW : DECISION.DENY,
          via: ok ? "user-confirm" : "user-deny",
          base,
          policy,
          riskLevel,
        };
      }
    }

    if (this._onDecision) {
      try {
        this._onDecision(ctx, result);
      } catch {
        /* swallow */
      }
    }
    return result;
  }
}

module.exports = {
  ApprovalGate,
  POLICY,
  RISK,
  DECISION,
  baseDecision,
  VALID_POLICIES,
  VALID_RISKS,
};
