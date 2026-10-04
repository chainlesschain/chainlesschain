"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { afterEach, test } = require("node:test");
const {
  buildChatHtml,
  CHAT_UI_PROTOCOL_VERSION,
  TRANSCRIPT_ENTRY_MAX_CHARS,
  migrateBootstrapLastSent,
  appendBoundedTranscriptText,
  formatTranscriptAnnouncement,
  trimOldestLogNodes,
} = require("../src/chat/chat-html");
const { ChatViewProvider } = require("../src/chat/chat-view");
const { ConversationManager } = require("../src/chat/conversation-manager");
const {
  HOST_DOM_COMMAND,
  HOST_DOM_DRIVER_COMMAND,
  hostDomTokensEqual,
  normalizeHostDomToken,
  validateHostDomRequest,
} = require("../src/chat/host-dom-relay");
const {
  runDomRelayJourney,
  WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
} = require("./extension-host/driver/dom-relay-journey.cjs");

const TOKEN = "ab".repeat(32);
const temporaryRoots = [];

test("recovery evidence rejects missing restart proof, duplicate rows, foreground completion and replayed drafts", () => {
  const {
    assertConversationRecoveryArtifacts,
  } = require("./extension-host/driver/conversation-recovery.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-recovery-evidence-"));
  temporaryRoots.push(root);
  const at = "2026-09-27T00:00:01.000Z";
  const initial = {
    schema: "cc-ide-conversation-recovery/v3",
    phase: "initial",
    backgroundAt: "2026-09-27T00:00:00.000Z",
    backgroundCompletedAt: at,
    foregroundReturnAt: "2026-09-27T00:00:02.000Z",
    a: {
      draft: "unsent draft A",
      savedRows: [0, 1, 2, 3].map((n) => ({ id: `session-a:hash-${n}:0` })),
    },
    b: {
      draft: "unsent draft B",
      savedRows: [0, 1].map((n) => ({ id: `session-b:hash-${n}:0` })),
    },
  };
  const imageSnapshot = (key, count = 1) => ({
    inputText: initial[key].draft,
    attachmentChips: Array.from({ length: count }, (_, i) => `image ${i + 1}`),
    draftStatus: "Draft saved on this device",
    attachments: Array.from({ length: count }, () => ({
      sha256: (key === "a" ? "ab" : "cd").repeat(32),
      mime: key === "a" ? "image/png" : "image/gif",
      bytes: 64,
      naturalWidth: 1,
      naturalHeight: 1,
      decodeSource: "isolated-image-decoder",
      decodedFrames: 1,
      previewWidth: 40,
      previewHeight: 40,
      loaded: true,
    })),
  });
  initial.images = {
    a: imageSnapshot("a"),
    b: imageSnapshot("b"),
    tabSwitch: { a: imageSnapshot("a"), b: imageSnapshot("b") },
    rejected: [
      {
        fixture: "unsupported",
        feedbackText: "Use PNG, JPEG, GIF or WebP images.",
        ...imageSnapshot("a"),
      },
      {
        fixture: "oversized",
        feedbackText: "Images must total at most 20 MiB per message.",
        ...imageSnapshot("a"),
      },
      {
        fixture: "malformed",
        ...imageSnapshot("a", 2),
        feedbackText: "Unsupported or malformed image header",
        draftStatus:
          "Draft could not be saved: Unsupported or malformed image header",
      },
      {
        fixture: "count-limit",
        feedbackText: "Attach at most 4 images per message.",
        ...imageSnapshot("a", 4),
      },
    ],
  };
  const restart = {
    schema: initial.schema,
    phase: "restart",
    historyIdsPreserved: true,
    composerDraftsPreserved: true,
    automaticInputReplay: false,
    images: { a: imageSnapshot("a"), b: imageSnapshot("b") },
  };
  const records = [
    { direction: "canonical", sessionId: "session-a", at },
    ...["A", "B", "A"].map((letter) => ({
      direction: "in",
      event: { type: "user", text: `journey:history-${letter}` },
    })),
  ];
  const write = () => {
    fs.writeFileSync(
      path.join(root, "conversation-recovery-initial.json"),
      JSON.stringify(initial),
    );
    fs.writeFileSync(
      path.join(root, "conversation-recovery-restart.json"),
      JSON.stringify(restart),
    );
  };
  assert.throws(
    () => assertConversationRecoveryArtifacts(root, records),
    /ENOENT/,
  );
  write();
  assert.doesNotThrow(() => assertConversationRecoveryArtifacts(root, records));
  // Keep archived v2 receipts readable; only new v3 producers promise the
  // isolated codec/thumbnail evidence rather than DOM-image decoding.
  for (const [phase, evidence] of [
    ["initial", initial],
    ["restart", restart],
  ]) {
    const legacy = JSON.parse(
      JSON.stringify(evidence, (key, value) =>
        [
          "decodeSource",
          "decodedFrames",
          "previewWidth",
          "previewHeight",
        ].includes(key)
          ? undefined
          : value,
      ),
    );
    legacy.schema = "cc-ide-conversation-recovery/v2";
    fs.writeFileSync(
      path.join(root, `conversation-recovery-${phase}.json`),
      JSON.stringify(legacy),
    );
  }
  assert.doesNotThrow(() => assertConversationRecoveryArtifacts(root, records));
  delete restart.images.a.attachments[0].decodeSource;
  write();
  assert.throws(() => assertConversationRecoveryArtifacts(root, records));
  restart.images.a = imageSnapshot("a");
  restart.images.a.attachmentChips = [];
  write();
  assert.throws(() => assertConversationRecoveryArtifacts(root, records));
  restart.images.a = imageSnapshot("a");
  restart.images.a.attachments[0].sha256 = "ef".repeat(32);
  write();
  assert.throws(() => assertConversationRecoveryArtifacts(root, records));
  restart.images.a = imageSnapshot("a");
  restart.images.a.attachments[0].loaded = false;
  write();
  assert.throws(() => assertConversationRecoveryArtifacts(root, records));
  restart.images.a = imageSnapshot("a");
  initial.images.rejected[0].feedbackText = "";
  write();
  assert.throws(() => assertConversationRecoveryArtifacts(root, records));
  initial.images.rejected[0].feedbackText =
    "Use PNG, JPEG, GIF or WebP images.";
  initial.foregroundReturnAt = initial.backgroundAt;
  write();
  assert.throws(() => assertConversationRecoveryArtifacts(root, records));
  initial.foregroundReturnAt = "2026-09-27T00:00:02.000Z";
  initial.b.savedRows[0].id = initial.a.savedRows[0].id;
  write();
  assert.throws(() => assertConversationRecoveryArtifacts(root, records));
  initial.b.savedRows[0].id = "session-b:hash-0:0";
  write();
  assert.throws(() =>
    assertConversationRecoveryArtifacts(root, [
      ...records,
      { direction: "in", event: { type: "user", text: "unsent draft A" } },
    ]),
  );
  assert.throws(() =>
    assertConversationRecoveryArtifacts(root, [
      ...records,
      {
        direction: "in",
        event: { type: "user", text: "", images: ["image.png"] },
      },
    ]),
  );
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("host DOM relay is token-gated and only accepts fixed semantic actions", () => {
  assert.equal(HOST_DOM_COMMAND, "chainlesschain.internal.hostDomCommand");
  assert.equal(HOST_DOM_DRIVER_COMMAND, "chainlesschainTests.runHostJourney");
  assert.equal(normalizeHostDomToken(TOKEN), TOKEN);
  assert.equal(normalizeHostDomToken("short"), null);
  assert.equal(hostDomTokensEqual(TOKEN, TOKEN), true);
  assert.equal(hostDomTokensEqual(TOKEN, "cd".repeat(32)), false);
  assert.deepEqual(
    validateHostDomRequest({ action: "streamProfile", chars: 100_000 }),
    { action: "streamProfile", chars: 100_000 },
  );
  assert.throws(() =>
    validateHostDomRequest({ action: "streamProfile", chars: 200_001 }),
  );
  assert.deepEqual(validateHostDomRequest({ action: "snapshot" }), {
    action: "snapshot",
  });
  assert.deepEqual(
    validateHostDomRequest({ action: "click", target: "planApprove" }),
    { action: "click", target: "planApprove" },
  );
  assert.throws(
    () =>
      validateHostDomRequest({ action: "evaluate", code: "process.exit()" }),
    /unsupported host DOM action/u,
  );
  assert.throws(
    () => validateHostDomRequest({ action: "click", target: "#arbitrary" }),
    /unsupported host DOM click target/u,
  );
  assert.deepEqual(
    validateHostDomRequest({
      action: "editDraft",
      text: "中文😀",
      code: "ignored",
    }),
    { action: "editDraft", text: "中文😀" },
  );
  assert.deepEqual(
    validateHostDomRequest({ action: "switchTab", id: "conv-2" }),
    { action: "switchTab", id: "conv-2" },
  );
  assert.deepEqual(
    validateHostDomRequest({ action: "click", target: "newTab" }),
    { action: "click", target: "newTab" },
  );
  for (const text of [null, {}, "x".repeat(513)]) {
    assert.throws(
      () => validateHostDomRequest({ action: "editDraft", text }),
      /at most 512/,
    );
  }
  for (const id of [null, "", "x".repeat(129), 'conv-1"]', "conv-1\n"]) {
    assert.throws(
      () => validateHostDomRequest({ action: "switchTab", id }),
      /tab ID/,
    );
  }
  for (const fixture of [
    "png",
    "gif",
    "unsupported",
    "malformed",
    "oversized",
  ]) {
    for (const via of ["paste", "drop"]) {
      assert.deepEqual(
        validateHostDomRequest({
          action: "attachImage",
          fixture,
          via,
          data: "untrusted",
          path: "C:/secret",
        }),
        { action: "attachImage", fixture, via },
      );
    }
  }
  for (const fixture of [
    "__proto__",
    "constructor",
    "file:///secret",
    {},
    null,
  ]) {
    assert.throws(
      () =>
        validateHostDomRequest({
          action: "attachImage",
          fixture,
          via: "paste",
        }),
      /image fixture/,
    );
  }
  assert.throws(
    () =>
      validateHostDomRequest({
        action: "attachImage",
        fixture: "png",
        via: "evaluate",
      }),
    /image fixture/,
  );
  for (const index of [-1, 4, 1.5, "0", null]) {
    assert.throws(
      () => validateHostDomRequest({ action: "removeAttachment", index }),
      /attachment index/,
    );
  }
  assert.deepEqual(
    validateHostDomRequest({ action: "removeAttachment", index: 3 }),
    { action: "removeAttachment", index: 3 },
  );
});

test("streaming evidence rejects forged timing summaries and missing selection/parse proof", () => {
  const {
    verifyStreamingProfile,
  } = require("./extension-host/driver/streaming-profile.cjs");
  const value = {
    schema: "cc-ide-streaming-profile/v2",
    chars: 100_000,
    samples: 64,
    frameSamples: 63,
    frameIntervalsMs: Array(63).fill(16),
    updateDurationsMs: Array(64).fill(1),
    frameP95Ms: 16,
    updateP95Ms: 1,
    longestUpdateMs: 1,
    finalizationMs: 10,
    finalizationStagesMs: {
      markdown: 1,
      decorate: 2,
      follow: 3,
      residualIncludingDomAndOverhead: 4,
    },
    elapsedMs: 1_100,
    longTasksSupported: true,
    longestTaskMs: 0,
    streamingParseCalls: 0,
    parseCalls: 1,
    parseChars: 100_000,
    selectionStable: true,
    deferredWhileSelected: true,
    finalizationIdempotent: true,
    textMutations: 64,
    codeControls: 2,
    performanceGate: false,
  };
  assert.doesNotThrow(() => verifyStreamingProfile(value));
  for (const patch of [
    { schema: "cc-ide-streaming-profile/v1" },
    { frameP95Ms: 1 },
    { updateDurationsMs: [] },
    { longestTaskMs: null },
    { streamingParseCalls: 2 },
    { parseChars: 1 },
    { selectionStable: false },
    { performanceGate: true },
    { updateDurationsMs: Array(64).fill(Infinity) },
    { finalizationStagesMs: undefined },
    { finalizationStagesMs: {} },
    { finalizationStagesMs: { ...value.finalizationStagesMs, markdown: -1 } },
    { finalizationStagesMs: { ...value.finalizationStagesMs, decorate: NaN } },
    {
      finalizationStagesMs: { ...value.finalizationStagesMs, follow: Infinity },
    },
    { finalizationStagesMs: { ...value.finalizationStagesMs, markdown: 9 } },
    {
      finalizationStagesMs: {
        ...value.finalizationStagesMs,
        residualIncludingDomAndOverhead: null,
      },
    },
    { finalizationStagesMs: { ...value.finalizationStagesMs, pureDom: 0 } },
  ])
    assert.throws(() => verifyStreamingProfile({ ...value, ...patch }));
});

test("streaming stage timings exclude stream frames and retain DOM/selection overhead", async () => {
  const { measureStreamingProfile } = require("../src/chat/streaming-profile");
  let now = 0;
  let finishPending;
  let followCalls = 0;
  const selection = {
    isCollapsed: true,
    addRange() {
      this.isCollapsed = false;
    },
    removeAllRanges() {
      this.isCollapsed = true;
      now += 2;
    },
    toString: () => "selected",
  };
  const element = {
    firstChild: {},
    querySelectorAll: () => [1, 2],
    remove() {},
  };
  // A virtual clock verifies attribution, not browser performance. The real
  // host journey remains responsible for layout/long-task measurements.
  const measure = vm.runInNewContext(
    "(" + measureStreamingProfile.toString() + ")",
    {
      performance: { now: () => now },
      requestAnimationFrame(callback) {
        now += 16;
        callback(now);
      },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      Event: class {},
    },
  );
  const result = await measure({
    document: {
      createElement: () => element,
      getSelection: () => selection,
      createRange: () => ({ setStart() {}, setEnd() {} }),
      dispatchEvent: () => finishPending(),
    },
    log: { appendChild() {} },
    chars: 10_000,
    createRenderer({ renderMarkdown, decorate, follow }) {
      let formatted = false;
      const renderer = {
        update() {
          follow();
        },
        finish(target, text) {
          if (formatted) return;
          if (!selection.isCollapsed) {
            finishPending = () => renderer.finish(target, text);
            return;
          }
          renderMarkdown(text);
          now += 11; // DOM assignment and renderer bookkeeping.
          decorate(target);
          formatted = true;
          follow();
        },
        dispose() {},
      };
      return renderer;
    },
    renderMarkdown() {
      now += 3;
      return "rendered";
    },
    decorate() {
      now += 5;
    },
    follow() {
      followCalls++;
      now += 7;
    },
  });
  assert.equal(result.schema, "cc-ide-streaming-profile/v2");
  assert.equal(result.finalizationMs, 28);
  assert.deepEqual(JSON.parse(JSON.stringify(result.finalizationStagesMs)), {
    markdown: 3,
    decorate: 5,
    follow: 7,
    residualIncludingDomAndOverhead: 13,
  });
  assert.equal(followCalls, 65);
  assert.equal(result.streamingParseCalls, 0);
  assert.equal(result.parseCalls, 1);
  assert.equal(result.deferredWhileSelected, true);
  assert.equal(result.finalizationIdempotent, true);
});

test("chat HTML keeps the relay inert without a valid launch token", () => {
  const base = { cspSource: "vscode-webview:", nonce: "nonce", l10n: {} };
  const normal = buildChatHtml(base);
  const enabled = buildChatHtml({ ...base, hostDomToken: TOKEN });
  const rejected = buildChatHtml({
    ...base,
    hostDomToken: '";globalThis.compromised=true;//',
  });

  assert.match(normal, /const CC_HOST_DOM_TOKEN = "";/u);
  assert.match(
    enabled,
    new RegExp(`const CC_HOST_DOM_TOKEN = "${TOKEN}";`, "u"),
  );
  assert.match(enabled, /m\.kind === "hostDomCommand"/u);
  assert.doesNotMatch(enabled, /\beval\s*\(/u);
  assert.doesNotMatch(rejected, /globalThis\.compromised/u);
  const scripts = [...enabled.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)];
  assert.ok(scripts.length > 0, "generated chat HTML contains no scripts");
  for (const [, source] of scripts) {
    assert.doesNotThrow(() => new vm.Script(source));
  }
});

test("image DOM actions require the exact token and request identity before dispatch", () => {
  const html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "nonce",
    l10n: {},
    hostDomToken: TOKEN,
  });
  const start = html.indexOf('window.addEventListener("message", (e) => {');
  const end = html.indexOf(
    "    // The Extension Host may have restarted",
    start,
  );
  assert.ok(start >= 0 && end > start);
  let receive;
  const events = [];
  const responses = [];
  let removals = 0;
  class Transfer {
    constructor() {
      this.files = [];
      this.items = { add: (file) => this.files.push(file) };
    }
  }
  class ImageEvent {
    constructor(type, options) {
      this.type = type;
      Object.assign(this, options);
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  }
  vm.runInNewContext(html.slice(start, end) + "});", {
    window: {
      addEventListener: (_type, listener) => {
        receive = listener;
      },
    },
    CC_HOST_DOM_TOKEN: TOKEN,
    questionForms: { receive: () => false },
    vscode: { postMessage: (message) => responses.push(message) },
    input: {
      dispatchEvent: (event) => {
        events.push(event);
        event.preventDefault();
      },
    },
    attach: {
      querySelectorAll: () => [
        {
          click: () => {
            removals++;
          },
        },
      ],
    },
    DataTransfer: Transfer,
    ClipboardEvent: ImageEvent,
    DragEvent: ImageEvent,
    File: class {
      constructor(parts, name, options) {
        this.parts = parts;
        this.name = name;
        this.type = options.type;
      }
    },
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    Uint8Array,
  });
  const request = (token, requestId, command) =>
    receive({ data: { kind: "hostDomCommand", token, requestId, command } });
  const id = "ab".repeat(16);
  for (const command of [
    { action: "attachImage", fixture: "png", via: "paste" },
    { action: "removeAttachment", index: 0 },
  ]) {
    for (const token of [undefined, "", "cd".repeat(32)])
      request(token, id, command);
    request(TOKEN, "invalid", command);
  }
  assert.equal(events.length, 0);
  assert.equal(removals, 0);
  assert.equal(responses.length, 0);
  for (const [fixture, via] of [
    ["png", "paste"],
    ["gif", "drop"],
  ]) {
    request(TOKEN, id, { action: "attachImage", fixture, via });
    assert.equal(responses.at(-1).ok, true);
    assert.equal(events.at(-1).type, via);
    const transfer = events.at(-1).clipboardData || events.at(-1).dataTransfer;
    const file = transfer.files[0];
    assert.equal(
      require("../src/chat/image-attachments").imageDimensions(
        Buffer.from(file.parts[0]),
      ).format,
      fixture,
    );
  }
  request(TOKEN, id, {
    action: "attachImage",
    fixture: "__proto__",
    via: "paste",
  });
  assert.equal(responses.at(-1).ok, false);
  assert.equal(events.length, 2);
  request(TOKEN, id, { action: "removeAttachment", index: 0 });
  assert.equal(removals, 1);
  assert.equal(responses.at(-1).ok, true);
});

