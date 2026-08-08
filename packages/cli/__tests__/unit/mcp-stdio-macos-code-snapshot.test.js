import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMacSandbox,
  MCP_STDIO_FD_ENTRY_BOOTSTRAP,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/platform-sandbox.js";

const temporaryRoots = [];

function fileIdentity(filePath) {
  const realPath = fs.realpathSync(filePath);
  const stat = fs.statSync(realPath);
  return Object.freeze({
    contractVersion: 1,
    realPath,
    sha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(realPath))
      .digest("hex"),
    bytes: stat.size,
    fileId: Object.freeze({
      dev: String(stat.dev),
      ino: String(stat.ino),
    }),
    mtimeMs: stat.mtimeMs,
    attestation: "realpath-file-id-sha256",
  });
}

function rootIdentity(root) {
  const realPath = fs.realpathSync(root);
  const stat = fs.statSync(realPath);
  return Object.freeze({
    contractVersion: 1,
    realPath,
    fileId: Object.freeze({
      dev: String(stat.dev),
      ino: String(stat.ino),
    }),
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("MCP inherited-FD entry bootstrap and macOS fail-closed policy", () => {
  it("compiles the exact entry source from inherited fd 4 with direct-script argv", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-fd-entry-"));
    temporaryRoots.push(root);
    const entryPath = path.join(root, "server.cjs");
    fs.writeFileSync(
      entryPath,
      "process.stdout.write(JSON.stringify({argv:process.argv.slice(1),filename:__filename,modulePaths:module.paths}));\n",
    );
    const entryFd = fs.openSync(entryPath, "r");
    try {
      const result = spawnSync(
        process.execPath,
        ["-e", MCP_STDIO_FD_ENTRY_BOOTSTRAP, "--", "ready"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe", "ignore", entryFd],
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        argv: ["/chainlesschain/mcp-capsule.cjs", "ready"],
        filename: "/chainlesschain/mcp-capsule.cjs",
        modulePaths: [],
      });
    } finally {
      fs.closeSync(entryFd);
    }
  });

  it.runIf(process.platform === "darwin")(
    "fails closed when macOS cannot bind the verified runtime to exec",
    () => {
      const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-macos-fd-")),
      );
      temporaryRoots.push(root);
      const entryPath = path.join(root, "server.cjs");
      fs.writeFileSync(
        entryPath,
        'process.stdout.write("must-not-execute\\n");\n',
      );

      const runtime = fileIdentity(process.execPath);
      const entry = fileIdentity(entryPath);
      const contract = Object.freeze({
        contractVersion: 1,
        kind: "strict-mcp-node-capsule",
        pluginRoot: root,
        workingDirectory: root,
        runtimePath: runtime.realPath,
        rootIdentity: rootIdentity(root),
        entryIdentity: entry,
        runtimeIdentity: runtime,
      });
      const plan = applyMacSandbox(
        runtime.realPath,
        [entry.realPath],
        { cwd: root, shell: false, stdio: "pipe" },
        {
          profileName: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          executionContract: contract,
          sync: true,
        },
      );

      expect(plan).toMatchObject({
        applied: false,
        backend: null,
        candidateBackend: "macos-fd-code-snapshot",
        policyAttested: false,
        reason: "macos_atomic_runtime_exec_unavailable",
        guarantees: [],
        command: runtime.realPath,
        args: [entry.realPath],
        runtimeProbe: {
          kind: "darwin-mcp-capsule-code-snapshot-v1",
          attempted: true,
          runnable: false,
          reason: "public_api_has_no_descriptor_bound_exec",
          contentSnapshot: false,
          handleAtomic: false,
          entrySnapshotAtomic: false,
          runtimeLaunchAtomic: false,
          runtimeLaunchMechanism: "darwin-public-api-pathname-exec-only-v1",
          sharedLibraryClosure: false,
        },
      });
      expect(plan.command).not.toBe("/usr/bin/sandbox-exec");
      expect(plan.cleanup).toBeUndefined();
    },
  );
});
