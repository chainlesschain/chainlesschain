import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Windows ACL behavior is covered by secure-fs' injected cross-platform
// tests. Project-storage tests exercise routing and identity; launching a
// PowerShell ACL repair for each temporary root makes those concerns contend
// and can exhaust the regular unit-test timeout.
vi.mock("../../src/lib/secure-fs.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ensurePrivateDirectory: (target) => {
      mkdirSync(target, { recursive: true, mode: 0o700 });
      return target;
    },
    ensurePrivateFile: () => {},
  };
});

import {
  captureClaudeStorageLaunchEnvironment,
  CLAUDE_AUTO_MEMORY_BINDING_FILE,
  resolveClaudeProjectAutoMemory,
  restoreClaudeStorageLaunchEnvironment,
  validateClaudeStorageLaunchEnvironment,
} from "../../src/lib/claude-project-auto-memory.js";
import { resolveConfigDataRoot } from "../../src/lib/paths.js";
import {
  sessionPath,
  startSession,
} from "../../src/harness/jsonl-session-store.js";
import { sessionStoreDir } from "../../src/lib/session-store-guard.js";
import { _registerTestScopedSessionAntiRollbackDirectory } from "../../src/lib/session-anti-rollback-anchor.js";

const STORAGE_ENV_KEYS = [
  "CHAINLESSCHAIN_HOME",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_PROJECT_DIR_NAME",
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "CC_MANAGED_SETTINGS",
  "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME",
];

let originalEnvironment;
let root;
let configRoot;
let workspace;

