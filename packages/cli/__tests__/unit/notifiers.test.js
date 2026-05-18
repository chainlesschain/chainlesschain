/**
 * Unit tests: notifiers
 * Tests TelegramNotifier, WeComNotifier, DingTalkNotifier, FeishuNotifier,
 * WebSocketNotifier, NotificationManager, and incoming parsers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TelegramNotifier } from "../../src/lib/notifiers/telegram.js";
import { WeComNotifier } from "../../src/lib/notifiers/wecom.js";
import { DingTalkNotifier } from "../../src/lib/notifiers/dingtalk.js";
import { FeishuNotifier } from "../../src/lib/notifiers/feishu.js";
import { WebSocketNotifier } from "../../src/lib/notifiers/websocket.js";
import {
  NotificationManager,
  parseDingTalkIncoming,
  parseFeishuIncoming,
  parseWeComIncoming,
} from "../../src/lib/notifiers/index.js";

// ─── Mock fetch ───────────────────────────────────────────────────

function mockFetch(response = { ok: true, data: {} }) {
  return vi.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(response.data || {}),
      ok: response.ok !== false,
    }),
  );
}

// ─── TelegramNotifier ─────────────────────────────────────────────

describe("TelegramNotifier", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("isConfigured is false without token+chatId", () => {
    const n = new TelegramNotifier({});
    expect(n.isConfigured).toBe(false);
  });

  it("isConfigured is true with token and chatId", () => {
    const n = new TelegramNotifier({ token: "tok", chatId: "123" });
    expect(n.isConfigured).toBe(true);
  });

  it("send() returns not configured when missing config", async () => {
    const n = new TelegramNotifier({});
    const result = await n.send("hello");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not configured");
  });

  it("send() calls Telegram API with correct payload", async () => {
    globalThis.fetch = mockFetch({ data: { ok: true } });
    const n = new TelegramNotifier({ token: "T123", chatId: "C456" });
    const result = await n.send("<b>Test</b>");
    expect(result.ok).toBe(true);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("T123");
    expect(url).toContain("sendMessage");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("C456");
    expect(body.text).toBe("<b>Test</b>");
    expect(body.parse_mode).toBe("HTML");
  });

  it("notifySuccess() sends formatted message", async () => {
    globalThis.fetch = mockFetch({ data: { ok: true } });
    const n = new TelegramNotifier({ token: "T", chatId: "C" });
    await n.notifySuccess({
      taskId: "t1",
      description: "Fix bug",
      agentCount: 2,
      duration: 120000,
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.text).toContain("CI Passed");
    expect(body.text).toContain("Fix bug");
    expect(body.text).toContain("2m");
    expect(body.text).toContain("t1");
  });

  it("notifyFailure() includes error preview and retry number", async () => {
    globalThis.fetch = mockFetch({ data: { ok: true } });
    const n = new TelegramNotifier({ token: "T", chatId: "C" });
    await n.notifyFailure({
      taskId: "t2",
      description: "Fix",
      errors: ["Error: foo"],
      retryNumber: 2,
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.text).toContain("CI Failed");
    expect(body.text).toContain("retry #2");
    expect(body.text).toContain("Error: foo");
  });

  it("notifyStart() sends start message", async () => {
    globalThis.fetch = mockFetch({ data: { ok: true } });
    const n = new TelegramNotifier({ token: "T", chatId: "C" });
    await n.notifyStart({
      taskId: "t3",
      description: "Deploy",
      subtaskCount: 3,
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.text).toContain("Orchestration Started");
    expect(body.text).toContain("3");
  });

  it("handles fetch error gracefully", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("Network error")));
    const n = new TelegramNotifier({ token: "T", chatId: "C" });
    const result = await n.send("test");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Network error");
  });
});

// ─── WeComNotifier ────────────────────────────────────────────────

describe("WeComNotifier", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("isConfigured is false without webhook", () => {
    const n = new WeComNotifier({});
    expect(n.isConfigured).toBe(false);
  });

  it("isConfigured is true with webhook URL", () => {
    const n = new WeComNotifier({
      webhookUrl: "https://qyapi.weixin.qq.com/...",
    });
    expect(n.isConfigured).toBe(true);
  });

  it("send() posts markdown to webhook", async () => {
    globalThis.fetch = mockFetch({ data: { errcode: 0 } });
    const n = new WeComNotifier({ webhookUrl: "https://qyapi.test/hook" });
    const result = await n.send("## Hello");
    expect(result.ok).toBe(true);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://qyapi.test/hook");
    const body = JSON.parse(opts.body);
    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.content).toBe("## Hello");
  });

  it("notifySuccess() includes task info", async () => {
    globalThis.fetch = mockFetch({ data: { errcode: 0 } });
    const n = new WeComNotifier({ webhookUrl: "https://test/hook" });
    await n.notifySuccess({
      taskId: "t1",
      description: "Fix",
      agentCount: 1,
      duration: 60000,
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.markdown.content).toContain("CI 通过");
    expect(body.markdown.content).toContain("Fix");
  });
});

// ─── DingTalkNotifier ─────────────────────────────────────────────

describe("DingTalkNotifier", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("isConfigured is true with webhook URL", () => {
    const n = new DingTalkNotifier({
      webhookUrl: "https://oapi.dingtalk.com/...",
    });
    expect(n.isConfigured).toBe(true);
  });

  it("send() posts markdown message", async () => {
    globalThis.fetch = mockFetch({ data: { errcode: 0 } });
    const n = new DingTalkNotifier({ webhookUrl: "https://oapi.test/robot" });
    const result = await n.send("CI 通过", "## CI 通过\n详情");
    expect(result.ok).toBe(true);
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.title).toBe("CI 通过");
    expect(body.markdown.text).toContain("详情");
  });

  it("_signedUrl() appends timestamp and sign when secret is set", () => {
    const n = new DingTalkNotifier({
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=abc",
      secret: "SECtest",
    });
    const url = n._signedUrl();
    expect(url).toContain("timestamp=");
    expect(url).toContain("sign=");
    expect(url).toContain("abc");
  });

  it("_signedUrl() returns base URL when no secret", () => {
    const n = new DingTalkNotifier({ webhookUrl: "https://oapi.test/robot" });
    expect(n._signedUrl()).toBe("https://oapi.test/robot");
  });
});

// ─── FeishuNotifier ───────────────────────────────────────────────

describe("FeishuNotifier", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("send() posts interactive card", async () => {
    globalThis.fetch = mockFetch({ data: { code: 0 } });
    const n = new FeishuNotifier({
      webhookUrl: "https://open.feishu.cn/bot/hook/xxx",
    });
    const result = await n.send("✅ CI 通过", ["任务完成"], "green");
    expect(result.ok).toBe(true);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.msg_type).toBe("interactive");
    expect(body.card.header.template).toBe("green");
    expect(body.card.header.title.content).toBe("✅ CI 通过");
  });

  it("notifyFailure() uses red color", async () => {
    globalThis.fetch = mockFetch({ data: { code: 0 } });
    const n = new FeishuNotifier({ webhookUrl: "https://test/hook" });
    await n.notifyFailure({
      taskId: "t1",
      description: "x",
      errors: ["err1"],
      retryNumber: 1,
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.card.header.template).toBe("red");
    expect(body.card.header.title.content).toContain("失败");
  });

  it("_sign() computes HMAC when secret set", () => {
    const n = new FeishuNotifier({
      webhookUrl: "https://test/hook",
      secret: "mysecret",
    });
    const sign = n._sign("1234567890");
    expect(typeof sign).toBe("string");
    expect(sign.length).toBeGreaterThan(0);
  });

  it("_sign() returns undefined when no secret", () => {
    const n = new FeishuNotifier({ webhookUrl: "https://test/hook" });
    expect(n._sign("123")).toBeUndefined();
  });
});

// ─── WebSocketNotifier ────────────────────────────────────────────

describe("WebSocketNotifier", () => {
  it("send() calls the provided sendFn with typed event", () => {
    const sendFn = vi.fn();
    const n = new WebSocketNotifier({ send: sendFn, requestId: "req-1" });
    n.send("ci:pass", { taskId: "t1" });
    expect(sendFn).toHaveBeenCalledOnce();
    const payload = sendFn.mock.calls[0][0];
    expect(payload.type).toBe("orchestrate:event");
    expect(payload.event).toBe("ci:pass");
    expect(payload.requestId).toBe("req-1");
    expect(payload.taskId).toBe("t1");
    expect(payload.ts).toBeDefined();
  });

  it("notifyStart/Success/Failure call send()", async () => {
    const sendFn = vi.fn();
    const n = new WebSocketNotifier({ send: sendFn });
    await n.notifyStart({ taskId: "t1", description: "x" });
    await n.notifySuccess({ taskId: "t1", description: "x" });
    await n.notifyFailure({
      taskId: "t1",
      description: "x",
      errors: [],
      retryNumber: 1,
    });
    expect(sendFn).toHaveBeenCalledTimes(3);
    expect(sendFn.mock.calls[0][0].event).toBe("start");
    expect(sendFn.mock.calls[1][0].event).toBe("ci:pass");
    expect(sendFn.mock.calls[2][0].event).toBe("ci:fail");
  });

  it("sendAgentOutput emits agent:output event", () => {
    const sendFn = vi.fn();
    const n = new WebSocketNotifier({ send: sendFn });
    n.sendAgentOutput({ agentId: "a1", taskId: "t1", chunk: "hello" });
    expect(sendFn.mock.calls[0][0].event).toBe("agent:output");
    expect(sendFn.mock.calls[0][0].chunk).toBe("hello");
  });

  it("sendStatus emits task:status event", () => {
    const sendFn = vi.fn();
    const n = new WebSocketNotifier({ send: sendFn });
    n.sendStatus({
      id: "t1",
      status: "ci-checking",
      retries: 0,
      subtasks: [1, 2],
    });
    expect(sendFn.mock.calls[0][0].event).toBe("task:status");
    expect(sendFn.mock.calls[0][0].status).toBe("ci-checking");
  });

  it("isConfigured is true when sendFn provided", () => {
    expect(new WebSocketNotifier({ send: vi.fn() }).isConfigured).toBe(true);
  });
});

// ─── NotificationManager ──────────────────────────────────────────

describe("NotificationManager", () => {
  it("fromEnv() creates empty manager when no env vars set", () => {
    const nm = NotificationManager.fromEnv();
    expect(nm.activeChannels).toEqual([]);
    expect(nm.isConfigured).toBe(false);
  });

  it("add() registers a channel by name", () => {
    const nm = new NotificationManager();
    const notifier = {
      isConfigured: true,
      notifyStart: vi.fn(),
      notifySuccess: vi.fn(),
      notifyFailure: vi.fn(),
    };
    nm.add("test", notifier);
    expect(nm.activeChannels).toContain("test");
    expect(nm.isConfigured).toBe(true);
  });

  it("add() replaces existing channel with same name", () => {
    const nm = new NotificationManager();
    const n1 = {
      isConfigured: true,
      notifyStart: vi.fn(),
      notifySuccess: vi.fn(),
      notifyFailure: vi.fn(),
    };
    const n2 = {
      isConfigured: true,
      notifyStart: vi.fn(),
      notifySuccess: vi.fn(),
      notifyFailure: vi.fn(),
    };
    nm.add("ch", n1);
    nm.add("ch", n2);
    expect(nm.activeChannels.filter((c) => c === "ch")).toHaveLength(1);
  });

  it("remove() removes a channel", () => {
    const nm = new NotificationManager();
    nm.add("ch", {
      isConfigured: true,
      notifyStart: vi.fn(),
      notifySuccess: vi.fn(),
      notifyFailure: vi.fn(),
    });
    nm.remove("ch");
    expect(nm.activeChannels).not.toContain("ch");
  });

  it("addWebSocketChannel() adds ws channel and returns notifier", () => {
    const nm = new NotificationManager();
    const send = vi.fn();
    const wsNotifier = nm.addWebSocketChannel({ send, requestId: "r1" });
    expect(nm.activeChannels).toContain("websocket");
    expect(wsNotifier).toBeDefined();
  });

  it("broadcasts notifySuccess to all channels", async () => {
    const nm = new NotificationManager();
    const ch1 = {
      isConfigured: true,
      notifyStart: vi.fn(),
      notifySuccess: vi.fn(() => Promise.resolve({ ok: true })),
      notifyFailure: vi.fn(),
    };
    const ch2 = {
      isConfigured: true,
      notifyStart: vi.fn(),
      notifySuccess: vi.fn(() => Promise.resolve({ ok: true })),
      notifyFailure: vi.fn(),
    };
    nm.add("ch1", ch1);
    nm.add("ch2", ch2);
    const results = await nm.notifySuccess({ taskId: "t1", description: "x" });
    expect(ch1.notifySuccess).toHaveBeenCalledTimes(1);
    expect(ch2.notifySuccess).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
  });

  it("one failing channel does not block others", async () => {
    const nm = new NotificationManager();
    const failing = {
      isConfigured: true,
      notifyStart: vi.fn(),
      notifySuccess: vi.fn(() => Promise.reject(new Error("network error"))),
      notifyFailure: vi.fn(),
    };
    const passing = {
      isConfigured: true,
      notifyStart: vi.fn(),
      notifySuccess: vi.fn(() => Promise.resolve({ ok: true })),
      notifyFailure: vi.fn(),
    };
    nm.add("fail", failing);
    nm.add("pass", passing);
    const results = await nm.notifySuccess({ taskId: "t1", description: "x" });
    expect(results).toHaveLength(2);
    expect(passing.notifySuccess).toHaveBeenCalledTimes(1);
  });
});

// ─── Incoming parsers ─────────────────────────────────────────────

describe("parseDingTalkIncoming", () => {
  it("extracts text content from DingTalk webhook payload", () => {
    const body = { msgtype: "text", text: { content: "  Fix bug #42  " } };
    expect(parseDingTalkIncoming(body)).toBe("Fix bug #42");
  });

  it("returns null for non-text messages", () => {
    expect(parseDingTalkIncoming({ msgtype: "image" })).toBeNull();
    expect(parseDingTalkIncoming(null)).toBeNull();
  });
});

describe("parseFeishuIncoming", () => {
  it("extracts text from Feishu event payload", () => {
    const body = {
      event: {
        message: {
          content: JSON.stringify({ text: "  Deploy to production  " }),
        },
      },
    };
    expect(parseFeishuIncoming(body)).toBe("Deploy to production");
  });

  it("returns null for missing content", () => {
    expect(parseFeishuIncoming({})).toBeNull();
    expect(parseFeishuIncoming(null)).toBeNull();
  });
});

describe("parseWeComIncoming", () => {
  it("extracts Content from WeCom XML", () => {
    const xml = `<xml><Content><![CDATA[Fix auth bug]]></Content></xml>`;
    expect(parseWeComIncoming(xml)).toBe("Fix auth bug");
  });

  it("returns null when no Content field", () => {
    expect(
      parseWeComIncoming("<xml><MsgType>event</MsgType></xml>"),
    ).toBeNull();
  });

  it("trims whitespace from content", () => {
    const xml = `<xml><Content><![CDATA[  hello world  ]]></Content></xml>`;
    expect(parseWeComIncoming(xml)).toBe("hello world");
  });
});
