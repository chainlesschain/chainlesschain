import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SCOPED_PERMISSION_ERROR_CODES,
  ScopedPermissionStore,
} from "../../src/lib/scoped-permission-store.js";
import { loadPermissionAuthority } from "../../src/lib/permission-authority.js";

let root;
let workspace;
let stateFile;
let now;

function store(options = {}) {
  return new ScopedPermissionStore({
    cwd: workspace,
    filePath: stateFile,
    now: () => now,
    randomId: () => "spr_0123456789abcdef0123456789abcdef",
    ...options,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-scoped-permission-"));
  workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  stateFile = path.join(root, "security", "rules.json");
  now = Date.UTC(2026, 7, 15, 0, 0, 0);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ScopedPermissionStore", () => {
  it("persists an active workspace-bound rule with provenance and TTL", () => {
    const created = store().add({
      decision: "allow",
      rule: "Bash(git status:*)",
      expiresAt: now + 60_000,
      reason: "inspect the worktree",
    });

    expect(created).toMatchObject({
      id: "spr_0123456789abcdef0123456789abcdef",
      revision: 1,
      decision: "allow",
      status: "active",
      scope: "workspace",
      source: "cli-security-store",
    });
    const listed = store().list();
    expect(listed.generation).toBe(1);
    expect(listed.rules).toHaveLength(1);
    const expectedWorkspaceRoot = path.normalize(
      fs.realpathSync.native(workspace),
    );
    expect(listed.workspace.root).toBe(
      process.platform === "win32"
        ? expectedWorkspaceRoot.toLowerCase()
        : expectedWorkspaceRoot,
    );
  });

  it("expires a rule without mutating durable history", () => {
    store().add({
      decision: "allow",
      rule: "Read(./src/**)",
      expiresAt: now + 1000,
    });
    now += 1001;

    const listed = store().list();
    expect(listed.rules[0].status).toBe("expired");
    expect(listed.generation).toBe(1);
  });

  it("revokes with record-level CAS and rejects a stale revision", () => {
    const created = store().add({
      decision: "ask",
      rule: "WebFetch(domain:example.com)",
      expiresAt: now + 60_000,
    });
    const revoked = store().revoke({
      id: created.id,
      expectedRevision: 1,
    });
    expect(revoked).toMatchObject({ status: "revoked", revision: 2 });

    expect(() =>
      store().revoke({ id: created.id, expectedRevision: 1 }),
    ).toThrow(
      expect.objectContaining({
        code: SCOPED_PERMISSION_ERROR_CODES.CONFLICT,
      }),
    );
  });

  it("rejects a stale store generation on create", () => {
    store().add({
      decision: "deny",
      rule: "Bash(rm:*)",
      expiresAt: now + 60_000,
      expectedGeneration: 0,
    });
    expect(() =>
      store({
        randomId: () => "spr_fedcba9876543210fedcba9876543210",
      }).add({
        decision: "allow",
        rule: "Read",
        expiresAt: now + 60_000,
        expectedGeneration: 0,
      }),
    ).toThrow(
      expect.objectContaining({
        code: SCOPED_PERMISSION_ERROR_CODES.CONFLICT,
      }),
    );
  });

  it("fails closed on corrupt state or a different workspace binding", () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, "{ broken", "utf8");
    expect(() => store().list()).toThrow(/store corrupt failed/i);

    fs.rmSync(stateFile, { force: true });
    store().add({
      decision: "deny",
      rule: "Bash",
      expiresAt: now + 60_000,
    });
    const otherWorkspace = path.join(root, "other");
    fs.mkdirSync(otherWorkspace);
    expect(() =>
      new ScopedPermissionStore({
        cwd: otherWorkspace,
        filePath: stateFile,
      }).list(),
    ).toThrow(
      expect.objectContaining({ code: SCOPED_PERMISSION_ERROR_CODES.CORRUPT }),
    );
  });

  it("isolates permission authority at the nearest nested repository", () => {
    execFileSync("git", ["init", "-q"], { cwd: workspace });
    const nested = path.join(workspace, "vendor", "nested");
    fs.mkdirSync(nested, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: nested });

    const outer = store({ filePath: path.join(root, "outer-rules.json") });
    outer.add({
      decision: "allow",
      rule: "Bash(git status:*)",
      expiresAt: now + 60_000,
    });
    const inner = new ScopedPermissionStore({
      cwd: nested,
      filePath: path.join(root, "inner-rules.json"),
      now: () => now,
    });

    const outerState = outer.list();
    const innerState = inner.list();
    const canonicalNested = fs.realpathSync.native(nested);
    expect(innerState.workspace).not.toEqual(outerState.workspace);
    expect(innerState.workspace.root).toBe(
      process.platform === "win32"
        ? canonicalNested.toLowerCase()
        : canonicalNested,
    );
    expect(innerState.rules).toEqual([]);
    expect(outerState.rules).toHaveLength(1);
  });
});

describe("loadPermissionAuthority", () => {
  it("includes only active scoped rules and preserves deny precedence", () => {
    const scopedStore = store({
      randomId: () => "spr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const created = scopedStore.add({
      decision: "allow",
      rule: "Bash(git status:*)",
      expiresAt: now + 60_000,
    });
    fs.mkdirSync(path.join(workspace, ".claude"));
    fs.writeFileSync(
      path.join(workspace, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["Bash(git status:*)"] } }),
    );

    const authority = loadPermissionAuthority({
      cwd: workspace,
      scopedStore,
      managedSettingsFile: path.join(root, "missing-managed.json"),
      env: {},
    });
    expect(authority.rules.allow).toContain("Bash(git status:*)");
    expect(authority.rules.deny).toContain("Bash(git status:*)");
    expect(authority.scoped.rules[0]).toMatchObject({
      id: created.id,
      effectiveStatus: "active",
    });

    scopedStore.revoke({ id: created.id, expectedRevision: 1 });
    const afterRevoke = loadPermissionAuthority({
      cwd: workspace,
      scopedStore,
      managedSettingsFile: path.join(root, "missing-managed.json"),
      env: {},
    });
    expect(afterRevoke.rules.allow).not.toContain("Bash(git status:*)");
  });

  it("suppresses workspace rules under managed-only policy", () => {
    const scopedStore = store();
    scopedStore.add({
      decision: "allow",
      rule: "Bash",
      expiresAt: now + 60_000,
    });
    const managed = path.join(root, "managed.json");
    fs.writeFileSync(
      managed,
      JSON.stringify({
        allowManagedPermissionRulesOnly: true,
        permissions: { deny: ["Bash(rm:*)"] },
      }),
    );

    const authority = loadPermissionAuthority({
      cwd: workspace,
      scopedStore,
      managedSettingsFile: managed,
      env: {},
    });
    expect(authority.rules).toEqual({
      allow: [],
      ask: [],
      deny: ["Bash(rm:*)"],
    });
    expect(authority.scoped.rules[0].effectiveStatus).toBe(
      "suppressed-by-managed-policy",
    );
  });
});
