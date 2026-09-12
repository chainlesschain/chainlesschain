"use strict";

function optionValue(option) {
  if (option && typeof option === "object") {
    return option.value ?? option.label ?? "";
  }
  return option;
}

function optionLabel(option) {
  if (option && typeof option === "object") {
    return String(option.label ?? option.value ?? "");
  }
  return String(option ?? "");
}

async function answerAppServerQuestion(vscode, request = {}) {
  const question = String(request.question || "").slice(0, 16_384);
  const options = Array.isArray(request.options)
    ? request.options.slice(0, 128)
    : null;
  if (options?.length) {
    const items = options.map((option) => ({
      label: optionLabel(option),
      value: optionValue(option),
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title:
        request.mode === "deferred"
          ? "Optional agent question"
          : "Agent question",
      placeHolder: question,
      canPickMany: request.multiSelect === true,
      ignoreFocusOut: request.blocking !== false,
    });
    if (picked == null) return null;
    return Array.isArray(picked)
      ? picked.map((item) => item.value)
      : picked.value;
  }
  const answer = await vscode.window.showInputBox({
    title:
      request.mode === "deferred"
        ? "Optional agent question"
        : "Agent question",
    prompt: question,
    ignoreFocusOut: request.blocking !== false,
  });
  return answer ?? null;
}

module.exports = { answerAppServerQuestion };
