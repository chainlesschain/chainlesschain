/**
 * REPL conversation rewind — Claude-Code double-Esc parity (v1: conversation
 * state; file state stays on `cc checkpoint restore`, hinted alongside).
 *
 * Pure helpers over the REPL's live `messages` array so the picker logic is
 * unit-testable without readline:
 *  - listUserTurns(): newest-first numbered list of user messages
 *  - rewindToTurn(): truncate the conversation BACK TO BEFORE turn #n and
 *    return the original text so the caller can prefill the input line
 *    (edit-and-resend, like Claude Code's rewind).
 *
 * Trigger surfaces (wired in agent-repl): `/rewind` lists, `/rewind <n>`
 * rewinds, and a double-Esc while idle prints the same list as a shortcut.
 */

export const DEFAULT_LIST_LIMIT = 10;
export const PREVIEW_CHARS = 60;

function previewOf(content) {
  const text =
    typeof content === "string" ? content : JSON.stringify(content || "");
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS)}…`
    : flat;
}

/**
 * Newest-first user turns.
 * @returns {Array<{n:number, index:number, preview:string, content:any}>}
 *          n is the 1-based pick number (1 = most recent user message).
 */
export function listUserTurns(messages, { limit = DEFAULT_LIST_LIMIT } = {}) {
  const turns = [];
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    turns.push({
      n: turns.length + 1,
      index: i,
      preview: previewOf(m.content),
      content: m.content,
    });
    if (turns.length >= limit) break;
  }
  return turns;
}

/**
 * Rewind the conversation to BEFORE the picked user turn (mutates `messages`
 * in place — everything from that user message onward is dropped).
 *
 * @param {Array} messages  live conversation array
 * @param {number} n        1-based pick from listUserTurns
 * @returns {{ removed:number, text:string|null }|null}  null on bad pick;
 *          `text` is the original user text when it was a plain string
 *          (caller prefills the input line with it).
 */
export function rewindToTurn(messages, n) {
  const turns = listUserTurns(messages, { limit: 1000 });
  const turn = turns.find((t) => t.n === Number(n));
  if (!turn) return null;
  const removed = messages.length - turn.index;
  messages.splice(turn.index);
  return {
    removed,
    text: typeof turn.content === "string" ? turn.content : null,
  };
}

/**
 * Offline extractive recap for a resumed conversation ("where were we") —
 * no LLM call: turn counts + last ask + last reply previews.
 * @returns {string[]|null} lines to print, or null when nothing to recap.
 */
export function buildResumeRecap(messages, { previewChars = 160 } = {}) {
  const list = messages || [];
  const flat = (c) =>
    (typeof c === "string" ? c : JSON.stringify(c || ""))
      .replace(/\s+/g, " ")
      .trim();
  const cap = (s) =>
    s.length > previewChars ? `${s.slice(0, previewChars)}…` : s;
  const lastOf = (role) => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.role === role) return list[i].content;
    }
    return null;
  };
  const users = list.filter((m) => m?.role === "user").length;
  const assistants = list.filter((m) => m?.role === "assistant").length;
  if (!users && !assistants) return null;
  const lines = [`${users} user / ${assistants} assistant turns`];
  const lu = lastOf("user");
  if (lu) lines.push(`last ask  : ${cap(flat(lu))}`);
  const la = lastOf("assistant");
  if (la) lines.push(`last reply: ${cap(flat(la))}`);
  return lines;
}

/** Render the picker list (shared by /rewind and double-Esc). */
export function renderTurnList(turns) {
  if (!turns.length) return "  (no user turns yet)";
  return turns
    .map((t) => `  ${String(t.n).padStart(2)}. ${t.preview}`)
    .join("\n");
}
