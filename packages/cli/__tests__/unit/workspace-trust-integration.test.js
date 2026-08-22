import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkRecordedWorkspaceTrust,
  resolveCanonicalWorkspaceRepoIdentity,
} from "../../src/lib/workspace-trust.js";
import {
  checkProjectMcpTrust,
  projectMcpFingerprint,
  recordProjectMcpTrust,
} from "../../src/lib/project-mcp-trust.js";
import {
  _deps as pluginTrustDeps,
  checkPluginWorkspaceTrust,
  trustPlugin,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  projectHostHooksV2WorkspaceTrustAudit,
  registerHostHooksV2Workspace,
} from "../../src/lib/hooks-v2-workspace-context.js";

const writer = fileURLToPath(
  new URL("../fixtures/workspace-trust-record-writer.mjs", import.meta.url),
);
const temporaryRoots = [];

function createTemporaryRoot() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-workspace-trust-integration-"),
  );
  temporaryRoots.push(root);
  return root;
}

function createGitWorkspace(parent, name) {
  const root = path.join(parent, name);
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  return root;
}

function runWriter(workspaceRoot, storePath, subject) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [writer, workspaceRoot, storePath, subject],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`workspace trust writer exited ${code}: ${stderr}`));
    });
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace trust entry-point migration", () => {
  it("rejects ambiguous linked-worktree Git metadata before issuing identity", () => {
    const parent = createTemporaryRoot();
    const root = path.join(parent, "linked");
    fs.mkdirSync(root);
    fs.writeFileSync(
      path.join(root, ".git"),
      "comment\ngitdir: ../outside\n",
      "utf8",
    );

    expect(() => resolveCanonicalWorkspaceRepoIdentity(root)).toThrow(
      expect.objectContaining({
        code: "CC_WORKSPACE_TRUST_GIT_METADATA_INVALID",
      }),
    );
  });

  it("keeps project MCP consent on a moved repo and requires re-consent for same-path reuse or a path-keyed legacy grant", () => {
    const parent = createTemporaryRoot();
    const repo = createGitWorkspace(parent, "repo");
    const config = path.join(repo, ".mcp.json");
    const contents = JSON.stringify({ mcpServers: {} });
    const sourceStore = path.join(parent, "project-mcp-trust.json");
    const ledgerStore = path.join(parent, "workspace-trust.json");
    fs.writeFileSync(config, contents, "utf8");

    // A v0 path-only grant must go through the explicit re-consent flow.
    fs.writeFileSync(
      sourceStore,
      JSON.stringify({
        [config]: { fingerprint: projectMcpFingerprint(contents) },
      }),
      "utf8",
    );
    expect(
      checkProjectMcpTrust(config, contents, {
        storePath: sourceStore,
        workspaceTrustStorePath: ledgerStore,
      }),
    ).toMatchObject({ status: "changed", workspaceTrust: { decision: "ask" } });

    recordProjectMcpTrust(config, contents, {
      storePath: sourceStore,
      workspaceTrustStorePath: ledgerStore,
    });
    expect(
      checkProjectMcpTrust(config, contents, {
        storePath: sourceStore,
        workspaceTrustStorePath: ledgerStore,
      }).status,
    ).toBe("trusted");

    const moved = path.join(parent, "repo-moved");
    fs.renameSync(repo, moved);
    const movedConfig = path.join(moved, ".mcp.json");
    expect(
      checkProjectMcpTrust(movedConfig, contents, {
        storePath: sourceStore,
        workspaceTrustStorePath: ledgerStore,
      }).status,
    ).toBe("trusted");

    const replacement = createGitWorkspace(parent, "repo");
    const replacementConfig = path.join(replacement, ".mcp.json");
    fs.writeFileSync(replacementConfig, contents, "utf8");
    expect(
      checkProjectMcpTrust(replacementConfig, contents, {
        storePath: sourceStore,
        workspaceTrustStorePath: ledgerStore,
      }),
    ).toMatchObject({
      status: "changed",
      workspaceTrust: { decision: "deny" },
    });
  });

  it("binds project plugin trust to its worktree and requires re-consent after a downgrade or replacement", () => {
    const parent = createTemporaryRoot();
    const repo = createGitWorkspace(parent, "repo");
    const sourceStore = path.join(parent, "plugin-trust.json");
    const ledgerStore = path.join(parent, "workspace-trust.json");
    const originalStorePath = pluginTrustDeps.storePath;
    pluginTrustDeps.storePath = () => sourceStore;
    try {
      // A v0 scope:name grant retains no workspace binding. Its old allow is
      // strictly downgraded to ask, and therefore cannot run code.
      fs.writeFileSync(
        sourceStore,
        JSON.stringify({ "project:example": { version: "2.0.0" } }),
        "utf8",
      );
      expect(
        checkPluginWorkspaceTrust(
          {
            scope: "project",
            name: "example",
            version: "2.0.0",
            workspaceRoot: repo,
          },
          { workspaceTrustStorePath: ledgerStore },
        ),
      ).toMatchObject({
        status: "changed",
        decision: "ask",
        audit: { decision: "ask" },
      });

      trustPlugin("example", {
        scope: "project",
        version: "2.0.0",
        workspaceRoot: repo,
        workspaceTrustStorePath: ledgerStore,
      });
      expect(
        checkPluginWorkspaceTrust(
          {
            scope: "project",
            name: "example",
            version: "2.0.0",
            workspaceRoot: repo,
          },
          { workspaceTrustStorePath: ledgerStore },
        ),
      ).toMatchObject({ status: "trusted", decision: "allow" });
      expect(
        checkPluginWorkspaceTrust(
          {
            scope: "project",
            name: "example",
            version: "1.0.0",
            workspaceRoot: repo,
          },
          { workspaceTrustStorePath: ledgerStore },
        ),
      ).toMatchObject({ status: "changed", decision: "deny" });

      fs.renameSync(repo, path.join(parent, "repo-moved"));
      const replacement = createGitWorkspace(parent, "repo");
      expect(
        checkPluginWorkspaceTrust(
          {
            scope: "project",
            name: "example",
            version: "2.0.0",
            workspaceRoot: replacement,
          },
          { workspaceTrustStorePath: ledgerStore },
        ),
      ).toMatchObject({ status: "changed", decision: "deny" });
    } finally {
      pluginTrustDeps.storePath = originalStorePath;
    }
  });

  it("routes Hooks host identity through the shared redacted projection", () => {
    const repo = createGitWorkspace(createTemporaryRoot(), "repo");
    const binding = registerHostHooksV2Workspace(repo);
    const audit = projectHostHooksV2WorkspaceTrustAudit(binding);

    expect(audit).toMatchObject({
      decision: "allow",
      workspace_id: expect.stringMatching(/^[a-f0-9]{64}$/),
      repository_id: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidence: [
        expect.objectContaining({ source: "hooks", decision: "allow" }),
      ],
    });
    expect(JSON.stringify(audit)).not.toContain(repo);
  });

  it("serializes concurrent canonical grants without losing any record", async () => {
    const parent = createTemporaryRoot();
    const repo = createGitWorkspace(parent, "repo");
    const storePath = path.join(parent, "workspace-trust.json");
    const subjects = ["one", "two", "three", "four"];

    await Promise.all(
      subjects.map((subject) => runWriter(repo, storePath, subject)),
    );

    for (const subject of subjects) {
      expect(
        checkRecordedWorkspaceTrust({
          workspaceRoot: repo,
          storePath,
          source: "fixture",
          subject,
          evidenceFingerprint: `fixture:${subject}`,
        }),
      ).toMatchObject({ status: "trusted", decision: "allow" });
    }
  }, 30_000);

  if (process.platform === "win32") {
    it("normalizes case-only workspace spellings on Windows", () => {
      const repo = createGitWorkspace(createTemporaryRoot(), "MixedCaseRepo");
      expect(resolveCanonicalWorkspaceRepoIdentity(repo.toUpperCase())).toEqual(
        resolveCanonicalWorkspaceRepoIdentity(repo),
      );
    });
  }
});
