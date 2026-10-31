import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessBackgroundLaunchProfileCompatibility as assess,
  buildArgvFromBackgroundLaunchProfile as buildArgv,
  canonicalBackgroundLaunchProfileJson as canonicalJson,
  captureBackgroundLaunchProfile as captureProfile,
  fingerprintBackgroundLaunchProfile as fingerprint,
  normalizeBackgroundLaunchProfile as normalize,
} from "../../src/lib/background-launch-profile.js";

let dir;
let previousHome;
let previousManagedSettings;

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "cc-verify-36-")));
  previousHome = process.env.CHAINLESSCHAIN_HOME;
  previousManagedSettings = process.env.CC_MANAGED_SETTINGS;
  process.env.CHAINLESSCHAIN_HOME = join(dir, "home");
  process.env.CC_MANAGED_SETTINGS = join(dir, "managed-settings.json");
  mkdirSync(process.env.CHAINLESSCHAIN_HOME, { recursive: true });
  // Bound ancestor discovery and give every round trip the same real sources.
  mkdirSync(join(dir, ".git"));
  mkdirSync(join(dir, ".chainlesschain"));
  writeFileSync(join(dir, ".chainlesschain", "config.json"), "{}");
  writeFileSync(process.env.CC_MANAGED_SETTINGS, "{}");
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
  else process.env.CHAINLESSCHAIN_HOME = previousHome;
  if (previousManagedSettings === undefined)
    delete process.env.CC_MANAGED_SETTINGS;
  else process.env.CC_MANAGED_SETTINGS = previousManagedSettings;
  rmSync(dir, { recursive: true, force: true });
});

function capture(argv = ["agent"]) {
  return captureProfile({ argv, cwd: dir });
}

function saveAndRead(profile) {
  const file = join(dir, "saved-launch-profile.json");
  writeFileSync(file, canonicalJson(profile));
  return JSON.parse(readFileSync(file, "utf8"));
}

function restore(profile) {
  return capture(buildArgv(saveAndRead(profile)));
}

function expectSameIdentity(before, after) {
  expect(after).toEqual(before);
  expect(canonicalJson(after)).toBe(canonicalJson(before));
  expect(fingerprint(after)).toBe(fingerprint(before));
  expect(assess(before, after)).toEqual({ compatible: true, reasons: [] });
}

