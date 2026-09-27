"use strict";

const crypto = require("crypto");
const core = require("./vendor/elicitation-schema");
const {
  questionIdentity,
  questionFields,
  normalizeQuestionFields,
  questionDraftText,
} = require("./chat/question-draft-contract");

function completeBinding(request) {
  const binding = request.binding;
  return !!(
    binding &&
    Object.hasOwn(binding, "backgroundAgentId") &&
    (binding.backgroundAgentId === null ||
      typeof binding.backgroundAgentId === "string") &&
    typeof binding.sessionId === "string" &&
    binding.sessionId &&
    typeof binding.turnId === "string" &&
    binding.turnId &&
    typeof binding.toolUseId === "string" &&
    binding.toolUseId &&
    Number.isSafeInteger(binding.sequence) &&
    binding.sequence > 0
  );
}

/** Dispose listeners before disposing a QuickInput: disposal can itself emit Hide. */
function nativeControl(vscode, options, { signal, change, accept } = {}) {
  if (signal?.aborted) return Promise.resolve({ action: "aborted" });
  const pick = options.items != null;
  const control = pick
    ? vscode.window.createQuickPick()
    : vscode.window.createInputBox();
  Object.assign(control, options);
  return new Promise((resolve) => {
    let settled = false,
      accepting = false,
      hidden = false;
    const listeners = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      for (const listener of listeners) listener.dispose();
      control.dispose();
      resolve(result);
    };
    const abort = () => finish({ action: "aborted" });
    const update = () => {
      if (settled || accepting) return;
      try {
        change?.(control);
      } catch (error) {
        control.validationMessage = error.message;
      }
    };
    listeners.push(control.onDidChangeValue(update));
    if (pick) listeners.push(control.onDidChangeSelection(update));
    if (options.buttons?.length && control.onDidTriggerButton) {
      listeners.push(
        control.onDidTriggerButton(() => {
          if (!accepting) finish({ action: "back" });
        }),
      );
    }
    listeners.push(
      control.onDidAccept(async () => {
        if (settled || accepting || signal?.aborted) return;
        if (pick && !control.canSelectMany && !control.selectedItems?.length)
          return;
        accepting = true;
        control.enabled = false;
        try {
          const value = accept
            ? await accept(control)
            : control.selectedItems?.[0];
          if (signal?.aborted) finish({ action: "aborted" });
          else finish({ action: "accept", value });
        } catch (error) {
          accepting = false;
          control.enabled = true;
          control.validationMessage =
            error.message || "The answer could not be saved";
          if (hidden) finish({ action: "cancel" });
        }
      }),
    );
    listeners.push(
      control.onDidHide(() => {
        hidden = true;
        if (!accepting) finish({ action: "cancel" });
      }),
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else control.show();
  });
}

class FormDraft {
  constructor(request, store, descriptors) {
    this.request = request;
    this.store = store;
    this.descriptors = descriptors;
    this.sessionId =
      request.binding?.sessionId || request.sessionId || request.threadId || "";
    this.digest = crypto
      .createHash("sha256")
      .update("native-form-v1:" + questionIdentity(this.sessionId, request))
      .digest("hex");
    const group = crypto
      .createHash("sha256")
      .update("native-question:" + this.sessionId)
      .digest("hex")
      .slice(0, 32);
    this.key = [
      group.slice(0, 8),
      group.slice(8, 12),
      group.slice(12, 16),
      group.slice(16, 20),
      group.slice(20),
    ].join("-");
    this.id = crypto.randomUUID();
    this.values = [];
    this.loaded = !store;
    this.edited = false;
    this.archived = false;
    this.error = null;
  }
  async load() {
    if (this.loaded) return;
    try {
      const record = await this.store.view(this.key, {
        includeComposer: false,
      });
      const prior =
        completeBinding(this.request) &&
        record.questions.find(
          (q) =>
            q.digest === this.digest &&
            q.status === "draft" &&
            q.sessionId === this.sessionId &&
            q.requestId === String(this.request.id || ""),
        );
      if (prior) {
        const values = normalizeQuestionFields(this.descriptors, prior.fields);
        this.id = prior.id;
        if (!this.edited) this.values = values;
      }
      this.loaded = true;
      this.error = null;
    } catch (error) {
      this.error = error;
      throw error;
    }
  }
  capture(raw) {
    const values = [];
    for (const descriptor of this.descriptors) {
      if (descriptor.kind === "password") continue;
      const [name, option] = JSON.parse(descriptor.key);
      const value = raw[name];
      if (value == null) continue;
      values.push({
        key: descriptor.key,
        value:
          descriptor.kind === "checkbox"
            ? option == null
              ? value === true
              : Array.isArray(value) && value.includes(option)
            : String(value),
      });
    }
    this.values = normalizeQuestionFields(this.descriptors, values);
    this.edited = true;
  }
  restore(raw, model) {
    const values = new Map(
      this.values.map((field) => [field.key, field.value]),
    );
    for (const field of model.fields) {
      if (field.kind === "multi-select") {
        if (
          field.options.some((o) =>
            values.has(JSON.stringify([field.name, o.value])),
          )
        )
          raw[field.name] = field.options
            .filter(
              (o) => values.get(JSON.stringify([field.name, o.value])) === true,
            )
            .map((o) => o.value);
      } else if (values.has(JSON.stringify([field.name])))
        raw[field.name] = values.get(JSON.stringify([field.name]));
    }
  }
  async save(archive = false) {
    this.archived ||= archive;
    if (!this.store) return;
    await this.load(); // A failed read must never silently replace an older draft.
    await this.store.saveQuestion(this.key, {
      id: this.id,
      digest: this.digest,
      sessionId: String(this.sessionId),
      requestId: String(this.request.id || ""),
      title: String(this.request.question || "MCP form").slice(0, 1024),
      fields: this.values,
      text: questionDraftText(this.descriptors, this.values),
      status: this.archived ? "archived" : "draft",
    });
    this.error = null;
  }
}

