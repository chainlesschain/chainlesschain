import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
const worker = fileURLToPath(
  new URL("./helpers/evolution-workbench-review-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, phase) {
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, phase],
    {
      encoding: "utf8",
      timeout: 50_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(child.error, child.stderr).toBeUndefined();
  if (mode === "seed") {
    expect(child.status, child.stderr).not.toBe(0);
    const output = JSON.parse(child.stdout);
    expect(output.checkpoint).toBe(phase);
    return output;
  }
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout);
}
describe("Workbench review real process recovery", () => {
  it.each(["prepared", "applied", "first-committed"])(
    "recovers after SIGKILL at %s without duplicate decisions",
    (phase) => {
      const root = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), "cc-workbench-review-process-"),
      );
      roots.push(root);
      const killed = run(root, "seed", phase);
      const before = run(root, "inspect", phase);
      expect(before).toMatchObject({
        prepared: 1,
        decisions: phase === "prepared" ? 0 : 1,
        committed: phase === "first-committed" ? 1 : 0,
      });
      const recovered = run(root, "resume", phase);
      const total = phase === "first-committed" ? 2 : 1;
      expect(recovered.pid).not.toBe(killed.pid);
      expect(recovered).toMatchObject({
        prepared: total,
        decisions: total,
        committed: total,
        resumed: 1,
        items: total,
        asks: phase === "first-committed" ? 1 : 0,
      });
      const repeated = run(root, "resume", phase);
      expect(repeated.pid).not.toBe(recovered.pid);
      expect(repeated).toMatchObject({
        sequence: recovered.sequence,
        decisionDigests: recovered.decisionDigests,
        prepared: total,
        decisions: total,
        committed: total,
        resumed: 0,
        asks: 0,
      });
    },
    180_000,
  );
});
