import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  captureLiveProbeMetadata,
  parseLiveProbeOptions,
  runContextTokenLiveProbe,
} from "../scripts/context-token-volcengine-live-probe.mjs";

const config = {
  apiKey: "secret-never-save",
  model: "deepseek-v4-flash-ga-260731",
};
const matrix = JSON.parse(
  fs.readFileSync(
    new URL(
      "../scripts/context-token-calibration-matrix-2026-10-05.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const success = (id = "raw-provider-id") => ({
  id,
  choices: [{ message: { content: "private-response-never-save" } }],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 4,
    prompt_tokens_details: { cached_tokens: 30 },
  },
});

test("live CLI retains old defaults and validates optional archive and matrix arguments", () => {
  assert.deepEqual(parseLiveProbeOptions(["--confirm-live"]), { repeats: 1 });
  assert.deepEqual(
    parseLiveProbeOptions([
      "--confirm-live",
      "--output",
      "new-dir",
      "--repeats",
      "3",
      "--matrix",
      "matrix.json",
    ]),
    { repeats: 3, outputDir: "new-dir", matrixFile: "matrix.json" },
  );
  for (const args of [
    ["--confirm-live", "--output"],
    ["--confirm-live", "--output", "a", "--output", "b"],
    ["--confirm-live", "--matrix", "--repeats"],
    ["--confirm-live", "--repeats", "6"],
  ])
    assert.throws(() => parseLiveProbeOptions(args));
});

test("capture metadata binds this script and estimator bytes to the actual host", () => {
  const metadata = captureLiveProbeMetadata();
  assert.equal(metadata.environment.platform, process.platform);
  assert.equal(metadata.environment.nodeVersion, process.version);
  assert.equal(metadata.environment.arch, process.arch);
  assert.equal(metadata.environment.osRelease, os.release());
  assert.equal(
    metadata.source.scriptSha256,
    createHash("sha256")
      .update(
        fs.readFileSync(
          new URL(
            "../scripts/context-token-volcengine-live-probe.mjs",
            import.meta.url,
          ),
        ),
      )
      .digest("hex"),
  );
  for (const file of metadata.source.files)
    assert.match(file.sha256, /^[a-f0-9]{64}$/u);
  if (metadata.source.commit !== null)
    assert.match(metadata.source.commit, /^[a-f0-9]{40}$/u);
});

test("provider output above requested max_tokens remains accounted for and never claims a hard cap", async () => {
  const response = success();
  response.usage.completion_tokens = 66;
  const report = await runContextTokenLiveProbe({
    ...config,
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).max_tokens, 8);
      assert.equal(options.redirect, "error");
      return Response.json(response);
    },
  });
  assert.equal(report.requestCount, 4);
  assert.equal(report.outputTokens, 264);
  assert.equal(report.requestedOutputLimit, 8);
  assert.equal(report.observedMaxOutputTokens, 66);
  assert.equal(report.observedOutputLimitExceeded, true);
  assert.equal(report.outputLimitExceededRequests, 4);
  assert.equal(report.outputLimitEnforcementVerified, false);
  assert.ok(
    report.attempts.every(
      (attempt) =>
        attempt.observedOutputLimitExceeded &&
        attempt.usage.completion_tokens === 66,
    ),
  );
  assert.ok(report.estimatedCostUsd > 0);
});

test("partial paid results and pending unknown costs survive a later transport failure", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cc-calibration-"));
  const outputDir = path.join(parent, "capture");
  let calls = 0;
  try {
    const report = await runContextTokenLiveProbe({
      ...config,
      repeats: 3,
      matrix,
      outputDir,
      fetchImpl: async (_url, options) => {
        calls++;
        const started = JSON.parse(
          fs.readFileSync(
            path.join(outputDir, `request-0${calls}-started.json`),
          ),
        );
        assert.equal(started.status, "STARTED");
        assert.equal(
          started.requestPayloadSha256,
          createHash("sha256").update(options.body).digest("hex"),
        );
        if (calls === 2)
          throw new Error("secret-never-save transport diagnostic");
        return Response.json(success());
      },
    });
    assert.equal(calls, 2);
    assert.equal(report.executionStatus, "PARTIAL_FAILURE");
    assert.equal(report.requestCount, 1);
    assert.equal(report.plannedRequests, 12);
    assert.equal(report.estimatedCostUsd, null);
    assert.ok(report.knownEstimatedCostUsd > 0);
    assert.equal(report.unknownCostRequests, 1);
    assert.equal(report.calibration.matrix.status, "INSUFFICIENT_EVIDENCE");
    assert.ok(
      report.calibration.matrix.cells.every((cell) => cell.missing === 3),
    );
    assert.deepEqual(report.attempts[0].usage, success().usage);
    assert.equal(
      report.attempts[0].responseIdSha256,
      createHash("sha256").update(success().id).digest("hex"),
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(outputDir, "receipt.json"))),
      report,
    );
    for (const file of fs.readdirSync(outputDir)) {
      const bytes = fs.readFileSync(path.join(outputDir, file), "utf8");
      assert.doesNotMatch(
        bytes,
        /secret-never-save|private-response-never-save|raw-provider-id|春天/,
      );
    }
    await assert.rejects(
      runContextTokenLiveProbe({
        ...config,
        outputDir,
        fetchImpl: () =>
          assert.fail("existing output must reject before network"),
      }),
      /EEXIST/,
    );
  } finally {
    fs.rmSync(parent, { recursive: true });
  }
});

test("real HTTP headers followed by a stalled body still hit the request deadline", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"id":"body-stalls",');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let started;
  try {
    const report = await runContextTokenLiveProbe({
      ...config,
      timeoutMs: 500,
      onProgress: (attempt) => {
        if (attempt.status === "STARTED") started = Date.now();
      },
      fetchImpl: (_url, options) =>
        fetch(`http://127.0.0.1:${server.address().port}/`, options),
    });
    assert.equal(report.requestCount, 0);
    assert.equal(report.attemptedRequests, 1);
    assert.equal(report.attempts[0].httpStatus, 200);
    assert.equal(report.attempts[0].failureKind, "DEADLINE_EXCEEDED");
    assert.equal(report.estimatedCostUsd, null);
    assert.ok(Date.now() - started < 3000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("successful unpriced samples retain usage while total estimated cost stays unknown", async () => {
  const report = await runContextTokenLiveProbe({
    ...config,
    model: "unknown-model",
    matrix,
    fetchImpl: async () => Response.json(success()),
  });
  assert.equal(report.executionStatus, "COMPLETED");
  assert.equal(report.requestCount, 4);
  assert.equal(report.unknownCostRequests, 4);
  assert.equal(report.estimatedCostUsd, null);
  assert.equal(report.invoiceAssessed, false);
  assert.equal(report.calibration.total.observedTokens, 480);
});

test("invalid usage and oversized responses remain failed attempts without private error text", async () => {
  for (const response of [
    Response.json({
      ...success(),
      usage: {
        prompt_tokens: 120,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 121 },
      },
    }),
    new Response("x".repeat(1024 * 1024 + 1)),
    new Response("secret-never-save", { status: 429 }),
  ]) {
    const report = await runContextTokenLiveProbe({
      ...config,
      matrix,
      fetchImpl: async () => response,
    });
    assert.equal(report.executionStatus, "PARTIAL_FAILURE");
    assert.equal(report.requestCount, 0);
    assert.equal(report.estimatedCostUsd, null);
    assert.equal(report.matrix.status, "INSUFFICIENT_EVIDENCE");
    assert.doesNotMatch(JSON.stringify(report), /secret-never-save/);
  }
});
