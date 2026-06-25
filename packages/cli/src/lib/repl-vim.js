/**
 * Vim-mode line editing for the agent REPL (Claude-Code `/vim` parity).
 *
 * Node's readline owns rich INSERT-mode editing (history, kill-ring, tab
 * completion), so this module is a pure NORMAL-mode command interpreter — the
 * thing readline does NOT give you. The REPL wiring (agent-repl.js) consults it
 * only while in normal mode; insert↔normal transitions seed state from the live
 * `rl.line` / `rl.cursor`, so insert-mode edits never need to round-trip here.
 *
 * Everything is a pure function over an explicit `{ line, cursor, ... }` state so
 * the whole keymap is unit-testable without a TTY. `feedNormalKey()` takes one
 * keypress and returns the next state plus, when relevant, `mode:"insert"`
 * (hand control back to readline, seeded with the returned line/cursor) or
 * `submit:true` (Enter in normal mode → run the line).
 *
 * Supported (a deliberately useful subset, not all of vim):
 *   motions   h l 0 ^ $ w b e, f<c> F<c> t<c> T<c>, numeric counts (3w, 2l)
 *   enter ins i I a A, and o/O → A/I (the input is a single line)
 *   edits     x X D C s S ~ r<c>, and operators d/c/y with the motions above
 *             plus doubled dd/cc/yy (whole line); p/P paste the register
 * Not (yet): undo/redo, registers beyond the unnamed one, visual mode.
 */

/** Fresh state. mode starts "insert" so a just-toggled REPL keeps typing. */
export function createVimState(line = "", cursor = 0) {
  return {
    mode: "insert",
    line,
    cursor,
    register: { text: "", linewise: false },
    pending: null, // { op:"d"|"c"|"y", count:number } awaiting a motion
    count: "", // accumulating numeric prefix
    awaitChar: null, // { kind:"f"|"F"|"t"|"T"|"r" } awaiting one more char
    message: null, // transient note for the wiring (e.g. unknown key → bell)
  };
}

const isWord = (c) => !!c && /[A-Za-z0-9_]/.test(c);
const isSpace = (c) => !!c && /\s/.test(c);
const isPunct = (c) => !!c && !isWord(c) && !isSpace(c);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** First non-blank column (vim `^`). */
function firstNonBlank(line) {
  const i = line.search(/\S/);
  return i === -1 ? 0 : i;
}

/** Start of the next word (vim `w`). */
function wordForward(line, cursor) {
  const n = line.length;
  let i = cursor;
  if (i >= n) return n;
  const cls = isWord(line[i]) ? isWord : isPunct(line[i]) ? isPunct : null;
  if (cls) while (i < n && cls(line[i])) i++;
  while (i < n && isSpace(line[i])) i++;
  return i;
}

/** Start of the previous word (vim `b`). */
function wordBackward(line, cursor) {
  let i = cursor;
  if (i <= 0) return 0;
  i--;
  while (i > 0 && isSpace(line[i])) i--;
  if (i <= 0) return 0;
  const cls = isWord(line[i]) ? isWord : isPunct;
  while (i > 0 && cls(line[i - 1])) i--;
  return i;
}

/** End of the current/next word (vim `e`, inclusive). */
function wordEnd(line, cursor) {
  const n = line.length;
  let i = cursor;
  if (i >= n - 1) return Math.max(0, n - 1);
  i++;
  while (i < n && isSpace(line[i])) i++;
  if (i >= n) return n - 1;
  const cls = isWord(line[i]) ? isWord : isPunct;
  while (i + 1 < n && cls(line[i + 1])) i++;
  return i;
}

/**
 * Resolve a motion key to a target column + whether it's inclusive (the target
 * char is part of an operator's range). Returns null for "not a motion".
 *
 * @returns {{ target:number, inclusive:boolean }|null}
 */
function resolveMotion(state, ch, count, charArg) {
  const { line, cursor } = state;
  const n = line.length;
  const rep = Math.max(1, count);
  let pos;
  switch (ch) {
    case "h":
      return { target: Math.max(0, cursor - rep), inclusive: false };
    case "l":
    case " ":
      return { target: Math.min(n, cursor + rep), inclusive: false };
    case "0":
      return { target: 0, inclusive: false };
    case "^":
      return { target: firstNonBlank(line), inclusive: false };
    case "$":
      return { target: n, inclusive: false };
    case "w":
      pos = cursor;
      for (let k = 0; k < rep; k++) pos = wordForward(line, pos);
      return { target: pos, inclusive: false };
    case "b":
      pos = cursor;
      for (let k = 0; k < rep; k++) pos = wordBackward(line, pos);
      return { target: pos, inclusive: false };
    case "e":
      pos = cursor;
      for (let k = 0; k < rep; k++) pos = wordEnd(line, pos);
      return { target: pos, inclusive: true };
    case "f":
    case "t": {
      if (charArg == null) return null;
      let from = cursor;
      for (let k = 0; k < rep; k++) {
        const idx = line.indexOf(charArg, from + 1);
        if (idx === -1) return { target: cursor, inclusive: false, fail: true };
        from = idx;
      }
      return {
        target: ch === "t" ? Math.max(cursor, from - 1) : from,
        inclusive: true,
      };
    }
    case "F":
    case "T": {
      if (charArg == null) return null;
      let from = cursor;
      for (let k = 0; k < rep; k++) {
        const idx = line.lastIndexOf(charArg, from - 1);
        if (idx === -1) return { target: cursor, inclusive: false, fail: true };
        from = idx;
      }
      return { target: ch === "T" ? from + 1 : from, inclusive: false };
    }
    default:
      return null;
  }
}

