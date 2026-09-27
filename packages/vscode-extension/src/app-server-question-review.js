"use strict";
const crypto = require("crypto");
const {
  answerNativeElicitation,
  completeBinding,
} = require("./app-server-elicitation-review");
const {
  questionIdentity,
  normalizeQuestionFields,
  questionDraftText,
} = require("./chat/question-draft-contract");

// VS Code QuickInput is a single visible surface. Serialize whole reviews, not
// individual fields, so another request cannot hide a partially edited form.
const nativeQueues = new WeakMap();
function queueReview(vscode, signal, run) {
  if (signal?.aborted) return Promise.resolve(null);
  let queue = nativeQueues.get(vscode);
  if (!queue) {
    queue = { active: false, waiting: [] };
    nativeQueues.set(vscode, queue);
  }
  if (queue.waiting.length >= 128)
    return Promise.reject(
      new Error("Too many native questions waiting for review"),
    );
  const pump = () => {
    if (queue.active) return;
    const entry = queue.waiting.shift();
    if (!entry) return;
    queue.active = true;
    entry.started = true;
    entry.signal?.removeEventListener("abort", entry.abort);
    Promise.resolve()
      .then(() => (entry.signal?.aborted ? null : entry.run()))
      .then(entry.resolve, entry.reject)
      .finally(() => {
        queue.active = false;
        pump();
      });
  };
  return new Promise((resolve, reject) => {
    const entry = { run, signal, resolve, reject, started: false };
    entry.abort = () => {
      if (entry.started) return;
      const index = queue.waiting.indexOf(entry);
      if (index >= 0) queue.waiting.splice(index, 1);
      signal.removeEventListener("abort", entry.abort);
      resolve(null);
    };
    queue.waiting.push(entry);
    signal?.addEventListener("abort", entry.abort, { once: true });
    if (signal?.aborted) entry.abort();
    pump();
  });
}

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
  { store = null, signal } = {},
) {
  if (signal?.aborted) return null;
  // Bound and detach the exact request before any UI await. Fields not used by
  // question review are deliberately outside the recovery/response contract.
  const snapshot = Object.fromEntries(
    [
      "id",
      "threadId",
      "turnId",
      "sessionId",
      "binding",
      "question",
      "options",
      "multiSelect",
      "mode",
      "blocking",
      "purpose",
      "contextRevision",
      "elicitation",
      "requestedSchema",
      "server",
      "url",
      "elicitationId",
      "password",
      "expiresAt",
    ]
      .filter((key) => request[key] !== undefined)
      .map((key) => [key, request[key]]),
  );
  if (request.metadata?.kind === "mcp_elicitation")
    snapshot.metadata = {
      kind: "mcp_elicitation",
      mode: request.metadata.mode,
      requestedSchema: request.metadata.requestedSchema,
      server: request.metadata.server,
      url: request.metadata.url,
      elicitationId: request.metadata.elicitationId,
    };
  questionIdentity(
    snapshot.binding?.sessionId ||
      snapshot.sessionId ||
      snapshot.threadId ||
      "",
    snapshot,
  );
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized) > 128 * 1024)
    throw new Error("Question is too large to review");
  request = JSON.parse(serialized);
  return queueReview(vscode, signal, () =>
    reviewQuestion(vscode, request, { store, signal }),
  );
}

async function reviewQuestion(vscode, request, { store, signal }) {
  if (signal?.aborted) return null;
  if (
    request.requestedSchema ||
    request.metadata?.kind === "mcp_elicitation" ||
    request.elicitation === true
  )
    return answerNativeElicitation(vscode, request, { store, signal });
  const question = String(request.question || "").slice(0, 16_384);
  const options = Array.isArray(request.options)
    ? request.options.slice(0, 128)
    : null;
  if (vscode.window.createInputBox && vscode.window.createQuickPick) {
    return persistentQuestion(vscode, request, {
      store,
      question,
      options,
      signal,
    });
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
    if (picked == null || signal?.aborted) return null;
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
    password: request.password === true,
  });
  return signal?.aborted ? null : (answer ?? null);
}

async function persistentQuestion(
  vscode,
  request,
  { store, question, options, signal },
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
  const sensitive = request.password === true;
  const fields = sensitive
    ? []
    : options?.length
      ? [
          { key: "filter", label: "Search", kind: "text" },
          { key: "selection", label: "Selected options", kind: "text" },
        ]
      : [{ key: "answer", label: "Answer", kind: "text" }];
  let recoveryFailed = false;
  const saved = store
    ? await store.view(key, { includeComposer: false }).catch(() => {
        recoveryFailed = true;
        return { questions: [] };
      })
    : { questions: [] };
  if (signal?.aborted) return null;
  const bound = completeBinding(request);
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
    if (sensitive || !store) return;
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
      signal?.removeEventListener("abort", abort);
      for (const subscription of subscriptions) subscription.dispose();
      control.dispose();
      resolve(answer);
    };
    const abort = () => {
      // Revoke UI authority synchronously; the best-effort archive is independent
      // of an old handler waiting on a blocked child or server timeout.
      settling = true;
      save("archived").catch(() =>
        vscode.window.showWarningMessage?.(
          "The expired question draft could not be saved.",
        ),
      );
      finish(null);
    };
    const update = () => {
      if (!settling && !settled) save("draft").catch(failure);
    };
    subscriptions.push(control.onDidChangeValue(update));
    if (pick) subscriptions.push(control.onDidChangeSelection(update));
    subscriptions.push(
      control.onDidAccept(async () => {
        if (settling || settled || signal?.aborted) return;
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
          finish(signal?.aborted ? null : answer);
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
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else control.show();
  });
}

module.exports = { answerAppServerQuestion };