function fieldError(model, field, value) {
  const result = core.prepareElicitationSubmission(
    { ...model, fields: [field] },
    { [field.name]: value },
  );
  return result.valid
    ? null
    : result.errors.map((issue) => issue.message).join("; ");
}

async function answerNativeElicitation(
  vscode,
  request,
  { store = null, signal } = {},
) {
  // Identity validation bounds the schema before compilation or native control allocation.
  questionIdentity(
    request.binding?.sessionId || request.threadId || "",
    request,
  );
  const metadata = request.metadata || {};
  const schema = request.requestedSchema || metadata.requestedSchema;
  if (request.mode === "url" || metadata.mode === "url") {
    if (signal?.aborted) return null;
    const target = new URL(request.url || metadata.url);
    if (
      target.protocol !== "https:" ||
      !target.hostname ||
      target.username ||
      target.password
    )
      throw new Error("The MCP server supplied an unsafe URL");
    const action = await vscode.window.showWarningMessage(
      "MCP external action",
      {
        modal: true,
        detail: `${request.question || ""}\nServer: ${request.server || metadata.server || "MCP"}\nHost: ${target.host}\nURL: ${target.href}`,
      },
      "Open secure page",
    );
    if (action !== "Open secure page" || signal?.aborted) return null;
    const opened = await vscode.env.openExternal(vscode.Uri.parse(target.href));
    return opened && !signal?.aborted ? {} : null;
  }
  const model = core.compileElicitationSchema(schema);
  const title = `MCP: ${String(request.server || metadata.server || "Agent question").slice(0, 100)}`;
  const common = {
    title,
    ignoreFocusOut: request.blocking !== false,
    enabled: true,
  };
  if (!model.supported) {
    const result = await nativeControl(
      vscode,
      {
        ...common,
        prompt:
          "Unsupported schema: enter a JSON object. This input is not saved.",
        value: "",
      },
      {
        signal,
        accept(control) {
          if (Buffer.byteLength(control.value) > 65536)
            throw new Error("JSON answer exceeds 64 KiB");
          let value;
          try {
            value = JSON.parse(control.value);
          } catch {
            throw new Error("Enter a valid JSON object");
          }
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Enter a JSON object");
          return value;
        },
      },
    );
    return result.action === "accept" ? result.value : null;
  }
  const descriptors = questionFields(request);
  normalizeQuestionFields(descriptors, []); // Enforce the field count before rendering.
  const draft = new FormDraft(request, store, descriptors);
  const raw = core.initialElicitationValues(model);
  try {
    await draft.load();
    draft.restore(raw, model);
  } catch {
    /* Keep recovery failure visible and retry before saving. */
  }
  if (signal?.aborted) return null;
  let timer = null,
    visible = null,
    submissionSave = null,
    submitted = false;
  const reportFailure = (error) => {
    draft.error = error;
    if (visible)
      visible.validationMessage = `Draft not saved: ${error.message}`;
  };
  const changed = (control) => {
    visible = control;
    draft.capture(raw);
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      draft.save().catch(reportFailure);
    }, 250);
  };
  try {
    while (!signal?.aborted) {
      const items = model.fields.map((field, index) => {
        const secret =
          schema.properties?.[field.name]?.writeOnly === true ||
          schema.properties?.[field.name]?.format === "password";
        const value = raw[field.name];
        return {
          label: `${field.title}${field.required ? " *" : ""}`,
          index,
          description: secret
            ? value == null || value === ""
              ? "Not set · not saved"
              : "Set · not saved"
            : value == null
              ? "Not set"
              : String(Array.isArray(value) ? value.join(", ") : value).slice(
                  0,
                  120,
                ),
          detail:
            fieldError(model, field, value) ||
            field.description ||
            "Edit field",
        };
      });
      items.push(
        { label: "Submit answer", action: "submit" },
        { label: "Cancel question", action: "cancel" },
      );
      const selected = await nativeControl(
        vscode,
        {
          ...common,
          items,
          canSelectMany: false,
          selectedItems: [],
          placeholder: draft.error
            ? `Draft not saved: ${draft.error.message}`
            : String(request.question || "Review fields, then submit").slice(
                0,
                16384,
              ),
        },
        {
          signal,
          async accept(control) {
            const item = control.selectedItems[0];
            if (!items.includes(item))
              throw new Error("Select an available field or action");
            if (item.action === "submit") {
              const result = core.prepareElicitationSubmission(model, raw);
              if (!result.valid)
                throw new Error(result.errors.map((e) => e.message).join("; "));
              draft.capture(raw);
              clearTimeout(timer);
              timer = null;
              submissionSave = draft.save(true);
              await submissionSave;
              submitted = true;
              return { action: "submit", answer: result.value };
            }
            return item;
          },
        },
      );
      if (selected.action !== "accept" || selected.value.action === "cancel")
        return null;
      if (selected.value.action === "submit")
        return signal?.aborted ? null : selected.value.answer;
      const field = model.fields[selected.value.index];
      const pick = ["boolean", "single-select", "multi-select"].includes(
        field.kind,
      );
      const choices =
        field.kind === "boolean"
          ? [
              { label: "Yes", value: true },
              { label: "No", value: false },
            ]
          : (field.options || []).map((option) => ({
              label: option.label,
              value: option.value,
            }));
      if (field.kind === "single-select" && !field.required)
        choices.unshift({ label: "Not set", value: "" });
      const multiple = field.kind === "multi-select";
      const read = (control) =>
        pick
          ? multiple
            ? control.selectedItems
                .filter((i) => choices.includes(i))
                .map((i) => i.value)
            : control.selectedItems[0]?.value
          : control.value;
      const secret =
        schema.properties?.[field.name]?.writeOnly === true ||
        schema.properties?.[field.name]?.format === "password";
      const options = {
        ...common,
        title: `${title} · ${field.title}`,
        buttons: vscode.QuickInputButtons?.Back
          ? [vscode.QuickInputButtons.Back]
          : [],
        ...(pick
          ? {
              items: choices,
              canSelectMany: multiple,
              selectedItems: choices.filter((i) =>
                multiple
                  ? raw[field.name]?.includes(i.value)
                  : raw[field.name] === i.value,
              ),
              placeholder: field.description || field.title,
            }
          : {
              value: raw[field.name] == null ? "" : String(raw[field.name]),
              password: secret,
              prompt: field.description || field.title,
            }),
      };
      const result = await nativeControl(vscode, options, {
        signal,
        change(control) {
          raw[field.name] = read(control);
          changed(control);
        },
        async accept(control) {
          raw[field.name] = read(control);
          const error = fieldError(model, field, raw[field.name]);
          if (error) throw new Error(error);
          draft.capture(raw);
          clearTimeout(timer);
          timer = null;
          await draft.save();
        },
      });
      visible = null;
      if (!["accept", "back"].includes(result.action)) return null;
    }
    return null;
  } finally {
    clearTimeout(timer);
    // A request can expire while Submit awaits I/O. Join that exact write;
    // starting a second archive would race cleanup and obscure its outcome.
    if (submissionSave) {
      try {
        await submissionSave;
        submitted = true;
      } catch {
        /* Report/retry archival below. */
      }
    }
    if (!submitted) {
      try {
        draft.capture(raw);
        await draft.save(true);
      } catch {
        vscode.window.showWarningMessage?.(
          "The question fields could not be saved. Recovery may be incomplete.",
        );
      }
    }
  }
}

module.exports = { answerNativeElicitation, completeBinding };