function restoreEnvironment(snapshot) {
  for (const key of STORAGE_ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function configureClaudeProject(name = "safe-project") {
  process.env.CLAUDE_CONFIG_DIR = configRoot;
  process.env.CLAUDE_CODE_PROJECT_DIR_NAME = name;
}

function registerTestAnchor(homeDir) {
  _registerTestScopedSessionAntiRollbackDirectory({
    homeDir,
    anchorBase: process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME,
  });
}

beforeEach(() => {
  originalEnvironment = Object.fromEntries(
    STORAGE_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of STORAGE_ENV_KEYS) delete process.env[key];
  root = join(
    tmpdir(),
    `cc-claude-project-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  configRoot = join(root, "claude-config");
  workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = join(root, "anchors");
});

afterEach(() => {
  restoreEnvironment(originalEnvironment);
  rmSync(root, { recursive: true, force: true });
});

describe("Claude-compatible project storage", () => {
  it("keeps native CHAINLESSCHAIN_HOME authoritative over CLAUDE_CONFIG_DIR", () => {
    const nativeHome = join(root, "native-home");
    configureClaudeProject("ignored-by-native");
    process.env.CHAINLESSCHAIN_HOME = nativeHome;
    registerTestAnchor(nativeHome);

    expect(resolveConfigDataRoot({ cwd: workspace })).toMatchObject({
      path: nativeHome,
      source: "chainlesschain",
    });
    const id = startSession("native-root-wins");
    expect(sessionPath(id)).toBe(join(nativeHome, "sessions", `${id}.jsonl`));
    expect(sessionStoreDir()).toBe(join(nativeHome, "sessions"));
  });

  it("uses the exact CLAUDE_CONFIG_DIR/projects/<name> transcript layout", () => {
    configureClaudeProject("repo-main");
    registerTestAnchor(configRoot);
    const id = startSession("claude-layout");
    const expected = join(configRoot, "projects", "repo-main");

    expect(sessionPath(id)).toBe(join(expected, `${id}.jsonl`));
    expect(sessionStoreDir()).toBe(expected);
    expect(existsSync(sessionPath(id))).toBe(true);
  });

  it("ignores a project name without CLAUDE_CONFIG_DIR and fails closed for an unsafe active name", () => {
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME = "project-name-alone";
    const legacyHome = join(root, "legacy-home");
    process.env.CHAINLESSCHAIN_HOME = legacyHome;
    registerTestAnchor(legacyHome);
    const legacyId = startSession("name-alone-ignored");
    expect(sessionPath(legacyId)).toBe(
      join(legacyHome, "sessions", `${legacyId}.jsonl`),
    );

    delete process.env.CHAINLESSCHAIN_HOME;
    configureClaudeProject("../escape");
    const launch = captureClaudeStorageLaunchEnvironment();
    expect(() =>
      validateClaudeStorageLaunchEnvironment(launch, { cwd: workspace }),
    ).toThrow(
      expect.objectContaining({ code: "CLAUDE_PROJECT_DIR_NAME_UNSAFE" }),
    );
    expect(() => startSession("unsafe-project-name")).toThrow(
      expect.objectContaining({ code: "CLAUDE_PROJECT_DIR_NAME_UNSAFE" }),
    );
  });

  it("refuses relative, device-namespace, and workspace-local config roots", () => {
    for (const candidate of [
      "relative-claude-config",
      "\\\\?\\C:\\unsafe",
      join(workspace, ".claude"),
    ]) {
      expect(() =>
        resolveConfigDataRoot({
          env: { CLAUDE_CONFIG_DIR: candidate },
          cwd: workspace,
        }),
      ).toThrow(expect.objectContaining({ code: "CONFIG_HOME_UNSAFE" }));
    }
  });

  it("disables automatic memory when the launcher requests it", () => {
    configureClaudeProject("memory-disabled");
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "true";
    const plan = resolveClaudeProjectAutoMemory({ cwd: workspace });

    expect(plan).toMatchObject({
      mode: "project",
      enabled: false,
      memoryDir: null,
      reason: "disabled",
    });
    expect(
      existsSync(join(configRoot, "projects", "memory-disabled", "memory")),
    ).toBe(false);
  });

  it("uses only config-root user/managed settings for a custom auto-memory directory", () => {
    configureClaudeProject("settings-scope");
    const projectLocal = join(workspace, "project-local-memory");
    mkdirSync(join(workspace, ".claude"), { recursive: true });
    writeFileSync(
      join(workspace, ".claude", "settings.json"),
      JSON.stringify({ autoMemoryDirectory: projectLocal }),
    );

    const defaultPlan = resolveClaudeProjectAutoMemory({ cwd: workspace });
    expect(defaultPlan).toMatchObject({ enabled: true, source: "default" });
    expect(defaultPlan.memoryDir).toBe(
      join(configRoot, "projects", "settings-scope", "memory"),
    );

    const userCustom = join(configRoot, "user-memory");
    mkdirSync(configRoot, { recursive: true });
    writeFileSync(
      join(configRoot, "settings.json"),
      JSON.stringify({ autoMemoryDirectory: userCustom }),
    );
    const userPlan = resolveClaudeProjectAutoMemory({ cwd: workspace });
    expect(userPlan).toMatchObject({
      enabled: true,
      source: "user",
      memoryDir: userCustom,
    });

    const managedCustom = join(configRoot, "managed-memory");
    const managedSettings = join(root, "managed-settings.json");
    writeFileSync(
      managedSettings,
      JSON.stringify({ autoMemoryDirectory: managedCustom }),
    );
    process.env.CC_MANAGED_SETTINGS = managedSettings;
    const managedPlan = resolveClaudeProjectAutoMemory({ cwd: workspace });
    expect(managedPlan).toMatchObject({
      enabled: true,
      source: "managed",
      memoryDir: managedCustom,
    });
  });

  it("binds default memory to canonical identity and rejects a reused project bucket", () => {
    configureClaudeProject("identity-bound");
    const first = resolveClaudeProjectAutoMemory({ cwd: workspace });
    expect(first).toMatchObject({ enabled: true, source: "default" });
    const bindingPath = join(first.memoryDir, CLAUDE_AUTO_MEMORY_BINDING_FILE);
    expect(JSON.parse(readFileSync(bindingPath, "utf8"))).toMatchObject({
      repositoryId: first.repositoryId,
    });

    const replacementWorkspace = join(root, "replacement-workspace");
    mkdirSync(replacementWorkspace, { recursive: true });
    const replacement = resolveClaudeProjectAutoMemory({
      cwd: replacementWorkspace,
    });
    expect(replacement).toMatchObject({
      mode: "project",
      enabled: false,
      memoryDir: null,
      reason: "CC_AUTO_MEMORY_IDENTITY_MISMATCH",
    });
    expect(JSON.stringify(replacement)).not.toContain(replacementWorkspace);
  });

  it("shares bound auto memory across linked-worktree repository identities", () => {
    configureClaudeProject("linked-worktree");
    const main = join(root, "main");
    const linked = join(root, "linked");
    const worktreeGitDir = join(main, ".git", "worktrees", "linked");
    mkdirSync(worktreeGitDir, { recursive: true });
    mkdirSync(linked, { recursive: true });
    writeFileSync(join(worktreeGitDir, "commondir"), "../..\n");
    writeFileSync(join(linked, ".git"), `gitdir: ${worktreeGitDir}\n`);

    const mainPlan = resolveClaudeProjectAutoMemory({ cwd: main });
    const linkedPlan = resolveClaudeProjectAutoMemory({ cwd: linked });
    expect(mainPlan).toMatchObject({ enabled: true, source: "default" });
    expect(linkedPlan).toMatchObject({ enabled: true, source: "default" });
    expect(linkedPlan.repositoryId).toBe(mainPlan.repositoryId);
    expect(linkedPlan.memoryDir).toBe(mainPlan.memoryDir);
  });

  it("restores launcher storage authority after a settings env merge", () => {
    configureClaudeProject("launch-authority");
    const snapshot = captureClaudeStorageLaunchEnvironment();
    const attackerRoot = join(root, "workspace", "attacker-config");
    process.env.CLAUDE_CONFIG_DIR = attackerRoot;
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME = "attacker-project";
    process.env.CHAINLESSCHAIN_HOME = join(root, "workspace", "attacker-home");
    restoreClaudeStorageLaunchEnvironment(snapshot);

    expect(
      validateClaudeStorageLaunchEnvironment(snapshot, { cwd: workspace }),
    ).toMatchObject({
      path: configRoot,
      source: "claude",
    });
    const plan = resolveClaudeProjectAutoMemory({
      cwd: workspace,
      launchEnv: snapshot,
    });
    expect(plan).toMatchObject({ enabled: true, source: "default" });
    expect(plan.memoryDir).toBe(
      join(configRoot, "projects", "launch-authority", "memory"),
    );
    expect(plan.memoryDir).not.toContain("attacker");
  });
});
