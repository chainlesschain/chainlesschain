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

/**
 * Build the binding-attaching confirmer for one WS session.
 *
 * @param {object} opts
 * @param {{askConfirm: Function}} opts.interaction - the session's WS adapter
 * @param {string} opts.sessionId
 * @returns {(ctx?: object) => Promise<boolean>}
 */
export function buildWsApprovalConfirmer({ interaction, sessionId }) {
  let approvalSeq = 0;
  return async (ctx = {}) => {
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
      const ok = await interaction.askConfirm(
        `Approve ${what}${detail}? (risk: ${risk})`,
        {
          default: false,
          binding,
          // Structured context so UIs can render a proper approval card
          // instead of parsing the question text.
          approval: {
            tool: what,
            command,
            risk,
            rule: ctx.rule || null,
          },
        },
      );
      return ok === true;
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
    const confirmer =
      deps.confirmer || buildWsApprovalConfirmer({ interaction, sessionId });
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
      getSessionPolicy: (sid) => inner.getSessionPolicy(sid || sessionId),
      setSessionPolicy: (sid, policy) =>
        inner.setSessionPolicy(sid || sessionId, policy),
    };
  } catch {
    return null; // degrade to the legacy no-gate path
  }
}
