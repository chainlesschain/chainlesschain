"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  openEvolutionWorkbenchPanel,
} = require("../src/ui/evolution-workbench-panel");
const {
  openLlmConfigPanel,
  validateAnswers,
} = require("../src/ui/llm-config-panel");
const { PROVIDER_PRESETS, applyLlmConnection } = require("../src/llm-config");
const {
  openSkillCatalogPanel,
  parseSkillCatalog,
} = require("../src/ui/skill-catalog-panel");
const d = (c) => "sha256:" + c.repeat(64);
const {
  deploymentReadinessRows,
} = require("../src/evolution-deployment-config.js");

function admissionProjection(command, state = "admitted") {
  return {
    scope: "deployment-admission",
    state,
    ready: state === "admitted",
    requiredCommands: [command],
    runtimeVerification: "not_checked",
    taskReady: state === "admitted" ? null : false,
    detail: "<script>plain diagnostic</script>",
    remediation: "copy-only instruction",
  };
}

test("deployment admission remains distinct from runtime verification and old CLI output", () => {
  const rows = deploymentReadinessRows({
    readiness: {
      ask: admissionProjection("ask"),
      agent: admissionProjection("agent", "command_not_allowed"),
    },
  });
  assert.equal(rows[0].summary, "部署准入通过");
  assert.equal(rows[1].summary, "部署准入被阻断");
  assert.equal(rows[0].detail, "<script>plain diagnostic</script>");
  for (const state of [
    "not_configured",
    "disabled",
    "invalid",
    "command_not_allowed",
  ]) {
    assert.equal(
      deploymentReadinessRows({
        readiness: { ask: admissionProjection("ask", state) },
      })[0].state,
      state,
    );
  }
  for (const status of [
    { verified: true, commands: ["ask", "agent"] },
    { readiness: { ask: { ...admissionProjection("ask"), taskReady: true } } },
    { readiness: { ask: admissionProjection("agent") } },
  ]) {
    assert.equal(deploymentReadinessRows(status)[0].state, "unknown");
  }
});

test("deployment webview renders literal diagnostics and clears readiness on an older response", () => {
  const elements = new Map();
  const messages = [];
  let receive;
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        textContent: "",
        value: "",
        disabled: false,
        set innerHTML(_value) {
          throw new Error("diagnostics must render as text");
        },
      });
    return elements.get(id);
  };
  require("node:vm").runInNewContext(
    require("node:fs").readFileSync(
      require("node:path").join(
        __dirname,
        "../media/evolution-deployment-config.js",
      ),
      "utf8",
    ),
    {
      acquireVsCodeApi: () => ({
        postMessage: (message) => messages.push(message),
      }),
      document: { getElementById: element, querySelectorAll: () => [] },
      window: {
        addEventListener: (_name, handler) => {
          receive = handler;
        },
      },
    },
  );
  const status = {
    readiness: {
      ask: admissionProjection("ask"),
      agent: admissionProjection("agent"),
    },
  };
  receive({
    data: {
      type: "status",
      status,
      readinessRows: deploymentReadinessRows(status),
    },
  });
  assert.match(element("readiness-ask").textContent, /部署准入通过/);
  assert.equal(
    element("readiness-ask-detail").textContent,
    "<script>plain diagnostic</script>",
  );
  receive({ data: { type: "status", status: { verified: true } } });
  assert.match(element("readiness-ask").textContent, /未提供准入诊断/);
  assert.equal(element("readiness-ask-remediation").textContent, "");
  assert.deepEqual(
    messages.map((message) => message.type),
    ["ready"],
  );
});

