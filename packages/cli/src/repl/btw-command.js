/**
 * Pure helpers for the REPL `/btw` aside (Claude-Code parity, one-shot variant).
 *
 * `/btw <note>` queues a side note that rides ONLY the next message: it is sent
 * to the model for that one turn (so it can steer the answer) and then removed,
 * so it is never persisted to the session history and never carried into later
 * turns — i.e. context without bloat. vscode/readline-free → unit-testable; the
 * REPL owns the queue + the inject/restore around the agentLoop call.
 *
 *   /btw I'm on Windows, use PowerShell   → queued, applied to the next turn only
 *   /btw                                  → usage error (nothing queued)
 */

/** Parse a `/btw …` line. Returns { text } | { error } | null (not a /btw). */
export function parseBtwCommand(trimmed) {
  const t = String(trimmed == null ? "" : trimmed).trim();
  if (t !== "/btw" && !t.startsWith("/btw ")) return null;
  const text = t.slice("/btw".length).trim();
  if (!text) {
    return {
      error:
        "usage: /btw <note> — a one-off aside for your next message (sent to the model, not saved to history)",
    };
  }
  return { text };
}

/**
 * Render queued asides into a single tagged block, or null when there is
 * nothing to add. The note tells the model this is ephemeral user guidance.
 */
export function buildAsideBlock(asides) {
  const list = (Array.isArray(asides) ? asides : [])
    .map((s) => String(s == null ? "" : s).trim())
    .filter(Boolean);
  if (!list.length) return null;
  return (
    '<aside note="one-off side note from the user — applies to THIS message only, not saved to history">\n' +
    list.join("\n") +
    "\n</aside>"
  );
}

/**
 * Append an aside block to a user message's content, preserving multimodal
 * arrays (OpenAI-style content parts from --image turns). Returns the new
 * content; a falsy block returns the content unchanged.
 */
export function applyAside(content, block) {
  if (!block) return content;
  if (Array.isArray(content)) {
    return [...content, { type: "text", text: block }];
  }
  const s = content == null ? "" : String(content);
  return s.length ? `${s}\n\n${block}` : block;
}
