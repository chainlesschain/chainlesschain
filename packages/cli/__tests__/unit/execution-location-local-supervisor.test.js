import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const supervisor = fileURLToPath(
  new URL(
    "../../src/lib/execution-location-local-supervisor.mjs",
    import.meta.url,
  ),
);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("execution-location local supervisor", () => {
  it("forwards an exact replica input and closes the target stdin", () => {
    const root = mkdtempSync(join(tmpdir(), "cc-local-supervisor-"));
    roots.push(root);
    const entry = join(root, "replica-reader.mjs");
    writeFileSync(
      entry,
      [
        "const chunks = [];",
        'process.stdin.on("data", (chunk) => chunks.push(chunk));',
        'process.stdin.on("end", () => {',
        "  process.stdout.write(JSON.stringify({ payload: Buffer.concat(chunks).toString(\"base64\") }));",
        "});",
      ].join("\n"),
      "utf8",
    );
    const replica = Buffer.from("exact replica bytes\\n", "utf8");
    const result = spawnSync(
      process.execPath,
      [
        supervisor,
        "--cwd",
        root,
        "--cpu-seconds",
        "1",
        "--memory-bytes",
        String(64 * 1024 * 1024),
        "--entry",
        entry,
        "--",
        "session",
        "location",
        "prepare",
        "session-target-1",
      ],
      {
        encoding: "utf8",
        input: replica,
        shell: false,
        timeout: 10_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      payload: replica.toString("base64"),
    });
  });

  it("forwards a verified staged replica through a child stdin pipe", () => {
    const root = mkdtempSync(join(tmpdir(), "cc-local-supervisor-file-"));
    roots.push(root);
    const entry = join(root, "replica-reader.mjs");
    const stagedInput = join(root, "replica.bin");
    writeFileSync(
      entry,
      [
        "const chunks = [];",
        'process.stdin.on("data", (chunk) => chunks.push(chunk));',
        'process.stdin.on("end", () => {',
        "  process.stdout.write(JSON.stringify({ payload: Buffer.concat(chunks).toString(\"base64\") }));",
        "});",
      ].join("\n"),
      "utf8",
    );
    const replica = Buffer.from("staged exact replica bytes\n", "utf8");
    writeFileSync(stagedInput, replica);

    const result = spawnSync(
      process.execPath,
      [
        supervisor,
        "--cwd",
        root,
        "--cpu-seconds",
        "1",
        "--memory-bytes",
        String(64 * 1024 * 1024),
        "--entry",
        entry,
        "--stdin-file",
        stagedInput,
        "--",
        "session",
        "location",
        "prepare",
        "session-target-1",
      ],
      {
        encoding: "utf8",
        shell: false,
        timeout: 10_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      payload: replica.toString("base64"),
    });
  });
});
