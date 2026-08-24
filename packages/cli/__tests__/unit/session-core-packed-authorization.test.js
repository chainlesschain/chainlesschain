import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");

function pack(packageRoot, destination) {
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
    path.join(
      path.dirname(path.dirname(process.execPath)),
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ].filter(Boolean);
  const npmCli = npmCliCandidates.find((candidate) => fs.existsSync(candidate));
  const executable = npmCli ? process.execPath : "npm";
  const npmArguments = npmCli ? [npmCli] : [];
  const result = spawnSync(
    executable,
    [
      ...npmArguments,
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      destination,
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm pack failed for ${packageRoot}: ${result.error?.message || result.stderr || result.stdout}`,
    );
  }
  const start = result.stdout.indexOf("[");
  const end = result.stdout.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("npm pack emitted no JSON");
  const metadata = JSON.parse(result.stdout.slice(start, end + 1));
  if (metadata.length !== 1 || !metadata[0]?.filename) {
    throw new Error("npm pack emitted an unexpected artifact list");
  }
  return path.join(destination, path.basename(metadata[0].filename));
}

function tarEntry(tarball, expectedName) {
  const archive = gunzipSync(fs.readFileSync(tarball));
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, end) =>
      header.subarray(start, end).toString("utf8").replace(/\0.*$/s, "").trim();
    const name = text(0, 100);
    const prefix = text(345, 500);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = text(124, 136);
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`invalid tar entry size for ${fullName}`);
    }
    const dataStart = offset + 512;
    if (fullName === expectedName) {
      return archive.subarray(dataStart, dataStart + size);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`missing tar entry: ${expectedName}`);
}

describe("packed session-core authorization boundary", () => {
  it("pins the independently packed gate and preserves one-shot structured decisions", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-packed-session-core-"),
    );
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const temporaryBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    const cleanupIsSafe = resolvedTemporaryRoot.startsWith(temporaryBase);
    try {
      if (!cleanupIsSafe) {
        throw new Error("refusing to use an unexpected packed-test path");
      }
      const sessionRoot = path.join(repositoryRoot, "packages", "session-core");
      const cliRoot = path.join(repositoryRoot, "packages", "cli");
      const sessionTarball = pack(sessionRoot, temporaryRoot);
      const cliTarball = pack(cliRoot, temporaryRoot);
      const packedSessionManifest = JSON.parse(
        tarEntry(sessionTarball, "package/package.json").toString("utf8"),
      );
      const packedCliManifest = JSON.parse(
        tarEntry(cliTarball, "package/package.json").toString("utf8"),
      );

      expect(
        packedCliManifest.dependencies["@chainlesschain/session-core"],
      ).toBe(packedSessionManifest.version);
      expect(packedSessionManifest.version).toBe("0.3.6");
      expect(
        tarEntry(cliTarball, "package/src/runtime/headless-runner.js").toString(
          "utf8",
        ),
      ).toContain("CC_REMOTE_APPROVAL_GATE_UNAVAILABLE");

      const extractedPackage = path.join(temporaryRoot, "session-core");
      fs.mkdirSync(path.join(extractedPackage, "lib"), { recursive: true });
      fs.writeFileSync(
        path.join(extractedPackage, "package.json"),
        tarEntry(sessionTarball, "package/package.json"),
      );
      fs.writeFileSync(
        path.join(extractedPackage, "lib", "approval-gate.js"),
        tarEntry(sessionTarball, "package/lib/approval-gate.js"),
      );
      const { ApprovalGate } = require(
        path.join(extractedPackage, "lib", "approval-gate.js"),
      );

      const rawAuthorization = Object.freeze({ leaseId: "lease-packed" });
      const withoutConsumer = new ApprovalGate({
        confirm: async () => ({
          approved: true,
          authorization: rawAuthorization,
        }),
      });
      await expect(
        withoutConsumer.decide({ riskLevel: "medium" }),
      ).resolves.toMatchObject({
        decision: "deny",
        via: "authorization-consumer-missing",
      });

      const consumed = [];
      const gate = new ApprovalGate({
        confirm: async () => ({
          approved: true,
          authorization: rawAuthorization,
        }),
        consumeAuthorization: async (authorization, context) => {
          consumed.push({ authorization, context });
          return true;
        },
      });
      const decision = await gate.decide({ riskLevel: "medium" });
      expect(decision).toMatchObject({ decision: "allow" });
      expect(decision.authorization).not.toBe(rawAuthorization);
      await expect(
        gate.consumeAuthorization(decision.authorization, {
          action: "medium-risk",
        }),
      ).resolves.toBe(true);
      expect(consumed).toEqual([
        {
          authorization: rawAuthorization,
          context: { action: "medium-risk" },
        },
      ]);
      await expect(
        gate.consumeAuthorization(decision.authorization, {
          action: "medium-risk",
        }),
      ).rejects.toThrow(/invalid or replayed/);
    } finally {
      if (cleanupIsSafe) {
        fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
      }
    }
  }, 120_000);
});
