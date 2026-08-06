import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const fixtureScript = join(
  repositoryRoot,
  "tests/fixtures/ide-roadmap/fake-stream-json-agent.mjs",
);
const temporaryRoots = [];

function createStatePath() {
  const root = mkdtempSync(join(tmpdir(), "cc-workbench-host-"));
  temporaryRoots.push(root);
  return join(root, "state.json");
}

function runFixture(statePath, args) {
  const result = spawnSync(process.execPath, [fixtureScript, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CC_UI_FIXTURE_STATE: statePath,
      CC_UI_FIXTURE_TRACE: "",
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `fixture command failed (${args.join(" ")}): ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout);
}

function background(projection) {
  return projection.sessions.find(
    (session) => session.id === "background:ui-workbench-background",
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("real-host workbench CLI fixture", () => {
  it("persists dispatch -> needs_input -> reply -> artifact across CLI processes", () => {
    const statePath = createStatePath();
    const initial = runFixture(statePath, ["session", "projection", "--json"]);
    expect(new Set(initial.sessions.map((session) => session.kind))).toEqual(
      new Set(["local", "background", "remote", "team", "workflow"]),
    );
    expect(background(initial)).toMatchObject({
      state: "done",
      artifact: { count: 0 },
    });
    expect(
      background(initial).actions.find((action) => action.id === "dispatch"),
    ).toMatchObject({ available: true, preview: { executor: "cli" } });

    expect(
      runFixture(statePath, [
        "daemon",
        "resume",
        "ui-workbench-background",
        "dispatch from IDE",
        "--json",
      ]),
    ).toMatchObject({ accepted: true, phase: "needs_input" });
    const waiting = runFixture(statePath, ["session", "projection", "--json"]);
    expect(waiting.revision).not.toBe(initial.revision);
    expect(background(waiting)).toMatchObject({
      state: "needs_input",
      approval: { pending: true, type: "input" },
    });
    expect(
      background(waiting).actions.find((action) => action.id === "reply"),
    ).toMatchObject({
      available: true,
      preview: {
        executor: "cli",
        argv: [
          "daemon",
          "reply",
          "ui-workbench-background",
          "$prompt",
          "--json",
        ],
      },
    });

    expect(
      runFixture(statePath, [
        "daemon",
        "reply",
        "ui-workbench-background",
        "beta",
        "--json",
      ]),
    ).toMatchObject({ accepted: true, phase: "done" });
    const completed = runFixture(statePath, [
      "session",
      "projection",
      "--json",
    ]);
    expect(background(completed)).toMatchObject({
      state: "done",
      artifact: {
        count: 1,
        latest: { title: "workbench-result.md" },
      },
      pr: { count: 1, latest: { state: "merged" } },
    });

    // A fourth fresh process proves the terminal projection, artifact and
    // bindings survive the host/CLI process boundary instead of living only
    // in one in-memory fixture instance.
    const restarted = runFixture(statePath, [
      "session",
      "projection",
      "--json",
    ]);
    expect(restarted).toEqual(completed);
  });
});
