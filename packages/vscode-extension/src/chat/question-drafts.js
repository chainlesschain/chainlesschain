const crypto = require("crypto");
const {
  questionIdentity,
  questionFields,
  normalizeQuestionFields,
  questionDraftText,
} = require("./question-draft-contract");

/** Live authority stays in this host. Disk records are editable recovery data. */
class QuestionDrafts {
  constructor({ store, getConversation, post, refresh }) {
    Object.assign(this, { store, getConversation, post, refresh });
    this.requests = new Map();
  }

  register(conv, request) {
    let digest, fields, recoveryError;
    try {
      digest = questionIdentity(conv.sessionId, request);
      fields = questionFields(request);
      if (fields.length > 128)
        throw new Error("Question has more than 128 draft fields");
    } catch (error) {
      recoveryError = error.message;
      digest = crypto.randomBytes(32).toString("hex");
      fields = [];
    }
    for (const entry of this.requests.values()) {
      if (
        entry.conv === conv &&
        entry.request.id === request.id &&
        entry.state !== "archived"
      ) {
        if (entry.digest === digest && this.live(entry)) return entry.request;
        this.archive(entry, "Question replaced");
      }
    }
    // Only archived instances may be evicted. Never silently lose a live request.
    if (this.requests.size >= 256) {
      const old = [...this.requests.values()].find(
        (r) => r.state === "archived",
      );
      if (old) this.requests.delete(old.instance);
      else throw new Error("Too many pending questions");
    }
    const instance = crypto.randomUUID();
    const entry = {
      conv,
      session: conv.session,
      token: conv._sessionToken,
      key: conv.draftKey,
      sessionId: conv.sessionId || "",
      instance,
      recordId: instance,
      digest,
      fields,
      state: "draft",
      revision: -1,
      recoveryError,
    };
    entry.request = {
      ...request,
      convId: conv.id,
      draftKey: entry.key,
      questionInstance: instance,
      questionKey: digest,
      draftFields: fields,
      draftStorage: !!this.store && !recoveryError,
      questionState: "draft",
      ...(recoveryError ? { recoveryError } : {}),
    };
    this.requests.set(instance, entry);
    return entry.request;
  }

  match(message) {
    const r = this.requests.get(message.questionInstance);
    return r &&
      r.conv.id === message.convId &&
      r.key === message.draftKey &&
      r.digest === message.questionKey &&
      r.request.id === message.id
      ? r
      : null;
  }

  live(r) {
    return (
      r.state !== "archived" &&
      this.getConversation(r.conv.id) === r.conv &&
      r.conv.session === r.session &&
      r.conv._sessionToken === r.token &&
      r.conv.draftKey === r.key &&
      (r.conv.sessionId || "") === r.sessionId
    );
  }

  message(r, kind, extra = {}) {
    this.post({
      kind,
      convId: r.conv.id,
      draftKey: r.key,
      id: r.request.id,
      questionInstance: r.instance,
      questionKey: r.digest,
      ...extra,
    });
  }

  async load(r) {
    if (!this.store || r.recoveryError) return [];
    if (!r.loading)
      r.loading = (async () => {
        const saved = await this.store.view(r.key, { includeComposer: false });
        const binding = r.request.binding;
        // Legacy unbound requests can only recover in the original live instance.
        const bound =
          binding?.sessionId === r.sessionId &&
          typeof binding?.turnId === "string" &&
          binding.turnId &&
          typeof binding?.toolUseId === "string" &&
          binding.toolUseId &&
          Number.isSafeInteger(binding?.sequence);
        const prior = saved.questions.find(
          (q) =>
            q.digest === r.digest &&
            q.sessionId === r.sessionId &&
            q.requestId === r.request.id &&
            q.status === "draft" &&
            (q.id === r.recordId || bound),
        );
        if (prior && this.live(r) && r.revision < 0) {
          r.recordId = prior.id;
          r.values = normalizeQuestionFields(r.fields, prior.fields);
        }
        return r.values || [];
      })().catch((error) => {
        r.loading = null;
        throw error;
      });
    await r.loading;
    return r.values || [];
  }

  async restore(message) {
    const r = this.match(message);
    if (!r || !this.live(r)) return;
    try {
      const values = await this.load(r);
      if (this.live(r))
        this.message(r, "questionDraftSnapshot", {
          fields: values,
          state: r.state,
        });
    } catch (error) {
      this.message(r, "questionDraftError", { text: error.message });
    }
  }

