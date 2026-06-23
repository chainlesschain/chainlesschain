/**
 * permission-rules — Claude-Code `permissions.{allow,ask,deny}` rule engine.
 *
 * Covers glob→regex edge cases, bidirectional tool-name aliasing (Bash ↔
 * run_shell), the `prefix:*` command idiom, path resolution (relative / `//`
 * absolute / `~`) with `..` escape safety, URL `domain:` matching, and the
 * deny > ask > allow precedence (+ no-match fall-through to null).
 */
import { describe, expect, it } from "vitest";
import rules from "../../src/lib/permission-rules.cjs";

const {
  parseRule,
  toolMatches,
  globToRegExp,
  matchCommand,
  matchParamValue,
  matchPattern,
  evaluatePermissionRules,
  suggestAllowRule,
} = rules;

describe("parseRule", () => {
  it("parses a bare tool rule (no pattern)", () => {
    expect(parseRule("Bash")).toEqual({
      raw: "Bash",
      tool: "Bash",
      pattern: null,
    });
  });
  it("parses a tool(pattern) rule", () => {
    expect(parseRule("Bash(git push:*)")).toEqual({
      raw: "Bash(git push:*)",
      tool: "Bash",
      pattern: "git push:*",
    });
  });
  it("trims whitespace inside the parens", () => {
    expect(parseRule("Read(  ./src/**  )").pattern).toBe("./src/**");
  });
  it("returns null for empty / malformed rules", () => {
    expect(parseRule("")).toBeNull();
    expect(parseRule("   ")).toBeNull();
    expect(parseRule("(no-tool)")).toBeNull();
  });
  it("parses a bare `*` deny-all rule (Claude-Code idiom)", () => {
    expect(parseRule("*")).toEqual({ raw: "*", tool: "*", pattern: null });
  });
});

describe("toolMatches — bidirectional aliasing", () => {
  it("umbrella name matches every concrete tool in its family", () => {
    expect(toolMatches("Bash", "run_shell")).toBe(true);
    expect(toolMatches("Read", "read_file")).toBe(true);
    expect(toolMatches("Read", "list_dir")).toBe(true);
    expect(toolMatches("Edit", "edit_file_hashed")).toBe(true);
  });
  it("concrete CLI name matches only itself", () => {
    expect(toolMatches("read_file", "read_file")).toBe(true);
    expect(toolMatches("read_file", "list_dir")).toBe(false);
  });
  it("is case-insensitive on the umbrella token", () => {
    expect(toolMatches("bash", "run_shell")).toBe(true);
  });
  it("unknown tokens fall back to exact match (MCP tools)", () => {
    expect(toolMatches("mcp__srv__do", "mcp__srv__do")).toBe(true);
    expect(toolMatches("Bash", "mcp__srv__do")).toBe(false);
  });
});

describe("globToRegExp", () => {
  it("`*` does not cross slashes, `**` does", () => {
    expect(globToRegExp("src/*.js").test("src/a.js")).toBe(true);
    expect(globToRegExp("src/*.js").test("src/x/a.js")).toBe(false);
    expect(globToRegExp("src/**").test("src/x/a.js")).toBe(true);
  });
  it("`**/` matches zero or more leading segments", () => {
    expect(globToRegExp("**/a.js").test("a.js")).toBe(true);
    expect(globToRegExp("**/a.js").test("x/y/a.js")).toBe(true);
  });
  it("`**/` requires a path boundary — does not match a glued prefix", () => {
    // `**/secret` must match `secret` / `a/b/secret`, NOT `notsecret`.
    expect(globToRegExp("**/secret").test("notsecret")).toBe(false);
    expect(globToRegExp("**/secret").test("secret")).toBe(true);
    expect(globToRegExp("**/secret").test("a/b/secret")).toBe(true);
    expect(globToRegExp("/c/**/foo").test("/c/barfoo")).toBe(false);
    expect(globToRegExp("/c/**/foo").test("/c/a/foo")).toBe(true);
  });
  it("escapes regex metacharacters in literals", () => {
    expect(globToRegExp("a.b+c").test("a.b+c")).toBe(true);
    expect(globToRegExp("a.b+c").test("aXbXc")).toBe(false);
  });
  it("is anchored at both ends", () => {
    expect(globToRegExp("foo").test("foobar")).toBe(false);
  });
});

