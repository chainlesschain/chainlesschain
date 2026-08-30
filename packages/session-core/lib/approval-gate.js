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

const BOUND_AUTHORIZATION_KIND =
  "chainlesschain.approval-gate.bound-authorization/v1";
const boundAuthorizations = new WeakMap();
const issuedBoundAuthorizations = new WeakSet();

function isObject(value) {
  return (
    value !== null && (typeof value === "object" || typeof value === "function")
  );
}

function validateOptionalFunction(value, label) {
  if (value != null && typeof value !== "function") {
    throw new Error(`${label} must be a function or null`);
  }
}

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
    consumeAuthorization = null,
    onDecision = null,
    store = null,
  } = {}) {
    if (!VALID_POLICIES.has(defaultPolicy)) {
      throw new Error(`ApprovalGate: invalid defaultPolicy "${defaultPolicy}"`);
    }
    validateOptionalFunction(
      consumeAuthorization,
      "ApprovalGate: consumeAuthorization",
    );
    this._default = defaultPolicy;
    this._confirm = confirm; // async (ctx) => boolean
    this._consumeAuthorization = consumeAuthorization;
    this._onDecision = onDecision; // (ctx, result) => void
    this._store = store; // { load(), save(policies) } — optional
    this._perSession = new Map(); // sessionId → policy override
    this._persistenceTail = Promise.resolve();
    this._persistenceError = null;
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
    if (!this._store?.save) return Promise.resolve();
    const snapshot = Object.fromEntries(this._perSession);
    const attempt = this._persistenceTail
      .catch(() => {})
      .then(() => this._store.save(snapshot));
    this._persistenceTail = attempt.then(
      () => {
        this._persistenceError = null;
      },
      (error) => {
        this._persistenceError = error;
      },
    );
    return this._persistenceTail;
  }

  async awaitPersistence() {
    await this._persistenceTail;
    if (!this._persistenceError) return;
    const error = new Error(
      `ApprovalGate: policy store persistence unavailable: ${this._persistenceError.message}`,
    );
    error.code = "APPROVAL_POLICY_STORE_UNAVAILABLE";
    error.cause = this._persistenceError;
    throw error;
  }

  hasPolicyStore() {
    return typeof this._store?.save === "function";
  }

  setSessionPolicy(sessionId, policy) {
    if (!sessionId)
      throw new Error("ApprovalGate.setSessionPolicy: sessionId required");
    if (!VALID_POLICIES.has(policy)) {
      throw new Error(`ApprovalGate: invalid policy "${policy}"`);
    }
    const prev = this._perSession.get(sessionId);
    this._perSession.set(sessionId, policy);
    if (prev !== policy || this._persistenceError) return this._persist();
    return this._persistenceTail;
  }

  getSessionPolicy(sessionId) {
    return this._perSession.get(sessionId) || this._default;
  }

  clearSessionPolicy(sessionId) {
    const existed = this._perSession.delete(sessionId);
    if (existed || this._persistenceError) this._persist();
    return existed;
  }

  /**
   * 注入/替换 confirm 回调 — 允许上层(CLI REPL / Desktop IPC)在不重建
   * gate 的前提下绑定用户交互 UI。
   */
  setConfirmer(fn) {
    if (fn != null && typeof fn !== "function") {
      throw new Error(
        "ApprovalGate.setConfirmer: fn must be a function or null",
      );
    }
    this._confirm = fn;
  }

  hasConfirmer() {
    return typeof this._confirm === "function";
  }

  setAuthorizationConsumer(fn) {
    validateOptionalFunction(fn, "ApprovalGate.setAuthorizationConsumer: fn");
    this._consumeAuthorization = fn;
  }

  hasAuthorizationConsumer() {
    return typeof this._consumeAuthorization === "function";
  }

  getAuthorizationPolicySnapshot(sessionId = null) {
    return Object.freeze({
      schema: "chainlesschain.approval-policy-authority/v1",
      kind: "session-core",
      sessionId: sessionId ? String(sessionId) : null,
      policy: sessionId ? this.getSessionPolicy(sessionId) : this._default,
    });
  }

  _bindAuthorization(authorization, consumer) {
    if (!authorization) {
      throw new Error("ApprovalGate: approval authorization is required");
    }
    if (typeof consumer !== "function") {
      throw new Error("ApprovalGate: authorization consumer is unavailable");
    }
    const handle = Object.freeze({ kind: BOUND_AUTHORIZATION_KIND });
    issuedBoundAuthorizations.add(handle);
    boundAuthorizations.set(handle, {
      authorization,
      consumer,
      consuming: false,
    });
    return handle;
  }

  bindAuthorization(authorization) {
    return this._bindAuthorization(authorization, this._consumeAuthorization);
  }

  createAuthorizationBinder() {
    const consumer = this._consumeAuthorization;
    return typeof consumer === "function"
      ? (authorization) => this._bindAuthorization(authorization, consumer)
      : null;
  }

  async _consumeAuthorizationWithFallback(
    authorization,
    ctx = {},
    fallbackConsumer = null,
  ) {
    if (!authorization) {
      throw new Error("ApprovalGate: approval authorization is required");
    }
    const binding = isObject(authorization)
      ? boundAuthorizations.get(authorization)
      : null;
    if (binding) {
      if (binding.consuming) {
        throw new Error(
          "ApprovalGate: approval authorization is already consuming",
        );
      }
      binding.consuming = true;
      try {
        const consumed = await binding.consumer(binding.authorization, ctx);
        if (consumed !== true) {
          throw new Error(
            "ApprovalGate: authorization consume was not confirmed",
          );
        }
        boundAuthorizations.delete(authorization);
        return true;
      } catch (error) {
        // A deterministic preflight mismatch is retryable with the correct
        // dispatch tuple. The underlying consumer owns the point at which an
        // online/unknown outcome becomes irrevocably burned.
        binding.consuming = false;
        throw error;
      }
    }
    if (
      isObject(authorization) &&
      issuedBoundAuthorizations.has(authorization)
    ) {
      throw new Error(
        "ApprovalGate: approval authorization is invalid or replayed",
      );
    }
    if (typeof fallbackConsumer !== "function") {
      throw new Error("ApprovalGate: authorization consumer is unavailable");
    }
    const consumed = await fallbackConsumer(authorization, ctx);
    if (consumed !== true) {
      throw new Error("ApprovalGate: authorization consume was not confirmed");
    }
    return true;
  }

  async consumeAuthorization(authorization, ctx = {}) {
    return this._consumeAuthorizationWithFallback(
      authorization,
      ctx,
      this._consumeAuthorization,
    );
  }

  /**
   * Create an interaction/authorization scope while retaining the singleton's
   * durable per-session policy store. Concurrent callers get independent
   * confirmer and consumer slots, so one run cannot overwrite another run's
   * dispatch authority.
   */
  createSessionScope(sessionId) {
    if (!sessionId) {
      throw new Error("ApprovalGate.createSessionScope: sessionId required");
    }
    const gate = this;
    let confirm = null;
    let consumeAuthorization = null;
    const scopedSessionId = String(sessionId);
    return {
      setSessionPolicy(sid, policy) {
        return gate.setSessionPolicy(sid || scopedSessionId, policy);
      },
      getSessionPolicy(sid) {
        return gate.getSessionPolicy(sid || scopedSessionId);
      },
      clearSessionPolicy(sid) {
        return gate.clearSessionPolicy(sid || scopedSessionId);
      },
      awaitPersistence() {
        return gate.awaitPersistence();
      },
      hasPolicyStore() {
        return gate.hasPolicyStore();
      },
      setConfirmer(fn) {
        validateOptionalFunction(fn, "ApprovalGate.setConfirmer: fn");
        confirm = fn;
      },
      hasConfirmer() {
        return typeof confirm === "function";
      },
      setAuthorizationConsumer(fn) {
        validateOptionalFunction(
          fn,
          "ApprovalGate.setAuthorizationConsumer: fn",
        );
        consumeAuthorization = fn;
      },
      hasAuthorizationConsumer() {
        return typeof consumeAuthorization === "function";
      },
      getAuthorizationPolicySnapshot(sid) {
        return gate.getAuthorizationPolicySnapshot(sid || scopedSessionId);
      },
      bindAuthorization(authorization) {
        return gate._bindAuthorization(authorization, consumeAuthorization);
      },
      createAuthorizationBinder() {
        const consumer = consumeAuthorization;
        return typeof consumer === "function"
          ? (authorization) => gate._bindAuthorization(authorization, consumer)
          : null;
      },
      consumeAuthorization(authorization, ctx = {}) {
        return gate._consumeAuthorizationWithFallback(
          authorization,
          ctx,
          consumeAuthorization,
        );
      },
      decide(ctx = {}) {
        // Capture both callbacks before the first await. Later reconfiguration
        // of this same scope cannot retarget an in-flight confirmation.
        return gate._decide(
          {
            ...ctx,
            sessionId: ctx.sessionId || scopedSessionId,
          },
          { confirm, consumeAuthorization },
        );
      },
    };
  }

  /**
   * decide({ sessionId, policy?, riskLevel, tool, args, user? })
   *   - 若 policy 显式传入则覆盖 session policy
   *   - 返回 { decision: "allow"|"deny", via: "policy"|"user-confirm"|"user-deny", base, policy, riskLevel }
   */
  async _decide(
    ctx = {},
    {
      confirm = this._confirm,
      consumeAuthorization = this._consumeAuthorization,
    } = {},
  ) {
    const { sessionId, riskLevel = RISK.LOW } = ctx;
    const policy =
      ctx.policy ||
      (sessionId ? this.getSessionPolicy(sessionId) : this._default);
    if (this._store?.save) {
      try {
        await this.awaitPersistence();
      } catch (error) {
        const result = {
          decision: DECISION.DENY,
          via: "policy-store-error",
          base: DECISION.DENY,
          policy,
          riskLevel,
          error,
        };
        if (this._onDecision) {
          try {
            this._onDecision(ctx, result);
          } catch {
            // The storage failure is already represented by the deny result.
          }
        }
        return result;
      }
    }
    const base = baseDecision(policy, riskLevel);

    let result;
    if (base === DECISION.ALLOW) {
      result = {
        decision: DECISION.ALLOW,
        via: "policy",
        base,
        policy,
        riskLevel,
      };
    } else if (base === DECISION.DENY) {
      result = {
        decision: DECISION.DENY,
        via: "policy",
        base,
        policy,
        riskLevel,
      };
    } else {
      // CONFIRM
      if (!confirm) {
        result = {
          decision: DECISION.DENY,
          via: "no-confirmer",
          base,
          policy,
          riskLevel,
        };
      } else {
        let ok = false;
        let authorization = null;
        let confirmationVia = null;
        try {
          const confirmation = await confirm(ctx);
          if (confirmation && typeof confirmation === "object") {
            ok = confirmation.approved === true;
            confirmationVia = confirmation.via || null;
            if (ok && !confirmation.authorization) {
              result = {
                decision: DECISION.DENY,
                via: "authorization-missing",
                base,
                policy,
                riskLevel,
              };
              if (this._onDecision) {
                try {
                  this._onDecision(ctx, result);
                } catch {
                  /* swallow */
                }
              }
              return result;
            }
            if (ok && typeof consumeAuthorization !== "function") {
              result = {
                decision: DECISION.DENY,
                via: "authorization-consumer-missing",
                base,
                policy,
                riskLevel,
              };
              if (this._onDecision) {
                try {
                  this._onDecision(ctx, result);
                } catch {
                  /* swallow */
                }
              }
              return result;
            }
            if (ok) {
              authorization = this._bindAuthorization(
                confirmation.authorization,
                consumeAuthorization,
              );
            }
          } else {
            ok = confirmation === true;
          }
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
          via: confirmationVia || (ok ? "user-confirm" : "user-deny"),
          base,
          policy,
          riskLevel,
          ...(authorization ? { authorization } : {}),
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

  async decide(ctx = {}) {
    // Capture the mutable legacy slots synchronously. Existing single-caller
    // integrations keep working; concurrent runners should use a session scope.
    return this._decide(ctx, {
      confirm: this._confirm,
      consumeAuthorization: this._consumeAuthorization,
    });
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
