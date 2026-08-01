import { ADVISOR_TRIGGERS } from "../lib/advisor-runtime.js";

/** Parse `/advisor on|off|once [focus]|status`. */
export function parseAdvisorCommand(input) {
  const text = String(input == null ? "" : input).trim();
  if (text !== "/advisor" && !text.startsWith("/advisor ")) return null;
  const rest = text.slice("/advisor".length).trim();
  if (!rest || rest === "status") return { action: "status" };
  if (rest === "on" || rest === "off") return { action: rest };
  if (rest === "once" || rest.startsWith("once ")) {
    return {
      action: "once",
      focus:
        rest.slice("once".length).trim() ||
        "Give a second opinion on the current task.",
    };
  }
  return {
    action: "error",
    error: "usage: /advisor on|off|once [focus]|status",
  };
}

function money(value) {
  return Number.isFinite(value) ? `$${Number(value).toFixed(4)}` : "unlimited";
}

export function renderAdvisorStatus(status = {}) {
  const policy = status.allowed
    ? status.managed
      ? "managed allowlist: allowed"
      : "managed allowlist: not configured"
    : `blocked: ${status.policyReason || "managed policy"}`;
  const remaining = Number.isFinite(status.remainingUsd)
    ? money(status.remainingUsd)
    : "unlimited";
  return [
    `Advisor: ${status.enabled ? "on" : "off"} (${policy})`,
    `  model: ${status.provider || "?"}/${status.model || "?"}`,
    `  budget: ${money(status.budgetUsd)}; spent ${money(status.spentUsd)}; remaining ${remaining}`,
    `  calls: ${status.calls || 0}; tokens: ${status.totalTokens || 0}; repeated-error threshold: ${status.repeatErrorThreshold || "?"}`,
    "  authority: no tools, no permission escalation; main agent must verify locally",
  ].join("\n");
}

export function renderAdvisorAdvice(result = {}) {
  if (!result.ok) return result.error || "Advisor call did not run.";
  const advice = result.advice || {};
  const lines = [
    `Advisor (${result.trigger || ADVISOR_TRIGGERS.MANUAL}, risk ${advice.risk || "unknown"}):`,
    `  ${advice.recommendation || "No recommendation."}`,
  ];
  if (Array.isArray(advice.verification) && advice.verification.length > 0) {
    lines.push("  Verify locally:");
    for (const item of advice.verification) lines.push(`    - ${item}`);
  }
  lines.push(
    "  Advisory only - this does not grant tools or permissions; verify before acting or claiming completion.",
  );
  return lines.join("\n");
}

/** Execute one parsed command against an injected AdvisorRuntime. */
export async function executeAdvisorCommand(
  parsed,
  { runtime, messages = [], signal = null } = {},
) {
  if (!parsed) return null;
  if (!runtime) {
    return { ok: false, output: "Advisor runtime is unavailable." };
  }
  if (parsed.action === "error") {
    return { ok: false, output: parsed.error };
  }
  if (parsed.action === "status") {
    return { ok: true, output: renderAdvisorStatus(runtime.status()) };
  }
  if (parsed.action === "on" || parsed.action === "off") {
    const result = runtime.setEnabled(parsed.action === "on");
    return {
      ok: result.ok,
      output: result.ok
        ? `Advisor ${result.enabled ? "enabled" : "disabled"} for this session.`
        : result.error,
    };
  }
  if (parsed.action === "once") {
    const result = await runtime.advise({
      trigger: ADVISOR_TRIGGERS.MANUAL,
      subject: parsed.focus,
      messages,
      force: true,
      signal,
    });
    return {
      ok: result.ok,
      result,
      guidance: result.guidance || null,
      output: renderAdvisorAdvice(result),
    };
  }
  return { ok: false, output: "usage: /advisor on|off|once [focus]|status" };
}
