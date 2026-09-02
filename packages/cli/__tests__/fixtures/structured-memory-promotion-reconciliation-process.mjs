import { createHash } from "node:crypto";
import path from "node:path";
import { createStructuredMemoryAgentControlPlaneFixture } from "./structured-memory-agent-control-plane.js";
import { buildSkillEvaluatedPromotionReceiptEnvelope } from "../../src/lib/evolution/skill-evaluated-promotion.js";
import { digestSkillMutationReceiptEnvelope } from "../../src/lib/evolution/skill-mutation-authority.js";
import { SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA } from "../../src/lib/evolution/skill-target-matrix-eval.js";

const RELEASE_RECEIPT_SCHEMA =
  "chainlesschain.skill-release-transition-receipt/v4";
const TENANT_ID = "tenant-promotion-process-recovery";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function promotionFixture() {
  const skillName = "process-recovery-skill";
  const contentDigest = digest("process-recovery-content");
  const releaseDigest = digest("process-recovery-release");
  const matrixReceiptDigest = digest("process-recovery-matrix-receipt");
  const evalDigest = digestSkillMutationReceiptEnvelope(
    buildSkillEvaluatedPromotionReceiptEnvelope({
      schema: SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
      receiptDigest: matrixReceiptDigest,
    }),
  );
  const receiptCore = {
    activeReleaseDigest: releaseDigest,
    operation: "promote",
    receiptDigests: { eval: evalDigest },
    schema: RELEASE_RECEIPT_SCHEMA,
    skillName,
    tenantId: TENANT_ID,
  };
  const receipt = {
    ...receiptCore,
    receiptDigest: digest(
      `${RELEASE_RECEIPT_SCHEMA}\0${canonical(receiptCore)}`,
    ),
  };
  return {
    result: {
      release: {
        tenantId: TENANT_ID,
        skillName,
        releaseDigest,
        contentDigest,
      },
      state: {
        tenantId: TENANT_ID,
        skillName,
        activeReleaseDigest: releaseDigest,
      },
      receipt,
    },
    matrixBinding: {
      tenantId: TENANT_ID,
      skillName,
      candidateContentDigest: contentDigest,
      matrixReceiptDigest,
    },
  };
}

async function main() {
  const phase = process.argv[2];
  const rootDir = path.resolve(process.argv[3]);
  const fixture = createStructuredMemoryAgentControlPlaneFixture({
    tenantId: TENANT_ID,
    rootDir,
    durableLedger: true,
  });
  if (phase === "seed") {
    const input = promotionFixture();
    const receipt =
      await fixture.controlPlane.promotionReceiptWriter.retainPromotion(
        input.result,
        input.matrixBinding,
      );
    return {
      phase,
      receiptDigest: receipt.receiptDigest,
      memoryId: receipt.memoryId,
      projection: fixture.controlPlane.memory.projection(),
    };
  }
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
