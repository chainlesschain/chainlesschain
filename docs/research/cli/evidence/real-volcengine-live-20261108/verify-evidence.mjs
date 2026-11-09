import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidenceDir, "../../../../../");
const manifest = JSON.parse(fs.readFileSync(path.join(evidenceDir, "manifest.json"), "utf8"));
function verify(item) {
  const bytes = fs.readFileSync(path.join(repo, item.path));
  if (bytes.length !== item.bytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256)
    throw new Error(`Evidence identity mismatch: ${item.path}`);
}
for (const item of manifest.artifacts) verify(item);
if (process.argv.includes("--check-current-source")) for (const item of manifest.sources) verify(item);
const receipt = JSON.parse(fs.readFileSync(path.join(repo, manifest.receipt), "utf8"));
if (receipt.schema !== "chainlesschain.real-volcengine-read-task/v1" || receipt.completed !== true) throw new Error("real task did not complete");
if (receipt.provider !== "volcengine" || receipt.requests !== 2 || receipt.toolCallObserved !== true || receipt.toolResultMarkerVerified !== true || receipt.finalMarkerVerified !== true) throw new Error("real task contract failed");
if (receipt.credentialExposed !== false || receipt.responseContentExposed !== false || receipt.billingVerified !== false) throw new Error("receipt privacy or billing boundary changed");
if (!Array.isArray(receipt.calls) || receipt.calls.length !== 2) throw new Error("call receipt count mismatch");
for (const call of receipt.calls) {
  if (!/^[a-f0-9]{64}$/u.test(call.requestDigest) || !/^[a-f0-9]{64}$/u.test(call.responseDigest)) throw new Error("request/response digest missing");
  if (!Number.isSafeInteger(call.usage?.input_tokens) || !Number.isSafeInteger(call.usage?.output_tokens)) throw new Error("usage is not accountable");
}
console.log(JSON.stringify({ verified: true, sourceCommit: manifest.sourceCommit, provider: receipt.provider, model: receipt.model, requests: receipt.requests, toolCallObserved: receipt.toolCallObserved, toolResultMarkerVerified: receipt.toolResultMarkerVerified, finalMarkerVerified: receipt.finalMarkerVerified, billingVerified: receipt.billingVerified }));