test("finishing an image read immediately replaces the stale saved indication with saving", () => {
  const html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "nonce",
    l10n: {},
  });
  const start = html.indexOf("  function addImageBlob(blob) {");
  const end = html.indexOf('  input.addEventListener("paste"', start);
  const draft = { images: [], reads: 0, readingBytes: 0, dirty: false };
  const statuses = [];
  let reader;
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    saveComposer() {},
    tabKey: () => "a",
    composerDraft: () => draft,
    composerDrafts: { a: draft },
    renderAttach() {},
    queueDraft: () => {
      draft.dirty = true;
    },
    renderDraftPanel: () => statuses.push(draft.dirty ? "saving" : "saved"),
    FileReader: class {
      constructor() {
        reader = this;
      }
      readAsDataURL() {}
    },
  });
  vm.runInContext(
    html.slice(start, end) + '\naddImageBlob({type: "image/png", size: 64});',
    context,
  );
  assert.equal(draft.reads, 1);
  reader.result = "data:image/png;base64,cG5n";
  reader.onload();
  assert.equal(draft.images.length, 1);
  assert.equal(draft.reads, 0);
  assert.deepEqual(statuses, ["saving"]);
  assert.equal(draft.imagesVerified, false);
});

test("text-only or stale image ACKs cannot authorize unvalidated image previews", () => {
  const html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "nonce",
    l10n: {},
  });
  const start = html.indexOf('        if (m.kind === "draftSaved") {');
  const end = html.indexOf(' else if (m.kind === "draftSnapshot"', start);
  assert.ok(start >= 0 && end > start);
  const draft = {
    revision: 4,
    imageRevision: 3,
    images: [{}],
    dirty: true,
    saveError: "bad image",
  };
  let previews = 0;
  const context = vm.createContext({
    draft,
    active: true,
    renderAttach: () => {
      previews++;
    },
  });
  const receive = (m) => {
    context.m = m;
    vm.runInContext(html.slice(start, end), context);
  };
  receive({ kind: "draftSaved", revision: 4, imagesChanged: false });
  assert.equal(draft.imagesVerified, undefined);
  assert.equal(draft.dirty, true);
  assert.equal(draft.saveError, "bad image");
  receive({ kind: "draftSaved", revision: 2, imagesChanged: true });
  assert.equal(previews, 0);
  receive({ kind: "draftSaved", revision: 3, imagesChanged: true });
  assert.equal(draft.imagesVerified, true);
  assert.equal(previews, 1);
  assert.equal(draft.dirty, true);
  receive({ kind: "draftSaved", revision: 4, imagesChanged: false });
  assert.equal(draft.dirty, false);
  assert.equal(draft.saveError, "");
});

