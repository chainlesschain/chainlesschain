import path from "node:path";
import { createStructuredMemoryAgentControlPlaneFixture } from "./structured-memory-agent-control-plane.js";

const TENANT_ID =
  process.env.CC_TEST_PROMOTION_TENANT_ID ||
  "tenant-promotion-process-recovery";

async function main() {
  const phase = process.argv[2];
  const rootDir = path.resolve(process.argv[3]);
  const fixture = createStructuredMemoryAgentControlPlaneFixture({
    tenantId: TENANT_ID,
    rootDir,
    durableLedger: true,
  });
  if (phase === "reconcile" || phase === "verify") {
    const reconciliation =
      await fixture.controlPlane.reconcilePromotionMemories();
    return {
      phase,
      reconciliation,
      projection: fixture.controlPlane.memory.projection(),
    };
  }
  throw new Error("unknown promotion reconciliation process phase");
}

try {
  const result = await main();
  process.stdout.write(
    `${JSON.stringify({ ok: true, pid: process.pid, ...result })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      pid: process.pid,
      code: error?.code ?? null,
      message: error?.message ?? String(error),
    })}\n`,
  );
  process.exitCode = 2;
}
