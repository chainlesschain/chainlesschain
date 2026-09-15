#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs } from "node:util";
import { readEvalHistory } from "../src/lib/eval/evidence.js";
import {
  buildOutcomeReport,
  outcomeDigest,
  validateOutcomePlan,
} from "../src/lib/eval/outcomes.js";

function readJson(file) {
  if (!file || fs.statSync(file).size > 16 * 1024 * 1024)
    throw new Error("missing input or input exceeds 16 MiB");
  const bytes = fs.readFileSync(file);
  if (bytes.length > 16 * 1024 * 1024) throw new Error("input exceeds 16 MiB");
  return JSON.parse(bytes.toString("utf8"));
}

try {
  const { values } = parseArgs({
    options: {
      plan: { type: "string" },
      history: { type: "string" },
      observations: { type: "string" },
      maintenance: { type: "string" },
      "plan-digest": { type: "string" },
      fingerprint: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Read-only baseline report (no model calls or production attestation).\n" +
        "node scripts/task-outcome-report.mjs --plan plan.json --fingerprint\n" +
        "node scripts/task-outcome-report.mjs --plan plan.json --plan-digest sha256:... --history history.jsonl --observations observations.json [--maintenance maintenance.json]\n" +
        "JSON goes to stdout. Exit 0: baseline recorded; 2: insufficient evidence; 1: invalid input. No improvement PASS is issued.",
    );
  } else {
    const plan = readJson(values.plan);
    validateOutcomePlan(plan);
    if (values.fingerprint) console.log(outcomeDigest(plan));
    else {
      if (!/^sha256:[a-f0-9]{64}$/u.test(values["plan-digest"] || ""))
        throw new Error(
          "--plan-digest is required; freeze it before collecting evidence",
        );
      const report = buildOutcomeReport(
        {
          plan,
          history: values.history
            ? readEvalHistory(values.history)
            : { runs: [], issues: [] },
          observations: values.observations
            ? readJson(values.observations)
            : [],
          maintenance: values.maintenance ? readJson(values.maintenance) : null,
        },
        { expectedPlanDigest: values["plan-digest"] },
      );
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "INSUFFICIENT_EVIDENCE") process.exitCode = 2;
    }
  }
} catch (error) {
  console.error(`Outcome report failed: ${error.message}`);
  process.exitCode = 1;
}