test("attachment evidence hashes rendered bytes without exporting sources or hiding decode failures", async () => {
  const {
    snapshotHostImageAttachments,
  } = require("../src/chat/host-dom-image-fixtures");
  const crypto = require("node:crypto");
  const data = Buffer.from("fixed image bytes");
  const image = {
    __ccImagePreviewEvidence: {
      data: `data:image/png;base64,${data.toString("base64")}`,
      result: { decodedWidth: 1, decodedHeight: 1, frames: 2 },
    },
    width: 40,
    height: 40,
    __ccPreviewDrawn: true,
  };
  const collect = vm.runInNewContext(
    "(" + snapshotHostImageAttachments.toString() + ")",
    {
      crypto: crypto.webcrypto,
      Uint8Array,
      atob: (value) => Buffer.from(value, "base64").toString("binary"),
    },
  );
  const attach = { querySelectorAll: () => [image] };
  const [evidence] = await collect(attach);
  assert.equal(
    evidence.sha256,
    crypto.createHash("sha256").update(data).digest("hex"),
  );
  assert.equal(evidence.loaded, true);
  assert.equal(evidence.decodeSource, "isolated-image-decoder");
  assert.equal(evidence.decodedFrames, 2);
  assert.equal(evidence.previewWidth, 40);
  assert.equal(evidence.bytes, data.length);
  assert.equal(Object.hasOwn(evidence, "src"), false);
  assert.ok(!JSON.stringify(evidence).includes(data.toString("base64")));
  image.__ccImagePreviewEvidence.result.decodedWidth = 0;
  assert.equal((await collect(attach))[0].loaded, false);
  image.__ccImagePreviewEvidence.data = "https://example.com/image.png";
  await assert.rejects(collect(attach), /Invalid rendered image source/);
});