function host(t) {
  let handler, dispose;
  const messages = [];
  const panel = {
    reveal() {},
    webview: {
      cspSource: "vscode-resource:",
      asWebviewUri: (uri) => uri,
      postMessage: (m) => messages.push(m),
      onDidReceiveMessage: (h) => {
        handler = h;
      },
    },
    onDidDispose: (h) => {
      dispose = h;
    },
  };
  t.after(() => dispose?.());
  const vscode = {
    Uri: { file: (p) => p },
    ViewColumn: { Active: 1 },
    window: {
      createWebviewPanel: () => panel,
      showWarningMessage: async (_m, _o, action) => action,
    },
    workspace: {},
  };
  return { vscode, panel, messages, send: (m) => handler(m) };
}
function projection() {
  return {
    projectionDigest: d("a"),
    total: 1,
    offset: 0,
    limit: 500,
    hasMore: false,
    governance: {
      runStatus: "active",
      activeReleaseId: d("1"),
      lastKnownGoodReleaseId: d("2"),
      conflictCount: 0,
      pilot: null,
    },
    candidates: [
      {
        packetDigest: d("b"),
        candidateContentDigest: d("c"),
        candidateId: "candidate:<script>",
        status: "pending",
        actualUsage: { active: false },
      },
    ],
  };
}
test("deployment panel forwards admission and refreshes older CLI responses without invoking remediation", async (t) => {
  const h = host(t);
  const api = require("../src/evolution-deployment-config.js");
  const open =
    require("../src/ui/evolution-deployment-config-panel.js").openEvolutionDeploymentConfigPanel;
  const results = [
    {
      readiness: {
        ask: admissionProjection("ask"),
        agent: admissionProjection("agent", "disabled"),
      },
    },
    { verified: true },
  ];
  const statusCall = t.mock.method(
    api,
    "getEvolutionDeploymentStatus",
    async () => results.shift(),
  );
  const configureCall = t.mock.method(
    api,
    "configureEvolutionDeployment",
    async () => {
      throw new Error("read-only refresh");
    },
  );
  open(h.vscode, { getCommand: () => "cc", getCwd: () => "/project" });
  await h.send({ type: "ready" });
  assert.equal(
    h.messages.findLast((item) => item.type === "status").readinessRows[0]
      .state,
    "admitted",
  );
  await h.send({ type: "reload" });
  assert.equal(
    h.messages.findLast((item) => item.type === "status").readinessRows[0]
      .state,
    "unknown",
  );
  assert.equal(statusCall.mock.callCount(), 2);
  assert.equal(configureCall.mock.callCount(), 0);
  assert.match(h.panel.webview.html, /实际任务运行尚未验证/);
  assert.match(h.panel.webview.html, /HOLD/);
});

test("Workbench panel negotiates capabilities and rejects stale UI approval", async (t) => {
  const h = host(t),
    calls = [],
    state = projection();
  const pilot = {
    workbenchMode: "local-test",
    start: async () => ({
      evolutionWorkbench: { available: true, methods: ["list", "review"] },
    }),
    evolutionWorkbenchList: async () => state,
    evolutionWorkbenchReview: async (input) => {
      calls.push(input);
      return {};
    },
  };
  openEvolutionWorkbenchPanel(h.vscode, { getPilot: async () => pilot });
  await h.send({ type: "ready" });
  const snapshot = h.messages.findLast((m) => m.type === "snapshot");
  assert.equal(snapshot.mode, "local-test");
  await h.send({
    type: "approve",
    projectionDigest: d("0"),
    packetDigest: d("b"),
    reason: "reviewed",
  });
  assert.equal(calls.length, 0);
  await h.send({
    type: "approve",
    projectionDigest: d("a"),
    packetDigest: d("b"),
    reason: "reviewed",
  });
  assert.deepEqual(calls, [
    { packetDigests: [d("b")], decision: "approve", reason: "reviewed" },
  ]);
  assert.match(h.panel.webview.html, /Content-Security-Policy/);
  assert.doesNotMatch(h.panel.webview.html, /candidate:<script>/);
});
test("Workbench unavailable panel exposes configuration without Workbench calls", async (t) => {
  const h = host(t);
  openEvolutionWorkbenchPanel(h.vscode, {
    getPilot: async () => ({
      start: async () => ({ evolutionWorkbench: { available: false } }),
      evolutionWorkbenchList: () => {
        throw new Error("must not call");
      },
    }),
  });
  await h.send({ type: "ready" });
  assert.equal(
    h.messages.findLast((m) => m.type === "snapshot").mode,
    "unavailable",
  );
});

