/** Embedded verbatim in the Webview; no Node or VS Code host dependencies. */
function createQuestionForms({ document, vscode }) {
  const forms = new Map();
  const backup = vscode.getState?.()?.questionDrafts || [];

  function identity(m) {
    return {
      convId: m.convId,
      draftKey: m.draftKey,
      id: m.id,
      questionInstance: m.questionInstance,
      questionKey: m.questionKey,
    };
  }
  function remember() {
    const saved = [...forms.values()]
      .filter((f) => f.dirty && f.m.draftStorage)
      .slice(-16)
      .map((f) => ({ ...identity(f.m), fields: f.fields }));
    while (JSON.stringify(saved).length > 65536) saved.shift();
    vscode.setState?.({ ...vscode.getState?.(), questionDrafts: saved });
  }
  function state(f, value, text) {
    f.state = value;
    for (const control of f.card.querySelectorAll(
      "input,select,textarea,button",
    ))
      control.disabled = value !== "draft";
    f.card.className = value === "archived" ? "approval done" : "approval";
    f.note.textContent =
      text ||
      {
        draft: "",
        saving: "Saving answer…",
        pending: "Submitted; waiting for agent confirmation",
        unknown: "Delivery is unknown; no automatic retry.",
        archived: "Question closed; saved text remains editable",
      }[value] ||
      "";
  }
  function restore(f, fields) {
    const values = new Map(fields.map((v) => [v.key, v.value]));
    f.controls.forEach((control, index) => {
      const d = f.m.draftFields?.[index];
      if (!d || d.kind === "password" || !values.has(d.key)) return;
      const value = values.get(d.key);
      if (d.kind === "checkbox" && typeof value === "boolean")
        control.checked = value;
      else if (typeof value === "string") control.value = value;
    });
  }
  function capture(f) {
    return f.controls.flatMap((control, index) => {
      const d = f.m.draftFields?.[index];
      return !d || d.kind === "password"
        ? []
        : [
            {
              key: d.key,
              value: d.kind === "checkbox" ? control.checked : control.value,
            },
          ];
    });
  }
  function update(f) {
    f.fields = capture(f);
    f.revision++;
    f.dirty = true;
    remember();
    if (f.m.draftStorage)
      vscode.postMessage({
        type: "questionDraftUpdate",
        ...identity(f.m),
        fields: f.fields,
        revision: f.revision,
      });
  }
  function attach(card, m) {
    const prior = forms.get(m.questionInstance);
    const f = {
      m,
      card,
      controls: [...card.querySelectorAll("input,select,textarea")],
      fields: [],
      revision: 0,
      dirty: false,
    };
    f.note = document.createElement("div");
    f.note.className = "info";
    f.note.setAttribute("aria-live", "polite");
    card.appendChild(f.note);
    forms.set(m.questionInstance, f);
    if (forms.size > 128) {
      for (const [key, form] of forms) {
        if (!form.card.isConnected && key !== m.questionInstance)
          forms.delete(key);
        if (forms.size <= 128) break;
      }
    }
    const local = prior?.dirty
      ? prior
      : backup.find(
          (b) =>
            b.questionInstance === m.questionInstance &&
            b.questionKey === m.questionKey &&
            b.draftKey === m.draftKey &&
            b.convId === m.convId,
        );
    if (local && m.questionState === "draft") {
      restore(f, local.fields);
      update(f);
    }
    state(
      f,
      m.questionState || "draft",
      m.recoveryError
        ? "Question draft recovery unavailable: " + m.recoveryError
        : "",
    );
    for (const control of f.controls) {
      control.addEventListener("input", () => {
        if (f.state === "draft") update(f);
      });
      control.addEventListener("change", () => {
        if (f.state === "draft") update(f);
      });
    }
    if (m.draftStorage)
      vscode.postMessage({ type: "questionDraftLoad", ...identity(m) });
    return f;
  }
  function submit(card, m, type, answer) {
    const f = forms.get(m.questionInstance);
    if (!f || f.card !== card || f.state !== "draft") return;
    const fields = capture(f);
    state(f, "saving");
    vscode.postMessage({
      type,
      ...identity(m),
      answer,
      fields,
      revision: ++f.revision,
    });
  }
  function receive(m) {
    if (
      ![
        "questionDraftSnapshot",
        "questionDraftError",
        "questionState",
      ].includes(m.kind)
    )
      return false;
    const f = forms.get(m.questionInstance);
    if (
      !f ||
      f.m.questionKey !== m.questionKey ||
      f.m.draftKey !== m.draftKey ||
      f.m.convId !== m.convId
    )
      return true;
    if (m.kind === "questionDraftSnapshot") {
      if (f.state === "draft" && m.state === "draft")
        restore(f, m.fields || []);
      // A reload must preserve the host's pending/unknown response reservation.
      if (m.state !== "draft") state(f, m.state);
    } else if (m.kind === "questionState") state(f, m.state, m.text);
    else f.note.textContent = "Draft could not be saved: " + m.text;
    return true;
  }
  return { attach, submit, receive };
}
module.exports = { createQuestionForms };
