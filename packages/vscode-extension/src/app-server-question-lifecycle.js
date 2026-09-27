"use strict";

const { questionIdentity } = require("./chat/question-draft-contract");

/** Native callbacks are proposals. Only the owning server's notification confirms resolution. */
class NativeQuestionLifecycle {
  constructor({ answer, changed = () => {}, timeoutMs = 120_000 } = {}) {
    this.answer = answer;
    this.changed = changed;
    this.timeoutMs = timeoutMs;
    this.entries = [];
  }
  get status() {
    return this.entries.map((entry) => ({
      questionId: entry.request.id,
      threadId: entry.threadId,
      turnId: entry.turnId,
      state: entry.state,
      reason: entry.reason,
    }));
  }
  update(entry, state, reason) {
    entry.state = state;
    entry.reason = reason;
    this.changed({ questionId: entry.request.id, state, reason });
  }
  revoke(entry, reason, resolved = false) {
    if (["resolved", "unknown"].includes(entry.state)) return;
    clearTimeout(entry.timer);
    this.update(entry, resolved ? "resolved" : "unknown", reason);
    entry.controller.abort();
  }
  async review(owner, request) {
    const threadId = request.threadId || request.binding?.sessionId || null;
    const turnId = request.turnId || request.binding?.turnId || null;
    const digest = questionIdentity(threadId || "", request);
    // After this synchronous snapshot, mutable caller objects cannot redirect an answer.
    const serialized = JSON.stringify(request);
    if (Buffer.byteLength(serialized) > 128 * 1024)
      throw new Error("Question exceeds native review limits");
    request = JSON.parse(serialized);
    for (const entry of this.entries) {
      if (
        entry.owner !== owner ||
        entry.request.id !== request.id ||
        entry.threadId !== threadId ||
        entry.turnId !== turnId
      )
        continue;
      if (entry.digest === digest)
        return entry.state === "reviewing" ? entry.promise : null;
      this.revoke(entry, "Question content changed; review saved fields");
    }
    // Retain terminal IDs within an owner generation; replay must not reopen old authority.
    this.entries = this.entries.filter(
      (entry) => entry.owner === owner || !entry.controller.signal.aborted,
    );
    if (this.entries.length >= 256)
      throw new Error(
        "Native question history limit reached; restart App Server",
      );
    const entry = {
      owner,
      request,
      threadId,
      turnId,
      digest,
      controller: new AbortController(),
      state: "reviewing",
      reason: "Review required",
    };
    this.entries.push(entry);
    const expires = Date.parse(request.expiresAt);
    const delay = Number.isFinite(expires)
      ? Math.max(0, Math.min(this.timeoutMs, expires - Date.now()))
      : this.timeoutMs;
    if (!delay) {
      this.revoke(entry, "Question expired");
      return null;
    }
    entry.timer = setTimeout(
      () => this.revoke(entry, "Question expired; no resolution confirmed"),
      delay,
    );
    entry.timer.unref?.();
    this.update(entry, "reviewing", "Review required");
    entry.promise = Promise.resolve().then(async () => {
      if (entry.controller.signal.aborted) return null;
      try {
        const answer = await this.answer(request, {
          signal: entry.controller.signal,
        });
        if (entry.controller.signal.aborted) return null;
        this.update(entry, "awaiting", "Waiting for server confirmation");
        return answer ?? null;
      } catch {
        this.revoke(entry, "Question review failed; acceptance is unknown");
        return null;
      }
    });
    return entry.promise;
  }
  notification(owner, notification) {
    const value = notification?.params;
    if (!value || typeof value !== "object") return;
    if (notification.method === "question/resolved") {
      const matches = this.entries.filter(
        (entry) =>
          entry.owner === owner &&
          entry.request.id === value.questionId &&
          entry.threadId === value.threadId &&
          entry.turnId === value.turnId,
      );
      if (matches.length !== 1) {
        for (const entry of matches)
          this.revoke(
            entry,
            "Reused question ID; resolution cannot be confirmed",
          );
      } else {
        const entry = matches[0];
        // A late authoritative resolution can settle a previously unknown delivery.
        clearTimeout(entry.timer);
        this.update(
          entry,
          "resolved",
          `Server resolved question (${String(value.via || "unknown")})`,
        );
        entry.controller.abort();
      }
    } else if (notification.method === "turn/completed") {
      const turn = value.turn || value;
      for (const entry of this.entries)
        if (
          entry.owner === owner &&
          entry.threadId === turn.threadId &&
          entry.turnId === turn.id &&
          entry.request.blocking !== false &&
          entry.request.mode !== "deferred"
        )
          this.revoke(
            entry,
            "Turn completed without a matching question resolution",
          );
    }
  }
  interrupt(owner, { threadId, turnId } = {}) {
    for (const entry of this.entries)
      if (
        entry.owner === owner &&
        entry.threadId === threadId &&
        (!turnId || entry.turnId === turnId)
      )
        this.revoke(entry, "Turn interrupted; saved fields require review");
  }
  close(owner, reason = "App Server stopped; saved fields require review") {
    for (const entry of this.entries)
      if (entry.owner === owner) this.revoke(entry, reason);
  }
}

module.exports = { NativeQuestionLifecycle };
