"use strict";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const UNAVAILABLE_MESSAGE =
  "Evolution Workbench is unavailable because the installed CLI deployment has no governed Workbench host. " +
  "No Workbench RPC was sent; review and rollback remain safely disabled.";
const INCOMPATIBLE_MESSAGE =
  "Evolution Workbench is unavailable because the installed CLI does not advertise the required list capability. " +
  "No Workbench RPC was sent.";
const PILOT_DISABLED_MESSAGE =
  "Evolution Workbench requires the CC App Server pilot. Enable " +
  "chainlesschain.appServer.pilot.enabled and try again.";

function localize(vscode, message) {
  return typeof vscode.l10n?.t === "function"
    ? vscode.l10n.t(message)
    : message;
}

function validateCandidate(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !DIGEST.test(value.packetDigest || "") ||
    !DIGEST.test(value.candidateContentDigest || "") ||
    typeof value.candidateId !== "string" ||
    !["pending", "approved", "rejected", "expired"].includes(value.status) ||
    typeof value.actualUsage?.active !== "boolean"
  ) {
    throw new Error("Evolution Workbench returned an invalid candidate");
  }
  return value;
}

function validateList(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !DIGEST.test(value.projectionDigest || "") ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 500
  ) {
    throw new Error("Evolution Workbench returned an invalid projection");
  }
  return value.candidates.map(validateCandidate);
}

function item(candidate) {
  const usage = candidate.actualUsage;
  return {
    label: `${usage.active ? "$(check) " : ""}${candidate.status} — ${candidate.candidateId}`,
    description: candidate.candidateContentDigest,
    detail: `${usage.completed}/${usage.receiptCount} completed · $${Number(usage.totalCostUsd || 0).toFixed(4)} · ${candidate.validation?.targetRuntimes?.join(", ") || "no runtime"}`,
    candidate,
  };
}

