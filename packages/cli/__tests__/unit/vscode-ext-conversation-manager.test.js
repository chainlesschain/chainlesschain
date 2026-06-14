/**
 * ConversationManager — the pure multi-tab model behind the chat panel. The
 * close/activate neighbor logic and stable id/title numbering are the heart
 * (the webview tab bar renders from list() and drives switchTo/close).
 *
 * Lives in the CLI suite like the other vscode-ext unit tests (no vscode host).
 */
import { describe, it, expect } from "vitest";
import { ConversationManager } from "../../../vscode-extension/src/chat/conversation-manager.js";

describe("ConversationManager", () => {
  it("create() activates the first; later creates append and can opt out of activation", () => {
    const m = new ConversationManager();
    const a = m.create();
    expect(a.id).toBe("conv-1");
    expect(a.title).toBe("Chat 1");
    expect(m.activeId()).toBe("conv-1");

    const b = m.create({ title: "Bugfix" });
    expect(b.title).toBe("Bugfix");
    expect(m.activeId()).toBe("conv-2"); // activate defaults true

    const c = m.create({ activate: false });
    expect(c.id).toBe("conv-3");
    expect(m.activeId()).toBe("conv-2"); // stayed on b
    expect(m.count()).toBe(3);
  });

  it("list() reflects order, active flag, and session presence", () => {
    const m = new ConversationManager();
    m.create(); // conv-1 active
    const b = m.create({ activate: false }); // conv-2
    m.setSession(b.id, { fake: true });
    const rows = m.list();
    expect(rows.map((r) => r.id)).toEqual(["conv-1", "conv-2"]);
    expect(rows[0]).toMatchObject({ active: true, hasSession: false });
    expect(rows[1]).toMatchObject({ active: false, hasSession: true });
  });

  it("switchTo activates an existing tab; unknown id is a no-op returning null", () => {
    const m = new ConversationManager();
    m.create();
    const b = m.create({ activate: false });
    expect(m.switchTo(b.id)).toBe(b);
    expect(m.activeId()).toBe(b.id);
    expect(m.switchTo("nope")).toBe(null);
    expect(m.activeId()).toBe(b.id); // unchanged
  });

  it("closing the active tab activates the right neighbor", () => {
    const m = new ConversationManager();
    const a = m.create();
    const b = m.create();
    const c = m.create();
    m.switchTo(b.id); // active = middle
    const res = m.close(b.id);
    expect(res.closed).toBe(true);
    expect(res.conv.id).toBe(b.id);
    expect(m.activeId()).toBe(c.id); // right neighbor
    expect(m.list().map((r) => r.id)).toEqual([a.id, c.id]);
  });

  it("closing the active LAST tab falls back to the left neighbor", () => {
    const m = new ConversationManager();
    const a = m.create();
    const b = m.create();
    m.switchTo(b.id);
    m.close(b.id);
    expect(m.activeId()).toBe(a.id);
  });

  it("closing a non-active tab keeps the active one", () => {
    const m = new ConversationManager();
    const a = m.create();
    const b = m.create(); // active
    m.close(a.id);
    expect(m.activeId()).toBe(b.id);
    expect(m.count()).toBe(1);
  });

  it("closing the final tab leaves no active conversation", () => {
    const m = new ConversationManager();
    const a = m.create();
    const res = m.close(a.id);
    expect(res.closed).toBe(true);
    expect(m.activeId()).toBe(null);
    expect(m.active()).toBe(null);
    expect(m.count()).toBe(0);
  });

  it("closing an unknown id is a safe no-op", () => {
    const m = new ConversationManager();
    m.create();
    const res = m.close("ghost");
    expect(res).toMatchObject({ closed: false });
    expect(m.count()).toBe(1);
  });

  it("ids and default titles keep increasing even after closes (no collision)", () => {
    const m = new ConversationManager();
    m.create(); // conv-1 / Chat 1
    const b = m.create(); // conv-2 / Chat 2
    m.close(b.id);
    const d = m.create(); // conv-3 / Chat 3 — not reused
    expect(d.id).toBe("conv-3");
    expect(d.title).toBe("Chat 3");
  });

  it("setSessionId / setSession / setTitle mutate the record; resetTurnState uses the factory", () => {
    let n = 0;
    const m = new ConversationManager({ createTurnState: () => ({ n: ++n }) });
    const a = m.create();
    expect(a.turnState).toEqual({ n: 1 });
    expect(m.setSessionId(a.id, "sess-abc").sessionId).toBe("sess-abc");
    expect(m.setSessionId(a.id, null).sessionId).toBe(null);
    const handle = { stop() {} };
    expect(m.setSession(a.id, handle).session).toBe(handle);
    expect(m.setTitle(a.id, "Renamed").title).toBe("Renamed");
    expect(m.setTitle(a.id, "").title).toBe("Renamed"); // empty ignored
    m.resetTurnState(a.id);
    expect(a.turnState).toEqual({ n: 2 });
    // unknown-id setters return null, never throw
    expect(m.setSession("nope", handle)).toBe(null);
  });

  it("allSessions returns only live handles, in tab order", () => {
    const m = new ConversationManager();
    const a = m.create();
    const b = m.create();
    const c = m.create();
    const hA = { id: "A" };
    const hC = { id: "C" };
    m.setSession(a.id, hA);
    m.setSession(c.id, hC);
    // b has no session
    expect(m.allSessions()).toEqual([hA, hC]);
    expect(b.session).toBe(null);
  });
});