const NORMAL_CURSOR_MAX = (line) => Math.max(0, line.length - 1);

/** Delete [from,to) from line, stash into register (charwise). */
function cutRange(state, from, to) {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const text = state.line.slice(a, b);
  return {
    line: state.line.slice(0, a) + state.line.slice(b),
    cursor: a,
    register: { text, linewise: false },
  };
}

/** Apply an operator (d/c/y) over a resolved motion span. */
function applyOperator(state, op, span) {
  const { line, cursor } = state;
  let to = span.target;
  if (span.inclusive) to = Math.min(line.length, to + 1);
  if (op === "y") {
    const a = Math.min(cursor, to);
    const b = Math.max(cursor, to);
    const next = {
      ...state,
      register: { text: line.slice(a, b), linewise: false },
      cursor: a,
      pending: null,
      count: "",
      awaitChar: null,
    };
    return next;
  }
  const cut = cutRange(state, cursor, to);
  const base = {
    ...state,
    line: cut.line,
    register: cut.register,
    pending: null,
    count: "",
    awaitChar: null,
  };
  if (op === "c") {
    return { ...base, cursor: cut.cursor, mode: "insert" };
  }
  // d: keep cursor in-bounds for normal mode
  return { ...base, cursor: clamp(cut.cursor, 0, NORMAL_CURSOR_MAX(cut.line)) };
}

/** Whole-line operator (dd / cc / yy). */
function applyLinewiseOperator(state, op) {
  const reg = { text: state.line, linewise: true };
  if (op === "y") {
    return {
      ...state,
      register: reg,
      pending: null,
      count: "",
      awaitChar: null,
    };
  }
  const cleared = {
    ...state,
    line: "",
    cursor: 0,
    register: reg,
    pending: null,
    count: "",
    awaitChar: null,
  };
  return op === "c" ? { ...cleared, mode: "insert" } : cleared;
}

const enterInsert = (state, patch = {}) => ({
  ...state,
  ...patch,
  mode: "insert",
  pending: null,
  count: "",
  awaitChar: null,
  message: null,
});

const bell = (state, patch = {}) => ({
  ...state,
  ...patch,
  pending: null,
  count: "",
  awaitChar: null,
  message: "bell",
});

/**
 * Feed one keypress to the NORMAL-mode interpreter.
 *
 * @param {object} state   from createVimState (mode is assumed "normal")
 * @param {string} ch      printable character (may be "" for special keys)
 * @param {object} [key]   node readline key descriptor ({ name, ctrl, ... })
 * @returns {object} next state. `mode:"insert"` ⇒ hand back to readline seeded
 *                   with line/cursor; `submit:true` ⇒ run the line.
 */