test("Workbench bounds startup, enables retry and ignores a late previous connection", async (t) => {
  const h = host(t);
  let release,
    starts = 0,
    attempts = 0;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const pilot = {
    workbenchMode: "local-test",
    start: async () => {
      starts++;
      return { evolutionWorkbench: { available: true, methods: ["list"] } };
    },
    evolutionWorkbenchList: async () => projection(),
  };
  openEvolutionWorkbenchPanel(h.vscode, {
    getPilot: () => (++attempts === 1 ? delayed : Promise.resolve(pilot)),
    readTimeoutMs: 10,
  });
  await h.send({ type: "ready" });
  assert.match(h.messages.findLast((m) => m.type === "notice").text, /超时/);
  assert.deepEqual(h.messages.at(-1), { type: "busy", value: false });
  await h.send({ type: "refresh" });
  assert.equal(
    h.messages.findLast((m) => m.type === "snapshot").mode,
    "local-test",
  );
  const count = h.messages.length;
  release(pilot);
  await new Promise(setImmediate);
  assert.equal(starts, 1);
  assert.equal(h.messages.length, count);
});

test("Workbench replays loading state to a reloaded webview and bounds a stalled list", async (t) => {
  const h = host(t);
  let lists = 0;
  openEvolutionWorkbenchPanel(h.vscode, {
    getPilot: async () => ({
      start: async () => ({
        evolutionWorkbench: { available: true, methods: ["list"] },
      }),
      evolutionWorkbenchList: () => {
        lists++;
        return new Promise(() => {});
      },
    }),
    readTimeoutMs: 20,
  });
  const opening = h.send({ type: "ready" });
  await new Promise(setImmediate);
  await h.send({ type: "ready" });
  assert.match(
    h.messages.findLast((m) => m.type === "notice").text,
    /正在读取候选/,
  );
  assert.equal(lists, 1);
  await opening;
  assert.equal(
    h.messages.findLast((m) => m.type === "snapshot").mode,
    "unavailable",
  );
  assert.deepEqual(h.messages.at(-1), { type: "busy", value: false });
});

test("Workbench reads and reviews candidates beyond the first CLI page", async (t) => {
  const h = host(t),
    pages = [],
    reviews = [];
  const state = projection();
  const candidates = Array.from({ length: 501 }, (_, i) => ({
    ...state.candidates[0],
    candidateId: `candidate:${i}`,
    packetDigest: "sha256:" + i.toString(16).padStart(64, "0"),
  }));
  openEvolutionWorkbenchPanel(h.vscode, {
    getPilot: async () => ({
      start: async () => ({
        evolutionWorkbench: { available: true, methods: ["list", "review"] },
      }),
      evolutionWorkbenchList: async ({ offset, limit }) => {
        pages.push(offset);
        return {
          ...state,
          total: candidates.length,
          offset,
          limit,
          hasMore: offset + limit < candidates.length,
          candidates: candidates.slice(offset, offset + limit),
        };
      },
      evolutionWorkbenchReview: async (input) => {
        reviews.push(input);
        return {};
      },
    }),
  });
  await h.send({ type: "ready" });
  assert.deepEqual(pages, [0, 500]);
  assert.equal(
    h.messages.findLast((m) => m.type === "snapshot").projection.candidates
      .length,
    501,
  );
  await h.send({
    type: "approve",
    projectionDigest: state.projectionDigest,
    packetDigest: candidates[500].packetDigest,
    reason: "reviewed last page",
  });
  assert.equal(reviews.length, 1);
  assert.deepEqual(reviews[0].packetDigests, [candidates[500].packetDigest]);
});

