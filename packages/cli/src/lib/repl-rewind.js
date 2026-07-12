/**
 * REPL conversation rewind — Claude-Code double-Esc parity. Conversation state
 * AND, when auto-checkpointing is on (git work tree), the file tree are rewound
 * together — matching Claude Code's rewind, which restores code + conversation
 * in one step instead of leaving files on a separate `cc checkpoint restore`.
 *
 * Pure helpers over the REPL's live `messages` array so the picker logic is
 * unit-testable without readline:
 *  - listUserTurns(): newest-first numbered list of user messages
 *  - rewindToTurn(): truncate the conversation BACK TO BEFORE turn #n and
 *    return the original text so the caller can prefill the input line
 *    (edit-and-resend, like Claude Code's rewind).
 *  - pickCheckpointForTurn(): map a rewound turn to the file checkpoint that
 *    captured the work tree just before that turn first mutated it.
 *  - pruneMarksAfter(): drop checkpoint marks for the turns that were dropped.
 *
 * Trigger surfaces (wired in agent-repl): `/rewind` lists, `/rewind <n>`
 * rewinds, and a double-Esc while idle prints the same list as a shortcut.
 *
 * Checkpoint marks: the REPL records `{ atMessageCount, id, tool }` for every
 * `checkpoint` event the agent loop emits — `atMessageCount` is `messages.length`
 * at the instant the snapshot was taken (always just AFTER the turn's user
 * message was appended, so it is strictly greater than that turn's message
 * index, and not-greater than any later turn's). That ordering is what lets a
 * turn be matched to its pre-mutation snapshot purely from the count.
 */

import {
  buildTurnBindingFromMarks,
  resolveRestorePlan,
  RESTORE_SCOPE,
  TURN_COVERAGE,
} from "./turn-binding.js";

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
    index: turn.index,
    text: typeof turn.content === "string" ? turn.content : null,
  };
}

/**
 * Map a rewound turn to the checkpoint that captured the work tree right BEFORE
 * that turn first changed a file.
 *
 * A turn's auto-checkpoints are all taken with `atMessageCount` strictly greater
 * than the turn's message index (the user message is appended first), while the
 * previous turn's checkpoints have `atMessageCount <= turnIndex`. So the snapshot
 * representing "state before turn N" is the one with the SMALLEST atMessageCount
 * still greater than turnIndex.
 *
 * @param {Array<{atMessageCount:number,id:string,tool?:string}>} marks
 * @param {number} turnIndex  message index returned by rewindToTurn
 * @returns {{atMessageCount:number,id:string,tool?:string}|null}
 */
export function pickCheckpointForTurn(marks, turnIndex) {
  if (!Array.isArray(marks) || marks.length === 0) return null;
  const idx = Number(turnIndex);
  if (!Number.isFinite(idx)) return null;
  let best = null;
  for (const m of marks) {
    if (!m || typeof m.id !== "string") continue;
    const c = Number(m.atMessageCount);
    if (!Number.isFinite(c) || c <= idx) continue;
    if (best === null || c < Number(best.atMessageCount)) best = m;
  }
  return best;
}

/**
 * Drop checkpoint marks belonging to turns that were just rewound away (those
 * with `atMessageCount` greater than the surviving message count). Mutates the
 * array in place so the REPL's `const` marks array keeps its identity.
 *
 * @returns {number} how many marks were removed
 */
