import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerServeCommand } from "../../src/commands/serve.js";
import { JsonlRolloutStore } from "../../src/lib/app-server/rollout-store.js";

const roots = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerServeCommand(program);
  return program;
}

describe("serve migrate-rollouts", () => {
  it("dry-runs by default and copies the same canonical hashes only with --apply", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rollout-command-"));
    roots.push(root);
    const sourceDirectory = path.join(root, "source");
    const targetDirectory = path.join(root, "target");
    const source = new JsonlRolloutStore({
      directory: sourceDirectory,
      now: () => Date.parse("2026-08-30T00:00:00.000Z"),
    });
    source.start({ threadId: "thread-command", title: "command" });
    source.append({
      threadId: "thread-command",
      eventType: "turn.completed",
      payload: { ok: true },
    });

    const output = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const argv = [
      "node",
      "cc",
      "serve",
      "migrate-rollouts",
      "--from",
      "jsonl",
      "--from-path",
      sourceDirectory,
      "--to",
      "jsonl",
      "--to-path",
      targetDirectory,
    ];

    await makeProgram().parseAsync(argv);
    expect(JSON.parse(output.at(-1))).toMatchObject({
      dryRun: true,
      copiedEvents: 2,
    });
    expect(
      new JsonlRolloutStore({ directory: targetDirectory }).list(),
    ).toEqual([]);

    await makeProgram().parseAsync([...argv, "--apply"]);
    expect(JSON.parse(output.at(-1))).toMatchObject({
      dryRun: false,
      copiedEvents: 2,
    });
    const target = new JsonlRolloutStore({ directory: targetDirectory });
    expect(target.read("thread-command").map((event) => event.hash)).toEqual(
      source.read("thread-command").map((event) => event.hash),
    );
  }, 30_000);
});
