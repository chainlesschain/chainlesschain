import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRrsiShadowFixture } from "../fixtures/rrsi-shadow-fixture.js";

const script = fileURLToPath(
  new URL("../../scripts/rrsi-offline-replay.mjs", import.meta.url),
);
const invoke = (...args) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
  });

describe("RRSI repository offline entry point", () => {
  it("runs a reproducible synthetic demonstration in a real child", () => {
    const result = invoke("--demo");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "shadow-selected",
      authenticated: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
  });

  it("checks a separately supplied campaign digest and keeps unknown costs HOLD", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "rrsi-replay-"));
    try {
      const input = createRrsiShadowFixture();
      const filename = path.join(directory, "input.json");
      writeFileSync(filename, JSON.stringify(input));
      const accepted = invoke(
        "--input",
        filename,
        "--campaign-digest",
        input.campaign.campaignDigest,
      );
      expect(accepted.status).toBe(0);
      expect(
        invoke(
          "--input",
          filename,
          "--campaign-digest",
          `sha256:${"0".repeat(64)}`,
        ).status,
      ).toBe(1);
      input.observations[0].candidateCostMicrounits = null;
      writeFileSync(filename, JSON.stringify(input));
      const held = invoke(
        "--input",
        filename,
        "--campaign-digest",
        input.campaign.campaignDigest,
      );
      expect(held.status).toBe(2);
      expect(JSON.parse(held.stdout).blockingReasons).toContain("COST_UNKNOWN");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["--demo", "--demo"],
    ["--unknown"],
    ["--input", "missing-private-file.json"],
  ])("rejects invalid options without echoing private paths %#", (args) => {
    const result = invoke(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("missing-private-file");
  });

  it("rejects oversized and malformed UTF-8 inputs with a bounded read", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "rrsi-replay-"));
    try {
      const filename = path.join(directory, "input.json");
      for (const contents of [
        Buffer.alloc(2 * 1024 * 1024 + 1),
        Buffer.from([0xff, 0xfe]),
      ]) {
        writeFileSync(filename, contents);
        expect(
          invoke(
            "--input",
            filename,
            "--campaign-digest",
            `sha256:${"0".repeat(64)}`,
          ).status,
        ).toBe(1);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
