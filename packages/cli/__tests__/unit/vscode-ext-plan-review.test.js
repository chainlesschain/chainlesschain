import { describe, expect, it } from "vitest";

import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import {
  buildPlanReviewFeedbackPrompt,
  buildPlanReviewRecord,
  formatPlanReviewMarkdown,
  trimReviewSnapshot,
} from "../../../vscode-extension/src/chat/plan-review.js";

describe("VS Code plan review markdown", () => {
  it("renders a complete editable markdown review document", () => {
    const md = formatPlanReviewMarkdown(
      {
        state: "awaiting_approval",
        risk: { level: "medium", totalScore: 3 },
        items: [
          {
            id: "p1",
            title: "Update chat-view.js",
            tool: "edit_file",
            impact: "medium",
            status: "pending",
          },
        ],
      },
      {
        conversationTitle: "Plan work",
        sessionId: "sess-1",
        updatedAt: new Date("2026-07-10T00:00:00.000Z"),
      },
    );
    expect(md).toContain("# ChainlessChain Plan Review");
    expect(md).toContain("Conversation: Plan work");
    expect(md).toContain("Session: sess-1");
    expect(md).toContain("ChainlessChain: Approve Plan Review");
    expect(md).toContain("edit_file: Update chat-view.js");
    expect(md).toContain("## Reviewer Notes");
  });

  it("trims snapshots and builds feedback prompts", () => {
    const long = "x".repeat(25000);
    expect(trimReviewSnapshot(long)).toContain("review snapshot truncated");
    const prompt = buildPlanReviewFeedbackPrompt("requestChanges", "# Notes");
    expect(prompt).toContain("Revise the plan");
    expect(prompt).toContain("# Notes");
  });

  it("builds compact audit records", () => {
    const rec = buildPlanReviewRecord({
      action: "approve",
      documentText: "# Review",
      conversationId: "conv-1",
      conversationTitle: "Chat",
      sessionId: "sess-1",
      plan: { state: "awaiting_approval", items: [{ title: "one" }] },
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(rec).toMatchObject({
      action: "approve",
      reviewedAt: "2026-07-10T00:00:00.000Z",
      conversationId: "conv-1",
      sessionId: "sess-1",
      itemCount: 1,
      snapshot: "# Review",
    });
  });
});

function makeMemento() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => {
      m.set(k, v);
    },
    _map: m,
  };
}

function makeProvider() {
  const posted = [];
  const sessions = [];
  const uri = { toString: () => "untitled:plan-review" };
  const document = {
    uri,
    getText: () => "# Review\n\n- approve this plan",
  };
  const vscode = {
    commands: { executeCommand() {} },
    window: { activeTextEditor: { document } },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const createSession = (cfg) => {
    const s = {
      cfg,
      running: true,
      sent: [],
      send(text) {
        this.sent.push({ type: "user", text });
        return true;
      },
      sendEvent(event) {
        this.sent.push(event);
        return true;
      },
      stop() {
        this.running = false;
      },
    };
    sessions.push(s);
    return s;
  };
  const state = makeMemento();
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession },
    state,
  });
  provider.view = {
    webview: { postMessage: (m) => (posted.push(m), Promise.resolve()) },
  };
  provider._handleMessage({ type: "send", text: "prepare a plan" });
  const conv = provider._activeConv();
  conv.plan = {
    kind: "plan",
    active: true,
    state: "awaiting_approval",
    items: [{ title: "Edit file", tool: "edit_file" }],
  };
  provider._planReviews.set(conv.id, {
    document,
    lastText: document.getText(),
    lastPlan: conv.plan,
  });
  return { provider, posted, sessions, state };
}

describe("ChatViewProvider plan review actions", () => {
  it("approves from the active review editor and records the snapshot", async () => {
    const { provider, sessions, state } = makeProvider();
    const ok = await provider.reviewPlan("approve");
    expect(ok).toBe(true);
    expect(sessions[0].sent.at(-1)).toMatchObject({
      type: "plan",
      action: "approve",
      review: {
        action: "approve",
        snapshot: expect.stringContaining("# Review"),
      },
    });
    expect(state._map.get("chainlesschain.chat.planReviews")).toHaveLength(1);
  });

  it("sends reviewer notes back as a revision prompt", async () => {
    const { provider, sessions } = makeProvider();
    const ok = await provider.reviewPlan("requestChanges");
    expect(ok).toBe(true);
    expect(sessions[0].sent.at(-1)).toMatchObject({
      type: "user",
      text: expect.stringContaining("Revise the plan"),
    });
    expect(sessions[0].sent.at(-1).text).toContain("# Review");
  });
});
