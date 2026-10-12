import fs from "node:fs";
import { FormalBudgetAuthority } from "../src/lib/formal-budget-authority.js";
import {
  NOW,
  body,
  response,
  verifyFixtureEvidence,
} from "./formal-budget-fixture.mjs";
const [mode, descriptorFile, callId] = process.argv.slice(2);
const descriptor = JSON.parse(fs.readFileSync(descriptorFile, "utf8"));
const authority = new FormalBudgetAuthority({
  ...descriptor,
  verifyEvidence: verifyFixtureEvidence,
  now: () => NOW,
});
try {
  if (mode === "crash-reserved" || mode === "crash-dispatched") {
    authority.reserve({ runId: "initial", callId, body });
    if (mode === "crash-dispatched") authority.markDispatched(callId, body);
    process.send({ ready: true });
    setInterval(() => {}, 1000);
  } else if (mode === "reserve") {
    authority.reserve({ runId: "initial", callId, body });
    authority.close();
    process.exit(0);
  } else if (mode === "crash-settled") {
    authority.reserve({ runId: "initial", callId, body });
    authority.markDispatched(callId, body);
    authority.settle(callId, response());
    process.send({ ready: true });
    setInterval(() => {}, 1000);
  }
} catch (error) {
  process.stderr.write(error.code || error.message);
  authority.close();
  process.exit(2);
}
