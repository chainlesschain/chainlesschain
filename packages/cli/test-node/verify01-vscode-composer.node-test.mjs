import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const {
  fillAndSubmit,
} = require("../../vscode-extension/test/extension-host/driver/verify01-composer.cjs");
const {
  validateHostDomRequest,
} = require("../../vscode-extension/src/chat/host-dom-relay.js");

test("native cleanup can observe a real exit after the model task deadline", async () => {
  const driver = fs.readFileSync(
    new URL(
      "../../vscode-extension/test/extension-host/driver/verify01.cjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = driver.indexOf("  async function wait(");
  const end = driver.indexOf("  const snapshot =", start);
  assert.ok(start >= 0 && end > start);
  let now = 200;
  const wait = vm.runInNewContext(`${driver.slice(start, end)}\nwait`, {
    deadline: 100,
    Date: { now: () => now },
    delay: async (ms) => {
      now += ms;
    },
  });
  let reads = 0;
  await assert.rejects(
    wait(
      "task",
      async () => {
        reads++;
      },
      Boolean,
    ),
    /deadline/,
  );
  assert.equal(reads, 0);
  const result = await wait(
    "cleanup",
    async () => ({ exited: ++reads === 2 }),
    (value) => value.exited,
    now + 15000,
  );
  assert.equal(result.exited, true);
  assert.equal(reads, 2);
});
function composer() {
  const seen = { clicked: 0, focused: 0, events: [] };
  const input = {
    value: "",
    focus() {
      seen.focused++;
    },
    dispatchEvent(event) {
      seen.events.push(event);
    },
  };
  const button = {
    disabled: false,
    click() {
      seen.clicked++;
      seen.sent = input.value;
    },
  };
  const context = vm.createContext({
    document: {
      querySelector: (selector) =>
        selector === "textarea#input"
          ? input
          : selector === "#send"
            ? button
            : null,
    },
    Event: class {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
  });
  return {
    seen,
    input,
    button,
    client: {
      evaluate: async (expression) => vm.runInContext(expression, context),
    },
    snapshot: async () => ({
      inputText: input.value,
      sendEnabled: !button.disabled,
    }),
  };
}
test("public relay rejects task prompts; CDP composer preserves full UTF8 and clicks once", async () => {
  const prompt = 'Original task 中文😀 `code` "quotes"\n'.repeat(160);
  assert.throws(
    () => validateHostDomRequest({ action: "send", text: prompt }),
    /512/,
  );
  const view = composer();
  const receipt = await fillAndSubmit(view.client, prompt, view.snapshot);
  assert.equal(view.seen.sent, prompt);
  assert.equal(view.seen.clicked, 1);
  assert.equal(view.seen.focused, 1);
  assert.equal(view.seen.events[0].type, "input");
  assert.equal(view.seen.events[0].bubbles, true);
  assert.equal(
    receipt.promptDigest,
    `sha256:${createHash("sha256").update(prompt).digest("hex")}`,
  );
  assert.equal(receipt.observedDigest, receipt.promptDigest);
  assert.equal(receipt.utf8Bytes, Buffer.byteLength(prompt));
});
test("composer refuses disabled UI, mismatched snapshot, or altered text before send", async () => {
  const prompt = "x".repeat(600);
  const disabled = composer();
  disabled.button.disabled = true;
  await assert.rejects(
    fillAndSubmit(disabled.client, prompt, disabled.snapshot),
    /unavailable/,
  );
  assert.equal(disabled.seen.clicked, 0);
  const truncated = composer();
  await assert.rejects(
    fillAndSubmit(truncated.client, prompt, async () => ({
      inputText: prompt.slice(0, 512),
      sendEnabled: true,
    })),
    /differs/,
  );
  assert.equal(truncated.seen.clicked, 0);
  const changed = composer();
  await assert.rejects(
    fillAndSubmit(changed.client, prompt, async () => {
      changed.input.value = "changed";
      return { inputText: prompt, sendEnabled: true };
    }),
    /submission failed/,
  );
  assert.equal(changed.seen.clicked, 0);
});
test("composer enforces byte limit without trimming or submitting", async () => {
  const view = composer();
  await assert.rejects(
    fillAndSubmit(view.client, "中".repeat(350000), view.snapshot),
  );
  assert.equal(view.seen.clicked, 0);
  assert.equal(view.input.value, "");
});
