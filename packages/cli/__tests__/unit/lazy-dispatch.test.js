import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { resolveCommandToken } from "../../src/lazy-dispatch.js";
import { createProgram } from "../../src/index.js";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(
  readFileSync(join(cliRoot, "src", "command-manifest.json"), "utf-8"),
);

describe("command manifest ⇄ eager program (drift guard)", () => {
  // The lazy dispatcher trusts the generated manifest to map a command name to
  // its module. If a command is added/removed/renamed without regenerating the
  // manifest (node scripts/gen-command-manifest.mjs), the lazy path would 404
  // it to the eager fallback (slow) or miss an alias. This test makes that a
  // red CI signal instead of a silent slowdown.
  const eager = createProgram();
  const eagerNames = eager.commands.map((c) => c.name()).sort();
  const manifestNames = manifest.commands.map((c) => c.name).sort();

  it("every eager top-level command is in the manifest", () => {
    const missing = eagerNames.filter((n) => !manifestNames.includes(n));
    expect(
      missing,
      `Run: node scripts/gen-command-manifest.mjs — missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the manifest has no commands the eager program lacks", () => {
    const extra = manifestNames.filter((n) => !eagerNames.includes(n));
    expect(
      extra,
      `Stale manifest entries — run: node scripts/gen-command-manifest.mjs — extra: ${extra.join(", ")}`,
    ).toEqual([]);
  });

  it("manifest aliases match the eager program's aliases", () => {
    const eagerAliases = {};
    for (const c of eager.commands) eagerAliases[c.name()] = c.aliases().sort();
    for (const entry of manifest.commands) {
      const expected = eagerAliases[entry.name] || [];
      expect(
        (entry.aliases || []).slice().sort(),
        `aliases drift for "${entry.name}"`,
      ).toEqual(expected);
    }
  });

  it("every manifest entry points at an importable module + register fn name", () => {
    for (const entry of manifest.commands) {
      expect(entry.module, `module for ${entry.name}`).toMatch(/^\.\/.+\.js$/);
      expect(entry.register, `register fn for ${entry.name}`).toMatch(
        /^register/,
      );
    }
  });
});

describe("resolveCommandToken", () => {
  const argv = (...rest) => ["node", "cc", ...rest];

  it("returns the first positional as the command", () => {
    expect(resolveCommandToken(argv("status"))).toBe("status");
    expect(resolveCommandToken(argv("hub", "ask", "hi"))).toBe("hub");
  });

  it("skips leading global flags", () => {
    expect(resolveCommandToken(argv("--verbose", "status"))).toBe("status");
    expect(resolveCommandToken(argv("--quiet", "--verbose", "doctor"))).toBe(
      "doctor",
    );
  });

  it("returns null for version/help flags with no command", () => {
    expect(resolveCommandToken(argv("--version"))).toBeNull();
    expect(resolveCommandToken(argv("-v"))).toBeNull();
    expect(resolveCommandToken(argv("--help"))).toBeNull();
    expect(resolveCommandToken(argv())).toBeNull();
  });

  it("stops scanning at -- (end of options)", () => {
    expect(resolveCommandToken(argv("--", "status"))).toBeNull();
  });
});
