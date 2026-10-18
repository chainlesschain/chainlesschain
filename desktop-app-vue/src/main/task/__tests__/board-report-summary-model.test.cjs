"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { fixture, withHost } = require("./board-authority-fixture.cjs");
const {
  createDesktopModelIngressHost,
} = require("../../evolution/desktop-model-ingress");
const {
  localEndpoint,
  captureDesktopReportSummaryModel,
} = require("../../evolution/desktop-report-summary-model");

// Optional inactive providers are absent from this narrow runtime. The actual
// LLMManager, OllamaClient, ingress, projector, SQLite and socket remain real;
// inherited Axios transport is poisoned to prove it is never used by summaries.
function loadManager() {
  const original = Module._load;
  Module._load = function (request, ...args) {
    if (request === "axios")
      return {
        create: () => ({
          get: async () => {
            throw new Error("inactive health check");
          },
          post: () => {
            throw new Error("MUTABLE AXIOS USED");
          },
        }),
      };
    if (args[0]?.filename?.endsWith("llm-manager.js")) {
      if (
        [
          "./openai-client",
          "./anthropic-client",
          "./gemini-client",
          "./mistral-client",
          "./volcengine-tools",
          "./manus-optimizations",
        ].includes(request)
      )
        return {};
    }
    return original.call(this, request, ...args);
  };
  try {
    return require("../../llm/llm-manager");
  } finally {
    Module._load = original;
  }
}
let managerModule;
async function setup(handler, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-summary-model-"));
  const f = fixture(path.join(directory, "vault.sqlite"));
  f.native.exec(
    "UPDATE team_reports SET yesterday_work='Source text for real ingress' WHERE id='report-1'",
  );
  const state = {
    requests: 0,
    bodies: [],
    compositions: [],
    confirmations: 0,
    confirm: options.confirm,
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    state.requests++;
    state.bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (handler) return handler(req, res, state);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        model: "summary-test:latest",
        done: true,
        done_reason: "stop",
        message: { role: "assistant", content: "真实协议响应摘要" },
        prompt_eval_count: 31,
        eval_count: 7,
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const repo = path.resolve(__dirname, "../../../../..");
  const { createAgentEvolutionRuntimeComposition } = await import(
    pathToFileURL(
      path.join(
        repo,
        "packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js",
      ),
    ).href
  );
  const { createTestAgentEvolutionComposition } = await import(
    pathToFileURL(
      path.join(
        repo,
        "packages/cli/__tests__/fixtures/agent-evolution-test-deployment.js",
      ),
    ).href
  );
  const ingressHost = createDesktopModelIngressHost(async (context) => {
    if (options.prepare) await options.prepare(f, state);
    const composition = createTestAgentEvolutionComposition(
      createAgentEvolutionRuntimeComposition,
      context,
      path.join(directory, "evidence"),
    );
    state.compositions.push(composition);
    return composition;
  });
  managerModule ||= loadManager();
  const manager = new managerModule.LLMManager(
    {
      provider: "ollama",
      ollamaURL: endpoint,
      model: "summary-test",
      enableStateBus: false,
      enableManusOptimizations: false,
    },
    ingressHost,
  );
  await manager.initialize();
  managerModule._setLLMManagerInstance(manager);
  const window = { isDestroyed: () => false };
  f.event.sender = { isDestroyed: () => false };
  f.electron = {
    BrowserWindow: { fromWebContents: () => window },
    dialog: {
      showMessageBox: async () => {
        state.confirmations++;
        return state.confirm ? await state.confirm(f, state) : { response: 0 };
      },
    },
  };
  return Object.assign(f, {
    directory,
    server,
    state,
    manager,
    endpoint,
    async cleanup() {
      managerModule._setLLMManagerInstance(null);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      f.close();
      const resolved = path.resolve(directory);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith("cc-summary-model-"));
      fs.rmSync(resolved, { recursive: true, force: true });
    },
  });
}

test("actual IPC uses governed projection, one literal loopback socket, response evidence and real token counts", async () => {
  const f = await setup();
  try {
    await withHost(f, async (h) => {
      const id = randomUUID();
      const result = await h.get("task:generate-ai-summary")(f.event, {
        reportId: "report-1",
        requestId: id,
      });
      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.summary, "真实协议响应摘要");
      assert.deepEqual(result.run.usage, {
        promptTokens: 31,
        completionTokens: 7,
      });
      assert.equal(f.state.requests, 1);
      assert.equal(f.state.compositions.length, 1);
      const body = f.state.bodies[0];
      assert.equal(body.model, "summary-test");
      assert.equal(body.stream, false);
      assert.equal(body.think, false);
      assert.equal(body.tools, undefined);
      assert.equal(body.messages.length, 3);
      assert.equal(body.messages[0].role, "system");
      assert.match(body.messages[2].content, /Source text for real ingress/);
      const report = await h.get("task:get-reports")(f.event, {
        orgId: "org-1",
        options: { boardId: "board-1", limit: 20 },
      });
      assert.equal(report.reports[0].aiSummary, result.summary);
      const status = await h.get("task:get-summary-status")(f.event, {
        reportId: "report-1",
      });
      assert.equal(status.run.status, "succeeded");
      const ledger = f.state.compositions[0].loadRun();
      assert.ok(ledger);
      assert.equal(ledger.projection.status, "completed");
      const kinds = ledger.events
        .map((event) => event.data?.evidenceKind)
        .filter(Boolean);
      for (const kind of ["user-prompt", "model-input", "response-completed"])
        assert.ok(kinds.includes(kind), kind);
      const run = f.native
        .prepare("SELECT * FROM task_report_summary_runs WHERE request_id=?")
        .get(id);
      assert.equal(run.evidence_run_id, f.state.compositions[0].runId);
      assert.equal(run.evidence_tenant_id, f.state.compositions[0].tenantId);
      await h.get("task:generate-ai-summary")(f.event, {
        reportId: "report-1",
        requestId: id,
      });
      assert.equal(f.state.requests, 1);
    });
  } finally {
    await f.cleanup();
  }
});

