"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DraftStore } = require("../src/chat/draft-store");
const {
  answerAppServerQuestion,
} = require("../src/app-server-question-review");

function nativeWindow() {
  const controls = [],
    warnings = [];
  const create = () => {
    const events = new Map();
    const control = {
      value: "",
      selectedItems: [],
      enabled: true,
      show() {
        this.shown = true;
      },
      dispose() {
        this.disposed = true;
        events.get("Hide")?.();
      },
    };
    for (const [event, method] of Object.entries({
      Value: "onDidChangeValue",
      Selection: "onDidChangeSelection",
      Accept: "onDidAccept",
      Hide: "onDidHide",
      Back: "onDidTriggerButton",
    })) {
      control[method] = (fn) => {
        events.set(event, fn);
        return { dispose: () => events.delete(event) };
      };
    }
    control.emit = (name) => events.get(name)?.();
    controls.push(control);
    return control;
  };
  return {
    controls,
    warnings,
    QuickInputButtons: { Back: { id: "back" } },
    window: {
      createInputBox: create,
      createQuickPick: create,
      showWarningMessage: (message) => warnings.push(message),
    },
  };
}
async function shown(vscode, index) {
  for (let i = 0; i < 200; i++) {
    if (vscode.controls[index]?.shown) return vscode.controls[index];
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Control ${index} did not appear`);
}
async function choose(control, label) {
  const selected = control.items.find((item) => item.label === label);
  assert.ok(selected, `Missing option ${label}`);
  control.selectedItems = [selected];
  await control.emit("Accept");
}
const binding = {
  backgroundAgentId: null,
  sessionId: "s-1",
  turnId: "t-1",
  toolUseId: "tool-1",
  sequence: 1,
};
function request(properties, required = []) {
  return {
    id: "q1",
    binding,
    question: "Provide settings",
    mode: "blocking",
    blocking: true,
    metadata: {
      kind: "mcp_elicitation",
      mode: "form",
      server: "test",
      requestedSchema: { type: "object", properties, required },
    },
  };
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-native-schema-"));
  const store = new DraftStore(root);
  t.after(async () => {
    await store.queue;
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, store };
}

test("native structured review preserves order, validates fields and submits typed values without storing secrets", async (t) => {
  const { store } = await fixture(t);
  const vscode = nativeWindow();
  const req = request(
    {
      name: { type: "string" },
      count: { type: "integer", minimum: 2 },
      enabled: { type: "boolean", default: true },
      region: { type: "string", enum: ["east", "west"], default: "west" },
      flags: {
        type: "array",
        items: { type: "string", enum: ["a", "b"] },
        default: ["b"],
      },
      token: { type: "string", writeOnly: true },
    },
    ["count", "token"],
  );
  const response = answerAppServerQuestion(vscode, req, { store });
  let review = await shown(vscode, 0);
  assert.deepEqual(
    review.items.slice(0, 6).map((i) => i.label),
    ["name", "count *", "enabled", "region", "flags", "token *"],
  );
  await choose(review, "Submit answer");
  assert.match(review.validationMessage, /required/);
  assert.equal(review.disposed, undefined);
  await choose(review, "count *");
  const number = await shown(vscode, 1);
  number.value = "1";
  number.emit("Value");
  await number.emit("Accept");
  assert.match(number.validationMessage, /at least/);
  number.value = "2";
  number.emit("Value");
  await number.emit("Accept");
  review = await shown(vscode, 2);
  await choose(review, "name");
  const name = await shown(vscode, 3);
  name.value = "Alice";
  name.emit("Value");
  await name.emit("Accept");
  review = await shown(vscode, 4);
  await choose(review, "token *");
  const password = await shown(vscode, 5);
  assert.equal(password.password, true);
  password.value = "private-secret";
  password.emit("Value");
  await password.emit("Accept");
  review = await shown(vscode, 6);
  assert.equal(JSON.stringify(review.items).includes("private-secret"), false);
  await choose(review, "Submit answer");
  assert.deepEqual(await response, {
    name: "Alice",
    count: 2,
    enabled: true,
    region: "west",
    flags: ["b"],
    token: "private-secret",
  });
  const saved = await store.view((await store.list())[0].key);
  assert.equal(JSON.stringify(saved).includes("private-secret"), false);
  assert.equal(saved.questions[0].status, "archived");
  assert.ok(
    saved.questions[0].fields.some(
      (f) => f.key === '["count"]' && f.value === "2",
    ),
  );
});

test("native choices and Back preserve exact values and multi-select edits", async (t) => {
  const { store } = await fixture(t);
  const vscode = nativeWindow();
  const response = answerAppServerQuestion(
    vscode,
    request({
      region: {
        type: "string",
        oneOf: [
          { const: "east-id", title: "East" },
          { const: "west-id", title: "West" },
        ],
      },
      flags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      enabled: { type: "boolean" },
    }),
    { store },
  );
  await choose(await shown(vscode, 0), "region");
  let field = await shown(vscode, 1);
  field.selectedItems = [field.items.find((i) => i.label === "West")];
  field.emit("Selection");
  field.emit("Back");
  await choose(await shown(vscode, 2), "flags");
  field = await shown(vscode, 3);
  assert.equal(field.canSelectMany, true);
  field.selectedItems = [...field.items];
  field.emit("Selection");
  await field.emit("Accept");
  await choose(await shown(vscode, 4), "enabled");
  field = await shown(vscode, 5);
  field.selectedItems = [field.items.find((i) => i.value === true)];
  field.emit("Selection");
  await field.emit("Accept");
  await choose(await shown(vscode, 6), "Submit answer");
  assert.deepEqual(await response, {
    region: "west-id",
    flags: ["a", "b"],
    enabled: true,
  });
});

test("partially typed schema fields recover only on an exact bound reissue", async (t) => {
  const { root, store } = await fixture(t);
  const vscode = nativeWindow();
  const controller = new AbortController();
  const req = request({ name: { type: "string" } });
  const original = answerAppServerQuestion(vscode, req, {
    store,
    signal: controller.signal,
  });
  await choose(await shown(vscode, 0), "name");
  const input = await shown(vscode, 1);
  input.value = "half typed";
  input.emit("Value");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await store.queue;
  const key = (await store.list())[0].key;
  const files = await fs.readdir(path.join(root, key));
  const file = files.find((name) => name.endsWith(".json"));
  const beforeCrash = await fs.readFile(path.join(root, key, file));
  controller.abort();
  assert.equal(await original, null);
  await store.queue;
  // Restore the last durable bytes to model abrupt host loss before archival.
  await fs.writeFile(path.join(root, key, file), beforeCrash);
  const next = nativeWindow();
  const resumed = answerAppServerQuestion(next, req, {
    store: new DraftStore(root),
  });
  const review = await shown(next, 0);
  assert.equal(review.items[0].description, "half typed");
  await choose(review, "name");
  const restored = await shown(next, 1);
  assert.equal(restored.value, "half typed");
  await restored.emit("Accept");
  await choose(await shown(next, 2), "Submit answer");
  assert.deepEqual(await resumed, { name: "half typed" });
  await fs.writeFile(path.join(root, key, file), beforeCrash);
  const changed = nativeWindow();
  const different = answerAppServerQuestion(
    changed,
    { ...req, binding: { ...binding, sequence: 2 } },
    { store: new DraftStore(root) },
  );
  const fresh = await shown(changed, 0);
  assert.equal(fresh.items[0].description, "Not set");
  await choose(fresh, "Cancel question");
  assert.equal(await different, null);
});

test("storage failure prevents submit and explicit retry does not double-submit", async (t) => {
  const { store } = await fixture(t);
  const vscode = nativeWindow();
  const save = store.saveQuestion.bind(store);
  let failing = true;
  store.saveQuestion = async (...args) => {
    if (failing) throw new Error("disk full");
    return save(...args);
  };
  let answered = false;
  const response = answerAppServerQuestion(
    vscode,
    request({ count: { type: "integer", default: 4 } }),
    { store },
  ).then((value) => {
    answered = true;
    return value;
  });
  const review = await shown(vscode, 0);
  await choose(review, "Submit answer");
  assert.equal(answered, false);
  assert.equal(review.enabled, true);
  assert.match(review.validationMessage, /disk full/);
  failing = false;
  const one = review.emit("Accept");
  const two = review.emit("Accept");
  await Promise.all([one, two]);
  assert.deepEqual(await response, { count: 4 });
  assert.equal(
    (await store.view((await store.list())[0].key)).questions.length,
    1,
  );
});

test("abort while reading or saving cannot reopen a dialog or return an answer", async (t) => {
  const { store } = await fixture(t);
  const vscode = nativeWindow();
  const controller = new AbortController();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const view = store.view.bind(store);
  store.view = async (...args) => {
    await gate;
    return view(...args);
  };
  const response = answerAppServerQuestion(
    vscode,
    request({ name: { type: "string" } }),
    { store, signal: controller.signal },
  );
  controller.abort();
  release();
  assert.equal(await response, null);
  assert.equal(vscode.controls.length, 0);
  store.view = view;
  const nextController = new AbortController();
  const next = answerAppServerQuestion(vscode, request({}), {
    store,
    signal: nextController.signal,
  });
  const review = await shown(vscode, 0);
  const save = store.saveQuestion.bind(store);
  let unblock;
  store.saveQuestion = async (...args) => {
    await new Promise((resolve) => {
      unblock = resolve;
    });
    return save(...args);
  };
  const accepted = choose(review, "Submit answer");
  while (!unblock) await new Promise((resolve) => setImmediate(resolve));
  nextController.abort();
  unblock();
  await accepted;
  assert.equal(await next, null);
  assert.equal(review.disposed, true);
});

test("unknown schemas return a parsed object explicitly and never persist raw JSON", async (t) => {
  const { store } = await fixture(t);
  const vscode = nativeWindow();
  const response = answerAppServerQuestion(
    vscode,
    request({ nested: { type: "object" } }),
    { store },
  );
  const input = await shown(vscode, 0);
  input.value = "[]";
  await input.emit("Accept");
  assert.match(input.validationMessage, /JSON object/);
  input.value = '{"nested":{"token":"do-not-store"}}';
  await input.emit("Accept");
  assert.deepEqual(await response, { nested: { token: "do-not-store" } });
  assert.deepEqual(await store.list(), []);
});

test("URL review uses an immutable HTTPS target and aborts before opening a stale request", async () => {
  const vscode = nativeWindow();
  const controller = new AbortController();
  const opened = [];
  let confirm;
  vscode.window.showWarningMessage = () =>
    new Promise((resolve) => {
      confirm = resolve;
    });
  vscode.Uri = { parse: (value) => value };
  vscode.env = {
    openExternal: async (value) => {
      opened.push(value);
      return true;
    },
  };
  const req = {
    id: "url",
    binding,
    metadata: {
      kind: "mcp_elicitation",
      mode: "url",
      url: "https://example.com/review",
    },
  };
  const response = answerAppServerQuestion(vscode, req, {
    signal: controller.signal,
  });
  await Promise.resolve();
  req.metadata.url = "https://other.example/changed";
  controller.abort();
  confirm("Open secure page");
  assert.equal(await response, null);
  assert.deepEqual(opened, []);
  await assert.rejects(
    answerAppServerQuestion(vscode, {
      ...req,
      metadata: { ...req.metadata, url: "http://example.com" },
    }),
    /unsafe URL/,
  );
  const next = answerAppServerQuestion(vscode, req);
  req.metadata.url = "https://mutated.example";
  await new Promise((resolve) => setImmediate(resolve));
  confirm("Open secure page");
  assert.deepEqual(await next, {});
  assert.deepEqual(opened, ["https://other.example/changed"]);
});

test("native requests queue whole reviews and canceled waiting requests never create controls", async () => {
  const vscode = nativeWindow();
  const queued = new AbortController();
  const first = answerAppServerQuestion(
    vscode,
    request({ name: { type: "string" } }),
  );
  const firstReview = await shown(vscode, 0);
  const canceled = answerAppServerQuestion(
    vscode,
    { id: "q2", question: "Later?" },
    { signal: queued.signal },
  );
  const mutable = { id: "q3", question: "Original title" };
  const next = answerAppServerQuestion(vscode, mutable);
  mutable.question = "Changed title";
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(vscode.controls.length, 1);
  queued.abort();
  assert.equal(await canceled, null);
  await choose(firstReview, "name");
  const field = await shown(vscode, 1);
  field.value = "kept";
  field.emit("Value");
  await field.emit("Accept");
  await choose(await shown(vscode, 2), "Submit answer");
  assert.deepEqual(await first, { name: "kept" });
  const last = await shown(vscode, 3);
  assert.equal(last.prompt, "Original title");
  last.value = "second answer";
  await last.emit("Accept");
  assert.equal(await next, "second answer");
});