export function feedNormalKey(state, ch, key = {}) {
  const s = { ...state, message: null, notice: null };
  const line = s.line;

  // Enter → submit the line (parity with insert-mode Enter).
  if (key.name === "return" || key.name === "enter") {
    return { ...s, submit: true, pending: null, count: "", awaitChar: null };
  }
  // Esc clears any pending state but stays in normal mode.
  if (key.name === "escape") {
    return { ...s, pending: null, count: "", awaitChar: null };
  }

  // Awaiting a single char (f/F/t/T target, or r replacement).
  if (s.awaitChar) {
    const { kind, forOp } = s.awaitChar;
    if (!ch) return { ...s, awaitChar: null }; // a non-char key cancels
    if (kind === "r") {
      if (s.cursor >= line.length) return bell(s);
      const next = line.slice(0, s.cursor) + ch + line.slice(s.cursor + 1);
      return { ...s, line: next, awaitChar: null };
    }
    const span = resolveMotion(s, kind, parseInt(s.count || "1", 10), ch);
    if (!span || span.fail) return bell(s, { awaitChar: null });
    // Operator+find (e.g. df,) → apply the operator over the span; otherwise
    // f/F/t/T is a standalone cursor motion.
    if (forOp) {
      return applyOperator({ ...s, awaitChar: null }, forOp, span);
    }
    return {
      ...s,
      cursor: clamp(span.target, 0, NORMAL_CURSOR_MAX(line)),
      awaitChar: null,
      count: "",
    };
  }

  // Count prefix: digits 1-9 always; 0 only continues an existing count
  // (otherwise 0 is the "start of line" motion).
  if (/[0-9]/.test(ch) && !(ch === "0" && !s.count)) {
    return { ...s, count: s.count + ch };
  }

  const count = parseInt(s.count || "1", 10);

  // Operator pending (d/c/y already pressed): this key is the motion.
  if (s.pending) {
    const op = s.pending.op;
    // Doubled operator → linewise (dd, cc, yy).
    if (ch === op) return applyLinewiseOperator(s, op);
    // f/F/t/T need one more char before they can resolve.
    if ("fFtT".includes(ch)) {
      return { ...s, awaitChar: { kind: ch, forOp: op }, count: String(count) };
    }
    const span = resolveMotion(s, ch, count, null);
    if (!span || span.fail) return bell(s);
    return applyOperator(s, op, span);
  }

  // No pending operator — top-level normal commands.
  switch (ch) {
    case "i":
      return enterInsert(s);
    case "I":
      return enterInsert(s, { cursor: firstNonBlank(line) });
    case "a":
      return enterInsert(s, { cursor: Math.min(line.length, s.cursor + 1) });
    case "A":
      return enterInsert(s, { cursor: line.length });
    case "o": // single-line input: open ≈ append at end
      return enterInsert(s, { cursor: line.length });
    case "O":
      return enterInsert(s, { cursor: firstNonBlank(line) });
    case "x": {
      if (s.cursor >= line.length) return bell(s);
      const to = Math.min(line.length, s.cursor + count);
      const cut = cutRange(s, s.cursor, to);
      return {
        ...s,
        line: cut.line,
        register: cut.register,
        cursor: clamp(cut.cursor, 0, NORMAL_CURSOR_MAX(cut.line)),
        count: "",
      };
    }
    case "X": {
      if (s.cursor <= 0) return bell(s);
      const from = Math.max(0, s.cursor - count);
      const cut = cutRange(s, from, s.cursor);
      return {
        ...s,
        line: cut.line,
        register: cut.register,
        cursor: cut.cursor,
        count: "",
      };
    }
    case "D": {
      const cut = cutRange(s, s.cursor, line.length);
      return {
        ...s,
        line: cut.line,
        register: cut.register,
        cursor: clamp(cut.cursor, 0, NORMAL_CURSOR_MAX(cut.line)),
      };
    }
    case "C": {
      const cut = cutRange(s, s.cursor, line.length);
      return enterInsert(s, {
        line: cut.line,
        register: cut.register,
        cursor: cut.cursor,
      });
    }
    case "s": {
      if (s.cursor >= line.length) return enterInsert(s);
      const cut = cutRange(
        s,
        s.cursor,
        Math.min(line.length, s.cursor + count),
      );
      return enterInsert(s, {
        line: cut.line,
        register: cut.register,
        cursor: cut.cursor,
      });
    }
    case "S":
      return applyLinewiseOperator({ ...s }, "c");
    case "~": {
      if (s.cursor >= line.length) return bell(s);
      const c = line[s.cursor];
      const flipped = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
      const next = line.slice(0, s.cursor) + flipped + line.slice(s.cursor + 1);
      return {
        ...s,
        line: next,
        cursor: clamp(s.cursor + 1, 0, NORMAL_CURSOR_MAX(next)),
      };
    }
    case "r":
      return { ...s, awaitChar: { kind: "r" } };
    case "d":
    case "c":
    case "y":
      return { ...s, pending: { op: ch, count }, count: "" };
    case "p": {
      const { text, linewise } = s.register;
      if (!text) return bell(s);
      const at = linewise ? line.length : Math.min(line.length, s.cursor + 1);
      const next = line.slice(0, at) + text + line.slice(at);
      return {
        ...s,
        line: next,
        cursor: clamp(at + text.length - 1, 0, NORMAL_CURSOR_MAX(next)),
      };
    }
    case "P": {
      const { text } = s.register;
      if (!text) return bell(s);
      const at = s.cursor;
      const next = line.slice(0, at) + text + line.slice(at);
      return {
        ...s,
        line: next,
        cursor: clamp(at + text.length - 1, 0, NORMAL_CURSOR_MAX(next)),
      };
    }
    case "f":
    case "F":
    case "t":
    case "T":
      return { ...s, awaitChar: { kind: ch }, count: String(count) };
    case "/":
    case "?":
      // cc's NORMAL mode has no prompt-history search (readline owns history in
      // INSERT mode). A user pressing `/` here most likely wants a slash
      // command, so hint how to reach one instead of an opaque bell
      // (Claude-Code 2.1.191: "hint how to reach slash commands").
      return {
        ...s,
        count: "",
        notice:
          "NORMAL /: press i, then type /command (slash commands run in insert mode; history = ↑ or Ctrl-R)",
      };
    default: {
      // Pure motions (h l 0 ^ $ w b e) and Backspace/arrows mapped to h/l.
      let motionCh = ch;
      if (key.name === "backspace") motionCh = "h";
      else if (key.name === "left") motionCh = "h";
      else if (key.name === "right") motionCh = "l";
      const span = resolveMotion(s, motionCh, count, null);
      if (span && !span.fail) {
        return {
          ...s,
          cursor: clamp(span.target, 0, NORMAL_CURSOR_MAX(line)),
          count: "",
        };
      }
      return bell(s);
    }
  }
}

/** Short label for the prompt/status indicator. */
export function modeLabel(state) {
  return state.mode === "normal" ? "NORMAL" : "INSERT";
}
