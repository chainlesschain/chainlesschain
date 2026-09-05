import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL("./helpers/knowledge-wiki-admission-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, writer, wikiRun, attempt = "one", status = 0) {
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, writer, wikiRun, attempt],
    {
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(
    child.status,
    child.error?.message || child.stderr || child.stdout,
  ).toBe(status);
  return status === 0 ? JSON.parse(child.stdout) : null;
}
it.each([
  ["adapter", "same"],
  ["raw", "same"],
  ["adapter", "new"],
  ["raw", "new"],
])(
  "blocks %s Wiki writes in %s runs after a revocation preparation process exit",
  (writer, wikiRun) => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-wiki-admission-process-"),
    );
    roots.push(root);
    const seeded = run(root, "seed", writer, wikiRun);
    run(root, "prepare", writer, wikiRun, "one", 98);
    const first = run(root, "attempt", writer, wikiRun, "one");
    const second = run(root, "attempt", writer, wikiRun, "two");
    expect(first.pid).not.toBe(seeded.pid);
    expect(second.pid).not.toBe(first.pid);
    expect(first).toMatchObject({
      blocked: true,
      prepared: 1,
      settled: 0,
      published: 0,
      wikiRevisions: 2,
      wikiStateDigest: seeded.wikiStateDigest,
    });
    expect({ ...second, pid: null }).toEqual({ ...first, pid: null });
    const inspected = run(root, "inspect", writer, wikiRun);
    expect({ ...inspected, pid: null, blocked: true }).toEqual({
      ...first,
      pid: null,
    });
  },
  300_000,
);
