"use strict";

const assert = require("node:assert/strict");
const {
  parsePrStatusJson,
  prStatusToMarkdown,
} = require("../src/pr-status-view.js");

assert.equal(parsePrStatusJson("not json"), null);
const parsed = parsePrStatusJson(
  JSON.stringify({ source: "gh:org/repo#42", lines: ["checks: 2/2", "merge: blocked"] }),
);
assert.deepEqual(parsed.lines, ["checks: 2/2", "merge: blocked"]);
assert.match(
  prStatusToMarkdown(parsed),
  /Source: `gh:org\/repo#42`[\s\S]*- checks: 2\/2[\s\S]*- merge: blocked/,
);
assert.match(prStatusToMarkdown({ source: "offline" }), /```json/);

console.log("pr-status-view: 4 assertions passed");
