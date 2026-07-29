import { describe, expect, it } from "vitest";
import {
  TEAM_SCOPE_LOCK_ERROR_CODES,
  TeamScopeLock,
  TeamScopeLockError,
  normalizeTeamScopePath,
  normalizeTeamScopes,
  teamScopesOverlap,
} from "../../src/lib/agent-team/team-scope-lock.js";

describe("team scope normalization", () => {
  it("canonicalizes POSIX and Windows relative paths", () => {
    expect(normalizeTeamScopePath(" ./src//agent/./runner.js/ ")).toBe(
      "src/agent/runner.js",
    );
    expect(normalizeTeamScopePath("src\\agent\\\\runner.js\\")).toBe(
      "src/agent/runner.js",
    );
    expect(normalizeTeamScopePath("SRC/Agent/Runner.js")).toBe(
      "src/agent/runner.js",
    );
    expect(
      normalizeTeamScopes([
        "src/agent/runner.js",
        "docs\\guide.md",
        "src",
        "docs/guide.md",
      ]),
    ).toEqual(["docs/guide.md", "src"]);
  });

  it.each([
    ["/absolute"],
    ["\\rooted"],
    ["\\\\server\\share"],
    ["C:\\absolute"],
    ["C:/absolute"],
    ["C:drive-relative"],
    ["../outside"],
    ["src/../outside"],
    ["src/\0file"],
    [""],
    ["."],
    [42],
    ["src/file."],
    ["src/file "],
    ["src/file /child"],
    ["src/file:stream"],
    ["src/CON.txt"],
  ])("rejects unsafe or empty path %p with a stable code", (scope) => {
    expect(() => normalizeTeamScopePath(scope)).toThrow(
      expect.objectContaining({
        name: "TeamScopeLockError",
        code: TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
      }),
    );
  });

  it("does not mutate an input scope list", () => {
    const scopes = Object.freeze(["z\\file.js", "a/file.js"]);
    expect(normalizeTeamScopes(scopes)).toEqual(["a/file.js", "z/file.js"]);
    expect(scopes).toEqual(["z\\file.js", "a/file.js"]);
  });

  it("reports invalid scope container types with a stable code", () => {
    expect(() => normalizeTeamScopes("src")).toThrow(
      expect.objectContaining({
        code: TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPES,
      }),
    );
  });
});

describe("teamScopesOverlap", () => {
  it("treats exact paths and directory prefixes as overlapping", () => {
    expect(teamScopesOverlap(["src/a.js"], ["src/a.js"])).toBe(true);
    expect(teamScopesOverlap(["src"], ["src/a.js"])).toBe(true);
    expect(teamScopesOverlap(["src/a.js"], ["src"])).toBe(true);
    expect(teamScopesOverlap(["SRC/A.js"], ["src/a.js"])).toBe(true);
  });

  it("uses path-segment boundaries for prefixes", () => {
    expect(teamScopesOverlap(["src"], ["src2/a.js"])).toBe(false);
    expect(teamScopesOverlap(["src/a.js"], ["src/b.js"])).toBe(false);
  });

  it("treats an empty scope list as the whole workspace", () => {
    expect(teamScopesOverlap([], ["src/a.js"])).toBe(true);
    expect(teamScopesOverlap(["src/a.js"], [])).toBe(true);
    expect(teamScopesOverlap([], [])).toBe(true);
  });
});

