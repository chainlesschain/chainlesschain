import fs from "node:fs";
import path from "node:path";
import { openEvalCompositionTestStore } from "../../fixtures/evolution-eval-composition.js";
import { createSkillEvaluatedPromotionDurabilityAdapter } from "../../../src/lib/evolution/skill-evaluated-promotion-durability.js";
import { SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA } from "../../../src/lib/evolution/skill-evaluated-promotion.js";

const [root] = process.argv.slice(2);
const request = JSON.parse(
  fs.readFileSync(path.join(root, "reopen-request.json"), "utf8"),
);
const store = openEvalCompositionTestStore(root, request.tenantId);
const durability = createSkillEvaluatedPromotionDurabilityAdapter(
  store.durabilityOptions,
);
const resolved = await durability.resolver.resolve({
  schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA,
  tenantId: request.tenantId,
  receiptDigest: request.receiptDigest,
});
const evidence = [];
for (const cell of resolved.matrixReceipt.cellResults) {
  const result = await store.childReceiptStore.resolve({
    tenantId: request.tenantId,
    kind: "gate-receipt",
    receiptDigest: cell.childReceiptDigest,
  });
  evidence.push({
    authenticated: result.authenticated,
    durable: result.durable,
    receiptDigest: result.receiptDigest,
    evidence: result.evidence,
  });
}
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    matrixReceipt: resolved.matrixReceipt,
    stageOutput: store.outputLedger.load({
      planDigest: request.planDigest,
      stage: "eval",
    }),
    evidence,
  }),
);
