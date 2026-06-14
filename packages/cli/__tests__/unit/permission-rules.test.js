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
