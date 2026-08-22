import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkRecordedWorkspaceTrust,
  evaluateWorkspaceTrustDecision,
  migrateLegacyWorkspaceTrustDecision,
  projectWorkspaceTrustAudit,
  recordWorkspaceTrustConsent,
  resolveCanonicalWorkspaceRepoIdentity,
  workspaceTrustPathSubject,
} from "../../src/lib/workspace-trust.js";

let directory;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-workspace-trust-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("canonical workspace trust", () => {
  it("keeps a directory workspace identity stable across relocation", () => {
    const workspace = path.join(directory, "workspace");
    const relocated = path.join(directory, "workspace-relocated");
    fs.mkdirSync(workspace);

    const originalIdentity = resolveCanonicalWorkspaceRepoIdentity(workspace);
    fs.renameSync(workspace, relocated);
    const relocatedIdentity = resolveCanonicalWorkspaceRepoIdentity(relocated);

    expect(relocatedIdentity).toMatchObject({
      workspaceId: originalIdentity.workspaceId,
      repositoryId: originalIdentity.repositoryId,
      kind: "directory",
    });
  });

  it("shares a repository ID but not a workspace ID across linked worktrees", () => {
    const primary = path.join(directory, "primary");
    const linked = path.join(directory, "linked");
    const linkedGitDir = path.join(primary, ".git", "worktrees", "linked");
    fs.mkdirSync(path.join(primary, ".git"), { recursive: true });
    fs.mkdirSync(linkedGitDir, { recursive: true });
    fs.mkdirSync(linked);
    fs.writeFileSync(
      path.join(linked, ".git"),
      `gitdir: ${path.relative(linked, linkedGitDir)}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(linkedGitDir, "commondir"), "../..\n", "utf8");

    const primaryIdentity = resolveCanonicalWorkspaceRepoIdentity(primary);
    const linkedIdentity = resolveCanonicalWorkspaceRepoIdentity(linked);

    expect(primaryIdentity).toMatchObject({
      kind: "git",
      linkedWorktree: false,
    });
    expect(linkedIdentity).toMatchObject({ kind: "git", linkedWorktree: true });
    expect(linkedIdentity.repositoryId).toBe(primaryIdentity.repositoryId);
    expect(linkedIdentity.workspaceId).not.toBe(primaryIdentity.workspaceId);
  });

  it("intersects evidence strictly and migrates legacy grants to consent required", () => {
    const workspace = path.join(directory, "workspace");
    fs.mkdirSync(workspace);

    const decision = evaluateWorkspaceTrustDecision({
      workspaceRoot: workspace,
      evidence: [
        { source: "plugin", decision: "allow", fingerprint: "version-1" },
        { source: "project-mcp", decision: "ask", fingerprint: "config-1" },
        { source: "hooks", decision: "deny", fingerprint: "host-1" },
      ],
    });
    const migrated = migrateLegacyWorkspaceTrustDecision({
      workspaceRoot: workspace,
      legacyEvidence: [
        { source: "plugin", decision: "allow", fingerprint: "legacy" },
      ],
    });

    expect(decision).toMatchObject({
      decision: "deny",
      reason: "trust_denied",
    });
    expect(migrated).toMatchObject({
      decision: "ask",
      reason: "consent_required",
    });
  });

  it("records only exact consent and fails closed when the shared ledger is corrupt", () => {
    const workspace = path.join(directory, "workspace");
    const config = path.join(workspace, ".mcp.json");
    const store = path.join(directory, "workspace-trust.json");
    const fingerprint = "4f55c7d4aefc8c0bc8e5ffb4d0c8aadd";
    fs.mkdirSync(workspace);
    fs.writeFileSync(config, "{}", "utf8");

    const identity = resolveCanonicalWorkspaceRepoIdentity(workspace);
    const subject = workspaceTrustPathSubject(identity, config);
    expect(
      checkRecordedWorkspaceTrust({
        identity,
        source: "project-mcp",
        subject,
        evidenceFingerprint: fingerprint,
        storePath: store,
      }),
    ).toMatchObject({ status: "first-use", decision: "ask" });

    expect(
      recordWorkspaceTrustConsent({
        identity,
        source: "project-mcp",
        subject,
        evidenceFingerprint: fingerprint,
        storePath: store,
      }),
    ).toMatchObject({ status: "trusted", decision: "allow" });
    expect(
      checkRecordedWorkspaceTrust({
        identity,
        source: "project-mcp",
        subject,
        evidenceFingerprint: fingerprint,
        storePath: store,
      }),
    ).toMatchObject({ status: "trusted", decision: "allow" });
    expect(
      checkRecordedWorkspaceTrust({
        identity,
        source: "project-mcp",
        subject,
        evidenceFingerprint: `${fingerprint}-changed`,
        storePath: store,
      }),
    ).toMatchObject({ status: "changed", decision: "deny" });

    fs.writeFileSync(store, "{corrupt", "utf8");
    expect(() =>
      checkRecordedWorkspaceTrust({
        identity,
        source: "project-mcp",
        subject,
        evidenceFingerprint: fingerprint,
        storePath: store,
      }),
    ).toThrow(/corrupt/i);
  });

  it("projects an audit without paths or raw evidence", () => {
    const workspace = path.join(directory, "workspace");
    fs.mkdirSync(workspace);
    const secret = "https://user:secret@example.test/mcp";
    const decision = evaluateWorkspaceTrustDecision({
      workspaceRoot: workspace,
      evidence: [
        { source: "project-mcp", decision: "allow", fingerprint: secret },
      ],
    });
    const audit = projectWorkspaceTrustAudit(decision);

    expect(audit).toMatchObject({
      decision: "allow",
      workspace_kind: "directory",
      evidence: [{ source: "project-mcp", decision: "allow" }],
    });
    expect(JSON.stringify(audit)).not.toContain(workspace);
    expect(JSON.stringify(audit)).not.toContain(secret);
  });
});
