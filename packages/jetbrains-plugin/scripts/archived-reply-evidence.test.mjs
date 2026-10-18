import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  loadVerify33Reply,
  validateReplyFixture,
  validatePublicPlugin,
  assertRecoveryEvidence,
  digest,
  repository,
  RECOVERY_SCHEMA,
} from "./archived-reply-evidence.mjs";
import { replyEnvironment } from "./verify01-archived-reply-recovery.mjs";

const fixture = loadVerify33Reply();
function evidence() {
  const installation = {
    exactZipContents: true,
    archiveSha256: "sha256:" + "a".repeat(64),
    files: { "lib/plugin.jar": "sha256:" + "b".repeat(64) },
  };
  const row = {
    id: "session:hash",
    role: "assistant",
    sourceText: fixture.source,
    bodyText: fixture.rendered,
    text: fixture.rendered,
    truncated: false,
  };
  const initial = {
    schema: RECOVERY_SCHEMA,
    phase: "initial",
    at: "2026-10-18T05:00:00Z",
    sampleId: "verify-33",
    platform: "linux",
    pluginVersion: "0.4.167",
    ideVersion: "2025.2",
    sourceDigest: fixture.sourceDigest,
    renderedDigest: fixture.renderedDigest,
    installation,
    snapshot: {
      visible: true,
      childRunning: false,
      turnActive: false,
      id: "tab",
      sessionId: "session",
      profile: "isolated-profile",
      processId: "101",
      savedRows: [row],
      text: row.text,
    },
  };
  const restart = structuredClone(initial);
  restart.phase = "restart";
  restart.at = "2026-10-18T05:01:00Z";
  restart.snapshot.processId = "102";
  return {
    fixture,
    initial,
    restart,
    plugin: { digest: installation.archiveSha256 },
    records: [
      { command: "archived-agent-start" },
      {
        command: "archived-reply",
        sessionId: "session",
        sourceDigest: fixture.sourceDigest,
      },
      {
        command: "canonical-session-show",
        commandId: "history-after-restart",
        at: "2026-10-18T05:00:30Z",
        args: ["session", "show", "--history", "session"],
      },
      {
        command: "canonical-session-show-complete",
        commandId: "history-after-restart",
        code: 0,
        signal: null,
      },
    ],
  };
}

test("fixture is bound to accepted verify-33 bytes and original rendered Markdown", () => {
  assert.equal(validateReplyFixture(fixture), fixture);
  assert.equal(fixture.reusedCandidates.length, 1);
  assert.equal(fixture.originalVerdict.candidateAcceptancePassed, true);
  assert.equal(fixture.originalVerdict.endToEndPassed, false);
  assert.notEqual(fixture.source, fixture.rendered);
  assert.throws(() =>
    validateReplyFixture({ ...fixture, source: fixture.source + "\n" }),
  );
});

test("older public plugin manifest cannot substitute for the required .167 package", () => {
  assert.throws(
    () =>
      validatePublicPlugin(
        "docs/research/cli/verify01-package-sets/2026-10-18-latest.json",
        path.resolve("not-used.zip"),
      ),
    /0\.4\.166|0\.4\.167/,
  );
});

test("separate result preserves old verdict and makes no task/public-CLI claim", () => {
  const result = assertRecoveryEvidence(evidence());
  assert.equal(result.status, "PASSED_ARCHIVED_REPLY_RECOVERY_ONLY");
  assert.equal(result.newTaskExecution, false);
  assert.equal(result.publicCliVerified, false);
  assert.equal(result.originalVerdict.endToEndPassed, false);
});

