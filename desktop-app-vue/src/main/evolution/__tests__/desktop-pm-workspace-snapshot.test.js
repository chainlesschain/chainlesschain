import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const {
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA,
  WORKSPACE_SNAPSHOT_DOMAIN,
  captureDesktopPmWorkspaceSnapshotter,
  createDesktopPmWorkspaceSnapshotter,
} = require("../desktop-pm-workspace-snapshot");

const temporaryRoots = [];
const digest = (label) =>
  `sha256:${createHash("sha256").update(label).digest("hex")}`;

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "cc-pm-workspace-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "artifacts", "nested"), { recursive: true });
  await writeFile(path.join(root, "artifacts", "result.md"), "result\n");
  await writeFile(path.join(root, "artifacts", "nested", "data.json"), "{}\n");
  return root;
}

function snapshotter(root, overrides = {}) {
  return createDesktopPmWorkspaceSnapshotter({
    manifestDigest: digest("manifest"),
    workspaceRoot: root,
    includePaths: ["artifacts"],
    maxFileCount: 10,
    maxFileBytes: 1024,
    maxSnapshotBytes: 16 * 1024,
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Desktop PM workspace snapshot", () => {
  it("captures a deterministic manifest-bound archive and detects changes", async () => {
    const root = await workspace();
    const port = captureDesktopPmWorkspaceSnapshotter(snapshotter(root));

    const first = await port.captureWorkspaceSnapshot();
    const second = await port.captureWorkspaceSnapshot();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema: WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA,
      seal: {
        manifestDigest: digest("manifest"),
        workspaceFileCount: 2,
        snapshotMethod: "bounded-canonical-workspace-archive",
      },
    });
    expect(first.seal.workspaceSnapshotDigest).toBe(
      `sha256:${createHash("sha256")
        .update(WORKSPACE_SNAPSHOT_DOMAIN)
        .update("\0")
        .update(first.bytes)
        .digest("hex")}`,
    );
    const archive = JSON.parse(first.bytes.toString("utf8"));
    expect(archive.schema).toBe(WORKSPACE_ARCHIVE_SCHEMA);
    expect(archive.entries.map((entry) => entry.path)).toEqual([
      "artifacts",
      "artifacts/nested",
      "artifacts/nested/data.json",
      "artifacts/result.md",
    ]);

    await writeFile(path.join(root, "artifacts", "result.md"), "changed\n");
    const changed = await port.captureWorkspaceSnapshot();
    expect(changed.seal.workspaceSnapshotDigest).not.toBe(
      first.seal.workspaceSnapshotDigest,
    );
  });

  it("rejects path escapes, overlapping roots, proxies and byte-budget overflow", async () => {
    const root = await workspace();
    expect(() => snapshotter(root, { includePaths: ["../escape"] })).toThrow(
      /canonical/u,
    );
    expect(() =>
      snapshotter(root, { includePaths: ["artifacts", "artifacts/nested"] }),
    ).toThrow(/overlap/u);
    expect(() =>
      captureDesktopPmWorkspaceSnapshotter(new Proxy(snapshotter(root), {})),
    ).toThrow(/branded/u);
    await expect(
      captureDesktopPmWorkspaceSnapshotter(
        snapshotter(root, { maxFileBytes: 2, maxSnapshotBytes: 4096 }),
      ).captureWorkspaceSnapshot(),
    ).rejects.toThrow(/byte budget/u);
  });

  it("rejects symbolic links instead of following them", async () => {
    const root = await workspace();
    try {
      await symlink(
        path.join(root, "artifacts", "result.md"),
        path.join(root, "artifacts", "linked.md"),
        "file",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) return;
      throw error;
    }
    await expect(
      captureDesktopPmWorkspaceSnapshotter(
        snapshotter(root),
      ).captureWorkspaceSnapshot(),
    ).rejects.toThrow(/symbolic link/u);
  });
});