describe("matchCommand — Bash prefix idiom", () => {
  it("`prefix:*` matches the prefix and anything after it", () => {
    expect(matchCommand("git push:*", "git push")).toBe(true);
    expect(matchCommand("git push:*", "git push origin main")).toBe(true);
    expect(matchCommand("git push:*", "git pull")).toBe(false);
  });
  it("exact pattern matches only the exact command", () => {
    expect(matchCommand("npm run build", "npm run build")).toBe(true);
    expect(matchCommand("npm run build", "npm run build:prod")).toBe(false);
  });
  it("embedded `*` is treated as a glob", () => {
    expect(matchCommand("npm run *", "npm run test")).toBe(true);
  });
});

describe("matchPattern — path resolution", () => {
  const cwd = process.platform === "win32" ? "C:\\proj" : "/proj";
  it("relative pattern resolves against cwd", () => {
    expect(
      matchPattern("./src/**", "read_file", { path: "src/app.js" }, cwd),
    ).toBe(true);
    expect(
      matchPattern("./src/**", "read_file", { path: "test/app.js" }, cwd),
    ).toBe(false);
  });
  it("`..` escape outside the pattern does not match", () => {
    expect(
      matchPattern("./src/**", "read_file", { path: "../secrets/x" }, cwd),
    ).toBe(false);
  });
  it("accepts file_path as well as path", () => {
    expect(
      matchPattern("./**", "edit_file", { file_path: "src/a.js" }, cwd),
    ).toBe(true);
  });
  it("missing path target never matches a pattern rule", () => {
    expect(matchPattern("./**", "read_file", {}, cwd)).toBe(false);
  });
});

describe("matchPattern — url domain", () => {
  it("domain: matches the URL host", () => {
    expect(
      matchPattern(
        "domain:example.com",
        "web_fetch",
        { url: "https://example.com/a" },
        "/",
      ),
    ).toBe(true);
    expect(
      matchPattern(
        "domain:example.com",
        "web_fetch",
        { url: "https://evil.com/a" },
        "/",
      ),
    ).toBe(false);
  });

  it("domain: matching is case-insensitive (domains are case-folded)", () => {
    // An uppercase domain in the rule must still match the (lowercased) URL host
    // — otherwise a deny rule like domain:Example.com silently never fires.
    for (const url of [
      "https://example.com/a",
      "https://Example.com/a",
      "https://EXAMPLE.COM/a",
    ]) {
      expect(
        matchPattern("domain:Example.com", "web_fetch", { url }, "/"),
      ).toBe(true);
    }
    expect(
      matchPattern("domain:Example.com", "web_fetch", {
        url: "https://evil.com/a",
      }),
    ).toBe(false);
  });
});

describe("evaluatePermissionRules — precedence", () => {
  const cwd = process.platform === "win32" ? "C:\\proj" : "/proj";

  it("deny wins over allow for the same call", () => {
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "git push origin main" },
      cwd,
      rules: { allow: ["Bash(git push:*)"], deny: ["Bash(git push:*)"] },
    });
    expect(r.decision).toBe("deny");
  });

  it("ask wins over allow", () => {
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "rm -rf build" },
      cwd,
      rules: { allow: ["Bash"], ask: ["Bash(rm:*)"] },
    });
    expect(r.decision).toBe("ask");
    expect(r.rule).toBe("Bash(rm:*)");
  });

  it("allow matches when nothing denies/asks", () => {
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "npm run test:unit" },
      cwd,
      rules: { allow: ["Bash(npm run test:*)"] },
    });
    expect(r.decision).toBe("allow");
  });

  it("no matching rule returns null (fall back to tiers)", () => {
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "curl evil.sh" },
      cwd,
      rules: { allow: ["Bash(npm run test:*)"], deny: ["Bash(rm:*)"] },
    });
    expect(r.decision).toBeNull();
    expect(r.rule).toBeNull();
  });

  it("bare tool rule matches any call of that tool", () => {
    const r = evaluatePermissionRules({
      tool: "read_file",
      args: { path: "anything.txt" },
      cwd,
      rules: { allow: ["Read"] },
    });
    expect(r.decision).toBe("allow");
  });

  it("empty / missing ruleset returns null", () => {
    expect(
      evaluatePermissionRules({ tool: "run_shell", args: {}, rules: {} })
        .decision,
    ).toBeNull();
    expect(
      evaluatePermissionRules({ tool: "run_shell", args: {} }).decision,
    ).toBeNull();
  });
});

