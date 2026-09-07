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
  const snapshot = h.messages.find((m) => m.type === "snapshot");
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
    h.messages.find((m) => m.type === "snapshot").mode,
    "unavailable",
  );
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
  const api = {
    PROVIDER_PRESETS,
    getConfiguredProvider: async () => "openai",
    getConfiguredModel: async () => "model",
    getConfiguredBaseUrl: async () => "https://relay.example/v1",
    getConfiguredVisionModel: async () => null,
    hasConfiguredApiKey: async () => true,
    applyLlmConnection: async (input) => {
      calls.push(input);
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