test("chat composer gives the input and controls separate responsive rows", () => {
  const html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "nonce",
    l10n: {},
  });

  assert.match(html, /#bar \{ display:flex; flex-direction:column;/u);
  assert.match(html, /#input \{ box-sizing:border-box; width:100%;/u);
  assert.match(
    html,
    /#composer-actions \{ display:flex; gap:4px; flex-wrap:wrap; margin-top:8px;/u,
  );
  assert.match(
    html,
    /<textarea id="input"[\s\S]*?<\/textarea>\s*<div id="composer-actions" role="group" aria-label="Chat controls">[\s\S]*?<button id="send">Send<\/button>[\s\S]*?<button id="plan-toggle"[\s\S]*?<button id="stop"[\s\S]*?<button id="new"[\s\S]*?<\/div>\s*<\/div>/u,
  );
});

test("chat HTML accepts agent activity before routing every known event", () => {
  const html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "nonce",
    l10n: {},
  });
  const listener = html.indexOf('window.addEventListener("message"');
  const routing = html.indexOf("switch (m.kind)", listener);
  const signal = html.lastIndexOf("acceptAgentSignal();", routing);

  assert.ok(listener >= 0, "message listener is missing");
  assert.ok(routing > listener, "agent event switch is missing");
  assert.ok(
    signal > listener && signal < routing,
    "known agent events must clear the send timeout before routing",
  );
});

