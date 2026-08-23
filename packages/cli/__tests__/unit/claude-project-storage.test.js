import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const secureFsCalls = vi.hoisted(() => ({
  privateFiles: [],
  repairedDirectories: [],
}));

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
    ensurePrivateFile: (target, options) => {
      secureFsCalls.privateFiles.push({ target, options });
    },
    repairPrivatePaths: (targets, options) => {
      secureFsCalls.repairedDirectories.push({ targets, options });
      return [];
    },
  };
});

import {
  captureClaudeStorageLaunchEnvironment,
  CLAUDE_AUTO_MEMORY_BINDING_FILE,
  resolveClaudeProjectAutoMemory,
  restoreClaudeStorageLaunchEnvironment,
  validateClaudeStorageLaunchEnvironment,
} from "../../src/lib/claude-project-auto-memory.js";
import { CLIPermanentMemory } from "../../src/lib/permanent-memory.js";
import { resolveConfigDataRoot } from "../../src/lib/paths.js";
import { resolveReplPermanentMemoryStorage } from "../../src/repl/agent-repl.js";
import { listSessions as listLegacyResumeSessions } from "../../src/lib/resume-session.js";
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
  "ProgramData",
  "PROGRAMDATA",
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

function canonicalTestPath(target) {
  return join(realpathSync.native(root), relative(root, target));
}