async function showJson(vscode, title, value) {
  const document = await vscode.workspace.openTextDocument({
    language: "json",
    content: JSON.stringify({ title, ...value }, null, 2),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function reason(vscode, prompt) {
  const value = await vscode.window.showInputBox({
    prompt,
    ignoreFocusOut: true,
    validateInput: (input) => {
      const trimmed = input.trim();
      if (!trimmed) return "A review reason is required.";
      if (trimmed.length > 2048)
        return "Reason must be at most 2048 characters.";
      return null;
    },
  });
  return value == null ? null : value.trim();
}

async function confirm(vscode, message, action) {
  return (
    (await vscode.window.showWarningMessage(
      message,
      { modal: true },
      action,
    )) === action
  );
}

async function review(vscode, pilot, candidate, decision) {
  const explanation = await reason(
    vscode,
    `Reason to ${decision} ${candidate.candidateId}`,
  );
  if (explanation === null) return null;
  const action = decision === "approve" ? "Approve" : "Reject";
  if (
    !(await confirm(
      vscode,
      `${action} exact packet ${candidate.packetDigest}?`,
      action,
    ))
  ) {
    return null;
  }
  return pilot.evolutionWorkbenchReview({
    packetDigests: [candidate.packetDigest],
    decision,
    reason: explanation,
  });
}

async function rollback(vscode, pilot, candidates, target) {
  const active = candidates.filter(({ actualUsage }) => actualUsage.active);
  if (active.length !== 1) {
    throw new Error("Evolution Workbench requires exactly one active version");
  }
  const explanation = await reason(
    vscode,
    `Reason to roll back ${active[0].candidateId} to ${target.candidateId}`,
  );
  if (explanation === null) return null;
  if (
    !(await confirm(
      vscode,
      `Roll back active content ${active[0].candidateContentDigest} to approved content ${target.candidateContentDigest}?`,
      "Roll back",
    ))
  ) {
    return null;
  }
  return pilot.evolutionWorkbenchRollback({
    fromPacketDigest: active[0].packetDigest,
    toPacketDigest: target.packetDigest,
    reason: explanation,
  });
}

async function openEvolutionWorkbench(vscode, { getPilot } = {}) {
  if (typeof getPilot !== "function") {
    throw new TypeError("Evolution Workbench App Server provider is required");
  }
  let pilot;
  try {
    pilot = await getPilot();
  } catch (error) {
    if (error?.code !== "ERR_APP_SERVER_PILOT_DISABLED") throw error;
    await vscode.window.showInformationMessage(
      localize(vscode, PILOT_DISABLED_MESSAGE),
    );
    return null;
  }
  if (!pilot || typeof pilot.start !== "function") {
    throw new TypeError("Evolution Workbench App Server pilot is invalid");
  }
  const capabilities = await pilot.start();
  const workbench = capabilities?.evolutionWorkbench;
  if (workbench?.available !== true) {
    await vscode.window.showInformationMessage(
      localize(vscode, UNAVAILABLE_MESSAGE),
    );
    return null;
  }
  if (
    !Array.isArray(workbench.methods) ||
    !workbench.methods.includes("list")
  ) {
    await vscode.window.showInformationMessage(
      localize(vscode, INCOMPATIBLE_MESSAGE),
    );
    return null;
  }
  const methods = new Set(workbench.methods);
  const candidates = validateList(
    await pilot.evolutionWorkbenchList({ limit: 500 }),
  );
  if (candidates.length === 0) {
    await vscode.window.showInformationMessage(
      "Evolution Workbench has no candidate versions.",
    );
    return null;
  }
  const selected = await vscode.window.showQuickPick(candidates.map(item), {
    title: "ChainlessChain Evolution Workbench",
    placeHolder: "Select a governed Skill version",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) return null;
  const actions = [{ label: "View evidence and diff", id: "details" }];
  if (methods.has("compare") && candidates.length > 1)
    actions.push({ label: "Compare versions", id: "compare" });
  if (methods.has("review") && selected.candidate.status === "pending") {
    actions.push({ label: "Approve", id: "approve" });
    actions.push({ label: "Reject", id: "reject" });
  }
  if (
    selected.candidate.status === "approved" &&
    selected.candidate.actualUsage.active === false &&
    methods.has("rollback") &&
    candidates.some(({ actualUsage }) => actualUsage.active)
  ) {
    actions.push({ label: "Roll back to this version", id: "rollback" });
  }
  const action = await vscode.window.showQuickPick(actions, {
    title: selected.candidate.candidateId,
    placeHolder: "Choose a governed action",
  });
  if (!action) return null;

  let result;
  if (action.id === "details") {
    result = selected.candidate;
  } else if (action.id === "compare") {
    const other = await vscode.window.showQuickPick(
      candidates
        .filter(
          ({ packetDigest }) =>
            packetDigest !== selected.candidate.packetDigest,
        )
        .map(item),
      { title: "Compare with", placeHolder: "Select the second version" },
    );
    if (!other) return null;
    result = await pilot.evolutionWorkbenchCompare({
      leftPacketDigest: selected.candidate.packetDigest,
      rightPacketDigest: other.candidate.packetDigest,
    });
  } else if (["approve", "reject"].includes(action.id)) {
    result = await review(vscode, pilot, selected.candidate, action.id);
  } else {
    result = await rollback(vscode, pilot, candidates, selected.candidate);
  }
  if (result !== null) {
    await showJson(vscode, "Evolution Workbench result", result);
  }
  return result;
}

module.exports = {
  EVOLUTION_WORKBENCH_INCOMPATIBLE_MESSAGE: INCOMPATIBLE_MESSAGE,
  EVOLUTION_WORKBENCH_PILOT_DISABLED_MESSAGE: PILOT_DISABLED_MESSAGE,
  EVOLUTION_WORKBENCH_UNAVAILABLE_MESSAGE: UNAVAILABLE_MESSAGE,
  openEvolutionWorkbench,
  validateEvolutionWorkbenchList: validateList,
};
