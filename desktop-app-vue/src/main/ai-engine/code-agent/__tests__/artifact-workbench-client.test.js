import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const {
  ArtifactWorkbenchClient,
  MAX_OUTPUT_BYTES,
} = require("../artifact-workbench-client.js");

function childResult(payload, { code = 0, stderr = "" } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (payload !== undefined) {
      child.stdout.write(String(payload));
    }
    if (stderr) {
      child.stderr.write(stderr);
    }
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code);
  });
  return child;
}

describe("ArtifactWorkbenchClient", () => {
  it("uses the managed desktop broker contract and validates workbench schema", async () => {
    const spawn = vi.fn(() =>
      childResult(JSON.stringify({ schema: "cc-artifact-workbench/v1" })),
    );
    const client = new ArtifactWorkbenchClient({
      repoRoot: "C:/repo",
      cliEntry: "C:/repo/packages/cli/bin/chainlesschain.js",
      spawn,
    });

    await expect(client.workbench()).resolves.toEqual({
      schema: "cc-artifact-workbench/v1",
    });
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        "C:/repo/packages/cli/bin/chainlesschain.js",
        "artifacts",
        "workbench",
        "--json",
      ],
      expect.objectContaining({
        cwd: "C:/repo",
        shell: false,
        windowsHide: true,
        origin: "desktop:artifact-workbench",
      }),
    );
  });

  it("binds desktop access and recovery authority into exact CLI arguments", async () => {
    const spawn = vi
      .fn()
      .mockImplementationOnce(() =>
        childResult(
          JSON.stringify({
            schema: "cc-artifact-content-access-authorization/v1",
          }),
        ),
      )
      .mockImplementationOnce(() =>
        childResult(
          JSON.stringify({
            schema: "cc-artifact-deletion-receipt/v1",
          }),
        ),
      )
      .mockImplementationOnce(() =>
        childResult(
          JSON.stringify({
            schema: "cc-artifact-recovery-adjudication/v1",
          }),
        ),
      );
    const client = new ArtifactWorkbenchClient({
      repoRoot: "C:/repo",
      cliEntry: "cli.js",
      spawn,
    });
    const digest = `sha256:${"a".repeat(64)}`;

    await client.access({
      artifactId: "artifact-1",
      accessId: "access-1",
      action: "download",
    });
    await client.remove({
      artifactId: "artifact-1",
      deletionId: "deletion-1",
    });
    await client.adjudicate({
      itemId: "item-1",
      planDigest: digest,
      decision: "delete-orphan",
      adjudicationId: "adjudication-1",
    });

    expect(spawn.mock.calls[0][1]).toEqual([
      "cli.js",
      "artifacts",
      "access",
      "artifact-1",
      "--client",
      "desktop",
      "--action",
      "download",
      "--access-id",
      "access-1",
      "--json",
    ]);
    expect(spawn.mock.calls[1][1]).toEqual([
      "cli.js",
      "artifacts",
      "remove",
      "artifact-1",
      "--client",
      "desktop",
      "--deletion-id",
      "deletion-1",
      "--json",
    ]);
    expect(spawn.mock.calls[2][1]).toContain("--approve");
    expect(spawn.mock.calls[2][1]).toContain(digest);
  });

  it("rejects invalid identifiers and unsupported decisions before spawning", () => {
    const spawn = vi.fn();
    const client = new ArtifactWorkbenchClient({ spawn });

    expect(() =>
      client.access({
        artifactId: "../escape",
        accessId: "a",
        action: "preview",
      }),
    ).toThrow("artifact id is invalid");
    expect(() =>
      client.adjudicate({
        itemId: "item-1",
        planDigest: `sha256:${"a".repeat(64)}`,
        decision: "force",
        adjudicationId: "a",
      }),
    ).toThrow("artifact recovery decision is invalid");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("fails closed for oversized or wrong-schema CLI output", async () => {
    const spawn = vi
      .fn()
      .mockImplementationOnce(() =>
        childResult("x".repeat(MAX_OUTPUT_BYTES + 1)),
      )
      .mockImplementationOnce(() =>
        childResult(JSON.stringify({ schema: "cc-artifact-list/v1" })),
      );
    const client = new ArtifactWorkbenchClient({ spawn });

    await expect(client.workbench()).rejects.toThrow(
      "exceeds its output limit",
    );
    await expect(client.workbench()).rejects.toThrow("unsupported schema");
  });
});