test("conversation manager retains and resolves multiple interactive cards", () => {
  const conversations = new ConversationManager();
  const foreground = conversations.create();
  const background = conversations.create({ activate: false });
  conversations.setPendingApproval(background.id, {
    kind: "approval",
    id: "approval-1",
  });
  conversations.setPendingApproval(background.id, {
    kind: "question",
    id: "question-1",
  });
  conversations.markNeedsApproval(background.id);

  assert.deepEqual(
    conversations.pendingInteractions(background.id).map(({ kind, id }) => ({
      kind,
      id,
    })),
    [
      { kind: "approval", id: "approval-1" },
      { kind: "question", id: "question-1" },
    ],
  );
  conversations.clearApproval(background.id, "approval-1");
  assert.equal(
    conversations.get(background.id).pendingApproval.id,
    "question-1",
  );
  assert.equal(conversations.get(background.id).needsApproval, true);

  conversations.switchTo(background.id);
  assert.equal(conversations.get(background.id).needsApproval, false);
  assert.equal(conversations.get(foreground.id).needsApproval, false);
  conversations.clearApproval(background.id, "question-1");
  assert.deepEqual(conversations.pendingInteractions(background.id), []);
});

test("ChatViewProvider rehydrates questions and preserves approval bindings", async () => {
  const posted = [];
  const sent = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: {},
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:\\workspace" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const provider = new ChatViewProvider(vscode, {});
  provider.view = {
    webview: {
      postMessage(message) {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
  };
  provider._handleMessage({ type: "ready" });
  const conversation = provider._convs.active();
  provider.session = {
    sendEvent(event) {
      sent.push(event);
      return true;
    },
  };
  const onEvent = provider._makeOnEvent(conversation.id);
  onEvent({
    type: "question_request",
    id: "question-reload",
    question: "Continue?",
  });

  posted.length = 0;
  provider._handleMessage({ type: "ready" });
  assert.deepEqual(
    posted
      .filter((message) => message.kind === "question")
      .map((message) => message.id),
    ["question-reload"],
  );

  onEvent({
    type: "approval_request",
    id: "approval-bound",
    tool: "run_shell",
    binding: "sha256:exact-call",
    requested_permissions: [
      { capability: "tool:run_shell", scope: "npm test" },
    ],
  });
  const approvalCard = posted.find(
    (message) => message.kind === "approval" && message.id === "approval-bound",
  );
  assert.equal(approvalCard.hasScopedPermissions, true);
  assert.equal(Object.hasOwn(approvalCard, "permissions"), false);
  provider._handleMessage({
    type: "approval",
    id: "approval-bound",
    approve: true,
    decisionKind: "acceptForSession",
    binding: "sha256:exact-call",
  });
  assert.deepEqual(sent.at(-1), {
    type: "approval",
    id: "approval-bound",
    decision: { kind: "acceptOnce" },
    approve: true,
    binding: "sha256:exact-call",
  });

  vscode.window.showQuickPick = async (choices) =>
    choices.find((choice) => choice.decisionKind === "acceptForSession");
  onEvent({
    type: "approval_request",
    id: "approval-scoped",
    tool: "run_shell",
    binding: "sha256:scoped-call",
    requested_permissions: [
      { capability: "tool:run_shell", scope: "npm test" },
    ],
  });
  await provider._showApprovalOptions({
    id: "approval-scoped",
    binding: "sha256:scoped-call",
  });
  assert.deepEqual(sent.at(-1), {
    type: "approval",
    id: "approval-scoped",
    decision: {
      kind: "acceptForSession",
      permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
    },
    approve: true,
    binding: "sha256:scoped-call",
  });

  onEvent({ type: "question_resolved", id: "question-reload", via: "timeout" });
  posted.length = 0;
  provider._handleMessage({ type: "ready" });
  assert.equal(
    posted.some((message) => message.kind === "question"),
    false,
  );
});

test("VS Code settles approvals against the shared HumanTask conformance fixture", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "agent-protocol",
        "test",
        "fixtures",
        "human-task-settlement-conformance.json",
      ),
      "utf8",
    ),
  );

  for (const scenario of fixture.scenarios.filter(({ surfaces }) =>
    surfaces.includes("vscode"),
  )) {
    const posted = [];
    const sent = [];
    const warnings = [];
    const vscode = {
      commands: { executeCommand() {} },
      window: {
        showWarningMessage(message) {
          warnings.push(message);
        },
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "C:\\workspace" } }],
        getConfiguration: () => ({ get: () => undefined }),
      },
    };
    const provider = new ChatViewProvider(vscode, {});
    provider.view = {
      webview: {
        postMessage(message) {
          posted.push(message);
          return Promise.resolve(true);
        },
      },
    };
    provider._handleMessage({ type: "ready" });
    const conversation = provider._convs.active();
    const attachSession = () => {
      let running = true;
      provider._convs.setSession(conversation.id, {
        get running() {
          return running;
        },
        sendEvent(event) {
          if (!running) return false;
          sent.push(event);
          return true;
        },
        stop() {
          running = false;
        },
      });
      conversation.turnActive = true;
    };
    attachSession();

    const onEvent = provider._makeOnEvent(conversation.id);
    const requestId = `approval-${scenario.name}`;
    const binding = `ab_${scenario.name}`;
    onEvent({
      type: "approval_request",
      id: requestId,
      tool: "run_shell",
      binding,
      requested_permissions: [
        {
          capability: "tool:run_shell",
          scope: `exact:${scenario.name}`,
        },
      ],
    });
    let rejectedResponses = 0;
    let unresolvedDecision = null;
    const resolveDecision = () => {
      if (!unresolvedDecision) return;
      onEvent({
        type: "approval_resolved",
        id: requestId,
        approved: unresolvedDecision === "approve",
        decision: {
          kind: unresolvedDecision === "approve" ? "acceptOnce" : "decline",
        },
        via: "fixture-authority",
      });
      unresolvedDecision = null;
    };

    for (const step of scenario.steps) {
      if (step.action === "restart") {
        resolveDecision();
        provider._stopSession(conversation);
        attachSession();
        assert.equal(step.expect.vscode, "settled", scenario.name);
        continue;
      }
      if (step.action === "cancel") {
        assert.equal(
          provider._interruptConversation(conversation),
          true,
          scenario.name,
        );
        assert.equal(step.expect.vscode, "settled", scenario.name);
        continue;
      }
      assert.ok(
        step.action === "approve" || step.action === "decline",
        `${scenario.name}: unsupported VS Code action ${step.action}`,
      );
      const accepted = provider._sendApprovalDecision(
        {
          id: requestId,
          binding,
          decisionKind: step.action === "approve" ? "acceptOnce" : "decline",
          approve: step.action === "approve",
        },
        conversation,
      );
      if (step.expect.vscode === "settled") {
        assert.equal(accepted, true, scenario.name);
        unresolvedDecision = step.action;
      } else {
        assert.equal(accepted, false, scenario.name);
        rejectedResponses += 1;
      }
    }
    resolveDecision();

    const expected = scenario.expected.vscode;
    assert.equal(
      provider._convs
        .pendingInteractions(conversation.id)
        .filter(({ kind }) => kind === "approval").length,
      expected.pending_approvals,
      scenario.name,
    );
    assert.equal(
      sent.filter(({ type }) => type === "approval").length,
      expected.sent_decisions,
      scenario.name,
    );
    assert.equal(
      sent.filter(({ type }) => type === "interrupt").length,
      expected.interrupts,
      scenario.name,
    );
    assert.equal(rejectedResponses, expected.rejected_responses, scenario.name);
    assert.equal(warnings.length, rejectedResponses, scenario.name);
  }
});

