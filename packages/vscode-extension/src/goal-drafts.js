/** Fixed CLI arguments and bounded response projections; no credential parsing. */
const { buildCliGoalPanelsArgs } = require("./plugin-manager");
const clean = (value, max = 4096) =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const hash = (value) =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
function selection(input) {
  buildCliGoalPanelsArgs(
    input.id,
    input.name,
    input.scope,
    input.expectedStore,
    input.connection,
  );
  if (!input.connection) throw new Error("Select a draft connection");
  return [
    "goal",
    null,
    input.id,
    `--plugin=${input.name}`,
    "--scope",
    input.scope,
    `--connection=${input.connection}`,
    "--json",
    ...(input.expectedStore ? [`--expected-store=${input.expectedStore}`] : []),
  ];
}
function buildGoalDraftAccessArgs({ name, scope, out }) {
  if (
    !clean(name, 256) ||
    !["user", "project", "local"].includes(scope) ||
    !clean(out)
  )
    throw new Error("Invalid access request selection");
  return [
    "goal",
    "draft-access",
    `--plugin=${name}`,
    "--scope",
    scope,
    `--out=${out}`,
    "--json",
  ];
}
function buildGoalDraftSourcesArgs(input, after) {
  const args = selection(input);
  args[1] = "draft-sources";
  if (after !== undefined) {
    if (!/^goal-proposal-[a-f0-9]{64}$/u.test(after))
      throw new Error("Invalid source cursor");
    args.push(`--after=${after}`);
  }
  return args;
}
function buildGoalDraftSendArgs(input) {
  const args = selection(input);
  args[1] = "draft-send";
  if (
    !/^goal-proposal-[a-f0-9]{64}$/u.test(input.source || "") ||
    !clean(input.requestId, 128) ||
    !clean(input.title, 256) ||
    !clean(input.descriptionFile) ||
    !clean(input.record)
  )
    throw new Error("Invalid draft selection");
  args.push(
    `--source=${input.source}`,
    `--request-id=${input.requestId}`,
    `--title=${input.title}`,
    `--description-file=${input.descriptionFile}`,
    `--record=${input.record}`,
  );
  return args;
}
function buildGoalDraftReceiptArgs(input) {
  const args = selection(input);
  args[1] = "draft-receipt";
  if (!clean(input.record)) throw new Error("Invalid submission record");
  args.push(`--record=${input.record}`);
  return args;
}
function parse(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 16384) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function bound(value, input) {
  return (
    value?.goalRef?.id === input.id &&
    value.goalRef.storeId === input.expectedStore &&
    Number.isSafeInteger(value.goalRef.revision) &&
    value.goalRef.revision >= 1 &&
    Number.isSafeInteger(value.goalRef.controlGeneration) &&
    value.goalRef.controlGeneration >= 0 &&
    value.plugin?.name === input.name &&
    value.plugin.scope === input.scope &&
    clean(value.plugin.version, 256) &&
    hash(value.declarationDigest) &&
    /^goal-external-grant-[a-f0-9]{64}$/u.test(value.grantRef?.id || "") &&
    Number.isSafeInteger(value.grantRef.epoch) &&
    value.grantRef.epoch >= 1
  );
}
function binding(value) {
  return {
    goalRef: {
      id: value.goalRef.id,
      storeId: value.goalRef.storeId,
      revision: value.goalRef.revision,
      controlGeneration: value.goalRef.controlGeneration,
    },
    plugin: {
      name: value.plugin.name,
      scope: value.plugin.scope,
      version: value.plugin.version,
    },
    declarationDigest: value.declarationDigest,
    grantRef: { id: value.grantRef.id, epoch: value.grantRef.epoch },
  };
}
function matchesBinding(value, input) {
  return (
    input.binding === undefined ||
    JSON.stringify(binding(value)) === JSON.stringify(input.binding)
  );
}
function parseGoalDraftAccess(text, input) {
  const raw = parse(text);
  return raw?.schema === "chainlesschain.goal-draft-access-export/v1" &&
    raw.state === "access-exported" &&
    raw.plugin?.name === input.name &&
    raw.plugin.scope === input.scope &&
    clean(raw.plugin.version, 256) &&
    hash(raw.declarationDigest) &&
    raw.file === input.out
    ? { file: raw.file }
    : null;
}
function parseGoalDraftSources(text, input) {
  const raw = parse(text),
    page = raw?.sources;
  if (
    raw?.schema !== "chainlesschain.goal-draft-source-page/v1" ||
    !bound(raw, input) ||
    !matchesBinding(raw, input) ||
    !page ||
    !Array.isArray(page.entries) ||
    page.entries.length > 20 ||
    !Number.isSafeInteger(page.scannedCount) ||
    page.scannedCount < 0 ||
    page.scannedCount > 20 ||
    !Number.isSafeInteger(page.unavailableCount) ||
    page.unavailableCount < 0 ||
    page.scannedCount !== page.entries.length + page.unavailableCount ||
    (page.nextCursor !== null &&
      (!/^goal-proposal-[a-f0-9]{64}$/u.test(page.nextCursor) ||
        page.scannedCount === 0))
  )
    return null;
  let prior = "";
  const entries = [];
  for (const row of page.entries) {
    if (
      !/^goal-proposal-[a-f0-9]{64}$/u.test(row?.id || "") ||
      row.id <= prior ||
      !clean(row.sourceTaskId, 256) ||
      !clean(row.reviewId, 256) ||
      !hash(row.reviewDigest)
    )
      return null;
    prior = row.id;
    entries.push({
      id: row.id,
      sourceTaskId: row.sourceTaskId,
      reviewId: row.reviewId,
    });
  }
  return {
    binding: binding(raw),
    entries,
    nextCursor: page.nextCursor,
    unavailableCount: page.unavailableCount,
  };
}
function parseGoalDraftSubmission(text, input) {
  const raw = parse(text);
  if (
    raw?.schema !== "chainlesschain.goal-draft-submission/v1" ||
    !bound(raw, input) ||
    !matchesBinding(raw, input) ||
    !["saved", "not-found", "unknown"].includes(raw.state) ||
    raw.record !== input.record ||
    !clean(raw.requestId, 128) ||
    !hash(raw.inputDigest) ||
    (input.requestId !== undefined && raw.requestId !== input.requestId) ||
    (raw.state === "saved"
      ? !/^goal-extension-[a-f0-9]{64}$/u.test(raw.proposalId || "")
      : raw.proposalId !== null)
  )
    return null;
  return {
    state: raw.state,
    record: raw.record,
    requestId: raw.requestId,
    inputDigest: raw.inputDigest,
    proposalId: raw.proposalId,
  };
}
function formatGoalDraftSubmission(result) {
  return `Request: ${result.requestId}\nInput digest: ${result.inputDigest}\nSubmission record: ${result.record}\n${result.state === "saved" ? `Saved pending draft: ${result.proposalId}. Open the desktop to review and confirm.` : result.state === "not-found" ? "No saved receipt found at lookup time. A late submission may still complete. No automatic resend was made." : "Submission outcome unknown. Keep this record and look up its receipt; do not create a new request to retry."}`;
}
module.exports = {
  buildGoalDraftAccessArgs,
  buildGoalDraftSourcesArgs,
  buildGoalDraftSendArgs,
  buildGoalDraftReceiptArgs,
  parseGoalDraftAccess,
  parseGoalDraftSources,
  parseGoalDraftSubmission,
  formatGoalDraftSubmission,
};
