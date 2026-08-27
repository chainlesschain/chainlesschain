import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BROADCAST_LIMITS,
  HARD_BROADCAST_LIMITS,
  broadcastMessage,
  closeBroadcastChannelInPage,
  createBroadcastChannel,
  createBroadcastChannelInPage,
  createBroadcastLimits,
  listBroadcastChannelsInPage,
  validateBroadcastChannelName,
  validateBroadcastMessage,
} from "../../../../../src/main/remote/browser-extension/handlers/broadcast.js";

class FakeBroadcastChannel {
  static instances = [];

  constructor(name) {
    this.name = name;
    this.closed = false;
    this.onmessage = null;
    this.postedMessages = [];
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(message) {
    this.postedMessages.push(message);
  }

  close() {
    this.closed = true;
  }

  receive(data) {
    this.onmessage?.({ data });
  }
}

function stubChromeExecution() {
  const executeScript = vi.fn(async ({ func, args = [] }) => [
    { result: await func(...args) },
  ]);
  vi.stubGlobal("chrome", { scripting: { executeScript } });
  return executeScript;
}

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BroadcastChannel boundaries", () => {
  it("uses finite defaults and clamps configured limits to hard ceilings", () => {
    expect(createBroadcastLimits()).toEqual(DEFAULT_BROADCAST_LIMITS);
    expect(
      createBroadcastLimits(
        Object.fromEntries(
          Object.keys(HARD_BROADCAST_LIMITS).map((key) => [
            key,
            Number.MAX_SAFE_INTEGER,
          ]),
        ),
      ),
    ).toEqual(HARD_BROADCAST_LIMITS);
  });

  it("validates channel names and JSON message bytes", () => {
    expect(validateBroadcastChannelName("", 8)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(validateBroadcastChannelName("你好", 4)).toMatchObject({
      code: "OVERLOADED",
      scope: "broadcast_name",
    });
    expect(validateBroadcastMessage("你好", 8).accepted).toBe(true);
    expect(validateBroadcastMessage("你好", 7)).toMatchObject({
      code: "OVERLOADED",
      scope: "broadcast_message",
    });
    const circular = {};
    circular.self = circular;
    expect(validateBroadcastMessage(circular, 1024)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("bounds channels plus retained message count and bytes in the page", () => {
    const limits = createBroadcastLimits({
      maxChannelsPerPage: 2,
      maxMessagesPerChannel: 2,
      maxMessageBytes: 8,
      maxRetainedBytesPerChannel: 10,
    });
    expect(createBroadcastChannelInPage("one", limits).success).toBe(true);
    expect(createBroadcastChannelInPage("two", limits).success).toBe(true);
    expect(createBroadcastChannelInPage("three", limits)).toMatchObject({
      code: "OVERLOADED",
      scope: "broadcast_channels",
    });

    const channel = FakeBroadcastChannel.instances[0];
    channel.receive("aaaa");
    channel.receive("bb");
    channel.receive("cc");
    channel.receive("xxxxxxxx");

    expect(listBroadcastChannelsInPage()).toEqual({
      channels: [
        {
          name: "one",
          messageCount: 2,
          retainedBytes: 8,
          droppedMessages: 2,
        },
        {
          name: "two",
          messageCount: 0,
          retainedBytes: 0,
          droppedMessages: 0,
        },
      ],
    });
  });

  it("clears retained state and listeners when a page channel closes", () => {
    const limits = createBroadcastLimits();
    createBroadcastChannelInPage("close-me", limits);
    const channel = FakeBroadcastChannel.instances[0];
    const payload = { nested: { value: "retained" } };
    channel.receive(payload);
    payload.nested.value = "mutated";
    expect(
      window.__chainlessBroadcastChannels.get("close-me").messages[0].data
        .nested.value,
    ).toBe("retained");

    expect(closeBroadcastChannelInPage("close-me")).toEqual({ success: true });
    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
    expect(listBroadcastChannelsInPage()).toEqual({ channels: [] });
  });

  it("rejects oversized service inputs before invoking Chrome", async () => {
    const executeScript = stubChromeExecution();
    await expect(
      createBroadcastChannel(7, "x".repeat(129)),
    ).resolves.toMatchObject({
      code: "OVERLOADED",
      scope: "broadcast_name",
    });
    await expect(
      broadcastMessage(7, "channel", "x".repeat(64 * 1024)),
    ).resolves.toMatchObject({
      code: "OVERLOADED",
      scope: "broadcast_message",
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("executes self-contained page functions through Chrome scripting", async () => {
    const executeScript = stubChromeExecution();
    await expect(createBroadcastChannel(8, "channel")).resolves.toMatchObject({
      success: true,
      channelName: "channel",
    });
    await expect(broadcastMessage(8, "channel", { ok: true })).resolves.toEqual(
      { success: true },
    );
    expect(FakeBroadcastChannel.instances[0].postedMessages).toEqual([
      { ok: true },
    ]);
    expect(executeScript).toHaveBeenCalledTimes(2);
  });
});
