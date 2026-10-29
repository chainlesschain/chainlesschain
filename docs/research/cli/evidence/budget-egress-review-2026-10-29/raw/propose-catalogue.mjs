import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");
const cataloguePath = "packages/cli/scripts/budget-egress-reviewed-sources.json";
const sha = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const recommendations = [
  ["packages/cli/src/assets/web-panel/assets/Artifacts-D4DeQQ89.js", "SERVICE_API", "Generated artifact panel downloads stored files with an authenticated same-origin GET to /api/artifacts/:id/download and delegates list, preview, removal and expiry cleanup through the shared CLI WebSocket service. This is artifact service traffic, not direct model inference; server-side authorization, storage effects and any downstream costs remain separate checks."],
  ["packages/cli/src/assets/web-panel/assets/index-CI07XFwr.js", "REMOTE_EXECUTION_CONTROL", "Generated application entry includes the modulepreload fetch polyfill and a configurable CLI gateway WebSocket carrying authentication, session creation, commands and model/chat requests. Conservative alias candidates M(...) also match UI render callbacks and are not additional WebSocket launches. Remote execution and provider costs require the serving host's own budget authority; source review does not attest that authority."],
  ["packages/cli/src/assets/web-panel/assets/MtcAudit-CwJzv9a9.js", "REMOTE_EXECUTION_CONTROL", "Generated MTC audit panel delegates envelope queries, archive push/restore, governance, trust and automatic archive controls to desktop-host WebSocket topics. The flagged i.fetch call is the envelope composable method forwarding mtc.envelope.get, not global HTTP fetch. Delegated operations may cause storage or WebDAV/network effects; their authorization and costs are outside this byte-bound source classification."],
  ["packages/cli/src/assets/web-panel/assets/RemoteSession-DyCisp2M.js", "REMOTE_EXECUTION_CONTROL", "Generated remote-session client opens WebSockets to the configured relay or paired direct host and sends authenticated or encrypted prompts, approvals and interruption controls. Conservative alias candidates also match local cryptographic constructors and callbacks; the actual network constructors are the relay and direct WebSocket launches. Encryption and command deduplication do not establish remote model budget containment or paid readiness."],
  ["packages/cli/src/commands/llm.js", "LOCAL_DIAGNOSTIC", "Direct fetch lists Ollama models with GET /api/tags against a configurable base URL; the default is local, but locality or zero cost is not guaranteed for an overridden endpoint. The separate llm test command delegates inference to probeLlmConnection. Reviewed delta adds advertised maximum input capability display and formatting without changing this direct request or introducing another outbound dispatch. This classification does not attest paid admission."],
  ["packages/cli/src/lib/llm-connection-probe.js", "MODEL_REQUEST", "Connectivity testing performs inference through one providerFetch POST with a 1024-token output allowance, timeout and redirect refusal. Reviewed delta preserves cache-write lifetime splits and response service-tier/regional pricing evidence in usage and receipts, replacing blanket rejection of nonzero Responses cache writes. Invalid or missing required cache-write split evidence remains unpriced through invalid-context flags and unmatched estimates. Absent service-tier or regional metadata uses standard/nonregional estimate defaults and does not verify billed terms; receipt billingVerified remains false. No retry or additional dispatch is introduced. Provider scope governs supported physical requests, but source classification does not establish billing or paid readiness."],
  ["packages/cli/src/runtime/agent-core.js", "MODEL_REQUEST", "Canonical agent execution retains six providerFetch and two ollamaProviderFetch dispatch sites. Reviewed delta since 99694e24c5 refreshes host-published MCP catalogs, validates catalog bindings before delegated dispatch, propagates cancellation to subagents and refreshes host project context around compaction. Catalog refresh may change available delegated tools and context refresh changes model input; these remain subject to existing execution, session and provider admission paths. No independent provider dispatch is added. This source review does not attest arbitrary MCP or descendant containment, financial admission, quality acceptance or cross-platform release readiness."],
];
const baseline = JSON.parse(fs.readFileSync(path.join(root, ".work/structured-memory-20261029/budget-current.json")));
const sourceExpected = new Map(baseline.networkCandidates.map(row => [row.path, row.digest]));
const render = entry => JSON.stringify(entry, null, 2).split("\n").map(line => "    " + line).join("\n");
const receipts = [];
for (const [label, repository] of [["main", root], ["e7", path.join(directory,"e7-clone")]]) {
  const scannerPath = path.join(repository, "packages/cli/scripts/lib/budget-egress-inventory.mjs");
  const { scanNetworkSources, reviewNetworkSources } = await import(pathToFileURL(scannerPath));
  const { FORMAL_BUDGET_RUNTIME_READINESS } = await import(pathToFileURL(path.join(repository, "packages/cli/src/lib/formal-budget-transport.js")));
  const catalogueFile = path.join(repository, cataloguePath);
  const before = fs.readFileSync(catalogueFile, "utf8");
  if (sha(before) !== baseline.sourceReview.digest) throw new Error("Catalogue baseline changed");
  const existing = JSON.parse(before);
  const selected = recommendations.filter(([file]) => label === "main" || ["packages/cli/src/commands/llm.js", "packages/cli/src/lib/llm-connection-probe.js"].includes(file));
  let proposed = before.replace('"reviewedAt": "2026-10-28"', '"reviewedAt": "2026-10-29"');
  const changes = [];
  for (const [file, category, rationale] of selected) {
    const digest = sha(fs.readFileSync(path.join(repository,file)));
    if (digest !== sourceExpected.get(file)) throw new Error("Reviewed source changed: " + file);
    const entry = {path:file, digest, category, rationale};
    const old = existing.entries.find(row => row.path === file);
    if (old) {
      const oldText = render(old);
      if (!proposed.includes(oldText)) throw new Error("Unexpected catalogue formatting: " + file);
      proposed = proposed.replace(oldText,render(entry));
    } else {
      const marker = '    {\n      "path": "packages/cli/src/commands/agenda.js",';
      if (!proposed.includes(marker)) throw new Error("Insertion marker missing");
      proposed = proposed.replace(marker,render(entry)+",\n"+marker);
    }
    changes.push({before:old ?? null, after:entry});
  }
  const proposedPath = path.join(directory, `${label}-proposed-catalogue-v2.json`);
  fs.writeFileSync(proposedPath, proposed, {flag:"wx"});
  const diff = spawnSync("git",["diff","--no-index","--no-ext-diff",catalogueFile,proposedPath],{encoding:"utf8",maxBuffer:4*1024*1024});
  if (diff.status !== 1) throw new Error("Expected a nonempty catalogue diff");
  const patch = diff.stdout.split("\n").map(line => line.startsWith("diff --git ") ? `diff --git a/${cataloguePath} b/${cataloguePath}` : line.startsWith("--- ") ? `--- a/${cataloguePath}` : line.startsWith("+++ ") ? `+++ b/${cataloguePath}` : line).join("\n");
  fs.writeFileSync(path.join(directory,`${label}-proposed-catalogue-v2.patch`),patch,{flag:"wx"});
  const scan = scanNetworkSources(repository,["packages/cli/src","packages/cli/scripts"]);
  const oldReview = reviewNetworkSources(scan,existing);
  const newReview = reviewNetworkSources(scan,JSON.parse(proposed));
  const result = {label, repository, catalogueBefore:sha(before), catalogueProposed:sha(proposed), catalogueAfter:sha(fs.readFileSync(catalogueFile)), scannerDigest:sha(fs.readFileSync(scannerPath)), sourceTreeDigest:scan.sourceTreeDigest, filesScanned:scan.filesScanned, parseErrors:scan.parseErrors, skippedPaths:scan.skippedPaths, oldIssues:oldReview.issues, proposedReviewPassed:newReview.sourceReviewPassed, proposedIssues:newReview.issues, readiness:FORMAL_BUDGET_RUNTIME_READINESS, runtimeCoverageVerified:newReview.runtimeCoverageVerified, changes};
  fs.writeFileSync(path.join(directory,`${label}-proposal-validation-v2.json`),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
  receipts.push({label, filesScanned:result.filesScanned,oldIssues:oldReview.issues,proposedReviewPassed:newReview.sourceReviewPassed,proposedIssues:newReview.issues,paidReady:FORMAL_BUDGET_RUNTIME_READINESS.paidReady,catalogueUnchanged:result.catalogueBefore === result.catalogueAfter});
}
console.log(JSON.stringify(receipts,null,2));
