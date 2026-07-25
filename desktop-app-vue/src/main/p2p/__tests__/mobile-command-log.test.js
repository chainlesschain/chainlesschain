"use strict";

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { summarizeMobileCommandMessage } = require("../mobile-command-log.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN_ENTRY = path.resolve(HERE, "../../index.js");

describe("mobile command log summary", () => {
  it("records only routing metadata for string payloads", () => {
    const secrets = [
      "sid=runtime-cookie-secret",
      "runtime-account-alias",
      "runtime-url-token",
    ];
    const payload = JSON.stringify({
      id: "request-1",
      method: "personal-data-hub.sync-adapter",
      params: {
        options: {
          cookie: secrets[0],
          accountId: secrets[1],
          sourceUrl: `https://api.xiaojukeji.com/orders?token=${secrets[2]}`,
        },
      },
    });

    const summary = summarizeMobileCommandMessage({
      type: "chainlesschain:command:request",
      payload,
    });
    const logged = JSON.stringify(summary);

    expect(summary).toEqual({
      type: "chainlesschain:command:request",
      hasPayload: true,
      payloadFormat: "string",
      payloadBytes: Buffer.byteLength(payload, "utf8"),
    });
    for (const secret of secrets) {
      expect(logged).not.toContain(secret);
    }
  });

  it("does not inspect nested object payloads or log attacker-controlled types", () => {
    const secret = "nested-runtime-secret";
    const cyclic = { cookie: secret };
    cyclic.self = cyclic;

    expect(
      JSON.stringify(
        summarizeMobileCommandMessage({
          type: `invalid type ${secret}`,
          payload: cyclic,
        }),
      ),
    ).toBe(
      JSON.stringify({
        type: "[invalid]",
        hasPayload: true,
        payloadFormat: "object",
        payloadBytes: null,
      }),
    );
  });

  it("keeps the Electron mobile-command log boundary on the safe summary", () => {
    const source = fs.readFileSync(MAIN_ENTRY, "utf8");
    expect(source).toContain(
      "const messageLogSummary = summarizeMobileCommandMessage(message)",
    );
    expect(source).not.toContain("JSON.stringify(message).slice");
    expect(source).not.toContain(
      'logger.warn("[Main] 移动端消息格式无效:", message)',
    );
  });
});