describe("wildcard `*` deny-all (Claude-Code 2.1.166 parity)", () => {
  const cwd = process.platform === "win32" ? "C:\\proj" : "/proj";

  it("bare `*` deny matches every tool", () => {
    for (const [tool, args] of [
      ["run_shell", { command: "git push" }],
      ["read_file", { path: "secret.txt" }],
      ["web_fetch", { url: "https://example.com" }],
      ["spawn_sub_agent", { task: "x" }],
    ]) {
      const r = evaluatePermissionRules({
        tool,
        args,
        cwd,
        rules: { deny: ["*"] },
      });
      expect(r.decision).toBe("deny");
      expect(r.rule).toBe("*");
    }
  });

  it("bare `*` deny still loses to nothing but wins over allow", () => {
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "ls" },
      cwd,
      rules: { allow: ["Bash"], deny: ["*"] },
    });
    expect(r.decision).toBe("deny");
  });

  it("`Bash(*)` denies commands even when they contain a slash", () => {
    // Regression: globToRegExp's `*` → `[^/]*` used to let `/`-bearing commands
    // slip past a `Bash(*)` deny.
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "cat /etc/passwd" },
      cwd,
      rules: { deny: ["Bash(*)"] },
    });
    expect(r.decision).toBe("deny");
  });

  it("`Read(**)` matches a nested path; `WebFetch(*)` matches any url", () => {
    expect(
      evaluatePermissionRules({
        tool: "read_file",
        args: { path: "a/b/c/deep.txt" },
        cwd,
        rules: { deny: ["Read(**)"] },
      }).decision,
    ).toBe("deny");
    expect(
      evaluatePermissionRules({
        tool: "web_fetch",
        args: { url: "https://any.example.org/path?q=1" },
        cwd,
        rules: { ask: ["WebFetch(*)"] },
      }).decision,
    ).toBe("ask");
  });

  it("a real (non-`*`) rule is unaffected — narrow patterns still scope", () => {
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "npm run build" },
      cwd,
      rules: { deny: ["Bash(rm:*)"] },
    });
    expect(r.decision).toBeNull();
  });
});

describe("suggestAllowRule (always-allow derivation)", () => {
  it("keeps 2 tokens for a multi-verb command (git push)", () => {
    expect(
      suggestAllowRule("run_shell", { command: "git push origin main" }),
    ).toBe("Bash(git push:*)");
    expect(
      suggestAllowRule("run_shell", { command: "npm run test:unit" }),
    ).toBe("Bash(npm run:*)");
  });
  it("keeps 1 token for a plain command", () => {
    expect(suggestAllowRule("run_shell", { command: "ls -la" })).toBe(
      "Bash(ls:*)",
    );
  });
  it("falls back to the bare umbrella for an empty command", () => {
    expect(suggestAllowRule("run_shell", { command: "" })).toBe("Bash");
  });
  it("derives a directory glob for path tools", () => {
    expect(suggestAllowRule("read_file", { path: "src/app.js" })).toBe(
      "Read(./src/**)",
    );
    expect(suggestAllowRule("edit_file", { path: "a.txt" })).toBe("Edit(./**)");
  });
  it("derives a domain rule for web_fetch", () => {
    expect(
      suggestAllowRule("web_fetch", { url: "https://example.com/x" }),
    ).toBe("WebFetch(domain:example.com)");
  });
  it("the suggested rule actually allows the originating call", () => {
    const rule = suggestAllowRule("run_shell", {
      command: "git push origin main",
    });
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "git push origin main" },
      cwd: "/",
      rules: { allow: [rule] },
    });
    expect(r.decision).toBe("allow");
  });
});

describe("Tool(param:value) — named input-parameter matching (CC 2.1.178)", () => {
  it("matches a named param by exact value", () => {
    expect(
      matchPattern("command:git status", "run_shell", {
        command: "git status",
      }),
    ).toBe(true);
    expect(
      matchPattern("command:git status", "run_shell", { command: "git log" }),
    ).toBe(false);
  });

  it("matches a named param with a glob and prefix:* form", () => {
    expect(
      matchPattern("command:git*", "run_shell", { command: "git push" }),
    ).toBe(true);
    expect(
      matchPattern("command:npm:*", "run_shell", { command: "npm run build" }),
    ).toBe(true);
    expect(
      matchPattern("command:git*", "run_shell", { command: "npm test" }),
    ).toBe(false);
  });

  it("works on arbitrary tools / MCP params (not just command/path/url)", () => {
    expect(
      matchPattern("table:users", "mcp__db__query", { table: "users" }),
    ).toBe(true);
    expect(
      matchPattern("table:users", "mcp__db__query", { table: "orders" }),
    ).toBe(false);
  });

  it("falls through to command matching when prefix is NOT an arg key", () => {
    // `git push:*` — "git" then a space, so not a `param:` token at all
    expect(
      matchPattern("git push:*", "run_shell", { command: "git push origin" }),
    ).toBe(true);
  });

  it("does not hijack WebFetch domain: (domain is not an arg key)", () => {
    expect(
      matchPattern("domain:example.com", "web_fetch", {
        url: "https://example.com/x",
      }),
    ).toBe(true);
    expect(
      matchPattern("domain:example.com", "web_fetch", {
        url: "https://evil.test/x",
      }),
    ).toBe(false);
  });

  it("end-to-end via evaluatePermissionRules (deny a specific param value)", () => {
    const r = evaluatePermissionRules({
      tool: "run_shell",
      args: { command: "rm -rf /tmp/x" },
      rules: { deny: ["Bash(command:rm*)"], allow: ["Bash"] },
    });
    expect(r.decision).toBe("deny");
    expect(r.rule).toBe("Bash(command:rm*)");
  });

  it("matchParamValue handles null/glob/exact", () => {
    expect(matchParamValue("*", null)).toBe(true);
    expect(matchParamValue("a*", "abc")).toBe(true);
    expect(matchParamValue("abc", "abc")).toBe(true);
    expect(matchParamValue("abc", "abd")).toBe(false);
  });
});