describe("TeamScopeLock", () => {
  it("allows non-overlapping owners and rejects overlapping prefixes", () => {
    const lock = new TeamScopeLock();
    expect(lock.acquire("agent-b", ["docs"])).toMatchObject({
      ok: true,
      acquired: true,
    });
    expect(lock.acquire("agent-a", ["src/api"])).toMatchObject({
      ok: true,
      acquired: true,
    });

    const check = lock.canAcquire("agent-c", ["src/api/routes.js", "docs/v2"]);
    expect(check).toEqual({
      ok: false,
      code: TEAM_SCOPE_LOCK_ERROR_CODES.SCOPE_CONFLICT,
      message: "requested scopes conflict with 2 active lock(s)",
      key: "agent-c",
      scopes: ["docs/v2", "src/api/routes.js"],
      conflicts: [
        { key: "agent-a", scopes: ["src/api"], workspace: false },
        { key: "agent-b", scopes: ["docs"], workspace: false },
      ],
    });
    expect(lock.status().count).toBe(2);
  });

  it("makes whole-workspace ownership conflict with every writer", () => {
    const lock = new TeamScopeLock();
    expect(lock.acquire("exclusive", [])).toMatchObject({
      ok: true,
      acquired: true,
      scopes: [],
    });
    expect(lock.canAcquire("writer", ["src"])).toMatchObject({
      ok: false,
      code: TEAM_SCOPE_LOCK_ERROR_CODES.SCOPE_CONFLICT,
      conflicts: [{ key: "exclusive", scopes: [], workspace: true }],
    });
  });

  it("supports idempotent reacquisition but requires release to change scopes", () => {
    const lock = new TeamScopeLock();
    lock.acquire("agent", ["src\\a.js"]);

    expect(lock.acquire(" agent ", ["src/a.js"])).toMatchObject({
      ok: true,
      acquired: false,
      alreadyHeld: true,
      key: "agent",
      scopes: ["src/a.js"],
    });
    expect(lock.canAcquire("agent", ["docs"])).toMatchObject({
      ok: false,
      code: TEAM_SCOPE_LOCK_ERROR_CODES.KEY_ALREADY_HELD,
      heldScopes: ["src/a.js"],
    });
    expect(lock.status().locks).toEqual([
      { key: "agent", scopes: ["src/a.js"], workspace: false },
    ]);
  });

  it("returns stable input and release errors without mutating state", () => {
    const lock = new TeamScopeLock();

    expect(lock.acquire("", ["src"])).toMatchObject({
      ok: false,
      code: TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_KEY,
    });
    expect(lock.acquire("agent", "src")).toMatchObject({
      ok: false,
      code: TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPES,
    });
    expect(lock.acquire("agent", ["../src"])).toMatchObject({
      ok: false,
      code: TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
    });
    expect(lock.release("missing")).toMatchObject({
      ok: false,
      code: TEAM_SCOPE_LOCK_ERROR_CODES.NOT_HELD,
    });
    expect(lock.status()).toEqual({ count: 0, locks: [] });
  });

  it("releases ownership and returns the canonical former lock", () => {
    const lock = new TeamScopeLock();
    lock.acquire("agent", ["src\\a.js"]);

    expect(lock.release("agent")).toEqual({
      ok: true,
      released: true,
      key: "agent",
      scopes: ["src/a.js"],
      workspace: false,
    });
    expect(lock.canAcquire("next", ["src"])).toMatchObject({ ok: true });
  });

  it("returns deterministic, detached status and snapshot data", () => {
    const lock = new TeamScopeLock();
    lock.acquire("z-agent", ["z"]);
    lock.acquire("a-agent", ["a"]);

    const status = lock.status();
    expect(status).toEqual({
      count: 2,
      locks: [
        { key: "a-agent", scopes: ["a"], workspace: false },
        { key: "z-agent", scopes: ["z"], workspace: false },
      ],
    });
    status.locks[0].scopes.push("mutated");
    expect(lock.status().locks[0].scopes).toEqual(["a"]);

    expect(lock.snapshot()).toEqual({
      version: 1,
      locks: [
        { key: "a-agent", scopes: ["a"] },
        { key: "z-agent", scopes: ["z"] },
      ],
    });
  });

  it("round-trips canonical ownership through snapshot and restore", () => {
    const original = new TeamScopeLock();
    original.acquire("docs-agent", ["docs\\guide"]);
    original.acquire("src-agent", ["src"]);

    const restored = TeamScopeLock.restore(
      JSON.parse(JSON.stringify(original.snapshot())),
    );
    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restored.canAcquire("conflict", ["src/file.js"])).toMatchObject({
      ok: false,
      code: TEAM_SCOPE_LOCK_ERROR_CODES.SCOPE_CONFLICT,
    });

    const workspace = new TeamScopeLock();
    workspace.acquire("exclusive", []);
    expect(TeamScopeLock.restore(workspace.snapshot()).status().locks).toEqual([
      { key: "exclusive", scopes: [], workspace: true },
    ]);
  });

  it.each([
    [null],
    [{}],
    [{ version: 2, locks: [] }],
    [{ version: 1, locks: "bad" }],
    [{ version: 1, locks: [null] }],
    [{ version: 1, locks: [{ key: "agent", scopes: ["../src"] }] }],
    [
      {
        version: 1,
        locks: [
          { key: "agent", scopes: ["src"] },
          { key: "agent", scopes: ["src"] },
        ],
      },
    ],
    [
      {
        version: 1,
        locks: [
          { key: "agent-a", scopes: ["src"] },
          { key: "agent-b", scopes: ["src/file.js"] },
        ],
      },
    ],
  ])("fails closed for corrupt snapshot %j", (snapshot) => {
    expect(() => TeamScopeLock.restore(snapshot)).toThrow(
      expect.objectContaining({
        name: "TeamScopeLockError",
        code: TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SNAPSHOT,
      }),
    );
  });

  it("exposes a typed error for direct normalization callers", () => {
    expect(() => normalizeTeamScopePath("/absolute")).toThrow(
      TeamScopeLockError,
    );
  });
});
