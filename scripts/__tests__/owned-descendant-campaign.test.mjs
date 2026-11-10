import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { spawn as nativeSpawn } from "node:child_process";
import test from "node:test";
import { runOwnedDescendantCampaign } from "../diagnostics/owned-descendant-campaign.mjs";

const target = "owned cleanup terminates an actual descendant process";
const passingTap = `TAP version 13\n# Subtest: ${target}\nok 1 - ${target}\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n`;

function fixture(t, outcomes) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-descendant-campaign-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "evidence");
  let calls = 0;
  return {
    directory,
    output,
    calls: () => calls,
    read: (filename) =>
      JSON.parse(fs.readFileSync(path.join(output, filename), "utf8")),
    options: {
      output,
      rounds: outcomes.length,
      spawn(command, args, options) {
        assert.equal(command, process.execPath);
        assert.deepEqual(args, [
          "--test",
          "--test-reporter=tap",
          "--test-concurrency=1",
          `--test-name-pattern=^${target}$`,
          "scripts/__tests__/verify01-diagnostic-process.test.mjs",
        ]);
        assert.equal(options.shell, false);
        assert.equal(options.stdio[1], options.stdio[2]);
        assert.equal(Object.hasOwn(options, "timeout"), false);
        const outcome = outcomes[calls++];
        assert.ok(outcome, "Unexpected extra round");
        // The started receipt must precede process creation, including throws.
        assert.ok(
          fs.existsSync(
            path.join(
              output,
              `round-${String(calls).padStart(3, "0")}.started.json`,
            ),
          ),
        );
        if (outcome.throw)
          throw Object.assign(new Error("spawn failed"), { code: "EACCES" });
        const child = new EventEmitter();
        process.nextTick(() => {
          fs.writeSync(options.stdio[1], outcome.tap ?? passingTap);
          if (outcome.error)
            child.emit(
              "error",
              Object.assign(new Error("missing binary"), { code: "ENOENT" }),
            );
          child.emit(
            "close",
            outcome.code === undefined ? 0 : outcome.code,
            outcome.signal ?? null,
          );
        });
        return child;
      },
    },
  };
}

test("a middle-round failure stops the campaign and preserves all earlier receipts", async (t) => {
  const failedTap = `TAP version 13\n# {"kind":"verify01-owned-descendant-survivor/v1","sample":"keep"}\nnot ok 1 - ${target}\n# pass 0\n# fail 1\n`;
  const f = fixture(t, [{}, { code: 1, tap: failedTap }, {}]);
  const result = await runOwnedDescendantCampaign(f.options);
  assert.equal(f.calls(), 2);
  assert.equal(result.planned, 3);
  assert.equal(result.completed, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.firstFailedRound, 2);
  assert.equal(result.status, "stopped-on-first-failure");
  assert.equal(result.success, false);
  assert.equal(f.read("round-001.finished.json").success, true);
  const failed = f.read("round-002.finished.json");
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.success, false);
  assert.equal(
    failed.tapSha256,
    createHash("sha256").update(failedTap).digest("hex"),
  );
  assert.equal(
    fs.readFileSync(path.join(f.output, "round-002.tap"), "utf8"),
    failedTap,
  );
  assert.equal(
    fs.existsSync(path.join(f.output, "round-003.started.json")),
    false,
  );
  assert.deepEqual(f.read("summary.json"), result);
});

for (const [name, tap] of [
  [
    "no matched test",
    "TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n",
  ],
  [
    "skipped target",
    passingTap.replace(`ok 1 - ${target}`, `ok 1 - ${target} # SKIP`),
  ],
  ["missing TAP completion", `TAP version 13\nok 1 - ${target}\n`],
  ["different test", passingTap.replaceAll(target, "some other test")],
]) {
  test(`exit zero with ${name} cannot pass`, async (t) => {
    const f = fixture(t, [{ tap }, {}]);
    const result = await runOwnedDescendantCampaign(f.options);
    assert.equal(result.success, false);
    assert.equal(result.firstFailedRound, 1);
    assert.equal(f.calls(), 1);
    assert.equal(
      f.read("round-001.finished.json").targetExecutedAndPassed,
      false,
    );
  });
}

