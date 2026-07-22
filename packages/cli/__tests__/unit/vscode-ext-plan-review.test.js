import { describe, expect, it } from "vitest";

import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import {
  buildPlanReviewFeedbackPrompt,
  buildPlanReviewRecord,
  buildPersistedPlanReview,
  extractPlanReviewComments,
  findPersistedPlanReview,
  formatPlanReviewMarkdown,
  mergePlanReviewProgress,
  normalizePersistedPlanReview,
  trimReviewSnapshot,
  upsertPersistedPlanReview,
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

  it("versions, bounds, replaces, and restores persisted review drafts", () => {
    const first = buildPersistedPlanReview({
      documentText: "# Review\n\nfirst comment",
      conversationId: "conv-1",
      conversationTitle: "Chat",
      sessionId: "sess-1",
      plan: {
        active: true,
        state: "awaiting_approval",
        items: [{ id: "p1", title: "Edit file", tool: "edit_file" }],
      },
      now: new Date("2026-07-22T00:00:00.000Z"),
    });
    const second = buildPersistedPlanReview({
      documentText: "# Review\n\nupdated comment",
      conversationId: "conv-new-after-restart",
      conversationTitle: "Chat",
      sessionId: "sess-1",
      plan: first.plan,
      previous: first,
      status: "changes_requested",
      action: "requestChanges",
      now: new Date("2026-07-22T00:01:00.000Z"),
    });
    expect(first).toMatchObject({
      schema: "cc-plan-review/v1",
      revision: 1,
      status: "draft",
    });
    expect(second).toMatchObject({
      revision: 2,
      status: "changes_requested",
      action: "requestChanges",
      snapshot: expect.stringContaining("updated comment"),
    });

    const list = upsertPersistedPlanReview([first], second);
    expect(list).toHaveLength(1);
    expect(findPersistedPlanReview(list, { sessionId: "sess-1" })).toEqual(
      second,
    );
    expect(normalizePersistedPlanReview({ schema: "unknown" })).toBe(null);
  });

  it("caps the persisted state list and plan payload", () => {
    let list = [];
    for (let i = 0; i < 25; i += 1) {
      list = upsertPersistedPlanReview(
        list,
        buildPersistedPlanReview({
          sessionId: `s-${i}`,
          documentText: "x".repeat(25000),
          plan: {
            active: true,
            items: Array.from({ length: 140 }, (_, n) => ({
              id: `p-${n}`,
              title: "t".repeat(600),
            })),
          },
        }),
      );
    }
    expect(list).toHaveLength(20);
    expect(list.at(-1).snapshot.length).toBeLessThan(25000);
    expect(list.at(-1).plan.items).toHaveLength(128);
    expect(list.at(-1).plan.items[0].title).toHaveLength(512);
  });

  it("extracts item/file/line/turn comments and reviewer notes", () => {
    const document = [
      "# ChainlessChain Plan Review",
      "",
      "## Plan Items",
      "",
      "1. edit_file: Edit config",
      "   - id: p1",
      "   - impact: medium",
      "   - status: pending",
      "   - comment: Keep src/config.ts:42:7 backwards compatible",
      "",
      "## Reviewer Notes",
      "",
      "- Add a migration test",
    ].join("\n");

    expect(extractPlanReviewComments(document, { turn: 3 })).toEqual([
      expect.objectContaining({
        itemId: "p1",
        sourceLine: 9,
        file: "src/config.ts",
        line: 42,
        column: 7,
        turn: 3,
      }),
      expect.objectContaining({
        itemId: null,
        text: "Add a migration test",
        turn: 3,
      }),
    ]);
  });

  it("merges execution progress without losing reviewer comments", () => {
    const original = [
      "1. edit_file: Edit config",
      "   - id: p1",
      "   - impact: medium",
      "   - status: approved",
      "   - comment: Keep this note",
    ].join("\n");
    const merged = mergePlanReviewProgress(original, {
      items: [
        {
          id: "p1",
          title: "Edit config",
          tool: "edit_file",
          status: "completed",
          turn: 2,
          tool_use_id: "tu-4",
          started_at: "2026-07-23T00:00:00.000Z",
          completed_at: "2026-07-23T00:00:01.000Z",
        },
      ],
    });
    expect(merged).toContain("- status: completed");
    expect(merged).toContain("turn 2; tool use tu-4");
    expect(merged).toContain("- comment: Keep this note");
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

function makeProvider({ state = makeMemento(), bootstrap = true } = {}) {
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
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession },
    state,
  });
  provider.view = {
    webview: { postMessage: (m) => (posted.push(m), Promise.resolve()) },
  };
  if (!bootstrap) return { provider, posted, sessions, state };
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

  it("restores an active review draft by session after a provider restart", async () => {
    const first = makeProvider();
    const original = first.provider._activeConv();
    const ok = await first.provider.reviewPlan("requestChanges");
    expect(ok).toBe(true);

    const restarted = makeProvider({ state: first.state, bootstrap: false });
    const restored = restarted.provider._activeConv();
    expect(restored.sessionId).toBe(original.sessionId);
    expect(restored.plan).toMatchObject({
      active: true,
      state: "awaiting_approval",
      persistedRevision: 1,
    });
    expect(restarted.provider._planReviews.get(restored.id).lastText).toContain(
      "approve this plan",
    );
  });

  it("does not downgrade a submitted decision while disposing", async () => {
    const { provider, state } = makeProvider();
    expect(await provider.reviewPlan("approve")).toBe(true);

    provider.dispose();

    expect(
      state._map.get("chainlesschain.chat.planReviewStates.v1").at(-1),
    ).toMatchObject({
      status: "decision_submitted",
      action: "approve",
    });
  });

  it("restores terminal review state without reopening a draft", () => {
    const first = makeProvider();
    const original = first.provider._activeConv();
    original.plan = {
      ...original.plan,
      active: false,
      state: "approved",
    };
    first.provider._persistPlanReviewState(
      original,
      "# Approved review",
      original.plan,
      { status: "approved", action: "approve" },
    );

    const restarted = makeProvider({ state: first.state, bootstrap: false });
    const restored = restarted.provider._activeConv();
    expect(restored.plan).toMatchObject({ active: false, state: "approved" });
    expect(restarted.provider._planReviews.has(restored.id)).toBe(false);
  });
});
