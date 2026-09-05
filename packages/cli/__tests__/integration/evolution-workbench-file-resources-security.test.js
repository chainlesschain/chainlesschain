import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { workbenchFileResourceOptions } from "../fixtures/evolution-workbench-file-resources.js";
import { openEvolutionWorkbenchFileResources } from "../../src/lib/evolution/evolution-workbench-file-resources.js";
import { inspectPrivatePaths } from "../../src/lib/secure-fs.js";

// Two actual file backends and registries invoke native Windows ACL repair for
// each protected directory. This is an OS integration journey, not a fast unit
// check. The per-ACL process limits and all existing test budgets are unchanged.
it("uses owner-only storage by default and independently inspects actual OS permissions", () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-workbench-private-files-"),
  );
  try {
    const options = workbenchFileResourceOptions(root, {
      tenantId: "tenant:private-files",
      streamId: "private-files",
      runId: "run:private-files",
      skillName: "safe-refactor",
      authorityId: "authority:test-private-files",
      revision: 1,
      handlerArtifactDigest: `sha256:${"b".repeat(64)}`,
    });
    // Only the fixture's directory-fsync portability shim is injected. ACL
    // repair AND the independent inspection below use the real OS, no stubs.
    delete options.secure;
    const { runtimeResources: r } =
      openEvolutionWorkbenchFileResources(options);
    expect(r.ledger.verify().sequence).toBe(0);
    const targets = [
      options.storage.artifactDir,
      options.storage.ledgerRootDir,
      options.storage.ledgerAuthorityRootDir,
      path.dirname(options.storage.witnessFilePath),
      options.storage.releaseRootDir,
      r.releaseRegistry.rootDir,
    ];
    const inspected = inspectPrivatePaths(targets);
    expect(inspected).toHaveLength(targets.length);
    expect(
      inspected.every((entry) => entry.ok === true),
      JSON.stringify(inspected),
    ).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 300_000);
