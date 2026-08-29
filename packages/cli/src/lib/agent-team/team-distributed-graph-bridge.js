import path from "node:path";
import { createHash } from "node:crypto";
import { createRolloutStore } from "../app-server/rollout-store-factory.js";

export const TEAM_DISTRIBUTED_GRAPH_BRIDGE_SCHEMA =
  "chainlesschain.team-distributed-graph-bridge/v1";

// Keep every derived thread/idempotency key inside the RolloutStore contract's
// bounds after this adapter adds its domain prefix.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const REQUEST_TYPES = new Set(["dispatch", "settle", "cancel"]);

function bridgeError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "TeamDistributedGraphBridgeError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function digest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stable(value))}`, "utf8")
    .digest("hex")}`;
}

function identifier(value, label) {
  const output = String(value || "").trim();
  if (!ID.test(output)) {
    throw bridgeError(
      "CC_TEAM_DISTRIBUTED_GRAPH_BRIDGE_INVALID",
      `${label} is invalid`,
    );
  }
  return output;
}

function requestProjection(record) {
  return Object.freeze({
    ...clone(record.payload),
    seq: record.event_seq,
    timestamp: record.timestamp,
    hash: record.hash,
  });
}

export class TeamDistributedGraphBridge {
  constructor({
    directory,
    queueId,
    runId,
    now = Date.now,
    store = null,
  } = {}) {
    if (!directory) {
      throw new TypeError("distributed Graph bridge directory is required");
    }
    this.directory = path.resolve(directory);
    this.queueId = identifier(queueId, "queueId");
    this.runId = identifier(runId, "runId");
    this.threadId = identifier(`team-graph-bridge:${this.queueId}`, "threadId");
    this.store =
      store || createRolloutStore({ directory: this.directory, now });
    const thread = this.store.start({
      threadId: this.threadId,
      title: `Distributed Team Graph bridge ${this.queueId}`,
      metadata: {
        schema: TEAM_DISTRIBUTED_GRAPH_BRIDGE_SCHEMA,
        queueId: this.queueId,
        runId: this.runId,
      },
    });
    if (
      thread.metadata?.schema !== TEAM_DISTRIBUTED_GRAPH_BRIDGE_SCHEMA ||
      thread.metadata?.queueId !== this.queueId ||
      thread.metadata?.runId !== this.runId
    ) {
      throw bridgeError(
        "CC_TEAM_DISTRIBUTED_GRAPH_BRIDGE_CORRUPT",
        "distributed Graph bridge identity does not match its durable journal",
      );
    }
  }

  static directoryForState(statePath) {
    return `${path.resolve(statePath)}.graph-bridge`;
  }

  request({ requestId, type, taskKey, workerId, lease, payload = {} } = {}) {
    const id = identifier(requestId, "requestId");
    const requestType = String(type || "");
    if (!REQUEST_TYPES.has(requestType)) {
      throw bridgeError(
        "CC_TEAM_DISTRIBUTED_GRAPH_BRIDGE_INVALID",
        `unsupported distributed Graph request type: ${requestType}`,
      );
    }
    const binding = {
      schema: TEAM_DISTRIBUTED_GRAPH_BRIDGE_SCHEMA,
      requestId: id,
      type: requestType,
      queueId: this.queueId,
      runId: this.runId,
      taskKey: identifier(taskKey, "taskKey"),
      workerId: identifier(workerId, "workerId"),
      lease: {
        holder: identifier(lease?.holder, "lease.holder"),
        leaseId: identifier(lease?.leaseId, "lease.leaseId"),
        fencingToken: Number(lease?.fencingToken),
      },
      payload: clone(payload),
    };
    if (
      !Number.isSafeInteger(binding.lease.fencingToken) ||
      binding.lease.fencingToken < 1
    ) {
      throw bridgeError(
        "CC_TEAM_DISTRIBUTED_GRAPH_BRIDGE_INVALID",
        "lease.fencingToken must be a positive safe integer",
      );
    }
    const requestDigest = digest(
      binding,
      "cc.team.distributed-graph-request/v1",
    );
    const record = this.store.append({
      threadId: this.threadId,
      eventType: "team.graph.request",
      idempotencyKey: `request:${id}`,
      payload: { ...binding, requestDigest },
    });
    return requestProjection(record);
  }

  respond(
    request,
    { status, graphAuthority = null, result = null, error = null } = {},
  ) {
    const responseStatus = String(status || "");
    if (!["applied", "rejected"].includes(responseStatus)) {
      throw bridgeError(
        "CC_TEAM_DISTRIBUTED_GRAPH_BRIDGE_INVALID",
        "response status must be applied or rejected",
      );
    }
    const id = identifier(request?.requestId, "requestId");
    const response = {
      schema: TEAM_DISTRIBUTED_GRAPH_BRIDGE_SCHEMA,
      requestId: id,
      requestDigest: String(request?.requestDigest || ""),
      status: responseStatus,
      graphAuthority: clone(graphAuthority),
      result: clone(result),
      error:
        error == null
          ? null
          : {
              code: error?.code || "CC_TEAM_DISTRIBUTED_GRAPH_REJECTED",
              message: error?.message || String(error),
            },
    };
    const record = this.store.append({
      threadId: this.threadId,
      eventType: "team.graph.response",
      idempotencyKey: `response:${id}`,
      payload: response,
    });
    return requestProjection(record);
  }

  snapshot() {
    const records = this.store.read(this.threadId, { limit: 100_000 });
    const requests = new Map();
    const responses = new Map();
    for (const record of records) {
      if (record.event_type === "team.graph.request") {
        const request = requestProjection(record);
        requests.set(request.requestId, request);
      } else if (record.event_type === "team.graph.response") {
        const response = requestProjection(record);
        const request = requests.get(response.requestId);
        if (!request || response.requestDigest !== request.requestDigest) {
          throw bridgeError(
            "CC_TEAM_DISTRIBUTED_GRAPH_BRIDGE_CORRUPT",
            `response is not bound to its exact request: ${response.requestId}`,
          );
        }
        responses.set(response.requestId, response);
      }
    }
    return Object.freeze({
      schema: TEAM_DISTRIBUTED_GRAPH_BRIDGE_SCHEMA,
      queueId: this.queueId,
      runId: this.runId,
      revision: records.at(-1)?.event_seq || 0,
      head: records.at(-1)?.hash || null,
      requests: Object.freeze([...requests.values()]),
      responses: Object.freeze([...responses.values()]),
    });
  }

  pending() {
    const snapshot = this.snapshot();
    const responded = new Set(
      snapshot.responses.map((response) => response.requestId),
    );
    return snapshot.requests.filter(
      (request) => !responded.has(request.requestId),
    );
  }

  response(requestId) {
    const id = identifier(requestId, "requestId");
    return (
      this.snapshot().responses.find((response) => response.requestId === id) ||
      null
    );
  }

  async waitForResponse(
    requestId,
    { timeoutMs = 30_000, pollMs = 25, sleep = null } = {},
  ) {
    const id = identifier(requestId, "requestId");
    const startedAt = Date.now();
    const wait =
      typeof sleep === "function"
        ? sleep
        : (milliseconds) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds));
    for (;;) {
      const response = this.response(id);
      if (response) return response;
      if (Date.now() - startedAt >= timeoutMs) {
        throw bridgeError(
          "CC_TEAM_DISTRIBUTED_GRAPH_RESPONSE_TIMEOUT",
          `timed out waiting for canonical Graph response: ${id}`,
        );
      }
      await wait(pollMs);
    }
  }
}
