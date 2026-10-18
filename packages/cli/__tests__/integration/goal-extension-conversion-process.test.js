import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const fixture = fileURLToPath(
  new URL("../fixtures/goal-extension-conversion-process.mjs", import.meta.url),
);
let directory;
afterEach(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
function run(mode) {
  return JSON.parse(
    execFileSync(process.execPath, [fixture, mode, directory], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 128 * 1024,
    }),
  );
}
function interrupt(mode, status) {
  let caught;
  try {
    run(mode);
  } catch (error) {
    caught = error;
  }
  expect(caught?.status).toBe(status);
}
describe("extension conversion real process recovery", () => {
  it("recovers each committed boundary with one conversion, intent, action and receipt", () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-extension-process-"));
    run("setup");
    interrupt("conversion-gap", 41);
    const conversion = run("inspect");
    expect(conversion).toMatchObject({
      conversions: 1,
      nativeIntents: 0,
      actionRuns: 0,
      description: "Original",
    });
    interrupt("native-draft-gap", 42);
    const draft = run("inspect");
    expect(draft).toMatchObject({
      conversions: 1,
      nativeIntents: 1,
      intentStatus: "draft",
      actionRuns: 0,
    });
    expect(draft.conversion).toEqual(conversion.conversion);
    interrupt("preview-gap", 43);
    const prepared = run("inspect");
    expect(prepared).toMatchObject({
      conversions: 1,
      nativeIntents: 1,
      intentStatus: "prepared",
      actionRuns: 0,
    });
    expect(prepared.conversion).toEqual(conversion.conversion);
    interrupt("run-gap", 44);
    const complete = run("inspect");
    expect(complete).toMatchObject({
      conversions: 1,
      nativeIntents: 1,
      actionRuns: 1,
      runStatus: "succeeded",
      description: "Persisted extension recovery",
    });
    const replay = run("replay");
    expect(replay.replayed).toBe(true);
    expect(replay.run.id).toBe(complete.runId);
    expect(run("inspect").actionRuns).toBe(1);
  }, 60000);
  it("recovers interrupted native confirmation as unresolved without installing a queue callback during constructor recovery", () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-extension-running-"));
    run("setup");
    interrupt("running-gap", 45);
    const unresolved = run("inspect");
    expect(unresolved).toMatchObject({
      conversions: 1,
      nativeIntents: 1,
      actionRuns: 1,
      intentStatus: "running",
      runStatus: "running",
      usage: "unknown",
      description: "Original",
    });
    const replay = run("replay");
    expect(replay.executionState).toBe("unresolved");
    expect(replay.run.id).toBe(unresolved.runId);
    expect(run("inspect")).toMatchObject({
      actionRuns: 1,
      description: "Original",
    });
  }, 60000);
});
