/**
 * REPL-side remote-approval glue (gap-analysis 批26 — 批17/18 REPL 遗留收口).
 *
 * Interactive sessions race the LOCAL terminal prompt against a paired
 * device's decision (headless gates on the remote decision alone):
 *
 *   - local answer first  → settle the device card too (resolveLocally
 *     publishes permission.resolved so the phone/web UI clears it)
 *   - remote answer first → cancel the local readline prompt and print
 *     the outcome
 *   - remote leg times out or the bridge closes mid-ask → NOT a remote human
 *     decision, so keep waiting on the terminal. A later local answer still
 *     needs the bridge's durable CAS; an expired/closed card cannot be revived.
 *
 * Pure over an injected bridge + local prompt handle ({promise, cancel}),
 * so the race is unit-testable without a WS server or readline.
 */

/**
 * Normalize the shapes the REPL's two confirmers receive (ApprovalGate
 * `{tool, args, riskLevel}` / settings-hook `{tool, args, rule, reason}`)
 * into the bridge's `{tool, action, detail}` ask payload.
 */
export function describeAskContext({
  tool,
  args,
  rule = null,
  reason = null,
  riskLevel = null,
} = {}) {
  const detail =
    typeof args?.command === "string"
      ? args.command
      : typeof args?.path === "string"
        ? args.path
        : args
          ? JSON.stringify(args).slice(0, 2000)
          : null;
  return {
    tool: tool || null,
    action: rule
      ? `ask-rule:${rule}`
      : reason || (riskLevel ? `${riskLevel}-risk` : null),
    detail,
  };
}

// These outcomes are not a remote human decision. The terminal may still
// answer, but its result is accepted only if resolveLocally can durably settle
// the same live card.
const NON_DECISIVE_REMOTE = new Set(["timeout", "closed"]);

/**
 * Race the local interactive prompt against the paired-device decision.
 *
 * @param {object} opts
 * @param {import("../lib/remote-approval-bridge.js").RemoteApprovalBridge} opts.bridge
 * @param {{tool?, action?, detail?}} opts.ask - describeAskContext() payload
 * @param {{promise: Promise<boolean>, cancel?: () => void}} opts.local -
 *   the already-started local prompt; `cancel` closes its readline when the
 *   device answers first (implementations must mute their idle-timeout
 *   message after cancel).
 * @param {(text: string) => void} [opts.writeOut]
 * @returns {Promise<boolean>} approved
 */
export async function raceLocalAndRemote({
  bridge,
  ask = {},
  local,
  writeOut = () => {},
}) {
  let requestId = null;
  const remoteLeg = bridge
    .requestDecision({
      ...ask,
      onRequestId: (id) => {
        requestId = id;
      },
    })
    .then((decision) => ({ src: "remote", decision }));
  const localLeg = local.promise.then(
    (approved) => ({ src: "local", approved: approved === true }),
    () => ({ src: "local", approved: false }),
  );
  let winner = await Promise.race([remoteLeg, localLeg]);
  if (
    winner.src === "remote" &&
    NON_DECISIVE_REMOTE.has(winner.decision?.via)
  ) {
    winner = await localLeg;
  }
  if (winner.src === "local") {
    if (!requestId) return false;
    try {
      const persisted = bridge.resolveLocally(requestId, winner.approved);
      return persisted === true && winner.approved === true;
    } catch {
      // A local "yes" without a durable CAS is not an approval.
      return false;
    }
  }
  try {
    local.cancel?.();
  } catch {
    // readline already closed
  }
  writeOut(
    `\n  ✓ ${winner.decision.approved ? "allowed" : "denied"} from paired device\n`,
  );
  return winner.decision.approved === true;
}
