/**
 * MCP prompt + resource surfacing for the agent REPL (Claude-Code parity).
 *
 * MCP servers can expose "prompts" — server-defined, parameterized prompt
 * templates — which Claude Code surfaces as slash commands of the form
 * `/mcp__<server>__<prompt>`. This module is the pure, unit-testable core:
 * it parses such a command, fetches the rendered prompt from the connected
 * MCP client, and flattens it into plain text to use as the user's turn.
 *
 * It also renders a `/mcp` overview of every connected server's resources and
 * prompts. The REPL (agent-repl.js) wires these in; all the logic lives here so
 * it can be tested without spinning up a readline session.
 */

/**
 * Parse a `/mcp__<server>__<prompt> [args]` line. Returns `{ server, name,
 * args }` or `null` when the line is not an MCP prompt invocation.
 *
 * `args` is parsed from a trailing JSON object when present; a non-JSON tail is
 * passed as `{ input: "<tail>" }` so simple one-arg prompts stay ergonomic.
 */
export function parseMcpPromptCommand(line) {
  const trimmed = (line || "").trim();
  if (!trimmed.startsWith("/mcp__")) return null;

  const sp = trimmed.search(/\s/);
  const token = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const rest = sp === -1 ? "" : trimmed.slice(sp + 1).trim();

  const full = token.slice(1); // drop leading "/"
  const parts = full.split("__"); // ["mcp", "<server>", "<prompt...>"]
  if (parts.length < 3 || parts[0] !== "mcp") return null;
  const server = parts[1];
  const name = parts.slice(2).join("__");
  if (!server || !name) return null;

  let args = {};
  if (rest) {
    try {
      const parsed = JSON.parse(rest);
      args =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : { input: rest };
    } catch {
      args = { input: rest };
    }
  }
  return { server, name, args };
}

/**
 * Flatten an MCP `prompts/get` result (`{ messages: [...] }`) into plain text.
 * Handles text blocks and embedded text resources; ignores binary blocks.
 */
export function renderPromptMessages(result) {
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const out = [];
  for (const msg of messages) {
    const blocks = Array.isArray(msg?.content) ? msg.content : [msg?.content];
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === "text" && typeof b.text === "string") {
        out.push(b.text);
      } else if (
        b.type === "resource" &&
        b.resource &&
        typeof b.resource.text === "string"
      ) {
        out.push(b.resource.text);
      }
    }
  }
  return out.join("\n\n");
}

/**
 * Expand a `/mcp__server__prompt` line into prompt text by calling the MCP
 * client. Returns the rendered text, or `null` when the line is not an MCP
 * prompt command. Throws if the underlying `getPrompt` fails (caller decides
 * whether to surface or swallow).
 */
export async function expandMcpPrompt(line, mcpClient) {
  const cmd = parseMcpPromptCommand(line);
  if (!cmd) return null;
  if (!mcpClient || typeof mcpClient.getPrompt !== "function") {
    throw new Error("No MCP servers are connected this session.");
  }
  const result = await mcpClient.getPrompt(cmd.server, cmd.name, cmd.args);
  return renderPromptMessages(result);
}

/**
 * Render a human overview of all connected MCP resources + prompts for `/mcp`.
 */
export function renderMcpSurface(mcpClient) {
  if (!mcpClient) return "No MCP servers are connected this session.";
  const resources =
    typeof mcpClient.listResources === "function"
      ? mcpClient.listResources()
      : [];
  const prompts =
    typeof mcpClient.listPrompts === "function" ? mcpClient.listPrompts() : [];

  const lines = [];
  lines.push(`MCP resources (${resources.length}):`);
  for (const r of resources) {
    lines.push(`  ${r.uri} [${r.server}]${r.name ? " — " + r.name : ""}`);
  }
  lines.push("");
  lines.push(`MCP prompts (${prompts.length}):`);
  for (const p of prompts) {
    lines.push(
      `  /mcp__${p.server}__${p.name}${p.description ? " — " + p.description : ""}`,
    );
  }
  if (resources.length === 0 && prompts.length === 0) {
    lines.push("");
    lines.push("(connected servers expose no resources or prompts)");
  }
  return lines.join("\n");
}
