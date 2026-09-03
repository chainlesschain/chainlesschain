import { types as utilTypes } from "node:util";

import {
  buildEvolutionWorkbenchBatchPlan,
  filterEvolutionWorkbenchProjection,
} from "./evolution-workbench-projection.js";
import {
  buildEvolutionWorkbenchRollbackPlan,
  compareEvolutionWorkbenchVersions,
} from "./evolution-workbench-version-control.js";

const HOSTS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function capture(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  ) {
    throw new TypeError(`${label}.${method}() is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function identity(value, tenantId) {
  if (
    value?.authenticated !== true ||
    value.durable !== true ||
    value.automated !== false ||
    value.tenantId !== tenantId ||
    typeof value.subjectId !== "string" ||
    value.subjectId.trim() === "" ||
    !DIGEST.test(value.receiptDigest ?? "")
  ) {
    throw new Error("Workbench CLI requires a durable human identity");
  }
  return value;
}

async function retainProjection(retain, projection) {
  const result = await retain({
    tenantId: projection.tenantId,
    projection,
  });
  if (
    result?.authenticated !== true ||
    result.durable !== true ||
    result.projectionDigest !== projection.projectionDigest
  ) {
    throw new Error("Workbench projection was not durably retained");
  }
}

export function createEvolutionWorkbenchCliHost({
  tenantId: tenantIdInput,
  projectionLoader,
  projectionAuthority,
  identityProvider,
  activeStateReader,
  batchExecutor,
  rollbackExecutor,
} = {}) {
  const tenantId = text(tenantIdInput, "tenantId");
  const loadProjection = capture(projectionLoader, "load", "projectionLoader");
  const retain = capture(projectionAuthority, "retain", "projectionAuthority");
  const resolveIdentity = capture(
    identityProvider,
    "current",
    "identityProvider",
  );
  const readActiveState = capture(
    activeStateReader,
    "read",
    "activeStateReader",
  );
  const executeBatch = capture(batchExecutor, "execute", "batchExecutor");
  const executeRollback = capture(
    rollbackExecutor,
    "execute",
    "rollbackExecutor",
  );

  async function projection() {
    const value = await loadProjection({ tenantId });
    filterEvolutionWorkbenchProjection(value, { limit: 1 });
    if (value.tenantId !== tenantId) {
      throw new Error("Workbench projection crossed its tenant boundary");
    }
    return value;
  }

  const host = Object.freeze({
    tenantId,
    async list(options = {}) {
      return filterEvolutionWorkbenchProjection(await projection(), options);
    },
    async compare(leftPacketDigest, rightPacketDigest) {
      return compareEvolutionWorkbenchVersions(await projection(), {
        leftPacketDigest: digest(leftPacketDigest, "left packet digest"),
        rightPacketDigest: digest(rightPacketDigest, "right packet digest"),
      });
    },
    async review({ packetDigests, decision, reason } = {}) {
      const current = await projection();
      const actor = identity(await resolveIdentity({ tenantId }), tenantId);
      const plan = buildEvolutionWorkbenchBatchPlan(current, {
        packetDigests,
        decision,
        reason,
        requestedBy: actor.subjectId,
      });
      await retainProjection(retain, current);
      return executeBatch(plan);
    },
    async rollback({ fromPacketDigest, toPacketDigest, reason } = {}) {
      const current = await projection();
      const actor = identity(await resolveIdentity({ tenantId }), tenantId);
      const from = current.candidates.find(
        ({ packetDigest }) => packetDigest === fromPacketDigest,
      );
      if (!from || from.actualUsage.active !== true) {
        throw new Error("Workbench rollback source is not active");
      }
      const active = await readActiveState({
        tenantId,
        skillName: current.skillName,
      });
      if (
        active?.authenticated !== true ||
        active.durable !== true ||
        active.tenantId !== tenantId ||
        active.skillName !== current.skillName ||
        active.contentDigest !== from.candidateContentDigest ||
        !DIGEST.test(active.stateDigest ?? "")
      ) {
        throw new Error("Workbench active state does not match the projection");
      }
      const plan = buildEvolutionWorkbenchRollbackPlan(current, {
        fromPacketDigest: digest(fromPacketDigest, "from packet digest"),
        toPacketDigest: digest(toPacketDigest, "to packet digest"),
        expectedActiveStateDigest: active.stateDigest,
        requestedBy: actor.subjectId,
        reason,
      });
      await retainProjection(retain, current);
      return executeRollback(plan);
    },
  });
  HOSTS.add(host);
  return host;
}

export function isEvolutionWorkbenchCliHost(value) {
  return HOSTS.has(value);
}
