import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MAP_PATH,
  REQUIRED_DELTA_IDS,
  produceEvidence,
  validateSecurityMap,
  verifyEvidenceSet,
} from "../../scripts/verify-claude-security-map.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const roots = [];

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-security-map-"));
  roots.push(directory);
  return directory;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Claude Code 2.1.221-2.1.238 security map", () => {
  it("verifies every 2.1.221-2.1.238 security delta with a digest-bound producer", () => {
    const validated = validateSecurityMap();
    expect(validated.map.rows).toHaveLength(REQUIRED_DELTA_IDS.length);
    expect(new Set(validated.map.rows.map((row) => row.id)).size).toBe(
      REQUIRED_DELTA_IDS.length,
    );
    expect(
      validated.map.rows.every((row) =>
        row.producer.sha256.startsWith("sha256:"),
      ),
    ).toBe(true);
  });

  it("keeps reverted Cygwin symlink and input redirection changes out of parity success", () => {
    const rows = validateSecurityMap().map.rows.filter(
      (row) =>
        row.id.includes("cygwin-symlink") ||
        row.id.includes("input-redirection"),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        disposition: "upstream-reverted",
        revertedBy: "2.1.233",
        paritySuccess: false,
      });
    }
  });

  it("requires reasons for non-applicable rows and rejects stale producer digests", () => {
    const directory = tempDirectory();
    const map = structuredClone(validateSecurityMap().map);
    const row = map.rows.find(
      (candidate) => candidate.disposition === "not-applicable+reason",
    );
    delete row.reason;
    const missingReason = path.join(directory, "missing-reason.json");
    writeJson(missingReason, map);
    expect(() => validateSecurityMap(missingReason)).toThrow(/reason/);

    row.reason = "This is a complete and auditable non-applicability reason.";
    row.producer.sha256 = `sha256:${"0".repeat(64)}`;
    const staleDigest = path.join(directory, "stale-digest.json");
    writeJson(staleDigest, map);
    expect(() => validateSecurityMap(staleDigest)).toThrow(/producer digest/);
  });

  it("aggregates only one exact-head producer from each required operating system", () => {
    const directory = tempDirectory();
    for (const platform of ["linux", "darwin", "win32"]) {
      const evidence = produceEvidence({
        releaseCommit: RELEASE_COMMIT,
        platform,
        verifyGitHead: false,
      });
      writeJson(path.join(directory, `${platform}.json`), evidence);
    }
    const aggregate = verifyEvidenceSet({
      evidenceDir: directory,
      releaseCommit: RELEASE_COMMIT,
      verifyGitHead: false,
    });
    expect(aggregate).toMatchObject({
      headSha: RELEASE_COMMIT,
      operatingSystems: ["linux", "macos", "windows"],
      rowCount: REQUIRED_DELTA_IDS.length,
      disposition: "required",
      result: "passed",
    });

    fs.rmSync(path.join(directory, "darwin.json"));
    expect(() =>
      verifyEvidenceSet({
        evidenceDir: directory,
        releaseCommit: RELEASE_COMMIT,
        verifyGitHead: false,
      }),
    ).toThrow();
  });

  it("binds all three required workflows to the map verifier and artifacts", () => {
    for (const workflow of [
      "cli-ci.yml",
      "cli-strict-sandbox.yml",
      "ide-roadmap-safety.yml",
    ]) {
      const source = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          "../../../../.github/workflows",
          workflow,
        ),
        "utf8",
      );
      expect(source).toContain("verify-claude-security-map.mjs");
      expect(source).toContain("claude-security-map-");
    }
  });
});
