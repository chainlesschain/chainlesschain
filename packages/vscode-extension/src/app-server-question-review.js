"use strict";
const crypto = require("crypto");
const {
  questionIdentity,
  normalizeQuestionFields,
  questionDraftText,
} = require("./chat/question-draft-contract");

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

async function answerAppServerQuestion(
  vscode,
  request = {},
  { store = null } = {},
) {
  const question = String(request.question || "").slice(0, 16_384);
  const options = Array.isArray(request.options)
    ? request.options.slice(0, 128)
    : null;
  if (store && vscode.window.createInputBox && vscode.window.createQuickPick) {
    return persistentQuestion(vscode, request, { store, question, options });
  }
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

async function persistentQuestion(
  vscode,
  request,
  { store, question, options },
) {
  const sessionId = request.binding?.sessionId || request.sessionId || "";
  const digest = crypto
    .createHash("sha256")
    .update("native-v1:" + questionIdentity(sessionId, request))
    .digest("hex");
  const group = crypto
    .createHash("sha256")
    .update("native-question:" + sessionId)
    .digest("hex")
    .slice(0, 32);
  const key = [
    group.slice(0, 8),
    group.slice(8, 12),
    group.slice(12, 16),
    group.slice(16, 20),
    group.slice(20),
  ].join("-");
  // Native review currently has no structured-schema renderer. Do not save
  // potentially sensitive schema responses as ordinary free text.
  const sensitive =
    request.password === true ||
    !!request.requestedSchema ||
    !!request.metadata?.requestedSchema;
  const fields = sensitive
    ? []
    : options?.length
      ? [
          { key: "filter", label: "Search", kind: "text" },
          { key: "selection", label: "Selected options", kind: "text" },
        ]
      : [{ key: "answer", label: "Answer", kind: "text" }];
  let recoveryFailed = false;
  const saved = await store.view(key, { includeComposer: false }).catch(() => {
    recoveryFailed = true;
    return { questions: [] };
  });
  const bound =
    request.binding?.sessionId &&
    request.binding?.turnId &&
    request.binding?.toolUseId &&
    Number.isSafeInteger(request.binding.sequence);
  const prior = bound
    ? saved.questions.find((q) => q.digest === digest && q.status === "draft")
    : null;
  const id = prior?.id || crypto.randomUUID();
  const initial = new Map(
    normalizeQuestionFields(fields, prior?.fields || []).map((f) => [
      f.key,
      f.value,
    ]),
  );
  const pick = !!options?.length;
  const control = pick
    ? vscode.window.createQuickPick()
    : vscode.window.createInputBox();
  const items =
    options?.map((option, index) => ({
      label: optionLabel(option),
      value: optionValue(option),
      index,
    })) || [];
  control.title =
    request.mode === "deferred" ? "Optional agent question" : "Agent question";
  control.ignoreFocusOut = request.blocking !== false;
  if (pick) {
    control.items = items;
    control.canSelectMany = request.multiSelect === true;
    control.placeholder = question;
    control.value = initial.get("filter") || "";
    let selected = [];
    try {
      selected = JSON.parse(initial.get("selection") || "[]");
    } catch {
      /* ignore invalid recovery data */
    }
    control.selectedItems = items.filter(
      (i) => Array.isArray(selected) && selected.includes(i.index),
    );
  } else {
    control.prompt = question;
    control.password = request.password === true;
    control.value = initial.get("answer") || "";
  }
  let settling = false;
  let settled = false;
  let hidden = false;
  const capture = () =>
    normalizeQuestionFields(
      fields,
      pick
        ? [
            { key: "filter", value: control.value || "" },
            {
              key: "selection",
              value: JSON.stringify(
                (control.selectedItems || []).map((i) => i.index),
              ),
            },
          ]
        : [{ key: "answer", value: control.value || "" }],
    );
  const save = async (status) => {
    if (sensitive) return;
    const values = capture();
    const text = pick
      ? [control.value, ...(control.selectedItems || []).map((i) => i.label)]
          .filter(Boolean)
          .join("\n")
          .slice(0, 65536)
      : questionDraftText(fields, values);
    await store.saveQuestion(key, {
      id,
      digest,
      sessionId: String(sessionId),
      requestId: String(request.id || ""),
      title: question.slice(0, 1024),
      fields: values,
      text,
      status,
    });
  };
  const failure = () => {
    control.validationMessage =
      "The answer draft could not be saved. Keep this dialog open and try again.";
  };
  if (recoveryFailed) failure();
  return new Promise((resolve) => {
    const subscriptions = [];
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      for (const subscription of subscriptions) subscription.dispose();
      control.dispose();
      resolve(answer);
    };
    const update = () => {
      if (!settling && !settled) save("draft").catch(failure);
    };
    subscriptions.push(control.onDidChangeValue(update));
    if (pick) subscriptions.push(control.onDidChangeSelection(update));
    subscriptions.push(
      control.onDidAccept(async () => {
        if (settling || settled) return;
        if (pick && !control.canSelectMany && !control.selectedItems?.length)
          return;
        settling = true;
        control.enabled = false;
        const answer = pick
          ? control.canSelectMany
            ? control.selectedItems.map((i) => i.value)
            : control.selectedItems[0].value
          : control.value;
        try {
          await save("archived");
          finish(answer);
        } catch {
          settling = false;
          control.enabled = true;
          failure();
          if (hidden) {
            vscode.window.showWarningMessage?.(
              "The question draft could not be saved; no answer was submitted.",
            );
            finish(null);
          }
        }
      }),
    );
    subscriptions.push(
      control.onDidHide(async () => {
        hidden = true;
        if (settling || settled) return;
        settling = true;
        try {
          await save("archived");
        } catch {
          vscode.window.showWarningMessage?.(
            "The canceled question draft could not be saved.",
          );
        }
        finish(null);
      }),
    );
    control.show();
  });
}

module.exports = { answerAppServerQuestion };
