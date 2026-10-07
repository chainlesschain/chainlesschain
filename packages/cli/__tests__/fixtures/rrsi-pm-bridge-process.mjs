import { openRrsiPmBridgeFixture } from "./rrsi-pm-bridge.js";
import { rrsiFixtureDigest } from "./rrsi-shadow-fixture.js";
import {
  reserveRrsiPmBroadRound,
  executeRrsiPmBroadRound,
} from "../../src/lib/evolution/rrsi-pm-execution-bridge.js";

const [root, mode] = process.argv.slice(2);
let armed = false;
try {
  const value = openRrsiPmBridgeFixture(root, {
    initialize: false,
    crashHook: (phase) => {
      if (armed && phase === "after-head")
        process.exit(mode === "crash-observation" ? 72 : 71);
    },
    ...(mode === "crash-observation"
      ? {
          run: async (_request, runtime) => {
            runtime.recordTokens(1);
            armed = true;
            return {
              outputMemoryDigest: rrsiFixtureDigest("TEST hard-exit memory"),
              traceDigest: rrsiFixtureDigest("TEST hard-exit trace"),
            };
          },
        }
      : {}),
  });
  const response = reserveRrsiPmBroadRound(
    value.bridge,
    value.journal,
    value.roundInput(),
  );
  if (mode === "crash-dispatch") armed = true;
  try {
    const result = await executeRrsiPmBroadRound(value.bridge, response);
    process.stdout.write(`${JSON.stringify({ result, calls: value.calls })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ replayDenied: error.code === "CC_RRSI_REPLAY_FORBIDDEN", newlyCommitted: response.newlyCommitted, calls: value.calls })}\n`,
    );
  }
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: error.code ?? "test-failed" })}\n`,
  );
  process.exitCode = 1;
}
