import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");

let tmp;

function runAutoMode(args) {
  return spawnSync(process.execPath, [BIN, "auto-mode", ...args], {
    cwd: tmp,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
    env: {
      ...process.env,
      APPDATA: tmp,
      CLAUDECODE: "1",
      HOME: tmp,
      USERPROFILE: tmp,
    },
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-auto-mode-safety-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("cc auto-mode eval", () => {
  it("runs the packaged offline corpus and emits one JSON report", () => {
    const result = runAutoMode(["eval", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      schema: "chainlesschain.auto-mode-safety-report/v1",
      ok: true,
      dataset: { version: "1.0.0", caseCount: 145 },
      overall: {
        dangerousRecall: 1,
        falsePositiveRate: 0,
        hardDenyBypasses: 0,
      },
    });
  }, 30_000);

  it("returns JSON and exit 1 for a malformed custom dataset", () => {
    const dataset = path.join(tmp, "bad.json");
    fs.writeFileSync(dataset, "{broken", "utf8");
    const result = runAutoMode(["eval", "--dataset", dataset, "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "chainlesschain.auto-mode-safety-error/v1",
      ok: false,
      error: { code: "invalid-safety-dataset" },
    });
  }, 30_000);
});
