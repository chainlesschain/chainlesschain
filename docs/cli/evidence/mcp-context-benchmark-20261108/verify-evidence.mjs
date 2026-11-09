import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidenceDir, "../../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(evidenceDir, "manifest.json"), "utf8"));
function verify(item) {
  const bytes = fs.readFileSync(path.join(repo, item.path));
  if (bytes.length !== item.bytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256)
    throw new Error(`Evidence identity mismatch: ${item.path}`);
}
for (const item of manifest.artifacts) verify(item);
if (process.argv.includes("--check-current-source")) for (const item of manifest.sources) verify(item);
const report = JSON.parse(fs.readFileSync(path.join(repo, manifest.report), "utf8"));
if (report.schema !== "chainlesschain.implementation-plan-context-measurement/v1") throw new Error("unexpected report schema");
if (JSON.stringify(report.scales) !== JSON.stringify([200, 1000, 5000])) throw new Error("scale coverage is incomplete");
if (report.providerUsageMeasured !== false || report.qualityEvaluationCompleted !== false) throw new Error("report overclaims provider or quality validation");
if (!Array.isArray(report.tiers) || report.tiers.length !== 3) throw new Error("tier count mismatch");
for (const tier of report.tiers) {
  if (tier.mcpToolCount !== tier.count || tier.exactSchemaSelection !== true || tier.omittedDescriptorSearchPassed !== true) throw new Error(`MCP selection contract failed at ${tier.count}`);
  if (tier.bodiesBefore !== 0 || tier.bodiesAfter !== 1) throw new Error(`lazy body contract failed at ${tier.count}`);
  if (tier.syntheticRecallAt5 !== 1 || tier.keywordResultCount > 5 || tier.misCallRateMeasured !== false) throw new Error(`synthetic Recall@5 contract failed at ${tier.count}`);
}
const large = report.tiers.find((tier) => tier.count === 5000);
if (large.skillCount !== 1000) throw new Error("5,000 scale did not record the production skill budget boundary");
console.log(JSON.stringify({ verified: true, sourceCommit: manifest.sourceCommit, scales: report.scales, mcpToolCounts: report.tiers.map((tier) => tier.mcpToolCount), skillFixtureCounts: report.tiers.map((tier) => tier.skillCount), providerUsageMeasured: report.providerUsageMeasured, qualityEvaluationCompleted: report.qualityEvaluationCompleted }));