test("native decline precedes opening governed evidence", async () => {
  const f = await setup(null, { confirm: () => ({ response: 1 }) });
  try {
    await withHost(f, async (h) => {
      const result = await h.get("task:generate-ai-summary")(f.event, {
        reportId: "report-1",
        requestId: randomUUID(),
      });
      assert.equal(result.run.status, "cancelled");
      assert.equal(f.state.compositions.length, 0);
      assert.equal(f.state.requests, 0);
    });
  } finally {
    await f.cleanup();
  }
});

test("source changes during actual asynchronous evidence preparation prevent socket send", async () => {
  const f = await setup(null, {
    prepare: (f) =>
      f.native.exec(
        "UPDATE team_reports SET notes='Changed during preparation'",
      ),
  });
  try {
    await withHost(f, async (h) => {
      const result = await h.get("task:generate-ai-summary")(f.event, {
        reportId: "report-1",
        requestId: randomUUID(),
      });
      assert.equal(result.success, false);
      assert.equal(result.run.status, "stale");
      assert.equal(f.state.requests, 0);
    });
  } finally {
    await f.cleanup();
  }
});

for (const [label, payload] of Object.entries({
  unfinished: {
    model: "summary-test",
    done: false,
    message: { role: "assistant", content: "partial" },
  },
  tools: {
    model: "summary-test",
    done: true,
    message: { role: "assistant", content: "x", tool_calls: [] },
  },
  mismatch: {
    model: "other",
    done: true,
    message: { role: "assistant", content: "x" },
  },
  truncated: {
    model: "summary-test",
    done: true,
    done_reason: "length",
    message: { role: "assistant", content: "partial" },
  },
  oversized: {
    model: "summary-test",
    done: true,
    message: { role: "assistant", content: "x".repeat(16385) },
  },
}))
  test(`actual response ${label} is discarded and replay cannot resend`, async () => {
    const f = await setup((req, res) => res.end(JSON.stringify(payload)));
    try {
      await withHost(f, async (h) => {
        const id = randomUUID(),
          params = { reportId: "report-1", requestId: id };
        const result = await h.get("task:generate-ai-summary")(f.event, params);
        assert.equal(result.success, false);
        assert.equal(result.run.status, "unknown");
        assert.ok(!result.summary);
        assert.equal(
          f.native.prepare("SELECT ai_summary FROM team_reports").get()
            .ai_summary,
          null,
        );
        await h.get("task:generate-ai-summary")(f.event, params);
        assert.equal(f.state.requests, 1);
      });
    } finally {
      await f.cleanup();
    }
  });

test("redirect target is never followed and private server bodies never cross IPC", async () => {
  const f = await setup((req, res) => {
    res.writeHead(307, { Location: "http://127.0.0.1:1/PRIVATE" });
    res.end("PRIVATE server error");
  });
  try {
    await withHost(f, async (h) => {
      const result = await h.get("task:generate-ai-summary")(f.event, {
        reportId: "report-1",
        requestId: randomUUID(),
      });
      assert.equal(result.run.status, "unknown");
      assert.equal(f.state.requests, 1);
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    });
  } finally {
    await f.cleanup();
  }
});

test("cancel interrupts an actual pending socket, persists unknown and prevents late summary commit", async () => {
  let received;
  const ready = new Promise((resolve) => {
    received = resolve;
  });
  const f = await setup(() => received());
  try {
    await withHost(f, async (h) => {
      const params = { reportId: "report-1", requestId: randomUUID() };
      const pending = h.get("task:generate-ai-summary")(f.event, params);
      await ready;
      const cancelled = await h.get("task:cancel-summary")(f.event, params);
      assert.equal(cancelled.run.status, "unknown");
      const result = await pending;
      assert.equal(result.success, false);
      assert.equal(result.run.status, "unknown");
      assert.equal(
        f.native.prepare("SELECT ai_summary FROM team_reports").get()
          .ai_summary,
        null,
      );
    });
  } finally {
    await f.cleanup();
  }
});

test(
  "actual socket total timeout remains unknown and never auto-retries",
  { timeout: 90000 },
  async () => {
    const f = await setup(() => {});
    try {
      await withHost(f, async (h) => {
        const params = { reportId: "report-1", requestId: randomUUID() };
        const result = await h.get("task:generate-ai-summary")(f.event, params);
        assert.equal(result.success, false);
        assert.equal(result.run.status, "unknown");
        assert.equal(f.state.requests, 1);
        await h.get("task:generate-ai-summary")(f.event, params);
        assert.equal(f.state.requests, 1);
      });
    } finally {
      await f.cleanup();
    }
  },
);

test("remote/DNS/encoded/credentialed endpoints and ungoverned manager never admit report sources", () => {
  for (const endpoint of [
    "http://localhost:11434",
    "http://127.1:11434",
    "http://2130706433:11434",
    "http://127.0.0.2:11434",
    "https://127.0.0.1:11434",
    "http://user@127.0.0.1:11434",
    "http://127.0.0.1:11434/api",
    "http://127.0.0.1:11434/?x=1",
    "http://[::1]:99999",
  ])
    assert.throws(() => localEndpoint(endpoint));
  assert.equal(localEndpoint("http://[::1]:11434/"), "http://[::1]:11434");
  assert.throws(() =>
    captureDesktopReportSummaryModel({
      client: { baseURL: "http://127.0.0.1:11434", model: "test" },
    }),
  );
});