export function pruneMarksAfter(marks, turnIndex) {
  if (!Array.isArray(marks)) return 0;
  const idx = Number(turnIndex);
  if (!Number.isFinite(idx)) return 0;
  let removed = 0;
  for (let i = marks.length - 1; i >= 0; i--) {
    const c = Number(marks[i]?.atMessageCount);
    if (!Number.isFinite(c) || c > idx) {
      marks.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
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

/**
 * Snapshot the live conversation so a later `/rewind clear` can restore it
 * (Claude-Code 2.1.191: "/rewind support for resuming a conversation from
 * before /clear was run"). Drops the system prompt (index 0, re-added on
 * restore) and copies the checkpoint marks. Returns null when there is nothing
 * worth stashing (empty conversation) so a no-op /clear can't clobber an
 * existing restorable snapshot.
 *
 * @param {Array} messages
 * @param {Array} [marks]
 * @returns {{messages:Array, marks:Array}|null}
 */
export function snapshotClearedConversation(messages, marks) {
  const body = (messages || []).slice(1);
  if (body.length === 0) return null;
  return {
    messages: body.slice(),
    marks: Array.isArray(marks) ? marks.slice() : [],
  };
}

/**
 * Restore a conversation stashed by /clear, swapping it IN PLACE with the
 * current (post-clear) conversation so the restore is itself undoable. Keeps
 * `messages[0]` (the system prompt). Returns the new stash (the swapped-out
 * current state, or null when it was empty) plus counts, or null when there is
 * nothing to restore.
 *
 * @param {Array} messages  live conversation (index 0 = system prompt, kept)
 * @param {Array} marks     live checkpoint marks array (mutated in place)
 * @param {{messages:Array, marks:Array}|null} cleared  stash from /clear
 * @returns {{restored:number, stashed:number, newCleared:{messages:Array,marks:Array}|null}|null}
 */
export function restoreClearedConversation(messages, marks, cleared) {
  if (
    !cleared ||
    !Array.isArray(cleared.messages) ||
    cleared.messages.length === 0
  ) {
    return null;
  }
  const curMsgs = (messages || []).slice(1);
  const curMarks = Array.isArray(marks) ? marks.slice() : [];
  // Replace messages[1..] with the stashed conversation (system prompt kept).
  messages.splice(1, messages.length - 1, ...cleared.messages);
  if (Array.isArray(marks)) {
    marks.splice(0, marks.length, ...(cleared.marks || []));
  }
  const newCleared = curMsgs.length
    ? { messages: curMsgs, marks: curMarks }
    : null;
  return {
    restored: cleared.messages.length,
    stashed: curMsgs.length,
    newCleared,
  };
}

/**
 * Coverage-aware restore plan for a rewound turn, derived from the REPL's
 * EXISTING implicit state (`listUserTurns()` output + `{atMessageCount,id,tool}`
 * marks) — no new agent-loop events required. Bridges those into the explicit
 * turn-binding table and asks `resolveRestorePlan` for the honest plan, so
 * `/rewind` can warn when a restore can't be fully promised (side-effects, a
 * missing checkpoint, or a conversation/files drift) instead of silently doing a
 * lossy rewind.
 *
 * @param {Array} messages  live conversation (for listUserTurns)
 * @param {Array<{atMessageCount:number,id:string,tool?:string}>} marks
 * @param {number} turnIndex  message index returned by rewindToTurn()
 * @param {string} [scope]  one of RESTORE_SCOPE (default BOTH)
 * @returns {{scope, coverage, conversation, files, warnings:string[]}}
 */
export function buildRewindPlan(
  messages,
  marks,
  turnIndex,
  scope = RESTORE_SCOPE.BOTH,
) {
  const turns = listUserTurns(messages, { limit: 1000 });
  const log = buildTurnBindingFromMarks(turns, marks);
  const turn = log.get(`turn-${Number(turnIndex)}`);
  return resolveRestorePlan(turn, scope);
}

/**
 * Human-readable lines for a rewind plan's coverage + warnings, for `/rewind` to
 * print before it truncates. Returns [] for a fully-restorable turn with no
 * warnings (nothing worth interrupting the user for).
 *
 * @param {{coverage:string, warnings:string[]}} plan  from buildRewindPlan()
 * @returns {string[]}
 */
export function renderRewindWarnings(plan) {
  if (!plan) return [];
  const lines = [];
  if (plan.coverage && plan.coverage !== TURN_COVERAGE.FULL) {
    lines.push(`  coverage: ${plan.coverage} (restore is not guaranteed)`);
  }
  for (const w of plan.warnings || []) lines.push(`  ⚠ ${w}`);
  return lines;
}

/** Render the picker list (shared by /rewind and double-Esc). */
export function renderTurnList(turns) {
  if (!turns.length) return "  (no user turns yet)";
  return turns
    .map((t) => `  ${String(t.n).padStart(2)}. ${t.preview}`)
    .join("\n");
}
