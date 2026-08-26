import { describe, expect, it } from "vitest";

const ExtendedTools9 = require("../../../src/main/ai-engine/extended-tools-9.js");

describe("ExtendedTools9 backlog bounds", () => {
  it("retains a bounded MQTT history", async () => {
    const tools = new Map();
    ExtendedTools9.registerAll({
      registerTool(name, handler) {
        tools.set(name, handler);
      },
    });
    const mqtt = tools.get("mqtt_broker");

    for (let sequence = 0; sequence < 1005; sequence += 1) {
      await mqtt({ action: "publish", topic: "audit", message: { sequence } });
    }

    const status = await mqtt({ action: "status" });
    expect(status.queued_message_count).toBe(1000);
    expect(status.max_queued_messages).toBe(1000);
    expect(status.messages).toHaveLength(10);
    expect(status.messages.at(-1).payload.sequence).toBe(1004);
  });
});
