/**
 * Pure helpers for ephemeral REPL side questions.
 *
 * `/btw <question>` immediately asks a tool-free, single-response question
 * against a snapshot of the current conversation. The snapshot and answer are
 * never added to the parent conversation. `/btw --fork <question>` persists the
 * side thread into an independent child session when the caller has a durable
 * session store.
 *
 * The former "inject a note into the next turn" behavior remains available as
 * `/note-next <note>` so `/btw` can keep the same contract as Claude Code.
 */

/** Parse a `/btw …` line. Returns { text } | { error } | null (not a /btw). */
export function parseBtwCommand(trimmed) {
  const t = String(trimmed == null ? "" : trimmed).trim();
  if (t !== "/btw" && !t.startsWith("/btw ")) return null;
  let text = t.slice("/btw".length).trim();
  let fork = false;
  if (text === "--fork" || text.startsWith("--fork ")) {
    fork = true;
    text = text.slice("--fork".length).trim();
  }
  if (!text) {
    return {
      error:
        "usage: /btw [--fork] <question> — ask an immediate tool-free side question without changing parent history",
    };
  }
  return fork ? { text, fork: true } : { text };
}

/** Parse the legacy next-turn guidance command. */
export function parseNoteNextCommand(trimmed) {
  const t = String(trimmed == null ? "" : trimmed).trim();
  if (t !== "/note-next" && !t.startsWith("/note-next ")) return null;
  const text = t.slice("/note-next".length).trim();
  if (!text) {
    return {
      error:
        "usage: /note-next <note> — apply ephemeral guidance to the next main turn",
    };
  }
  return { text };
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return String(part.text || "");
      if (part?.type === "image_url" || part?.image_url) return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Build a provider-neutral, tool-free snapshot for a side question. Tool
 * results are retained as quoted user context, but tool-call protocol fields
 * are deliberately removed so the side call cannot continue a tool exchange.
 */
export function buildBtwMessages(messages, question) {
  const out = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== "object") continue;
    const content = textContent(message.content);
    if (!content) continue;
    if (message.role === "system") out.push({ role: "system", content });
    else if (message.role === "assistant")
      out.push({ role: "assistant", content });
    else if (message.role === "tool")
      out.push({ role: "user", content: `[Tool result]\n${content}` });
    else if (message.role === "user") out.push({ role: "user", content });
  }
  out.push({
    role: "system",
    content:
      "Answer the final side question from the supplied conversation context. " +
      "This is an ephemeral, single-response exchange. Do not call or request tools, " +
      "do not change the main task, and answer concisely.",
  });
  out.push({ role: "user", content: String(question || "").trim() });
  return out;
}

/** Run a single tool-free side question through an injected chat function. */
export async function runBtwQuestion({
  messages,
  question,
  chatFn,
  model,
  maxTokens = 1024,
} = {}) {
  if (typeof chatFn !== "function") {
    throw new TypeError("/btw requires a chat function");
  }
  const text = String(question || "").trim();
  if (!text) throw new TypeError("/btw requires a question");
  const snapshot = buildBtwMessages(messages, text);
  const answer = await chatFn(snapshot, { model, maxTokens });
  return {
    answer: String(answer == null ? "" : answer),
    snapshot,
  };
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
