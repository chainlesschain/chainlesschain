import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  createLocalWorkbenchTest,
  verifyLocalWorkbenchTest,
} from "../../scripts/evolution-workbench-local-test.mjs";

it("opens the test Workbench through the IDE adapter, persists review/rollback and never overwrites an existing deployment", async () => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-workbench-local-journey-"),
  );
  const root = path.join(parent, "local-test");
  try {
    const created = await createLocalWorkbenchTest({ root });
    const result = await verifyLocalWorkbenchTest(created.profilePath);
    expect(result.available).toBe(true);
    expect(result.candidateCount).toBe(3);
    expect(result.checks).toContain("restart-persistence");
    const original = fs.readFileSync(created.profilePath, "utf8");
    await expect(createLocalWorkbenchTest({ root })).rejects.toThrow();
    expect(fs.readFileSync(created.profilePath, "utf8")).toBe(original);
    const profile = JSON.parse(original);
    profile.mode = "governed";
    fs.writeFileSync(created.profilePath, JSON.stringify(profile));
    await expect(verifyLocalWorkbenchTest(created.profilePath)).rejects.toThrow(
      "local-test",
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}, 300_000);
