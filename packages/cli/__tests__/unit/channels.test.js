import { describe, it, expect, vi } from "vitest";
import {
  parseChannelSpecs,
  formatChannelEvent,
  startChannels,
} from "../../src/lib/channels/channel-manager.js";
import { startWebhookChannel } from "../../src/lib/channels/webhook-channel.js";
import { startTelegramChannel } from "../../src/lib/channels/telegram-channel.js";

describe("channel-manager", () => {
  it("parses channel specs with optional args", () => {
    expect(parseChannelSpecs("webhook")).toEqual([
      { kind: "webhook", arg: null },
    ]);
    expect(parseChannelSpecs("webhook:18999,telegram")).toEqual([
      { kind: "webhook", arg: "18999" },
      { kind: "telegram", arg: null },
    ]);
    expect(() => parseChannelSpecs("carrier-pigeon")).toThrow(
      /Unknown channel/,
    );
  });

  it("formats events with provenance and neutralizes slash/shell prefixes", () => {
    expect(
      formatChannelEvent({ channel: "webhook", sender: "ci", text: "done" }),
    ).toBe("[channel:webhook from ci] done");
    // a hostile sender cannot make the injected line start with / or !
    const out = formatChannelEvent({
      channel: "telegram",
      sender: "123",
      text: "/exit",
    });
    expect(out.startsWith("[channel:")).toBe(true);
    expect(out).toContain("/exit"); // content survives, prefix defuses it
  });

  it("starts requested channels via injected starters and stops them all", async () => {
    const stops = { webhook: vi.fn(), telegram: vi.fn() };
    const handle = await startChannels("webhook,telegram", {
      onEvent: () => {},
      config: {},
      deps: {
        webhook: {
          startWebhookChannel: async () => ({
            describe: "webhook fake",
            stop: stops.webhook,
          }),
        },
        telegram: {
          startTelegramChannel: async () => ({
            describe: "telegram fake",
            stop: stops.telegram,
          }),
        },
      },
    });
    expect(handle.channels.map((c) => c.kind)).toEqual(["webhook", "telegram"]);
    handle.stop();
    expect(stops.webhook).toHaveBeenCalled();
    expect(stops.telegram).toHaveBeenCalled();
  });

  it("stops already-started channels when a later one fails to start", async () => {
    const webhookStop = vi.fn();
    await expect(
      startChannels("webhook,telegram", {
        onEvent: () => {},
        config: {},
        deps: {
          webhook: {
            startWebhookChannel: async () => ({
              describe: "ok",
              stop: webhookStop,
            }),
          },
          telegram: {
            startTelegramChannel: async () => {
              throw new Error("no bot token");
            },
          },
        },
      }),
    ).rejects.toThrow(/no bot token/);
    expect(webhookStop).toHaveBeenCalled();
  });
});

describe("webhook channel", () => {
  async function post(url, { token, body }) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it("accepts an authenticated event and rejects bad auth", async () => {
    const events = [];
    const handle = await startWebhookChannel({
      port: 0, // ephemeral
      token: "secret-token",
      onEvent: (e) => events.push(e),
    });
    try {
      const ok = await post(handle.url, {
        token: "secret-token",
        body: { text: "deploy finished", sender: "ci" },
      });
      expect(ok.status).toBe(202);
      expect(events).toEqual([
        expect.objectContaining({
          channel: "webhook",
          sender: "ci",
          text: "deploy finished",
        }),
      ]);

      const noAuth = await post(handle.url, {
        body: { text: "sneaky" },
      });
      expect(noAuth.status).toBe(401);
      const badAuth = await post(handle.url, {
        token: "wrong",
        body: { text: "sneaky" },
      });
      expect(badAuth.status).toBe(401);
      expect(events).toHaveLength(1);
    } finally {
      await handle.stop();
    }
  });

  it("enforces the sender allowlist and input validation", async () => {
    const events = [];
    const handle = await startWebhookChannel({
      port: 0,
      token: "t",
      allowlist: ["ci"],
      onEvent: (e) => events.push(e),
    });
    try {
      const denied = await post(handle.url, {
        token: "t",
        body: { text: "hello", sender: "stranger" },
      });
      expect(denied.status).toBe(403);

      const noText = await post(handle.url, {
        token: "t",
        body: { sender: "ci" },
      });
      expect(noText.status).toBe(400);

      const allowed = await post(handle.url, {
        token: "t",
        body: { text: "hello", sender: "ci" },
      });
      expect(allowed.status).toBe(202);
      expect(events).toHaveLength(1);
    } finally {
      await handle.stop();
    }
  });

  it("generates a token when none is configured", async () => {
    const logs = [];
    const handle = await startWebhookChannel({
      port: 0,
      onEvent: () => {},
      log: (m) => logs.push(m),
    });
    try {
      expect(handle.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(logs.join(" ")).toContain("generated token");
    } finally {
      await handle.stop();
    }
  });

  it("refuses a non-loopback bind without allowExternal", async () => {
    await expect(
      startWebhookChannel({ host: "0.0.0.0", token: "t", onEvent: () => {} }),
    ).rejects.toThrow(/allowExternal/);
  });
});

describe("telegram channel", () => {
  function updatesFetch(batches) {
    let call = 0;
    return vi.fn(async (url, opts) => {
      if (String(url).includes("getUpdates")) {
        const result = batches[call] || [];
        call++;
        return {
          status: 200,
          json: async () => ({ ok: true, result }),
        };
      }
      return {
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
        _body: opts?.body,
      };
    });
  }

  it("requires a bot token and a non-empty allowlist (fail closed)", async () => {
    await expect(
      startTelegramChannel({ onEvent: () => {}, allowFrom: ["1"] }),
    ).rejects.toThrow(/bot token/);
    await expect(
      startTelegramChannel({ botToken: "b", onEvent: () => {} }),
    ).rejects.toThrow(/allowFrom/);
  });

  it("delivers only allowlisted chats' messages and advances the offset", async () => {
    const events = [];
    const fetchImpl = updatesFetch([
      [
        {
          update_id: 10,
          message: { chat: { id: 111 }, text: "from allowed" },
        },
        {
          update_id: 11,
          message: { chat: { id: 222 }, text: "from stranger" },
        },
      ],
    ]);
    const handle = await startTelegramChannel({
      botToken: "b",
      allowFrom: [111],
      onEvent: (e) => events.push(e),
      fetchImpl,
      pollTimeoutS: 0,
      pollPauseMs: 5,
    });
    // long enough for at least two poll iterations (pause is 5ms)
    await new Promise((r) => setTimeout(r, 60));
    await handle.stop();
    expect(events).toEqual([
      expect.objectContaining({
        channel: "telegram",
        sender: "111",
        text: "from allowed",
      }),
    ]);
    // second poll carried the advanced offset (update_id 11 + 1)
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(secondBody.offset).toBe(12);
  });

  it("reply() posts sendMessage back to the event's chat", async () => {
    const fetchImpl = updatesFetch([]);
    const handle = await startTelegramChannel({
      botToken: "b",
      allowFrom: [111],
      onEvent: () => {},
      fetchImpl,
      pollTimeoutS: 0,
    });
    await handle.reply({ sender: "111" }, "done!");
    await handle.stop();
    const sendCall = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes("sendMessage"),
    );
    expect(sendCall).toBeTruthy();
    expect(JSON.parse(sendCall[1].body)).toMatchObject({
      chat_id: "111",
      text: "done!",
    });
  });
});
