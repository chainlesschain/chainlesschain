import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FormalBudgetAuthority } from "../src/lib/formal-budget-authority.js";
import { createFormalBudgetTransport } from "../src/lib/formal-budget-transport.js";
import {
  providerFetch,
  withFormalBudgetProviderScope,
} from "../src/lib/formal-budget-provider-scope.js";
import { withProviderRequestAdmission } from "../src/lib/provider-request-admission.js";
import { createCliContextMemoryRuntime } from "../src/lib/context-memory-kernel/runtime.js";
import { CliCanonicalMemoryService } from "../src/lib/context-memory-kernel/memory-service.js";
import { SegmentedMemoryPort } from "../src/lib/context-memory-kernel/segmented-memory-port.js";
import { prepareCanonicalProviderContext } from "../src/lib/context-memory-kernel/provider-context.js";
import { isRetryableStreamError } from "../src/lib/stream-retry.js";
import { withModelInputDiagnostics } from "../src/lib/model-input-diagnostics.js";
import {
  NOW,
  body,
  response,
  config,
  attest,
  verifyFixtureEvidence,
} from "./formal-budget-fixture.mjs";

const endpoint = "https://fixture.invalid/v1/chat/completions";
const marker = "BUDGET_MEMORY_PRIVATE_42917";
const parent = fs.realpathSync.native(os.tmpdir());
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function deadline(promise, label, milliseconds = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
function observe(promise) {
  return promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
}

async function fixture(
  t,
  {
    credentialProvider = async () => "synthetic-host-key",
    fetchImpl,
    onValidate,
  } = {},
) {
  const root = fs.mkdtempSync(path.join(parent, "cc-memory-budget-admission-"));
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Offline Memory-budget fixture refused ungoverned network");
  });
  const cfg = config();
  cfg.contracts[0].maxAnswerTokens = 4096;
  cfg.contracts[0].inputEnvelope.maximumRequestBytes = 128 * 1024;
  attest(cfg);
  const descriptor = FormalBudgetAuthority.initialize({
    filename: path.join(root, "authority.sqlite"),
    config: cfg,
    verifyEvidence: verifyFixtureEvidence,
    now: () => NOW,
  });
  const authority = new FormalBudgetAuthority({
    ...descriptor,
    verifyEvidence: verifyFixtureEvidence,
    now: () => NOW,
  });
  t.after(() => {
    authority.close();
    assert.equal(path.dirname(root), parent);
    assert(path.basename(root).startsWith("cc-memory-budget-admission-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  authority.beginRun({ taskId: "task-0", runId: "initial", phase: "initial" });
  const settings = {
    provider: "volcengine",
    model: body.model,
    baseUrl: "https://fixture.invalid/v1",
    sessionId: "memory-budget-admission",
    contextMemoryEnv: {
      CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    },
    contextMemoryFilePath: path.join(root, "memory.json"),
    contextMemoryModelWindowTokens: 8192,
    contextMemorySelectedToolNames: [],
    contextMemoryToolDefinitions: [],
    maxOutputTokens: 256,
    // Deliberately no signal: transport cancellation must be independently bound.
  };
  const runtime = createCliContextMemoryRuntime({
    env: settings.contextMemoryEnv,
    memoryFilePath: settings.contextMemoryFilePath,
    purgePorts: [],
  });
  assert(runtime.memoryPort instanceof SegmentedMemoryPort);
  const service = new CliCanonicalMemoryService({ runtime });
  await service.addScoped(`BUDGET_MEMORY_TOPIC ${marker}`, {
    memoryId: "budget-memory-original",
    scope: "user",
    scopeId: "local-user",
    allowedSinks: ["provider.volcengine"],
    importance: 0.9,
  });
  const prepared = await prepareCanonicalProviderContext(
    [{ role: "user", content: "Use BUDGET_MEMORY_TOPIC" }],
    settings,
  );
  assert.equal(prepared.admissionEnabled, true);
  assert.equal(prepared.plan.memoryRevision, 1);
  assert(JSON.stringify(prepared.messages).includes(marker));
  assert.equal(Object.hasOwn(settings, "signal"), false);
  const request = { ...body, messages: prepared.messages };
  let physical = 0,
    credentials = 0;
  const transport = createFormalBudgetTransport({
    authority,
    timeoutMs: 30_000,
    credentialProvider: async (...args) => {
      credentials += 1;
      return credentialProvider(...args);
    },
    fetchImpl: (...args) => {
      physical += 1;
      return fetchImpl ? fetchImpl(...args) : Response.json(response());
    },
  });
  return {
    authority,
    runtime,
    service,
    prepared,
    settings,
    counts: () => ({ physical, credentials }),
    secondPort: () =>
      createCliContextMemoryRuntime({
        env: settings.contextMemoryEnv,
        memoryFilePath: settings.contextMemoryFilePath,
        purgePorts: [],
      }).memoryPort,
    run: (operation) =>
      withFormalBudgetProviderScope({ transport, runId: "initial" }, () =>
        withProviderRequestAdmission(
          {
            enabled: prepared.admissionEnabled,
            target: { provider: "volcengine" },
            validate: (...args) => {
              onValidate?.();
              return prepared.assertCurrent(...args);
            },
            check: (...args) => prepared.assertDispatchOpen(...args),
            resource: prepared.dispatchResource,
          },
          operation,
        ),
      ),
    runBudgetOnly: (operation) =>
      withFormalBudgetProviderScope({ transport, runId: "initial" }, operation),
    post: (extra = {}) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      ...extra,
    }),
  };
}

function assertUnknown(f, error, expectedExposure) {
  assert.equal(error?.code, "CC_BUDGET_TRANSPORT_UNKNOWN");
  assert.equal(isRetryableStreamError(error), false);
  const status = f.authority.status();
  assert.equal(status.pending.length, 1);
  assert.equal(status.pending[0].state, "unknown");
  assert(status.exposureUsdMicros > 0);
  if (expectedExposure !== undefined)
    assert.equal(status.exposureUsdMicros, expectedExposure);
  assert.equal(f.counts().physical, 0);
}

for (const stage of ["adapter-body", "governed-fetch-body"]) {
  test(`Memory deletion during ${stage} diagnostic blocks dispatch without observer lock deadlock`, async (t) => {
    const f = await fixture(t);
    const diagnostics = [];
    await assert.rejects(
      deadline(
        withModelInputDiagnostics(
          {
            onModelInputDiagnostic: async (event) => {
              diagnostics.push(event);
              if (event.stage === stage) {
                assert.equal(
                  (await f.service.delete("budget-memory-original")).status,
                  "purged",
                );
              }
            },
          },
          () => f.run(() => providerFetch(endpoint, f.post())),
        ),
        "Diagnostic observer must complete outside the Memory lock",
      ),
      (error) =>
        error.code ===
        (stage === "adapter-body"
          ? "revision_conflict"
          : "CC_BUDGET_TRANSPORT_UNKNOWN"),
    );
    assert.equal(f.counts().physical, 0);
    assert.equal(f.counts().credentials, stage === "adapter-body" ? 0 : 1);
    assert.equal(
      diagnostics.filter((event) => event.stage === stage).length,
      1,
    );
    assert.equal(
      diagnostics.every((event) => event.attempt === 1),
      true,
    );
    assert.equal(JSON.stringify(diagnostics).includes(marker), false);
    if (stage === "adapter-body") {
      assert.equal(f.authority.status().pending.length, 0);
      assert.equal(f.authority.status().exposureUsdMicros, 0);
    } else {
      assert.equal(f.authority.status().pending[0].state, "unknown");
      assert(f.authority.status().exposureUsdMicros > 0);
    }
  });
}

test("credential-await Memory deletion blocks physical dispatch and retains unknown budget liability", async (t) => {
  let f, reservedExposure;
  f = await fixture(t, {
    credentialProvider: async () => {
      reservedExposure = f.authority.status().exposureUsdMicros;
      assert(reservedExposure > 0);
      assert.equal(
        (await f.service.delete("budget-memory-original")).status,
        "purged",
      );
      assert.equal(await f.runtime.memoryPort.getRevision(), 5);
      return "synthetic-host-key";
    },
  });
  const outcome = await observe(f.run(() => providerFetch(endpoint, f.post())));
  assertUnknown(f, outcome.error, reservedExposure);
  assert.equal(f.counts().credentials, 1);
  // Test the budget independently: no stale Memory cap can mask its refusal.
  const retry = await observe(
    f.runBudgetOnly(() =>
      providerFetch(endpoint, f.post({ body: JSON.stringify(body) })),
    ),
  );
  assert(retry.error);
  assert.equal(f.counts().physical, 0);
  assert.equal(f.counts().credentials, 1);
});

test("independent transport Stop rejects before a held Memory lock is released and never dispatches late", async (t) => {
  const entered = deferred(),
    release = deferred(),
    validationWaiting = deferred();
  const controller = new AbortController();
  let f,
    held,
    credentialReturned = false,
    reservedExposure;
  f = await fixture(t, {
    credentialProvider: async () => {
      reservedExposure = f.authority.status().exposureUsdMicros;
      held = f.secondPort().withRevisionGuard(1, async () => {
        entered.resolve();
        await release.promise;
        return { value: Promise.resolve() };
      });
      void held.catch(() => {});
      await entered.promise;
      credentialReturned = true;
      return "synthetic-host-key";
    },
    onValidate: () => {
      if (credentialReturned) validationWaiting.resolve();
    },
  });
  const settled = observe(
    f.run(() => providerFetch(endpoint, f.post({ signal: controller.signal }))),
  );
  let beforeRelease;
  try {
    await deadline(
      validationWaiting.promise,
      "Request did not reach the held Memory authority",
    );
    controller.abort(new Error("synthetic external Stop"));
    beforeRelease = await Promise.race([
      settled.then((outcome) => ({
        settled: true,
        code: outcome.error?.code ?? null,
      })),
      delay(250).then(() => ({ settled: false, code: null })),
    ]);
    assert.equal(f.counts().physical, 0);
  } finally {
    release.resolve();
    if (held) await deadline(held, "Memory lock did not release");
  }
  const outcome = await deadline(
    settled,
    "Cancelled transport did not finish after fixture cleanup",
  );
  await delay(25);
  assertUnknown(f, outcome.error, reservedExposure);
  assert.equal(f.counts().credentials, 1);
  assert.deepEqual(
    beforeRelease,
    { settled: true, code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
    JSON.stringify({
      stage: "independent-transport-abort-before-lock-release",
      ...beforeRelease,
      physical: f.counts().physical,
    }),
  );
});

test("budget dispatch releases Memory authority while the HTTP response is still pending", async (t) => {
  const dispatched = deferred(),
    http = deferred();
  let f,
    responseSettled = false;
  f = await fixture(t, {
    fetchImpl: () => {
      assert.equal(f.authority.status().pending[0].state, "dispatched");
      dispatched.resolve();
      return http.promise;
    },
  });
  const request = observe(
    f.run(async () => {
      const res = await providerFetch(endpoint, f.post());
      const value = await res.json();
      responseSettled = true;
      return value;
    }),
  );
  try {
    await deadline(dispatched.promise, "Physical request was not started");
    const deleted = await deadline(
      f.service.delete("budget-memory-original"),
      "Pending HTTP retained the Memory authority lock",
    );
    assert.equal(deleted.status, "purged");
    assert.equal(responseSettled, false);
    assert.equal(f.counts().physical, 1);
    http.resolve(Response.json(response()));
    const outcome = await deadline(
      request,
      "Successful response did not settle",
    );
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.value.model, body.model);
    assert.equal(f.authority.status().pending.length, 0);
    assert(f.authority.status().exposureUsdMicros > 0);
  } finally {
    http.resolve(Response.json(response()));
    await deadline(request, "HTTP fixture cleanup did not finish");
  }
});
