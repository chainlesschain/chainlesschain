import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyNpmRegistryReadback } from "../../scripts/verify-npm-registry-readback.mjs";

const dirs = [];
const VERSION = "1.2.3";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = 123456;

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-npm-readback-"));
  dirs.push(dir);
  const sourceTarball = path.join(dir, `chainlesschain-${VERSION}.tgz`);
  const registryDir = path.join(dir, "registry");
  fs.mkdirSync(registryDir);
  const registryTarball = path.join(
    registryDir,
    `chainlesschain-${VERSION}.tgz`,
  );
  const bytes = Buffer.from("immutable npm release bytes");
  fs.writeFileSync(sourceTarball, bytes);
  fs.writeFileSync(registryTarball, bytes);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const sha512 = crypto.createHash("sha512").update(bytes).digest("hex");
  return {
    sourceTarball,
    registryTarball,
    manifest: {
      schema: 2,
      package: "chainlesschain",
      version: VERSION,
      commit: COMMIT,
      workflowRun: `https://github.com/chainlesschain/chainlesschain/actions/runs/${RUN_ID}`,
      artifact: path.basename(sourceTarball),
      bytes: bytes.length,
      sha256,
      sha512,
      provenance: "npm --provenance",
    },
    provenance: {
      schema: 1,
      package: "chainlesschain",
      version: VERSION,
      commit: COMMIT,
      ref: "refs/tags/v-npm-1-2-3",
      sha512,
      repository: "https://github.com/chainlesschain/chainlesschain",
      workflow: ".github/workflows/npm-publish.yml",
      runId: RUN_ID,
      attempt: 1,
    },
  };
}

describe("public npm registry readback", () => {
  it("proves registry bytes equal the immutable attested artifact", () => {
    const value = fixture();
    expect(verifyNpmRegistryReadback(value)).toMatchObject({
      package: "chainlesschain",
      version: VERSION,
      commit: COMMIT,
      publishRunId: RUN_ID,
      byteIdentical: true,
      sha256: value.manifest.sha256,
      sha512: value.manifest.sha512,
    });
  });

  it("rejects a changed public registry tarball", () => {
    const value = fixture();
    fs.appendFileSync(value.registryTarball, "tampered");
    expect(() => verifyNpmRegistryReadback(value)).toThrow(
      /registry artifact byte length/,
    );
  });

  it.each([
    [
      "version",
      (value) => (value.provenance.version = "9.9.9"),
      /provenance version/,
    ],
    [
      "commit",
      (value) => (value.provenance.commit = "f".repeat(40)),
      /provenance commit/,
    ],
    [
      "digest",
      (value) => (value.provenance.sha512 = "ab".repeat(64)),
      /provenance sha512/,
    ],
    [
      "ref",
      (value) => (value.provenance.ref = "refs/tags/other"),
      /provenance ref/,
    ],
    ["run", (value) => (value.provenance.runId = 999), /attested workflow run/],
  ])("rejects mismatched provenance %s", (_name, mutate, error) => {
    const value = fixture();
    mutate(value);
    expect(() => verifyNpmRegistryReadback(value)).toThrow(error);
  });

  it("binds the manifest to an explicitly expected tag commit", () => {
    const value = fixture();
    expect(() =>
      verifyNpmRegistryReadback({ ...value, commit: "f".repeat(40) }),
    ).toThrow(/release manifest commit/);
  });
});
