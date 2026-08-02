import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessBackgroundLaunchProfileCompatibility,
  buildArgvFromBackgroundLaunchProfile,
  canonicalBackgroundLaunchProfileJson,
  captureBackgroundLaunchProfile,
  fingerprintBackgroundLaunchProfile,
  refreshBackgroundLaunchProfileSources,
  sanitizeBackgroundBaseUrl,
  stripBackgroundLaunchSecrets,
  verifyBackgroundLaunchProfileSources,
} from "../../src/lib/background-launch-profile.js";

let dir;
let previousHome;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-bg-profile-")));
  previousHome = process.env.CHAINLESSCHAIN_HOME;
  process.env.CHAINLESSCHAIN_HOME = join(dir, "home");
  mkdirSync(process.env.CHAINLESSCHAIN_HOME, { recursive: true });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
  else process.env.CHAINLESSCHAIN_HOME = previousHome;
  rmSync(dir, { recursive: true, force: true });
});

function capture(argv) {
  return captureBackgroundLaunchProfile({
    argv,
    cwd: dir,
    governance: {
      permissionMode: "manual",
      resourceBudget: { maxTurns: 12, maxCostUsd: 4.5 },
    },
  });
}

describe("background launch profile", () => {
  it("captures a versioned effective envelope without prompt or credentials", () => {
    const settings = join(dir, "settings.json");
    const mcp = join(dir, "mcp.json");
    const bundle = join(dir, "bundle");
    const extra = join(dir, "extra");
    writeFileSync(
      settings,
      JSON.stringify({ env: { PRIVATE_TOKEN: "settings-env-secret" } }),
    );
    writeFileSync(mcp, JSON.stringify({ bearer: "mcp-secret" }));
    mkdirSync(bundle);
    writeFileSync(join(bundle, "AGENTS.md"), "bundle-private-text");
    mkdirSync(extra);

    const profile = capture([
      "agent",
      "fix",
      "the",
      "bug",
      "--provider",
      "openai",
      "--model",
      "gpt-test",
      "--base-url",
      "https://user:password@example.test/v1?api_key=query-secret#fragment",
      "--api-key",
      "argv-api-secret",
      "--allowed-tools",
      "read_file,run_shell",
      "--disallowed-tools",
      "delete_file",
      "--permission-mode",
      "acceptEdits",
      "--sandbox",
      "sandbox-image",
      "--sandbox-mode",
      "strict",
      "--mcp-config",
      mcp,
      "--strict-mcp-config",
      "--settings",
      settings,
      "--bundle",
      bundle,
      "--add-dir",
      extra,
      "--max-turns",
      "8",
      "--max-budget-usd",
      "2.25",
      "--system-prompt",
      "system-prompt-secret",
      "-p",
      "task-prompt-secret",
    ]);

    expect(profile).toMatchObject({
      version: 1,
      command: "agent",
      llm: {
        provider: "openai",
        model: "gpt-test",
        baseUrl: "https://example.test/v1",
        baseUrlRedacted: true,
      },
      tools: {
        allowed: ["read_file", "run_shell"],
        disallowed: ["delete_file"],
      },
      permission: { mode: "acceptEdits" },
      sandbox: { enabled: true, image: "sandbox-image", mode: "strict" },
      mcp: { configFile: mcp, strict: true },
      settings: { file: settings },
      plugins: { bundle },
      workspace: { cwd: dir, addDirs: [extra] },
      budget: { maxTurns: 8, maxCostUsd: 2.25 },
      credentials: { apiKey: "external" },
    });
    expect(profile.omitted).toEqual(
      expect.arrayContaining(["apiKey", "systemPrompt", "taskPrompt"]),
    );
    expect(profile.configuration.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: settings, kind: "file" }),
        expect.objectContaining({ path: mcp, kind: "file" }),
        expect.objectContaining({ path: bundle, kind: "directory" }),
      ]),
    );

    const persisted = JSON.stringify(profile);
    for (const secret of [
      "password",
      "query-secret",
      "argv-api-secret",
      "system-prompt-secret",
      "task-prompt-secret",
      "settings-env-secret",
      "mcp-secret",
      "bundle-private-text",
    ]) {
      expect(persisted).not.toContain(secret);
    }
  });

  it("uses canonical JSON for stable fingerprints and changes on policy drift", () => {
    const first = capture([
      "agent",
      "task one",
      "--model",
      "m1",
      "--allowed-tools",
      "run_shell,read_file",
      "--disallowed-tools",
      "write_file,delete_file",
    ]);
    const reordered = capture([
      "agent",
      "another task",
      "--disallowed-tools",
      "delete_file,write_file",
      "--allowed-tools",
      "read_file,run_shell",
      "--model",
      "m1",
    ]);

    expect(canonicalBackgroundLaunchProfileJson(first)).toBe(
      canonicalBackgroundLaunchProfileJson(reordered),
    );
    expect(fingerprintBackgroundLaunchProfile(first)).toBe(
      fingerprintBackgroundLaunchProfile(reordered),
    );

    const changedModel = structuredClone(first);
    changedModel.llm.model = "m2";
    const loosenedPermission = structuredClone(first);
    loosenedPermission.permission.dangerousBypass = true;
    const loosenedBudget = structuredClone(first);
    loosenedBudget.budget.maxTurns = null;
    const loosenedMode = structuredClone(first);
    loosenedMode.permission.mode = "bypassPermissions";
    const loosenedTools = structuredClone(first);
    loosenedTools.tools.allowed = null;
    const fallbackOrderOne = capture([
      "agent",
      "task",
      "--fallback-model",
      "first,second",
    ]);
    const fallbackOrderTwo = capture([
      "agent",
      "task",
      "--fallback-model",
      "second,first",
    ]);
    for (const changed of [changedModel, loosenedPermission, loosenedBudget]) {
      expect(fingerprintBackgroundLaunchProfile(changed)).not.toBe(
        fingerprintBackgroundLaunchProfile(first),
      );
    }

    expect(
      assessBackgroundLaunchProfileCompatibility(first, changedModel),
    ).toMatchObject({ compatible: false, reasons: ["model-changed"] });
    expect(
      assessBackgroundLaunchProfileCompatibility(first, loosenedPermission)
        .reasons,
    ).toContain("permission-bypass-enabled");
    expect(
      assessBackgroundLaunchProfileCompatibility(first, loosenedBudget).reasons,
    ).toContain("budget-loosened");
    expect(
      assessBackgroundLaunchProfileCompatibility(first, loosenedMode).reasons,
    ).toContain("permission-mode-loosened");
    expect(
      assessBackgroundLaunchProfileCompatibility(first, loosenedTools).reasons,
    ).toContain("tool-policy-loosened");
    expect(fingerprintBackgroundLaunchProfile(fallbackOrderOne)).not.toBe(
      fingerprintBackgroundLaunchProfile(fallbackOrderTwo),
    );
  });

  it("rebuilds resumable argv while keeping redacted values out", () => {
    const profile = capture([
      "agent",
      "do not persist me",
      "--provider",
      "openai",
      "--model",
      "gpt-test",
      "--api-key=top-secret",
      "--permission-mode",
      "plan",
      "--sandbox-mode",
      "strict",
      "--allowed-tools",
      "read_file",
      "--max-turns",
      "5",
    ]);
    const argv = buildArgvFromBackgroundLaunchProfile(profile);

    expect(argv).toEqual(
      expect.arrayContaining([
        "agent",
        "--provider",
        "openai",
        "--model",
        "gpt-test",
        "--permission-mode",
        "plan",
        "--sandbox-mode",
        "strict",
        "--max-turns",
        "5",
      ]),
    );
    expect(JSON.stringify(argv)).not.toContain("top-secret");
    expect(JSON.stringify(argv)).not.toContain("do not persist me");
    expect(argv).not.toContain("--api-key");
  });

  it("detects configuration content changes and can refresh explicitly", () => {
    const settings = join(dir, "settings.json");
    writeFileSync(settings, JSON.stringify({ model: "one" }));
    const profile = capture(["agent", "task", "--settings", settings]);
    expect(verifyBackgroundLaunchProfileSources(profile)).toMatchObject({
      valid: true,
      issues: [],
    });

    writeFileSync(settings, JSON.stringify({ model: "two" }));
    const check = verifyBackgroundLaunchProfileSources(profile);
    expect(check.valid).toBe(false);
    expect(check.issues).toEqual([`configuration-source-changed:${settings}`]);
    const refreshed = refreshBackgroundLaunchProfileSources(profile);
    expect(verifyBackgroundLaunchProfileSources(refreshed).valid).toBe(true);
    expect(fingerprintBackgroundLaunchProfile(refreshed)).not.toBe(
      fingerprintBackgroundLaunchProfile(profile),
    );
  });

  it("sanitizes base URLs and strips both API key argv forms", () => {
    expect(
      sanitizeBackgroundBaseUrl("https://u:p@example.test/v1?token=x#y"),
    ).toEqual({ value: "https://example.test/v1", redacted: true });
    expect(sanitizeBackgroundBaseUrl("file:///secret")).toEqual({
      value: null,
      redacted: true,
    });
    expect(
      stripBackgroundLaunchSecrets([
        "agent",
        "--api-key",
        "first",
        "--model",
        "m",
        "--api-key=second",
      ]),
    ).toEqual({ argv: ["agent", "--model", "m"], apiKey: "second" });
    expect(
      stripBackgroundLaunchSecrets([
        "agent",
        "--",
        "mention",
        "--api-key",
        "as task text",
      ]),
    ).toEqual({
      argv: ["agent", "--", "mention", "--api-key", "as task text"],
      apiKey: null,
    });
  });
});
