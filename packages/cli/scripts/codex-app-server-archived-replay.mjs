#!/usr/bin/env node
// Read-only native discovery of archived real rollouts; never submit a turn.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import {
  bounded,
  exactSource,
  isolatedEnvironment,
  officialValidators,
  ProbeClient,
  resolveBinary,
} from "./codex-app-server-turn-probe.mjs";
import {
  collectHistoryPages,
  getHistoryPagination,
  createHistoryCheckRecorder,
  cleanupHistoryResources,
} from "./codex-app-server-history-probe.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const archive = fileURLToPath(
  new URL(
    "../../../docs/research/cli/evidence/codex-history-scan-2026-10-29/",
    import.meta.url,
  ),
);
export function loadArchivedRollouts(version, directory = archive) {
  assert.ok(
    ["0.160.0", "0.164.0"].includes(version),
    "unsupported archived version",
  );
  const manifestBytes = readFileSync(join(directory, "review.json"));
  const manifest = JSON.parse(manifestBytes);
  const readArtifact = (name) => {
    assert.equal(basename(name), name, "archive name must be a filename");
    const record = manifest.artifacts.find((entry) => entry.path === name);
    assert.ok(record, "missing archived digest");
    const compressed = readFileSync(join(directory, name));
    assert.equal(
      sha256(compressed),
      record.sha256,
      "compressed digest mismatch",
    );
    const bytes = gunzipSync(compressed, { maxOutputLength: 8 * 1024 * 1024 });
    assert.equal(
      sha256(bytes),
      record.originalSha256,
      "rollout digest mismatch",
    );
    return bytes;
  };
  const label =
    version === "0.160.0"
      ? "native-0-160-0-scan-repair-confirmation"
      : "native-0-164-0-scan-repair";
  const report = JSON.parse(readArtifact(label + ".json.gz"));
  const entries = report.historyChecks.rolloutRepair.cases.asc.rollouts;
  assert.equal(entries.length, 2, "expected the original two-thread fixture");
  const rollouts = entries.map((entry) => {
    const parts = entry.relativePath.split(/[\\/]/u);
    assert.ok(
      parts[0] === "sessions" &&
        parts.length >= 2 &&
        parts.every(
          (part) =>
            part && part !== "." && part !== ".." && !part.includes(":"),
        ),
      "invalid rollout relative path",
    );
    const bytes = readArtifact(
      "rollout-" + version + "-" + entry.threadId + ".jsonl.gz",
    );
    assert.equal(sha256(bytes), entry.sha256);
    const meta = JSON.parse(bytes.toString("utf8").split(/\r?\n/u)[0]);
    assert.equal(meta.type, "session_meta");
    assert.equal(meta.payload.id, entry.threadId);
    assert.equal(meta.payload.model_provider, "fixture");
    return { ...entry, parts, bytes, source: meta.payload.source };
  });
  assert.equal(new Set(rollouts.map((entry) => entry.threadId)).size, 2);
  return {
    rollouts,
    manifestSha256: sha256(manifestBytes),
    sourceCommit: report.commitSha,
  };
}

export function replayRequest(client, method, params) {
  assert.ok(
    ["initialize", "thread/list"].includes(method),
    "replay RPC is not read-only",
  );
  return bounded(
    client.guard(client.request(method, params), method),
    30_000,
    method,
  );
}