for (const [name, outcome, expected] of [
  [
    "signal",
    { code: null, signal: "SIGTERM" },
    { signal: "SIGTERM", startupError: null },
  ],
  [
    "startup error event",
    { code: -2, error: true },
    { signal: null, startupError: { name: "Error", code: "ENOENT" } },
  ],
  [
    "synchronous spawn failure",
    { throw: true },
    { signal: null, startupError: { name: "Error", code: "EACCES" } },
  ],
]) {
  test(`${name} is retained and stops subsequent rounds`, async (t) => {
    const f = fixture(t, [outcome, {}]);
    const result = await runOwnedDescendantCampaign(f.options);
    assert.equal(result.success, false);
    assert.equal(result.completed, 1);
    assert.equal(result.firstFailedRound, 1);
    assert.equal(f.calls(), 1);
    const receipt = f.read("round-001.finished.json");
    assert.equal(receipt.signal, expected.signal);
    assert.deepEqual(receipt.startupError, expected.startupError);
    assert.equal(receipt.success, false);
  });
}

test("all successful rounds retain exact raw bytes, provenance, and complete counts", async (t) => {
  const raw = Buffer.concat([
    Buffer.from(passingTap),
    Buffer.from([35, 32, 255, 10]),
  ]);
  const f = fixture(t, [{ tap: raw }, {}, {}]);
  const result = await runOwnedDescendantCampaign(f.options);
  assert.equal(f.calls(), 3);
  assert.equal(result.planned, 3);
  assert.equal(result.completed, 3);
  assert.equal(result.passed, 3);
  assert.equal(result.firstFailedRound, null);
  assert.equal(result.status, "completed");
  assert.equal(result.success, true);
  assert.match(result.scope, /diagnostic-only.*not complete/u);
  assert.deepEqual(fs.readFileSync(path.join(f.output, "round-001.tap")), raw);
  const receipt = f.read("round-001.finished.json");
  assert.equal(receipt.tapBytes, raw.length);
  assert.equal(
    receipt.tapSha256,
    createHash("sha256").update(raw).digest("hex"),
  );
  assert.ok(receipt.durationMs >= 0);
  const manifest = f.read("manifest.json");
  assert.match(manifest.sourceSha, /^[a-f0-9]{40}$/u);
  assert.equal(Object.keys(manifest.sources).length, 3);
  for (const hash of Object.values(manifest.sources))
    assert.match(hash, /^[a-f0-9]{64}$/u);
  assert.equal(manifest.host.node, process.version);
  assert.deepEqual(f.read("summary.json"), result);
});

test("real child stdout and stderr reach the retained TAP file", async (t) => {
  const f = fixture(t, [{}]);
  const result = await runOwnedDescendantCampaign({
    ...f.options,
    spawn(command, _args, options) {
      return nativeSpawn(
        command,
        [
          "-e",
          "process.stdout.write(process.argv[1]);process.stderr.write('# retained stderr\\n');",
          passingTap,
        ],
        options,
      );
    },
  });
  assert.equal(result.success, true);
  assert.equal(
    fs.readFileSync(path.join(f.output, "round-001.tap"), "utf8"),
    `${passingTap}# retained stderr\n`,
  );
});

test("existing output is refused without overwriting previous evidence", async (t) => {
  const f = fixture(t, [{}]);
  fs.mkdirSync(f.output);
  fs.writeFileSync(path.join(f.output, "summary.json"), "previous failure");
  await assert.rejects(runOwnedDescendantCampaign(f.options), {
    code: "EEXIST",
  });
  assert.equal(f.calls(), 0);
  assert.equal(
    fs.readFileSync(path.join(f.output, "summary.json"), "utf8"),
    "previous failure",
  );
});

test("invalid round counts fail before creating output or spawning", async (t) => {
  const f = fixture(t, [{}]);
  for (const rounds of [0, -1, 101, 1.5, NaN, "2"])
    await assert.rejects(
      runOwnedDescendantCampaign({ ...f.options, rounds }),
      /integer from 1 through 100/u,
    );
  assert.equal(f.calls(), 0);
  assert.equal(fs.existsSync(f.output), false);
});
