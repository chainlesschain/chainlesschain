import { readFileSync } from "node:fs";
import { validate } from "../json-schema-validate.js";

const schema = JSON.parse(
  readFileSync(
    new URL("../../generated/cc-agent-protocol.schema.json", import.meta.url),
    "utf8",
  ),
);

export const APP_SERVER_PROTOCOL_VERSION = schema["x-cc-protocol"].version;
export const APP_SERVER_MIN_PROTOCOL_VERSION =
  schema["x-cc-protocol"].minimumCompatibleVersion;
export const APP_SERVER_FEATURES = Object.freeze([
  ...schema["x-cc-protocol"].features,
]);
export const APP_SERVER_SCHEMA = schema;

export const JSON_RPC_ERROR = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  OVERLOADED: -32001,
  NOT_INITIALIZED: -32002,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  INTERRUPTED: -32010,
});

export class JsonRpcError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

export function validateAppServerMessage(value) {
  const result = validate(value, APP_SERVER_SCHEMA);
  return Object.freeze({
    ok: result.valid,
    errors: Object.freeze(
      result.errors.map((error) =>
        Object.freeze({
          path: error.instancePath || error.schemaPath || "#",
          message: error.message || error.code || "invalid message",
        }),
      ),
    ),
  });
}

export function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result: result ?? null };
}

export function rpcError(id, error) {
  const code = Number.isInteger(error?.code)
    ? error.code
    : JSON_RPC_ERROR.INTERNAL_ERROR;
  const output = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message:
        code === JSON_RPC_ERROR.INTERNAL_ERROR
          ? "Internal App Server error"
          : String(error?.message || "Request failed").slice(0, 4096),
    },
  };
  if (error?.data != null) output.error.data = error.data;
  return output;
}

export function rpcNotification(method, params) {
  return { jsonrpc: "2.0", method, params: params ?? null };
}

export function negotiateProtocol(params = {}) {
  const clientMax = Number(params.protocolVersion);
  const clientMin = Number(params.minimumProtocolVersion);
  if (
    !Number.isSafeInteger(clientMax) ||
    !Number.isSafeInteger(clientMin) ||
    clientMin > clientMax
  ) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.INVALID_PARAMS,
      "initialize requires a valid protocol version range",
    );
  }
  const minimum = Math.max(clientMin, APP_SERVER_MIN_PROTOCOL_VERSION);
  const maximum = Math.min(clientMax, APP_SERVER_PROTOCOL_VERSION);
  if (minimum > maximum) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.INVALID_PARAMS,
      "client and server protocol ranges do not overlap",
      {
        client: { minimum: clientMin, maximum: clientMax },
        server: {
          minimum: APP_SERVER_MIN_PROTOCOL_VERSION,
          maximum: APP_SERVER_PROTOCOL_VERSION,
        },
      },
    );
  }
  const requested = Array.isArray(params.features)
    ? new Set(params.features.map(String))
    : null;
  const features = requested
    ? APP_SERVER_FEATURES.filter((feature) => requested.has(feature))
    : [...APP_SERVER_FEATURES];
  return Object.freeze({
    protocolVersion: maximum,
    minimumProtocolVersion: APP_SERVER_MIN_PROTOCOL_VERSION,
    features: Object.freeze(features),
    downgraded:
      maximum !== APP_SERVER_PROTOCOL_VERSION ||
      features.length !== APP_SERVER_FEATURES.length,
  });
}