describe("verify-36: persisted launch policy identity", () => {
  it("preserves a restrictive nonempty policy through disk, argv and recapture", () => {
    const settings = join(dir, "settings.json");
    const mcp = join(dir, "mcp.json");
    writeFileSync(settings, "{}");
    writeFileSync(mcp, '{"mcpServers":{}}');
    const before = capture([
      "agent",
      "--provider",
      "openai",
      "--model",
      "primary",
      "--fallback-model",
      "second",
      "--fallback-model",
      "third",
      "--allowed-tools",
      "write_file,read_file,read_file",
      "--disallowed-tools",
      "run_shell,delete_file",
      "--permission-mode",
      "plan",
      "--sandbox",
      "test-image",
      "--sandbox-mode",
      "strict",
      "--strict-mcp-config",
      "--mcp-config",
      mcp,
      "--settings",
      settings,
      "--max-turns",
      "7",
      "--max-budget-usd",
      "1.25",
      "--no-checkpoint",
      "--safe-mode",
    ]);
    // Independent expected values prevent equal-but-wrong round trips passing.
    expect(before.tools).toEqual({
      allowed: ["read_file", "write_file"],
      disallowed: ["delete_file", "run_shell"],
    });
    expect(before.permission.mode).toBe("plan");
    expect(before.sandbox).toEqual({
      enabled: true,
      image: "test-image",
      mode: "strict",
      network: false,
    });
    expect(before.budget).toMatchObject({ maxTurns: 7, maxCostUsd: 1.25 });
    expect(before.llm.fallbackModels).toEqual(["second", "third"]);
    expectSameIdentity(before, normalize(saveAndRead(before)));
    expectSameIdentity(before, restore(before));
  });

  it("keeps an explicit empty allowlist distinct from an absent allowlist", () => {
    const unrestricted = capture(["agent", "--permission-mode", "plan"]);
    const denyAll = capture([
      "agent",
      "--permission-mode",
      "plan",
      "--allowed-tools=",
    ]);
    expect(unrestricted.tools.allowed).toBeNull();
    expect(denyAll.tools.allowed).toEqual([]);
    expect(fingerprint(denyAll)).not.toBe(fingerprint(unrestricted));
    expect(assess(denyAll, unrestricted)).toEqual({
      compatible: false,
      reasons: ["tool-policy-loosened"],
    });
    expectSameIdentity(unrestricted, restore(unrestricted));
    expectSameIdentity(denyAll, normalize(saveAndRead(denyAll)));
    // Dropping the empty flag changes [] (deny all) to null (no allowlist).
    const resumed = restore(denyAll);
    expect(resumed.tools.allowed).toEqual([]);
    expectSameIdentity(denyAll, resumed);
  });

  it("does not lose persisted plugin and MCP auto-connect restrictions", () => {
    const enabled = capture(["agent", "--permission-mode", "manual"]);
    expect(enabled.plugins.disabled).toBe(false);
    expect(enabled.runtime.noMcpAutoConnect).toBe(false);
    expectSameIdentity(enabled, restore(enabled));
    // These are explicit fields accepted by the persisted-profile API, not
    // guessed CLI option names. Exercise its real argv reconstruction path.
    const restricted = structuredClone(enabled);
    restricted.plugins.disabled = true;
    restricted.runtime.noMcpAutoConnect = true;
    expectSameIdentity(restricted, normalize(saveAndRead(restricted)));
    expect(fingerprint(restricted)).not.toBe(fingerprint(enabled));
    const resumed = restore(restricted);
    expect.soft(resumed.plugins.disabled).toBe(true);
    expect.soft(resumed.runtime.noMcpAutoConnect).toBe(true);
    expectSameIdentity(restricted, resumed);
  });

  it("canonicalizes sets but retains fallback order and rejects policy drift", () => {
    const before = capture([
      "agent",
      "--allowed-tools",
      "write_file,read_file",
      "--disallowed-tools",
      "delete_file,run_shell",
      "--permission-mode",
      "plan",
      "--fallback-model",
      "second,third",
      "--sandbox",
      "image",
      "--sandbox-mode",
      "strict",
      "--max-turns",
      "5",
    ]);
    const reordered = capture([
      "agent",
      "--max-turns",
      "5",
      "--sandbox-mode",
      "strict",
      "--sandbox",
      "image",
      "--permission-mode",
      "plan",
      "--disallowed-tools",
      "run_shell,delete_file,run_shell",
      "--allowed-tools",
      "read_file,write_file,read_file",
      "--fallback-model",
      "second",
      "--fallback-model",
      "third",
    ]);
    expectSameIdentity(before, reordered);
    const mutations = [
      [
        "fallback order",
        (p) => {
          p.llm.fallbackModels = ["third", "second"];
        },
        "launch-profile-changed",
      ],
      [
        "allowlist expansion",
        (p) => {
          p.tools.allowed.push("search_files");
        },
        "tool-policy-loosened",
      ],
      [
        "denylist removal",
        (p) => {
          p.tools.disallowed = ["delete_file"];
        },
        "tool-policy-loosened",
      ],
      [
        "permission",
        (p) => {
          p.permission.mode = "auto";
        },
        "permission-mode-loosened",
      ],
      [
        "sandbox network",
        (p) => {
          p.sandbox.network = true;
        },
        "sandbox-loosened",
      ],
      [
        "turn budget",
        (p) => {
          p.budget.maxTurns = 6;
        },
        "budget-loosened",
      ],
    ];
    for (const [label, mutate, reason] of mutations) {
      const changed = structuredClone(before);
      mutate(changed);
      const persisted = saveAndRead(changed);
      expect(fingerprint(persisted), label).not.toBe(fingerprint(before));
      expect(assess(before, persisted), label).toEqual({
        compatible: false,
        reasons: [reason],
      });
    }
  });

  it("rejects corrupt persisted policies instead of normalizing them to broader defaults", () => {
    const valid = capture([
      "agent",
      "--permission-mode",
      "plan",
      "--allowed-tools",
      "read_file",
      "--sandbox",
      "image",
      "--sandbox-mode",
      "strict",
      "--max-turns",
      "5",
    ]);
    const boundaries = [
      ["normalize", normalize],
      ["build argv", buildArgv],
      ["canonical JSON", canonicalJson],
      ["fingerprint", fingerprint],
    ];
    const corruptions = [
      [
        "unsupported version",
        (p) => {
          p.version = 999;
        },
      ],
      [
        "permission enum",
        (p) => {
          p.permission.mode = "plna";
        },
      ],
      [
        "sandbox enum",
        (p) => {
          p.sandbox.mode = "strcit";
        },
      ],
      [
        "MCP tri-state",
        (p) => {
          p.mcp.ide = "disabeld";
        },
      ],
      [
        "allowlist type",
        (p) => {
          p.tools.allowed = "read_file";
        },
      ],
      [
        "boolean type",
        (p) => {
          p.permission.dangerousBypass = "true";
        },
      ],
      [
        "negative turn limit",
        (p) => {
          p.budget.maxTurns = -1;
        },
      ],
      [
        "nonnumeric cost limit",
        (p) => {
          p.budget.maxCostUsd = "invalid";
        },
      ],
    ];
    for (const [name, boundary] of boundaries) {
      expect(
        () => boundary(saveAndRead(valid)),
        `${name}: valid control`,
      ).not.toThrow();
    }
    const file = join(dir, "corrupt-launch-profile.json");
    for (const [label, mutate] of corruptions) {
      const corrupt = structuredClone(valid);
      mutate(corrupt);
      // Use raw JSON here: canonicalJson is itself a validation boundary and
      // must not silently repair the corruption before the restore API sees it.
      writeFileSync(file, JSON.stringify(corrupt));
      const loaded = JSON.parse(readFileSync(file, "utf8"));
      for (const [name, boundary] of boundaries) {
        expect.soft(() => boundary(loaded), `${name}: ${label}`).toThrow();
      }
    }
  });

  it("rejects invalid CLI policy values at capture with otherwise valid prerequisites", () => {
    const valid = [
      "agent",
      "--allowed-tools",
      "read_file",
      "--permission-mode",
      "plan",
      "--sandbox",
      "image",
      "--sandbox-mode",
      "strict",
      "--max-turns",
      "5",
      "--max-budget-usd",
      "1.25",
    ];
    expect(capture(valid)).toMatchObject({
      permission: { mode: "plan" },
      sandbox: { mode: "strict" },
      tools: { allowed: ["read_file"] },
      budget: { maxTurns: 5 },
    });
    const invalidValues = [
      ["--permission-mode", "plna"],
      ["--sandbox-mode", "strcit"],
      ["--max-turns", "-1"],
      ["--max-turns", "not-a-number"],
      ["--max-turns", "1.5"],
      ["--max-turns", "1e2"],
      ["--max-turns", "0x10"],
      ["--max-turns", "9007199254740992"],
      ["--max-budget-usd", "invalid"],
      ["--max-budget-usd", ""],
      ["--max-budget-usd", "-1"],
    ];
    for (const [flag, value] of invalidValues) {
      const argv = [...valid];
      argv[argv.indexOf(flag) + 1] = value;
      expect.soft(() => capture(argv), `${flag}=${value}`).toThrow();
    }
    // A required policy option with no value is not an unrestricted default.
    expect
      .soft(() =>
        capture(["agent", "--allowed-tools", "read_file", "--permission-mode"]),
      )
      .toThrow();
  });
});
