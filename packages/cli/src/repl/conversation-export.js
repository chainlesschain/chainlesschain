/**
 * `/export` REPL command — dump the LIVE in-memory conversation to a Markdown
 * transcript (Claude-Code parity). Distinct from `cc export` (knowledge-base
 * export) and from `cc session export` (which reads the persisted JSONL store):
 * this renders the agent REPL's working `messages` array, so it captures
 * exactly what's in context right now, persisted or not.
 *
 * Pure over the OpenAI-shaped message list the agent loop maintains:
 *   {role:"user"|"assistant"|"system", content}              content: string | parts[]
 *   {role:"assistant", content, tool_calls:[{function:{name,arguments}}]}
 *   {role:"tool", content, tool_call_id}
 * The REPL does the file I/O; this only produces text + a default filename.
 */

export const TOOL_BLOCK_CAP = 4000;

/** Render message content (string, or OpenAI multimodal parts[]) as text. */
function contentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        if (part.type === "text" || typeof part.text === "string") {
          return part.text || "";
        }
        if (part.type === "image_url" || part.image_url) return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function fence(body, lang = "") {
  const text =
    typeof body === "string"
      ? body
      : (() => {
          try {
            return JSON.stringify(body, null, 2);
          } catch {
            return String(body);
          }
        })();
  const capped =
    text.length > TOOL_BLOCK_CAP
      ? `${text.slice(0, TOOL_BLOCK_CAP)}\n… [truncated]`
      : text;
  const guard = capped.includes("```") ? "````" : "```";
  return `${guard}${lang}\n${capped}\n${guard}`;
}

/** Pretty-print a tool_call's JSON-string arguments, falling back to raw. */
function prettyArgs(argStr) {
  if (typeof argStr !== "string") return fence(argStr, "json");
  try {
    return fence(JSON.parse(argStr), "json");
  } catch {
    return fence(argStr);
  }
}

const two = (n) => String(n).padStart(2, "0");

/**
 * A timestamped default filename, e.g. chainlesschain-export-20260613-130600.md.
 * Takes a Date so callers/tests stay deterministic.
 */
export function defaultExportFilename(date = new Date()) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date(0);
  const stamp =
    `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}` +
    `-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  return `chainlesschain-export-${stamp}.md`;
}

/**
 * Render the conversation as Markdown.
 * @param {Array} messages  the REPL's working message list
 * @param {object} [meta]   { provider, model, sessionId, exportedAt }
 * @returns {string}
 */
export function renderConversationMarkdown(messages, meta = {}) {
  const msgs = Array.isArray(messages) ? messages : [];
  const L = ["# ChainlessChain Conversation Export", ""];
  const bits = [];
  if (meta.sessionId) bits.push(`session: ${meta.sessionId}`);
  if (meta.provider) bits.push(`provider: ${meta.provider}`);
  if (meta.model) bits.push(`model: ${meta.model}`);
  if (meta.exportedAt) bits.push(`exported: ${meta.exportedAt}`);
  if (bits.length) {
    L.push(`> ${bits.join(" · ")}`, "");
  }

  let users = 0;
  let assistants = 0;
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const role = m.role;
    if (role === "user") {
      users += 1;
      L.push("## 👤 User", "", contentToText(m.content), "");
    } else if (role === "assistant") {
      const text = contentToText(m.content);
      if (text) {
        assistants += 1;
        L.push("## 🤖 Assistant", "", text, "");
      }
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const name = tc?.function?.name || tc?.name || "?";
          L.push(`**🔧 tool_call — \`${name}\`**`, "");
          L.push(prettyArgs(tc?.function?.arguments ?? tc?.arguments), "");
        }
      }
    } else if (role === "tool") {
      L.push("**↩ tool_result**", "", fence(contentToText(m.content)), "");
    } else if (role === "system") {
      L.push("## ⚙ System", "", contentToText(m.content), "");
    }
  }

  L.push("---", `_${users} user / ${assistants} assistant turns_`, "");
  return L.join("\n");
}
