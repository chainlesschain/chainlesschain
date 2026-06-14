/**
 * Pure conversation/tab model for the chat panel (Claude-Code conversation-tabs
 * parity). Holds N named conversations, each owning its own agent session
 * handle, resume id, per-turn reducer state, and title; tracks which one is
 * active. No `vscode` and no child-process coupling — the live AgentChatSession
 * is stored opaquely — so this is fully unit-testable. chat-view.js drives it
 * (spawn/route/dispose); chat-html.js renders the tab bar from list().
 *
 * This is slice 1 of the multi-tab feature: the data layer behind the panel.
 * The webview wiring (per-tab child, tab bar UI) builds on top of it.
 */

class ConversationManager {
  /**
   * @param {object} opts
   * @param {function} [opts.createTurnState] factory for a conversation's
   *        per-turn reducer state (chat-events.createTurnState); injected so
   *        this module stays dependency-free and testable.
   */
  constructor(opts = {}) {
    this._createTurnState =
      typeof opts.createTurnState === "function"
        ? opts.createTurnState
        : () => ({});
    this._conversations = new Map(); // id -> conversation record
    this._order = []; // tab order (array of ids, left→right)
    this._activeId = null;
    this._seq = 0; // monotonic — stable ids/titles even after closes
  }

  _nextId() {
    this._seq += 1;
    return `conv-${this._seq}`;
  }

  /**
   * Create a conversation. Becomes active when `activate` (default) or when no
   * conversation is active yet. Returns the new record.
   */
  create({ title, sessionId = null, activate = true } = {}) {
    const id = this._nextId();
    const conv = {
      id,
      title: title || `Chat ${this._seq}`,
      sessionId: sessionId || null,
      session: null, // opaque AgentChatSession handle (set by chat-view)
      turnState: this._createTurnState(),
    };
    this._conversations.set(id, conv);
    this._order.push(id);
    if (activate || this._activeId == null) this._activeId = id;
    return conv;
  }

  get(id) {
    return this._conversations.get(id) || null;
  }

  has(id) {
    return this._conversations.has(id);
  }

  activeId() {
    return this._activeId;
  }

  active() {
    return this._activeId ? this.get(this._activeId) : null;
  }

  count() {
    return this._order.length;
  }

  /** Tabs for the UI, in left→right order, flagging the active one. */
  list() {
    return this._order.map((id) => {
      const c = this._conversations.get(id);
      return {
        id: c.id,
        title: c.title,
        sessionId: c.sessionId,
        active: c.id === this._activeId,
        hasSession: !!c.session,
      };
    });
  }

  /** Activate a tab. Returns its record, or null if the id is unknown. */
  switchTo(id) {
    if (!this._conversations.has(id)) return null;
    this._activeId = id;
    return this.get(id);
  }

  /**
   * Remove a conversation. If it was active, activate the neighbor to its right
   * (or left if it was last; null if none remain) — the natural tab-close UX.
   * Returns `{ closed, conv?, active }` where `conv` is the removed record (so
   * the caller can stop its child) and `active` is the new active record.
   */
  close(id) {
    if (!this._conversations.has(id)) {
      return { closed: false, active: this.active() };
    }
    const idx = this._order.indexOf(id);
    const conv = this._conversations.get(id);
    this._conversations.delete(id);
    this._order.splice(idx, 1);
    if (this._activeId === id) {
      // After splice, _order[idx] is what used to be the right neighbor.
      this._activeId = this._order[idx] || this._order[idx - 1] || null;
    }
    return { closed: true, conv, active: this.active() };
  }

  setSessionId(id, sessionId) {
    const c = this.get(id);
    if (c) c.sessionId = sessionId || null;
    return c;
  }

  setSession(id, handle) {
    const c = this.get(id);
    if (c) c.session = handle || null;
    return c;
  }

  setTitle(id, title) {
    const c = this.get(id);
    if (c && title) c.title = title;
    return c;
  }

  /** Fresh per-turn reducer state for a conversation (e.g. after reset/resume). */
  resetTurnState(id) {
    const c = this.get(id);
    if (c) c.turnState = this._createTurnState();
    return c;
  }

  /** Every live session handle (for dispose — caller stops each). */
  allSessions() {
    return this._order
      .map((id) => this._conversations.get(id).session)
      .filter(Boolean);
  }
}

module.exports = { ConversationManager };