export async function runArchivedReplay({
  codexJs,
  version,
  commitSha,
  output,
}) {
  exactSource(commitSha);
  const fixture = loadArchivedRollouts(version);
  const upstream = resolveBinary(codexJs, version);
  const validators = officialValidators(version);
  const root = mkdtempSync(join(tmpdir(), "cc-codex-archived-replay-"));
  const clients = [],
    cases = [],
    requests = [];
  const checks = createHistoryCheckRecorder();
  const provider = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    request.resume();
    response.writeHead(503);
    response.end("Inference is forbidden in archived replay");
  });
  let failure, cleanup;
  try {
    await bounded(
      new Promise((yes, no) => {
        provider.once("error", no);
        provider.listen(0, "127.0.0.1", yes);
      }),
      5000,
      "rejecting provider listen",
    );
    // Every sort key/direction has a new home; later queries never warm another case.
    for (const sortKey of ["recency_at", "created_at"]) {
      for (const sortDirection of ["asc", "desc"]) {
        const entry = { sortKey, sortDirection, status: "checking" };
        cases.push(entry);
        await checks.check(sortKey + ":" + sortDirection, async () => {
          const environment = isolatedEnvironment(
            join(root, sortKey + "-" + sortDirection),
          );
          for (const directory of Object.values(environment).filter((value) =>
            value.startsWith(root),
          ))
            mkdirSync(directory, { recursive: true });
          entry.home = environment.CODEX_HOME;
          writeFileSync(
            join(entry.home, "config.toml"),
            [
              'model = "fixture-codex"',
              'model_provider = "fixture"',
              'approval_policy = "never"',
              'sandbox_mode = "read-only"',
              "[model_providers.fixture]",
              'name = "Reject inference"',
              'base_url = "http://127.0.0.1:' +
                provider.address().port +
                '/v1"',
              'wire_api = "responses"',
              "requires_openai_auth = false",
              "request_max_retries = 0",
              "stream_max_retries = 0",
              "",
            ].join("\n"),
            { flag: "wx" },
          );
          const reported = execFileSync(upstream.binary, ["--version"], {
            env: environment,
            cwd: root,
            windowsHide: true,
            encoding: "utf8",
            timeout: 15_000,
          }).trim();
          assert.equal(reported, "codex-cli " + version);
          const child = spawn(
            upstream.binary,
            ["app-server", "--listen", "stdio://"],
            {
              env: environment,
              cwd: root,
              windowsHide: true,
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          entry.pid = child.pid;
          const client = new ProbeClient(child, validators);
          clients.push(client);
          const request = (method, params) =>
            replayRequest(client, method, params);
          try {
            await request("initialize", {
              clientInfo: {
                name: "chainlesschain_archived_replay",
                version: "1.0.0",
              },
            });
            child.stdin.write(
              JSON.stringify({ method: "initialized", params: {} }) + "\n",
            );
            const params = {
              limit: 1,
              sortKey,
              sortDirection,
              modelProviders: ["fixture"],
              sourceKinds: [
                ...new Set(fixture.rollouts.map((rollout) => rollout.source)),
              ],
            };
            const dbParams = { ...params, useStateDbOnly: true };
            entry.beforeCopy = await collectHistoryPages(
              request,
              "thread/list",
              dbParams,
            );
            assert.deepEqual(
              entry.beforeCopy.data,
              [],
              "new home contains history",
            );
            entry.rollouts = fixture.rollouts.map((rollout) => {
              const destination = join(entry.home, ...rollout.parts);
              mkdirSync(dirname(destination), { recursive: true });
              writeFileSync(destination, rollout.bytes, { flag: "wx" });
              assert.equal(sha256(readFileSync(destination)), rollout.sha256);
              return {
                threadId: rollout.threadId,
                relativePath: rollout.relativePath,
                sha256: rollout.sha256,
              };
            });
            entry.afterCopy = await collectHistoryPages(
              request,
              "thread/list",
              dbParams,
            );
            assert.deepEqual(
              entry.afterCopy.data,
              [],
              "rollouts indexed before first scan",
            );
            entry.missingIndexObserved = true;
            const scanParams = { ...params, useStateDbOnly: false };
            entry.firstScanVerified = await checks.check(
              sortKey + ":" + sortDirection + ":first-scan",
              async () => {
                entry.firstScan = await collectHistoryPages(
                  request,
                  "thread/list",
                  scanParams,
                ).catch((error) => {
                  entry.firstScan = {
                    complete: false,
                    historyPagination: getHistoryPagination(error),
                  };
                  throw error;
                });
                assert.deepEqual(
                  new Set(entry.firstScan.data.map((thread) => thread.id)),
                  new Set(fixture.rollouts.map((rollout) => rollout.threadId)),
                  "cold scan omitted archived identity",
                );
                assert.ok(
                  entry.firstScan.pages.length >= 2,
                  "cold scan did not continue",
                );
              },
            );
            // Preserve first-scan failure even when a later full read finds all identities.
            entry.laterFullScan = await request("thread/list", {
              ...scanParams,
              limit: 100,
            });
            assert.equal(
              requests.length,
              0,
              "history issued forbidden provider request",
            );
            entry.status = entry.firstScanVerified ? "passed" : "failed";
          } finally {
            entry.processClosed = await client.stop();
          }
        });
        if (entry.status === "checking") entry.status = "failed";
      }
    }
    for (const sortKey of ["recency_at", "created_at"]) {
      const pair = cases.filter((entry) => entry.sortKey === sortKey);
      if (pair.every((entry) => entry.firstScanVerified)) {
        await checks.check(sortKey + ":direction-order", async () => {
          assert.deepEqual(
            pair[1].firstScan.data.map((thread) => thread.id),
            pair[0].firstScan.data.map((thread) => thread.id).reverse(),
          );
        });
      }
    }
    await checks.check("source-after-observations", async () =>
      exactSource(commitSha),
    );
    checks.assertPassed();
  } catch (error) {
    failure = error;
  } finally {
    cleanup = await cleanupHistoryResources({
      clients,
      server: provider,
      failure,
    });
    failure = cleanup.failure;
  }
  if (requests.length)
    failure ||= new Error("history issued forbidden provider request");
  const report = {
    schema: "chainlesschain.codex-archived-replay/v1",
    commitSha,
    status: failure ? "failed" : "passed",
    platform: process.platform,
    arch: process.arch,
    upstream: { version, binarySha256: upstream.binarySha256 },
    archive: {
      manifestSha256: fixture.manifestSha256,
      sourceCommit: fixture.sourceCommit,
    },
    cases,
    strictFailures: checks.failures,
    providerRequests: requests,
    turnStartRequests: 0,
    productionAdmission: false,
    realProviderAcceptance: false,
    boundary:
      "Original archived bytes, isolated homes, no cwd filter; this is discovery evidence only.",
    officialSchema: {
      hashes: validators.hashes,
      validatedMessages: validators.counts,
    },
    processClosed: cleanup.closures,
    cleanupErrors: cleanup.cleanupErrors,
    ...(failure
      ? { error: { name: failure.name, message: failure.message } }
      : {}),
  };
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  if (failure) throw failure;
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = {},
    names = {
      "--codex-js": "codexJs",
      "--version": "version",
      "--commit-sha": "commitSha",
      "--output": "output",
    };
  for (let i = 2; i < process.argv.length; i += 2) {
    assert.ok(
      Object.hasOwn(names, process.argv[i]) && process.argv[i + 1],
      "invalid replay arguments",
    );
    options[names[process.argv[i]]] = process.argv[i + 1];
  }
  runArchivedReplay(options)
    .then((report) => process.stdout.write(JSON.stringify(report) + "\n"))
    .catch((error) => {
      process.stderr.write(error.stack + "\n");
      process.exitCode = 1;
    });
}
