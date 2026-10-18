import http from "node:http";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { digestBusinessObjectContent as digest } from "@chainlesschain/session-core/business-object-contract";
import {
  validateGoalDraftSources,
  validateGoalDraftReceipt,
  validateGoalDraftProposal,
} from "@chainlesschain/session-core/goal-draft-connection-contract";
function unavailable() {
  return new Error("CLI_GOAL_CONNECTION_UNAVAILABLE");
}
function exact(raw, keys) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(raw, key))
  )
    throw unavailable();
}
/** Constructed only after the shared private-file reader verifies the descriptor. */
export function createProjectGoalDraftClient(descriptor, validate) {
  const ref = Object.freeze({ ...descriptor.goalRef }),
    grant = Object.freeze({
      id: descriptor.grantRef.id,
      epoch: descriptor.grantRef.epoch,
      plugin: Object.freeze({ ...descriptor.plugin }),
      declarationDigest: descriptor.declarationDigest,
    });
  const mac = (text) =>
    createHmac("sha256", Buffer.from(descriptor.key, "hex"))
      .update(text)
      .digest("hex");
  async function exchange(method, payload, writing = false) {
    validate();
    const bytes =
      payload === undefined
        ? Buffer.alloc(0)
        : Buffer.from(JSON.stringify(payload));
    if (bytes.length > 16384) throw unavailable();
    const nonce = randomBytes(32).toString("hex"),
      bodyHash = createHash("sha256").update(bytes).digest("hex");
    let sent = false;
    try {
      const result = await new Promise((resolve, reject) => {
        const request = http.request(
          descriptor.endpoint,
          {
            method,
            agent: false,
            maxHeaderSize: 4096,
            headers: {
              "X-CC-Nonce": nonce,
              "X-CC-Signature": mac(
                `request-v3\n${method}\n/goal-drafts\n${nonce}\n${bodyHash}`,
              ),
              ...(method === "POST"
                ? {
                    "Content-Type": "application/json",
                    "Content-Length": bytes.length,
                  }
                : {}),
            },
          },
          (response) => {
            const chunks = [];
            let size = 0;
            response.on("error", reject);
            response.on("data", (chunk) => {
              size += chunk.length;
              if (size > 16384) response.destroy(unavailable());
              else chunks.push(chunk);
            });
            response.on("end", () => {
              try {
                const text = new TextDecoder("utf-8", { fatal: true }).decode(
                    Buffer.concat(chunks),
                  ),
                  signature = response.headers["x-cc-signature"];
                if (
                  typeof signature !== "string" ||
                  !/^[a-f0-9]{64}$/u.test(signature) ||
                  !timingSafeEqual(
                    Buffer.from(signature),
                    Buffer.from(
                      mac(
                        `response-v3\n${nonce}\n${response.statusCode}\n${text}`,
                      ),
                    ),
                  )
                )
                  throw unavailable();
                if (response.statusCode !== 200) throw unavailable();
                resolve(JSON.parse(text));
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        const timer = setTimeout(() => request.destroy(unavailable()), 5000);
        request.once("close", () => clearTimeout(timer));
        request.on("error", reject);
        request.setTimeout(5000, () => request.destroy(unavailable()));
        sent = writing;
        request.end(bytes);
      });
      validate();
      if (digest(result.goalRef) !== digest(ref)) throw unavailable();
      return result;
    } catch {
      const error = unavailable();
      if (sent) {
        error.code = "CLI_GOAL_DRAFT_OUTCOME_UNKNOWN";
        error.outcomeUnknown = true;
      }
      throw error;
    }
  }
  async function read(id = ref.id) {
    if (id !== ref.id) throw unavailable();
    const result = await exchange("GET");
    exact(result, [
      "schema",
      "goalRef",
      "objective",
      "status",
      "grant",
      "sources",
    ]);
    if (
      result.schema !== "chainlesschain.project-goal-drafts/v1" ||
      typeof result.objective !== "string" ||
      result.objective.length > 4096 ||
      result.status !== "active" ||
      digest(result.grant) !== digest(grant)
    )
      throw unavailable();
    validateGoalDraftSources(result.sources);
    return { ...result, goalRef: ref };
  }
  async function sources(afterId) {
    const result = await exchange("POST", {
      operation: "sources",
      ...(afterId !== undefined ? { afterId } : {}),
    });
    exact(result, ["schema", "goalRef", "sources"]);
    if (result.schema !== "chainlesschain.goal-draft-sources/v1")
      throw unavailable();
    return validateGoalDraftSources(result.sources);
  }
  async function receipt({ requestId, inputDigest }) {
    const result = await exchange("POST", {
      operation: "receipt",
      requestId,
      inputDigest,
    });
    exact(result, ["schema", "goalRef", "receipt"]);
    if (result.schema !== "chainlesschain.goal-draft-receipt/v1")
      throw unavailable();
    const value = validateGoalDraftReceipt(result.receipt);
    if (value.requestId !== requestId || value.inputDigest !== inputDigest)
      throw unavailable();
    return value;
  }
  async function enqueue(raw) {
    const proposal = validateGoalDraftProposal(raw),
      inputDigest = digest(proposal);
    let received = false;
    try {
      const result = await exchange(
        "POST",
        { operation: "enqueue", proposal },
        true,
      );
      received = true;
      exact(result, ["schema", "goalRef", "receipt"]);
      if (result.schema !== "chainlesschain.goal-draft-submit/v1")
        throw unavailable();
      const value = validateGoalDraftReceipt(result.receipt);
      if (
        value.state !== "saved" ||
        value.requestId !== proposal.requestId ||
        value.inputDigest !== inputDigest
      )
        throw unavailable();
      return value;
    } catch (error) {
      // Once HTTP may have dispatched, an invalid/absent response is not proof
      // that no native draft was saved. Preserve this exact request identity.
      if (received || error.outcomeUnknown) {
        error.code = "CLI_GOAL_DRAFT_OUTCOME_UNKNOWN";
        error.outcomeUnknown = true;
      }
      throw error;
    }
  }
  validate();
  return Object.freeze({
    goalRef: ref,
    evidence: false,
    drafts: true,
    plugin: grant.plugin,
    declarationDigest: grant.declarationDigest,
    grantRef: Object.freeze({ ...descriptor.grantRef }),
    read,
    sources,
    enqueue,
    receipt,
  });
}
