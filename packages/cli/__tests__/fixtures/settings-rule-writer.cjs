"use strict";

const { addRule } = require("../../src/lib/settings-loader.cjs");
const [cwd, prefix] = process.argv.slice(2);
for (let index = 0; index < 6; index++) {
  addRule({ cwd, kind: "deny", rule: `${prefix}-${index}` });
}
