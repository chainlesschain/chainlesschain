"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

// Every repository-owned code path that can hand PDH data to a model must
// import the terminal guard. Runtime tests cover representative paths; this
// inventory makes a newly added direct call visible in review immediately.
const guardedSources = [
  "lib/llm-client.js",
  "lib/analysis.js",
  "lib/analysis-skills/base.js",
  "lib/bridges/cc-llm-adapter.js",
  "lib/entity-resolver/embedding-stage.js",
  "lib/entity-resolver/llm-stage.js",
  "lib/adapters/email-imap/classifier.js",
  "lib/adapters/email-imap/templates/bill.js",
  "lib/adapters/email-imap/templates/other.js",
];

describe("Personal Data Hub model egress inventory", () => {
  it.each(guardedSources)("keeps %s behind the Evolution ingress guard", (relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    expect(source).toContain("rejectLegacyModelEgress");
  });
});
