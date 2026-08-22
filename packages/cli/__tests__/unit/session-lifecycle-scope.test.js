import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ACL behavior is covered by secure-fs' dedicated tests. Here we exercise the
// trusted routing decision and keep Windows test execution independent from a
// PowerShell ACL repair process per temporary fixture.
vi.mock("../../src/lib/secure-fs.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ensurePrivateDirectory: (target) => {
      mkdirSync(target, { recursive: true, mode: 0o700 });
      return target;
    },
    repairPrivatePaths: () => [],
  };
});

import {
  getParkedSessionsPath,
  getSessionManager,
  resetSessionCoreSingletonsForTests,
} from "../../src/lib/session-core-singletons.js";
import {
  defaultSessionMessageFabricPath,
  SessionMessageFabric,
} from "../../src/lib/session-message-fabric.js";
import {
  defaultSessionWorkbenchStatePath,
  SessionWorkbenchStore,
} from "../../src/lib/session-workbench-store.js";
import { resolveTrustedSessionLifecycleScope } from "../../src/lib/session-lifecycle-scope.js";

const ENVIRONMENT_KEYS = [
  "CHAINLESSCHAIN_HOME",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_PROJECT_DIR_NAME",
  "PUBLIC",
  "ProgramData",
  "PROGRAMDATA",
  "SystemRoot",
  "WINDIR",
];

let originalEnvironment;
let fixtureRoot;
let configRoot;
let workspace;

function launch(name) {
  return Object.freeze({
    CLAUDE_CONFIG_DIR: configRoot,
    CLAUDE_CODE_PROJECT_DIR_NAME: name,
  });
}

async function park(manager, sessionId, agentId) {
  manager.create({ sessionId, agentId, metadata: { agentId } });
  expect(manager.markIdle(sessionId)).toBe(true);
  expect(await manager.park(sessionId)).toBe(true);
}

