/**
 * Permission-gate-over-WS — the approval-BINDING producer for the WS path.
 *
 * The consumer side has been wired for a while: WebSocketInteractionAdapter
 * stores `options.binding` on a pending request, rides it out on the message,
 * and `_resolvePending` rejects an approve whose echoed binding mismatches
 * (deny, fail closed). What was missing is the PRODUCER: nothing on the WS
 * path ever raised an approval request WITH a binding, because the WS agent
 * handler wired no ApprovalGate at all (CONFIRM-tier decisions fell closed).
 *
 * This module supplies both halves:
 *   - `buildWsApprovalConfirmer` — the gate confirmer that computes
 *     `approvalBindingDigest({toolCallId, args, policyDigest})` (mirroring the
 *     headless-stream `interactiveConfirm` producer) and asks the WS client
 *     over the interaction adapter with the binding attached. Timeout /
 *     disconnect / any transport error → false (fail closed).
 *   - `createWsApprovalGate` — a session-scoped gate whose CONFIRM decisions
 *     route to that confirmer. Policy tiers stay authoritative on the shared
 *     singleton gate (so `sessions.policy.set` over WS keeps working and no
 *     global confirmer is ever mutated — a per-session confirmer on the
 *     process-wide singleton would race across concurrent WS sessions).
 *
 * Default byte-identical: the WS handler only builds this when
 * `CC_WS_APPROVAL_GATE=1` (or a gate is injected); otherwise loopOptions
 * carry `approvalGate: null` exactly as before.
 */

import { approvalBindingDigest } from "../../lib/agent-authority.js";
import {
  APPROVAL_GRANTS_EVENT,
  ApprovalGrantLedger,
  approvalPermissionForContext,
} from "../../lib/approval-grant-ledger.js";

function approvalDecision(value) {
  const candidate =
    value?.decision && typeof value.decision === "object"
      ? value.decision
      : value;
  if (
    candidate &&
    [
      "acceptOnce",
      "acceptForTurn",
      "acceptForSession",
      "decline",
      "cancel",
    ].includes(candidate.kind)
  ) {
    return candidate;
  }
  if (value === true) return { kind: "acceptOnce" };
  return { kind: "decline" };
}

/**
 * Build the binding-attaching confirmer for one WS session.
 *
 * @param {object} opts
 * @param {{askConfirm: Function}} opts.interaction - the session's WS adapter
 * @param {string} opts.sessionId
 * @returns {(ctx?: object) => Promise<boolean>}
 */
export function buildWsApprovalConfirmer({
  interaction,
  sessionId,
  cwd = null,
  ledgerState = { ledger: new ApprovalGrantLedger({ sessionId }) },
  persistApprovalGrants = () => false,
}) {
  let approvalSeq = 0;
  return async (ctx = {}) => {
    const requiredPermission = approvalPermissionForContext(ctx, {
      cwd: cwd || ctx.cwd || null,
    });
    if (ledgerState.ledger.allows(requiredPermission)) return true;
    const command = ctx.command ?? ctx.args?.command ?? null;
    const risk = ctx.riskLevel || ctx.risk || "unknown";
    // Bind this approval to the exact call it authorizes (same recipe as the
    // headless-stream producer): request identity + normalized args + the
    // policy/rule in force. The client must echo it back on approve.
    const binding = approvalBindingDigest({
      toolCallId: `${sessionId}:appr-${++approvalSeq}`,
      args: ctx.args ?? (command != null ? { command } : null),
      policyDigest: ctx.rule || ctx.riskLevel || ctx.risk || null,
    });
    const what = ctx.tool || ctx.toolName || "tool";
    const detail = command != null ? `: ${String(command).slice(0, 200)}` : "";
    try {
      const options = {
        default: false,
        binding,
        // Structured context so UIs can render a proper approval card
        // instead of parsing the question text. Reusable permissions are
        // host-issued and exact; the renderer may choose a lifetime but may
        // never widen this set.
        approval: {
          tool: what,
          command,
          risk,
          rule: ctx.rule || null,
          requestedPermissions: [requiredPermission],
        },
      };
      const rawDecision = interaction.askApproval
        ? await interaction.askApproval(
            `Approve ${what}${detail}? (risk: ${risk})`,
            options,
          )
        : await interaction.askConfirm(
            `Approve ${what}${detail}? (risk: ${risk})`,
            options,
          );
      let decision = approvalDecision(rawDecision);
      const approved = [
        "acceptOnce",
        "acceptForTurn",
        "acceptForSession",
      ].includes(decision.kind);
      if (
        approved &&
        (decision.kind === "acceptForTurn" ||
          decision.kind === "acceptForSession")
      ) {
        const priorSessionGrants = new Map(ledgerState.ledger.sessionGrants);
        const priorRevision = ledgerState.ledger.revision;
        const applied = ledgerState.ledger.applyDecision(
          decision,
          requiredPermission,
          binding,
        );
        decision = applied.decision;
        if (applied.granted.length === 0) return false;
        if (applied.persistedScope && !persistApprovalGrants()) {
          ledgerState.ledger.sessionGrants = priorSessionGrants;
          ledgerState.ledger.revision = priorRevision;
          // Match the stream-json contract: persistence failure never creates
          // a phantom session grant, but the exact operation may proceed once.
          decision = { kind: "acceptOnce" };
        }
      }
      interaction.recordApprovalDecision?.({
        binding,
        decision,
        requiredPermission,
      });
      return ["acceptOnce", "acceptForTurn", "acceptForSession"].includes(
        decision.kind,
      );
    } catch {
      // timeout / disconnect / interrupt → fail closed, never approve
      return false;
    }
  };
}

