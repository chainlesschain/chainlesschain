/**
 * Skill-Embedded MCP — skills declare their MCP servers inline (v5.0.2.9)
 *
 * Inspired by oh-my-openagent's "Skill-Embedded MCPs" design: instead of
 * forcing users to pre-register MCP servers in a DB, a skill can declare
 * the MCP servers it needs directly in its SKILL.md body. When the skill
 * is activated, its servers are mounted; when the skill exits, they are
 * unmounted. This keeps the agent's tool list scoped and avoids tool
 * explosion across 130+ skills.
 *
 * Declaration format — a fenced code block tagged `mcp-servers` in the
 * SKILL.md body (NOT frontmatter, so no YAML parser changes are needed):
 *
 *   ```mcp-servers
 *   [
 *     {
 *       "name": "weather",
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-weather"]
 *     }
 *   ]
 *   ```
 *
 * The block content must be a JSON array of server configs. Each config
 * requires `name` and `command`; `args`, `env`, and `cwd` are optional.
 *
 * Pure functions only (except mount/unmount which take an MCPClient dep).
 */

/**
 * Parse MCP server declarations from a SKILL.md body.
 * Returns an empty array if no `mcp-servers` code block is present.
 *
 * @param {string} body - The markdown body after YAML frontmatter
 * @returns {Array<object>} Array of validated server configs (may be empty)
 */
export function parseSkillMcpServers(body) {
  if (typeof body !== "string" || body.length === 0) return [];

  // Match fenced code blocks with info string "mcp-servers" or
  // "json mcp-servers". We accept both because some users default to
  // json-tagged blocks for editor highlighting.
  const fenceRegex = /```(?:json\s+)?mcp-servers\s*\n([\s\S]*?)\n```/i;
  const match = body.match(fenceRegex);
  if (!match) return [];

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    // Malformed JSON — return empty, let caller decide whether to warn
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const validated = [];
  for (const entry of parsed) {
    const normalized = validateMcpServerConfig(entry);
    if (normalized) validated.push(normalized);
  }
  return validated;
}

/**
 * Validate a single server config. Returns a normalized frozen object on
 * success, or null on validation failure.
 *
 * @param {object} entry
 * @returns {object | null}
 */
export function validateMcpServerConfig(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
    return null;
  }
  if (typeof entry.command !== "string" || entry.command.trim().length === 0) {
    return null;
  }

  const normalized = {
    name: entry.name.trim(),
    command: entry.command.trim(),
    args: Array.isArray(entry.args)
      ? entry.args.filter((a) => typeof a === "string")
      : [],
  };
  if (entry.env && typeof entry.env === "object" && !Array.isArray(entry.env)) {
    normalized.env = { ...entry.env };
  }
  if (typeof entry.cwd === "string" && entry.cwd.length > 0) {
    normalized.cwd = entry.cwd;
  }
  return Object.freeze(normalized);
}

/**
 * Mount a skill's declared MCP servers on an existing MCPClient.
 * Servers that fail to connect are skipped (errors collected in the
 * result). Returns a handle that can be passed to unmountSkillMcpServers.
 *
 * @param {object} mcpClient - An instance of MCPClient (must expose .connect)
 * @param {object} skill - Skill metadata with `mcpServers` array
 * @param {object} [opts]
 * @param {(msg: string, err?: Error) => void} [opts.onWarn] - Warning hook
 * @returns {Promise<{ mounted: string[], skipped: Array<{ name: string, error: string }> }>}
 */
export async function mountSkillMcpServers(mcpClient, skill, opts = {}) {
  const declared = Array.isArray(skill?.mcpServers) ? skill.mcpServers : [];
  const mounted = [];
  const skipped = [];

  if (declared.length === 0) return { mounted, skipped };
  if (!mcpClient || typeof mcpClient.connect !== "function") {
    throw new Error("mountSkillMcpServers requires an MCPClient with .connect");
  }

  for (const server of declared) {
    const normalized = validateMcpServerConfig(server);
    if (!normalized) {
      skipped.push({
        name: server?.name || "(invalid)",
        error: "invalid config",
      });
      continue;
    }
    try {
      await mcpClient.connect(normalized.name, normalized);
      mounted.push(normalized.name);
    } catch (err) {
      const message = err?.message || String(err);
      skipped.push({ name: normalized.name, error: message });
      if (typeof opts.onWarn === "function") {
        opts.onWarn(
          `[skill-mcp] Failed to mount "${normalized.name}" for skill "${skill?.id || skill?.name}": ${message}`,
          err,
        );
      }
    }
  }

  return { mounted, skipped };
}

/**
 * Unmount previously-mounted skill MCP servers. Safe to call with an
 * empty list or a handle from a failed mount.
 *
 * @param {object} mcpClient - An instance of MCPClient (must expose .disconnect)
 * @param {string[]} mountedNames - Server names to unmount
 * @returns {Promise<{ unmounted: string[], errors: Array<{ name: string, error: string }> }>}
 */
export async function unmountSkillMcpServers(mcpClient, mountedNames) {
  const names = Array.isArray(mountedNames) ? mountedNames : [];
  const unmounted = [];
  const errors = [];

  if (names.length === 0) return { unmounted, errors };
  if (!mcpClient || typeof mcpClient.disconnect !== "function") {
    // Fall back to disconnectAll if present — still not a hard failure
    if (typeof mcpClient?.disconnectAll === "function") {
      try {
        await mcpClient.disconnectAll();
        return { unmounted: names.slice(), errors };
      } catch (err) {
        return {
          unmounted,
          errors: names.map((name) => ({
            name,
            error: err?.message || String(err),
          })),
        };
      }
    }
    throw new Error(
      "unmountSkillMcpServers requires an MCPClient with .disconnect or .disconnectAll",
    );
  }

  for (const name of names) {
    try {
      await mcpClient.disconnect(name);
      unmounted.push(name);
    } catch (err) {
      errors.push({ name, error: err?.message || String(err) });
    }
  }

  return { unmounted, errors };
}
