import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import Ajv from "ajv";
import { describe, expect, it, vi } from "vitest";
import {
  CodexAppServerAdapter,
  CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
  isCodexAppServerVersionCompatible,
} from "../../src/lib/codex-app-server-adapter.js";

const fixtureUrl = (name) =>
  new URL(`../fixtures/external-agent/${name}`, import.meta.url);
const read = (name) => JSON.parse(readFileSync(fixtureUrl(name), "utf8"));
const fixture = read("codex-app-server-session.json");
const requestSchema = read("codex-app-server-0.157.1-request.schema.json");
const notificationSchema = read(
  "codex-app-server-0.157.1-notification.schema.json",
);
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const validators = new Map();
function assertOfficial(schema, message) {
  const key = `${schema.title}:${message.method}`;
  if (!validators.has(key)) {
    const branch = schema.oneOf.find((entry) =>
      entry.properties?.method?.enum?.includes(message.method),
    );
    expect(branch, `official method ${message.method}`).toBeDefined();
    validators.set(
      key,
      ajv.compile({
        $schema: schema.$schema,
        definitions: schema.definitions,
        ...branch,
      }),
    );
  }
  const validate = validators.get(key);
  expect(validate(message), JSON.stringify(validate.errors)).toBe(true);
}

describe("Codex 0.157.1 generated schema", () => {
  it("validates every known fixture notification against the unmodified official schema", () => {
    for (const event of fixture) {
      expect(event).not.toHaveProperty("jsonrpc");
      if (event.method === "future/telemetry") continue; // Deliberately unknown additive notification.
      assertOfficial(notificationSchema, event);
    }
  });

  it.each([
    ["item/started", "startedAtMs"],
    ["item/completed", "completedAtMs"],
    ["item/agentMessage/delta", "threadId"],
    ["item/agentMessage/delta", "turnId"],
    ["thread/tokenUsage/updated", "tokenUsage"],
  ])("rejects the incomplete %s shape missing %s", (method, property) => {
    const event = structuredClone(
      fixture.find((entry) => entry.method === method),
    );
    assertOfficial(notificationSchema, event);
    delete event.params[property];
    expect(() => assertOfficial(notificationSchema, event)).toThrow();
  });

  it("validates actual adapter requests and consumes schema-valid early notifications", async () => {
    const client = new EventEmitter();
    client.running = true;
    let requestId = 0;
    client.request = vi.fn(async (method, params) => {
      assertOfficial(requestSchema, { id: ++requestId, method, params });
      if (method === "thread/start") return fixture[0].params;
      for (const event of fixture) client.emit("notification", event);
      return structuredClone(
        fixture.find((event) => event.method === "turn/started").params,
      );
    });
    const fallback = vi.fn();
    const result = await new CodexAppServerAdapter({
      client,
      fallback,
      enabled: true,
      upstreamVersion: "0.157.1",
      // Probe-only override; schema agreement does not change production admission.
      compatibilityMatrix: [{ version: "0.157.1" }],
    }).execute({ prompt: "official schema fixture" });
    expect(result).toMatchObject({
      terminal: "completed",
      output: "App Server result",
      fallback: false,
      unknownMethods: ["future/telemetry"],
    });
    expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 4 });
    expect(client.request.mock.calls.map(([method]) => method)).toEqual([
      "thread/start",
      "turn/start",
    ]);
    expect(fallback).not.toHaveBeenCalled();
    expect(client.listenerCount("notification")).toBe(0);
    expect(
      isCodexAppServerVersionCompatible(
        "0.157.1",
        CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
      ),
    ).toBe(false);
  });
});
