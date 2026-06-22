"use strict";

/**
 * resolveSlashMacro tests (previously untested) — the REPL's user-command-macro
 * wire (.claude/commands/*.md). The routing safety matters: a leading `/name`
 * that resolves to a macro is expanded, but plain text or an unknown `/...`
 * (e.g. asking about "/etc/hosts") must pass through verbatim to the LLM and
 * never be swallowed. Deps (getCommand/expandCommand) are injected; no I/O.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveSlashMacro } from "../slash-macro.js";

const deps = (macro, expand = { prompt: "EXPANDED", warnings: [] }) => ({
  getCommand: vi.fn(() => macro),
  expandCommand: vi.fn(() => expand),
});

describe("resolveSlashMacro", () => {
  it("returns plain text unchanged (no slash)", async () => {
    const r = await resolveSlashMacro("  just a question  ", {
      deps: deps(null),
    });
    expect(r.matched).toBe(false);
    expect(r.promptText).toBe("just a question"); // trimmed
  });

  it("passes an unknown /... through verbatim (does not swallow /etc/hosts)", async () => {
    const d = deps(null);
    const r = await resolveSlashMacro("/etc/hosts is interesting", { deps: d });
    expect(r.matched).toBe(false);
    expect(r.promptText).toBe("/etc/hosts is interesting");
    // first token after the slash was probed, but no macro matched
    expect(d.getCommand).toHaveBeenCalledWith("etc/hosts", expect.any(String));
  });

  it("expands a resolved macro and reports its name/scope", async () => {
    const macro = { name: "deploy", scope: "project" };
    const d = deps(macro);
    const r = await resolveSlashMacro("/deploy prod fast", {
      deps: d,
      cwd: "/proj",
    });
    expect(r.matched).toBe(true);
    expect(r.promptText).toBe("EXPANDED");
    expect(r.name).toBe("deploy");
    expect(r.scope).toBe("project");
    expect(d.getCommand).toHaveBeenCalledWith("deploy", "/proj");
    expect(d.expandCommand).toHaveBeenCalledWith(macro, ["prod", "fast"], {
      cwd: "/proj",
    });
  });

  it("propagates warnings from expandCommand", async () => {
    const d = deps(
      { name: "x", scope: "personal" },
      {
        prompt: "P",
        warnings: ["missing $2"],
      },
    );
    const r = await resolveSlashMacro("/x a", { deps: d });
    expect(r.warnings).toEqual(["missing $2"]);
  });

  it("does not treat a bare '/' as a command", async () => {
    const d = deps({ name: "should-not-fire", scope: "project" });
    const r = await resolveSlashMacro("/", { deps: d });
    expect(r.matched).toBe(false);
    expect(d.getCommand).not.toHaveBeenCalled(); // empty head → never probed
  });

  it("handles empty/nullish input", async () => {
    expect((await resolveSlashMacro("", { deps: deps(null) })).matched).toBe(
      false,
    );
    expect(
      (await resolveSlashMacro(null, { deps: deps(null) })).promptText,
    ).toBe("");
  });
});