test("VS Code rolls back a local approval reservation when transport rejects it", () => {
  const warnings = [];
  const posted = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: { showWarningMessage: (message) => warnings.push(message) },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:\\workspace" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const provider = new ChatViewProvider(vscode, {});
  provider.view = {
    webview: {
      postMessage(message) {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
  };
  const conversation = provider._activeConv();
  let acceptTransport = false;
  provider._convs.setSession(conversation.id, {
    running: true,
    sendEvent: () => acceptTransport,
  });
  provider._makeOnEvent(conversation.id)({
    type: "approval_request",
    id: "approval-rollback",
    tool: "run_shell",
    binding: "ab_rollback",
  });

  assert.equal(
    provider._sendApprovalDecision(
      { id: "approval-rollback", binding: "ab_rollback", approve: true },
      conversation,
    ),
    false,
  );
  assert.equal(
    provider._convs.pendingInteractions(conversation.id)[0].settlementStatus,
    "pending",
  );
  acceptTransport = true;
  assert.equal(
    provider._sendApprovalDecision(
      { id: "approval-rollback", binding: "ab_rollback", approve: true },
      conversation,
    ),
    true,
  );
  assert.equal(warnings.length, 1);
  assert.equal(
    posted.some(
      (message) =>
        message.kind === "approval_retry" && message.id === "approval-rollback",
    ),
    true,
  );
});

test("chat HTML exposes keyboard and screen-reader semantics", () => {
  const html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "nonce",
    l10n: {},
  });

  assert.match(html, /id="log" role="region"/u);
  assert.doesNotMatch(html, /id="log"[^>]*aria-live/u);
  assert.match(
    html,
    /id="announcer" class="sr-only" role="status" aria-live="polite"/u,
  );
  assert.match(html, /function announceTranscript\(kind, text, eventKey\)/u);
  assert.match(html, /seenAnnouncementKeys\.has\(key\)/u);
  assert.match(html, /announcementQueue\.length >= 32/u);
  assert.match(html, /heading\.textContent = "Turn " \+ state\.number/u);
  assert.match(
    html,
    /ensureAssistantHeading\(\);[\s\S]{0,160}const assistantAnnouncement/u,
  );
  assert.match(html, /"tool err": "Tool error"/u);
  assert.match(html, /aria-label="Conversation transcript"/u);
  assert.match(html, /id="tabs" role="tablist"/u);
  assert.match(html, /tab\.setAttribute\("role", "tab"\)/u);
  assert.match(html, /tab\.setAttribute\("aria-selected"/u);
  assert.match(html, /e\.key === "ArrowRight"/u);
  assert.match(html, /e\.key === "ArrowLeft"/u);
  assert.match(html, /e\.key === "Home"/u);
  assert.match(html, /e\.key === "End"/u);
  assert.match(html, /e\.key === "Delete"/u);
  assert.match(html, /data-tab-id/u);
  assert.match(html, /restoreTabFocus/u);
  assert.match(html, /id="suggest" role="listbox"/u);
  assert.match(html, /row\.setAttribute\("role", "option"\)/u);
  assert.match(html, /aria-autocomplete="list" aria-expanded="false"/u);
  assert.match(html, /input\.setAttribute\("aria-activedescendant"/u);
  assert.match(html, /id="status" aria-label="Agent status"/u);
  assert.match(html, /log\.setAttribute\("aria-busy", "true"\)/u);
  assert.match(html, /card\.setAttribute\("role", "group"\)/u);
  assert.match(html, /card\.setAttribute\("aria-labelledby", q\.id\)/u);
  assert.match(html, /scoped\.textContent = "Approval options…";/u);
  assert.match(html, /scoped\.hidden = m\.hasScopedPermissions !== true;/u);
  assert.match(html, /type: "approvalOptions"/u);
  assert.match(
    html,
    /yes\.disabled = scoped\.disabled = no\.disabled = true;/u,
  );
  assert.match(
    html,
    /control while the host settles[\s\S]{0,160}input\.focus\(\)/u,
  );
  assert.match(html, /case "approval_retry"[\s\S]{0,240}b\.disabled = false/u);
  assert.match(html, /:focus-visible \{ outline:2px solid/u);
});

test("transcript announcements are classified, whitespace-normalized, and bounded", () => {
  assert.equal(
    formatTranscriptAnnouncement("assistant", "  hello\n  world  ", 12),
    "Turn 12, Assistant response: hello world",
  );
  assert.equal(
    formatTranscriptAnnouncement("permission", "run shell", 3),
    "Turn 3, Permission request: run shell",
  );
  assert.equal(formatTranscriptAnnouncement("unknown", "ignored", 1), "");
  const bounded = formatTranscriptAnnouncement("error", "x".repeat(10_000), 7);
  assert.ok(bounded.length <= 4_000);
  assert.match(bounded, /^Turn 7, Tool error: /u);
  assert.match(bounded, /…$/u);
});

test("chat transcript retains only the newest 800 of 2,000 message nodes", () => {
  const children = Array.from({ length: 2_000 }, (_, id) => ({ id }));
  const container = {
    get childElementCount() {
      return children.length;
    },
    get firstChild() {
      return children[0] || null;
    },
    removeChild(node) {
      assert.equal(node, children[0]);
      return children.shift();
    },
  };

  assert.equal(trimOldestLogNodes(container, 800), 1_200);
  assert.equal(children.length, 800);
  assert.equal(children[0].id, 1_200);
  assert.equal(children.at(-1).id, 1_999);
});

test("64 MiB transcript entries retain bounded head and tail with a visible marker", () => {
  const mebibyte = "x".repeat(1024 * 1024);
  let state = appendBoundedTranscriptText(null, "HEAD");
  for (let index = 0; index < 64; index += 1) {
    state = appendBoundedTranscriptText(
      state,
      mebibyte,
      TRANSCRIPT_ENTRY_MAX_CHARS,
    );
  }
  state = appendBoundedTranscriptText(
    state,
    "TAIL",
    TRANSCRIPT_ENTRY_MAX_CHARS,
  );

  assert.equal(state.totalChars, 64 * 1024 * 1024 + 8);
  assert.equal(state.truncated, true);
  assert.ok(state.text.length <= TRANSCRIPT_ENTRY_MAX_CHARS);
  assert.match(state.text, /^HEAD/u);
  assert.match(
    state.text,
    /characters omitted from oversized transcript entry/u,
  );
  assert.match(state.text, /TAIL$/u);
});

test("first tab activation preserves a bootstrap prompt for retry", () => {
  const bootstrap = { _: "journey:stream" };
  assert.equal(migrateBootstrapLastSent(bootstrap, null, "tab-1"), true);
  assert.deepEqual(bootstrap, { "tab-1": "journey:stream" });

  const established = { _: "stale", "tab-1": "current" };
  assert.equal(migrateBootstrapLastSent(established, "tab-1", "tab-2"), false);
  assert.deepEqual(established, { _: "stale", "tab-1": "current" });

  const alreadyOwned = { _: "bootstrap", "tab-1": "newer" };
  assert.equal(migrateBootstrapLastSent(alreadyOwned, null, "tab-1"), true);
  assert.deepEqual(alreadyOwned, { "tab-1": "newer" });

  const empty = {};
  assert.equal(migrateBootstrapLastSent(empty, null, "tab-1"), false);
  assert.deepEqual(empty, {});

  const html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "nonce",
    l10n: {},
  });
  assert.match(
    html,
    /migrateBootstrapLastSent\(lastSentByTab, activeTabId, m\.activeId\)/u,
  );
});

test("ChatViewProvider correlates a token-authenticated DOM response", async () => {
  const vscode = { l10n: { t: (value) => value } };
  const provider = new ChatViewProvider(vscode, { hostDomToken: TOKEN });
  provider._webviewReady = true;
  provider._webviewProtocolConfirmed = true;
  provider.view = {
    webview: {
      postMessage(message) {
        queueMicrotask(() => {
          provider._handleMessage({
            type: "hostDomResult",
            token: TOKEN,
            requestId: message.requestId,
            ok: true,
            result: { text: "real DOM", inputPresent: true, sendEnabled: true },
          });
        });
        return Promise.resolve(true);
      },
    },
  };

  assert.deepEqual(await provider.runHostDomCommand({ action: "snapshot" }), {
    text: "real DOM",
    inputPresent: true,
    sendEnabled: true,
  });
});

test("ChatViewProvider reveals a suspended relay view once and reports readiness state", async () => {
  const vscode = { l10n: { t: (value) => value } };
  const provider = new ChatViewProvider(vscode, { hostDomToken: TOKEN });
  let revealCount = 0;
  provider.view = {
    visible: false,
    show(preserveFocus) {
      assert.equal(preserveFocus, false);
      revealCount += 1;
    },
  };

  await assert.rejects(
    provider.runHostDomCommand({ action: "snapshot" }),
    /view=true, visible=false, ready=false, protocol=false/u,
  );
  await assert.rejects(
    provider.runHostDomCommand({ action: "snapshot" }),
    /chat webview DOM is not ready/u,
  );
  assert.equal(revealCount, 1);
});

test("token-gated fresh Webviews do not self-reload during cold startup", () => {
  const vscode = { l10n: { t: (value) => value } };
  const provider = new ChatViewProvider(vscode, { hostDomToken: TOKEN });
  const posted = [];
  const view = {
    webview: {
      postMessage(message) {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
  };
  provider.view = view;
  provider._webviewProtocolGuard = true;

  provider._armWebviewProtocolCheck(view);

  assert.deepEqual(posted, [
    { kind: "protocolProbe", uiProtocolVersion: CHAT_UI_PROTOCOL_VERSION },
  ]);
  assert.equal(provider._webviewProtocolTimer, null);
});

test("DOM relay driver produces the same auditable phase ledger and snapshots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-dom-relay-"));
  temporaryRoots.push(root);
  const artifactDir = path.join(root, "artifacts");
  const traceFile = path.join(root, "trace", "cdp-journey.jsonl");
  const workspaceFolders = [
    path.join(root, "workspace-primary"),
    path.join(root, "workspace-secondary"),
  ];
  workspaceFolders.forEach((workspaceFolder) => fs.mkdirSync(workspaceFolder));
  const state = {
    text: "",
    planVisible: false,
    planApproveEnabled: false,
    approvalApproveEnabled: false,
    stopEnabled: true,
    workbenchStage: "ready",
  };
  let streamCount = 0;
  let dispatchCount = 0;
  let replyCount = 0;
  const commands = {
    async executeCommand(command, token, request) {
      assert.equal(command, HOST_DOM_COMMAND);
      assert.equal(token, TOKEN);
      if (request.surface === "sessions-workbench") {
        if (request.action === "snapshot") {
          const needsInput = state.workbenchStage === "needs_input";
          const completed = state.workbenchStage === "completed";
          return {
            text: completed
              ? "Workbench lifecycle fixture workbench-result.md PR #88 merged"
              : "Workbench lifecycle fixture",
            rowCount: 5,
            kinds: ["local", "background", "remote", "team", "workflow"],
            backgroundState: needsInput ? "needs_input" : "done",
            dispatchEnabled: !needsInput,
            replyEnabled: needsInput,
            artifactVisible: completed,
            prVisible: completed,
          };
        }
        if (request.action === "click" && request.target === "dispatch") {
          const sample = dispatchCount;
          assert.equal(
            request.text,
            sample < WORKBENCH_NEEDS_INPUT_WARMUP_COUNT
              ? "dispatch from VS Code Workbench warmup"
              : `dispatch from VS Code Workbench sample ${
                  sample - WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + 1
                }`,
          );
          dispatchCount += 1;
          state.workbenchStage = "needs_input";
          return { clicked: "dispatch" };
        }
        if (request.action === "click" && request.target === "reply") {
          const sample = replyCount;
          assert.equal(
            request.text,
            sample < WORKBENCH_NEEDS_INPUT_WARMUP_COUNT
              ? "beta-warmup"
              : `beta-${sample - WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + 1}`,
          );
          replyCount += 1;
          state.workbenchStage = "completed";
          return { clicked: "reply" };
        }
        throw new Error("unsupported Workbench relay request");
      }
      if (request.action === "snapshot") {
        return {
          readyState: "complete",
          url: "vscode-webview://chainlesschainIdeChat",
          text: state.text,
          inputPresent: true,
          sendEnabled: true,
          stopEnabled: state.stopEnabled,
          planVisible: state.planVisible,
          planApproveEnabled: state.planApproveEnabled,
          approvalApproveEnabled: state.approvalApproveEnabled,
        };
      }
      if (request.action === "send") {
        if (request.text === "journey:stream") {
          streamCount += 1;
          state.text += ` fixture stream complete #${streamCount}`;
        } else if (request.text === "/retry") {
          streamCount += 1;
          state.text += ` fixture stream complete #${streamCount}`;
        } else if (request.text === "journey:plan") {
          state.planVisible = state.planApproveEnabled = true;
        } else if (request.text === "journey:permission") {
          state.approvalApproveEnabled = true;
        } else if (request.text === "journey:stop") {
          state.text += " fixture stop waiting #5";
        } else if (request.text === "journey:resume") {
          state.text +=
            " resumed previous conversation fixture stream complete #6";
        }
        return { sent: true };
      }
      if (request.target === "planApprove") {
        state.text += " fixture plan approve #3";
        state.planApproveEnabled = false;
      } else if (request.target === "latestApprovalApprove") {
        state.text += " fixture permission approved #4";
        state.approvalApproveEnabled = false;
      } else if (request.target === "stop") {
        state.text += " interrupted";
      }
      return { clicked: request.target };
    },
  };

  for (const phase of ["initial", "restart"]) {
    await runDomRelayJourney({
      commands,
      token: TOKEN,
      phase,
      readyFile: path.join(root, `${phase}-ready.json`),
      resultFile: path.join(root, `${phase}-result.json`),
      traceFile,
      artifactDir,
      extensionPath: root,
      workspaceDir: workspaceFolders[0],
      workspaceFolders,
      // This mock covers the base journey. Optional installed-host journeys
      // have their own tests and must not be enabled by the CI launch flags.
      env: {},
    });
  }

  const trace = fs.readFileSync(traceFile, "utf8");
  const traceRecords = trace
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(
    dispatchCount,
    WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  );
  assert.equal(replyCount, dispatchCount);
  assert.equal(
    traceRecords.filter((record) => record.metric === "needs-input-visible")
      .length,
    WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  );
  assert.equal(
    traceRecords.find(
      (record) => record.metric === "needs-input-visible-summary",
    )?.samples,
    WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  );
  assert.match(trace, /"targetType":"vscode-webview-message-relay"/u);
  for (const step of [
    "stream",
    "retry",
    "plan-approval",
    "permission",
    "interrupt",
    "workbench-dispatch-needs-input",
    "workbench-reply-artifact",
    "ide-restart-resume",
    "workbench-restart-recovery",
  ]) {
    assert.match(trace, new RegExp(`"step":"${step}","status":"passed"`, "u"));
  }
  assert.match(
    fs.readFileSync(path.join(artifactDir, "initial-dom.txt"), "utf8"),
    /fixture permission approved #4[\s\S]*interrupted/u,
  );
  const permissionSnapshot = fs.readFileSync(
    path.join(artifactDir, "initial-permission-dom.txt"),
    "utf8",
  );
  assert.match(permissionSnapshot, /fixture permission approved #4/u);
  assert.doesNotMatch(permissionSnapshot, /interrupted/u);
  assert.match(
    fs.readFileSync(
      path.join(artifactDir, "initial-interrupt-dom.txt"),
      "utf8",
    ),
    /interrupted/u,
  );
  assert.match(
    fs.readFileSync(path.join(artifactDir, "restart-dom.txt"), "utf8"),
    /resumed previous conversation[\s\S]*fixture stream complete #6/u,
  );
  assert.match(
    fs.readFileSync(
      path.join(artifactDir, "initial-workbench-dom.txt"),
      "utf8",
    ),
    /workbench-result\.md[\s\S]*PR #88 merged/u,
  );
  assert.match(
    fs.readFileSync(
      path.join(artifactDir, "restart-workbench-dom.txt"),
      "utf8",
    ),
    /workbench-result\.md[\s\S]*PR #88 merged/u,
  );
});
