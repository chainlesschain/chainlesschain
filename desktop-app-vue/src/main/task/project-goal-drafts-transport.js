"use strict";
const { createHash, timingSafeEqual } = require("node:crypto");
const {
  validateGoalDraftSources,
  validateGoalDraftProposal,
  validateGoalCreateDraftProposal,
  validateGoalDraftReceipt,
} = require("@chainlesschain/session-core/goal-draft-connection-contract");
const {
  digestBusinessObjectContent: digest,
} = require("@chainlesschain/session-core/business-object-contract");
const MAX = 16 * 1024;
function exact(raw, keys) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(raw, key))
  )
    throw new Error("invalid operation");
}
/** Independent v3/v6 profiles: exact-byte authenticated bounded pending RPC. */
function handleGoalDraftRequest({
  request,
  response,
  context,
  read,
  mac,
  nonces,
  port,
  close,
}) {
  const creation = context.createDrafts === true;
  const domain = creation ? "v6" : "v3",
    endpointPath = creation ? "/goal-create-drafts" : "/goal-drafts";
  const schema = (name) =>
    `chainlesschain.${creation ? name.replace("goal-draft", "goal-create-draft") : name}/v1`;
  const nonce = request.headers["x-cc-nonce"],
    signature = request.headers["x-cc-signature"];
  function send(status, payload) {
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX) throw new Error("response limit");
    response.writeHead(status, {
      "X-CC-Signature": mac(`response-${domain}\n${nonce}\n${status}\n${body}`),
    });
    response.end(body);
  }
  if (
    !["GET", "POST"].includes(request.method) ||
    request.url !== endpointPath ||
    request.headers.host !== `127.0.0.1:${port}` ||
    request.headers.origin !== undefined ||
    request.headers["sec-fetch-site"] !== undefined ||
    request.headers["transfer-encoding"] !== undefined ||
    typeof nonce !== "string" ||
    !/^[a-f0-9]{64}$/u.test(nonce) ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/u.test(signature)
  ) {
    response.writeHead(403);
    response.end('{"error":"GOAL_BRIDGE_DENIED"}');
    return;
  }
  const size = Number(request.headers["content-length"] || 0);
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX ||
    (request.method === "GET" && size !== 0) ||
    (request.method === "POST" &&
      (!size || request.headers["content-type"] !== "application/json"))
  ) {
    send(400, { error: "GOAL_DRAFT_REQUEST_INVALID" });
    return;
  }
  let finished = false,
    bytes = 0;
  const chunks = [];
  const timer = setTimeout(() => {
    finished = true;
    request.destroy();
  }, 5000);
  timer.unref();
  request.once("close", () => clearTimeout(timer));
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX || bytes > size) {
      finished = true;
      request.destroy();
    } else chunks.push(chunk);
  });
  request.once("error", () => {
    finished = true;
    clearTimeout(timer);
  });
  request.once("aborted", () => {
    finished = true;
    clearTimeout(timer);
  });
  request.once("end", () => {
    clearTimeout(timer);
    if (finished || request.aborted || response.destroyed || bytes !== size)
      return;
    finished = true;
    const body = Buffer.concat(chunks),
      bodyHash = createHash("sha256").update(body).digest("hex");
    if (
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(
          mac(
            `request-${domain}\n${request.method}\n${endpointPath}\n${nonce}\n${bodyHash}`,
          ),
        ),
      )
    ) {
      send(403, { error: "GOAL_BRIDGE_DENIED" });
      return;
    }
    if (nonces.has(nonce) || nonces.size >= 512) {
      send(429, { error: "GOAL_BRIDGE_REQUEST_LIMIT" });
      return;
    }
    nonces.add(nonce);
    try {
      read();
    } catch {
      send(410, { error: "GOAL_BRIDGE_UNAVAILABLE" });
      close();
      return;
    }
    let operation;
    try {
      if (request.method === "GET") {
        const result = context.readDraftContext();
        read();
        send(200, {
          schema: schema("project-goal-drafts"),
          ...result,
        });
        return;
      }
      operation = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      );
      let result;
      if (operation.operation === "sources") {
        exact(
          operation,
          operation.afterId === undefined
            ? ["operation"]
            : ["operation", "afterId"],
        );
        result = {
          schema: schema("goal-draft-sources"),
          goalRef: context.read().goalRef,
          sources: validateGoalDraftSources(
            context.draftSources(operation.afterId),
          ),
        };
      } else if (operation.operation === "enqueue") {
        exact(operation, ["operation", "proposal"]);
        const proposal = (
          creation ? validateGoalCreateDraftProposal : validateGoalDraftProposal
        )(operation.proposal);
        const saved = context.enqueueDraft(proposal);
        result = {
          schema: schema("goal-draft-submit"),
          goalRef: proposal.goalRef,
          receipt: validateGoalDraftReceipt({
            state: "saved",
            proposalId: saved.proposalId,
            requestId: proposal.requestId,
            inputDigest: digest(proposal),
          }),
        };
      } else if (operation.operation === "receipt") {
        exact(operation, ["operation", "requestId", "inputDigest"]);
        result = {
          schema: schema("goal-draft-receipt"),
          goalRef: context.read().goalRef,
          receipt: validateGoalDraftReceipt(context.draftReceipt(operation)),
        };
      } else throw new Error("invalid operation");
      read();
      send(200, result);
    } catch (error) {
      const code = [
        "GOAL_EXTENSION_REQUEST_CONFLICT",
        "GOAL_EXTERNAL_GRANT_CONFLICT",
      ].includes(error.code)
        ? error.code
        : "GOAL_DRAFT_OPERATION_DENIED";
      send(409, { error: code });
    }
  });
}
module.exports = { handleGoalDraftRequest };
