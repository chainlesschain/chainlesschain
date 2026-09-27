"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { DraftStore } = require("../src/chat/draft-store.js");
const {
  answerAppServerQuestion,
} = require("../src/app-server-question-review.js");

test("VS Code returns the exact selected value for a blocking question", async () => {
  const calls = [];
  const vscode = {
    window: {
      async showQuickPick(items, options) {
        calls.push({ items, options });
        return items[1];
      },
    },
  };
  const answer = await answerAppServerQuestion(vscode, {
    question: "Target?",
    options: [
      { label: "Stage", value: "staging" },
      { label: "Prod", value: "production" },
    ],
    blocking: true,
  });
  assert.equal(answer, "production");
  assert.equal(calls[0].options.ignoreFocusOut, true);
});

function nativeWindow() {
  const controls = [];
  const create = () => {
    const events = {};
    const control = {
      value: "",
      selectedItems: [],
      enabled: true,
      show() {
        this.shown = true;
      },
      dispose() {
        this.disposed = true;
      },
    };
    for (const name of ["Value", "Selection", "Accept", "Hide"]) {
      const event = ["Value", "Selection"].includes(name)
        ? "onDidChange" + name
        : "onDid" + name;
      control[event] = (fn) => {
        events[name] = fn;
        return {
          dispose() {
            delete events[name];
          },
        };
      };
    }
    control.emit = (name) => events[name]?.();
    controls.push(control);
    return control;
  };
  return {
    controls,
    window: {
      createInputBox: create,
      createQuickPick: create,
      showWarningMessage() {},
    },
  };
}
async function shown(vscode, index = 0) {
  for (let i = 0; i < 100; i++) {
    if (vscode.controls[index]?.shown) return vscode.controls[index];
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("dialog did not appear");
}
const boundQuestion = {
  id: "q-1",
  question: "Color?",
  binding: {
    backgroundAgentId: null,
    sessionId: "s-1",
    turnId: "t-1",
    toolUseId: "tool-1",
    sequence: 1,
  },
};

test("native partially entered text survives host replacement, but requires explicit accept", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-native-q-"));
  const store = new DraftStore(root);
  try {
    const first = nativeWindow();
    const abandoned = answerAppServerQuestion(first, boundQuestion, { store });
    const input = await shown(first);
    input.value = "half typed";
    input.emit("Value");
    await store.queue;
    const next = nativeWindow();
    let answered = false;
    const response = answerAppServerQuestion(next, boundQuestion, {
      store: new DraftStore(root),
    }).then((value) => {
      answered = true;
      return value;
    });
    const recovered = await shown(next);
    assert.equal(recovered.value, "half typed");
    assert.equal(answered, false);
    recovered.value = "completed";
    await recovered.emit("Accept");
    assert.equal(await response, "completed");
    assert.equal(recovered.disposed, true);
    // Dispose the simulated old host after checking restart recovery.
    await input.emit("Hide");
    await abandoned;
  } finally {
    await store.queue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("native cancellation archives selected values and filter without automatically restoring authority", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-native-q-"));
  const store = new DraftStore(root);
  try {
    const vscode = nativeWindow();
    const request = {
      ...boundQuestion,
      multiSelect: true,
      options: [
        { label: "Stage", value: "staging" },
        { label: "Prod", value: "production" },
      ],
    };
    const response = answerAppServerQuestion(vscode, request, { store });
    const picker = await shown(vscode);
    picker.value = "Pro";
    picker.selectedItems = [picker.items[1]];
    picker.emit("Selection");
    await store.queue;
    await picker.emit("Hide");
    assert.equal(await response, null);
    const listed = await store.list();
    const record = (await store.view(listed[0].key)).questions[0];
    assert.equal(record.status, "archived");
    assert.match(record.text, /Pro/);
    const repeat = answerAppServerQuestion(vscode, request, { store });
    const next = await shown(vscode, 1);
    assert.equal(next.value, "");
    assert.deepEqual(next.selectedItems, []);
    next.selectedItems = [next.items[1]];
    await next.emit("Accept");
    assert.deepEqual(await repeat, ["production"]);
  } finally {
    await store.queue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("native save failures block acceptance and password answers are never persisted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-native-q-"));
  const store = new DraftStore(root);
  try {
    const vscode = nativeWindow();
    const response = answerAppServerQuestion(vscode, boundQuestion, { store });
    const input = await shown(vscode);
    const save = store.saveQuestion.bind(store);
    store.saveQuestion = async () => {
      throw new Error("disk full");
    };
    input.value = "keep";
    await input.emit("Accept");
    assert.equal(input.disposed, undefined);
    assert.equal(input.enabled, true);
    assert.match(input.validationMessage, /could not be saved/);
    store.saveQuestion = save;
    await input.emit("Hide");
    assert.equal(await response, null);
    const secret = answerAppServerQuestion(
      vscode,
      { ...boundQuestion, id: "secret", password: true },
      { store },
    );
    const password = await shown(vscode, 1);
    password.value = "private-secret";
    password.emit("Value");
    await password.emit("Accept");
    assert.equal(await secret, "private-secret");
    for (const item of await store.list())
      assert.equal(
        JSON.stringify(await store.view(item.key)).includes("private-secret"),
        false,
      );
  } finally {
    await store.queue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("VS Code cancellation is null and deferred free text does not trap focus", async () => {
  const vscode = {
    window: {
      async showInputBox(options) {
        assert.equal(options.ignoreFocusOut, false);
        return undefined;
      },
    },
  };
  assert.equal(
    await answerAppServerQuestion(vscode, {
      question: "Optional color?",
      mode: "deferred",
      blocking: false,
    }),
    null,
  );
});
