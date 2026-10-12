import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { launchLogged } from "../lib/verify01-diagnostic-process.mjs";
import {
  isDistributionNetworkFailure,
  prepareGradle,
} from "../lib/verify01-gradle-bootstrap.mjs";

const url = "https://services.gradle.org/distributions/gradle-8.7-bin.zip";
const network = `Downloading ${url}\nException in thread "main" java.net.SocketException: An established connection was aborted by the software in your host machine\n`;

function fixture(t, outcomes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-gradle-bootstrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "gradle/wrapper"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "gradle/wrapper/gradle-wrapper.properties"),
    `distributionUrl=${url.replace(":", "\\:")}\n`,
  );
  let calls = 0;
  const artifactDir = path.join(root, "evidence");
  return {
    options: {
      projectDir: root,
      artifactDir,
      retryDelayMs: 0,
      launch(command, args, options) {
        assert.equal(path.dirname(command), root);
        assert.deepEqual(args, ["--version"]);
        const outcome = outcomes[calls++];
        assert(outcome, "Unexpected retry");
        return launchLogged(
          process.execPath,
          [
            "-e",
            "process.stdout.write(process.argv[1]);process.exit(Number(process.argv[2]))",
            outcome.log,
            String(outcome.code),
          ],
          options,
        );
      },
    },
    calls: () => calls,
    result: () =>
      JSON.parse(
        fs.readFileSync(path.join(artifactDir, "bootstrap-result.json")),
      ),
  };
}

test("only explicit network failure while fetching the pinned distribution retries", () => {
  assert.equal(isDistributionNetworkFailure(network, url), true);
  for (const log of [
    network.replace(url, "https://example.com/unrelated.zip"),
    network.replace(`Downloading ${url}\n`, ""),
    network + "PKIX path validation failed",
    network + "checksum verification failed",
    `Downloading ${url}\nCompilation failed`,
  ]) {
    assert.equal(isDistributionNetworkFailure(log, url), false);
  }
});

test("a transient wrapper download failure preserves logs and retries version only", async (t) => {
  const f = fixture(t, [
    { log: network, code: 1 },
    { log: "Gradle 8.7\n", code: 0 },
  ]);
  const result = await prepareGradle(f.options);
  assert.equal(result.passed, true);
  assert.equal(f.calls(), 2);
  assert.equal(result.attempts[0].retryable, true);
  assert.equal(result.attempts[0].code, 1);
  assert.match(result.attempts[0].logSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    fs.readFileSync(path.join(f.options.artifactDir, "attempt-1.log"), "utf8"),
    network,
  );
});

test("persistent network failure stops after three attempts and keeps the failure", async (t) => {
  const f = fixture(t, Array(3).fill({ log: network, code: 1 }));
  await assert.rejects(prepareGradle(f.options), /exited 1/u);
  assert.equal(f.calls(), 3);
  assert.equal(f.result().passed, false);
  assert.equal(f.result().attempts.length, 3);
});

test("non-network failure is never retried", async (t) => {
  const f = fixture(t, [{ log: "Invalid JAVA_HOME\n", code: 1 }]);
  await assert.rejects(prepareGradle(f.options), /exited 1/u);
  assert.equal(f.calls(), 1);
  assert.equal(f.result().attempts[0].retryable, false);
});

test("success must confirm the exact pinned Gradle and cannot overwrite evidence", async (t) => {
  const f = fixture(t, [{ log: "Gradle 9.2.1\n", code: 0 }]);
  await assert.rejects(prepareGradle(f.options), /pinned Gradle version/u);
  assert.equal(f.result().passed, false);
  await assert.rejects(prepareGradle(f.options), { code: "EEXIST" });
  assert.equal(f.calls(), 1);
});

test("a deadline is not a retryable download failure even with network text", async (t) => {
  const f = fixture(t, []);
  let calls = 0;
  f.options.attemptTimeoutMs = 500;
  f.options.launch = (_command, _args, options) => {
    calls++;
    return launchLogged(
      process.execPath,
      [
        "-e",
        "process.stdout.write(process.argv[1]);setInterval(()=>{},1000)",
        network,
      ],
      options,
    );
  };
  await assert.rejects(prepareGradle(f.options), /deadline exceeded/u);
  assert.equal(calls, 1);
  assert.equal(f.result().attempts[0].retryable, false);
});
