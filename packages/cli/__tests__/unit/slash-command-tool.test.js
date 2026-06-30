import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  executeTool,
  buildSystemPrompt,
} from "../../src/runtime/agent-core.js";
import {
  getCodingAgentFunctionToolDefinitions,
  getCodingAgentToolPolicy,
} from "../../src/runtime/coding-agent-contract.js";

/**
 * The slash_command agent tool — lets the model run user-defined slash commands
 * (.claude/commands/*.md) as reusable prompt macros, mirroring Claude Code's
 * SlashCommand tool. Expansion delegates to the same slash-commands module the
 * REPL uses, but with bang (`!`cmd``) execution disabled so the agent gets no
 * un-gated shell side channel.
 */
describe("slash_command tool", () => {
  let dir;
  const cmd = (name, body) =>
    writeFileSync(join(dir, ".claude", "commands", `${name}.md`), body);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slashtool-"));
    mkdirSync(join(dir, ".claude", "commands"), { recursive: true });
  });
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  });

  it("is registered in the LLM tool list", () => {
    const names = getCodingAgentFunctionToolDefinitions().map(
      (t) => t.function.name,
    );
    expect(names).toContain("slash_command");
  });

  it("has read-only, plan-mode-allowed policy", () => {
    const policy = getCodingAgentToolPolicy("slash_command");
    expect(policy).toBeTruthy();
    expect(policy.availableInPlanMode).toBe(true);
  });

  it("expands a matched command with $1/$ARGUMENTS substitution", async () => {
    cmd(
      "greet",
      "---\ndescription: Greet someone\n---\nSay hello to $1 from $ARGUMENTS.",
    );
    const res = await executeTool(
      "slash_command",
      { command: "/greet World everyone" },
      { cwd: dir },
    );
    expect(res.command).toBe("greet");
    expect(res.expandedPrompt).toBe("Say hello to World from World everyone.");
    expect(res.error).toBeUndefined();
  });

  it("accepts a command without the leading slash", async () => {
    cmd("ping", "pong");
    const res = await executeTool(
      "slash_command",
      { command: "ping" },
      { cwd: dir },
    );
    expect(res.expandedPrompt).toBe("pong");
  });

  it("resolves namespaced commands (git/commit.md -> git:commit)", async () => {
    mkdirSync(join(dir, ".claude", "commands", "git"), { recursive: true });
    writeFileSync(
      join(dir, ".claude", "commands", "git", "commit.md"),
      "Commit with message: $ARGUMENTS",
    );
    const res = await executeTool(
      "slash_command",
      { command: "/git:commit fix typo" },
      { cwd: dir },
    );
    expect(res.command).toBe("git:commit");
    expect(res.expandedPrompt).toBe("Commit with message: fix typo");
  });

  it("returns the available list for an unknown command", async () => {
    cmd("alpha", "a");
    cmd("beta", "b");
    const res = await executeTool(
      "slash_command",
      { command: "/nope" },
      { cwd: dir },
    );
    expect(res.error).toMatch(/Unknown slash command/);
    expect(res.availableCommands.map((c) => c.name).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("errors on an empty command", async () => {
    const res = await executeTool(
      "slash_command",
      { command: "  " },
      { cwd: dir },
    );
    expect(res.error).toMatch(/non-empty/);
  });

  it("does NOT execute !`shell` bang snippets (safety)", async () => {
    cmd("bangy", "Result: !`echo INJECTED`");
    const res = await executeTool(
      "slash_command",
      { command: "/bangy" },
      { cwd: dir },
    );
    // The bang is left literal, never run — no shell output spliced in.
    expect(res.expandedPrompt).toContain("!`echo INJECTED`");
    expect(res.expandedPrompt).not.toContain("\nINJECTED");
  });

  it("buildSystemPrompt advertises available commands", () => {
    cmd(
      "deploy",
      "---\ndescription: Ship it\nargument-hint: <env>\n---\nDeploy to $1",
    );
    const prompt = buildSystemPrompt(dir);
    expect(prompt).toContain("Available slash commands");
    expect(prompt).toContain("/deploy");
    expect(prompt).toContain("Ship it");
  });

  it("buildSystemPrompt omits the section when no commands exist", () => {
    const prompt = buildSystemPrompt(dir);
    expect(prompt).not.toContain("Available slash commands");
  });
});
