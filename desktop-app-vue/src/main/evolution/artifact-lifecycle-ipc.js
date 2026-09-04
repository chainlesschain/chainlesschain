"use strict";

const { ipcMain } = require("electron");
const {
  ARTIFACT_TYPE,
  isEvolvableArtifactLifecycleProducer,
} = require("@chainlesschain/session-core/evolvable-artifact");

const TYPE_PREFIX = Object.freeze({
  [ARTIFACT_TYPE.SKILL]: "Skill",
  [ARTIFACT_TYPE.PROMPT]: "Prompt",
  [ARTIFACT_TYPE.HOOK]: "Hook",
});

function exactInput(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== fields.length ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !fields.includes(key),
    )
  ) {
    throw new TypeError("artifact lifecycle request is invalid");
  }
  for (const field of fields) {
    if (
      typeof value[field] !== "string" ||
      value[field].length === 0 ||
      value[field].length > 256 ||
      value[field].trim() !== value[field]
    ) {
      throw new TypeError("artifact lifecycle request is invalid");
    }
  }
  return value;
}

function registerArtifactLifecycleIPC(dependencies = {}) {
  const hostIpcMain = dependencies.ipcMain || ipcMain;
  if (!hostIpcMain || typeof hostIpcMain.handle !== "function") {
    throw new TypeError("artifact lifecycle IPC requires ipcMain.handle");
  }
  const producers = new Map();
  for (const [type, prefix] of Object.entries(TYPE_PREFIX)) {
    const producer =
      dependencies[`evolvableArtifact${prefix}LifecycleProducer`] || null;
    if (
      producer !== null &&
      !isEvolvableArtifactLifecycleProducer(producer, type)
    ) {
      throw new TypeError(
        `artifact lifecycle IPC received invalid ${type} producer`,
      );
    }
    if (producer) {
      producers.set(type, producer);
    }
  }

  function producerFor(type) {
    if (!Object.hasOwn(TYPE_PREFIX, type)) {
      throw new TypeError("artifact lifecycle type is invalid");
    }
    const producer = producers.get(type);
    if (!producer) {
      const error = new Error(`${type} lifecycle producer is unavailable`);
      error.code = "CC_ARTIFACT_LIFECYCLE_PRODUCER_UNAVAILABLE";
      throw error;
    }
    return producer;
  }

  hostIpcMain.handle("evolution-artifact:promote", async (_event, input) => {
    const request = exactInput(input, ["type", "artifactId", "candidateId"]);
    const result = await producerFor(request.type).promote(request);
    return {
      type: request.type,
      artifactId: result.active.artifactId,
      candidateId: result.active.artifact.candidate.candidateId,
      releaseId: result.active.releaseId,
      contentDigest: result.active.contentDigest,
      artifactDigest: result.active.artifactDigest,
      transitionReceipt: result.transition.receipt,
      recovered: result.transition.recovered,
    };
  });

  hostIpcMain.handle("evolution-artifact:revalidate", async (_event, input) => {
    const request = exactInput(input, ["type", "artifactId"]);
    const result = await producerFor(request.type).revalidate(request);
    return {
      type: request.type,
      artifactId: result.artifact.artifactId,
      candidateId: result.artifact.candidate.candidateId,
      contentDigest: result.artifact.contentDigest,
      artifactDigest: result.artifact.artifactDigest,
      persistenceReceipt: result.receipt,
    };
  });
}

module.exports = { registerArtifactLifecycleIPC };
