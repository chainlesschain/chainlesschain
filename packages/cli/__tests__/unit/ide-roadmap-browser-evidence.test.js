import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseArgs as parseProducerArgs,
  scanArtifactJson,
} from "../../scripts/ide-roadmap-browser-evidence.mjs";
import {
  parseArgs as parseAggregateArgs,
  regularFiles,
} from "../../scripts/verify-ide-roadmap-browser-evidence.mjs";

const roots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-browser-script-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("browser evidence producer arguments and secret gate", () => {
  it("requires exact producer artifact inputs", () => {
    expect(
      parseProducerArgs([
        "--artifact-dir",
        "build/browser",
        "--head-sha",
        "a".repeat(40),
        "--os",
        "linux",
        "--artifact-name",
        "browser-evidence-linux-1",
      ]),
    ).toMatchObject({
      "artifact-dir": "build/browser",
      "head-sha": "a".repeat(40),
      os: "linux",
      "artifact-name": "browser-evidence-linux-1",
    });
    expect(() => parseProducerArgs(["--os", "linux"])).toThrow(
      /artifact-dir is required/u,
    );
  });

  it("counts recall-first and journey-specific secret hits", () => {
    const root = temporaryRoot();
    fs.writeFileSync(
      path.join(root, "safe.json"),
      '{"authorization":"Bearer [REDACTED]"}\n',
    );
    expect(scanArtifactJson(root)).toEqual({ hits: 0, files: 1 });
    fs.mkdirSync(path.join(root, "attachments"));
    fs.writeFileSync(
      path.join(root, "attachments", "screenshot.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(scanArtifactJson(root)).toEqual({ hits: 0, files: 2 });
    fs.writeFileSync(
      path.join(root, "leak.json"),
      '{"authorization":"Bearer abcdefghijklmnop"}\n',
    );
    expect(scanArtifactJson(root).hits).toBeGreaterThanOrEqual(1);
  });
});

describe("browser evidence aggregate input discovery", () => {
  it("parses aggregate authority and walks only regular files", () => {
    expect(
      parseAggregateArgs([
        "--input-dir",
        "build/producers",
        "--head-sha",
        "b".repeat(40),
        "--run-id",
        "123",
        "--run-attempt",
        "2",
        "--workflow-ref",
        "chainlesschain/chainlesschain/.github/workflows/ide-extensions.yml@refs/heads/main",
        "--output",
        "build/aggregate.json",
      ]),
    ).toEqual({
      "input-dir": "build/producers",
      "head-sha": "b".repeat(40),
      "run-id": "123",
      "run-attempt": "2",
      "workflow-ref":
        "chainlesschain/chainlesschain/.github/workflows/ide-extensions.yml@refs/heads/main",
      output: "build/aggregate.json",
    });
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "linux"));
    fs.writeFileSync(path.join(root, "linux", "fragment.json"), "{}\n");
    fs.mkdirSync(path.join(root, "empty"));
    expect(regularFiles(root)).toEqual([
      path.join(root, "linux", "fragment.json"),
    ]);
  });
});
