/**
 * Agent-session Markdown export — Claude-Code `/export` parity for the JSONL
 * headless/agent session store (`~/.../sessions/<id>.jsonl`, the `--resume`
 * sessions). `cc session export` keeps serving chat-DB sessions and falls
 * back to this renderer when the id only exists in the JSONL store.
 *
 * Pure function over the event list (see jsonl-session-store.js appendEvent):
 *   { type, timestamp, data }
 *   types: session_start{title,provider,model} · user_message · assistant_message
 *          · system · tool_call{tool,args} · tool_result{tool,result}
 *          · compact(stats) · token_usage{...}
 */

export const TOOL_BLOCK_CAP = 4000;

function asText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function fence(body, lang = "") {
  const text = asText(body);
  const capped =
    text.length > TOOL_BLOCK_CAP
      ? `${text.slice(0, TOOL_BLOCK_CAP)}\n… [truncated]`
      : text;
  // avoid breaking out of the fence when the payload contains ```
  const guard = capped.includes("```") ? "````" : "```";
  return `${guard}${lang}\n${capped}\n${guard}`;
}

/** Render a JSONL agent session as a readable Markdown transcript. */
export function renderAgentSessionMarkdown(sessionId, events, opts = {}) {
  const L = [];
  const start = events.find((e) => e?.type === "session_start");
  const firstTs = events.find((e) => Number.isFinite(e?.timestamp))?.timestamp;

  L.push(`# Agent Session ${sessionId}`);
  L.push("");
  const metaBits = [];
  if (start?.data?.title && start.data.title !== "Untitled")
    metaBits.push(`title: ${start.data.title}`);
  if (start?.data?.provider) metaBits.push(`provider: ${start.data.provider}`);
  if (start?.data?.model) metaBits.push(`model: ${start.data.model}`);
  if (firstTs) metaBits.push(`started: ${new Date(firstTs).toISOString()}`);
  if (opts.exportedAt) metaBits.push(`exported: ${opts.exportedAt}`);
  if (metaBits.length) {
    L.push(`> ${metaBits.join(" · ")}`);
    L.push("");
  }

  let users = 0;
  let assistants = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    switch (ev.type) {
      case "user_message":
        users += 1;
        L.push("## 👤 User");
        L.push("");
        L.push(asText(ev.data?.content));
        L.push("");
        break;
      case "assistant_message":
        assistants += 1;
        L.push("## 🤖 Assistant");
        L.push("");
        L.push(asText(ev.data?.content));
        L.push("");
        break;
      case "system":
        L.push("## ⚙ System");
        L.push("");
        L.push(asText(ev.data?.content));
        L.push("");
        break;
      case "tool_call":
        L.push(`**🔧 tool_call — \`${ev.data?.tool || "?"}\`**`);
        L.push("");
        L.push(fence(ev.data?.args, "json"));
        L.push("");
        break;
      case "tool_result":
        L.push(`**↩ tool_result — \`${ev.data?.tool || "?"}\`**`);
        L.push("");
        L.push(fence(ev.data?.result));
        L.push("");
        break;
      case "compact": {
        const s = ev.data || {};
        const saved = s.savedTokens ?? s.saved ?? null;
        L.push(
          `> ⊟ context compacted${saved != null ? ` — saved ~${saved} tokens` : ""}`,
        );
        L.push("");
        break;
      }
      case "token_usage": {
        const d = ev.data || {};
        tokensIn += Number(d.inputTokens ?? d.input_tokens ?? 0) || 0;
        tokensOut += Number(d.outputTokens ?? d.output_tokens ?? 0) || 0;
        break;
      }
      default:
        break; // session_start handled above; unknown types skipped
    }
  }

  L.push("---");
  const totals = [`${users} user / ${assistants} assistant turns`];
  if (tokensIn || tokensOut)
    totals.push(`tokens in/out: ${tokensIn}/${tokensOut}`);
  L.push(`_${totals.join(" · ")}_`);
  L.push("");
  return L.join("\n");
}