beforeEach(() => {
  secureFsCalls.privateFiles.length = 0;
  secureFsCalls.repairedDirectories.length = 0;
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
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "true";
    registerTestAnchor(nativeHome);

    expect(resolveConfigDataRoot({ cwd: workspace })).toMatchObject({
      path: nativeHome,
      source: "chainlesschain",
    });
    const id = startSession("native-root-wins");
    expect(sessionPath(id)).toBe(join(nativeHome, "sessions", `${id}.jsonl`));
    expect(sessionStoreDir()).toBe(join(nativeHome, "sessions"));
    expect(resolveClaudeProjectAutoMemory({ cwd: workspace })).toMatchObject({
      mode: "legacy",
      enabled: true,
    });
  });

  it("uses the exact CLAUDE_CONFIG_DIR/projects/<name> transcript layout", () => {
    configureClaudeProject("repo-main");
    registerTestAnchor(join(configRoot, "projects", "repo-main"));
    const id = startSession("claude-layout");
    const expected = join(configRoot, "projects", "repo-main");

    expect(sessionPath(id)).toBe(join(expected, `${id}.jsonl`));
    expect(sessionStoreDir()).toBe(expected);
    expect(existsSync(sessionPath(id))).toBe(true);
  });

  it("isolates same-id transcript anchors and host leases by project bucket", () => {
    const id = "same-id-in-two-projects";
    configureClaudeProject("project-a");
    const projectA = join(configRoot, "projects", "project-a");
    registerTestAnchor(projectA);
    startSession(id);
    const transcriptA = sessionPath(id);

    configureClaudeProject("project-b");
    const projectB = join(configRoot, "projects", "project-b");
    registerTestAnchor(projectB);
    startSession(id);
    const transcriptB = sessionPath(id);

    expect(transcriptA).toBe(join(projectA, `${id}.jsonl`));
    expect(transcriptB).toBe(join(projectB, `${id}.jsonl`));
    expect(existsSync(transcriptA)).toBe(true);
    expect(existsSync(transcriptB)).toBe(true);
    expect(existsSync(join(projectA, "session-host-leases"))).toBe(true);
    expect(existsSync(join(projectB, "session-host-leases"))).toBe(true);
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

  it("routes legacy resume compatibility files through the active project store", () => {
    configureClaudeProject("resume-layout");
    const projectDir = join(configRoot, "projects", "resume-layout");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "legacy-resume.json"),
      JSON.stringify({ title: "legacy-compatible" }),
    );

    expect(listLegacyResumeSessions()).toEqual([
      expect.objectContaining({
        id: "legacy-resume",
        file: join(projectDir, "legacy-resume.json"),
      }),
    ]);
  });

  it("refuses relative, device-namespace, and workspace-local config roots", () => {
    for (const candidate of [
      "relative-claude-config",
      "\\\\?\\C:\\unsafe",
      "C:\\Users",
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

  it("fails closed and redacts a broad custom auto-memory root", () => {
    configureClaudeProject("broad-custom-memory");
    mkdirSync(configRoot, { recursive: true });
    writeFileSync(
      join(configRoot, "settings.json"),
      JSON.stringify({ autoMemoryDirectory: "C:\\Users" }),
    );

    const plan = resolveClaudeProjectAutoMemory({ cwd: workspace });
    expect(plan).toMatchObject({
      enabled: false,
      memoryDir: null,
      reason: "CC_AUTO_MEMORY_DIRECTORY_INVALID",
    });
    expect(JSON.stringify(plan)).not.toContain("C:\\Users");
  });

  it("bounds oversized trusted settings and falls back to bound project memory", () => {
    configureClaudeProject("bounded-settings");
    mkdirSync(configRoot, { recursive: true });
    writeFileSync(
      join(configRoot, "settings.json"),
      JSON.stringify({
        autoMemoryDirectory: join(root, "must-not-be-read"),
        padding: "x".repeat(256 * 1024),
      }),
    );

    const plan = resolveClaudeProjectAutoMemory({ cwd: workspace });
    expect(plan).toMatchObject({ enabled: true, source: "default" });
    expect(plan.memoryDir).toBe(
      join(configRoot, "projects", "bounded-settings", "memory"),
    );
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
      memoryDir: canonicalTestPath(userCustom),
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
      memoryDir: canonicalTestPath(managedCustom),
    });
  });

  it.skipIf(process.platform !== "win32")(
    "keeps the launch ProgramData managed-settings authority immutable",
    () => {
      configureClaudeProject("managed-program-data");
      const launchProgramData = join(root, "launch-program-data");
      const managedSettings = join(
        launchProgramData,
        "ChainlessChain",
        "managed-settings.json",
      );
      const managedMemory = join(configRoot, "managed-program-data-memory");
      mkdirSync(join(launchProgramData, "ChainlessChain"), {
        recursive: true,
      });
      writeFileSync(
        managedSettings,
        JSON.stringify({ autoMemoryDirectory: managedMemory }),
      );
      process.env.ProgramData = launchProgramData;
      const launch = captureClaudeStorageLaunchEnvironment();
      process.env.ProgramData = join(workspace, "attacker-program-data");

      expect(
        resolveClaudeProjectAutoMemory({ cwd: workspace, launchEnv: launch }),
      ).toMatchObject({
        enabled: true,
        source: "managed",
        memoryDir: canonicalTestPath(managedMemory),
      });
    },
  );

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

  it("persists automatic memory file-only and never crosses project buckets", () => {
    const forbiddenSharedDb = {
      exec: vi.fn(() => {
        throw new Error("project memory must not use the shared DB");
      }),
      prepare: vi.fn(() => {
        throw new Error("project memory must not use the shared DB");
      }),
    };
    configureClaudeProject("memory-project-a");
    const storageA = resolveReplPermanentMemoryStorage(
      {},
      forbiddenSharedDb,
      workspace,
    );
    expect(storageA).toMatchObject({ db: null });
    const memoryA = new CLIPermanentMemory(storageA);
    memoryA.initialize();
    memoryA.autoSummarize([
      { role: "user", content: "alpha-only-memory-token" },
      { role: "assistant", content: "ack" },
      { role: "user", content: "alpha detail" },
      { role: "assistant", content: "done" },
    ]);
    expect(
      new CLIPermanentMemory(storageA).getRelevantContext(
        "alpha-only-memory-token",
      ),
    ).not.toEqual([]);

    configureClaudeProject("memory-project-b");
    const storageB = resolveReplPermanentMemoryStorage(
      {},
      forbiddenSharedDb,
      workspace,
    );
    expect(storageB).toMatchObject({ db: null });
    expect(storageB.memoryDir).not.toBe(storageA.memoryDir);
    expect(
      new CLIPermanentMemory(storageB).getRelevantContext(
        "alpha-only-memory-token",
      ),
    ).toEqual([]);
    expect(forbiddenSharedDb.exec).not.toHaveBeenCalled();
    expect(forbiddenSharedDb.prepare).not.toHaveBeenCalled();
  });

  it("repairs existing automatic-memory content files before they are loaded", () => {
    configureClaudeProject("existing-memory-files");
    const memoryDir = join(
      configRoot,
      "projects",
      "existing-memory-files",
      "memory",
    );
    const memoryFile = join(memoryDir, "MEMORY.md");
    const dailyFile = join(memoryDir, "daily", "2026-08-22.md");
    mkdirSync(join(memoryDir, "daily"), { recursive: true });
    writeFileSync(memoryFile, "# Memory\n");
    writeFileSync(dailyFile, "# Daily\n");

    expect(resolveClaudeProjectAutoMemory({ cwd: workspace })).toMatchObject({
      enabled: true,
    });
    for (const filePath of [memoryFile, dailyFile]) {
      expect(secureFsCalls.privateFiles).toContainEqual({
        target: filePath,
        options: { applyWindowsAcl: true, failIfUnavailable: true },
      });
    }
    if (process.platform === "win32") {
      expect(secureFsCalls.repairedDirectories).toContainEqual(
        expect.objectContaining({
          targets: expect.arrayContaining([
            memoryDir,
            join(memoryDir, "daily"),
          ]),
          options: { platform: "win32" },
        }),
      );
    }
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
