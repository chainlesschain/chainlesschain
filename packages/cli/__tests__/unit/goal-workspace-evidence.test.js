import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { captureGoalWorkspace } from "../../src/lib/goal-workspace-evidence.js";
import {
  GoalCheckEvidence,
  sameGoalWorkspace,
  usableGoalEvidence,
  validateGoalJudgeVerdict,
} from "../../src/lib/goal-check-evidence.js";

let root;
let workspace;
const read = () => ({ tool: "read_file", args: { path: "result.txt" } });
const shell = () => ({ tool: "run_shell", args: { command: "npm test" } });
const capture = (call, options) =>
  captureGoalWorkspace(workspace, call, options);
const write = (name, content) =>
  fs.writeFileSync(path.join(workspace, name), content);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-binding-"));
  workspace = path.join(root, "project");
  fs.mkdirSync(workspace);
  write("result.txt", "verified artifact");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function tracker() {
  return new GoalCheckEvidence({
    readOnlyTools: ["read_file"],
    captureWorkspace: capture,
  });
}
async function observe(evidence, call = read()) {
  await evidence.started(call);
  await evidence.settled(
    call,
    call.tool === "run_shell"
      ? { exitCode: 0, stdout: "all tests pass" }
      : { content: "verified artifact" },
    false,
  );
  return evidence.snapshot().tools.at(-1).id;
}

describe("Goal evidence bound to workspace contents", () => {
  it("records actual artifact bytes, scope and stable workspace identity", async () => {
    const first = await capture(read());
    expect(first).toMatchObject({
      verified: true,
      scope: "artifact",
      fileCount: 1,
      totalBytes: 17,
    });
    expect(first.artifacts).toEqual([
      {
        path: "result.txt",
        size: 17,
        digest: `sha256:${createHash("sha256").update("verified artifact").digest("hex")}`,
      },
    ]);
    expect(sameGoalWorkspace(first, await capture(read()))).toBe(true);
  });

  it.each(["overwrite", "delete", "replace"])(
    "invalidates successful evidence after external %s",
    async (change) => {
      const evidence = tracker();
      const id = await observe(evidence);
      expect(usableGoalEvidence(evidence.snapshot())).toHaveLength(1);
      const target = path.join(workspace, "result.txt");
      if (change !== "overwrite") fs.unlinkSync(target);
      if (change !== "delete")
        write(
          "result.txt",
          change === "replace" ? "verified artifact" : "different content",
        );
      await evidence.refreshWorkspace();
      expect(
        validateGoalJudgeVerdict(
          { met: true, evidenceIds: [id] },
          evidence.snapshot(),
        ).met,
      ).toBe(false);
      expect(evidence.snapshot().tools[0].workspace.current).toBe(false);
    },
  );

  it("rejects a result if its inputs changed during the invocation", async () => {
    const evidence = tracker();
    const call = read();
    await evidence.started(call);
    write("result.txt", "different content");
    await evidence.settled(call, { content: "verified artifact" }, false);
    expect(usableGoalEvidence(evidence.snapshot())).toEqual([]);
  });

  it("binds checks to the source set and invalidates added files", async () => {
    const evidence = tracker();
    await observe(evidence, shell());
    expect(evidence.snapshot().tools[0].workspace).toMatchObject({
      verified: true,
      scope: "directory-files-under-cwd",
      current: true,
    });
    write("new-source.js", "broken source");
    await evidence.refreshWorkspace();
    expect(usableGoalEvidence(evidence.snapshot())).toEqual([]);
  });

  it("preserves cited digest provenance in the completion evidence", async () => {
    const evidence = tracker();
    const id = await observe(evidence);
    await evidence.refreshWorkspace();
    const verdict = validateGoalJudgeVerdict(
      { met: true, evidenceIds: [id] },
      evidence.snapshot(),
    );
    expect(verdict).toMatchObject({
      met: true,
      evidence: {
        workspaceBindings: [
          { toolId: id, scope: "artifact", verified: true, current: true },
        ],
      },
    });
    expect(verdict.evidence.workspaceBindings[0].artifacts[0].digest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(evidence.snapshot())).not.toContain('"call":');
    expect(JSON.stringify(evidence.snapshot())).not.toContain(
      "workspaceBefore",
    );
  });

  it("does not silently follow a directory junction outside the workspace", async () => {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(
      path.join(outside, "private.txt"),
      "not workspace content",
    );
    fs.symlinkSync(
      outside,
      path.join(workspace, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      await capture({
        tool: "read_file",
        args: { path: "linked/private.txt" },
      }),
    ).toMatchObject({ verified: false, reason: "linked-entry" });
  });

  it("keeps missing, external, unsupported and oversized evidence unavailable", async () => {
    for (const call of [
      { tool: "read_file", args: { path: "missing.txt" } },
      { tool: "read_file", args: { path: "../outside.txt" } },
      { tool: "custom_tool", args: {} },
    ])
      expect((await capture(call)).verified).toBe(false);
    expect(
      await capture(read(), { limits: { maxFileBytes: 2 } }),
    ).toMatchObject({ verified: false, reason: "resource-limit" });
    write("other.txt", "one more file");
    expect(await capture(shell(), { limits: { maxFiles: 1 } })).toMatchObject({
      verified: false,
      reason: "resource-limit",
    });
  });

  it("honors cancellation before gathering evidence", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await capture(read(), { signal: controller.signal })).toEqual({
      verified: false,
      reason: "cancelled",
    });
  });

  it("detects replacement of the workspace at the same pathname", async () => {
    const first = await capture(read());
    fs.renameSync(workspace, path.join(root, "old-project"));
    fs.mkdirSync(workspace);
    write("result.txt", "verified artifact");
    const second = await capture(read());
    expect(second.verified).toBe(true);
    expect(second.digest).toBe(first.digest);
    expect(second.workspaceId).not.toBe(first.workspaceId);
    expect(sameGoalWorkspace(first, second)).toBe(false);
  });

  it("uses Git tracked/nonignored source scope and separately binds ignored artifacts", async () => {
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: workspace,
        windowsHide: true,
        stdio: "pipe",
      });
    git("init", "--quiet");
    write(".gitignore", "dist/\n");
    git("add", "--", "result.txt", ".gitignore");
    const source = await capture(shell());
    expect(source).toMatchObject({
      verified: true,
      scope: "git-visible-files-under-cwd",
      fileCount: 2,
    });
    fs.mkdirSync(path.join(workspace, "dist"));
    write("dist/output.txt", "built artifact");
    expect(sameGoalWorkspace(source, await capture(shell()))).toBe(true);
    const artifactCall = {
      tool: "read_file",
      args: { path: "dist/output.txt" },
    };
    const artifact = await capture(artifactCall);
    expect(artifact.verified).toBe(true);
    write("dist/output.txt", "changed artifact");
    expect(sameGoalWorkspace(artifact, await capture(artifactCall))).toBe(
      false,
    );
    fs.unlinkSync(path.join(workspace, "result.txt"));
    const deleted = await capture(shell());
    expect(deleted.verified).toBe(true);
    expect(sameGoalWorkspace(source, deleted)).toBe(false);
  });

  it("does not reinterpret failed Git coverage as a valid partial scan", async () => {
    fs.mkdirSync(path.join(workspace, ".git"));
    expect(await capture(shell())).toEqual({
      verified: false,
      reason: "source-list-unavailable",
    });
  });
});
