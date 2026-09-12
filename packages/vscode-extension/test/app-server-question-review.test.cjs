"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
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
