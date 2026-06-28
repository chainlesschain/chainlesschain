/**
 * `/hooks` renderer — formats the loaded .claude/settings.json `hooks` block
 * into a human-readable block. Pure + deterministic.
 */
import { describe, it, expect } from "vitest";
import { formatSettingsHooks } from "../../src/repl/hooks-status.js";

describe("formatSettingsHooks", () => {
  it("explains the empty case and points at cc hook list", () => {
    const out = formatSettingsHooks(null);
    expect(out).toMatch(/No settings.json hooks loaded/);
    expect(out).toMatch(/cc hook list/);
    // empty object behaves the same as null
    expect(formatSettingsHooks({})).toMatch(/No settings.json hooks loaded/);
  });

  it("renders events, matchers and command hooks with a header count", () => {
    const out = formatSettingsHooks({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "./guard.sh", timeout: 60 }],
        },
      ],
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: "./fmt.sh" }],
        },
      ],
    });
    expect(out).toMatch(
      /settings.json hooks \(decision-capable, 2 command\(s\) across 2 event\(s\)\):/,
    );
    expect(out).toMatch(/PreToolUse:/);
    expect(out).toMatch(/matcher Bash/);
    expect(out).toMatch(/\.\/guard\.sh \[timeout 60s\]/);
    expect(out).toMatch(/PostToolUse:/);
    expect(out).toMatch(/matcher Edit\|Write/);
    expect(out).toMatch(/\.\/fmt\.sh/);
    expect(out).toMatch(/cc hook test/);
  });

  it("defaults a missing matcher to * and tolerates non-command hooks", () => {
    const out = formatSettingsHooks({
      Stop: [{ hooks: [{ type: "weird" }] }],
    });
    expect(out).toMatch(/matcher \*/);
    expect(out).toMatch(/\(weird hook\)/);
  });

  it("tolerates malformed entries without throwing", () => {
    const out = formatSettingsHooks({ PreToolUse: [{ hooks: [null] }] });
    expect(out).toMatch(/\(invalid hook\)/);
  });
});
