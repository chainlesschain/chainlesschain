/** --safe-mode (CC 2.1.169 parity): aggregate kill-switch + the two new gates. */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "module";
import {
  applySafeMode,
  safeModeRequested,
  SAFE_MODE_SWITCHES,
} from "../../src/lib/safe-mode.js";
import { recallStartupMemories } from "../../src/lib/memory-injection.js";

const require_ = createRequire(import.meta.url);
const { loadHooks } = require_("../../src/lib/settings-hooks.cjs");

afterEach(() => {
  delete process.env.CC_SETTINGS_HOOKS;
  delete process.env.CC_MEMORY_INJECT;
});

describe("applySafeMode", () => {
  it("flips every customization kill-switch on the given env", () => {
    const env = {};
    const applied = applySafeMode(env);
    expect(env).toEqual({ ...SAFE_MODE_SWITCHES });
    expect(applied.sort()).toEqual(Object.keys(SAFE_MODE_SWITCHES).sort());
    // the safety-relevant surfaces are deliberately NOT in the list
    expect(env.CC_PERMISSION_RULES).toBeUndefined();
  });
});

describe("safeModeRequested (flag OR env, Claude-Code 2.1.169)", () => {
  it("true for the explicit --safe-mode flag", () => {
    expect(safeModeRequested({ safeMode: true }, {})).toBe(true);
  });
  it("true for CC_SAFE_MODE or CLAUDE_CODE_SAFE_MODE env (1/true/yes/on)", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(safeModeRequested({}, { CC_SAFE_MODE: v })).toBe(true);
      expect(safeModeRequested({}, { CLAUDE_CODE_SAFE_MODE: v })).toBe(true);
    }
  });
  it("false with no flag and no/false env", () => {
    expect(safeModeRequested({}, {})).toBe(false);
    expect(safeModeRequested({ safeMode: false }, { CC_SAFE_MODE: "0" })).toBe(
      false,
    );
    expect(safeModeRequested({}, { CC_SAFE_MODE: "off" })).toBe(false);
  });
});

describe("CC_SETTINGS_HOOKS gate", () => {
  it("loadHooks returns no hooks when the switch is set", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-safemode-"));
    try {
      fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".claude", "settings.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }],
          },
        }),
        "utf-8",
      );
      const withHooks = loadHooks({ cwd: tmp });
      expect(Object.keys(withHooks.hooks)).toContain("PreToolUse");

      process.env.CC_SETTINGS_HOOKS = "0";
      const bare = loadHooks({ cwd: tmp });
      expect(Object.keys(bare.hooks)).toHaveLength(0);
      expect(bare.files).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("CC_MEMORY_INJECT gate", () => {
  it("recallStartupMemories returns [] when the switch is set", () => {
    const store = {
      recall: () => [{ id: "m1", content: "remembered", relevance: 1 }],
    };
    expect(
      recallStartupMemories({ memoryStore: store }).length,
    ).toBeGreaterThan(0);
    process.env.CC_MEMORY_INJECT = "0";
    expect(recallStartupMemories({ memoryStore: store })).toEqual([]);
  });
});
