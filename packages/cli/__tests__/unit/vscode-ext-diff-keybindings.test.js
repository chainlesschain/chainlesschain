/**
 * Manifest wiring for the diff-review keybindings (Claude-Code IDE parity):
 * the Accept/Reject commands must be declared and bound to Cmd/Ctrl+Enter and
 * Cmd/Ctrl+Shift+Backspace, scoped to the chainlesschainDiffActive context so
 * they're inert unless openDiff is actually blocking on a review. The facade
 * behaviour (acceptActiveDiff/rejectActiveDiff) is covered in
 * vscode-ext-diff-close-reject.test.js.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../vscode-extension/package.json", import.meta.url),
    ),
    "utf-8",
  ),
);

describe("diff-review keybinding manifest", () => {
  const commands = pkg.contributes?.commands || [];
  const keybindings = pkg.contributes?.keybindings || [];

  it("declares the Accept and Reject commands", () => {
    const ids = commands.map((c) => c.command);
    expect(ids).toContain("chainlesschain.diff.accept");
    expect(ids).toContain("chainlesschain.diff.reject");
  });

  it("binds Accept to Cmd/Ctrl+Enter, scoped to an active review", () => {
    const kb = keybindings.find(
      (k) => k.command === "chainlesschain.diff.accept",
    );
    expect(kb).toBeTruthy();
    expect(kb.key).toBe("ctrl+enter");
    expect(kb.mac).toBe("cmd+enter");
    expect(kb.when).toBe("chainlesschainDiffActive");
  });

  it("binds Reject to Cmd/Ctrl+Shift+Backspace, scoped to an active review", () => {
    const kb = keybindings.find(
      (k) => k.command === "chainlesschain.diff.reject",
    );
    expect(kb).toBeTruthy();
    expect(kb.key).toBe("ctrl+shift+backspace");
    expect(kb.mac).toBe("cmd+shift+backspace");
    expect(kb.when).toBe("chainlesschainDiffActive");
  });

  it("does not steal a bare Enter/Backspace (the diff right pane is editable)", () => {
    for (const k of keybindings) {
      if (
        k.command === "chainlesschain.diff.accept" ||
        k.command === "chainlesschain.diff.reject"
      ) {
        // modifier-qualified only — never a lone Enter/Backspace that would
        // fire while the reviewer is editing the proposal in the right pane.
        expect(k.key).toMatch(/\+/);
      }
    }
  });
});
