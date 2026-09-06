import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL("./helpers/knowledge-skill-rollback-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, crashPoint = "none", status = 0) {
  const child = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=256",
      worker,
      root,
      mode,
      crashPoint,
      "wiki-multihop",
      "all-wikis",
    ],
    {
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stderr || child.stdout).toBe(status);
  return status === 0 ? JSON.parse(child.stdout) : null;
}
it.each([
  ["after-first-wiki-tombstone", 94],
  ["before-dependency-settlement", 96],
  ["after-dependency-settlement", 97],
])(
  "recovers real cross-run Wiki effects at %s (%s)",
  (crashPoint, status) => {
    const root = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-wiki-multihop-recovery-",
      ),
    );
    roots.push(root);
    const started = Date.now();
    const seeded = run(root, "seed");
    expect(seeded.wikiRevisions).toBe(6);
    run(root, "execute", crashPoint, status);
    const interrupted = run(root, "inspect");
    expect(interrupted).toMatchObject({
      prepared: 1,
      settled: status === 97 ? 1 : 0,
      published: 0,
      activeReleaseDigest: seeded.baselineReleaseDigest,
      revision: 3,
      wikiRevisions: status === 94 ? 7 : 9,
    });
    expect(
      interrupted.wikiStates.filter((wiki) => wiki.status === "tombstoned"),
    ).toHaveLength(status === 94 ? 1 : 3);
    const recovered = run(root, "execute");
    expect(recovered).toMatchObject({
      prepared: 1,
      settled: 1,
      published: 1,
      wikiRevisions: 9,
      dependencyResultCount: 5,
      revision: 3,
    });
    expect(
      recovered.wikiStates.every(
        (wiki) => wiki.status === "tombstoned" && wiki.revision === 3,
      ),
    ).toBe(true);
    expect(recovered.wikiStates.map((wiki) => wiki.safeStatus)).toEqual(
      seeded.wikiStates.map((wiki) => wiki.safeStatus),
    );
    expect(
      recovered.transitions.filter(
        (transition) => transition.operation === "rollback",
      ),
    ).toHaveLength(1);
    const verified = run(root, "inspect");
    expect(
      new Set([seeded.pid, interrupted.pid, recovered.pid, verified.pid]).size,
    ).toBe(4);
    expect({ ...verified, pid: null }).toEqual({ ...recovered, pid: null });
    process.stdout.write(
      `Knowledge multihop Wiki ${crashPoint}: ${Date.now() - started}ms\n`,
    );
  },
  300_000,
);
