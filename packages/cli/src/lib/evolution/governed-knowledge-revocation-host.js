import { isGovernedKnowledgeSync } from "./governed-knowledge-sync.js";

const HOSTS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

export function createGovernedKnowledgeRevocationHost({ sync } = {}) {
  if (!isGovernedKnowledgeSync(sync)) {
    throw new TypeError("a branded governed Knowledge sync is required");
  }
  const host = Object.freeze({
    async prepare(record) {
      const planned = await sync.planRevocation(record);
      return freeze({
        authenticated: true,
        durable: true,
        operationDigest: planned.operationDigest,
        inventoryDigest: planned.inventory.inventoryDigest,
        knowledge: clone(planned.knowledge),
      });
    },
    async publish({ operationDigest } = {}) {
      if (!DIGEST.test(operationDigest ?? "")) {
        throw new TypeError("revocation operationDigest is invalid");
      }
      const planned = await sync.recoverPlannedRevocation({ operationDigest });
      const result = await sync.publishPlanned(planned, {
        operationId: `knowledge-revocation:${operationDigest.slice(7)}`,
      });
      return freeze({
        authenticated: true,
        durable: true,
        recoveredPlan: true,
        operationDigest,
        envelopeDigest: result.envelope.envelopeDigest,
        knowledgeId: planned.knowledge.knowledgeId,
        contentDigest: planned.knowledge.contentDigest,
        dependencyCount: planned.knowledge.dependencies.length,
      });
    },
  });
  HOSTS.add(host);
  return host;
}

export function isGovernedKnowledgeRevocationHost(value) {
  return HOSTS.has(value);
}
