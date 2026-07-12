/**
 * CLI reference generation + doc-drift detection (P2) — build a canonical
 * reference from command-manifest.json + AGENT_TOOLS and diff a doc surface.
 * Pure module.
 */
import { describe, it, expect } from "vitest";
import {
  extractCommands,
  extractToolNames,
  commandTokens,
  buildCliReference,
  renderReferenceMarkdown,
  detectDocDrift,
} from "../../src/lib/docs-drift.js";

const MANIFEST = {
  commandCount: 3,
  commands: [
    { name: "chat", aliases: ["c"], summary: "Ask the agent" },
    { name: "agenda", aliases: [], summary: "Scheduled work" },
    { name: "doctor", aliases: ["checkup"], summary: "Diagnostics" },
  ],
};
const TOOLS = [{ name: "read_file" }, { name: "web_search" }, "run_shell"];

describe("extractCommands / extractToolNames", () => {
  it("normalizes and sorts commands", () => {
    const cmds = extractCommands(MANIFEST);
    expect(cmds.map((c) => c.name)).toEqual(["agenda", "chat", "doctor"]);
    expect(cmds[1].aliases).toEqual(["c"]);
  });
  it("normalizes tool names (objects or strings), dedupes, sorts", () => {
    expect(extractToolNames(TOOLS)).toEqual([
      "read_file",
      "run_shell",
      "web_search",
    ]);
  });
  it("accepts OpenAI-style { function: { name } } tool definitions", () => {
    expect(
      extractToolNames([
        { type: "function", function: { name: "edit_file" } },
        { type: "function", function: { name: "git" } },
        { name: "run_code" },
      ]),
    ).toEqual(["edit_file", "git", "run_code"]);
  });
  it("commandTokens includes primary names and aliases", () => {
    const set = commandTokens(extractCommands(MANIFEST));
    expect(set.has("checkup")).toBe(true);
    expect(set.has("c")).toBe(true);
  });
});

describe("buildCliReference + renderReferenceMarkdown", () => {
  it("builds counts + sorted lists", () => {
    const ref = buildCliReference({ manifest: MANIFEST, tools: TOOLS });
    expect(ref.commandCount).toBe(3);
    expect(ref.toolCount).toBe(3);
  });
  it("renders deterministic markdown with commands and tools", () => {
    const md = renderReferenceMarkdown(
      buildCliReference({ manifest: MANIFEST, tools: TOOLS }),
    );
    expect(md).toContain("## Commands (3)");
    expect(md).toContain("`chat` (aliases: c) — Ask the agent");
    expect(md).toContain("## Agent tools (3)");
    expect(md).toContain("`web_search`");
    // stable: same input → identical output
    expect(
      renderReferenceMarkdown(
        buildCliReference({ manifest: MANIFEST, tools: TOOLS }),
      ),
    ).toBe(md);
  });
});

describe("detectDocDrift", () => {
  it("is clean when every command and tool is documented", () => {
    const doc = `
      Run \`cc chat\` to ask, \`cc agenda\` for schedules, \`cc doctor\` to check.
      Tools: read_file, run_shell, web_search.
    `;
    const r = detectDocDrift({ manifest: MANIFEST, tools: TOOLS, doc });
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({
      undocumentedCommands: 0,
      undocumentedTools: 0,
      staleCommandMentions: 0,
    });
  });

  it("flags a new command/tool that the doc never mentions", () => {
    const doc = "Only `cc chat` and read_file, run_shell, web_search here.";
    const r = detectDocDrift({ manifest: MANIFEST, tools: TOOLS, doc });
    expect(r.undocumentedCommands.sort()).toEqual(["agenda", "doctor"]);
    expect(r.undocumentedTools).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it("flags a stale `cc <cmd>` mention for a command that no longer exists", () => {
    const doc = `
      \`cc chat\` \`cc agenda\` \`cc doctor\` and the removed \`cc legacyfoo\`.
      read_file run_shell web_search
    `;
    const r = detectDocDrift({ manifest: MANIFEST, tools: TOOLS, doc });
    expect(r.staleCommandMentions).toEqual(["legacyfoo"]);
    expect(r.ok).toBe(false);
  });

  it("treats knownTokens (flags/exit codes) as authoritative to suppress false stale", () => {
    const doc =
      "`cc chat` `cc agenda` `cc doctor` `cc run` read_file run_shell web_search";
    const r = detectDocDrift({
      manifest: MANIFEST,
      tools: TOOLS,
      doc,
      knownTokens: ["run"],
    });
    expect(r.staleCommandMentions).toEqual([]);
  });
});