test("raw Markdown on both sides, identity loss, wrong host and restart agent are rejected", () => {
  for (const mutate of [
    (e) => {
      for (const phase of [e.initial, e.restart]) {
        phase.snapshot.savedRows[0].bodyText = fixture.source;
        phase.snapshot.savedRows[0].text = fixture.source;
        phase.snapshot.text = fixture.source;
      }
    },
    (e) => {
      e.restart.snapshot.savedRows[0].id = "session:different";
    },
    (e) => {
      e.restart.snapshot.processId = e.initial.snapshot.processId;
    },
    (e) => {
      e.restart.snapshot.profile = "other-profile";
    },
    (e) => {
      e.restart.pluginVersion = "0.4.166";
    },
    (e) => {
      e.restart.platform = "win32";
    },
    (e) => {
      e.restart.snapshot.childRunning = true;
    },
    (e) => {
      e.records.push({ command: "archived-agent-start" });
    },
    (e) => {
      e.records.push({ command: "archived-peer-rejected" });
    },
    (e) => {
      e.records = e.records.filter(
        (row) => row.command !== "canonical-session-show",
      );
    },
  ]) {
    const e = evidence();
    mutate(e);
    assert.throws(() => assertRecoveryEvidence(e));
  }
});

function prepare(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-replay-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "output"),
    canonical = path.join(root, "canonical");
  fs.mkdirSync(output);
  fs.mkdirSync(canonical);
  fs.mkdirSync(path.join(canonical, "home"));
  const bytes = Buffer.from(JSON.stringify(fixture));
  fs.writeFileSync(path.join(output, "fixture.json"), bytes);
  const env = replyEnvironment(canonical, output, digest(bytes), {
    ...process.env,
    OPENAI_API_KEY: "must-not-inherit",
    VOLCENGINE_API_KEY: "must-not-inherit",
    NODE_OPTIONS: "must-not-inherit",
  });
  return { root, output, canonical, env };
}

test("fixture child environment excludes provider secrets and preloads", (t) => {
  const { env } = prepare(t);
  for (const key of ["OPENAI_API_KEY", "VOLCENGINE_API_KEY", "NODE_OPTIONS"])
    assert.equal(env[key], undefined);
});

test("peer rejects unsupported commands and changed archive before persistence", (t) => {
  const { env, output } = prepare(t);
  const peer = path.join(
    repository,
    "tests/fixtures/ide-roadmap/archived-reply-peer.mjs",
  );
  const run = (args) =>
    spawnSync(process.execPath, [peer, ...args], {
      env,
      encoding: "utf8",
      timeout: 15000,
    });
  const version = run(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /archived-reply/);
  const forbidden = run(["llm", "configure"]);
  assert.equal(forbidden.status, 1);
  fs.appendFileSync(path.join(output, "fixture.json"), " ");
  assert.equal(run(["--version"]).status, 1);
});

test(
  "one deterministic reply persists exact bytes and the real history command reads them",
  { skip: process.platform !== "linux", timeout: 30000 },
  (t) => {
    const { env, output } = prepare(t);
    const peer = path.join(
      repository,
      "tests/fixtures/ide-roadmap/archived-reply-peer.mjs",
    );
    const run = (args, input) =>
      spawnSync(process.execPath, [peer, ...args], {
        env,
        input,
        encoding: "utf8",
        timeout: 15000,
      });
    const generated = run(
      ["agent", "--resume", "archived-unit-session"],
      JSON.stringify({
        type: "user",
        text: fixture.prompt,
        client_message_id: "replay-unit-input",
      }) + "\n",
    );
    assert.equal(generated.status, 0, generated.stderr);
    const events = generated.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(
      events.find((event) => event.type === "result").result,
      fixture.source,
    );
    const history = run([
      "session",
      "show",
      "--json",
      "--history",
      "--",
      "archived-unit-session",
    ]);
    assert.equal(history.status, 0, history.stderr);
    assert.ok(
      history.stdout.includes(JSON.stringify(fixture.source).slice(1, -1)),
    );
    assert.equal(run(["agent", "--resume", "archived-unit-session"]).status, 1);
    assert.ok(
      fs
        .readFileSync(path.join(output, "peer.jsonl"), "utf8")
        .includes("canonical-session-show-complete"),
    );
  },
);
