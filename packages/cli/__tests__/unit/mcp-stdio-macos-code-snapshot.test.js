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
const HAS_MACOS_SEATBELT =
  process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec");

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

describe("macOS MCP anonymous code snapshots", () => {
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
    "executes the attested runtime and entry FDs after the source pathname is replaced",
    () => {
      const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-macos-fd-")),
      );
      temporaryRoots.push(root);
      const entryPath = path.join(root, "server.cjs");
      const markerPath = path.join(root, "malicious-marker.txt");
      fs.writeFileSync(
        entryPath,
        'process.stdout.write("safe-snapshot\\n");\n',
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
          profileName: "default",
          requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
          executionContract: contract,
          sync: true,
        },
      );

      try {
        expect(plan).toMatchObject({
          applied: true,
          backend: "macos-fd-code-snapshot",
          guarantees: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
          runtimeProbe: {
            kind: "darwin-mcp-capsule-code-snapshot-v1",
            handleAtomic: false,
            entrySnapshotAtomic: true,
            runtimeLaunchAtomic: false,
            sharedLibraryClosure: false,
          },
        });
        expect(plan.command).not.toBe(runtime.realPath);
        expect(path.isAbsolute(plan.command)).toBe(true);
        expect(plan.args.slice(0, 3)).toEqual(["-e", expect.any(String), "--"]);

        fs.writeFileSync(
          entryPath,
          `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "executed");\n`,
        );
        const result = spawnSync(plan.command, plan.args, {
          ...plan.options,
          encoding: "utf8",
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("safe-snapshot\n");
        expect(result.stderr).toBe("");
        expect(fs.existsSync(markerPath)).toBe(false);
      } finally {
        plan.cleanup?.();
      }
    },
  );

  it.runIf(HAS_MACOS_SEATBELT)(
    "composes the capsule snapshot with filesystem and network Seatbelt boundaries",
    () => {
      const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-macos-seatbelt-")),
      );
      temporaryRoots.push(root);
      const entryPath = path.join(root, "server.cjs");
      const outsideReadPath = path.join(
        os.tmpdir(),
        `.cc-mcp-seatbelt-outside-read-${process.pid}-${Date.now()}`,
      );
      const outsideWritePath = `${outsideReadPath}.write`;
      fs.writeFileSync(outsideReadPath, "host-only", "utf8");
      temporaryRoots.push(outsideReadPath, outsideWritePath);
      fs.writeFileSync(
        entryPath,
        [
          'const fs = require("node:fs");',
          'const net = require("node:net");',
          `const readPath = ${JSON.stringify(outsideReadPath)};`,
          `const writePath = ${JSON.stringify(outsideWritePath)};`,
          "const denied = (error) => ['EACCES', 'EPERM'].includes(error?.code);",
          "const outcome = { readDenied: false, writeDenied: false, networkDenied: false };",
          "try { fs.readFileSync(readPath); } catch (error) { outcome.readDenied = denied(error); }",
          "try { fs.writeFileSync(writePath, 'escape'); } catch (error) { outcome.writeDenied = denied(error); }",
          "let settled = false;",
          "const finish = () => { if (settled) return; settled = true; socket?.destroy(); process.stdout.write(JSON.stringify(outcome)); };",
          "const socket = net.createConnection({ host: '127.0.0.1', port: 9 });",
          "socket.once('connect', () => { socket.destroy(); finish(); });",
          "socket.once('error', (error) => { outcome.networkDenied = denied(error); finish(); });",
          "setTimeout(finish, 2000).unref();",
        ].join("\n"),
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

      try {
        expect(plan).toMatchObject({
          applied: true,
          command: "/usr/bin/sandbox-exec",
          backend: "macos-seatbelt-fd-code-snapshot",
          guarantees: [
            SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          runtimeProbe: {
            platformSandboxComposed: true,
            platformSandboxMechanism: "sandbox-exec-inline-profile-fd-entry-v1",
            platformSandboxProfileSha256:
              expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        });
        expect(plan.args[0]).toBe("-p");
        expect(plan.args[1]).toContain("(deny network*)");
        expect(plan.args[1]).not.toContain(outsideReadPath);

        const result = spawnSync(plan.command, plan.args, {
          ...plan.options,
          encoding: "utf8",
          timeout: 10_000,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          readDenied: true,
          writeDenied: true,
          networkDenied: true,
        });
        expect(fs.existsSync(outsideWritePath)).toBe(false);
      } finally {
        plan.cleanup?.();
      }
    },
    20_000,
  );
});