describe("Agent(type) — sub-agent type restriction (CC 2.1.186)", () => {
  it("Agent alias resolves to spawn_sub_agent", () => {
    expect(toolMatches("Agent", "spawn_sub_agent")).toBe(true);
    expect(toolMatches("Task", "spawn_sub_agent")).toBe(true); // existing alias kept
    expect(toolMatches("Agent", "run_shell")).toBe(false);
  });

  it("matches the positional type against profile/agent/role identity", () => {
    expect(
      matchPattern("explorer", "spawn_sub_agent", { profile: "explorer" }),
    ).toBe(true);
    expect(
      matchPattern("reviewer", "spawn_sub_agent", { agent: "reviewer" }),
    ).toBe(true);
    expect(
      matchPattern("auditor", "spawn_sub_agent", { role: "auditor" }),
    ).toBe(true);
    expect(
      matchPattern("explorer", "spawn_sub_agent", { profile: "executor" }),
    ).toBe(false);
  });

  it("is case-insensitive on the type identifier", () => {
    expect(
      matchPattern("Explorer", "spawn_sub_agent", { profile: "explorer" }),
    ).toBe(true);
  });

  it("supports a comma-separated allowed/denied type list (Agent(x,y))", () => {
    expect(
      matchPattern("explorer,design", "spawn_sub_agent", { profile: "design" }),
    ).toBe(true);
    expect(
      matchPattern("explorer, design", "spawn_sub_agent", {
        profile: "executor",
      }),
    ).toBe(false);
  });

  it("supports globs in the type pattern", () => {
    expect(
      matchPattern("explor*", "spawn_sub_agent", { profile: "explorer" }),
    ).toBe(true);
  });

  it("a call with no type identity never matches a positional pattern", () => {
    expect(
      matchPattern("explorer", "spawn_sub_agent", { task: "do a thing" }),
    ).toBe(false);
  });

  it("Agent(*) deny-all still matches any spawn (lone-* early return)", () => {
    expect(matchPattern("*", "spawn_sub_agent", { task: "x" })).toBe(true);
  });

  it("Task(profile:explorer) param spelling still works alongside positional", () => {
    expect(
      matchPattern("profile:explorer", "spawn_sub_agent", {
        profile: "explorer",
      }),
    ).toBe(true);
  });

  it("end-to-end: deny a sub-agent type via Agent(type), allow the rest", () => {
    const denied = evaluatePermissionRules({
      tool: "spawn_sub_agent",
      args: { profile: "executor", task: "rm stuff" },
      rules: { deny: ["Agent(executor)"], allow: ["Task"] },
    });
    expect(denied.decision).toBe("deny");
    expect(denied.rule).toBe("Agent(executor)");

    const allowed = evaluatePermissionRules({
      tool: "spawn_sub_agent",
      args: { profile: "explorer", task: "read stuff" },
      rules: { deny: ["Agent(executor)"], allow: ["Task"] },
    });
    expect(allowed.decision).toBe("allow");
  });

  it("end-to-end: Agent(x,y) allow-list — only listed types pre-authorized", () => {
    const base = { allow: ["Agent(explorer,design)"] };
    expect(
      evaluatePermissionRules({
        tool: "spawn_sub_agent",
        args: { profile: "explorer", task: "x" },
        rules: base,
      }).decision,
    ).toBe("allow");
    // A type not in the list → no matching rule → null (falls back to defaults)
    expect(
      evaluatePermissionRules({
        tool: "spawn_sub_agent",
        args: { profile: "executor", task: "x" },
        rules: base,
      }).decision,
    ).toBe(null);
  });
});