/**
 * Create a session-scoped approval gate for the WS agent handler.
 *
 * Policy lookups delegate to the persistent singleton gate (per-session tiers
 * set via `sessions.policy.set` stay live); CONFIRM decisions route to the
 * binding-attaching WS confirmer. Returns null on any load failure so the
 * caller degrades to the legacy no-gate path (fail closed at CONFIRM).
 *
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {{askConfirm: Function}} opts.interaction
 * @param {object} [opts.deps] - test seams: `loadSingletons`, `loadSessionCore`
 * @returns {Promise<object|null>}
 */
export async function createWsApprovalGate({
  sessionId,
  interaction,
  cwd = null,
  deps = {},
}) {
  try {
    const loadSingletons =
      deps.loadSingletons ||
      (() => import("../../lib/session-core-singletons.js"));
    const loadSessionCore =
      deps.loadSessionCore || (() => import("@chainlesschain/session-core"));
    const [singletons, core] = await Promise.all([
      loadSingletons(),
      loadSessionCore(),
    ]);
    const inner = await singletons.getApprovalGate();
    const store =
      deps.sessionStore ||
      (await import("../../harness/jsonl-session-store.js"));
    const ledgerState = {
      ledger: new ApprovalGrantLedger({ sessionId }),
    };
    let approvalGrantPersistenceError = null;
    try {
      const event = store.findLatestEvent(
        sessionId,
        APPROVAL_GRANTS_EVENT,
        (candidate) => candidate?.data && typeof candidate.data === "object",
      );
      if (event) {
        ledgerState.ledger = ApprovalGrantLedger.fromJSON(event.data, {
          sessionId,
        });
      }
    } catch (error) {
      approvalGrantPersistenceError = error;
      ledgerState.ledger = new ApprovalGrantLedger({ sessionId });
      interaction.emit?.("recovery-degraded", {
        component: "approval_grants",
        error:
          "Persisted approval grants could not be verified; all grants were discarded",
      });
    }
    const persistApprovalGrants = () => {
      if (approvalGrantPersistenceError) return false;
      try {
        const persisted = store.appendAuthorityEvent(
          sessionId,
          APPROVAL_GRANTS_EVENT,
          ledgerState.ledger.toJSON(),
        );
        if (persisted === false) {
          throw new Error("session store rejected approval grants");
        }
        return true;
      } catch (error) {
        approvalGrantPersistenceError = error;
        return false;
      }
    };
    const confirmer =
      deps.confirmer ||
      buildWsApprovalConfirmer({
        interaction,
        sessionId,
        cwd,
        ledgerState,
        persistApprovalGrants,
      });
    const gate = new core.ApprovalGate({
      defaultPolicy: core.APPROVAL_POLICY?.STRICT || "strict",
      confirm: confirmer,
    });
    return {
      // Explicit ctx.policy always wins inside decide(); resolve it from the
      // singleton on every call so mid-session `sessions.policy.set` applies.
      decide: (ctx = {}) =>
        gate.decide({
          ...ctx,
          policy:
            ctx.policy || inner.getSessionPolicy(ctx.sessionId || sessionId),
        }),
      hasConfirmer: () => gate.hasConfirmer(),
      setConfirmer: (fn) => gate.setConfirmer(fn),
      setAuthorizationConsumer: (fn) => gate.setAuthorizationConsumer?.(fn),
      hasAuthorizationConsumer: () =>
        gate.hasAuthorizationConsumer?.() === true,
      consumeAuthorization: (authorization, ctx) =>
        gate.consumeAuthorization(authorization, ctx),
      getSessionPolicy: (sid) => inner.getSessionPolicy(sid || sessionId),
      setSessionPolicy: (sid, policy) =>
        inner.setSessionPolicy(sid || sessionId, policy),
      beginTurn: (turnId) => ledgerState.ledger.beginTurn(turnId),
      listGrants: () => ledgerState.ledger.listGrants(),
      revokeGrant: (grantId) => {
        const existing = ledgerState.ledger
          .listGrants()
          .find((grant) => grant.grantId === String(grantId || ""));
        if (!existing) {
          return { success: false, error: "Approval grant was not found" };
        }
        if (existing.lifetime === "turn") {
          const result = ledgerState.ledger.revoke(grantId);
          return { success: result.revoked, grant: result.grant };
        }

        const candidate = ApprovalGrantLedger.fromJSON(
          ledgerState.ledger.toJSON(),
          { sessionId },
        );
        const result = candidate.revoke(grantId);
        if (!result.revoked) {
          return { success: false, error: "Approval grant was not found" };
        }
        const previous = ledgerState.ledger;
        ledgerState.ledger = candidate;
        if (!persistApprovalGrants()) {
          ledgerState.ledger = previous;
          return {
            success: false,
            error: "Approval grant revocation could not be persisted",
          };
        }
        return { success: true, grant: result.grant };
      },
    };
  } catch {
    return null; // degrade to the legacy no-gate path
  }
}