test("Workbench rejects missing, repeated or changing CLI pages before showing candidates", async (t) => {
  const {
    loadEvolutionWorkbenchSnapshot,
  } = require("../src/ui/evolution-workbench-snapshot");
  for (const problem of [
    "missing",
    "duplicate",
    "digest",
    "governance",
    "count",
    "oversized",
  ]) {
    await t.test(problem, async () => {
      const state = projection();
      const first = {
        ...state,
        total: 501,
        hasMore: true,
        candidates: Array.from({ length: 500 }, (_, i) => ({
          ...state.candidates[0],
          packetDigest: "sha256:" + i.toString(16).padStart(64, "0"),
        })),
      };
      let calls = 0;
      await assert.rejects(
        loadEvolutionWorkbenchSnapshot({
          evolutionWorkbenchList: async () => {
            calls++;
            if (problem === "missing") return { ...state, total: undefined };
            if (problem === "oversized") return { ...first, total: 10001 };
            if (calls === 1) return first;
            const page = { ...state, total: 501, offset: 500 };
            if (problem === "duplicate")
              page.candidates = [first.candidates[0]];
            if (problem === "digest") page.projectionDigest = d("f");
            if (problem === "governance")
              page.governance = { ...page.governance, conflictCount: 1 };
            if (problem === "count") page.total = 500;
            return page;
          },
        }),
        /分页|重复|状态发生变化/,
      );
      assert.ok(calls <= 2);
    });
  }
});
test("custom relays require a scoped key, allow arbitrary model aliases, and reject malformed endpoints", () => {
  const current = {
    provider: "openai",
    baseUrl: "https://original.example/v1",
    hasKey: true,
  };
  const draft = {
    provider: "openai",
    baseUrl: "https://relay.example/api/v1",
    model: "team/custom-model",
    visionModel: "",
    apiKey: "",
  };
  assert.throws(() => validateAnswers(draft, current), /API Key/);
  assert.equal(
    validateAnswers({ ...draft, apiKey: "relay-key" }, current).model,
    "team/custom-model",
  );
  assert.equal(
    validateAnswers({ ...draft, baseUrl: current.baseUrl }, current).apiKey,
    "",
  );
  assert.throws(
    () =>
      validateAnswers(
        { ...draft, baseUrl: "https://u:p@relay.example/v1", apiKey: "key" },
        current,
      ),
    /地址/,
  );
  assert.throws(
    () =>
      validateAnswers(
        {
          ...draft,
          baseUrl: "https://relay.example/v1/chat/completions",
          apiKey: "key",
        },
        current,
      ),
    /基础地址/,
  );
});
test("LLM panel never returns an existing or newly submitted key to the webview", async (t) => {
  const h = host(t),
    calls = [];
  let savedModel = "model";
  const api = {
    PROVIDER_PRESETS,
    getConfiguredProvider: async () => "openai",
    getConfiguredModel: async () => savedModel,
    getConfiguredBaseUrl: async () => "https://relay.example/v1",
    getConfiguredVisionModel: async () => null,
    hasConfiguredApiKey: async () => true,
    applyLlmConnection: async (input) => {
      calls.push(input);
      savedModel = input.answers.model;
      return { ok: true };
    },
  };
  openLlmConfigPanel(h.vscode, { api });
  await h.send({ type: "ready" });
  await h.send({
    type: "save",
    answers: {
      provider: "openai",
      model: "custom-model",
      baseUrl: "https://relay.example/v1",
      visionModel: "",
      apiKey: "super-secret",
    },
  });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(h.messages), /super-secret/);
  assert.equal(
    h.messages.find((m) => m.type === "config").current.hasKey,
    true,
  );
});
test("LLM panel reports unconfirmed writes when a successful CLI exit reads back old configuration", async (t) => {
  const h = host(t);
  let configured = 0;
  const api = {
    PROVIDER_PRESETS,
    getConfiguredProvider: async () => "openai",
    getConfiguredModel: async () => "old-model",
    getConfiguredBaseUrl: async () => "https://relay.example/v1",
    getConfiguredVisionModel: async () => null,
    hasConfiguredApiKey: async () => true,
    applyLlmConnection: async () => ({ ok: true }),
  };
  openLlmConfigPanel(h.vscode, {
    api,
    onConfigured: () => {
      configured++;
    },
  });
  await h.send({ type: "ready" });
  await h.send({
    type: "save",
    answers: {
      provider: "openai",
      model: "new-model",
      baseUrl: "https://relay.example/v1",
      visionModel: "",
      apiKey: "",
    },
  });
  assert.equal(configured, 0);
  assert.ok(
    !h.messages.some((m) => m.type === "notice" && m.kind === "success"),
  );
  assert.match(
    h.messages.filter((m) => m.type === "notice").at(-1).text,
    /回读结果/,
  );
});
test("atomic LLM configuration travels over stdin, including script entrypoints", async () => {
  let seen;
  const execFile = (command, args, options, callback) => {
    seen = { command, args, options };
    return {
      stdin: {
        on() {},
        end(input) {
          seen.input = input;
          callback(null, "ok", "");
        },
      },
    };
  };
  const result = await applyLlmConnection({
    command: "C:/cli/chainlesschain.js",
    answers: { apiKey: "secret" },
    deps: { execFile },
  });
  assert.equal(result.ok, true);
  assert.equal(seen.command, process.execPath);
  assert.equal(seen.options.shell, false);
  assert.equal(seen.options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.ok(!seen.args.join(" ").includes("secret"));
  assert.equal(JSON.parse(seen.input).apiKey, "secret");
});

test("skill entry loads a read-only catalog before any search or prompt", async (t) => {
  const h = host(t),
    calls = [];
  openSkillCatalogPanel(h.vscode, {
    command: "cc",
    cwd: "C:/workspace",
    runCliResult: async (options) => {
      calls.push(options);
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            id: "review",
            displayName: "<script>unsafe</script>",
            category: "code",
            hasHandler: true,
            handler: "must-not-execute.js",
          },
        ]),
      };
    },
  });
  await h.send({ type: "ready" });
  assert.deepEqual(
    calls.map((c) => c.args),
    [["skill", "list", "--json"]],
  );
  assert.equal(calls[0].cwd, "C:/workspace");
  const row = h.messages.find((m) => m.type === "catalog").rows[0];
  assert.equal(row.id, "review");
  assert.equal(row.handler, undefined);
  assert.doesNotMatch(h.panel.webview.html, /unsafe/);
  await h.send({ type: "run", command: "arbitrary" });
  assert.equal(calls.length, 1);
  await h.send({ type: "search", query: "" });
  assert.equal(calls.length, 1);
});