  async save(message) {
    const r = this.match(message);
    if (!r || !this.store || r.recoveryError) return;
    const values = normalizeQuestionFields(r.fields, message.fields || []);
    if (!Number.isSafeInteger(message.revision) || message.revision < 0)
      throw new Error("Invalid question draft revision");
    await this.load(r);
    r.revision++;
    r.values = values;
    await this.store.saveQuestion(r.key, {
      id: r.recordId,
      digest: r.digest,
      sessionId: r.sessionId,
      requestId: r.request.id,
      title: String(r.request.question || "Question").slice(0, 1024),
      fields: values,
      text: questionDraftText(r.fields, values),
      status: r.state === "draft" && this.live(r) ? "draft" : "archived",
    });
  }

  archive(r, reason) {
    if (r.state === "archived") return;
    r.state = "archived";
    r.request.questionState = "archived";
    this.message(r, "questionState", { state: "archived", text: reason });
    if (this.store)
      this.store
        .archiveQuestion(r.key, r.recordId, r.digest)
        .then(() => this.refresh(r.conv))
        .catch((error) =>
          this.message(r, "questionDraftError", { text: error.message }),
        );
  }

  rejected(conv, id, reason) {
    for (const r of this.requests.values()) {
      if (
        r.conv !== conv ||
        r.request.id !== id ||
        !this.live(r) ||
        !["saving", "pending"].includes(r.state)
      )
        continue;
      r.state = "unknown";
      r.request.questionState = "unknown";
      this.message(r, "questionState", {
        state: "unknown",
        text:
          "Agent rejected the response: " +
          String(reason || "unknown reason").slice(0, 256) +
          ". Saved text remains available.",
      });
    }
  }

  archiveConversation(
    conv,
    {
      blockingOnly = false,
      id = null,
      reason = "Question closed; saved text remains editable",
    } = {},
  ) {
    for (const r of this.requests.values())
      if (
        r.conv === conv &&
        (!id || r.request.id === id) &&
        (!blockingOnly || r.request.blocking !== false)
      )
        this.archive(r, reason);
  }

  async answer(message, openUrl) {
    const r = this.match(message);
    if (!r || !this.live(r) || r.state !== "draft" || !r.session?.running)
      return;
    // Reserve before the first await. A second click must never dispatch again.
    r.state = "saving";
    r.request.questionState = "saving";
    this.message(r, "questionState", {
      state: "saving",
      text: "Saving answer…",
    });
    try {
      await this.save(message);
    } catch (error) {
      if (this.live(r)) {
        r.state = "draft";
        r.request.questionState = "draft";
        this.message(r, "questionState", {
          state: "draft",
          text: `Answer was not sent: ${error.message}`,
        });
      }
      return;
    }
    if (!this.live(r) || r.state !== "saving") return;
    let answer = message.answer === undefined ? null : message.answer;
    if (openUrl) {
      // Use the reviewed host-owned URL, never a URL supplied by the Webview.
      try {
        const target = new URL(r.request.url);
        if (
          r.request.mode !== "url" ||
          !r.request.elicitation ||
          target.protocol !== "https:" ||
          !target.hostname ||
          target.username ||
          target.password
        )
          throw new Error("unsafe URL");
        answer = (await openUrl(target.href)) === false ? null : {};
      } catch {
        answer = null;
      }
      if (!this.live(r) || r.state !== "saving") return;
    }
    r.state = "pending";
    r.request.questionState = "pending";
    try {
      const sent = r.session.sendEvent({
        type: "answer",
        id: r.request.id,
        answer,
        ...(r.request.binding ? { binding: r.request.binding } : {}),
      });
      if (sent === false) throw new Error("Agent pipe unavailable");
      if (this.live(r) && r.state === "pending")
        this.message(r, "questionState", {
          state: "pending",
          text: "Submitted; waiting for agent confirmation",
        });
    } catch {
      if (this.live(r)) {
        r.state = "unknown";
        r.request.questionState = "unknown";
        this.message(r, "questionState", {
          state: "unknown",
          text: "Delivery is unknown. Saved text is available; no automatic retry.",
        });
      }
    }
    this.refresh(r.conv);
  }
}
module.exports = { QuestionDrafts };