function restoreEnvironment(snapshot) {
  for (const key of ENVIRONMENT_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

beforeEach(() => {
  originalEnvironment = Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of ENVIRONMENT_KEYS) delete process.env[key];
  fixtureRoot = mkdtempSync(join(tmpdir(), "cc-lifecycle-scope-"));
  configRoot = join(fixtureRoot, "claude-config");
  workspace = join(fixtureRoot, "workspace");
  mkdirSync(workspace, { recursive: true });
  resetSessionCoreSingletonsForTests();
});

afterEach(() => {
  resetSessionCoreSingletonsForTests();
  restoreEnvironment(originalEnvironment);
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("trusted lifecycle sidecar scope", () => {
  it("isolates same-id lifecycle sidecars by project", async () => {
    const projectA = launch("project-a");
    const projectB = launch("project-b");
    const sameId = "session-reused-across-projects";
    const expectedA = join(configRoot, "projects", "project-a");
    const expectedB = join(configRoot, "projects", "project-b");

    const managerA = getSessionManager({ launchEnv: projectA, cwd: workspace });
    const managerB = getSessionManager({ launchEnv: projectB, cwd: workspace });
    expect(managerA).not.toBe(managerB);
    await park(managerA, sameId, "agent-a");
    await park(managerB, sameId, "agent-b");

    expect(getParkedSessionsPath({ launchEnv: projectA, cwd: workspace })).toBe(
      join(expectedA, "parked-sessions.json"),
    );
    expect(getParkedSessionsPath({ launchEnv: projectB, cwd: workspace })).toBe(
      join(expectedB, "parked-sessions.json"),
    );
    expect(
      JSON.parse(readFileSync(join(expectedA, "parked-sessions.json"), "utf8")),
    ).toMatchObject({ [sameId]: { metadata: { agentId: "agent-a" } } });
    expect(
      JSON.parse(readFileSync(join(expectedB, "parked-sessions.json"), "utf8")),
    ).toMatchObject({ [sameId]: { metadata: { agentId: "agent-b" } } });
    resetSessionCoreSingletonsForTests();
    expect(
      await getSessionManager({
        launchEnv: projectA,
        cwd: workspace,
      })._parkedStore.load(sameId),
    ).toMatchObject({ metadata: { agentId: "agent-a" } });
    expect(
      await getSessionManager({
        launchEnv: projectB,
        cwd: workspace,
      })._parkedStore.load(sameId),
    ).toMatchObject({ metadata: { agentId: "agent-b" } });

    const fabricA = new SessionMessageFabric({
      launchEnv: projectA,
      cwd: workspace,
    });
    const fabricB = new SessionMessageFabric({
      launchEnv: projectB,
      cwd: workspace,
    });
    expect(fabricA.statePath).toBe(
      join(expectedA, "session-message-fabric", "state.json"),
    );
    expect(fabricB.statePath).toBe(
      join(expectedB, "session-message-fabric", "state.json"),
    );
    // A same-id/same-name registration would conflict in one fabric. It must
    // be independently admitted in the separate durable project sidecar.
    expect(
      fabricA.register({ sessionId: sameId, name: "same-session" }).name,
    ).toBe("same-session");
    expect(
      fabricB.register({ sessionId: sameId, name: "same-session" }).name,
    ).toBe("same-session");
    expect(fabricA.projection().endpoints).toHaveLength(1);
    expect(fabricB.projection().endpoints).toHaveLength(1);

    const workbenchA = new SessionWorkbenchStore({
      launchEnv: projectA,
      cwd: workspace,
      uuid: () => "00000000-0000-0000-0000-000000000001",
    });
    const workbenchB = new SessionWorkbenchStore({
      launchEnv: projectB,
      cwd: workspace,
      uuid: () => "00000000-0000-0000-0000-000000000001",
    });
    const emptyA = workbenchA.projection();
    const emptyB = workbenchB.projection();
    const createdA = workbenchA.createGroup({
      name: "Project A",
      expectedRevision: emptyA.revision,
    });
    // The same initial revision remains valid in B. Sharing one file would
    // fence this mutation as stale after A increments its generation.
    const createdB = workbenchB.createGroup({
      name: "Project B",
      expectedRevision: emptyB.revision,
    });
    expect(createdA.items.map((entry) => entry.name)).toEqual(["Project A"]);
    expect(createdB.items.map((entry) => entry.name)).toEqual(["Project B"]);
    expect(workbenchA.filePath).toBe(join(expectedA, "session-workbench.json"));
    expect(workbenchB.filePath).toBe(join(expectedB, "session-workbench.json"));
  });

  it("keeps the legacy native-root locations and singleton behavior unchanged", async () => {
    const nativeRoot = join(fixtureRoot, "native-home");
    const nativeLaunch = Object.freeze({
      CHAINLESSCHAIN_HOME: nativeRoot,
      CLAUDE_CONFIG_DIR: configRoot,
      CLAUDE_CODE_PROJECT_DIR_NAME: "ignored-by-native-root",
    });

    const scope = resolveTrustedSessionLifecycleScope({
      launchEnv: nativeLaunch,
      cwd: workspace,
    });
    expect(scope).toMatchObject({ kind: "legacy", key: "legacy" });
    expect(scope.parkedSessionsPath).toBe(
      join(nativeRoot, "parked-sessions.json"),
    );
    expect(
      resolveTrustedSessionLifecycleScope({
        launchEnv: Object.freeze({ CLAUDE_CONFIG_DIR: configRoot }),
        cwd: workspace,
      }),
    ).toMatchObject({
      kind: "legacy",
      parkedSessionsPath: join(configRoot, "parked-sessions.json"),
    });
    expect(
      defaultSessionMessageFabricPath({
        launchEnv: nativeLaunch,
        cwd: workspace,
      }),
    ).toBe(join(nativeRoot, "session-message-fabric", "state.json"));
    expect(
      defaultSessionWorkbenchStatePath({
        launchEnv: nativeLaunch,
        cwd: workspace,
      }),
    ).toBe(join(nativeRoot, "session-workbench.json"));

    const manager = getSessionManager({
      launchEnv: nativeLaunch,
      cwd: workspace,
    });
    expect(getSessionManager({ launchEnv: nativeLaunch, cwd: workspace })).toBe(
      manager,
    );
    await park(manager, "legacy-same-id", "legacy-agent");
    expect(existsSync(join(nativeRoot, "parked-sessions.json"))).toBe(true);
  });

  it("uses a frozen launch snapshot after ambient environment changes", () => {
    const projectA = launch("snapshot-a");
    const projectB = launch("ambient-b");
    const scopeA = resolveTrustedSessionLifecycleScope({
      launchEnv: projectA,
      cwd: workspace,
    });
    expect(Object.isFrozen(scopeA)).toBe(true);
    const managerA = getSessionManager({ launchEnv: projectA, cwd: workspace });

    process.env.CLAUDE_CONFIG_DIR = projectB.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME =
      projectB.CLAUDE_CODE_PROJECT_DIR_NAME;

    expect(getSessionManager({ launchEnv: projectA, cwd: workspace })).toBe(
      managerA,
    );
    expect(
      defaultSessionMessageFabricPath({ launchEnv: projectA, cwd: workspace }),
    ).toBe(
      join(
        configRoot,
        "projects",
        "snapshot-a",
        "session-message-fabric",
        "state.json",
      ),
    );
    expect(
      defaultSessionWorkbenchStatePath({ launchEnv: projectA, cwd: workspace }),
    ).toBe(
      join(configRoot, "projects", "snapshot-a", "session-workbench.json"),
    );
  });

  it("fails closed instead of falling back for unsafe launcher storage", () => {
    const unsafeRoot = Object.freeze({
      CLAUDE_CONFIG_DIR: "relative-config-root",
      CLAUDE_CODE_PROJECT_DIR_NAME: "project-a",
    });
    for (const create of [
      () =>
        resolveTrustedSessionLifecycleScope({
          launchEnv: unsafeRoot,
          cwd: workspace,
        }),
      () => getSessionManager({ launchEnv: unsafeRoot, cwd: workspace }),
      () => new SessionMessageFabric({ launchEnv: unsafeRoot, cwd: workspace }),
      () =>
        new SessionWorkbenchStore({ launchEnv: unsafeRoot, cwd: workspace }),
    ]) {
      expect(create).toThrow(
        expect.objectContaining({ code: "CONFIG_HOME_UNSAFE" }),
      );
    }

    const unsafeName = Object.freeze({
      CLAUDE_CONFIG_DIR: configRoot,
      CLAUDE_CODE_PROJECT_DIR_NAME: "../escape",
    });
    expect(() =>
      resolveTrustedSessionLifecycleScope({
        launchEnv: unsafeName,
        cwd: workspace,
      }),
    ).toThrow(
      expect.objectContaining({ code: "CLAUDE_PROJECT_DIR_NAME_UNSAFE" }),
    );
  });
});
