/**
 * Permission-pending status dot: an approval that lands in a BACKGROUND chat tab
 * flags that tab (blue dot, distinct from the green "done" dot) and is
 * re-surfaced when you switch to the tab (background events are otherwise gated
 * out). Headless (no vscode host).
 */
import { describe, it, expect } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { ConversationManager } from "../../../vscode-extension/src/chat/conversation-manager.js";

describe("ConversationManager — approval flags", () => {
  it("markNeedsApproval flags a background tab, no-ops the active one", () => {
    const cm = new ConversationManager({});
    const a = cm.create({}); // active
    const b = cm.create({ activate: false }); // background
    expect(cm.markNeedsApproval(a.id)).toBe(null); // active → no dot
    expect(cm.markNeedsApproval(b.id)?.needsApproval).toBe(true);
    expect(cm.list().find((t) => t.id === b.id).needsApproval).toBe(true);
  });

  it("setPendingApproval stores the payload; clearApproval clears both", () => {
    const cm = new ConversationManager({});
    const a = cm.create({});
    const b = cm.create({ activate: false });
    cm.markNeedsApproval(b.id);
    cm.setPendingApproval(b.id, { kind: "approval", id: "x1" });
    expect(cm.get(b.id).pendingApproval).toEqual({ kind: "approval", id: "x1" });
    expect(cm.clearApproval(b.id)?.id).toBe(b.id);
    expect(cm.get(b.id).needsApproval).toBe(false);
    expect(cm.get(b.id).pendingApproval).toBe(null);
    // clearApproval on an already-clear conv returns null (nothing to update)
    expect(cm.clearApproval(a.id)).toBe(null);
  });

  it("switchTo clears the dot but keeps pendingApproval (for re-surfacing)", () => {
    const cm = new ConversationManager({});
    cm.create({}); // active a
    const b = cm.create({ activate: false });
    cm.markNeedsApproval(b.id);
    cm.setPendingApproval(b.id, { kind: "approval", id: "x" });
    cm.switchTo(b.id);
    expect(cm.get(b.id).needsApproval).toBe(false);
    expect(cm.get(b.id).pendingApproval).toEqual({ kind: "approval", id: "x" });
  });
});

function makeMemento() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), update: (k, v) => m.set(k, v) };
}

function makeProvider() {
  const posted = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: {}, // no showWarningMessage → toast is a no-op
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession: () => ({ running: true, send: () => true }) },
    state: makeMemento(),
  });
  provider.view = {
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, posted };
}

const lastOf = (posted, kind) => posted.filter((p) => p.kind === kind).pop();

describe("ChatViewProvider — pending-approval dot", () => {
  it("flags a background tab on an approval and remembers the card", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "ready" }); // conv-1 active
    const conv1 = provider._convs.list()[0];
    provider._handleMessage({ type: "newTab" }); // conv-2 active; conv-1 background

    provider._makeOnEvent(conv1.id)({
      type: "approval_request",
      id: "a1",
      tool: "run_shell",
      command: "rm -rf x",
      risk: "high",
    });

    expect(provider._convs.get(conv1.id).needsApproval).toBe(true);
    expect(provider._convs.get(conv1.id).pendingApproval).toMatchObject({
      kind: "approval",
      id: "a1",
    });
    expect(lastOf(posted, "tabs").tabs.find((t) => t.id === conv1.id).needsApproval).toBe(
      true,
    );
  });

  it("does not flag the active tab (its card shows live)", () => {
    const { provider } = makeProvider();
    provider._handleMessage({ type: "ready" });
    const active = provider._convs.activeId();
    provider._makeOnEvent(active)({ type: "approval_request", id: "a2" });
    expect(provider._convs.get(active).needsApproval).toBe(false);
  });

  it("re-surfaces the card and clears the flag on switching to the tab", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "ready" });
    const conv1 = provider._convs.list()[0];
    provider._handleMessage({ type: "newTab" });
    provider._makeOnEvent(conv1.id)({ type: "approval_request", id: "a3" });

    provider._handleMessage({ type: "switchTab", id: conv1.id });
    expect(lastOf(posted, "approval")).toMatchObject({ id: "a3" });
    expect(provider._convs.get(conv1.id).pendingApproval).toBe(null);
    expect(provider._convs.get(conv1.id).needsApproval).toBe(false);
  });

  it("clears the flag when the approval resolves", () => {
    const { provider } = makeProvider();
    provider._handleMessage({ type: "ready" });
    const conv1 = provider._convs.list()[0];
    provider._handleMessage({ type: "newTab" });
    const onEvent = provider._makeOnEvent(conv1.id);
    onEvent({ type: "approval_request", id: "a4" });
    expect(provider._convs.get(conv1.id).needsApproval).toBe(true);
    onEvent({ type: "approval_resolved", id: "a4", approved: true });
    expect(provider._convs.get(conv1.id).needsApproval).toBe(false);
    expect(provider._convs.get(conv1.id).pendingApproval).toBe(null);
  });
});
