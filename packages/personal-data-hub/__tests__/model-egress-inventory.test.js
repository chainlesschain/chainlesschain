"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

// Every repository-owned code path that can hand PDH data to a model must
// import the terminal guard. Runtime tests cover representative paths; this
// inventory makes a newly added direct call visible in review immediately.
const permanentlyClosedSources = [
  "lib/llm-client.js",
  "lib/bridges/cc-llm-adapter.js",
  "lib/entity-resolver/embedding-stage.js",
  "lib/adapters/email-imap/classifier.js",
  "lib/adapters/email-imap/templates/bill.js",
  "lib/adapters/email-imap/templates/other.js",
];

const authenticatedClientSources = [
  "lib/analysis.js",
  "lib/analysis-skills/base.js",
  "lib/entity-resolver/llm-stage.js",
];

describe("Personal Data Hub model egress inventory", () => {
  it.each(permanentlyClosedSources)(
    "keeps %s permanently closed without a governed replacement",
    (relativePath) => {
      const source = fs.readFileSync(path.join(root, relativePath), "utf8");
      expect(source).toContain("rejectLegacyModelEgress");
    },
  );

  it.each(authenticatedClientSources)(
    "keeps %s limited to privately branded Evolution clients",
    (relativePath) => {
      const source = fs.readFileSync(path.join(root, relativePath), "utf8");
      expect(source).toContain("assertAuthenticatedEvolutionModelEgress");
    },
  );
});
