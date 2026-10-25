"use strict";

const assert = require("node:assert/strict");
const { addRule, _deps } = require("../../src/lib/settings-loader.cjs");
const originalLock = _deps.withFileLock;
// Four real processes compete for six durable writes each. Windows CI can
// deschedule a healthy owner beyond the production two-second admission
// deadline. Give this success fixture a bounded acquisition window, retaining
// strict ownership, refusal and fairness behavior. The parent still enforces
// its unchanged 20-second child and 30-second test deadlines.
_deps.withFileLock = (target, body, options) => {
  assert.equal(options.failIfUnavailable, true);
  assert.equal(options.timeoutMs, undefined);
  return originalLock(target, body, { ...options, timeoutMs: 10_000 });
};
const [cwd, prefix] = process.argv.slice(2);
for (let index = 0; index < 6; index++) {
  addRule({ cwd, kind: "deny", rule: `${prefix}-${index}` });
}
