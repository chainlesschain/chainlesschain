/**
 * `/permissions` REPL command (Claude-Code parity) — render the allow/ask/deny
 * rules in effect this session, in deny>ask>allow order, with sources.
 */
import { describe, it, expect } from "vitest";
import { renderPermissions } from "../../src/repl/permissions-status.js";

describe("renderPermissions", () => {
  it("explains the default gate when no rules are configured", () => {
    const out = renderPermissions(null);
    expect(out).toContain("none configured");
    expect(out).toContain("always require approval");
    const out2 = renderPermissions({ allow: [], ask: [], deny: [] });
    expect(out2).toContain("none configured");
  });

  it("renders deny, ask, allow groups in precedence order with markers", () => {
    const out = renderPermissions({
      allow: ["Read(./src/**)"],
      ask: ["Bash(git push:*)"],
      deny: ["Bash(rm:*)"],
    });
    const lines = out.split("\n");
    const idxDeny = lines.findIndex((l) => l.includes("deny"));
    const idxAsk = lines.findIndex((l) => l.includes("ask"));
    const idxAllow = lines.findIndex((l) => l.includes("allow"));
    expect(idxDeny).toBeGreaterThanOrEqual(0);
    expect(idxDeny).toBeLessThan(idxAsk);
    expect(idxAsk).toBeLessThan(idxAllow);
    expect(out).toContain("✗ Bash(rm:*)");
    expect(out).toContain("? Bash(git push:*)");
    expect(out).toContain("✓ Read(./src/**)");
    expect(out).toContain("precedence: deny > ask > allow");
  });

  it("omits empty groups", () => {
    const out = renderPermissions({ allow: ["Read(./**)"], ask: [], deny: [] });
    expect(out).toContain("allow");
    expect(out).not.toContain("deny  (blocked)");
    expect(out).not.toContain("ask   (prompt first)");
  });

  it("lists contributing source files when provided", () => {
    const out = renderPermissions(
      { allow: ["Read(./**)"], ask: [], deny: [] },
      { files: [".claude/settings.json", ".claude/settings.local.json"] },
    );
    expect(out).toContain(
      "sources: .claude/settings.json, .claude/settings.local.json",
    );
  });
});