test("skill catalog rejects malformed or oversized output", () => {
  assert.throws(() => parseSkillCatalog('{"id":"x"}'), /格式/);
  assert.throws(() => parseSkillCatalog('[{"id":""}]'), /无效/);
  assert.throws(
    () => parseSkillCatalog("x".repeat(8 * 1024 * 1024 + 1)),
    /大小/,
  );
  assert.deepEqual(parseSkillCatalog("[]"), []);
});

test("workbench never reports refreshed success after a failed post-review read", async (t) => {
  const h = host(t);
  let reviewed = false;
  const pilot = {
    start: async () => ({
      evolutionWorkbench: { available: true, methods: ["list", "review"] },
    }),
    evolutionWorkbenchList: async () => {
      if (reviewed) throw new Error("offline");
      return projection();
    },
    evolutionWorkbenchReview: async () => {
      reviewed = true;
      return {};
    },
  };
  openEvolutionWorkbenchPanel(h.vscode, { getPilot: async () => pilot });
  await h.send({ type: "ready" });
  await h.send({
    type: "approve",
    projectionDigest: d("a"),
    packetDigest: d("b"),
    reason: "reviewed",
  });
  assert.equal(reviewed, true);
  assert.match(
    h.messages.filter((m) => m.type === "notice").at(-1).text,
    /勿重复提交/,
  );
  assert.ok(
    !h.messages.some((m) => m.type === "notice" && m.kind === "success"),
  );
});
